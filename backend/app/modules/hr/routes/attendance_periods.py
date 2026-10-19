"""HR — attendance period lock before the ADP payroll cut-off.

- GET  /hr/attendance-periods?year=                     lock status per month / plant
- POST /hr/attendance-periods/lock                      {year, month, branch_id?}  (hr:attendance:export)
- POST /hr/attendance-periods/{id}/unlock               {reason}  (Partner only)
- GET  /hr/attendance-periods/adp-export?year&month&branch_id
       the time-evaluation ADP CSV, only once the period is locked
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.hr.models.attendance_period import HrAttendancePeriod
from app.modules.hr.services import period_lock
from app.modules.hr.services.access import require_hr_tab
from app.modules.hr.services.calendar import today_ist
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch

router = APIRouter(prefix="/hr/attendance-periods", tags=["HR"])
require_view = require_hr_tab("attendance")
require_export = require_hr_tab("attendance", "export")
# Attendance › Payroll periods feature (core/features/hr.py)
require_periods_view = require_feature_action("hr", "attendance", "periods", "view")
require_periods_lock = require_feature_action("hr", "attendance", "periods", "create")
require_periods_unlock = require_feature_action("hr", "attendance", "periods", "cancel")  # + Partner rule in period_lock.unlock
require_periods_export = require_feature_action("hr", "attendance", "periods", "export")


class HrPeriodLockPayload(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    branch_id: int | None = None


class HrPeriodUnlockPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


def _out(db: Session, p: HrAttendancePeriod, names: dict) -> dict:
    return {"id": p.id, "year": p.year, "month": p.month, "label": period_lock.label(p.year, p.month),
            "branch_id": p.branch_id, "branch_name": names.get(("b", p.branch_id)) if p.branch_id else "All plants",
            "status": p.status, "locked_by_name": names.get(("u", p.locked_by_id)), "locked_at": p.locked_at,
            "unlocked_by_name": names.get(("u", p.unlocked_by_id)), "unlocked_at": p.unlocked_at,
            "unlock_reason": p.unlock_reason, "history": p.history or []}


def _names(db: Session, rows: list[HrAttendancePeriod]) -> dict:
    n = {("b", b.id): b.name for b in db.query(Branch).all()}
    uids = {r.locked_by_id for r in rows} | {r.unlocked_by_id for r in rows}
    n.update({("u", u.id): u.name for u in db.query(User).filter(User.id.in_(uids - {None} or {-1}))})
    return n


@router.get("")
async def list_periods(year: int | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_periods_view)):
    y = year or today_ist().year
    rows = db.query(HrAttendancePeriod).filter(HrAttendancePeriod.year == y).order_by(HrAttendancePeriod.month, HrAttendancePeriod.branch_id).all()
    n = _names(db, rows)
    plants = [{"id": b.id, "name": b.name} for b in db.query(Branch).order_by(Branch.name).all()]
    return {"year": y, "plants": plants, "items": [_out(db, r, n) for r in rows]}


@router.post("/lock")
async def lock_period(payload: HrPeriodLockPayload, db: Session = Depends(get_db), user: User = Depends(require_periods_lock),
                      background_tasks: BackgroundTasks = None):
    if payload.branch_id and not db.get(Branch, payload.branch_id):
        raise HTTPException(status_code=404, detail=f"Plant #{payload.branch_id} doesn't exist. Pick a plant from the list.")
    t = today_ist()
    if (payload.year, payload.month) > (t.year, t.month):
        raise HTTPException(status_code=400, detail=f"{period_lock.label(payload.year, payload.month)} hasn't started yet. Lock a month once its attendance is final.")
    row = period_lock.lock(db, payload.year, payload.month, payload.branch_id, user)
    record_audit(db, entity_type="hr_attendance_period", entity_id=row.id, action="locked", module_key="hr",
                 summary=f"Attendance {period_lock.label(row.year, row.month)} locked for payroll"
                         + (f" ({db.get(Branch, row.branch_id).name})" if row.branch_id else " (all plants)"), user_id=user.id)
    from app.modules.hr.services import role_events
    plant = db.get(Branch, row.branch_id).name if row.branch_id else "all plants"
    role_events.fire(
        db, background_tasks, "period_locked", title=f"Attendance {period_lock.label(row.year, row.month)} locked for payroll",
        message=(f"{user.name} locked attendance of {period_lock.label(row.year, row.month)} for {plant}. Marking, imports, punches, "
                 "roster, regularizations, leave and overtime of that month are now blocked; the ADP export can be downloaded "
                 "under HR › Attendance › Payroll periods."),
        entity_type="hr_attendance_period", entity_id=row.id, actor=user,
    )
    db.commit()
    return _out(db, row, _names(db, [row]))


@router.post("/{period_id}/unlock")
async def unlock_period(period_id: int, payload: HrPeriodUnlockPayload, db: Session = Depends(get_db), user: User = Depends(require_periods_unlock),
                        background_tasks: BackgroundTasks = None):
    row = db.get(HrAttendancePeriod, period_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Attendance period #{period_id} doesn't exist. Reload the Periods tab.")
    period_lock.unlock(db, row, user, payload.reason)
    record_audit(db, entity_type="hr_attendance_period", entity_id=row.id, action="unlocked", module_key="hr",
                 summary=f"Attendance {period_lock.label(row.year, row.month)} unlocked by {user.name}. Reason: {payload.reason.strip()}",
                 user_id=user.id)
    from app.modules.hr.services import role_events
    plant = db.get(Branch, row.branch_id).name if row.branch_id else "all plants"
    role_events.fire(
        db, background_tasks, "period_unlocked", title=f"Attendance {period_lock.label(row.year, row.month)} unlocked",
        message=(f"{user.name} unlocked attendance of {period_lock.label(row.year, row.month)} for {plant}. "
                 f"Reason: {payload.reason.strip()}. Payroll (ADP) may already have this month — lock it again once the "
                 "corrections are done and re-export."),
        entity_type="hr_attendance_period", entity_id=row.id, actor=user,
    )
    db.commit()
    return _out(db, row, _names(db, [row]))


@router.get("/adp-export")
async def adp_export(year: int = Query(...), month: int = Query(..., ge=1, le=12), branch_id: int | None = Query(None),
                     db: Session = Depends(get_db), user: User = Depends(require_periods_export)):
    """The ADP payroll input, released only for a locked period so the
    portal and payroll can't silently diverge afterwards."""
    if period_lock.locked_period(db, year, month, branch_id) is None:
        plant = db.get(Branch, branch_id).name if branch_id and db.get(Branch, branch_id) else "all plants"
        raise HTTPException(
            status_code=409,
            detail=(f"Lock {period_lock.label(year, month)} for {plant} first (Attendance › Periods), then export for ADP — "
                    "so attendance, leave and overtime can't change after payroll has the numbers."),
        )
    from app.modules.hr.routes.time_evaluation import export_time_evaluation

    return await export_time_evaluation(year=year, month=month, branch_id=branch_id, department_id=None, search=None, db=db, user=user)
