from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.department import Department
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

router = APIRouter(prefix="/store/material-returns", tags=["Store"])

RULE_LABELS = {
    "warehouse_manager": "Store in-charge",
    "department_head": "Department head",
    "specific_users": "Designated approver",
}


class RejectPayload(BaseModel):
    reason: str


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
    if viewer:
        resp.can_act = ret.status == "pending_approval" and viewer.id != ret.returned_by_id and any(
            a.status == "pending" and (viewer.id in (a.approver_user_ids or []) or viewer.role == "admin") for a in ret.approvals
        )
    return resp


def _department_heads(dept: Department) -> list[int]:
    ids = [dept.head_user_id, dept.secondary_head_user_id, *(dept.additional_head_user_ids or [])]
    return list(dict.fromkeys(i for i in ids if i))


def _resolve_approvers(
    db: Session, t: StoreDocType, *, location: StoreLocation, department: Department | None, creator: User,
) -> list[int]:
    """User ids allowed to approve for one source/condition type, minus the
    creator (maker-checker). Raises a 422 that says exactly what to set up
    when nobody is left to approve."""
    if t.approver_rule == "warehouse_manager":
        ids = [location.manager_user_id] if location.manager_user_id else []
        missing = f"Store '{location.name}' has no manager set — set one under Store → Settings → Stores."
    elif t.approver_rule == "department_head":
        if not department:
            raise HTTPException(status_code=422, detail=f"'{t.label}' needs the department head's approval — pick the Department the material was issued to.")
        ids = _department_heads(department)
        missing = f"Department '{department.name}' has no head set — set one under Organization → Departments."
    else:  # specific_users
        # Return Sources / Conditions are no longer editable in Settings, so
        # a type with no designated approvers falls back to the store manager.
        ids = list(t.approver_user_ids or []) or ([location.manager_user_id] if location.manager_user_id else [])
        missing = f"'{t.label}' needs the store manager's approval, but Store '{location.name}' has no manager set — set one under Store → Settings → Stores."
    if not ids:
        raise HTTPException(status_code=422, detail=missing)
    others = [i for i in ids if i != creator.id]
    if not others:
        raise HTTPException(
            status_code=422,
            detail=f"You are the only approver for '{t.label}', and you can't approve your own return. Ask an admin to set another approver (store manager under Store → Settings → Stores, or department head under Organization → Departments), or have someone else raise this return.",
        )
    return others


def _post_return(db: Session, ret: StoreMaterialReturn, user: User) -> None:
    """Posts every line: usable conditions back to on-hand stock, quarantine
    conditions to the warehouse's quarantine bucket."""
    effects = {t.value: t.stock_effect for t in doc_types(db, "return_condition")}
    for line in ret.items:
        post_stock_transaction(
            db, item_id=line.item_id, location_id=ret.location_id,
            transaction_type="quarantine_in" if effects.get(line.condition) == "quarantine" else "return_in",
            quantity=line.quantity, batch_number=line.batch_number, reference_type="material_return",
            reference_number=ret.return_number, transaction_date=ret.return_date, created_by_id=user.id,
        )


@router.get("", response_model=list[StoreMaterialReturnResponse])
async def list_material_returns(
    location_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreMaterialReturn).options(selectinload(StoreMaterialReturn.items), selectinload(StoreMaterialReturn.approvals))
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
    """Store users, plus anyone named as an approver on this return (a
    department head often has no Store access but must review it)."""
    ret = _load(db, return_id)
    if not ret:
        raise HTTPException(status_code=404, detail="Material return not found")
    is_approver = any(user.id in (a.approver_user_ids or []) for a in ret.approvals)
    if "store" not in user.get_apps() and not is_approver:
        raise HTTPException(status_code=403, detail="You need Store access, or to be an approver on this return, to view it.")
    return _to_response(db, ret, user)


@router.post("", response_model=StoreMaterialReturnResponse)
async def create_material_return(
    payload: StoreMaterialReturnCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="Add at least one item to return.")
    source = get_doc_type(db, "return_source", payload.source_type, field="return source")
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Store not found")
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
            .filter(StoreMaterialReturn.source_issue_id == payload.source_issue_id, StoreMaterialReturn.status != "rejected")
            .group_by(StoreMaterialReturnItem.item_id)
            .all()
        )
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

    # One approval step per distinct approver group; types that resolve to
    # the same people share a step, labelled with every reason it's needed.
    steps: dict[tuple[str, tuple[int, ...]], dict] = {}
    for t in [source, *conditions.values()]:
        if t.approver_rule == "none":
            continue
        ids = _resolve_approvers(db, t, location=location, department=department, creator=user)
        step = steps.setdefault((t.approver_rule, tuple(sorted(ids))), {"rule": t.approver_rule, "ids": ids, "reasons": []})
        step["reasons"].append(t.label)

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
        status="pending_approval" if steps else "approved",
    )
    db.add(ret)
    db.flush()
    for p in payload.items:
        ret.items.append(StoreMaterialReturnItem(
            item_id=p.item_id, quantity=p.quantity, condition=p.condition, batch_number=p.batch_number, remarks=p.remarks,
        ))
    for step in steps.values():
        ret.approvals.append(StoreMaterialReturnApproval(
            rule=step["rule"], label=f"{RULE_LABELS[step['rule']]} — {', '.join(step['reasons'])}",
            approver_user_ids=step["ids"], status="pending",
        ))
    db.flush()

    if steps:
        for uid in {u for s in steps.values() for u in s["ids"]}:
            notify_user(
                db, user_id=uid,
                title="Material Return Awaiting Approval",
                message=f"Material return {ret.return_number} was raised by {user.name or user.email} and awaits your approval before it changes stock.",
                notification_type="material_return_pending", entity_type="material_return", entity_id=ret.id,
                teams=True,
            )
    else:
        ret.decided_at = datetime.now(timezone.utc)
        try:
            _post_return(db, ret, user)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(e))

    db.commit()
    return _to_response(db, _load(db, ret.id), user)


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
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Approves the caller's pending step. When it was the last one, the
    return posts to stock (usable → on-hand, quarantine → quarantine bucket)."""
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
