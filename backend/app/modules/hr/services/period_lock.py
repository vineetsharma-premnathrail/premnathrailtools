"""Attendance period lock (see models/attendance_period.py).

`assert_open(db, user_id, d)` is the one guard every attendance write calls
(services/attendance.upsert_attendance, leave apply/cancel, punch
evaluation, roster edits, deletes). It raises 409 with the month, plant and
what to do. Locks are cached per session so a bulk import doesn't query the
period table once per row.
"""
from __future__ import annotations

from calendar import month_name
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.hr.models.attendance_period import HrAttendancePeriod
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.main.models.user import User

_CACHE_KEY = "hr_period_lock_cache"


def label(year: int, month: int) -> str:
    return f"{month_name[month]} {year}"


def _branch_of(db: Session, user_id: int) -> int | None:
    prof = db.query(HrEmployeeProfile.branch_id).filter(HrEmployeeProfile.user_id == user_id).first()
    if prof and prof[0]:
        return prof[0]
    u = db.get(User, user_id)
    return u.branch_id if u else None


def locked_period(db: Session, year: int, month: int, branch_id: int | None) -> HrAttendancePeriod | None:
    """The lock row covering (year, month, plant): the plant's own row or the
    all-plants row, whichever is locked."""
    cache = db.info.setdefault(_CACHE_KEY, {})
    key = (year, month, branch_id)
    if key in cache:
        pid = cache[key]
        return db.get(HrAttendancePeriod, pid) if pid else None
    q = db.query(HrAttendancePeriod).filter(HrAttendancePeriod.year == year, HrAttendancePeriod.month == month,
                                            HrAttendancePeriod.status == "locked")
    q = q.filter(or_(HrAttendancePeriod.branch_id.is_(None), HrAttendancePeriod.branch_id == branch_id)) if branch_id \
        else q.filter(HrAttendancePeriod.branch_id.is_(None))
    row = q.first()
    cache[key] = row.id if row else None
    return row


def clear_cache(db: Session) -> None:
    db.info.pop(_CACHE_KEY, None)


def is_locked(db: Session, user_id: int, d: date) -> bool:
    return locked_period(db, d.year, d.month, _branch_of(db, user_id)) is not None


def lock_message(db: Session, period: HrAttendancePeriod, who: str | None = None) -> str:
    from app.modules.organization.models.branch import Branch

    plant = "every plant"
    if period.branch_id:
        b = db.get(Branch, period.branch_id)
        plant = b.name if b else f"plant #{period.branch_id}"
    return (f"{label(period.year, period.month)} attendance for {plant} is locked for payroll (sent to ADP)"
            + (f", so {who}'s day can't be changed" if who else "")
            + ". Ask HR to unlock the period (a Partner approves the unlock with a reason), then try again.")


def assert_open(db: Session, user_id: int, d: date) -> None:
    period = locked_period(db, d.year, d.month, _branch_of(db, user_id))
    if period is not None:
        u = db.get(User, user_id)
        raise HTTPException(status_code=409, detail=lock_message(db, period, u.name if u else None))


def assert_range_open(db: Session, user_id: int, start: date, end: date) -> None:
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        assert_open(db, user_id, date(y, m, 1))
        m += 1
        if m == 13:
            y, m = y + 1, 1


def _event(period: HrAttendancePeriod, action: str, user: User, reason: str | None) -> None:
    hist = list(period.history or [])
    hist.append({"action": action, "by_id": user.id, "by": user.name or user.email,
                 "at": datetime.now(timezone.utc).isoformat(), "reason": reason})
    period.history = hist


def lock(db: Session, year: int, month: int, branch_id: int | None, user: User) -> HrAttendancePeriod:
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail=f"Month must be 1–12, got {month}. Pick a month from the list.")
    row = db.query(HrAttendancePeriod).filter(HrAttendancePeriod.year == year, HrAttendancePeriod.month == month,
                                              HrAttendancePeriod.branch_id.is_(None) if branch_id is None
                                              else HrAttendancePeriod.branch_id == branch_id).first()
    if row is None:
        row = HrAttendancePeriod(year=year, month=month, branch_id=branch_id, status="open")
        db.add(row)
    elif row.status == "locked":
        raise HTTPException(status_code=409, detail=f"{label(year, month)} is already locked. Nothing to do.")
    row.status = "locked"
    row.locked_by_id = user.id
    row.locked_at = datetime.now(timezone.utc)
    _event(row, "locked", user, None)
    clear_cache(db)
    db.flush()
    return row


def unlock(db: Session, period: HrAttendancePeriod, user: User, reason: str) -> HrAttendancePeriod:
    if period.status != "locked":
        raise HTTPException(status_code=409, detail=f"{label(period.year, period.month)} isn't locked, so there is nothing to unlock.")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Enter why the period is being unlocked — it is kept with the payroll history.")
    if not (user.is_partner or user.role == "admin"):
        raise HTTPException(
            status_code=403,
            detail=("Only a Partner can unlock an attendance period that was sent to ADP payroll. Ask a Partner "
                    "(Company Info › Partners) to unlock it, with the reason."),
        )
    period.status = "open"
    period.unlocked_by_id = user.id
    period.unlocked_at = datetime.now(timezone.utc)
    period.unlock_reason = reason.strip()
    _event(period, "unlocked", user, reason.strip())
    clear_cache(db)
    db.flush()
    return period
