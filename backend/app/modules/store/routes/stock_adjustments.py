from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.schemas.stock_adjustment import StoreStockAdjustmentCreate, StoreStockAdjustmentResponse
from app.modules.store.service import generate_stock_adjustment_number
from app.modules.store.services.stock_ledger import post_stock_transaction, get_locked_balance

router = APIRouter(prefix="/store/stock-adjustments", tags=["Store"])


def _to_response(db: Session, adjustment: StoreStockAdjustment) -> StoreStockAdjustmentResponse:
    location = db.query(StoreLocation).filter(StoreLocation.id == adjustment.location_id).first()
    user_ids = {adjustment.approved_by_id, adjustment.created_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in adjustment.items])).all()} if adjustment.items else {}

    resp = StoreStockAdjustmentResponse.model_validate(adjustment)
    resp.location_name = location.name if location else None
    if adjustment.approved_by_id and adjustment.approved_by_id in users:
        resp.approved_by_name = users[adjustment.approved_by_id].name or users[adjustment.approved_by_id].email
    if adjustment.created_by_id and adjustment.created_by_id in users:
        resp.created_by_name = users[adjustment.created_by_id].name or users[adjustment.created_by_id].email
    for line, item_resp in zip(adjustment.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
    return resp


@router.get("", response_model=list[StoreStockAdjustmentResponse])
async def list_stock_adjustments(
    location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items))
    if location_id is not None:
        query = query.filter(StoreStockAdjustment.location_id == location_id)
    adjustments = query.order_by(StoreStockAdjustment.created_at.desc()).all()
    return [_to_response(db, a) for a in adjustments]


@router.get("/{adjustment_id}", response_model=StoreStockAdjustmentResponse)
async def get_stock_adjustment(
    adjustment_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment_id).first()
    if not adjustment:
        raise HTTPException(status_code=404, detail="Stock adjustment not found")
    return _to_response(db, adjustment)


@router.post("", response_model=StoreStockAdjustmentResponse)
async def create_stock_adjustment(
    payload: StoreStockAdjustmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Warehouse not found")
    if not db.query(User).filter(User.id == payload.approved_by_id).first():
        raise HTTPException(status_code=404, detail="Approver not found")

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.actual_quantity < 0:
            raise HTTPException(status_code=422, detail=f"Actual quantity for '{items_by_id[p.item_id].item_name}' cannot be negative")

    adjustment = StoreStockAdjustment(
        adjustment_number=generate_stock_adjustment_number(db),
        location_id=payload.location_id,
        adjustment_date=payload.adjustment_date or date.today(),
        reason=payload.reason,
        approved_by_id=payload.approved_by_id,
        created_by_id=user.id,
        remarks=payload.remarks,
    )
    db.add(adjustment)
    db.flush()

    try:
        for p in payload.items:
            # Locks the balance row before reading it, so a concurrent
            # transaction can't land between this read and post_stock_transaction()
            # applying the delta below — otherwise the delta would be computed
            # from a stale on_hand_qty and land the adjustment on the wrong
            # absolute value instead of the physical count just recorded.
            balance = get_locked_balance(db, p.item_id, payload.location_id)
            existing_qty = balance.on_hand_qty
            difference = p.actual_quantity - existing_qty

            db.add(StoreStockAdjustmentItem(
                adjustment_id=adjustment.id, item_id=p.item_id, existing_quantity=existing_qty,
                actual_quantity=p.actual_quantity, difference=difference, remarks=p.remarks,
            ))
            if difference > 0:
                post_stock_transaction(
                    db, item_id=p.item_id, location_id=payload.location_id, transaction_type="adjustment_in",
                    quantity=difference, reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                    transaction_date=adjustment.adjustment_date, created_by_id=user.id,
                )
            elif difference < 0:
                post_stock_transaction(
                    db, item_id=p.item_id, location_id=payload.location_id, transaction_type="adjustment_out",
                    quantity=abs(difference), reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                    transaction_date=adjustment.adjustment_date, created_by_id=user.id,
                )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    db.commit()
    db.refresh(adjustment)
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment.id).first()
    return _to_response(db, adjustment)
