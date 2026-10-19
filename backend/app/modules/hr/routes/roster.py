"""HR — shift roster (PT01): patterns, roster grid, generation and CSV upload.

- GET/POST/PATCH /hr/roster/patterns[/{id}]     rotation patterns (HR › Masters)
- GET  /hr/roster?from=&to=&branch_id=&department_id=   employees × days grid
- PUT  /hr/roster/cells                          set / clear cells
- POST /hr/roster/generate                       lay a pattern over a date range
- GET  /hr/roster/import/template, POST /hr/roster/import (dry_run)
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.permissions import require_feature_action
from app.db.session import get_db
from app.modules.hr.models.masters import HrShift
from app.modules.hr.models.roster import HrShiftPattern
from app.modules.hr.services import roster as svc
from app.modules.hr.services.access import require_hr_tab
from app.modules.hr.services.approvals import employee_scope_filter
from app.modules.hr.services.attendance import parse_date_cell, read_csv
from app.modules.hr.services.calendar import CalendarCache, active_employees
from app.modules.main.models.user import User

router = APIRouter(prefix="/hr/roster", tags=["HR"])

require_view = require_hr_tab("attendance")
require_edit = require_hr_tab("attendance", "edit")
require_import = require_hr_tab("attendance", "import")
require_masters = require_hr_tab("masters")
# Attendance › Shift roster feature (core/features/hr.py)
require_roster_view = require_feature_action("hr", "attendance", "roster", "view")
require_roster_edit = require_feature_action("hr", "attendance", "roster", "edit")
require_roster_import = require_feature_action("hr", "attendance", "roster", "import")
require_masters_create = require_hr_tab("masters", "create")
require_masters_edit = require_hr_tab("masters", "edit")


class HrShiftPatternCreate(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=150)
    branch_id: int | None = None
    pattern: list[str] = Field(min_length=1)
    description: str | None = None


class HrShiftPatternUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=150)
    branch_id: int | None = None
    pattern: list[str] | None = None
    description: str | None = None
    is_active: bool | None = None


class HrRosterCell(BaseModel):
    user_id: int
    date: date
    shift_id: int | None = None
    is_weekly_off: bool = False
    clear: bool = False
    remarks: str | None = None


class HrRosterCellsPayload(BaseModel):
    cells: list[HrRosterCell] = Field(min_length=1, max_length=5000)


class HrRosterGeneratePayload(BaseModel):
    pattern_id: int
    user_ids: list[int] = Field(min_length=1)
    from_date: date
    to_date: date
    anchor_date: date | None = None
    offsets: dict[int, int] | None = None  # user_id -> start offset in the cycle (stagger crews)
    overwrite: bool = False


def _pattern_out(p: HrShiftPattern) -> dict:
    return {"id": p.id, "code": p.code, "name": p.name, "branch_id": p.branch_id, "cycle_days": p.cycle_days,
            "pattern": p.pattern, "description": p.description, "is_active": p.is_active}


def _scoped_users(db: Session, viewer: User, user_ids: list[int] | None = None, branch_id: int | None = None,
                  department_id: int | None = None) -> list[User]:
    scope = employee_scope_filter(db, viewer)
    in_scope = None if scope is None else {r[0] for r in db.query(User.id).filter(scope).all()}
    cache = CalendarCache(db)
    out = []
    for u, p in active_employees(db):
        if user_ids is not None and u.id not in user_ids:
            continue
        if in_scope is not None and u.id not in in_scope:
            continue
        if branch_id or department_id:
            ctx = cache.context(u, p, load_profile=False)
            if branch_id and ctx.branch_id != branch_id:
                continue
            if department_id and ctx.department_id != department_id:
                continue
        out.append(u)
    return out


@router.get("/patterns")
async def list_patterns(db: Session = Depends(get_db), _user: User = Depends(require_view)):
    return [_pattern_out(p) for p in db.query(HrShiftPattern).order_by(HrShiftPattern.code).all()]


@router.post("/patterns", status_code=201)
async def create_pattern(payload: HrShiftPatternCreate, db: Session = Depends(get_db), user: User = Depends(require_masters_create)):
    code = payload.code.strip().upper()
    if db.query(HrShiftPattern).filter(HrShiftPattern.code == code).first():
        raise HTTPException(status_code=409, detail=f"A shift pattern with code {code} already exists. Use another code or edit that one.")
    pattern = svc.validate_pattern(db, payload.pattern, payload.branch_id)
    p = HrShiftPattern(code=code, name=payload.name.strip(), branch_id=payload.branch_id, cycle_days=len(pattern),
                       pattern=pattern, description=payload.description, created_by_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _pattern_out(p)


@router.patch("/patterns/{pattern_id}")
async def update_pattern(pattern_id: int, payload: HrShiftPatternUpdate, db: Session = Depends(get_db), _user: User = Depends(require_masters_edit)):
    p = db.get(HrShiftPattern, pattern_id)
    if p is None:
        raise HTTPException(status_code=404, detail=f"Shift pattern #{pattern_id} doesn't exist. Reload the list.")
    data = payload.model_dump(exclude_unset=True)
    if "pattern" in data or "branch_id" in data:
        pattern = svc.validate_pattern(db, data.get("pattern") or p.pattern, data.get("branch_id", p.branch_id))
        p.pattern, p.cycle_days = pattern, len(pattern)
    for k in ("name", "branch_id", "description", "is_active"):
        if k in data:
            setattr(p, k, data[k])
    db.commit()
    return _pattern_out(p)


@router.get("")
async def roster_grid(
    from_date: date = Query(..., alias="from"), to_date: date = Query(..., alias="to"),
    branch_id: int | None = Query(None), department_id: int | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_roster_view),
):
    users = _scoped_users(db, user, branch_id=branch_id, department_id=department_id)
    shifts = [{"id": s.id, "code": s.code, "name": s.name, "branch_id": s.branch_id}
              for s in db.query(HrShift).filter(HrShift.is_active.is_(True)).order_by(HrShift.code).all()]
    return {"from": from_date, "to": to_date, "shifts": shifts, "items": svc.grid(db, users, from_date, to_date)}


@router.put("/cells")
async def set_cells(payload: HrRosterCellsPayload, db: Session = Depends(get_db), user: User = Depends(require_roster_edit)):
    allowed = {u.id: u for u in _scoped_users(db, user, user_ids=[c.user_id for c in payload.cells])}
    cache = CalendarCache(db)
    shifts = {s.id: s for s in db.query(HrShift).all()}
    saved = 0
    errors: list[dict] = []
    for c in payload.cells:
        u = allowed.get(c.user_id)
        if u is None:
            errors.append({"user_id": c.user_id, "date": c.date, "message": "Employee not found, inactive, or outside your HR data access."})
            continue
        shift = shifts.get(c.shift_id) if c.shift_id else None
        if c.shift_id and shift is None:
            errors.append({"user_id": c.user_id, "date": c.date, "message": f"Shift #{c.shift_id} doesn't exist."})
            continue
        try:
            svc.set_cell(db, cache, u, c.date, shift, c.is_weekly_off, source="manual", actor=user, remarks=c.remarks, clear=c.clear)
            saved += 1
        except HTTPException as exc:
            errors.append({"user_id": c.user_id, "date": c.date, "message": str(exc.detail)})
    if errors and not saved:
        db.rollback()
        raise HTTPException(status_code=409 if any("locked" in e["message"] for e in errors) else 400,
                            detail="No roster cell was saved: " + "; ".join(f"{e['date']}: {e['message']}" for e in errors[:5]))
    db.commit()
    return {"saved": saved, "errors": errors}


@router.post("/generate")
async def generate_roster(payload: HrRosterGeneratePayload, db: Session = Depends(get_db), user: User = Depends(require_roster_edit)):
    pattern = db.get(HrShiftPattern, payload.pattern_id)
    if pattern is None:
        raise HTTPException(status_code=404, detail=f"Shift pattern #{payload.pattern_id} doesn't exist. Pick a pattern from the list.")
    users = _scoped_users(db, user, user_ids=payload.user_ids)
    if not users:
        raise HTTPException(status_code=400, detail="None of the picked employees is active and within your HR data access.")
    result = svc.generate(db, pattern, users, payload.from_date, payload.to_date, anchor=payload.anchor_date,
                          offset_by_user=payload.offsets, overwrite=payload.overwrite, actor=user)
    record_audit(db, entity_type="hr_shift_roster", entity_id=pattern.id, action="generated", module_key="hr",
                 summary=f"Roster generated from {pattern.code} for {len(users)} employee(s), {payload.from_date:%d-%m-%Y} to "
                         f"{payload.to_date:%d-%m-%Y}: {result['created']} new, {result['updated']} replaced, {len(result['skipped'])} skipped",
                 user_id=user.id)
    db.commit()
    return result


@router.get("/import/template")
async def roster_template(_user: User = Depends(require_roster_import)):
    return Response(content=svc.ROSTER_TEMPLATE, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="shift_roster_template.csv"'})


@router.post("/import")
async def import_roster(file: UploadFile = File(...), dry_run: bool = Query(False), db: Session = Depends(get_db),
                        user: User = Depends(require_roster_import)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail=f"'{file.filename}' isn't a CSV file. Download the template, fill it and save as CSV.")
    content = await file.read()
    _, rows = read_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="The file has no data rows under the header. Fill the template and upload again.")
    if len(rows) > 20000:
        raise HTTPException(status_code=400, detail=f"The file has {len(rows):,} rows; the limit is 20,000. Split it by date range.")
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    allowed = {u.id: u for u in _scoped_users(db, user)}
    by_email = {u.email.lower(): u for u in allowed.values() if u.email}
    by_code = {p.employee_code.strip().lower(): p.user_id for p in
               db.query(HrEmployeeProfile).filter(HrEmployeeProfile.employee_code.isnot(None), HrEmployeeProfile.user_id.isnot(None)).all()}
    shifts = svc.shifts_by_code(db)
    cache = CalendarCache(db)
    saved, errors = 0, []
    for idx, r in enumerate(rows, start=2):
        ident = r.get("employee_code") or r.get("email") or ""

        def err(m):
            errors.append({"row": idx, "identifier": ident, "message": m})

        u = None
        if r.get("employee_code"):
            u = allowed.get(by_code.get(r["employee_code"].lower()))
        elif r.get("email"):
            u = by_email.get(r["email"].lower())
        if u is None:
            err("Employee not found, inactive or outside your HR data access. Check the code / email against HR > Employees.")
            continue
        d = parse_date_cell(r.get("date", ""))
        if d is None:
            err(f"Date '{r.get('date', '')}' isn't valid. Use YYYY-MM-DD or DD-MM-YYYY.")
            continue
        off = svc.parse_bool(r.get("weekly_off", ""))
        code = (r.get("shift") or "").strip().upper()
        shift = shifts.get(code) if code else None
        if code and shift is None:
            err(f"Shift '{code}' doesn't exist. Use a code from HR > Masters > Shifts.")
            continue
        try:
            if dry_run:
                if u.id == user.id:
                    raise HTTPException(status_code=403, detail="You can't change your own shift roster.")
                from app.modules.hr.services import period_lock

                period_lock.assert_open(db, u.id, d)
                if shift is None and not off:
                    raise HTTPException(status_code=400, detail="Give a shift code or weekly_off = yes.")
            else:
                svc.set_cell(db, cache, u, d, shift, off, source="import", actor=user)
            saved += 1
        except HTTPException as exc:
            err(str(exc.detail))
    if not dry_run:
        record_audit(db, entity_type="hr_shift_roster", entity_id=None, action="imported", module_key="hr",
                     summary=f"Roster imported from {file.filename}: {saved} day(s) saved, {len(errors)} row error(s)", user_id=user.id)
        db.commit()
    return {"dry_run": dry_run, "total_rows": len(rows), "saved": saved, "errors": errors}
