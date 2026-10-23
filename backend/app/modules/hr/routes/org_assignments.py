"""HR — time-sliced org assignment (PA30 IT0001) and effective-dated actions (PA40).

- GET    /hr/org-assignments/as-of?date=&branch_id=&department_id=   headcount on a date
- GET    /hr/org-assignments/{user_id}                                 assignment history
- POST   /hr/org-assignments/{user_id}                                 change from an effective date
- DELETE /hr/org-assignments/slices/{slice_id}                         withdraw a future change
- POST   /hr/lifecycle/events/{event_id}/apply-now                     apply a scheduled move early
- GET    /hr/lifecycle/scheduled                                       scheduled (future-dated) actions
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import ensure_feature_action, ensure_tab_action
from app.db.session import get_db
from app.modules.hr.models.assignment import ASSIGNMENT_FIELDS, HrEmployeeAssignment
from app.modules.hr.models.employee_profile import EMPLOYMENT_TYPES
from app.modules.hr.models.lifecycle import HrLifecycleEvent
from app.modules.hr.models.masters import HrDesignation, HrGrade
from app.modules.hr.services import assignments as asg
from app.modules.hr.services import lifecycle as lc
from app.modules.hr.services.access import require_hr_tab
from app.modules.hr.services.approvals import employee_scope_filter, ensure_employee_in_scope
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department

router = APIRouter(prefix="/hr/org-assignments", tags=["HR"])
lifecycle_router = APIRouter(prefix="/hr/lifecycle", tags=["HR"])

require_view = require_hr_tab("employees")
require_edit = require_hr_tab("employees", "edit")
require_lc_view = require_hr_tab("lifecycle")
require_lc_approve = require_hr_tab("lifecycle", "approve")


class HrAssignmentChangePayload(BaseModel):
    valid_from: date
    department_id: int | None = None
    designation_id: int | None = None
    grade_id: int | None = None
    branch_id: int | None = None
    cost_center_id: int | None = None
    reporting_manager_id: int | None = None
    employment_type: str | None = None
    reason: str = Field(min_length=3, max_length=1000)


class HrApplyNowPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


def _names(db: Session, rows: list[HrEmployeeAssignment]) -> dict:
    ids = lambda f: {getattr(r, f) for r in rows} - {None}  # noqa: E731
    return {
        "department": {d.id: d.name for d in db.query(Department).filter(Department.id.in_(ids("department_id") or {-1}))},
        "designation": {d.id: d.name for d in db.query(HrDesignation).filter(HrDesignation.id.in_(ids("designation_id") or {-1}))},
        "grade": {g.id: g.code for g in db.query(HrGrade).filter(HrGrade.id.in_(ids("grade_id") or {-1}))},
        "branch": {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_(ids("branch_id") or {-1}))},
        "manager": {u.id: u.name for u in db.query(User).filter(User.id.in_(ids("reporting_manager_id") | ids("created_by_id") or {-1}))},
        "cost_center": _cc_names(db, ids("cost_center_id")),
    }


def _cc_names(db: Session, ids: set) -> dict:
    from app.modules.organization.models.cost_center import CostCenter

    return {c.id: f"{c.code} — {c.name}" for c in db.query(CostCenter).filter(CostCenter.id.in_(ids or {-1}))}


def _out(r: HrEmployeeAssignment, n: dict, today: date) -> dict:
    return {
        "id": r.id, "user_id": r.user_id, "valid_from": r.valid_from, "valid_to": r.valid_to,
        **{f: getattr(r, f) for f in ASSIGNMENT_FIELDS},
        "department_name": n["department"].get(r.department_id), "designation_name": n["designation"].get(r.designation_id),
        "grade_code": n["grade"].get(r.grade_id), "branch_name": n["branch"].get(r.branch_id),
        "cost_center_name": n["cost_center"].get(r.cost_center_id), "reporting_manager_name": n["manager"].get(r.reporting_manager_id),
        "source": r.source, "source_event_id": r.source_event_id, "reason": r.reason,
        "applied": r.applied_at is not None, "pending": r.applied_at is None and r.valid_from > today,
        "current": r.valid_from <= today and (r.valid_to is None or r.valid_to >= today),
        "created_by_name": n["manager"].get(r.created_by_id), "created_at": r.created_at,
    }


def _target(db: Session, user_id: int, viewer: User) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Employee #{user_id} doesn't exist. Pick the employee again from HR > Employees.")
    ensure_employee_in_scope(db, viewer, target)
    return target


@router.get("/as-of")
async def headcount_as_of(
    on: date = Query(..., alias="date"), branch_id: int | None = Query(None), department_id: int | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_view),
):
    """Who was where on a date — from the assignment history; employees with
    no history yet are counted from their current profile."""
    slices = asg.as_of(db, on)
    q = db.query(User)
    scope = employee_scope_filter(db, user)
    if scope is not None:
        q = q.filter(scope)
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    profiles = {p.user_id: p for p in db.query(HrEmployeeProfile).all()}
    rows = []
    for u in q.all():
        p = profiles.get(u.id)
        s = slices.get(u.id)
        if s is None:
            if u.date_of_joining and u.date_of_joining > on:
                continue
            if p is not None and p.date_of_exit and p.date_of_exit < on:
                continue
            if p is None and not u.is_active:
                continue
            if db.query(HrEmployeeAssignment.id).filter(HrEmployeeAssignment.user_id == u.id).first():
                continue  # has history but no slice on that date = not employed then
            vals = asg.current_values(u, p)
        else:
            vals = {f: getattr(s, f) for f in ASSIGNMENT_FIELDS}
        if branch_id and vals.get("branch_id") != branch_id:
            continue
        if department_id and vals.get("department_id") != department_id:
            continue
        rows.append({"user_id": u.id, "name": u.name, "employee_code": p.employee_code if p else None,
                     "from_history": s is not None, **vals})
    depts = {d.id: d.name for d in db.query(Department).all()}
    branches = {b.id: b.name for b in db.query(Branch).all()}
    by_dept: dict[str, int] = {}
    for r in rows:
        r["department_name"] = depts.get(r.get("department_id"))
        r["branch_name"] = branches.get(r.get("branch_id"))
        key = r["department_name"] or "No department"
        by_dept[key] = by_dept.get(key, 0) + 1
    rows.sort(key=lambda r: (r["department_name"] or "~", r["name"] or ""))
    return {"date": on, "total": len(rows), "by_department": by_dept, "items": rows}


@router.get("/{user_id}")
async def assignment_history(user_id: int, db: Session = Depends(get_db), user: User = Depends(require_view)):
    ensure_feature_action(user, "hr", "employees", "assignment", "view")
    target = _target(db, user_id, user)
    rows = asg.slices(db, target.id)
    n = _names(db, rows)
    today = today_ist()
    return {"user_id": target.id, "name": target.name, "items": [_out(r, n, today) for r in reversed(rows)]}


@router.post("/{user_id}")
async def change_assignment(user_id: int, payload: HrAssignmentChangePayload, db: Session = Depends(get_db),
                            user: User = Depends(require_edit)):
    """Record an org change from `valid_from` (IT0001 new validity period).
    Fields left out keep the value of the slice in force on that date. A
    date today or earlier is applied now; a future date is applied by the
    daily job on that date."""
    ensure_feature_action(user, "hr", "employees", "assignment", "create")
    target = _target(db, user_id, user)
    if target.id == user.id:
        raise HTTPException(status_code=403, detail="You can't change your own org assignment. Ask another HR user to do it.")
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    profile = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == target.id).first()
    if profile is not None and profile.employment_status == "exited":
        raise HTTPException(status_code=409, detail=f"{target.name} has exited. To bring them back, raise a joining event (rehire).")
    today = today_ist()
    if target.date_of_joining and payload.valid_from < target.date_of_joining:
        raise HTTPException(status_code=400, detail=f"{payload.valid_from:%d-%m-%Y} is before {target.name}'s date of joining ({target.date_of_joining:%d-%m-%Y}). Pick a later date.")
    sent = payload.model_dump(exclude_unset=True)
    asg.ensure_baseline(db, target, asg.current_values(target, profile), user.id)
    base = asg.slice_on(db, target.id, payload.valid_from)
    values = {f: getattr(base, f) for f in ASSIGNMENT_FIELDS} if base is not None else asg.current_values(target, profile)
    changed = {f: sent[f] for f in ASSIGNMENT_FIELDS if f in sent}
    if not changed:
        raise HTTPException(status_code=400, detail="Nothing to change — set at least one of department, designation, grade, plant, cost center, manager or employment type.")
    values.update(changed)
    if values.get("employment_type") and values["employment_type"] not in EMPLOYMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Employment type '{values['employment_type']}' isn't valid. Use one of: {', '.join(EMPLOYMENT_TYPES)}.")
    lc.validate_refs(db, department_id=changed.get("department_id"), branch_id=changed.get("branch_id"),
                     designation_id=changed.get("designation_id"), grade_id=changed.get("grade_id"),
                     manager_id=changed.get("reporting_manager_id"), subject_user_id=target.id)
    asg.validate_cost_center(db, values.get("cost_center_id"), values.get("branch_id"))
    future = payload.valid_from > today
    row = asg.record_slice(db, user_id=target.id, valid_from=payload.valid_from, values=values, source="manual",
                           actor_id=user.id, reason=payload.reason.strip(), applied=False)
    if row is None:
        raise HTTPException(status_code=409, detail=f"{target.name}'s assignment on {payload.valid_from:%d-%m-%Y} already has these values. Nothing changed.")
    applied_changes: list[str] = []
    current = asg.slice_on(db, target.id, today)
    if not future and current is row:
        applied_changes = asg.apply_slice(db, row, user)
    elif not future:  # back-dated slice already superseded by a later one: history only
        row.applied_at = datetime.now(timezone.utc)
    record_audit(db, entity_type="hr_employee_assignment", entity_id=row.id, action="created", module_key="hr",
                 summary=(f"Org assignment of {target.name} from {payload.valid_from:%d-%m-%Y}: "
                          + ", ".join(f"{k}={v}" for k, v in changed.items())
                          + (" (scheduled — applies on that date)" if future else "") + f". Reason: {payload.reason.strip()}"),
                 user_id=user.id)
    db.commit()
    n = _names(db, [row])
    return {"slice": _out(row, n, today), "scheduled": future, "applied_fields": applied_changes}


@router.delete("/slices/{slice_id}")
async def withdraw_future_change(slice_id: int, db: Session = Depends(get_db), user: User = Depends(require_edit)):
    ensure_feature_action(user, "hr", "employees", "assignment", "cancel")
    row = db.get(HrEmployeeAssignment, slice_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Assignment slice #{slice_id} doesn't exist — it may already be withdrawn. Reload the history.")
    target = _target(db, row.user_id, user)
    if target.id == user.id:
        raise HTTPException(status_code=403, detail="You can't withdraw a future change to your own org assignment. Ask another HR user to do it.")
    asg.delete_future(db, row)
    record_audit(db, entity_type="hr_employee_assignment", entity_id=slice_id, action="deleted", module_key="hr",
                 summary=f"Withdrew the future org change of {target.name} from {row.valid_from:%d-%m-%Y}", user_id=user.id)
    db.commit()
    return {"ok": True}


# ─────────────────────────── PA40 scheduled actions ───────────────────────────
@lifecycle_router.get("/scheduled")
async def scheduled_actions(db: Session = Depends(get_db), user: User = Depends(require_lc_view)):
    from app.core.data_scope import apply_scope

    evs = apply_scope(db.query(HrLifecycleEvent), user, HrLifecycleEvent).filter(
        HrLifecycleEvent.status == "scheduled").order_by(HrLifecycleEvent.effective_date).all()
    slices = (db.query(HrEmployeeAssignment).filter(HrEmployeeAssignment.applied_at.is_(None))
              .order_by(HrEmployeeAssignment.valid_from).all())
    users = {u.id: u.name for u in db.query(User).filter(User.id.in_({e.user_id for e in evs} | {s.user_id for s in slices} or {-1}))}
    n = _names(db, slices)
    today = today_ist()
    return {
        "events": [{"id": e.id, "event_no": e.event_no, "event_type": e.event_type, "user_id": e.user_id,
                    "user_name": users.get(e.user_id), "effective_date": e.effective_date,
                    "scheduled_on": (e.completion_summary or {}).get("scheduled_on") if isinstance(e.completion_summary, dict) else None}
                   for e in evs],
        "assignment_changes": [{**_out(s, n, today), "user_name": users.get(s.user_id)} for s in slices],
    }


@lifecycle_router.post("/events/{event_id}/apply-now")
async def apply_now(event_id: int, payload: HrApplyNowPayload, db: Session = Depends(get_db), user: User = Depends(require_lc_approve)):
    """HR override: apply a scheduled move before its effective date
    (reason mandatory, audited). The assignment slice still starts on the
    event's effective date."""
    from app.core.data_scope import ensure_in_scope
    from app.tasks.hr_lifecycle_apply import apply_scheduled_event

    ev = db.get(HrLifecycleEvent, event_id)
    if ev is None:
        raise HTTPException(status_code=404, detail=f"Lifecycle event #{event_id} doesn't exist. Go back to HR > Lifecycle and open it from the list.")
    ensure_in_scope(db, user, ev)
    if ev.user_id == user.id:
        raise HTTPException(status_code=403, detail="You can't apply a lifecycle event about yourself. Another HR user has to do it.")
    ensure_tab_action(user, "hr", "lifecycle", "approve")
    try:
        result = apply_scheduled_event(db, ev, user, reason=payload.reason.strip())
        record_audit(db, entity_type=lc.ENTITY_TYPE, entity_id=ev.id, action="applied_early", module_key="hr",
                     summary=f"{ev.event_no} applied before its effective date by {user.name}. Reason: {payload.reason.strip()}",
                     user_id=user.id)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    return {"event_no": ev.event_no, "status": ev.status, "changes": result.get("changes", [])}
