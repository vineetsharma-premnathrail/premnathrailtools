"""HR & Administration — joiner / mover / leaver events, checklist items and templates.

Owner: Agent B. HR-management endpoints use `Depends(require_hr)`;
self-service endpoints use `Depends(get_current_user)` (see
app/modules/hr/services/access.py). Checklist item owners who don't have
the hr app (IT, store, the new manager…) can still see the event they have
a task on and mark their own items done. Business logic lives in
app/modules/hr/services/lifecycle.py."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.db.session import get_db
from app.modules.hr.models.employee_profile import HrEmployeeProfile, EMPLOYMENT_TYPES
from app.modules.hr.models.lifecycle import (
    HrChecklistItem, HrChecklistTemplate, HrLifecycleEvent,
    LIFECYCLE_EVENT_TYPES, LIFECYCLE_STATUSES, EXIT_TYPES, CHECKLIST_CATEGORIES, CHECKLIST_ITEM_STATUSES,
)
from app.modules.hr.models.masters import HrDesignation, HrGrade
from app.modules.hr.schemas.checklist_template import (
    HrChecklistTemplateCreate, HrChecklistTemplateUpdate, HrChecklistTemplateResponse,
)
from app.modules.hr.schemas.lifecycle import (
    HrChecklistItemCreate, HrChecklistItemUpdate, HrChecklistItemResponse, HrChecklistTaskResponse,
    HrLifecycleEventCreate, HrLifecycleEventUpdate, HrLifecycleEventCancelPayload,
    HrLifecycleEventLinkUserPayload, HrLifecycleEventCompletePayload, HrLifecycleEventResponse,
)
from app.modules.hr.services import lifecycle as svc
from app.modules.hr.services.access import is_hr, require_hr
from app.modules.hr.services.exit_guard import is_exited
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/lifecycle", tags=["HR"])

OPEN_STATUSES = ("draft", "in_progress")
CATEGORY_LABELS = {"hr": "HR", "it": "IT", "admin": "Admin", "finance": "Finance", "manager": "Manager", "store": "Store"}


# ── Helpers ─────────────────────────────────────────────────────────────

def _get_event(db: Session, event_id: int) -> HrLifecycleEvent:
    ev = db.get(HrLifecycleEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail=f"Lifecycle event #{event_id} doesn't exist — it may have been removed. Go back to HR > Lifecycle and open it from the list.")
    return ev


def _ensure_open(ev: HrLifecycleEvent, what: str = "changed") -> None:
    if ev.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"{ev.event_no} is {ev.status}, so it can't be {what}. Raise a new lifecycle event if something else needs to change.",
        )


def _validate_choice(value: str | None, allowed, field: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(status_code=400, detail=f"'{value}' isn't a valid {field}. Use one of: {', '.join(allowed)}.")


def _is_owner_of_any(db: Session, ev: HrLifecycleEvent, user: User) -> bool:
    return any(i.owner_user_id == user.id for i in ev.items)


def _item_response(item: HrChecklistItem, names: dict[int, str], user: User, hr: bool, event_open: bool) -> HrChecklistItemResponse:
    resp = HrChecklistItemResponse.model_validate(item)
    resp.owner_name = names.get(item.owner_user_id) if item.owner_user_id else None
    resp.done_by_name = names.get(item.done_by_id) if item.done_by_id else None
    resp.can_edit = event_open and (hr or item.owner_user_id == user.id)
    return resp


def _lookup_names(db: Session, events: list[HrLifecycleEvent]) -> dict[str, dict[int, str]]:
    user_ids, dept_ids, branch_ids, desig_ids, grade_ids = set(), set(), set(), set(), set()
    for e in events:
        user_ids |= {e.user_id, e.from_manager_id, e.to_manager_id, e.handover_to_id, e.created_by_id, e.completed_by_id}
        dept_ids |= {e.from_department_id, e.to_department_id}
        branch_ids |= {e.from_branch_id, e.to_branch_id}
        desig_ids |= {e.from_designation_id, e.to_designation_id}
        grade_ids |= {e.from_grade_id, e.to_grade_id}
    for s in (user_ids, dept_ids, branch_ids, desig_ids, grade_ids):
        s.discard(None)
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return {
        "users": {i: (u.name or u.email) for i, u in users.items()},
        "emails": {i: u.email for i, u in users.items()},
        "depts": {d.id: d.name for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()} if dept_ids else {},
        "branches": {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_(branch_ids)).all()} if branch_ids else {},
        "desigs": {d.id: d.name for d in db.query(HrDesignation).filter(HrDesignation.id.in_(desig_ids)).all()} if desig_ids else {},
        "grades": {g.id: f"{g.code} — {g.name}" for g in db.query(HrGrade).filter(HrGrade.id.in_(grade_ids)).all()} if grade_ids else {},
        "codes": dict(db.query(HrEmployeeProfile.user_id, HrEmployeeProfile.employee_code).filter(
            HrEmployeeProfile.user_id.in_({e.user_id for e in events if e.user_id})).all()) if any(e.user_id for e in events) else {},
    }


def _event_response(db: Session, ev: HrLifecycleEvent, user: User, *, with_items: bool, names: dict | None = None) -> HrLifecycleEventResponse:
    names = names or _lookup_names(db, [ev])
    hr = is_hr(user)
    resp = HrLifecycleEventResponse.model_validate(ev)
    u, n = names["users"], names
    resp.user_name = u.get(ev.user_id)
    resp.user_email = n["emails"].get(ev.user_id)
    resp.subject_name = resp.user_name or ev.candidate_name or ev.candidate_email
    resp.subject_email = resp.user_email or ev.candidate_email
    resp.employee_code = n["codes"].get(ev.user_id)
    resp.from_department_name = n["depts"].get(ev.from_department_id)
    resp.to_department_name = n["depts"].get(ev.to_department_id)
    resp.from_branch_name = n["branches"].get(ev.from_branch_id)
    resp.to_branch_name = n["branches"].get(ev.to_branch_id)
    resp.from_designation_name = n["desigs"].get(ev.from_designation_id)
    resp.to_designation_name = n["desigs"].get(ev.to_designation_id)
    resp.from_grade_name = n["grades"].get(ev.from_grade_id)
    resp.to_grade_name = n["grades"].get(ev.to_grade_id)
    resp.from_manager_name = u.get(ev.from_manager_id)
    resp.to_manager_name = u.get(ev.to_manager_id)
    resp.handover_to_name = u.get(ev.handover_to_id)
    resp.created_by_name = u.get(ev.created_by_id)
    resp.completed_by_name = u.get(ev.completed_by_id)
    resp.items_total = len(ev.items)
    resp.items_pending = sum(1 for i in ev.items if i.status == "pending")
    if with_items:
        item_user_ids = {i.owner_user_id for i in ev.items} | {i.done_by_id for i in ev.items}
        item_user_ids.discard(None)
        item_names = {x.id: (x.name or x.email) for x in db.query(User).filter(User.id.in_(item_user_ids)).all()} if item_user_ids else {}
        event_open = ev.status in OPEN_STATUSES
        resp.items = [_item_response(i, item_names, user, hr, event_open) for i in ev.items]
    resp.is_hr_view = hr
    if not hr:
        # Task owners outside HR see the checklist, not the HR case notes.
        resp.exit_reason = None
        resp.remarks = None
        resp.completion_summary = None
        resp.cancelled_reason = None
        resp.notice_period_days = None
        resp.resignation_date = None
    return resp


# ── Meta / lookups ──────────────────────────────────────────────────────

@router.get("/meta")
async def lifecycle_meta(
    include_user_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    """Enumerations plus the lookup lists the lifecycle forms need. Pickers
    list active users only; `include_user_id` adds one more (e.g. an exited
    employee being rehired, whose account is inactive)."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    if include_user_id and all(u.id != include_user_id for u in users):
        extra = db.get(User, include_user_id)
        if extra:
            users.append(extra)
    return {
        "event_types": [{"value": t, "label": svc.EVENT_TYPE_LABELS[t]} for t in LIFECYCLE_EVENT_TYPES],
        "statuses": list(LIFECYCLE_STATUSES),
        "exit_types": list(EXIT_TYPES),
        "employment_types": list(EMPLOYMENT_TYPES),
        "categories": [{"value": c, "label": CATEGORY_LABELS.get(c, c)} for c in CHECKLIST_CATEGORIES],
        "item_statuses": list(CHECKLIST_ITEM_STATUSES),
        "head_flags": [{"value": f, "label": svc.ROLE_FLAG_LABELS[f]} for f in svc.HEAD_FLAGS],
        "departments": [{"id": d.id, "name": d.name, "code": d.code} for d in db.query(Department).order_by(Department.name).all()],
        "branches": [{"id": b.id, "name": b.name, "code": b.code} for b in db.query(Branch).order_by(Branch.name).all()],
        "designations": [
            {"id": d.id, "name": d.name, "code": d.code}
            for d in db.query(HrDesignation).filter(HrDesignation.is_active == True).order_by(HrDesignation.name).all()  # noqa: E712
        ],
        "grades": [
            {"id": g.id, "name": g.name, "code": g.code, "level": g.level}
            for g in db.query(HrGrade).filter(HrGrade.is_active == True).order_by(HrGrade.level, HrGrade.code).all()  # noqa: E712
        ],
        "users": [
            {"id": u.id, "name": u.name, "email": u.email, "designation": u.designation, "department": u.department}
            for u in users
        ],
    }


# ── My checklist tasks (any logged-in user) ────────────────────────────

@router.get("/my-tasks", response_model=list[HrChecklistTaskResponse])
async def my_checklist_tasks(
    status_filter: str | None = Query("pending", alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Checklist items assigned to me on open lifecycle events."""
    q = (
        db.query(HrChecklistItem, HrLifecycleEvent)
        .join(HrLifecycleEvent, HrLifecycleEvent.id == HrChecklistItem.event_id)
        .filter(HrChecklistItem.owner_user_id == user.id, HrLifecycleEvent.status.in_(OPEN_STATUSES))
    )
    if status_filter:
        _validate_choice(status_filter, CHECKLIST_ITEM_STATUSES, "item status")
        q = q.filter(HrChecklistItem.status == status_filter)
    rows = q.order_by(HrLifecycleEvent.id.desc(), HrChecklistItem.sort_order).all()
    out = []
    for item, ev in rows:
        r = HrChecklistTaskResponse.model_validate(item)
        r.owner_name = user.name
        r.can_edit = True
        r.event_no, r.event_type, r.event_status = ev.event_no, ev.event_type, ev.status
        r.subject_name = svc.subject_name(db, ev)
        out.append(r)
    return out


# ── Events ──────────────────────────────────────────────────────────────

@router.get("/events/counts")
async def lifecycle_counts(db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    by_type = dict(db.query(HrLifecycleEvent.event_type, func.count()).filter(HrLifecycleEvent.status.in_(OPEN_STATUSES)).group_by(HrLifecycleEvent.event_type).all())
    by_status = dict(db.query(HrLifecycleEvent.status, func.count()).group_by(HrLifecycleEvent.status).all())
    return {
        "open_by_type": {t: by_type.get(t, 0) for t in LIFECYCLE_EVENT_TYPES},
        "by_status": {s: by_status.get(s, 0) for s in LIFECYCLE_STATUSES},
        "total": sum(by_status.values()),
    }


@router.get("/events", response_model=list[HrLifecycleEventResponse])
async def list_events(
    event_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    user_id: int | None = None,
    q: str | None = None,
    open_only: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    _validate_choice(event_type, LIFECYCLE_EVENT_TYPES, "event type")
    _validate_choice(status_filter, LIFECYCLE_STATUSES, "status")
    query = db.query(HrLifecycleEvent)
    if event_type:
        query = query.filter(HrLifecycleEvent.event_type == event_type)
    if status_filter:
        query = query.filter(HrLifecycleEvent.status == status_filter)
    elif open_only:
        query = query.filter(HrLifecycleEvent.status.in_(OPEN_STATUSES))
    if user_id:
        query = query.filter(HrLifecycleEvent.user_id == user_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        matching_users = db.query(User.id).filter(or_(func.lower(User.name).like(like), func.lower(User.email).like(like)))
        query = query.filter(or_(
            func.lower(HrLifecycleEvent.event_no).like(like),
            func.lower(HrLifecycleEvent.candidate_name).like(like),
            func.lower(HrLifecycleEvent.candidate_email).like(like),
            HrLifecycleEvent.user_id.in_(matching_users),
        ))
    events = query.order_by(HrLifecycleEvent.created_at.desc(), HrLifecycleEvent.id.desc()).limit(limit).all()
    names = _lookup_names(db, events) if events else None
    return [_event_response(db, e, user, with_items=False, names=names) for e in events]


@router.get("/users/{user_id}/events", response_model=list[HrLifecycleEventResponse])
async def list_user_events(user_id: int, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    """Lifecycle history of one employee (employee detail > Lifecycle tab)."""
    events = (
        db.query(HrLifecycleEvent).filter(HrLifecycleEvent.user_id == user_id)
        .order_by(HrLifecycleEvent.created_at.desc(), HrLifecycleEvent.id.desc()).all()
    )
    names = _lookup_names(db, events) if events else None
    return [_event_response(db, e, user, with_items=False, names=names) for e in events]


@router.post("/events", response_model=HrLifecycleEventResponse)
async def create_event(payload: HrLifecycleEventCreate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    _validate_choice(payload.event_type, LIFECYCLE_EVENT_TYPES, "event type")
    _validate_choice(payload.exit_type, EXIT_TYPES, "exit type")
    if payload.status not in (None, "draft", "in_progress"):
        raise HTTPException(status_code=400, detail="A new lifecycle event can only start as 'draft' or 'in_progress'.")

    subject: User | None = None
    if payload.user_id:
        subject = db.get(User, payload.user_id)
        if not subject:
            raise HTTPException(status_code=400, detail=f"User #{payload.user_id} doesn't exist. Pick the employee from the list again.")
        if subject.id == user.id:
            raise HTTPException(status_code=403, detail="You can't raise a lifecycle event about yourself. Ask another HR user to raise it.")
    if payload.event_type == "joining":
        if not subject and not (payload.candidate_name or "").strip():
            raise HTTPException(status_code=400, detail="Enter the new joiner's name (and email, so the portal user can be linked later), or pick an existing portal user.")
        if subject and svc.get_profile(db, subject.id) and svc.get_profile(db, subject.id).employment_status not in ("onboarding", "exited"):
            raise HTTPException(status_code=409, detail=f"{svc.user_label(subject)} is already an employee. Use a transfer or promotion event instead of a joining.")
        if subject:
            svc.ensure_joining_can_activate(subject, svc.get_profile(db, subject.id))
    else:
        if not subject:
            raise HTTPException(status_code=400, detail=f"Pick the employee this {svc.EVENT_TYPE_LABELS[payload.event_type].lower()} is for.")
        if is_exited(db, subject.id):
            raise HTTPException(status_code=409, detail=f"{svc.user_label(subject)} has already exited. To bring them back, raise a joining event (rehire).")
        dup = db.query(HrLifecycleEvent).filter(
            HrLifecycleEvent.user_id == subject.id, HrLifecycleEvent.event_type == payload.event_type,
            HrLifecycleEvent.status.in_(OPEN_STATUSES),
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail=f"{svc.user_label(subject)} already has an open {payload.event_type} event ({dup.event_no}). Finish or cancel that one first.")
    if payload.event_type == "exit" and not payload.last_working_day and not payload.effective_date:
        raise HTTPException(status_code=400, detail="Enter the last working day for the exit.")
    if payload.resignation_date and payload.last_working_day and payload.last_working_day < payload.resignation_date:
        raise HTTPException(status_code=400, detail="The last working day can't be before the resignation date. Check both dates.")
    svc.validate_refs(db, department_id=payload.to_department_id, branch_id=payload.to_branch_id,
                      designation_id=payload.to_designation_id, grade_id=payload.to_grade_id,
                      manager_id=payload.to_manager_id, subject_user_id=subject.id if subject else None)
    if payload.handover_to_id:
        if subject and payload.handover_to_id == subject.id:
            raise HTTPException(status_code=400, detail="The handover person can't be the employee themself. Pick their successor or manager.")
        svc.load_active_user(db, payload.handover_to_id, "handover person")

    ev = HrLifecycleEvent(
        event_no=svc.next_event_no(db),
        event_type=payload.event_type,
        user_id=subject.id if subject else None,
        candidate_name=(payload.candidate_name or "").strip() or (subject.name if subject else None),
        candidate_email=(payload.candidate_email or "").strip().lower() or (subject.email if subject else None),
        status=payload.status or "in_progress",
        effective_date=payload.effective_date or (payload.last_working_day if payload.event_type == "exit" else None),
        to_department_id=payload.to_department_id, to_branch_id=payload.to_branch_id,
        to_designation_id=payload.to_designation_id, to_grade_id=payload.to_grade_id, to_manager_id=payload.to_manager_id,
        resignation_date=payload.resignation_date, last_working_day=payload.last_working_day,
        exit_type=payload.exit_type, exit_reason=payload.exit_reason, notice_period_days=payload.notice_period_days,
        handover_to_id=payload.handover_to_id, remarks=payload.remarks,
        created_by_id=user.id,
    )
    if subject:
        svc.snapshot_from_fields(db, ev, subject)
    db.add(ev)
    items = svc.seed_checklist(db, ev)
    db.flush()
    if payload.event_type == "exit" and subject:
        # Serving notice from here on — HR screens show it, P2P etc. don't care.
        profile = svc.get_profile(db, subject.id)
        if profile and profile.employment_status in ("active", "probation"):
            profile.employment_status = "notice"
            profile.updated_by_id = user.id
    if ev.status == "in_progress":
        svc.notify_item_owners(db, ev, items, user.id)
    db.commit()
    db.refresh(ev)
    return _event_response(db, ev, user, with_items=True)


@router.get("/events/{event_id}", response_model=HrLifecycleEventResponse)
async def get_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ev = _get_event(db, event_id)
    if not is_hr(user) and not _is_owner_of_any(db, ev, user):
        raise HTTPException(
            status_code=403,
            detail="You can only open lifecycle events you have a checklist task on. HR & Administration access is needed to see the rest.",
        )
    return _event_response(db, ev, user, with_items=True)


@router.patch("/events/{event_id}", response_model=HrLifecycleEventResponse)
async def update_event(event_id: int, payload: HrLifecycleEventUpdate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    ev = _get_event(db, event_id)
    _ensure_open(ev, "edited")
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in ("draft", "in_progress"):
        raise HTTPException(status_code=400, detail="Here the status can only move between 'draft' and 'in_progress'. Use Complete or Cancel for the rest.")
    _validate_choice(updates.get("exit_type"), EXIT_TYPES, "exit type")
    svc.validate_refs(db, department_id=updates.get("to_department_id"), branch_id=updates.get("to_branch_id"),
                      designation_id=updates.get("to_designation_id"), grade_id=updates.get("to_grade_id"),
                      manager_id=updates.get("to_manager_id"), subject_user_id=ev.user_id)
    if updates.get("handover_to_id"):
        if updates["handover_to_id"] == ev.user_id:
            raise HTTPException(status_code=400, detail="The handover person can't be the employee themself. Pick their successor or manager.")
        svc.load_active_user(db, updates["handover_to_id"], "handover person")
    rd = updates.get("resignation_date", ev.resignation_date)
    lwd = updates.get("last_working_day", ev.last_working_day)
    if rd and lwd and lwd < rd:
        raise HTTPException(status_code=400, detail="The last working day can't be before the resignation date. Check both dates.")
    if "candidate_email" in updates and updates["candidate_email"]:
        updates["candidate_email"] = updates["candidate_email"].strip().lower()
    was_draft = ev.status == "draft"
    for k, v in updates.items():
        setattr(ev, k, v)
    if ev.event_type == "exit" and "last_working_day" in updates and updates["last_working_day"]:
        ev.effective_date = updates["last_working_day"]
    if was_draft and ev.status == "in_progress":
        svc.notify_item_owners(db, ev, list(ev.items), user.id)
    db.commit()
    db.refresh(ev)
    return _event_response(db, ev, user, with_items=True)


@router.post("/events/{event_id}/cancel", response_model=HrLifecycleEventResponse)
async def cancel_event(event_id: int, payload: HrLifecycleEventCancelPayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    ev = _get_event(db, event_id)
    _ensure_open(ev, "cancelled")
    ev.status = "cancelled"
    ev.cancelled_reason = payload.reason.strip()
    if ev.event_type == "exit" and ev.user_id:
        # Exit withdrawn — take them off notice again.
        profile = svc.get_profile(db, ev.user_id)
        if profile and profile.employment_status == "notice":
            profile.employment_status = "active"
            profile.updated_by_id = user.id
    record_audit(
        db, entity_type=svc.ENTITY_TYPE, entity_id=ev.id, action="cancelled", module_key=svc.MODULE_KEY,
        summary=f"{ev.event_no} cancelled by {svc.user_label(user)}: {ev.cancelled_reason}", user_id=user.id,
    )
    db.commit()
    db.refresh(ev)
    return _event_response(db, ev, user, with_items=True)


@router.post("/events/{event_id}/link-user", response_model=HrLifecycleEventResponse)
async def link_user(event_id: int, payload: HrLifecycleEventLinkUserPayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    """Attach the portal user to a joining that was started from a candidate
    name/email, once their Microsoft account exists."""
    ev = _get_event(db, event_id)
    _ensure_open(ev, "linked")
    if ev.event_type != "joining":
        raise HTTPException(status_code=400, detail="Only a joining event can be linked to a portal user — other events are always raised for an existing employee.")
    if payload.user_id:
        target = db.get(User, payload.user_id)
        if not target:
            raise HTTPException(status_code=400, detail=f"User #{payload.user_id} doesn't exist. Pick the portal user from the list again.")
    else:
        email = (payload.email or ev.candidate_email or "").strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="This joining has no candidate email to search by. Enter the joiner's work email, or pick the portal user directly.")
        target = db.query(User).filter(func.lower(User.email) == email).first()
        if not target:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No portal user with the email {email} yet. The account appears once the joiner signs in with Microsoft "
                    "for the first time, or when an admin runs Users & Roles > Sync Azure Users. Try again after that."
                ),
            )
    if target.id == user.id:
        raise HTTPException(status_code=403, detail="You can't link yourself to a joining event. Ask another HR user.")
    other = db.query(HrLifecycleEvent).filter(
        HrLifecycleEvent.event_type == "joining", HrLifecycleEvent.user_id == target.id,
        HrLifecycleEvent.status.in_(OPEN_STATUSES), HrLifecycleEvent.id != ev.id,
    ).first()
    if other:
        raise HTTPException(status_code=409, detail=f"{svc.user_label(target)} is already linked to open joining {other.event_no}. Cancel one of the two.")
    profile = svc.get_profile(db, target.id)
    if profile and profile.employment_status not in ("onboarding", "exited"):
        raise HTTPException(status_code=409, detail=f"{svc.user_label(target)} is already an employee ('{profile.employment_status}'). Check you picked the right person.")
    svc.ensure_joining_can_activate(target, profile)
    ev.user_id = target.id
    if not ev.candidate_name:
        ev.candidate_name = target.name
    ev.candidate_email = target.email.lower() if target.email else ev.candidate_email
    svc.snapshot_from_fields(db, ev, target)
    record_audit(
        db, entity_type=svc.ENTITY_TYPE, entity_id=ev.id, action="linked", module_key=svc.MODULE_KEY,
        summary=f"{ev.event_no} linked to portal user {svc.user_label(target)} ({target.email})", user_id=user.id,
    )
    db.commit()
    db.refresh(ev)
    return _event_response(db, ev, user, with_items=True)


@router.get("/events/{event_id}/impact")
@router.get("/events/{event_id}/exit-impact")
async def event_impact(event_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Preview of everything a completion would have to reassign, cancel or
    block on — shown BEFORE the exit (or move) is completed."""
    ev = _get_event(db, event_id)
    return svc.compute_impact(db, ev)


@router.post("/events/{event_id}/complete", response_model=HrLifecycleEventResponse)
async def complete_event(event_id: int, payload: HrLifecycleEventCompletePayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    ev = _get_event(db, event_id)
    try:
        svc.complete_event(db, ev, payload, user)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    db.refresh(ev)
    return _event_response(db, ev, user, with_items=True)


# ── Checklist items ─────────────────────────────────────────────────────

@router.post("/events/{event_id}/items", response_model=HrChecklistItemResponse)
async def add_item(event_id: int, payload: HrChecklistItemCreate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    ev = _get_event(db, event_id)
    _ensure_open(ev, "given new checklist items")
    _validate_choice(payload.category, CHECKLIST_CATEGORIES, "category")
    if payload.owner_user_id:
        svc.load_active_user(db, payload.owner_user_id, "task owner")
    sort_order = payload.sort_order if payload.sort_order is not None else (max((i.sort_order for i in ev.items), default=0) + 10)
    item = HrChecklistItem(
        category=payload.category, title=payload.title.strip(), owner_user_id=payload.owner_user_id,
        remarks=payload.remarks, sort_order=sort_order, status="pending",
    )
    ev.items.append(item)
    db.flush()
    if ev.status == "in_progress":
        svc.notify_item_owners(db, ev, [item], user.id)
    db.commit()
    db.refresh(item)
    names = {x.id: (x.name or x.email) for x in db.query(User).filter(User.id.in_({item.owner_user_id} - {None})).all()} if item.owner_user_id else {}
    return _item_response(item, names, user, True, True)


@router.patch("/items/{item_id}", response_model=HrChecklistItemResponse)
async def update_item(item_id: int, payload: HrChecklistItemUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.get(HrChecklistItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Checklist item #{item_id} doesn't exist — it may have been removed. Reload the event.")
    ev = item.event
    _ensure_open(ev, "changed")
    hr = is_hr(user)
    updates = payload.model_dump(exclude_unset=True)
    if not hr:
        if item.owner_user_id != user.id:
            raise HTTPException(status_code=403, detail="Only the task owner or HR can update this checklist item. Ask HR to reassign it to you if it's yours.")
        extra = set(updates) - {"status", "remarks"}
        if extra:
            raise HTTPException(status_code=403, detail=f"As the task owner you can change only the status and remarks, not {', '.join(sorted(extra))}. Ask HR for other changes.")
    if ev.user_id and ev.user_id == user.id and updates.get("status") in ("done", "not_applicable"):
        raise HTTPException(status_code=403, detail="You can't sign off checklist items on your own lifecycle event. The task owner or another HR user has to do it.")
    _validate_choice(updates.get("status"), CHECKLIST_ITEM_STATUSES, "item status")
    _validate_choice(updates.get("category"), CHECKLIST_CATEGORIES, "category")
    if updates.get("status") == "not_applicable" and not (updates.get("remarks") or item.remarks):
        raise HTTPException(status_code=400, detail="Say why this item doesn't apply — add a remark when marking it Not applicable.")
    if updates.get("owner_user_id"):
        svc.load_active_user(db, updates["owner_user_id"], "task owner")
    old_owner = item.owner_user_id
    if "title" in updates and updates["title"]:
        updates["title"] = updates["title"].strip()
    for k, v in updates.items():
        setattr(item, k, v)
    if "status" in updates:
        if item.status in ("done", "not_applicable"):
            item.done_by_id = user.id
            item.done_at = datetime.now(timezone.utc)
        else:
            item.done_by_id = None
            item.done_at = None
    if item.owner_user_id and item.owner_user_id != old_owner and item.owner_user_id != user.id and ev.status == "in_progress":
        svc.notify_item_owners(db, ev, [item], user.id)
    db.commit()
    db.refresh(item)
    ids = {item.owner_user_id, item.done_by_id} - {None}
    names = {x.id: (x.name or x.email) for x in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    return _item_response(item, names, user, hr, True)


@router.delete("/items/{item_id}")
async def delete_item(item_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    item = db.get(HrChecklistItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Checklist item #{item_id} doesn't exist — it may already have been removed. Reload the event.")
    _ensure_open(item.event, "changed")
    if item.status == "done":
        raise HTTPException(status_code=409, detail="This item is already done, so it stays on record. Mark it Not applicable instead if it was a mistake.")
    db.delete(item)
    db.commit()
    return {"message": "Checklist item removed"}


# ── Checklist templates (HR > Masters) ─────────────────────────────────

def _template_response(db: Session, t: HrChecklistTemplate) -> HrChecklistTemplateResponse:
    r = HrChecklistTemplateResponse.model_validate(t)
    if t.default_owner_user_id:
        owner = db.get(User, t.default_owner_user_id)
        r.default_owner_name = (owner.name or owner.email) if owner else None
    return r


@router.get("/templates", response_model=list[HrChecklistTemplateResponse])
async def list_templates(
    event_type: str | None = None,
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    _validate_choice(event_type, LIFECYCLE_EVENT_TYPES, "event type")
    q = db.query(HrChecklistTemplate)
    if event_type:
        q = q.filter(HrChecklistTemplate.event_type == event_type)
    if not include_inactive:
        q = q.filter(HrChecklistTemplate.is_active == True)  # noqa: E712
    rows = q.order_by(HrChecklistTemplate.event_type, HrChecklistTemplate.sort_order, HrChecklistTemplate.id).all()
    return [_template_response(db, t) for t in rows]


@router.post("/templates", response_model=HrChecklistTemplateResponse)
async def create_template(payload: HrChecklistTemplateCreate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    _validate_choice(payload.event_type, LIFECYCLE_EVENT_TYPES, "event type")
    _validate_choice(payload.category, CHECKLIST_CATEGORIES, "category")
    if payload.default_owner_user_id:
        svc.load_active_user(db, payload.default_owner_user_id, "default owner")
    title = payload.title.strip()
    dup = db.query(HrChecklistTemplate).filter(
        HrChecklistTemplate.event_type == payload.event_type, func.lower(HrChecklistTemplate.title) == title.lower(),
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"The {payload.event_type} checklist already has an item called '{dup.title}'. Edit that one instead.")
    sort_order = payload.sort_order
    if sort_order is None:
        sort_order = (db.query(func.max(HrChecklistTemplate.sort_order)).filter(HrChecklistTemplate.event_type == payload.event_type).scalar() or 0) + 10
    t = HrChecklistTemplate(
        event_type=payload.event_type, category=payload.category, title=title, description=payload.description,
        default_owner_user_id=payload.default_owner_user_id, sort_order=sort_order, is_active=payload.is_active,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _template_response(db, t)


@router.patch("/templates/{template_id}", response_model=HrChecklistTemplateResponse)
async def update_template(template_id: int, payload: HrChecklistTemplateUpdate, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    t = db.get(HrChecklistTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Checklist template #{template_id} doesn't exist — it may have been deleted. Reload the list.")
    updates = payload.model_dump(exclude_unset=True)
    _validate_choice(updates.get("event_type"), LIFECYCLE_EVENT_TYPES, "event type")
    _validate_choice(updates.get("category"), CHECKLIST_CATEGORIES, "category")
    if updates.get("default_owner_user_id"):
        svc.load_active_user(db, updates["default_owner_user_id"], "default owner")
    if "title" in updates and updates["title"]:
        updates["title"] = updates["title"].strip()
        dup = db.query(HrChecklistTemplate).filter(
            HrChecklistTemplate.event_type == updates.get("event_type", t.event_type),
            func.lower(HrChecklistTemplate.title) == updates["title"].lower(), HrChecklistTemplate.id != t.id,
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail=f"Another item on that checklist is already called '{dup.title}'. Use a different title.")
    for k, v in updates.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _template_response(db, t)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Delete a template line. Checklist items already copied from it stay
    on their events (template_id is set to NULL)."""
    t = db.get(HrChecklistTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Checklist template #{template_id} doesn't exist — it may already have been deleted. Reload the list.")
    db.query(HrChecklistItem).filter(HrChecklistItem.template_id == t.id).update({HrChecklistItem.template_id: None}, synchronize_session=False)
    db.delete(t)
    db.commit()
    return {"message": "Checklist template deleted"}
