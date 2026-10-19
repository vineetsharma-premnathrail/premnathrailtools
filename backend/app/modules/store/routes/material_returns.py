from datetime import date, datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_tab_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.store.services.approvals import (
    RETURN_ENTITY, RETURN_KEY, ensure_return_workflow, return_context_fields, return_default_stages,
)
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.store.models.doc_type import StoreDocType
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import (
    StoreMaterialReturn,
    StoreMaterialReturnApproval,
    StoreMaterialReturnItem,
)
from app.modules.store.routes.doc_types import doc_type_labels, doc_types, get_doc_type
from app.modules.store.schemas.material_return import StoreMaterialReturnCreate, StoreMaterialReturnResponse
from app.modules.store.service import generate_material_return_number
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.utils.notifications import notify_user
from app.core.notification_events import notify_event
from app.modules.store.services.store_events import location_opener, pending_approvers

router = APIRouter(prefix="/store/material-returns", tags=["Store"])

RULE_LABELS = {
    "warehouse_manager": "Store in-charge",
    "department_head": "Department head",
    "specific_users": "Designated approver",
}


class RejectPayload(BaseModel):
    reason: str


class ApprovePayload(BaseModel):
    comment: str | None = None


def _load(db: Session, return_id: int, lock: bool = False) -> StoreMaterialReturn | None:
    q = db.query(StoreMaterialReturn).options(
        selectinload(StoreMaterialReturn.items), selectinload(StoreMaterialReturn.approvals)
    ).filter(StoreMaterialReturn.id == return_id)
    return (q.with_for_update() if lock else q).first()


def _to_response(db: Session, ret: StoreMaterialReturn, viewer: User | None = None) -> StoreMaterialReturnResponse:
    location = db.query(StoreLocation).filter(StoreLocation.id == ret.location_id).first()
    source_issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == ret.source_issue_id).first() if ret.source_issue_id else None
    department = db.query(Department).filter(Department.id == ret.department_id).first() if ret.department_id else None
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in ret.items])).all()} if ret.items else {}
    user_ids = {ret.returned_by_id} | {a.acted_by_id for a in ret.approvals} | {u for a in ret.approvals for u in (a.approver_user_ids or [])}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids - {None})).all()}
    name = lambda uid: (users[uid].name or users[uid].email) if uid in users else None  # noqa: E731
    sources = doc_type_labels(db, "return_source")
    conditions = doc_type_labels(db, "return_condition")

    resp = StoreMaterialReturnResponse.model_validate(ret)
    resp.location_name = location.name if location else None
    resp.source_issue_number = source_issue.issue_number if source_issue else None
    resp.source_type_label = sources.get(ret.source_type, ret.source_type)
    resp.department_name = department.name if department else None
    resp.returned_by_name = name(ret.returned_by_id)
    for line, item_resp in zip(ret.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
        item_resp.condition_label = conditions.get(line.condition, line.condition)
    for a, a_resp in zip(ret.approvals, resp.approvals):
        a_resp.approver_names = [n for n in (name(u) for u in a.approver_user_ids or []) if n]
        a_resp.acted_by_name = name(a.acted_by_id)
    if viewer and ret.approvals:  # returns raised before the central approval engine (old approval steps)
        resp.can_act = ret.status == "pending_approval" and viewer.id != ret.returned_by_id and any(
            a.status == "pending" and (viewer.id in (a.approver_user_ids or []) or viewer.role == "admin") for a in ret.approvals
        )
    return resp


def _department_heads(dept: Department) -> list[int]:
    ids = [dept.head_user_id, dept.secondary_head_user_id, *(dept.additional_head_user_ids or [])]
    return list(dict.fromkeys(i for i in ids if i))


# ── Central approval engine ─────────────────────────────────────────────────
# A return is submitted to the engine (workflow "store.material_return",
# Organization › Approval Workflows); the engine calls _return_decided when it
# finishes. Returns raised before the move keep their
# StoreMaterialReturnApproval steps and finish on the old path below
# (engine.latest_request(...) is None for them).

def _last_comment(req: ApprovalRequest) -> str | None:
    decided = [s for s in req.steps if s.decided_at and s.comment]
    return decided[-1].comment if decided else None


def _return_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    ret = db.query(StoreMaterialReturn).filter(StoreMaterialReturn.id == req.entity_id).first()
    if ret is None:
        return
    now = datetime.now(timezone.utc)
    if outcome == "approved":
        try:
            _post_return(db, ret, actor)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=f"Return {ret.return_number} can't be posted to stock: {e} "
                                                        "Fix the stock problem first, then approve it again.")
        ret.status, ret.decided_at = "approved", now
    elif outcome in ("rejected", "returned"):
        comment = _last_comment(req)
        prefix = "Returned for changes" if outcome == "returned" else None
        ret.status, ret.decided_at = "rejected", now
        ret.rejected_reason = ": ".join(x for x in (prefix, comment) if x) or None
    elif outcome == "cancelled":
        ret.status, ret.decided_at = "cancelled", now
    if outcome in ("approved", "rejected", "returned"):
        # Role event; the person who raised it already hears from the approval engine.
        loc = db.get(StoreLocation, ret.location_id)
        verb = {"approved": "approved and posted to stock", "rejected": "rejected", "returned": "returned for changes"}[outcome]
        notify_event(
            db, None, "store", "return_decided",
            title=f"Material return {ret.return_number} {outcome}",
            message=f"Material return {ret.return_number} at {loc.name if loc else 'the store'} was {verb} by {actor.name or actor.email}."
                    + (f" Reason: {ret.rejected_reason}" if outcome != "approved" and ret.rejected_reason else ""),
            entity_type="material_return", entity_id=ret.id, actor=actor,
            can_open=location_opener(db, ret.location_id), skip_user_ids={req.requester_id} - {None},
        )


def _engine_party(db: Session, user: User, return_id: int) -> bool:
    """Approver (or decider) on any of this return's engine requests, or able to act on it now (delegate)."""
    hit = db.query(ApprovalRequestStep.id).join(ApprovalRequest, ApprovalRequest.id == ApprovalRequestStep.request_id).filter(
        ApprovalRequest.entity_type == RETURN_ENTITY, ApprovalRequest.entity_id == return_id,
        (ApprovalRequestStep.approver_id == user.id) | (ApprovalRequestStep.decided_by_id == user.id),
    ).first()
    return hit is not None or engine.can_act_on_entity(db, user, RETURN_ENTITY, return_id)


def _return_context(source: StoreDocType, conditions: dict[str, StoreDocType], location: StoreLocation,
                    department: Department | None) -> dict:
    ctx = {
        "source_type": source.value,
        "warehouse_manager_id": location.manager_user_id,
        "department_head_ids": _department_heads(department) if department else [],
    }
    for field in return_context_fields():
        if field.startswith("condition_"):
            ctx[field] = field[len("condition_"):] in conditions
    return ctx


def _missing_approver_hints(ctx: dict, location: StoreLocation, department: Department | None, user: User) -> list[str]:
    """Why the engine found nobody to approve — added to its 422."""
    hints = []
    if not ctx["warehouse_manager_id"]:
        hints.append(f"Store '{location.name}' has no manager set — set one under Store › Settings › Stores.")
    elif ctx["warehouse_manager_id"] == user.id:
        hints.append(f"You are the manager of '{location.name}' and can't approve your own return — have someone else raise it, "
                     "or ask an admin to change the stage in Organization › Approval Workflows › Material return.")
    if ctx.get("condition_damaged"):
        if not department:
            hints.append("Pick the Department the material was issued to — its head approves damaged material.")
        elif not ctx["department_head_ids"]:
            hints.append(f"Department '{department.name}' has no head set — set one under Organization › Departments.")
    return hints


def _post_return(db: Session, ret: StoreMaterialReturn, user: User) -> None:
    """Posts every line: usable conditions back to on-hand stock, quarantine
    conditions to the warehouse's quarantine bucket."""
    effects = {t.value: t.stock_effect for t in doc_types(db, "return_condition")}
    # Job work receipt (Quality Phase 2): usable material coming back against
    # an issue to an outside vendor goes to QUALITY stock under a job work
    # inspection lot when the item is inspection-controlled.
    from app.modules.quality.services.lots import needs_job_work_inspection, create_lot_for_job_work_receipt, LotError
    source_issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == ret.source_issue_id).first() if ret.source_issue_id else None
    job_work_vendor = source_issue.vendor_name if source_issue and source_issue.vendor_name else None
    # Store job work: the challan put the material in With-vendor stock, so it
    # comes back out of it (value-neutral) instead of being received afresh.
    from app.modules.store.services.job_work import posted_to_vendor
    from_vendor = posted_to_vendor(db, source_issue)
    for line in ret.items:
        if job_work_vendor and effects.get(line.condition) != "quarantine":
            item = db.query(StoreItem).filter(StoreItem.id == line.item_id).first()
            if needs_job_work_inspection(db, item):
                try:
                    create_lot_for_job_work_receipt(
                        db, material_return=ret, line=line, item=item, vendor_name=job_work_vendor,
                        issue_number=source_issue.issue_number, user_id=user.id, from_vendor_stock=from_vendor)
                except LotError as e:
                    raise ValueError(str(e))
                continue
        quarantine = effects.get(line.condition) == "quarantine"
        if line.serial_numbers:
            from app.modules.store.services.serials import return_units
            return_units(db, line.item_id, line.serial_numbers, location_id=ret.location_id, bin_id=line.bin_id,
                         blocked=quarantine, reference_number=ret.return_number, user_id=user.id, event_date=ret.return_date)
        post_stock_transaction(
            db, item_id=line.item_id, location_id=ret.location_id, bin_id=line.bin_id,
            transaction_type=("jobwork_to_blocked" if quarantine else "jobwork_in") if from_vendor
            else ("quarantine_in" if quarantine else "return_in"),
            quantity=line.quantity, batch_number=line.batch_number, reference_type="material_return",
            reference_number=ret.return_number, transaction_date=ret.return_date, created_by_id=user.id,
        )


engine.register_transaction(engine.TransactionType(
    key=RETURN_KEY, module_key="store", subtab_key="returns", label="Material return",
    entity_type=RETURN_ENTITY, url="/dashboard/store/returns/{id}",
    description="Unused / damaged / rejected material coming back into a store. Posts to stock only when approved.",
    context_fields=return_context_fields(),
    default_stages=return_default_stages(),
    # Department heads approve without holding any Store grant (as before).
    require_permission=False, allow_self_approval=False,
    on_decided=_return_decided,
))


@router.get("", response_model=list[StoreMaterialReturnResponse])
async def list_material_returns(
    location_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "returns")),
):
    query = db.query(StoreMaterialReturn).options(selectinload(StoreMaterialReturn.items), selectinload(StoreMaterialReturn.approvals))
    query = apply_scope(query, user, StoreMaterialReturn)
    if location_id is not None:
        query = query.filter(StoreMaterialReturn.location_id == location_id)
    if status:
        query = query.filter(StoreMaterialReturn.status == status)
    returns = query.order_by(StoreMaterialReturn.created_at.desc()).all()
    return [_to_response(db, r, user) for r in returns]


@router.get("/{return_id}", response_model=StoreMaterialReturnResponse)
async def get_material_return(
    return_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Store users within their data scope, plus anyone who is (or was) an
    approver of this return (a department head often has no Store access but
    must review it)."""
    ret = _load(db, return_id)
    if not ret:
        raise HTTPException(status_code=404, detail="Material return not found")
    is_approver = any(user.id in (a.approver_user_ids or []) for a in ret.approvals) or _engine_party(db, user, ret.id)
    if not is_approver:
        ensure_tab_action(user, "store", "returns", "view")
        ensure_in_scope(db, user, ret)
    return _to_response(db, ret, user)


@router.post("", response_model=StoreMaterialReturnResponse)
async def create_material_return(
    payload: StoreMaterialReturnCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "returns", "create")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="Add at least one item to return.")
    if payload.return_date and payload.return_date > date.today():
        raise HTTPException(status_code=422, detail=f"Return date {payload.return_date.isoformat()} is in the future — stock can only be posted for today or earlier.")
    source = get_doc_type(db, "return_source", payload.source_type, field="return source")
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Store not found")
    ensure_location_allowed(db, user, location.id)
    if source.requires_issue and not payload.source_issue_id:
        raise HTTPException(status_code=422, detail=f"'{source.label}' needs the Material Issue the material came from — pick it in the Material Issue field.")
    source_issue = None
    if payload.source_issue_id:
        # Locked so two returns raised at once against the same issue can't
        # both pass the returnable-quantity check below.
        source_issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == payload.source_issue_id).with_for_update().first()
        if not source_issue:
            raise HTTPException(status_code=404, detail="Source material issue not found")
        if source_issue.location_id != location.id:
            issued_from = db.query(StoreLocation).filter(StoreLocation.id == source_issue.location_id).first()
            raise HTTPException(
                status_code=422,
                detail=f"Issue {source_issue.issue_number} was issued from '{issued_from.name if issued_from else 'another store'}', not '{location.name}' — return it to the store it came from, or pick an issue from this store.",
            )
        if payload.return_date and source_issue.issue_date and payload.return_date < source_issue.issue_date:
            raise HTTPException(status_code=422, detail=f"Return date {payload.return_date.isoformat()} is before issue {source_issue.issue_number} was made ({source_issue.issue_date.isoformat()}) — material can't come back before it went out. Check the date.")

    department_id = payload.department_id or (source_issue.department_id if source_issue else None)
    department = db.query(Department).filter(Department.id == department_id).first() if department_id else None
    if department_id and not department:
        raise HTTPException(status_code=404, detail="Department not found")

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    conditions: dict[str, StoreDocType] = {}
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Quantity for '{items_by_id[p.item_id].item_name}' must be greater than zero")
        if p.condition not in conditions:
            conditions[p.condition] = get_doc_type(db, "return_condition", p.condition, field="condition")

    # A return against a specific issue can only return what that issue
    # actually issued, per item, net of what's already been returned against
    # it (rejected returns don't count — that material never came back).
    if payload.source_issue_id:
        issued_qty_by_item: dict[int, float] = {}
        for issue_item in db.query(StoreMaterialIssueItem).filter(StoreMaterialIssueItem.issue_id == payload.source_issue_id).all():
            issued_qty_by_item[issue_item.item_id] = issued_qty_by_item.get(issue_item.item_id, 0.0) + issue_item.quantity

        already_returned_by_item: dict[int, float] = dict(
            db.query(StoreMaterialReturnItem.item_id, func.sum(StoreMaterialReturnItem.quantity))
            .join(StoreMaterialReturn, StoreMaterialReturnItem.return_id == StoreMaterialReturn.id)
            .filter(StoreMaterialReturn.source_issue_id == payload.source_issue_id,
                    StoreMaterialReturn.status.notin_(("rejected", "cancelled")))
            .group_by(StoreMaterialReturnItem.item_id)
            .all()
        )
        # Job work: material the vendor used up (Job Work Receipt) can't come back either.
        from app.modules.store.models.job_work import StoreJobWorkReceiptComponent
        for item_id, used in (db.query(StoreJobWorkReceiptComponent.item_id, func.sum(StoreJobWorkReceiptComponent.consumed_quantity
                                                                                      + StoreJobWorkReceiptComponent.scrap_quantity))
                              .join(StoreMaterialIssueItem, StoreJobWorkReceiptComponent.issue_item_id == StoreMaterialIssueItem.id)
                              .filter(StoreMaterialIssueItem.issue_id == payload.source_issue_id)
                              .group_by(StoreJobWorkReceiptComponent.item_id).all()):
            already_returned_by_item[item_id] = already_returned_by_item.get(item_id, 0.0) + float(used or 0)
        requested: dict[int, float] = {}
        for p in payload.items:
            requested[p.item_id] = requested.get(p.item_id, 0.0) + p.quantity
        for item_id, qty in requested.items():
            item_name = items_by_id[item_id].item_name
            issued = issued_qty_by_item.get(item_id, 0.0)
            if issued <= 0:
                raise HTTPException(status_code=422, detail=f"Item '{item_name}' was not part of issue {source_issue.issue_number}.")
            already_returned = already_returned_by_item.get(item_id, 0.0)
            if already_returned + qty - issued > 1e-9:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Cannot return {qty} of '{item_name}' — only {issued} was issued and {already_returned} "
                        f"already returned against {source_issue.issue_number} ({issued - already_returned} returnable)."
                    ),
                )

    ret = StoreMaterialReturn(
        return_number=generate_material_return_number(db),
        location_id=payload.location_id,
        source_type=source.value,
        source_issue_id=payload.source_issue_id,
        source_description=payload.source_description,
        department_id=department_id,
        reason=payload.reason,
        return_date=payload.return_date or date.today(),
        returned_by_id=user.id,
        remarks=payload.remarks,
        status="pending_approval",
    )
    db.add(ret)
    db.flush()
    # WM bin + serial numbers (IQ01): the bin must be of this store; the
    # serials must be units that are out on issue (from this issue, if named).
    from app.modules.store.services.bins import BinError, validate_bin
    from app.modules.store.services.serials import SerialError, check_return
    line_serials = []
    try:
        for p in payload.items:
            validate_bin(db, p.bin_id, payload.location_id, what=f"'{items_by_id[p.item_id].item_name}'")
            line_serials.append(check_return(db, items_by_id[p.item_id], p.quantity, p.serials, payload.source_issue_id))
    except (BinError, SerialError) as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    for p, serials in zip(payload.items, line_serials):
        ret.items.append(StoreMaterialReturnItem(
            item_id=p.item_id, quantity=p.quantity, condition=p.condition, batch_number=p.batch_number, remarks=p.remarks,
            bin_id=p.bin_id, serial_numbers=serials or None,
        ))
    db.flush()

    # Routed by the central approval engine. A return whose source and
    # conditions need nobody's approval matches no stage and is approved (and
    # posted, via _return_decided) at once.
    ensure_return_workflow(db)
    ctx = _return_context(source, conditions, location, department)
    try:
        req = engine.submit(
            db, RETURN_KEY, entity_id=ret.id, requester=user, title=f"Material return {ret.return_number} — {location.name}",
            reference=ret.return_number, context=ctx, branch_id=location.branch_id,
        )
    except HTTPException as e:
        db.rollback()
        if e.status_code == 422:
            hints = _missing_approver_hints(ctx, location, department, user)
            raise HTTPException(status_code=422, detail=" ".join([str(e.detail), *hints]))
        raise
    if req.status == "pending":
        notify_event(
            db, background_tasks, "store", "return_submitted",
            title=f"Material return {ret.return_number} waiting for approval",
            message=f"{user.name or user.email} raised material return {ret.return_number} at {location.name} ({len(payload.items)} line(s)). "
                    "It posts to stock once approved — open it in Store › Returns.",
            entity_type="material_return", entity_id=ret.id, actor=user,
            can_open=location_opener(db, location.id), skip_user_ids=pending_approvers(req),
        )
    db.commit()
    return _to_response(db, _load(db, ret.id), user)


# Approve / reject: returns on the central engine are decided there (the
# ApprovalPanel calls /approvals/requests/{id}/decide; these endpoints just
# forward to it). Returns raised before the move finish on their old
# StoreMaterialReturnApproval steps, decided by the approvers named on each
# step (store in-charge, department head, designated users).
def _engine_decide(db: Session, return_id: int, user: User, decision: str, comment: str | None):
    req = engine.latest_request(db, RETURN_ENTITY, return_id)
    if req is None:
        return None
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"This return's approval is already {req.status} — nothing left to decide. Reload the page.")
    # Maker-checker (C-09) holds for admins too: the engine lets an admin
    # stand in for an approver, but never on their own document.
    if decision == "approve" and req.requester_id == user.id and not engine.ensure_workflow(db, RETURN_KEY).allow_self_approval:
        raise HTTPException(status_code=403, detail=f"You raised {req.reference or 'this return'}, so you can't approve it — someone else has to (four-eyes rule).")
    try:
        engine.decide(db, req.id, user, decision, comment)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    return _to_response(db, _load(db, return_id), user)


def _pending_step_for(db: Session, return_id: int, user: User, verb: str) -> tuple[StoreMaterialReturn, StoreMaterialReturnApproval]:
    ret = _load(db, return_id, lock=True)
    if not ret:
        raise HTTPException(status_code=404, detail="Material return not found")
    if ret.status != "pending_approval":
        raise HTTPException(status_code=409, detail=f"Return {ret.return_number} has already been {ret.status.replace('_', ' ')} — it can't be {verb}d again.")
    if ret.returned_by_id == user.id:
        raise HTTPException(status_code=403, detail=f"You raised return {ret.return_number}, so you can't {verb} it — one of its approvers must.")
    pending = [a for a in ret.approvals if a.status == "pending"]
    step = next((a for a in pending if user.id in (a.approver_user_ids or [])), None)
    if not step and user.role == "admin" and pending:
        step = pending[0]
    if not step:
        raise HTTPException(status_code=403, detail=f"You're not an approver on any pending step of return {ret.return_number}.")
    return ret, step


@router.post("/{return_id}/approve", response_model=StoreMaterialReturnResponse)
async def approve_material_return(
    return_id: int,
    payload: ApprovePayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Approves the caller's pending step. When it was the last one, the
    return posts to stock (usable → on-hand, quarantine → quarantine bucket)."""
    out = _engine_decide(db, return_id, user, "approve", payload.comment if payload else None)
    if out is not None:
        return out
    ret, step = _pending_step_for(db, return_id, user, "approve")
    step.status, step.acted_by_id, step.acted_at = "approved", user.id, datetime.now(timezone.utc)
    if all(a.status == "approved" for a in ret.approvals):
        try:
            _post_return(db, ret, user)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Return {ret.return_number} can't be posted: {e}")
        ret.status, ret.decided_at = "approved", datetime.now(timezone.utc)
        if ret.returned_by_id:
            notify_user(
                db, user_id=ret.returned_by_id,
                title="Material Return Approved",
                message=f"Material return {ret.return_number} was approved and posted to stock.",
                notification_type="material_return_approved", entity_type="material_return", entity_id=ret.id,
            )
    db.commit()
    return _to_response(db, _load(db, return_id), user)


@router.post("/{return_id}/reject", response_model=StoreMaterialReturnResponse)
async def reject_material_return(
    return_id: int,
    payload: RejectPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the return, so the store keeper knows what to fix.")
    out = _engine_decide(db, return_id, user, "reject", reason)
    if out is not None:
        return out
    ret, step = _pending_step_for(db, return_id, user, "reject")
    now = datetime.now(timezone.utc)
    step.status, step.acted_by_id, step.acted_at, step.comment = "rejected", user.id, now, reason
    ret.status, ret.decided_at, ret.rejected_reason = "rejected", now, reason
    if ret.returned_by_id:
        notify_user(
            db, user_id=ret.returned_by_id,
            title="Material Return Rejected",
            message=f"Material return {ret.return_number} was rejected by {user.name or user.email}. Reason: {reason}",
            notification_type="material_return_rejected", entity_type="material_return", entity_id=ret.id,
        )
    db.commit()
    return _to_response(db, _load(db, return_id), user)
