from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TXN_TYPES, StoreStockTransaction
from app.modules.store.schemas.stock import (
    StoreStockBalanceResponse,
    StoreStockTransactionCreate,
    StoreStockTransactionResponse,
)
from app.modules.store.services.stock_ledger import post_stock_transaction

router = APIRouter(prefix="/store/stock", tags=["Store"])

# Manual entries via this endpoint are limited to correction-style types —
# receipt/issue/transfer/return should normally be posted by their owning
# doc type (GRN, Material Issue, ...) once those exist, not typed in free-
# hand here. Damage is legitimately manual-only. adjustment_in/out are NOT
# allowed (2026-10-01): adjustments must go through Store → Adjustments so
# they get an approval and an adjustment number and show in that list.
_MANUAL_ALLOWED_TYPES = ("receipt", "issue", "damage")


def _txn_to_response(db: Session, txn: StoreStockTransaction) -> StoreStockTransactionResponse:
    item = db.query(StoreItem).filter(StoreItem.id == txn.item_id).first()
    location = db.query(StoreLocation).filter(StoreLocation.id == txn.location_id).first()
    bin_ = db.query(StoreBin).filter(StoreBin.id == txn.bin_id).first() if txn.bin_id else None
    creator = db.query(User).filter(User.id == txn.created_by_id).first() if txn.created_by_id else None
    return StoreStockTransactionResponse.model_validate(txn).model_copy(update={
        "item_code": item.item_code if item else None,
        "item_name": item.item_name if item else None,
        "location_name": location.name if location else None,
        "bin_code": bin_.code if bin_ else None,
        "created_by_name": creator.name if creator else None,
    })


@router.get("/balances", response_model=list[StoreStockBalanceResponse])
async def list_balances(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockBalance)
    if item_id is not None:
        query = query.filter(StoreStockBalance.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockBalance.location_id == location_id)
    balances = query.all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({b.item_id for b in balances})).all()} if balances else {}
    locations = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_({b.location_id for b in balances})).all()} if balances else {}
    result = []
    for b in balances:
        item = items.get(b.item_id)
        location = locations.get(b.location_id)
        result.append(StoreStockBalanceResponse.model_validate(b).model_copy(update={
            "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None,
            "uom": item.uom if item else None,
            "location_name": location.name if location else None,
            "available_qty": b.on_hand_qty - b.reserved_qty,
        }))
    result.sort(key=lambda r: (r.item_name or "", r.location_name or ""))
    return result


@router.get("/transactions", response_model=list[StoreStockTransactionResponse])
async def list_transactions(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    transaction_type: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockTransaction)
    if item_id is not None:
        query = query.filter(StoreStockTransaction.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockTransaction.location_id == location_id)
    if transaction_type is not None:
        query = query.filter(StoreStockTransaction.transaction_type == transaction_type)
    txns = query.order_by(StoreStockTransaction.transaction_date.desc(), StoreStockTransaction.id.desc()).limit(500).all()
    return [_txn_to_response(db, t) for t in txns]


@router.post("/transactions", response_model=StoreStockTransactionResponse)
async def create_transaction(
    payload: StoreStockTransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if payload.transaction_type in ("adjustment_in", "adjustment_out"):
        raise HTTPException(
            status_code=422,
            detail="Stock adjustments can't be recorded here — use Store → Adjustments → New, so the adjustment gets an approver and shows in the Adjustments list.",
        )
    if payload.transaction_type not in _MANUAL_ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"'{payload.transaction_type}' cannot be posted manually — allowed here: {', '.join(_MANUAL_ALLOWED_TYPES)}",
        )
    if not db.query(StoreItem).filter(StoreItem.id == payload.item_id).first():
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Warehouse not found")
    try:
        txn = post_stock_transaction(
            db,
            item_id=payload.item_id,
            location_id=payload.location_id,
            bin_id=payload.bin_id,
            transaction_type=payload.transaction_type,
            quantity=payload.quantity,
            batch_number=payload.batch_number,
            reference_type=payload.reference_type or "manual",
            reference_number=payload.reference_number,
            transaction_date=payload.transaction_date,
            remarks=payload.remarks,
            created_by_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    db.refresh(txn)
    return _txn_to_response(db, txn)


@router.get("/transaction-types")
async def list_transaction_types(_user: User = Depends(require_app_access("store"))):
    return {"all": STORE_STOCK_TXN_TYPES, "manual": _MANUAL_ALLOWED_TYPES}
