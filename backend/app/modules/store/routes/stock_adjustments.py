from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.schemas.stock_adjustment import (
    StoreStockAdjustmentCreate, StoreStockAdjustmentRejectPayload, StoreStockAdjustmentResponse,
)
from app.modules.store.service import generate_stock_adjustment_number
from app.modules.store.services.stock_ledger import post_stock_transaction, get_locked_balance
from app.utils.notifications import notify_user

router = APIRouter(prefix="/store/stock-adjustments", tags=["Store"])


def _get_pending_for_decision(db: Session, adjustment_id: int, user: User, verb: str) -> StoreStockAdjustment:
    """Loads (and row-locks, so a double-click can't post it twice) an
    adjustment that `user` is allowed to approve or reject: it must still be
    pending, the user must be its named approver (or an admin standing in),
    and never its creator."""
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(
        StoreStockAdjustment.id == adjustment_id
    ).with_for_update().first()
    if not adjustment:
        raise HTTPException(status_code=404, detail="Stock adjustment not found")
    if adjustment.status != "pending_approval":
        raise HTTPException(status_code=409, detail=f"Adjustment {adjustment.adjustment_number} has already been {adjustment.status.replace('_', ' ')} — it can't be {verb}d again.")
    if adjustment.created_by_id == user.id:
        raise HTTPException(status_code=403, detail=f"You created adjustment {adjustment.adjustment_number}, so you can't {verb} it — the approver named on it must.")
    if adjustment.approved_by_id != user.id and user.role != "admin":
        approver = db.query(User).filter(User.id == adjustment.approved_by_id).first()
        approver_name = (approver.name or approver.email) if approver else "the named approver"
        raise HTTPException(status_code=403, detail=f"Only {approver_name} (the approver named on {adjustment.adjustment_number}) or an admin can {verb} it.")
    return adjustment


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
    if payload.approved_by_id == user.id:
        raise HTTPException(status_code=400, detail="You can't approve your own stock adjustment — pick a different approver.")
    approver = db.query(User).filter(User.id == payload.approved_by_id, User.is_active == True).first()  # noqa: E712
    if not approver:
        raise HTTPException(status_code=400, detail="The selected approver was not found or is no longer active — pick another user.")
    if "store" not in approver.get_apps():
        raise HTTPException(status_code=400, detail=f"{approver.name or approver.email} doesn't have access to the Store module, so they couldn't open this adjustment to approve it — pick a Store user, or ask an admin to grant them Store access.")

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
        status="pending_approval",
    )
    db.add(adjustment)
    db.flush()

    # Nothing is posted to stock yet — the count and the difference against
    # the live balance are recorded now, and only the approver's approval
    # (approve_stock_adjustment below) moves stock.
    for p in payload.items:
        balance = get_locked_balance(db, p.item_id, payload.location_id)
        existing_qty = balance.on_hand_qty
        db.add(StoreStockAdjustmentItem(
            adjustment_id=adjustment.id, item_id=p.item_id, existing_quantity=existing_qty,
            actual_quantity=p.actual_quantity, difference=p.actual_quantity - existing_qty, remarks=p.remarks,
        ))

    notify_user(
        db, user_id=approver.id,
        title="Stock Adjustment Awaiting Approval",
        message=f"Stock adjustment {adjustment.adjustment_number} was raised by {user.name or user.email} and awaits your approval before it changes stock.",
        notification_type="stock_adjustment_pending", entity_type="stock_adjustment", entity_id=adjustment.id,
    )

    db.commit()
    db.refresh(adjustment)
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment.id).first()
    return _to_response(db, adjustment)


@router.post("/{adjustment_id}/approve", response_model=StoreStockAdjustmentResponse)
async def approve_stock_adjustment(
    adjustment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    """Posts the adjustment. Each line's stored difference (count minus the
    balance at count time) is applied, rather than re-deriving it from the
    balance now — any receipts/issues since the count are real movements
    and must not be wiped out by the correction."""
    adjustment = _get_pending_for_decision(db, adjustment_id, user, "approve")
    try:
        for line in adjustment.items:
            if line.difference > 0:
                post_stock_transaction(
                    db, item_id=line.item_id, location_id=adjustment.location_id, transaction_type="adjustment_in",
                    quantity=line.difference, reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                    transaction_date=adjustment.adjustment_date, created_by_id=user.id,
                )
            elif line.difference < 0:
                post_stock_transaction(
                    db, item_id=line.item_id, location_id=adjustment.location_id, transaction_type="adjustment_out",
                    quantity=abs(line.difference), reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                    transaction_date=adjustment.adjustment_date, created_by_id=user.id,
                )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Adjustment {adjustment.adjustment_number} can't be posted: {e}")

    adjustment.status = "approved"
    adjustment.approved_by_id = user.id
    adjustment.decided_at = datetime.now(timezone.utc)
    if adjustment.created_by_id:
        notify_user(
            db, user_id=adjustment.created_by_id,
            title="Stock Adjustment Approved",
            message=f"Stock adjustment {adjustment.adjustment_number} was approved by {user.name or user.email} and posted to stock.",
            notification_type="stock_adjustment_approved", entity_type="stock_adjustment", entity_id=adjustment.id,
        )
    db.commit()
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment_id).first()
    return _to_response(db, adjustment)


@router.post("/{adjustment_id}/reject", response_model=StoreStockAdjustmentResponse)
async def reject_stock_adjustment(
    adjustment_id: int,
    payload: StoreStockAdjustmentRejectPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the adjustment, so the store keeper knows what to recount or fix.")
    adjustment = _get_pending_for_decision(db, adjustment_id, user, "reject")
    adjustment.status = "rejected"
    adjustment.approved_by_id = user.id
    adjustment.decided_at = datetime.now(timezone.utc)
    adjustment.rejected_reason = reason
    if adjustment.created_by_id:
        notify_user(
            db, user_id=adjustment.created_by_id,
            title="Stock Adjustment Rejected",
            message=f"Stock adjustment {adjustment.adjustment_number} was rejected by {user.name or user.email}. Reason: {reason}",
            notification_type="stock_adjustment_rejected", entity_type="stock_adjustment", entity_id=adjustment.id,
        )
    db.commit()
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment_id).first()
    return _to_response(db, adjustment)
