"""HR & Administration — time evaluation (SAP PT60) and overtime approvals.

- GET  /hr/time-evaluation/me                  my month, day by day (My HR)
- GET  /hr/time-evaluation/month               every employee's month totals (HR › Attendance)
- GET  /hr/time-evaluation/employee/{user_id}  one employee's month, day by day (HR)
- GET  /hr/time-evaluation/export              monthly CSV for ADP payroll (HR › Attendance › export)
- /hr/time-evaluation/overtime…                OT claims and approvals (central approval engine,
                                               type "hr.overtime": reporting manager + HR approvers)

Figures are computed live (services/time_evaluation.py); only OT requests
are stored. The export carries APPROVED OT hours only — the double rate
(Factories Act s.59) is applied by ADP."""
import csv
import io
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.data_scope import apply_scope
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.overtime import OVERTIME_STATUSES, HrOvertime
from app.modules.hr.routes.attendance import _branch_map, _employee_brief, _employees
from app.modules.hr.schemas.overtime import (
    HrOvertimeCreate, HrOvertimeDecisionPayload, HrOvertimeGeneratePayload, HrOvertimeResponse,
)
from app.modules.hr.services import approvals as hr_approvals
from app.modules.hr.services.access import can_hr, ensure_self_or_hr, require_hr_tab, require_me_create, require_me_view
from app.modules.hr.services.attendance import month_bounds, month_days, summarize
from app.modules.hr.services.calendar import CalendarCache, EmployeeContext, today_ist
from app.modules.hr.services.leave import fmt_date
from app.modules.hr.services.lookup import department_names, profiles_by_user, user_department_name, users_by_id
from app.modules.hr.services.time_evaluation import (
    TimeRules, attach_overtime, evaluate_range, evaluation_rows, fmt_hours, totals,
)
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

router = APIRouter(prefix="/hr/time-evaluation", tags=["HR"])

require_hr = require_hr_tab("attendance")
require_hr_edit = require_hr_tab("attendance", "edit")
require_hr_export = require_hr_tab("attendance", "export")

OT_ENTITY = hr_approvals.OVERTIME_ENTITY
LIVE = ("pending", "approved")


def _rules_out(r: TimeRules) -> dict:
    return {"ot_daily_threshold_minutes": r.daily_ot, "ot_weekly_threshold_minutes": r.weekly_ot,
            "ot_minimum_minutes": r.ot_min, "rest_interval_minutes": r.rest, "standard_day_minutes": r.standard_day}


def _live_ot(db: Session, user_ids: list[int], start: date, end: date) -> dict[int, dict[date, HrOvertime]]:
    out: dict[int, dict[date, HrOvertime]] = defaultdict(dict)
    if not user_ids:
        return out
    rows = (
        db.query(HrOvertime)
        .filter(HrOvertime.user_id.in_(user_ids), HrOvertime.work_date >= start, HrOvertime.work_date <= end,
                HrOvertime.status.in_(("pending", "approved", "rejected")))
        .order_by(HrOvertime.id.asc())
        .all()
    )
    for r in rows:  # ascending id → the latest wins; a live one beats a rejected one
        cur = out[r.user_id].get(r.work_date)
        if cur is None or r.status in LIVE or cur.status not in LIVE:
            out[r.user_id][r.work_date] = r
    return out


def _evaluate(db: Session, cache: CalendarCache, ctxs: list[EmployeeContext], start: date, end: date, rules: TimeRules):
    ids = [c.user.id for c in ctxs]
    rows = evaluation_rows(db, ids, start, end)
    ot = _live_ot(db, ids, start, end)
    result = []
    for ctx in ctxs:
        days = evaluate_range(cache, ctx, start, end, rows, rules)
        attach_overtime(days, ot.get(ctx.user.id, {}))
        result.append((ctx, days, rows))
    return result


def _month(year: int | None, month: int | None) -> tuple[int, int, date, date]:
    t = today_ist()
    y, m = year or t.year, month or t.month
    start, end = month_bounds(y, m)
    return y, m, start, end


def _month_payload(db: Session, ctx: EmployeeContext, cache: CalendarCache, y: int, m: int, start: date, end: date) -> dict:
    rules = TimeRules.load(db)
    (_, days, rows), = _evaluate(db, cache, [ctx], start, end, rules)
    branches = _branch_map(db)
    return {
        "year": y, "month": m, "from_date": start, "to_date": end, "rules": _rules_out(rules),
        "employee": _employee_brief(ctx, branches),
        "days": [d.as_dict() for d in days],
        "totals": {**totals(days), **summarize(month_days(cache, ctx, start, end, rows))},
    }


@router.get("/me")
async def my_time_evaluation(year: int | None = Query(None), month: int | None = Query(None),
                             db: Session = Depends(get_db), user: User = Depends(require_me_view)):
    y, m, start, end = _month(year, month)
    cache = CalendarCache(db)
    return _month_payload(db, cache.context(user), cache, y, m, start, end)


@router.get("/employee/{user_id}")
async def employee_time_evaluation(user_id: int, year: int | None = Query(None), month: int | None = Query(None),
                                   db: Session = Depends(get_db), user: User = Depends(require_hr)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Employee (user #{user_id}) doesn't exist. Pick the employee from the list again.")
    hr_approvals.ensure_employee_in_scope(db, user, target)
    y, m, start, end = _month(year, month)
    cache = CalendarCache(db)
    return _month_payload(db, cache.context(target), cache, y, m, start, end)


def _month_items(db: Session, viewer: User, y: int, m: int, start: date, end: date, branch_id, department_id, search) -> dict:
    cache = CalendarCache(db)
    rules = TimeRules.load(db)
    branches = _branch_map(db)
    ctxs = _employees(db, cache, branch_id, department_id, search, viewer=viewer)
    items = []
    for ctx, days, rows in _evaluate(db, cache, ctxs, start, end, rules):
        items.append({**_employee_brief(ctx, branches), **totals(days),
                      **summarize(month_days(cache, ctx, start, end, rows))})
    return {"year": y, "month": m, "from_date": start, "to_date": end, "rules": _rules_out(rules), "items": items}


@router.get("/month")
async def month_time_evaluation(
    year: int | None = Query(None), month: int | None = Query(None), branch_id: int | None = Query(None),
    department_id: int | None = Query(None), search: str | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_hr),
):
    y, m, start, end = _month(year, month)
    return _month_items(db, user, y, m, start, end, branch_id, department_id, search)


EXPORT_COLUMNS = [
    ("Employee code", lambda it: it["employee_code"] or ""), ("Employee", lambda it: it["user_name"]),
    ("Email", lambda it: it["user_email"]), ("Department", lambda it: it["department_name"] or ""),
    ("Plant", lambda it: it["branch_name"] or ""),
    ("Present days (equivalent)", lambda it: it["present_equivalent"]), ("Absent days", lambda it: it["absent"]),
    ("Leave days", lambda it: it["on_leave"]), ("Not marked days", lambda it: it["unmarked"]),
    ("Planned hours", lambda it: fmt_hours(it["planned_minutes"])), ("Worked hours", lambda it: fmt_hours(it["worked_minutes"])),
    ("Short hours", lambda it: fmt_hours(it["short_minutes"])), ("Late days", lambda it: it["late_days"]),
    ("Late minutes", lambda it: it["late_minutes"]), ("Early-leaving days", lambda it: it["early_days"]),
    ("Off days worked", lambda it: it["off_day_worked_days"]),
    ("OT hours computed", lambda it: fmt_hours(it["ot_minutes"])),
    ("OT hours approved (pay at 2x)", lambda it: fmt_hours(it["ot_approved_minutes"])),
    ("OT hours pending approval", lambda it: fmt_hours(it["ot_pending_minutes"])),
]


@router.get("/export")
async def export_time_evaluation(
    year: int | None = Query(None), month: int | None = Query(None), branch_id: int | None = Query(None),
    department_id: int | None = Query(None), search: str | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_hr_export),
):
    y, m, start, end = _month(year, month)
    data = _month_items(db, user, y, m, start, end, branch_id, department_id, search)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c for c, _ in EXPORT_COLUMNS])
    for it in data["items"]:
        w.writerow([f(it) for _, f in EXPORT_COLUMNS])
    record_audit(db, entity_type="hr_time_evaluation", entity_id=None, action="exported", module_key="hr",
                 summary=f"Exported time evaluation for {start:%B %Y} ({len(data['items'])} employees)", user_id=user.id)
    db.commit()
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="time_evaluation_{y}_{m:02d}.csv"'})


# ─────────────────────────────── Overtime ───────────────────────────────
def _ot_responses(db: Session, rows: list[HrOvertime], viewer: User) -> list[HrOvertimeResponse]:
    users = users_by_id(db, [r.user_id for r in rows] + [r.approver_id for r in rows] + [r.decided_by_id for r in rows])
    profiles = profiles_by_user(db, [r.user_id for r in rows])
    depts = department_names(db)
    areqs = hr_approvals.latest_by_entity(db, OT_ENTITY, [r.id for r in rows])
    # Today's evaluation of each requested day (punches may have changed).
    current: dict[tuple[int, date], object] = {}
    by_user: dict[int, list[date]] = defaultdict(list)
    for r in rows:
        by_user[r.user_id].append(r.work_date)
    if rows:
        cache, rules = CalendarCache(db), TimeRules.load(db)
        for uid, dates in by_user.items():
            u = users.get(uid)
            if u is None:
                continue
            ctx = cache.context(u, profiles.get(uid), load_profile=uid not in profiles)
            start, end = min(dates), max(dates)
            evrows = evaluation_rows(db, [uid], start, end)
            for ev in evaluate_range(cache, ctx, start, end, evrows, rules):
                current[(uid, ev.date)] = ev
    out = []
    for r in rows:
        u, p = users.get(r.user_id), profiles.get(r.user_id)
        a, d = users.get(r.approver_id or 0), users.get(r.decided_by_id or 0)
        ev = current.get((r.user_id, r.work_date))
        areq = areqs.get(r.id)
        evd = ev.as_dict() if ev is not None else {}
        out.append(HrOvertimeResponse.model_validate(r).model_copy(update={
            "user_name": u.name if u else None, "user_email": u.email if u else None,
            "employee_code": p.employee_code if p else None, "department_name": user_department_name(u, p, depts),
            "approver_name": a.name if a else None, "decided_by_name": d.name if d else None,
            "current_ot_minutes": ev.ot_minutes if ev is not None else None,
            "worked_minutes": ev.worked_minutes if ev is not None else None,
            "check_in_time": evd.get("check_in_time"), "check_out_time": evd.get("check_out_time"),
            "can_decide": r.status == "pending" and hr_approvals.can_decide_engine(db, viewer, areq),
            "approval_request_id": areq.id if areq else None,
            "can_cancel": r.status == "pending" and (
                can_hr(viewer, "me", "edit") if viewer.id == r.user_id else can_hr(viewer, "attendance", "edit")),
        }))
    return out


def _load_ot(db: Session, ot_id: int, lock: bool = False) -> HrOvertime:
    q = db.query(HrOvertime).filter(HrOvertime.id == ot_id)
    ot = q.with_for_update().populate_existing().first() if lock else q.first()
    if ot is None:
        raise HTTPException(status_code=404, detail=f"Overtime request #{ot_id} doesn't exist. Refresh the list — it may have been cancelled.")
    return ot


def _day_ot(db: Session, employee: User, d: date):
    cache = CalendarCache(db)
    ctx = cache.context(employee)
    rows = evaluation_rows(db, [employee.id], d, d)
    return evaluate_range(cache, ctx, d, d, rows, TimeRules.load(db))[0]


def _raise_ot(db: Session, employee: User, d: date, minutes: int, computed: int, reason: str | None,
              source: str, actor: User) -> HrOvertime:
    from app.modules.hr.services.period_lock import assert_open

    assert_open(db, employee.id, d)  # payroll period lock: OT of a locked month is already with ADP
    ot = HrOvertime(
        request_no=next_sequential_id(db, prefix=f"OT-{d.year}-", column=HrOvertime.request_no),
        user_id=employee.id, work_date=d, computed_minutes=computed, claimed_minutes=minutes, status="pending",
        source=source, reason=reason, approver_id=employee.reporting_manager_id, created_by_id=actor.id,
    )
    db.add(ot)
    db.flush()
    appr = hr_approvals.submit(
        db, hr_approvals.OVERTIME_KEY, entity_id=ot.id, requester=employee,
        title=f"Overtime — {employee.name}, {fmt_date(d)}: {fmt_hours(minutes)} h",
        reference=ot.request_no, context={"ot_minutes": minutes},
    )
    # Role event for HR approvers who opted in (bell / Teams — this helper
    # has no request context for email); the engine pinged the routed approvers.
    from app.modules.hr.services import role_events
    role_events.fire(
        db, None, "overtime_submitted", title=f"Overtime waiting for approval — {ot.request_no}",
        message=(f"{employee.name}: {fmt_hours(minutes)} h overtime on {fmt_date(d)}"
                 + (f" ({reason})" if reason else "") + ". Approve or reject it under HR › Approvals."),
        entity_type=OT_ENTITY, entity_id=ot.id, actor=actor, can_open=role_events.employee_opener(db, employee),
        skip={employee.id} | role_events.approver_ids(appr),
    )
    return ot


def _existing_live(db: Session, user_id: int, d: date) -> HrOvertime | None:
    return db.query(HrOvertime).filter(HrOvertime.user_id == user_id, HrOvertime.work_date == d,
                                       HrOvertime.status.in_(LIVE)).first()


@router.post("/overtime/me", response_model=HrOvertimeResponse)
async def claim_overtime(payload: HrOvertimeCreate, db: Session = Depends(get_db), user: User = Depends(require_me_create)):
    d = payload.work_date
    prof = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user.id).first()
    if prof is not None and prof.ot_eligible is False:
        raise HTTPException(status_code=403, detail=(
            "Your HR record says you are not eligible for overtime, so overtime can't be claimed. If that is wrong, "
            "ask HR to set Overtime Eligible to Yes on your record (HR > Employees)."))
    if d > today_ist():
        raise HTTPException(status_code=400, detail=f"{fmt_date(d)} is in the future. Overtime is claimed after the day is worked and you have checked out.")
    dup = _existing_live(db, user.id, d)
    if dup:
        raise HTTPException(status_code=409, detail=f"You already have overtime request {dup.request_no} ({dup.status}) for {fmt_date(d)}. Cancel it first if the hours are wrong.")
    ev = _day_ot(db, user, d)
    if not ev.has_punches:
        raise HTTPException(status_code=400, detail=(
            f"{fmt_date(d)} has no check-in and check-out, so no overtime can be worked out. "
            "Raise an attendance regularization with your actual times first."))
    if ev.ot_minutes <= 0:
        rules = TimeRules.load(db)
        raise HTTPException(status_code=400, detail=(
            f"You worked {fmt_hours(ev.worked_minutes)} h on {fmt_date(d)}, which is not overtime: overtime starts after "
            f"{fmt_hours(rules.daily_ot)} h in a day or {fmt_hours(rules.weekly_ot)} h in a week (Factories Act s.59), "
            f"and at least {rules.ot_min} minutes."))
    minutes = payload.claimed_minutes or ev.ot_minutes
    if minutes > ev.ot_minutes:
        raise HTTPException(status_code=400, detail=(
            f"You can claim at most {ev.ot_minutes} minutes for {fmt_date(d)} — that is what your check-in/check-out "
            "gives. If the times are wrong, regularize the day first."))
    ot = _raise_ot(db, user, d, minutes, ev.ot_minutes, payload.reason.strip(), "self", user)
    db.commit()
    return _ot_responses(db, [ot], user)[0]


@router.post("/overtime/generate")
async def generate_overtime(payload: HrOvertimeGeneratePayload, db: Session = Depends(get_db), user: User = Depends(require_hr_edit)):
    """Raise an OT approval for every day of the month whose computed OT has
    no live request. Employees with no approver are listed, not raised."""
    start, end = month_bounds(payload.year, payload.month)
    end = min(end, today_ist())
    if end < start:
        raise HTTPException(status_code=400, detail=f"{start:%B %Y} hasn't started yet, so there is no overtime to raise.")
    cache = CalendarCache(db)
    rules = TimeRules.load(db)
    ctxs = _employees(db, cache, payload.branch_id, payload.department_id, None, viewer=user)
    if payload.user_ids:
        wanted = set(payload.user_ids)
        ctxs = [c for c in ctxs if c.user.id in wanted]
    raised, skipped, errors = [], 0, []
    for ctx, days, _rows in _evaluate(db, cache, ctxs, start, end, rules):
        if ctx.user.id == user.id:
            continue  # nobody raises their own OT as HR — use My HR
        if ctx.profile is not None and ctx.profile.ot_eligible is False:
            skipped += sum(1 for ev in days if ev.ot_minutes)  # not eligible for overtime (HR record)
            continue
        for ev in days:
            if not ev.ot_minutes:
                continue
            if ev.ot_status in LIVE or ev.ot_status == "rejected":
                skipped += 1
                continue
            try:
                ot = _raise_ot(db, ctx.user, ev.date, ev.ot_minutes, ev.ot_minutes,
                               f"Raised by {user.name} from time evaluation", "evaluation", user)
                raised.append(ot.request_no)
            except HTTPException as exc:
                # The engine refused before creating its request: drop our row too.
                pending = db.query(HrOvertime).filter(HrOvertime.user_id == ctx.user.id, HrOvertime.work_date == ev.date,
                                                      HrOvertime.status == "pending").order_by(HrOvertime.id.desc()).first()
                if pending is not None and hr_approvals.open_request(db, OT_ENTITY, pending.id) is None:
                    db.delete(pending)
                    db.flush()
                errors.append(f"{ctx.user.name} — {fmt_date(ev.date)}: {exc.detail}")
                break  # same reason for the employee's other days
    if raised:
        record_audit(db, entity_type=OT_ENTITY, entity_id=None, action="generated", module_key="hr",
                     summary=f"Raised {len(raised)} overtime request(s) for {start:%B %Y} from time evaluation", user_id=user.id)
    db.commit()
    return {"raised": len(raised), "request_nos": raised, "skipped_existing": skipped, "errors": errors}


@router.get("/overtime/me", response_model=list[HrOvertimeResponse])
async def my_overtime(db: Session = Depends(get_db), user: User = Depends(require_me_view)):
    rows = (db.query(HrOvertime).filter(HrOvertime.user_id == user.id)
            .order_by(HrOvertime.work_date.desc(), HrOvertime.id.desc()).limit(200).all())
    return _ot_responses(db, rows, user)


@router.get("/overtime/pending-for-me", response_model=list[HrOvertimeResponse])
async def overtime_pending_for_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ids = hr_approvals.inbox_ids(db, user, OT_ENTITY)
    if not ids:
        return []
    rows = (db.query(HrOvertime).filter(HrOvertime.id.in_(ids), HrOvertime.status == "pending", HrOvertime.user_id != user.id)
            .order_by(HrOvertime.work_date.asc()).all())
    return _ot_responses(db, rows, user)


@router.get("/overtime", response_model=list[HrOvertimeResponse])
async def list_overtime(
    status: str | None = Query(None), user_id: int | None = Query(None), year: int | None = Query(None),
    month: int | None = Query(None), db: Session = Depends(get_db), user: User = Depends(require_hr),
):
    q = apply_scope(db.query(HrOvertime), user, HrOvertime)
    if status:
        if status not in OVERTIME_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown status '{status}'. Use one of: {', '.join(OVERTIME_STATUSES)}.")
        q = q.filter(HrOvertime.status == status)
    if user_id:
        q = q.filter(HrOvertime.user_id == user_id)
    if year and month:
        start, end = month_bounds(year, month)
        q = q.filter(HrOvertime.work_date >= start, HrOvertime.work_date <= end)
    rows = q.order_by(HrOvertime.work_date.desc(), HrOvertime.id.desc()).limit(1000).all()
    return _ot_responses(db, rows, user)


def _finish_ot(db: Session, ot: HrOvertime, actor: User, outcome: str, comment: str | None) -> None:
    if ot.status != "pending":
        return
    if outcome == "approved":
        from app.modules.hr.services.period_lock import assert_open

        assert_open(db, ot.user_id, ot.work_date)  # payroll period lock
    ot.decided_by_id = actor.id
    ot.decided_at = datetime.now(timezone.utc)
    ot.decision_remarks = (comment or "").strip() or None
    if outcome == "approved":
        ot.status = "approved"
        ot.approved_minutes = min(ot.approved_minutes or ot.claimed_minutes, ot.claimed_minutes)
    elif outcome in ("rejected", "returned"):
        ot.status = "rejected"
        ot.approved_minutes = None
    elif outcome == "cancelled":
        ot.status = "cancelled"
        ot.approved_minutes = None
    record_audit(db, entity_type=OT_ENTITY, entity_id=ot.id, action=ot.status, module_key="hr",
                 summary=f"{ot.request_no} {ot.status}" + (f" ({fmt_hours(ot.approved_minutes)} h)" if ot.approved_minutes else "")
                 + (f": {ot.decision_remarks}" if ot.decision_remarks else ""), user_id=actor.id)


def _on_ot_decided(db: Session, areq, outcome: str, actor: User) -> None:
    """Approval engine callback (hr.overtime) — the engine notifies the employee."""
    ot = _load_ot(db, areq.entity_id, lock=True)
    _finish_ot(db, ot, actor, outcome, hr_approvals.decision_comment(areq, actor))


hr_approvals.register_hr_type(
    hr_approvals.OVERTIME_KEY, "attendance", "Overtime", OT_ENTITY, "/dashboard/hr/approvals", _on_ot_decided,
    description="Overtime worked beyond 9 h/day or 48 h/week (Factories Act s.59), from time evaluation. "
                "Only approved hours go to the ADP export.",
    context_fields={"ot_minutes": {"label": "Overtime minutes", "type": "number"}},
)


def _pending_or_400(ot: HrOvertime, verb: str) -> None:
    if ot.status != "pending":
        raise HTTPException(status_code=400, detail=f"{ot.request_no} is already {ot.status}, so it can't be {verb}. Refresh the page to see its latest status.")


@router.post("/overtime/{ot_id}/approve", response_model=HrOvertimeResponse)
async def approve_overtime(ot_id: int, payload: HrOvertimeDecisionPayload | None = None,
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ot = _load_ot(db, ot_id, lock=True)
    _pending_or_400(ot, "approved")
    payload = payload or HrOvertimeDecisionPayload()
    if payload.approved_minutes:
        if payload.approved_minutes > ot.claimed_minutes:
            raise HTTPException(status_code=400, detail=(
                f"{ot.request_no} claims {ot.claimed_minutes} minutes; you can approve that or less, not "
                f"{payload.approved_minutes}."))
        ot.approved_minutes = payload.approved_minutes
    remarks = (payload.remarks or "").strip() or None
    if payload.approved_minutes and payload.approved_minutes < ot.claimed_minutes and not remarks:
        raise HTTPException(status_code=400, detail="Say why you are approving fewer minutes than claimed, so the employee knows.")
    db.flush()  # the engine callback re-reads the row
    if not hr_approvals.decide(db, OT_ENTITY, ot.id, user, True, remarks, what="overtime request"):
        raise HTTPException(status_code=409, detail=f"{ot.request_no} has no open approval — ask an admin to check it in Organization › My Approvals.")
    db.commit()
    db.refresh(ot)
    return _ot_responses(db, [ot], user)[0]


@router.post("/overtime/{ot_id}/reject", response_model=HrOvertimeResponse)
async def reject_overtime(ot_id: int, payload: HrOvertimeDecisionPayload,
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ot = _load_ot(db, ot_id, lock=True)
    _pending_or_400(ot, "rejected")
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the overtime so the employee knows why. Add remarks and try again.")
    if not hr_approvals.decide(db, OT_ENTITY, ot.id, user, False, remarks, what="overtime request"):
        raise HTTPException(status_code=409, detail=f"{ot.request_no} has no open approval — ask an admin to check it in Organization › My Approvals.")
    db.commit()
    db.refresh(ot)
    return _ot_responses(db, [ot], user)[0]


@router.post("/overtime/{ot_id}/cancel", response_model=HrOvertimeResponse)
async def cancel_overtime(ot_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ot = _load_ot(db, ot_id, lock=True)
    ensure_self_or_hr(user, ot.user_id, "edit", "attendance", "edit")
    hr_approvals.ensure_scope_unless_party(db, user, ot, ot.user_id)
    _pending_or_400(ot, "cancelled")
    hr_approvals.withdraw(db, OT_ENTITY, ot.id, user)
    _finish_ot(db, ot, user, "cancelled", None)
    db.commit()
    db.refresh(ot)
    return _ot_responses(db, [ot], user)[0]
