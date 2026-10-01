"""HR & Administration — attendance register, self check-in/out and regularizations.

Owner: Agent C. HR-management endpoints use `Depends(require_hr)`;
self-service endpoints use `Depends(get_current_user)` (see
app/modules/hr/services/access.py). Helpers live in
app/modules/hr/services/attendance.py and services/calendar.py."""
import csv
import io
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.attendance import HrAttendance, HrAttendanceRegularization, REGULARIZATION_STATUSES
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.schemas.attendance import (
    HrAttendanceBulkPayload,
    HrAttendanceCheckPayload,
    HrAttendanceCreate,
    HrAttendanceRegularizationCreate,
    HrAttendanceRegularizationDecisionPayload,
    HrAttendanceRegularizationResponse,
    HrAttendanceResponse,
)
from app.modules.hr.services.access import can_decide, ensure_can_decide, is_hr, require_hr
from app.modules.hr.services.attendance import (
    IMPORT_TEMPLATE,
    STATUS_ALIASES,
    STATUS_LABELS,
    SUMMARY_KEYS,
    day_view,
    fmt_time,
    late_minutes,
    month_bounds,
    month_days,
    parse_date_cell,
    parse_time_cell,
    read_csv,
    resolve_check_times,
    rows_for,
    summarize,
    upsert_attendance,
)
from app.modules.hr.services.calendar import CalendarCache, EmployeeContext, active_employees, now_ist, today_ist
from app.modules.hr.services.leave import fmt_date
from app.modules.hr.services.lookup import department_names, profiles_by_user, user_department_name, users_by_id
from app.utils.notifications import notify_user

router = APIRouter(prefix="/hr/attendance", tags=["HR"])

SELF_ATTENDANCE_MSG = (
    "You can't mark or change your own attendance here. Ask another HR user to do it, "
    "or raise a regularization request from My HR > Attendance."
)

NOTIFY_TYPE = "hr_attendance"
REG_ENTITY = "hr_attendance_regularization"
REGULARIZATION_WINDOW_DAYS = 60


def _row_response(row: HrAttendance, cache: CalendarCache | None = None, ctx: EmployeeContext | None = None) -> HrAttendanceResponse:
    shift = (cache.shift(row.shift_id) if cache else None) or (ctx.shift if ctx else None)
    return HrAttendanceResponse.model_validate(row).model_copy(update={
        "check_in_time": fmt_time(row.check_in), "check_out_time": fmt_time(row.check_out),
        "late_minutes": late_minutes(row.check_in, shift),
    })


def _employees(db: Session, cache: CalendarCache, branch_id: int | None, department_id: int | None, search: str | None, user_id: int | None = None) -> list[EmployeeContext]:
    term = (search or "").strip().lower()
    out = []
    for user, profile in active_employees(db):
        if user_id and user.id != user_id:
            continue
        ctx = cache.context(user, profile, load_profile=False)
        if branch_id and ctx.branch_id != branch_id:
            continue
        if department_id and ctx.department_id != department_id:
            continue
        if term and term not in (user.name or "").lower() and term not in (user.email or "").lower() and term not in (ctx.employee_code or "").lower():
            continue
        out.append(ctx)
    return out


def _employee_brief(ctx: EmployeeContext, branches: dict[int, str]) -> dict:
    return {
        "user_id": ctx.user.id, "user_name": ctx.user.name, "user_email": ctx.user.email,
        "employee_code": ctx.employee_code, "department_name": ctx.department_name,
        "branch_id": ctx.branch_id, "branch_name": branches.get(ctx.branch_id or 0),
        "shift_name": ctx.shift.name if ctx.shift else None,
    }


def _branch_map(db: Session) -> dict[int, str]:
    return {b.id: b.name for b in db.query(Branch.id, Branch.name).all()}


def _leave_row_guard(row: HrAttendance | None, who: str, d: date) -> None:
    if row is not None and row.source == "leave":
        raise HTTPException(
            status_code=409,
            detail=(
                f"{who} is on approved leave on {fmt_date(d)} ({row.remarks or 'leave'}). Changing this day here would "
                "leave their leave balance wrong — cancel or change the leave request instead."
            ),
        )


# ─────────────────────────────── Lookups ───────────────────────────────
@router.get("/lookups")
async def attendance_lookups(db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    """Filters and employee pickers for the HR leave/attendance screens."""
    cache = CalendarCache(db)
    branches = _branch_map(db)
    employees = [_employee_brief(cache.context(u, p, load_profile=False), branches) for u, p in active_employees(db)]
    return {
        "branches": [{"id": k, "name": v} for k, v in sorted(branches.items(), key=lambda kv: kv[1])],
        "departments": [{"id": d.id, "name": d.name, "branch_id": d.branch_id} for d in db.query(Department).order_by(Department.name).all()],
        "employees": employees,
        "statuses": [{"value": k, "label": v} for k, v in STATUS_LABELS.items() if k != "unmarked"],
    }


# ─────────────────────────────── Self service ───────────────────────────────
def _today_payload(db: Session, user: User) -> dict:
    cache = CalendarCache(db)
    ctx = cache.context(user)
    today = today_ist()
    row = db.query(HrAttendance).filter(HrAttendance.user_id == user.id, HrAttendance.attendance_date == today).first()
    view = day_view(cache, ctx, today, row, today)
    shift = ctx.shift
    on_full_leave = bool(row and row.source == "leave" and row.status == "on_leave")
    return {
        "date": today,
        "now": now_ist(),
        "day": view.as_dict(),
        "shift": {
            "id": shift.id, "name": shift.name, "start_time": shift.start_time.strftime("%H:%M"),
            "end_time": shift.end_time.strftime("%H:%M"), "grace_minutes": shift.grace_minutes,
        } if shift else None,
        "can_check_in": not on_full_leave and not (row and row.check_in),
        "can_check_out": bool(row and row.check_in and not row.check_out),
        "on_leave": on_full_leave,
    }


@router.get("/me/today")
async def my_today(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _today_payload(db, user)


@router.post("/me/check-in")
async def my_check_in(payload: HrAttendanceCheckPayload | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = today_ist()
    cache = CalendarCache(db)
    ctx = cache.context(user)
    row = db.query(HrAttendance).filter(HrAttendance.user_id == user.id, HrAttendance.attendance_date == today).first()
    if row and row.check_in:
        raise HTTPException(
            status_code=400,
            detail=f"You already checked in today at {fmt_time(row.check_in)}. Only one check-in per day is allowed — use Check out when you leave.",
        )
    if row and row.source == "leave" and row.status == "on_leave":
        raise HTTPException(
            status_code=400,
            detail=f"You're on approved leave today ({row.remarks}). If you came to work, cancel the leave first or ask HR to mark your attendance.",
        )
    now = now_ist()
    remarks = (payload.remarks or "").strip() if payload and payload.remarks else None
    if row is None:
        kind, name = cache.day_kind(ctx, today)
        if kind != "working" and not remarks:
            remarks = f"Worked on {'holiday ' + name if name else 'weekly off'}"
        row = HrAttendance(
            user_id=user.id, attendance_date=today, status="present", source="self",
            check_in=now, shift_id=ctx.shift.id if ctx.shift else None, remarks=remarks, marked_by_id=user.id,
        )
        db.add(row)
    else:
        # Half-day leave row (or HR pre-marked row): keep the status, record the time.
        row.check_in = now
        if row.source != "leave":
            row.source = "self"
            row.status = "present"
        if remarks:
            row.remarks = remarks
        if ctx.shift and not row.shift_id:
            row.shift_id = ctx.shift.id
    db.commit()
    return _today_payload(db, user)


@router.post("/me/check-out")
async def my_check_out(payload: HrAttendanceCheckPayload | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = today_ist()
    row = db.query(HrAttendance).filter(HrAttendance.user_id == user.id, HrAttendance.attendance_date == today).first()
    if not row or not row.check_in:
        raise HTTPException(status_code=400, detail="You haven't checked in today, so there is nothing to check out of. Check in first, or raise a regularization request if you forgot.")
    if row.check_out:
        raise HTTPException(status_code=400, detail=f"You already checked out today at {fmt_time(row.check_out)}. If that time is wrong, raise a regularization request.")
    row.check_out = now_ist()
    if payload and payload.remarks and payload.remarks.strip():
        row.remarks = (row.remarks + " · " if row.remarks else "") + payload.remarks.strip()
    db.commit()
    return _today_payload(db, user)


def _month_payload(db: Session, target: User, year: int, month: int) -> dict:
    start, end = month_bounds(year, month)
    cache = CalendarCache(db)
    ctx = cache.context(target)
    rows = rows_for(db, [target.id], start, end)
    days = month_days(cache, ctx, start, end, rows)
    return {
        "user_id": target.id, "user_name": target.name, "employee_code": ctx.employee_code,
        "department_name": ctx.department_name, "shift_name": ctx.shift.name if ctx.shift else None,
        "year": year, "month": month, "days": [d.as_dict() for d in days], "counts": summarize(days),
    }


@router.get("/me/month")
async def my_month(year: int | None = Query(None), month: int | None = Query(None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = today_ist()
    return _month_payload(db, user, year or t.year, month or t.month)


# ─────────────────────────────── HR register ───────────────────────────────
@router.get("/month")
async def employee_month(
    user_id: int = Query(...),
    year: int | None = Query(None),
    month: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail=f"Employee #{user_id} doesn't exist. Pick the employee again from the list.")
    if target.id != user.id and not is_hr(user) and target.reporting_manager_id != user.id:
        raise HTTPException(status_code=403, detail="You can see attendance only for yourself and your direct reports. Ask HR for anyone else's.")
    t = today_ist()
    return _month_payload(db, target, year or t.year, month or t.month)


@router.get("/register")
async def date_register(
    attendance_date: date | None = Query(None, alias="date"),
    branch_id: int | None = Query(None),
    department_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    d = attendance_date or today_ist()
    cache = CalendarCache(db)
    branches = _branch_map(db)
    emps = _employees(db, cache, branch_id, department_id, search)
    rows = rows_for(db, [c.user.id for c in emps], d, d)
    today = today_ist()
    items = []
    for ctx in emps:
        v = day_view(cache, ctx, d, rows.get((ctx.user.id, d)), today)
        items.append({**_employee_brief(ctx, branches), **v.as_dict()})
    counts: dict[str, int] = {k: 0 for k in SUMMARY_KEYS}
    for it in items:
        if it["status"] in counts:
            counts[it["status"]] += 1
    return {"date": d, "items": items, "counts": counts, "total": len(items)}


@router.put("/entries", response_model=HrAttendanceResponse)
async def mark_attendance(payload: HrAttendanceCreate, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    target = db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail=f"Employee #{payload.user_id} doesn't exist. Pick the employee again from the list.")
    if target.id == user.id:
        raise HTTPException(status_code=403, detail=SELF_ATTENDANCE_MSG)
    if payload.attendance_date > today_ist() and payload.status not in ("on_duty", "work_from_home", "absent"):
        raise HTTPException(
            status_code=400,
            detail=f"{fmt_date(payload.attendance_date)} is in the future. Only On duty, Work from home or Absent can be marked ahead of time; leave goes through a leave request.",
        )
    cache = CalendarCache(db)
    ctx = cache.context(target)
    existing = db.query(HrAttendance).filter(HrAttendance.user_id == target.id, HrAttendance.attendance_date == payload.attendance_date).first()
    _leave_row_guard(existing, target.name, payload.attendance_date)
    if payload.status == "on_leave":
        raise HTTPException(
            status_code=400,
            detail="Leave days are created by approving a leave request so the balance is deducted. Apply leave for the employee (HR → Leave) instead of marking 'On leave' here.",
        )
    ci, co = resolve_check_times(payload.attendance_date, payload.check_in, payload.check_out, ctx.shift)
    row, _ = upsert_attendance(
        db, user_id=target.id, attendance_date=payload.attendance_date, status=payload.status, source="manual",
        actor_id=user.id, check_in=ci, check_out=co, remarks=payload.remarks or "",
        shift_id=ctx.shift.id if ctx.shift else None,
    )
    db.commit()
    db.refresh(row)
    return _row_response(row, cache, ctx)


@router.delete("/entries/{entry_id}")
async def delete_attendance(entry_id: int, db: Session = Depends(get_db), _user: User = Depends(require_hr)):
    row = db.get(HrAttendance, entry_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"Attendance entry #{entry_id} doesn't exist. Refresh the register — it may already be cleared.")
    if row.user_id == _user.id:
        raise HTTPException(status_code=403, detail=SELF_ATTENDANCE_MSG)
    target = db.get(User, row.user_id)
    _leave_row_guard(row, target.name if target else "This employee", row.attendance_date)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.put("/register/bulk")
async def bulk_mark(payload: HrAttendanceBulkPayload, db: Session = Depends(get_db), user: User = Depends(require_hr)):
    if payload.status == "on_leave":
        raise HTTPException(status_code=400, detail="Leave days come from approved leave requests so balances stay right. Pick another status for bulk marking.")
    if payload.attendance_date > today_ist() and payload.status not in ("on_duty", "work_from_home", "absent", "holiday", "weekly_off"):
        raise HTTPException(status_code=400, detail=f"{fmt_date(payload.attendance_date)} is in the future, so employees can't be marked {STATUS_LABELS[payload.status]} yet.")
    cache = CalendarCache(db)
    users = users_by_id(db, payload.user_ids)
    profiles = profiles_by_user(db, payload.user_ids)
    existing = rows_for(db, list(users.keys()), payload.attendance_date, payload.attendance_date)
    updated = created = 0
    skipped: list[dict] = []
    for uid in payload.user_ids:
        u = users.get(uid)
        if not u:
            skipped.append({"user_id": uid, "user_name": None, "reason": "Employee not found."})
            continue
        if uid == user.id:
            skipped.append({"user_id": uid, "user_name": u.name, "reason": "You can't mark your own attendance. Ask another HR user to do it."})
            continue
        row = existing.get((uid, payload.attendance_date))
        if row is not None and row.source == "leave":
            skipped.append({"user_id": uid, "user_name": u.name, "reason": f"On approved leave ({row.remarks}). Cancel the leave to change this day."})
            continue
        if row is not None and not payload.overwrite_existing:
            skipped.append({"user_id": uid, "user_name": u.name, "reason": f"Already marked {STATUS_LABELS.get(row.status, row.status)}."})
            continue
        ctx = cache.context(u, profiles.get(uid), load_profile=False)
        _, was_created = upsert_attendance(
            db, user_id=uid, attendance_date=payload.attendance_date, status=payload.status, source="manual",
            actor_id=user.id, remarks=payload.remarks if payload.remarks is not None else None,
            shift_id=ctx.shift.id if ctx.shift else None, keep_times=True,
        )
        created += int(was_created)
        updated += int(not was_created)
    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped}


# ─────────────────────────────── Import ───────────────────────────────
@router.get("/import/template")
async def import_template(_user: User = Depends(require_hr)):
    return Response(
        content=IMPORT_TEMPLATE, media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="attendance_import_template.csv"'},
    )


@router.post("/import")
async def import_attendance(
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    name = (file.filename or "").lower()
    if not name.endswith(".csv"):
        raise HTTPException(status_code=400, detail=f"'{file.filename}' isn't a CSV file. Save the sheet as CSV (Comma delimited) and upload that — download the template to see the columns.")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="The CSV is larger than 5 MB. Split it into smaller files (e.g. one month per file) and import each.")
    headers, rows = read_csv(content)
    missing = [h for h in ("date", "status") if h not in headers]
    if missing or not ({"email", "employee_code"} & set(headers)):
        raise HTTPException(
            status_code=400,
            detail=(
                f"The CSV header row is {', '.join(headers) or '(empty)'}; it must include 'date', 'status' and either 'email' "
                "or 'employee_code' (plus optional check_in, check_out, remarks). Download the template and copy your data into it."
            ),
        )
    if len(rows) > 20000:
        raise HTTPException(status_code=400, detail=f"The CSV has {len(rows)} rows; the limit is 20,000 per import. Split it into smaller files.")

    by_email = {u.email.lower(): u for u in db.query(User).all() if u.email}
    by_code = {}
    for p in db.query(HrEmployeeProfile).filter(HrEmployeeProfile.employee_code.isnot(None)).all():
        by_code[p.employee_code.strip().lower()] = p.user_id
    cache = CalendarCache(db)
    ctx_cache: dict[int, EmployeeContext] = {}
    today = today_ist()
    errors: list[dict] = []
    created = updated = 0
    seen: set[tuple[int, date]] = set()

    for idx, r in enumerate(rows, start=2):  # row 1 is the header
        ident = r.get("email") or r.get("employee_code") or ""
        def err(msg: str):
            errors.append({"row": idx, "identifier": ident, "message": msg})
        target: User | None = None
        if r.get("email"):
            target = by_email.get(r["email"].lower())
            if not target:
                err(f"No portal user has the email '{r['email']}'. Check the spelling or use the employee code.")
                continue
        elif r.get("employee_code"):
            uid = by_code.get(r["employee_code"].lower())
            target = db.get(User, uid) if uid else None
            if not target:
                err(f"No employee has the code '{r['employee_code']}'. Check it against HR → Employees.")
                continue
        else:
            err("Both email and employee_code are empty. Fill one of them.")
            continue
        if target.id == user.id:
            err("This row is your own attendance, which you can't import yourself. Remove it and ask another HR user to import it.")
            continue
        d = parse_date_cell(r.get("date", ""))
        if not d:
            err(f"Date '{r.get('date', '')}' isn't a valid date. Use YYYY-MM-DD or DD-MM-YYYY.")
            continue
        if d > today:
            err(f"{fmt_date(d)} is in the future. Only past or today's attendance can be imported.")
            continue
        status = STATUS_ALIASES.get((r.get("status") or "").strip().lower())
        if not status:
            err(f"Status '{r.get('status', '')}' isn't recognised. Use present, absent, half_day, on_duty, work_from_home, holiday or weekly_off (or P, A, HD, OD, WFH, H, WO).")
            continue
        if status == "on_leave":
            err("'On leave' can't be imported — leave days come from approved leave requests so balances stay right. Apply the leave instead.")
            continue
        ci_t = parse_time_cell(r.get("check_in", ""))
        co_t = parse_time_cell(r.get("check_out", ""))
        if ci_t == "invalid" or co_t == "invalid":
            err(f"Check-in/out time '{r.get('check_in', '')}' / '{r.get('check_out', '')}' isn't valid. Use 24-hour HH:MM, e.g. 09:05.")
            continue
        key = (target.id, d)
        if key in seen:
            err(f"{target.name} on {fmt_date(d)} appears more than once in this file. Keep one row per employee per day.")
            continue
        seen.add(key)
        ctx = ctx_cache.get(target.id) or cache.context(target)
        ctx_cache[target.id] = ctx
        try:
            ci, co = resolve_check_times(d, ci_t, co_t, ctx.shift)
        except HTTPException as exc:
            err(str(exc.detail))
            continue
        existing = db.query(HrAttendance).filter(HrAttendance.user_id == target.id, HrAttendance.attendance_date == d).first()
        if existing is not None and existing.source == "leave":
            err(f"{target.name} is on approved leave on {fmt_date(d)} ({existing.remarks}). Cancel the leave to change this day.")
            continue
        if dry_run:
            created += int(existing is None)
            updated += int(existing is not None)
            continue
        _, was_created = upsert_attendance(
            db, user_id=target.id, attendance_date=d, status=status, source="import", actor_id=user.id,
            check_in=ci, check_out=co, remarks=r.get("remarks") or "", shift_id=ctx.shift.id if ctx.shift else None,
        )
        created += int(was_created)
        updated += int(not was_created)

    if not dry_run:
        record_audit(
            db, entity_type="hr_attendance", entity_id=None, action="imported", module_key="hr",
            summary=f"Imported attendance from {file.filename}: {created} created, {updated} updated, {len(errors)} rows with errors",
            new_value={"file": file.filename, "created": created, "updated": updated, "errors": len(errors)}, user_id=user.id,
        )
        db.commit()
    return {"dry_run": dry_run, "total_rows": len(rows), "created": created, "updated": updated, "errors": errors}


# ─────────────────────────────── Summary ───────────────────────────────
def _summary(db: Session, year: int, month: int, branch_id: int | None, department_id: int | None, search: str | None) -> dict:
    start, end = month_bounds(year, month)
    cache = CalendarCache(db)
    branches = _branch_map(db)
    emps = _employees(db, cache, branch_id, department_id, search)
    rows = rows_for(db, [c.user.id for c in emps], start, end)
    items = []
    for ctx in emps:
        days = month_days(cache, ctx, start, end, rows)
        items.append({**_employee_brief(ctx, branches), **summarize(days)})
    return {"year": year, "month": month, "from_date": start, "to_date": end, "items": items}


@router.get("/summary")
async def monthly_summary(
    year: int | None = Query(None),
    month: int | None = Query(None),
    branch_id: int | None = Query(None),
    department_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    t = today_ist()
    return _summary(db, year or t.year, month or t.month, branch_id, department_id, search)


@router.get("/summary/export")
async def export_summary(
    year: int | None = Query(None),
    month: int | None = Query(None),
    branch_id: int | None = Query(None),
    department_id: int | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_hr),
):
    t = today_ist()
    data = _summary(db, year or t.year, month or t.month, branch_id, department_id, search)
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["present", "absent", "half_day", "on_leave", "on_duty", "work_from_home", "holiday", "weekly_off", "unmarked", "late_days", "present_equivalent"]
    w.writerow(["Employee", "Email", "Employee code", "Department", "Plant", *[STATUS_LABELS.get(c, c.replace("_", " ").title()) for c in cols]])
    for it in data["items"]:
        w.writerow([it["user_name"], it["user_email"], it["employee_code"] or "", it["department_name"] or "", it["branch_name"] or "", *[it[c] for c in cols]])
    fname = f"attendance_summary_{data['year']}_{data['month']:02d}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ─────────────────────────────── Regularizations ───────────────────────────────
def _reg_responses(db: Session, rows: list[HrAttendanceRegularization], viewer: User) -> list[HrAttendanceRegularizationResponse]:
    users = users_by_id(db, [r.user_id for r in rows] + [r.approver_id for r in rows] + [r.decided_by_id for r in rows])
    profiles = profiles_by_user(db, [r.user_id for r in rows])
    depts = department_names(db)
    current: dict[tuple[int, date], str] = {}
    if rows:
        for a in db.query(HrAttendance).filter(
            HrAttendance.user_id.in_({r.user_id for r in rows}),
            HrAttendance.attendance_date.in_({r.attendance_date for r in rows}),
        ).all():
            current[(a.user_id, a.attendance_date)] = a.status
    out = []
    for r in rows:
        u, p = users.get(r.user_id), profiles.get(r.user_id)
        a, d = users.get(r.approver_id or 0), users.get(r.decided_by_id or 0)
        out.append(HrAttendanceRegularizationResponse.model_validate(r).model_copy(update={
            "check_in_time": fmt_time(r.check_in), "check_out_time": fmt_time(r.check_out),
            "user_name": u.name if u else None, "user_email": u.email if u else None,
            "employee_code": p.employee_code if p else None, "department_name": user_department_name(u, p, depts),
            "approver_name": a.name if a else None, "decided_by_name": d.name if d else None,
            "current_status": current.get((r.user_id, r.attendance_date)),
            "can_decide": r.status == "pending" and can_decide(viewer, r.approver_id, r.user_id),
            "can_cancel": r.status == "pending" and (viewer.id == r.user_id or is_hr(viewer)),
        }))
    return out


def _load_reg(db: Session, reg_id: int, lock: bool = False) -> HrAttendanceRegularization:
    """`lock=True` for approve/reject/cancel (SELECT ... FOR UPDATE) so two
    concurrent decisions on one request are serialised."""
    if lock:
        reg = (
            db.query(HrAttendanceRegularization).filter(HrAttendanceRegularization.id == reg_id)
            .with_for_update().populate_existing().first()
        )
    else:
        reg = db.get(HrAttendanceRegularization, reg_id)
    if not reg:
        raise HTTPException(status_code=404, detail=f"Regularization request #{reg_id} doesn't exist. Refresh the list — it may have been removed.")
    return reg


@router.post("/regularizations", response_model=HrAttendanceRegularizationResponse)
async def request_regularization(payload: HrAttendanceRegularizationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    today = today_ist()
    d = payload.attendance_date
    if d > today:
        raise HTTPException(status_code=400, detail=f"{fmt_date(d)} is in the future. Regularization corrects a past day — for planned days out use a leave or travel request.")
    if (today - d).days > REGULARIZATION_WINDOW_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"{fmt_date(d)} is more than {REGULARIZATION_WINDOW_DAYS} days ago, which is outside the regularization window. Ask HR to correct it directly.",
        )
    if payload.requested_status in ("present", "half_day") and not payload.check_in:
        raise HTTPException(status_code=400, detail="Enter the time you actually checked in so your approver can verify it.")
    existing = db.query(HrAttendance).filter(HrAttendance.user_id == user.id, HrAttendance.attendance_date == d).first()
    if existing is not None and existing.source == "leave" and existing.status == "on_leave":
        raise HTTPException(
            status_code=400,
            detail=f"You're on approved leave on {fmt_date(d)} ({existing.remarks}). If you actually worked that day, cancel the leave (if not started) or ask HR.",
        )
    dup = db.query(HrAttendanceRegularization).filter(
        HrAttendanceRegularization.user_id == user.id,
        HrAttendanceRegularization.attendance_date == d,
        HrAttendanceRegularization.status == "pending",
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"You already have a pending request {dup.request_no} for {fmt_date(d)}. Cancel it first if you want to change the details.")
    cache = CalendarCache(db)
    ctx = cache.context(user)
    ci, co = resolve_check_times(d, payload.check_in, payload.check_out, ctx.shift)
    reg = HrAttendanceRegularization(
        request_no=next_sequential_id(db, prefix=f"AR-{today.year}-", column=HrAttendanceRegularization.request_no),
        user_id=user.id, attendance_date=d, requested_status=payload.requested_status,
        check_in=ci, check_out=co, reason=payload.reason.strip(), status="pending",
        approver_id=user.reporting_manager_id,
    )
    db.add(reg)
    db.flush()
    if reg.approver_id:
        notify_user(
            db, reg.approver_id, "Attendance correction waiting for you",
            f"{user.name} asked to mark {fmt_date(d)} as {STATUS_LABELS[payload.requested_status]} ({reg.request_no}).",
            NOTIFY_TYPE, REG_ENTITY, reg.id, teams=True,
        )
    db.commit()
    db.refresh(reg)
    return _reg_responses(db, [reg], user)[0]


@router.get("/regularizations/me", response_model=list[HrAttendanceRegularizationResponse])
async def my_regularizations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(HrAttendanceRegularization)
        .filter(HrAttendanceRegularization.user_id == user.id)
        .order_by(HrAttendanceRegularization.attendance_date.desc(), HrAttendanceRegularization.id.desc())
        .limit(200).all()
    )
    return _reg_responses(db, rows, user)


@router.get("/regularizations/pending-for-me", response_model=list[HrAttendanceRegularizationResponse])
async def regularizations_pending_for_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(HrAttendanceRegularization).filter(
        HrAttendanceRegularization.status == "pending", HrAttendanceRegularization.user_id != user.id,
    )
    if is_hr(user):
        q = q.filter(or_(HrAttendanceRegularization.approver_id == user.id, HrAttendanceRegularization.approver_id.is_(None)))
    else:
        q = q.filter(HrAttendanceRegularization.approver_id == user.id)
    return _reg_responses(db, q.order_by(HrAttendanceRegularization.attendance_date.asc()).all(), user)


@router.get("/regularizations", response_model=list[HrAttendanceRegularizationResponse])
async def list_regularizations(
    status: str | None = Query(None),
    user_id: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_hr),
):
    q = db.query(HrAttendanceRegularization)
    if status:
        if status not in REGULARIZATION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown status '{status}'. Use one of: {', '.join(REGULARIZATION_STATUSES)}.")
        q = q.filter(HrAttendanceRegularization.status == status)
    if user_id:
        q = q.filter(HrAttendanceRegularization.user_id == user_id)
    if date_from:
        q = q.filter(HrAttendanceRegularization.attendance_date >= date_from)
    if date_to:
        q = q.filter(HrAttendanceRegularization.attendance_date <= date_to)
    rows = q.order_by(HrAttendanceRegularization.attendance_date.desc(), HrAttendanceRegularization.id.desc()).limit(1000).all()
    return _reg_responses(db, rows, user)


def _reg_pending_or_400(reg: HrAttendanceRegularization, verb: str) -> None:
    if reg.status != "pending":
        raise HTTPException(status_code=400, detail=f"{reg.request_no} is already {reg.status}, so it can't be {verb}. Refresh the page to see its latest status.")


@router.post("/regularizations/{reg_id}/approve", response_model=HrAttendanceRegularizationResponse)
async def approve_regularization(
    reg_id: int,
    payload: HrAttendanceRegularizationDecisionPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reg = _load_reg(db, reg_id, lock=True)
    ensure_can_decide(user, reg.approver_id, reg.user_id, "attendance regularization")
    _reg_pending_or_400(reg, "approved")
    requester = db.get(User, reg.user_id)
    existing = db.query(HrAttendance).filter(HrAttendance.user_id == reg.user_id, HrAttendance.attendance_date == reg.attendance_date).first()
    if existing is not None and existing.source == "leave" and existing.status == "on_leave":
        raise HTTPException(
            status_code=409,
            detail=f"{requester.name} is on approved leave on {fmt_date(reg.attendance_date)} ({existing.remarks}). Reject this request, or cancel that leave first.",
        )
    cache = CalendarCache(db)
    ctx = cache.context(requester)
    upsert_attendance(
        db, user_id=reg.user_id, attendance_date=reg.attendance_date, status=reg.requested_status, source="regularization",
        actor_id=user.id, check_in=reg.check_in, check_out=reg.check_out, remarks=f"Regularized {reg.request_no}: {reg.reason or ''}".strip(),
        shift_id=ctx.shift.id if ctx.shift else None,
    )
    reg.status = "approved"
    reg.decided_by_id = user.id
    reg.decided_at = datetime.now(timezone.utc)
    reg.decision_remarks = ((payload.remarks or "").strip() or None) if payload else None
    record_audit(
        db, entity_type=REG_ENTITY, entity_id=reg.id, action="approved", module_key="hr",
        summary=f"Approved {reg.request_no} for {requester.name} ({fmt_date(reg.attendance_date)} → {STATUS_LABELS.get(reg.requested_status)})",
        user_id=user.id,
    )
    notify_user(
        db, reg.user_id, "Attendance correction approved",
        f"{user.name} approved {reg.request_no}: {fmt_date(reg.attendance_date)} is now {STATUS_LABELS.get(reg.requested_status)}."
        + (f" Remarks: {reg.decision_remarks}" if reg.decision_remarks else ""),
        NOTIFY_TYPE, REG_ENTITY, reg.id,
    )
    db.commit()
    db.refresh(reg)
    return _reg_responses(db, [reg], user)[0]


@router.post("/regularizations/{reg_id}/reject", response_model=HrAttendanceRegularizationResponse)
async def reject_regularization(
    reg_id: int,
    payload: HrAttendanceRegularizationDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reg = _load_reg(db, reg_id, lock=True)
    ensure_can_decide(user, reg.approver_id, reg.user_id, "attendance regularization")
    _reg_pending_or_400(reg, "rejected")
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting so the employee knows what to fix. Add remarks and try again.")
    reg.status = "rejected"
    reg.decided_by_id = user.id
    reg.decided_at = datetime.now(timezone.utc)
    reg.decision_remarks = remarks
    record_audit(db, entity_type=REG_ENTITY, entity_id=reg.id, action="rejected", module_key="hr", summary=f"Rejected {reg.request_no}: {remarks}", user_id=user.id)
    notify_user(db, reg.user_id, "Attendance correction rejected", f"{user.name} rejected {reg.request_no} for {fmt_date(reg.attendance_date)}. Reason: {remarks}", NOTIFY_TYPE, REG_ENTITY, reg.id)
    db.commit()
    db.refresh(reg)
    return _reg_responses(db, [reg], user)[0]


@router.post("/regularizations/{reg_id}/cancel", response_model=HrAttendanceRegularizationResponse)
async def cancel_regularization(reg_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reg = _load_reg(db, reg_id, lock=True)
    if user.id != reg.user_id and not is_hr(user):
        raise HTTPException(status_code=403, detail="Only the employee who raised this request (or HR) can cancel it.")
    _reg_pending_or_400(reg, "cancelled")
    reg.status = "cancelled"
    db.commit()
    db.refresh(reg)
    return _reg_responses(db, [reg], user)[0]
