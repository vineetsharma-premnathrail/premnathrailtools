from datetime import date
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction

# Whether a transaction type adds to or removes from on-hand stock at its
# location — see StoreStockTransaction for what each type means.
_INBOUND_TYPES = {"receipt", "return_in", "transfer_in", "adjustment_in", "manual_in"}
_OUTBOUND_TYPES = {"issue", "return_out", "transfer_out", "adjustment_out", "damage", "manual_out"}
# Quarantine moves touch only quarantine_qty (damaged/rejected material that
# is physically present but not usable) — never on_hand/reserved.
_QUARANTINE_IN_TYPES = {"quarantine_in"}
_QUARANTINE_OUT_TYPES = {"quarantine_out"}

# Outbound types that represent allocating stock to a new consumer — these
# must not draw down stock another reservation has already earmarked, or the
# same physical stock could be handed out twice. adjustment_out/damage are
# excluded: they correct the ledger to match a physical count/write-off fact,
# which must be allowed to proceed even if it leaves reserved_qty temporarily
# exceeding on_hand_qty (adjust_reserved_qty's own check then blocks any *new*
# reservation until that's resolved).
_RESERVATION_AWARE_OUTBOUND_TYPES = {"issue", "return_out", "transfer_out", "manual_out"}


def get_locked_balance(db: Session, item_id: int, location_id: int) -> StoreStockBalance:
    """Row-locks (or creates) the (item, location) balance row. Callers that
    need to read on_hand_qty and then decide what to post — e.g. a stock
    adjustment computing its delta from a physical count — must take this
    lock BEFORE reading the balance, not just when post_stock_transaction()
    itself later applies the delta, or a concurrent transaction landing in
    between makes the computed delta stale."""
    return _get_or_create_balance(db, item_id, location_id)


def _get_or_create_balance(db: Session, item_id: int, location_id: int) -> StoreStockBalance:
    balance = db.query(StoreStockBalance).filter(
        StoreStockBalance.item_id == item_id, StoreStockBalance.location_id == location_id
    ).with_for_update().first()
    if balance:
        return balance
    # Two first-ever postings for the same (item, store) can both get here;
    # insert inside a savepoint so the loser re-reads the winner's row
    # (locked) instead of failing the whole request on the unique key.
    try:
        with db.begin_nested():
            balance = StoreStockBalance(item_id=item_id, location_id=location_id, on_hand_qty=0, reserved_qty=0, quarantine_qty=0)
            db.add(balance)
            db.flush()
        return balance
    except IntegrityError:
        return db.query(StoreStockBalance).filter(
            StoreStockBalance.item_id == item_id, StoreStockBalance.location_id == location_id
        ).with_for_update().one()


def post_stock_transaction(
    db: Session,
    *,
    item_id: int,
    location_id: int,
    transaction_type: str,
    quantity: float,
    bin_id: int | None = None,
    batch_number: str | None = None,
    reference_type: str | None = None,
    reference_number: str | None = None,
    transaction_date: date | None = None,
    remarks: str | None = None,
    vendor_name: str | None = None,
    created_by_id: int | None = None,
    entry_type: str | None = None,
) -> StoreStockTransaction:
    """Writes one immutable ledger row and applies its effect to the
    (item, location) running balance in the same call — this is the only
    way `store_stock_balances` should ever be mutated, so it never drifts
    from the ledger it's derived from."""
    if quantity <= 0:
        raise ValueError("Stock transaction quantity must be greater than zero")

    def where() -> str:
        # Names for the error text, so the user knows which line failed.
        item = db.query(StoreItem.item_name).filter(StoreItem.id == item_id).scalar()
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        return f"'{item or f'Item {item_id}'}' in {loc or f'store {location_id}'}"

    if transaction_type in _INBOUND_TYPES and db.query(StoreLocation.is_active).filter(StoreLocation.id == location_id).scalar() is False:
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        raise ValueError(f"Store '{loc}' is inactive, so stock can't be received into it — reactivate it under Store → Settings → Stores, or pick another store.")

    balance = _get_or_create_balance(db, item_id, location_id)
    if transaction_type in _QUARANTINE_IN_TYPES:
        balance.quarantine_qty = (balance.quarantine_qty or 0) + quantity
    elif transaction_type in _QUARANTINE_OUT_TYPES:
        held = balance.quarantine_qty or 0
        if held - quantity < -1e-9:
            raise ValueError(f"Only {held:g} of {where()} is in quarantine, {quantity:g} requested")
        balance.quarantine_qty = held - quantity
    elif transaction_type in _INBOUND_TYPES:
        balance.on_hand_qty += quantity
    elif transaction_type in _OUTBOUND_TYPES:
        if transaction_type in _RESERVATION_AWARE_OUTBOUND_TYPES:
            available = balance.on_hand_qty - balance.reserved_qty
            if available - quantity < -1e-9:
                raise ValueError(
                    f"Not enough stock of {where()} — {balance.on_hand_qty:g} on hand, "
                    f"{balance.reserved_qty:g} reserved ({available:g} available), {quantity:g} requested"
                )
        elif balance.on_hand_qty - quantity < -1e-9:
            raise ValueError(f"Not enough stock of {where()} — {balance.on_hand_qty:g} on hand, {quantity:g} requested")
        balance.on_hand_qty -= quantity
    else:
        raise ValueError(f"Unknown stock transaction type '{transaction_type}'")

    txn = StoreStockTransaction(
        item_id=item_id,
        location_id=location_id,
        bin_id=bin_id,
        transaction_type=transaction_type,
        entry_type=entry_type,
        quantity=quantity,
        batch_number=batch_number,
        reference_type=reference_type,
        reference_number=reference_number,
        transaction_date=transaction_date or date.today(),
        remarks=remarks,
        vendor_name=vendor_name,
        created_by_id=created_by_id,
    )
    db.add(txn)
    db.flush()
    return txn


def adjust_reserved_qty(db: Session, *, item_id: int, location_id: int, delta: float) -> StoreStockBalance:
    """Moves stock between "available" and "reserved" without touching
    on_hand_qty or the transaction ledger — a reservation earmarks existing
    on-hand stock, it doesn't move it. delta is positive to reserve more,
    negative to release. Raises if a reservation would exceed on-hand
    (available would go negative) or a release would exceed what's
    currently reserved."""
    balance = _get_or_create_balance(db, item_id, location_id)
    new_reserved = balance.reserved_qty + delta
    if new_reserved < -1e-9:
        raise ValueError(f"Cannot release {abs(delta)} — only {balance.reserved_qty} is currently reserved")
    if delta > 0 and new_reserved - balance.on_hand_qty > 1e-9:
        available = balance.on_hand_qty - balance.reserved_qty
        raise ValueError(f"Insufficient available stock to reserve — {available} available, {delta} requested")
    balance.reserved_qty = max(0.0, new_reserved)
    db.flush()
    return balance
