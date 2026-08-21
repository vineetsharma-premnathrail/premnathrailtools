from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.stock_item import StockItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StockBalance
from app.modules.store.models.stock_transaction import StockTransaction
from app.modules.store.schemas.stock_transaction import (
    StockInPayload, StockIssuePayload, StockTransferPayload, StockTransactionResponse,
)
from app.modules.store.schemas.stock_balance import StockBalanceResponse, StockAdjustPayload
from app.modules.store.service import record_stock_transaction

router = APIRouter(prefix="/store/transactions", tags=["Store"])


def _to_response(db: Session, txn: StockTransaction) -> StockTransactionResponse:
    resp = StockTransactionResponse.model_validate(txn)
    item = db.query(StockItem).filter(StockItem.id == txn.stock_item_id).first()
    resp.stock_item_description = item.description if item else None
    location = db.query(StoreLocation).filter(StoreLocation.id == txn.location_id).first()
    resp.location_name = location.name if location else None
    if txn.performed_by_id:
        user = db.query(User).filter(User.id == txn.performed_by_id).first()
        resp.performed_by_name = (user.name or user.email) if user else None
    return resp


@router.get("", response_model=list[StockTransactionResponse])
async def list_transactions(
    stock_item_id: int | None = None,
    location_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StockTransaction)
    if stock_item_id:
        query = query.filter(StockTransaction.stock_item_id == stock_item_id)
    if location_id:
        query = query.filter(StockTransaction.location_id == location_id)
    txns = query.order_by(StockTransaction.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, t) for t in txns]


@router.post("/stock-in", response_model=StockTransactionResponse)
async def stock_in(
    payload: StockInPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    txn = record_stock_transaction(
        db, stock_item_id=payload.stock_item_id, location_id=payload.location_id,
        type="receipt", quantity=abs(payload.quantity), reference_type="manual_adjustment",
        performed_by_id=user.id, remarks=payload.remarks,
    )
    db.commit()
    db.refresh(txn)
    return _to_response(db, txn)


@router.post("/issue", response_model=StockTransactionResponse)
async def issue_stock(
    payload: StockIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    txn = record_stock_transaction(
        db, stock_item_id=payload.stock_item_id, location_id=payload.location_id,
        type="issue", quantity=-abs(payload.quantity),
        reference_type=payload.reference_type, reference_id=payload.reference_id,
        performed_by_id=user.id, remarks=payload.remarks, allow_negative=payload.allow_negative,
    )
    db.commit()
    db.refresh(txn)
    return _to_response(db, txn)


@router.get("/balances", response_model=list[StockBalanceResponse])
async def list_balances(
    location_id: int = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    """All active stock items at a location, for a cycle-count sheet — items
    with no balance row yet are included at 0, since a count sheet must cover
    everything that could physically be on the shelf, not just items with
    prior movement."""
    items = db.query(StockItem).filter(StockItem.status == "active").order_by(StockItem.description.asc()).all()
    balances = {
        b.stock_item_id: b.quantity_on_hand
        for b in db.query(StockBalance).filter(StockBalance.location_id == location_id).all()
    }
    return [
        StockBalanceResponse(
            stock_item_id=item.id, part_code=item.part_code, description=item.description,
            unit=item.unit, quantity_on_hand=balances.get(item.id, 0.0),
        )
        for item in items
    ]


@router.post("/adjust", response_model=StockTransactionResponse)
async def adjust_stock(
    payload: StockAdjustPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    """Post a cycle-count variance: the caller supplies the physically counted
    quantity, this computes and posts the signed adjustment against the
    current balance."""
    current = (
        db.query(StockBalance)
        .filter(StockBalance.stock_item_id == payload.stock_item_id, StockBalance.location_id == payload.location_id)
        .first()
    )
    current_qty = current.quantity_on_hand if current else 0.0
    variance = payload.counted_quantity - current_qty
    if variance == 0:
        raise HTTPException(status_code=400, detail="Counted quantity matches system quantity — nothing to adjust")

    txn = record_stock_transaction(
        db, stock_item_id=payload.stock_item_id, location_id=payload.location_id,
        type="adjustment", quantity=variance, reference_type="manual_adjustment",
        performed_by_id=user.id, remarks=payload.remarks,
    )
    db.commit()
    db.refresh(txn)
    return _to_response(db, txn)


@router.post("/transfer", response_model=list[StockTransactionResponse])
async def transfer_stock(
    payload: StockTransferPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if payload.source_location_id == payload.destination_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")

    out_txn = record_stock_transaction(
        db, stock_item_id=payload.stock_item_id, location_id=payload.source_location_id,
        type="transfer_out", quantity=-abs(payload.quantity), performed_by_id=user.id, remarks=payload.remarks,
        allow_negative=False,
    )
    in_txn = record_stock_transaction(
        db, stock_item_id=payload.stock_item_id, location_id=payload.destination_location_id,
        type="transfer_in", quantity=abs(payload.quantity), performed_by_id=user.id, remarks=payload.remarks,
    )
    db.commit()
    db.refresh(out_txn)
    db.refresh(in_txn)
    return [_to_response(db, out_txn), _to_response(db, in_txn)]
