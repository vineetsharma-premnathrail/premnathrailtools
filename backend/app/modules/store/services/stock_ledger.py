from datetime import date
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TYPE_EFFECT, StoreStockTransaction
from app.modules.store.services import valuation

# Whether a transaction type adds to or removes from on-hand stock at its
# location — see StoreStockTransaction for what each type means.
_INBOUND_TYPES = {"receipt", "return_in", "transfer_in", "adjustment_in", "manual_in"}
_OUTBOUND_TYPES = {"issue", "return_out", "transfer_out", "adjustment_out", "damage", "manual_out"}
# Quarantine moves touch only quarantine_qty (damaged/rejected material that
# is physically present but not usable) — never on_hand/reserved.
_QUARANTINE_IN_TYPES = {"quarantine_in"}
_QUARANTINE_OUT_TYPES = {"quarantine_out"}
# Stock-type moves (Quality module): (bucket taken from, bucket added to).
# "quality" = quality_qty, "blocked" = quarantine_qty, "free" = on_hand_qty,
# None = outside the store. Quality and Blocked stock are never part of
# on_hand_qty, so issue / transfer / reservation / dispatch (which only draw
# on on_hand_qty) can't touch material that is still in inspection or
# rejected — that is how "Quality / Blocked stock can't be issued" is enforced.
_STOCK_TYPE_MOVES: dict[str, tuple[str | None, str | None]] = {
    "quality_in": (None, "quality"),
    "quality_release": ("quality", "free"),
    "quality_block": ("quality", "blocked"),
    "blocked_release": ("blocked", "free"),
    "blocked_to_quality": ("blocked", "quality"),
    "free_block": ("free", "blocked"),
    "quality_hold": ("free", "quality"),
    # Job work (SAP special stock O): WITH VENDOR stock is still ours and
    # valued (value-neutral moves), but never issuable. jobwork_consume takes
    # it out of the books (used up at the vendor) at the current average.
    "jobwork_out": ("free", "vendor"),
    "jobwork_in": ("vendor", "free"),
    "jobwork_to_quality": ("vendor", "quality"),
    "jobwork_to_blocked": ("vendor", "blocked"),
    "jobwork_consume": ("vendor", None),
}
_BUCKET_ATTR = {"free": "on_hand_qty", "quality": "quality_qty", "blocked": "quarantine_qty", "vendor": "vendor_qty"}
_BUCKET_LABEL = {"free": "Free", "quality": "Quality (awaiting inspection)", "blocked": "Blocked", "vendor": "With vendor (job work)"}

# Outbound types that represent allocating stock to a new consumer — these
# must not draw down stock another reservation has already earmarked, or the
# same physical stock could be handed out twice. adjustment_out/damage are
# excluded: they correct the ledger to match a physical count/write-off fact,
# which must be allowed to proceed even if it leaves reserved_qty temporarily
# exceeding on_hand_qty (adjust_reserved_qty's own check then blocks any *new*
# reservation until that's resolved).
_RESERVATION_AWARE_OUTBOUND_TYPES = {"issue", "return_out", "transfer_out", "manual_out"}

# Posting hooks (store/order_project_links.py registers the project-stock
# ones): pre-hooks run before the balance is checked — fn(db, item_id=,
# location_id=, transaction_type=, quantity=, reference_type=,
# reference_number=) — and may release holds; post-hooks run after the row is
# written — fn(db, txn). A post-hook failure is logged and rolled back to a
# savepoint, never blocking the posting; a pre-hook may raise to refuse it.
_pre_posting_hooks: list = []
_posting_hooks: list = []


def register_pre_posting_hook(fn) -> None:
    if fn not in _pre_posting_hooks:
        _pre_posting_hooks.append(fn)


def register_posting_hook(fn) -> None:
    if fn not in _posting_hooks:
        _posting_hooks.append(fn)


def _run_posting_hooks(db: Session, txn: StoreStockTransaction) -> None:
    for fn in _posting_hooks:
        try:
            with db.begin_nested():
                fn(db, txn)
        except Exception:  # noqa: BLE001 — a hook must never break a stock posting
            import logging
            logging.getLogger(__name__).exception("Stock posting hook %s failed for %s %s", getattr(fn, "__name__", fn),
                                                  txn.reference_type, txn.reference_number)


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
            balance = StoreStockBalance(item_id=item_id, location_id=location_id, on_hand_qty=0, reserved_qty=0, quarantine_qty=0, quality_qty=0, vendor_qty=0)
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
    unit_cost: float | None = None,
    cost_source: str | None = None,
    value: float | None = None,
    rate_required: bool | None = None,
) -> StoreStockTransaction:
    """Writes one immutable ledger row and applies its effect to the
    (item, location) running balance in the same call — this is the only
    way `store_stock_balances` should ever be mutated, so it never drifts
    from the ledger it's derived from.

    Valuation (foundation plan §5.1) runs only while the Store setting
    `valuation_enabled` is on; off, the cost arguments are ignored and the
    row is quantity-only, as before. On: `unit_cost` prices an inbound row
    (it moves the average) or an outbound one (e.g. vendor return at the GRN
    rate); `value` is the exact value for the paired "in" row of a transfer;
    with neither, the row moves at the current average. `rate_required`
    (default: manual_in / adjustment_in while require_rate_on_manual_receipt
    is on) refuses an unpriced receipt of an item with no average and no
    standard cost instead of posting it unvalued. Multi-line documents must
    post in valuation.ledger_sort_key() order."""
    if quantity <= 0:
        raise ValueError("Stock transaction quantity must be greater than zero")
    # MM posting period (MMPV/OMSY): never into a period Finance has closed.
    from app.modules.store.services.posting_period import assert_stock_postable
    assert_stock_postable(db, transaction_date or date.today())

    def where() -> str:
        # Names for the error text, so the user knows which line failed.
        item = db.query(StoreItem.item_name).filter(StoreItem.id == item_id).scalar()
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        return f"'{item or f'Item {item_id}'}' in {loc or f'store {location_id}'}"

    def held_note() -> str:
        # Tells the user why stock they can see physically isn't usable.
        parts = []
        if (balance.quality_qty or 0) > 1e-9:
            parts.append(f"{balance.quality_qty:g} is in Quality stock waiting for inspection")
        if (balance.quarantine_qty or 0) > 1e-9:
            parts.append(f"{balance.quarantine_qty:g} is Blocked (rejected / damaged)")
        if not parts:
            return ""
        return " Also " + " and ".join(parts) + " — that can't be issued or dispatched until Quality releases it to Free stock (Quality → Inspection Lots / NCR)."

    if transaction_type in (_INBOUND_TYPES | {"quality_in"}) and db.query(StoreLocation.is_active).filter(StoreLocation.id == location_id).scalar() is False:
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        raise ValueError(f"Store '{loc}' is inactive, so stock can't be received into it — reactivate it under Store → Settings → Stores, or pick another store.")

    # Physical count in progress: the counted items are frozen at that store
    # until the count is submitted or cancelled (SAP posting block), so the
    # book figure the count is compared with doesn't move under the counters.
    from app.modules.store.models.physical_count import StorePhysicalCount, StorePhysicalCountItem, STORE_COUNT_FROZEN_STATUSES
    frozen = db.query(StorePhysicalCount.count_number).join(StorePhysicalCountItem, StorePhysicalCountItem.count_id == StorePhysicalCount.id).filter(
        StorePhysicalCount.location_id == location_id, StorePhysicalCount.status.in_(STORE_COUNT_FROZEN_STATUSES),
        StorePhysicalCountItem.item_id == item_id).first()
    if frozen:
        raise ValueError(f"{where()} is being physically counted ({frozen[0]}) — its stock movements are on hold until that count "
                         "is submitted or cancelled (Store › Physical Count).")

    # Lock order: valuation (item) first, then balance (item, store).
    valued = valuation.valuation_enabled(db)
    val = valuation.lock_valuation(db, item_id) if valued else None
    if transaction_type in _OUTBOUND_TYPES:
        for fn in _pre_posting_hooks:
            fn(db, item_id=item_id, location_id=location_id, transaction_type=transaction_type, quantity=quantity,
               reference_type=reference_type, reference_number=reference_number)
    balance = _get_or_create_balance(db, item_id, location_id)
    avail_before = (balance.on_hand_qty or 0) - (balance.reserved_qty or 0)
    blocked_before = balance.quarantine_qty or 0
    priced = None
    if val is not None:
        if rate_required is None:
            rate_required = transaction_type in valuation.USER_PRICED_TYPES and bool(
                valuation.get_setting(db, "require_rate_on_manual_receipt"))
        # Pure pricing first: a refused rate leaves the balance untouched.
        priced = valuation.price_movement(
            db, val, item_id=item_id, transaction_type=transaction_type, quantity=quantity,
            unit_cost=unit_cost, cost_source=cost_source, value=value, rate_required=rate_required, remarks=remarks,
        ) if transaction_type in STORE_STOCK_TYPE_EFFECT else None
    if transaction_type in _STOCK_TYPE_MOVES:
        src, dst = _STOCK_TYPE_MOVES[transaction_type]
        if src:
            held = getattr(balance, _BUCKET_ATTR[src]) or 0
            if src == "free":
                held -= balance.reserved_qty or 0
            if held - quantity < -1e-9:
                raise ValueError(
                    f"Only {held:g} of {where()} is in {_BUCKET_LABEL[src]} stock, {quantity:g} requested to "
                    + (f"move to {_BUCKET_LABEL[dst]}" if dst else "consume")
                    + " — check the stock-type columns on Store → Stock."
                )
            setattr(balance, _BUCKET_ATTR[src], (getattr(balance, _BUCKET_ATTR[src]) or 0) - quantity)
        if dst:
            setattr(balance, _BUCKET_ATTR[dst], (getattr(balance, _BUCKET_ATTR[dst]) or 0) + quantity)
    elif transaction_type in _QUARANTINE_IN_TYPES:
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
                    f"{balance.reserved_qty:g} reserved ({available:g} available), {quantity:g} requested.{held_note()}"
                )
        elif balance.on_hand_qty - quantity < -1e-9:
            raise ValueError(f"Not enough stock of {where()} — {balance.on_hand_qty:g} on hand, {quantity:g} requested.{held_note()}")
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
    if priced is not None:
        txn_date = txn.transaction_date
        valuation.commit_valuation(
            db, val, priced, item_id=item_id, reference_type=reference_type, reference_number=reference_number,
            transaction_date=txn_date, created_by_id=created_by_id,
        )
        txn.unit_cost = float(priced.unit_cost) if priced.unit_cost is not None else None
        txn.value = float(priced.value) if priced.value is not None else None
        txn.cost_source = priced.cost_source
        txn.valuation_qty_after = val.qty
        txn.valuation_value_after = val.value
    db.add(txn)
    db.flush()
    _stock_events(db, txn, balance, avail_before, blocked_before)
    if _posting_hooks:
        _run_posting_hooks(db, txn)
    return txn


def _stock_events(db: Session, txn: StoreStockTransaction, balance: StoreStockBalance, avail_before: float, blocked_before: float) -> None:
    """Role events (app/core/events/store.py): available stock crossing down
    to the item's reorder level, and material landing in Blocked stock.
    Bell / Teams only (no background task here). Never raises."""
    try:
        from app.core.notification_events import notify_event
        from app.modules.main.models.user import User
        from app.modules.store.services.store_events import location_opener

        item = db.get(StoreItem, txn.item_id)
        loc = db.get(StoreLocation, txn.location_id)
        if item is None:
            return
        actor = db.get(User, txn.created_by_id) if txn.created_by_id else None
        where = loc.name if loc else "the store"
        avail_after = (balance.on_hand_qty or 0) - (balance.reserved_qty or 0)
        level = item.reorder_level
        if level is not None and level > 0 and avail_before > level + 1e-9 and avail_after <= level + 1e-9:
            notify_event(
                db, None, "store", "stock_below_reorder",
                title=f"{item.item_code} at reorder level in {where}",
                message=f"Available stock of {item.item_code} — {item.item_name} at {where} fell to {avail_after:g} {item.uom or ''} "
                        f"(reorder level {level:g}) after {txn.reference_type or txn.transaction_type} {txn.reference_number or ''}. "
                        "Raise a purchase requisition or a transfer (Store › Reorder).".replace("  ", " "),
                entity_type="store_item", entity_id=item.id, actor=actor, can_open=location_opener(db, txn.location_id),
            )
        if (balance.quarantine_qty or 0) > blocked_before + 1e-9:
            added = (balance.quarantine_qty or 0) - blocked_before
            notify_event(
                db, None, "store", "stock_blocked",
                title=f"{added:g} {item.uom or ''} {item.item_code} put into Blocked stock at {where}".replace("  ", " "),
                message=f"{added:g} {item.uom or ''} of {item.item_code} — {item.item_name} went into Blocked (quarantine) stock at {where} "
                        f"({txn.reference_type or txn.transaction_type} {txn.reference_number or ''}). It can't be issued — scrap it, return it to "
                        "the vendor or release it from Store › Stock (material held by a Quality NCR moves only through that NCR).".replace("  ", " "),
                entity_type="store_item", entity_id=item.id, actor=actor, can_open=location_opener(db, txn.location_id),
            )
    except Exception:  # a notification must never break a stock posting
        import logging
        logging.getLogger(__name__).exception("Store stock events failed")


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
