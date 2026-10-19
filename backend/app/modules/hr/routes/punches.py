"""HR — biometric punch log import and evaluation (time events).

- GET  /hr/punches/import/template
- POST /hr/punches/import?dry_run=      CSV / XLSX of employee_code|email, timestamp, direction, device_id
- GET  /hr/punches?user_id=&from=&to=   raw punches
- POST /hr/punches/evaluate             re-build attendance from punches for a date range
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.hr.models.punch import HrPunch
from app.modules.hr.services import punches as svc
from app.modules.hr.services.access import require_hr_tab
from app.modules.hr.services.approvals import employee_scope_filter, ensure_employee_in_scope
from app.modules.hr.services.calendar import IST, daterange
from app.modules.hr.services.time_evaluation import as_ist
from app.modules.main.models.user import User

router = APIRouter(prefix="/hr/punches", tags=["HR"])
require_view = require_hr_tab("attendance")
require_import = require_hr_tab("attendance", "import")
# Attendance › Biometric punches feature (core/features/hr.py)
require_punch_view = require_feature_action("hr", "attendance", "punches", "view")
require_punch_import = require_feature_action("hr", "attendance", "punches", "import")
MAX_UPLOAD = 15 * 1024 * 1024


class HrPunchEvaluatePayload(BaseModel):
    from_date: date
    to_date: date
    user_ids: list[int] | None = None


def _in_scope(db: Session, user: User) -> set[int] | None:
    scope = employee_scope_filter(db, user)
    return None if scope is None else {r[0] for r in db.query(User.id).filter(scope).all()}


def _day_out(r: svc.DayResult, names: dict) -> dict:
    return {"user_id": r.user_id, "user_name": names.get(r.user_id), "date": r.date, "action": r.action,
            "status": r.status, "exceptions": r.exceptions}


@router.get("/import/template")
async def punch_template(_user: User = Depends(require_punch_import)):
    return Response(content=svc.PUNCH_TEMPLATE, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="punch_log_template.csv"'})


@router.post("/import")
async def import_punch_log(file: UploadFile = File(...), dry_run: bool = Query(False), db: Session = Depends(get_db),
                           user: User = Depends(require_punch_import)):
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail=f"'{file.filename}' is larger than 15 MB. Export a shorter date range from the biometric software.")
    rows = svc.read_rows(file.filename or "", content)
    if not rows:
        raise HTTPException(status_code=400, detail="The file has no punch rows under the header. Check the export and the template's column names.")
    res = svc.import_punches(db, rows, user, dry_run=dry_run, in_scope=_in_scope(db, user))
    days: list[svc.DayResult] = []
    if not dry_run:
        days = svc.derive_days(db, {p for p in res.days if p[0] != user.id}, user)
        record_audit(db, entity_type="hr_punch", entity_id=None, action="imported", module_key="hr",
                     summary=(f"Punch log {file.filename} ({res.batch}): {res.inserted} punch(es) loaded, {res.duplicates} duplicate(s), "
                              f"{len(res.errors)} row error(s); {sum(1 for d in days if d.action in ('created', 'updated'))} day(s) evaluated"),
                     user_id=user.id)
        db.commit()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_({d.user_id for d in days} or {-1}))}
    own = any(p[0] == user.id for p in res.days)
    return {
        "dry_run": dry_run, "batch": res.batch, "total_rows": res.total_rows, "inserted": res.inserted,
        "duplicates": res.duplicates, "errors": res.errors,
        "days": [_day_out(d, names) for d in days],
        "exceptions": [_day_out(d, names) for d in days if d.exceptions],
        "note": ("Your own punches were stored but not evaluated — another HR user has to evaluate your days." if own else None),
    }


@router.get("")
async def list_punches(user_id: int = Query(...), from_date: date = Query(..., alias="from"), to_date: date = Query(..., alias="to"),
                       db: Session = Depends(get_db), user: User = Depends(require_punch_view)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Employee #{user_id} doesn't exist.")
    ensure_employee_in_scope(db, user, target)
    if (to_date - from_date).days > 62:
        raise HTTPException(status_code=400, detail="Pick at most 62 days of punches at a time.")
    start = datetime.combine(from_date, time(0, 0)).replace(tzinfo=IST)
    end = datetime.combine(to_date + timedelta(days=1), time(12, 0)).replace(tzinfo=IST)
    rows = (db.query(HrPunch).filter(HrPunch.user_id == user_id, HrPunch.punched_at >= start, HrPunch.punched_at < end)
            .order_by(HrPunch.punched_at).all())
    return [{"id": p.id, "punched_at": as_ist(p.punched_at), "time": as_ist(p.punched_at).strftime("%d-%m-%Y %H:%M"),
             "direction": p.direction, "device_id": p.device_id, "import_batch": p.import_batch} for p in rows]


@router.post("/evaluate")
async def evaluate_punches(payload: HrPunchEvaluatePayload, db: Session = Depends(get_db), user: User = Depends(require_punch_import)):
    if payload.to_date < payload.from_date or (payload.to_date - payload.from_date).days > 62:
        raise HTTPException(status_code=400, detail="Pick a date range of at most 62 days, with the end on or after the start.")
    start = datetime.combine(payload.from_date, time(0, 0)).replace(tzinfo=IST)
    end = datetime.combine(payload.to_date + timedelta(days=1), time(12, 0)).replace(tzinfo=IST)
    q = db.query(HrPunch.user_id).filter(HrPunch.punched_at >= start, HrPunch.punched_at < end)
    if payload.user_ids:
        q = q.filter(HrPunch.user_id.in_(payload.user_ids))
    scope = _in_scope(db, user)
    uids = {r[0] for r in q.distinct().all()} - {user.id}
    if scope is not None:
        uids &= scope
    pairs = {(u, d) for u in uids for d in daterange(payload.from_date, payload.to_date)}
    days = svc.derive_days(db, pairs, user)
    record_audit(db, entity_type="hr_punch", entity_id=None, action="evaluated", module_key="hr",
                 summary=f"Punches re-evaluated {payload.from_date:%d-%m-%Y}–{payload.to_date:%d-%m-%Y}: {len(days)} day(s)", user_id=user.id)
    db.commit()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(uids or {-1}))}
    return {"days": [_day_out(d, names) for d in days], "exceptions": [_day_out(d, names) for d in days if d.exceptions]}
