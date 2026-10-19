"""Time-sliced org assignment (SAP PA30 IT0001) — see models/assignment.py.

Slices never overlap. Writing a slice from date F:
- a slice that already starts on F is updated in place;
- the slice covering F is closed on F − 1;
- when a later (future) slice exists, the new one ends the day before it.
A slice whose values equal the one it would follow is not written.

Future-dated slices (valid_from > today) are stored with applied_at NULL and
applied to the profile / User by the daily job (tasks/hr_lifecycle_apply.py).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.modules.hr.models.assignment import ASSIGNMENT_FIELDS, HrEmployeeAssignment
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User

PROFILE_FIELDS = ("department_id", "designation_id", "grade_id", "branch_id", "cost_center_id", "employment_type")


def _fmt(d: date | None) -> str:
    return d.strftime("%d-%m-%Y") if d else "—"


def current_values(user: User, profile: HrEmployeeProfile | None) -> dict:
    vals = {f: getattr(profile, f, None) if profile is not None else None for f in PROFILE_FIELDS}
    if profile is None:
        vals["branch_id"] = user.branch_id
    vals["reporting_manager_id"] = user.reporting_manager_id
    return vals


def _values_of(row: HrEmployeeAssignment) -> dict:
    return {f: getattr(row, f) for f in ASSIGNMENT_FIELDS}


def slices(db: Session, user_id: int) -> list[HrEmployeeAssignment]:
    return (db.query(HrEmployeeAssignment).filter(HrEmployeeAssignment.user_id == user_id)
            .order_by(HrEmployeeAssignment.valid_from.asc()).all())


def slice_on(db: Session, user_id: int, d: date) -> HrEmployeeAssignment | None:
    return (db.query(HrEmployeeAssignment)
            .filter(HrEmployeeAssignment.user_id == user_id, HrEmployeeAssignment.valid_from <= d,
                    or_(HrEmployeeAssignment.valid_to.is_(None), HrEmployeeAssignment.valid_to >= d))
            .order_by(HrEmployeeAssignment.valid_from.desc()).first())


def validate_cost_center(db: Session, cost_center_id: int | None, branch_id: int | None) -> None:
    """A cost center must be active and, when the plant is set, belong to it
    (or to no plant)."""
    if not cost_center_id:
        return
    from app.modules.organization.models.cost_center import CostCenter
    from app.modules.organization.models.branch import Branch

    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise HTTPException(status_code=400, detail=f"Cost center #{cost_center_id} doesn't exist. Pick one from the list, or add it in Organization > Cost Centers.")
    if (cc.status or "active") != "active":
        raise HTTPException(status_code=400, detail=f"Cost center {cc.code} — {cc.name} is {cc.status}. Re-activate it in Organization > Cost Centers or pick another.")
    if branch_id and cc.branch_id and cc.branch_id != branch_id:
        plant = db.get(Branch, cc.branch_id)
        here = db.get(Branch, branch_id)
        raise HTTPException(
            status_code=400,
            detail=(f"Cost center {cc.code} belongs to {plant.name if plant else 'another plant'}, but the employee is at "
                    f"{here.name if here else 'a different plant'}. Pick a cost center of the employee's plant."),
        )


def record_slice(db: Session, *, user_id: int, valid_from: date, values: dict, source: str, actor_id: int | None,
                 event_id: int | None = None, reason: str | None = None, applied: bool = True) -> HrEmployeeAssignment | None:
    """Write the slice starting `valid_from`. Returns it, or None when the
    values equal the slice that already covers that date. Does not commit."""
    values = {f: values.get(f) for f in ASSIGNMENT_FIELDS}
    rows = slices(db, user_id)
    same_day = next((r for r in rows if r.valid_from == valid_from), None)
    before = [r for r in rows if r.valid_from < valid_from]
    after = [r for r in rows if r.valid_from > valid_from]
    prev = before[-1] if before else None
    nxt = after[0] if after else None
    now = datetime.now(timezone.utc)
    if same_day is not None:
        if _values_of(same_day) == values:
            return None
        for f, v in values.items():
            setattr(same_day, f, v)
        same_day.source, same_day.reason = source, reason or same_day.reason
        same_day.source_event_id = event_id or same_day.source_event_id
        same_day.applied_at = now if applied else None
        return same_day
    if prev is not None and _values_of(prev) == values and (prev.valid_to is None or prev.valid_to >= valid_from):
        return None
    if prev is not None and (prev.valid_to is None or prev.valid_to >= valid_from):
        prev.valid_to = valid_from - timedelta(days=1)
    row = HrEmployeeAssignment(
        user_id=user_id, valid_from=valid_from, valid_to=(nxt.valid_from - timedelta(days=1)) if nxt else None,
        source=source, source_event_id=event_id, reason=reason, created_by_id=actor_id,
        applied_at=now if applied else None, **values,
    )
    db.add(row)
    db.flush()
    return row


def ensure_baseline(db: Session, user: User, values: dict, actor_id: int | None) -> None:
    """First slice for an employee with no history: their values as they
    stood (from the date of joining, else the earliest sensible date)."""
    if db.query(HrEmployeeAssignment.id).filter(HrEmployeeAssignment.user_id == user.id).first():
        return
    start = user.date_of_joining or today_ist()
    record_slice(db, user_id=user.id, valid_from=start, values=values, source="backfill", actor_id=actor_id,
                 reason="History started from the values on record")


def sync_from_profile(db: Session, user: User, before: dict | None, after: dict, *, valid_from: date | None = None,
                      source: str = "profile_edit", actor_id: int | None = None, event_id: int | None = None,
                      reason: str | None = None) -> HrEmployeeAssignment | None:
    """Record an applied change: `before` = values before the edit (None =
    new employee), `after` = values now on the profile / User."""
    vf = valid_from or ((user.date_of_joining or today_ist()) if before is None else today_ist())
    if before is not None and before == after and db.query(HrEmployeeAssignment.id).filter(HrEmployeeAssignment.user_id == user.id).first():
        return None
    if before is not None:
        ensure_baseline(db, user, before, actor_id)
        rows = slices(db, user.id)
        if rows and rows[0].valid_from > vf:  # back-dated edit before the baseline: move the baseline start
            rows[0].valid_from = vf
            for f, v in after.items():
                setattr(rows[0], f, v)
            return rows[0]
    return record_slice(db, user_id=user.id, valid_from=vf, values=after, source=source, actor_id=actor_id,
                        event_id=event_id, reason=reason)


def apply_slice(db: Session, row: HrEmployeeAssignment, actor: User | None) -> list[str]:
    """Write a slice's values onto the profile and User (current data)."""
    from app.modules.hr.services.employee_sync import apply_org_fields

    user = db.get(User, row.user_id)
    profile = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == row.user_id).first()
    if profile is None:
        profile = HrEmployeeProfile(user_id=row.user_id, employment_status="active", org_fields_locked=True,
                                    created_by_id=actor.id if actor else None)
        db.add(profile)
    changes = []
    for f in PROFILE_FIELDS:
        v = getattr(row, f)
        if getattr(profile, f) != v:
            changes.append(f)
            setattr(profile, f, v)
    if user.reporting_manager_id != row.reporting_manager_id:
        from app.modules.hr.services.lifecycle import reroute_pending_requests

        changes.append("reporting_manager_id")
        old = user.reporting_manager_id
        user.reporting_manager_id = row.reporting_manager_id
        if row.reporting_manager_id:
            reroute_pending_requests(db, user.id, old, row.reporting_manager_id, actor)
    if actor is not None:
        profile.updated_by_id = actor.id
    db.flush()
    apply_org_fields(db, user, profile)
    row.applied_at = datetime.now(timezone.utc)
    return changes


def apply_due(db: Session, today: date | None = None, actor: User | None = None) -> list[HrEmployeeAssignment]:
    """Apply every future-dated slice whose date has come (latest per
    employee wins; earlier due ones are just marked applied)."""
    today = today or today_ist()
    due = (db.query(HrEmployeeAssignment)
           .filter(HrEmployeeAssignment.applied_at.is_(None), HrEmployeeAssignment.valid_from <= today)
           .order_by(HrEmployeeAssignment.user_id, HrEmployeeAssignment.valid_from).all())
    latest: dict[int, HrEmployeeAssignment] = {}
    for r in due:
        latest[r.user_id] = r
    done = []
    for r in due:
        if latest[r.user_id] is r:
            changed = apply_slice(db, r, actor)
            record_audit(db, entity_type="hr_employee_assignment", entity_id=r.id, action="applied", module_key="hr",
                         summary=f"Org assignment from {_fmt(r.valid_from)} applied on its effective date ({', '.join(changed) or 'no change'})",
                         user_id=actor.id if actor else None)
        else:
            r.applied_at = datetime.now(timezone.utc)
        done.append(r)
    return done


def close_on_exit(db: Session, user_id: int, exit_date: date) -> None:
    row = slice_on(db, user_id, exit_date)
    if row is not None and (row.valid_to is None or row.valid_to > exit_date):
        row.valid_to = exit_date
    for later in db.query(HrEmployeeAssignment).filter(HrEmployeeAssignment.user_id == user_id,
                                                       HrEmployeeAssignment.valid_from > exit_date,
                                                       HrEmployeeAssignment.applied_at.is_(None)).all():
        db.delete(later)


def delete_future(db: Session, row: HrEmployeeAssignment) -> None:
    if row.applied_at is not None or row.valid_from <= today_ist():
        raise HTTPException(
            status_code=409,
            detail=(f"The change from {_fmt(row.valid_from)} is already in effect, so it stays in the history. "
                    "Record a new change from the date it should end instead."),
        )
    rows = slices(db, row.user_id)
    idx = rows.index(row)
    prev = rows[idx - 1] if idx > 0 else None
    if prev is not None:
        prev.valid_to = row.valid_to
    db.delete(row)


def as_of(db: Session, d: date) -> dict[int, HrEmployeeAssignment]:
    rows = (db.query(HrEmployeeAssignment)
            .filter(HrEmployeeAssignment.valid_from <= d,
                    or_(HrEmployeeAssignment.valid_to.is_(None), HrEmployeeAssignment.valid_to >= d)).all())
    return {r.user_id: r for r in rows}
