"""Every stock_transactions write goes through here, never a raw insert from
a route handler — this is where the balance-recompute and negative-stock
guard live, in exactly one place. See
docs/product/STORE_DEPARTMENT_MODULE_PLAN.md cross-cutting rules."""
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.modules.store.models.stock_balance import StockBalance
from app.modules.store.models.stock_transaction import StockTransaction, STOCK_TRANSACTION_TYPES

# Movements that reduce stock — a resulting negative balance blocks the
# transaction unless `allow_negative` is explicitly passed (used during
# initial rollout while opening balances are still being loaded).
_OUTBOUND_TYPES = {"issue", "transfer_out"}


def _get_or_create_balance(db: Session, stock_item_id: int, location_id: int) -> StockBalance:
    balance = (
        db.query(StockBalance)
        .filter(StockBalance.stock_item_id == stock_item_id, StockBalance.location_id == location_id)
        .first()
    )
    if not balance:
        balance = StockBalance(stock_item_id=stock_item_id, location_id=location_id, quantity_on_hand=0)
        db.add(balance)
        db.flush()
    return balance


def record_stock_transaction(
    db: Session,
    *,
    stock_item_id: int,
    location_id: int,
    type: str,
    quantity: float,
    reference_type: str | None = None,
    reference_id: int | None = None,
    performed_by_id: int | None = None,
    remarks: str | None = None,
    allow_negative: bool = True,
) -> StockTransaction:
    """Post one signed stock movement and update the cached balance.
    `quantity` must already be signed correctly by the caller (positive for
    receipt/transfer_in/return, negative for issue/transfer_out)."""
    if type not in STOCK_TRANSACTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid stock transaction type '{type}'")

    balance = _get_or_create_balance(db, stock_item_id, location_id)
    new_qty = balance.quantity_on_hand + quantity

    if type in _OUTBOUND_TYPES and new_qty < 0 and not allow_negative:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock: {balance.quantity_on_hand} on hand, cannot post {type} of {abs(quantity)}",
        )

    balance.quantity_on_hand = new_qty

    txn = StockTransaction(
        stock_item_id=stock_item_id,
        location_id=location_id,
        type=type,
        quantity=quantity,
        reference_type=reference_type,
        reference_id=reference_id,
        performed_by_id=performed_by_id,
        remarks=remarks,
    )
    db.add(txn)
    db.flush()
    return txn


def record_stock_receipt(
    db: Session, *, stock_item_id: int, location_id: int, quantity: float,
    reference_type: str, reference_id: int | None = None,
    performed_by_id: int | None = None, remarks: str | None = None,
) -> StockTransaction:
    """Called from Purchase's GRN save path — the one deliberate exception to
    the id-reference-only module boundary rule, since Store must enforce its
    own ledger invariants. See docs/product/PURCHASE_STORE_INTEGRATION.md."""
    return record_stock_transaction(
        db, stock_item_id=stock_item_id, location_id=location_id, type="receipt",
        quantity=abs(quantity), reference_type=reference_type, reference_id=reference_id,
        performed_by_id=performed_by_id, remarks=remarks,
    )
