from datetime import date, datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core import assignee_rules
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.store.services.approvals import ADJUSTMENT_ENTITY, ADJUSTMENT_KEY, adjustment_default_stages
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_adjustment import StoreStockAdjustment, StoreStockAdjustmentItem
from app.modules.store.schemas.stock_adjustment import (
    StoreStockAdjustmentCreate, StoreStockAdjustmentRejectPayload, StoreStockAdjustmentResponse,
)
from app.modules.store.service import generate_stock_adjustment_number
from app.modules.store.services.stock_ledger import post_stock_transaction, get_locked_balance
from app.utils.notifications import notify_user
from app.core.notification_events import notify_event
from app.modules.store.services.store_events import location_opener, pending_approvers

router = APIRouter(prefix="/store/stock-adjustments", tags=["Store"])
APPROVER_RULE_KEY = "store:adjustments.approver"  # core/assignee_rules.PICKERS


def _post_adjustment(db: Session, adjustment: StoreStockAdjustment, user: User) -> None:
    """Applies each line's stored difference (count minus the balance at
    count time) rather than re-deriving it from the balance now — any
    receipts/issues since the count are real movements and must not be wiped
    out by the correction."""
    for line in adjustment.items:
        if line.difference > 0:
            post_stock_transaction(
                db, item_id=line.item_id, location_id=adjustment.location_id, transaction_type="adjustment_in",
                bin_id=getattr(line, "bin_id", None),
                quantity=line.difference, reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                transaction_date=adjustment.adjustment_date, created_by_id=user.id,
            )
        elif line.difference < 0:
            post_stock_transaction(
                db, item_id=line.item_id, location_id=adjustment.location_id, transaction_type="adjustment_out",
                bin_id=getattr(line, "bin_id", None),
                quantity=abs(line.difference), reference_type="stock_adjustment", reference_number=adjustment.adjustment_number,
                transaction_date=adjustment.adjustment_date, created_by_id=user.id,
            )


# ── Central approval engine ─────────────────────────────────────────────────
# Workflow "store.stock_adjustment" (Organization › Approval Workflows). The
# default stage is the Store Manager the creator names on the adjustment
# (context `approver_id`), who must hold Store › Adjustments › Approve; the
# creator never approves their own. Adjustments raised before the move have
# no engine request and finish on the old named-approver path below.

def _adjustment_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(
        StoreStockAdjustment.id == req.entity_id).first()
    if adjustment is None:
        return
    now = datetime.now(timezone.utc)
    if outcome == "approved":
        try:
            _post_adjustment(db, adjustment, actor)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=f"Adjustment {adjustment.adjustment_number} can't be posted: {e} "
                                                        "Recount or fix the stock first, then approve it again.")
        adjustment.status, adjustment.approved_by_id, adjustment.decided_at = "approved", actor.id, now
    elif outcome in ("rejected", "returned"):
        decided = [s for s in req.steps if s.decided_at and s.comment]
        comment = decided[-1].comment if decided else None
        prefix = "Returned for changes" if outcome == "returned" else None
        adjustment.status, adjustment.approved_by_id, adjustment.decided_at = "rejected", actor.id, now
        adjustment.rejected_reason = ": ".join(x for x in (prefix, comment) if x) or None
    elif outcome == "cancelled":
        adjustment.status, adjustment.decided_at = "cancelled", now
    if outcome in ("approved", "rejected", "returned"):
        # Role event; the creator already hears from the approval engine.
        loc = db.get(StoreLocation, adjustment.location_id)
        verb = {"approved": "approved and posted to stock", "rejected": "rejected", "returned": "returned for changes"}[outcome]
        notify_event(
            db, None, "store", "adjustment_decided",
            title=f"Stock adjustment {adjustment.adjustment_number} {outcome}",
            message=f"Stock adjustment {adjustment.adjustment_number} at {loc.name if loc else 'the store'} was {verb} by "
                    f"{actor.name or actor.email}." + (f" Reason: {adjustment.rejected_reason}" if outcome != "approved" and adjustment.rejected_reason else ""),
            entity_type="stock_adjustment", entity_id=adjustment.id, actor=actor,
            can_open=location_opener(db, adjustment.location_id), skip_user_ids={req.requester_id} - {None},
        )
    # A physical count's differences: approved closes the count; rejected /
    # returned / cancelled puts it back to counting for a recount.
    from app.modules.store.models.physical_count import StorePhysicalCount
    count = db.query(StorePhysicalCount).filter(StorePhysicalCount.adjustment_id == adjustment.id).first()
    if count is not None:
        if outcome == "approved":
            count.status, count.closed_at = "posted", now
        elif outcome in ("rejected", "returned", "cancelled"):
            count.status, count.adjustment_id = "counting", None


engine.register_transaction(engine.TransactionType(
    key=ADJUSTMENT_KEY, module_key="store", subtab_key="adjustments", label="Stock adjustment",
    entity_type=ADJUSTMENT_ENTITY, url="/dashboard/store/adjustments/{id}",
    description="Stock-count correction at one store. Changes book stock only when approved.",
    context_fields={"approver_id": {"label": "Store manager named on the adjustment", "type": "user"}},
    default_stages=adjustment_default_stages(),
    require_permission=True, allow_self_approval=False,
    on_decided=_adjustment_decided,
))


def _engine_decide(db: Session, adjustment_id: int, user: User, decision: str, comment: str | None):
    req = engine.latest_request(db, ADJUSTMENT_ENTITY, adjustment_id)
    if req is None:
        return None
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"This adjustment's approval is already {req.status} — nothing left to decide. Reload the page.")
    # Maker-checker (C-09) holds for admins too: the engine lets an admin
    # stand in for an approver, but never on their own document.
    if decision == "approve" and req.requester_id == user.id and not engine.ensure_workflow(db, ADJUSTMENT_KEY).allow_self_approval:
        raise HTTPException(status_code=403, detail=f"You raised {req.reference or 'this adjustment'}, so you can't approve it — someone else has to (four-eyes rule).")
    try:
        engine.decide(db, req.id, user, decision, comment)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment_id).first()
    return _to_response(db, adjustment)


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
    user: User = Depends(require_tab_access("store", "adjustments")),
):
    # Data scope; the approver of an adjustment sees it whatever their scope.
    query = apply_scope(db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)), user, StoreStockAdjustment)
    if location_id is not None:
        query = query.filter(StoreStockAdjustment.location_id == location_id)
    adjustments = query.order_by(StoreStockAdjustment.created_at.desc()).all()
    return [_to_response(db, a) for a in adjustments]


@router.get("/{adjustment_id}", response_model=StoreStockAdjustmentResponse)
async def get_stock_adjustment(
    adjustment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "adjustments")),
):
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment_id).first()
    if not adjustment:
        raise HTTPException(status_code=404, detail="Stock adjustment not found")
    if adjustment.approved_by_id != user.id:
        ensure_in_scope(db, user, adjustment)
    return _to_response(db, adjustment)


@router.post("", response_model=StoreStockAdjustmentResponse)
async def create_stock_adjustment(
    payload: StoreStockAdjustmentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "adjustments", "create")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if payload.adjustment_date and payload.adjustment_date > date.today():
        raise HTTPException(status_code=422, detail=f"Adjustment date {payload.adjustment_date.isoformat()} is in the future — stock can only be posted for today or earlier.")
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Store not found")
    ensure_location_allowed(db, user, payload.location_id)
    if payload.approved_by_id == user.id:
        raise HTTPException(status_code=400, detail="You can't approve your own stock adjustment — pick a different approver.")
    approver = db.query(User).filter(User.id == payload.approved_by_id, User.is_active == True).first()  # noqa: E712
    if not approver:
        raise HTTPException(status_code=400, detail="The selected approver was not found or is no longer active — pick another user.")
    if "store" not in approver.get_apps():
        raise HTTPException(status_code=400, detail=f"{approver.name or approver.email} doesn't have access to the Store module, so they couldn't open this adjustment to approve it — pick a Store user, or ask an admin to grant them Store access.")
    # C-09: an adjustment rewrites book stock, so it is signed off by a Store
    # Manager — the Store Manager flag on the user, or this store's own manager.
    if not (approver.is_store_manager or (location.manager_user_id and location.manager_user_id == approver.id)):
        raise HTTPException(status_code=400, detail=f"{approver.name or approver.email} isn't a Store Manager, so they can't approve stock adjustments — pick a Store Manager (or {location.name}'s own manager), or ask an admin to tick 'Store Manager' on their user in Admin → Users.")
    # The role's assign-to rule (Role & Permissions › Store › Adjustments › Name the approving Store Manager).
    assignee_rules.ensure_allowed(db, user, APPROVER_RULE_KEY, approver)

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    seen: set[int] = set()
    for p in payload.items:
        # Each line's difference is taken against the same live balance, so a
        # repeated item would post its correction twice.
        if p.item_id in seen:
            name = items_by_id[p.item_id].item_name if p.item_id in items_by_id else f"Item {p.item_id}"
            raise HTTPException(status_code=422, detail=f"'{name}' is listed more than once — enter its counted quantity on one line only.")
        seen.add(p.item_id)
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

    db.flush()
    try:
        req = engine.submit(
            db, ADJUSTMENT_KEY, entity_id=adjustment.id, requester=user,
            title=f"Stock adjustment {adjustment.adjustment_number} — {location.name}", reference=adjustment.adjustment_number,
            context={"approver_id": approver.id}, branch_id=location.branch_id,
        )
    except HTTPException:
        db.rollback()
        raise
    if req.status == "pending":
        notify_event(
            db, background_tasks, "store", "adjustment_submitted",
            title=f"Stock adjustment {adjustment.adjustment_number} waiting for approval",
            message=f"{user.name or user.email} raised stock adjustment {adjustment.adjustment_number} at {location.name} "
                    f"({len(payload.items)} line(s)). Book stock changes only once it is approved — open it in Store › Adjustments.",
            entity_type="stock_adjustment", entity_id=adjustment.id, actor=user,
            can_open=location_opener(db, location.id), skip_user_ids=pending_approvers(req),
        )
    db.commit()
    db.refresh(adjustment)
    adjustment = db.query(StoreStockAdjustment).options(selectinload(StoreStockAdjustment.items)).filter(StoreStockAdjustment.id == adjustment.id).first()
    return _to_response(db, adjustment)


@router.post("/{adjustment_id}/approve", response_model=StoreStockAdjustmentResponse)
async def approve_stock_adjustment(
    adjustment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "adjustments", "approve")),
):
    """Posts the adjustment (see _post_adjustment). Adjustments on the central
    engine are decided there; this forwards to it."""
    out = _engine_decide(db, adjustment_id, user, "approve", None)
    if out is not None:
        return out
    adjustment = _get_pending_for_decision(db, adjustment_id, user, "approve")
    try:
        _post_adjustment(db, adjustment, user)
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
    user: User = Depends(require_tab_action("store", "adjustments", "reject")),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the adjustment, so the store keeper knows what to recount or fix.")
    out = _engine_decide(db, adjustment_id, user, "reject", reason)
    if out is not None:
        return out
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
