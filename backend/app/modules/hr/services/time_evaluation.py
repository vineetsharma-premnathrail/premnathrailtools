"""Time evaluation (SAP PT60 equivalent) — worked hours, short hours,
late arrival / early leaving and overtime from attendance check-in /
check-out and the employee's shift.

Nothing here is stored: every figure is derived from hr_attendance + the
shift on each request, so a corrected punch (regularization, HR edit) is
reflected at once. Only overtime APPROVALS are stored (models/overtime.py).

Rules (HR › Settings › Time evaluation & overtime; defaults = Factories Act 1948):
- Worked minutes = check-out − check-in, minus the rest interval (s.55,
  30 min) when that span is over 5 hours. Night shifts cross midnight.
- Planned minutes = the shift's working hours (or its span minus the rest
  interval); half a day for a half-day; 0 on weekly offs / holidays (all
  time worked there is extra) and on leave / absence.
- Short = planned − worked (days with real punches only). Late = check-in
  after shift start + grace; early = check-out before shift end − grace
  (not counted on half days, which are short by design).
- Overtime (s.59) = beyond 9 h in the day OR beyond 48 h in the week
  (Mon–Sun), whichever is greater — never both for the same minutes: the
  weekly excess is computed on the regular (non-daily-OT) minutes only.
  OT below the minimum (default 15 min) is ignored. Days marked present
  without punches count as their planned hours towards the week but never
  produce OT themselves.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.masters import HrShift
from app.modules.hr.services.attendance import day_view, rows_for
from app.modules.hr.services.calendar import IST, CalendarCache, EmployeeContext, daterange, today_ist

WORKED_STATUSES = ("present", "half_day", "on_duty", "work_from_home")
REST_AFTER_MINUTES = 300  # s.55: rest interval due after 5 hours


@dataclass
class TimeRules:
    daily_ot: int = 540
    weekly_ot: int = 2880
    ot_min: int = 15
    rest: int = 30
    standard_day: int = 480

    @classmethod
    def load(cls, db: Session) -> "TimeRules":
        from app.modules.hr.settings import get_setting

        def val(key: str, default: int) -> int:
            try:
                v = get_setting(db, key)
                return int(v) if v is not None else default
            except Exception:  # noqa: BLE001 — settings table unavailable: statutory defaults
                return default

        d = cls()
        return cls(
            daily_ot=val("ot_daily_threshold_minutes", d.daily_ot),
            weekly_ot=val("ot_weekly_threshold_minutes", d.weekly_ot),
            ot_min=val("ot_minimum_minutes", d.ot_min),
            rest=val("rest_interval_minutes", d.rest),
            standard_day=val("standard_day_minutes", d.standard_day),
        )


def as_ist(dt: datetime | None) -> datetime | None:
    """Timestamps are stored tz-aware; SQLite hands them back naive (as the
    IST wall clock that was written), so naive = IST."""
    if dt is None:
        return None
    return dt.replace(tzinfo=IST) if dt.tzinfo is None else dt.astimezone(IST)


def _minutes(delta: timedelta) -> int:
    return int(delta.total_seconds() // 60)


def shift_span_minutes(shift: HrShift) -> int:
    start = datetime.combine(date(2000, 1, 1), shift.start_time.replace(tzinfo=None))
    end = datetime.combine(date(2000, 1, 1), shift.end_time.replace(tzinfo=None))
    if end <= start:
        end += timedelta(days=1)
    return _minutes(end - start)


def shift_planned_minutes(shift: HrShift | None, rules: TimeRules) -> int:
    if shift is None:
        return rules.standard_day
    if shift.working_hours:
        return int(round(float(shift.working_hours) * 60))
    span = shift_span_minutes(shift)
    return span - rules.rest if span > REST_AFTER_MINUTES else span


def worked_minutes(check_in: datetime | None, check_out: datetime | None, rules: TimeRules) -> int | None:
    ci, co = as_ist(check_in), as_ist(check_out)
    if not ci or not co or co <= ci:
        return None
    gross = _minutes(co - ci)
    return gross - rules.rest if gross > REST_AFTER_MINUTES else gross


def _shift_window(anchor: date, shift: HrShift) -> tuple[datetime, datetime]:
    start = datetime.combine(anchor, shift.start_time.replace(tzinfo=None)).replace(tzinfo=IST)
    end = datetime.combine(anchor, shift.end_time.replace(tzinfo=None)).replace(tzinfo=IST)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def late_by(check_in: datetime | None, shift: HrShift | None, work_date: date) -> int:
    ci = as_ist(check_in)
    if not ci or not shift:
        return 0
    start, _ = _shift_window(work_date, shift)
    return max(0, _minutes(ci - start) - (shift.grace_minutes or 0))


def early_by(check_out: datetime | None, shift: HrShift | None, work_date: date) -> int:
    co = as_ist(check_out)
    if not co or not shift:
        return 0
    _, end = _shift_window(work_date, shift)
    return max(0, _minutes(end - co) - (shift.grace_minutes or 0))


@dataclass
class DayEval:
    date: date
    status: str | None
    day_kind: str
    check_in: datetime | None = None
    check_out: datetime | None = None
    shift_code: str | None = None
    planned_minutes: int = 0
    worked_minutes: int = 0
    has_punches: bool = False
    missing_check_out: bool = False
    short_minutes: int = 0
    late_minutes: int = 0
    early_minutes: int = 0
    ot_daily_minutes: int = 0
    ot_weekly_minutes: int = 0
    ot_minutes: int = 0
    # Filled from the overtime approvals (attach_overtime).
    ot_request_id: int | None = None
    ot_request_no: str | None = None
    ot_status: str | None = None
    ot_claimed_minutes: int | None = None
    ot_approved_minutes: int | None = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        def hm(dt):
            dt = as_ist(dt)
            return dt.strftime("%H:%M") if dt else None
        return {
            "date": self.date, "status": self.status, "day_kind": self.day_kind,
            "check_in_time": hm(self.check_in), "check_out_time": hm(self.check_out), "shift_code": self.shift_code,
            "planned_minutes": self.planned_minutes, "worked_minutes": self.worked_minutes, "has_punches": self.has_punches,
            "missing_check_out": self.missing_check_out, "short_minutes": self.short_minutes,
            "late_minutes": self.late_minutes, "early_minutes": self.early_minutes,
            "ot_daily_minutes": self.ot_daily_minutes, "ot_weekly_minutes": self.ot_weekly_minutes, "ot_minutes": self.ot_minutes,
            "ot_request_id": self.ot_request_id, "ot_request_no": self.ot_request_no, "ot_status": self.ot_status,
            "ot_claimed_minutes": self.ot_claimed_minutes, "ot_approved_minutes": self.ot_approved_minutes,
            "notes": self.notes,
        }


def evaluate_day(d: date, status: str | None, day_kind: str, row: HrAttendance | None, shift: HrShift | None,
                 rules: TimeRules, today: date | None = None) -> DayEval:
    today = today or today_ist()
    ev = DayEval(date=d, status=status, day_kind=day_kind, shift_code=shift.code if shift else None)
    if row is not None:
        ev.check_in, ev.check_out = row.check_in, row.check_out
    if status not in WORKED_STATUSES:
        return ev
    planned = shift_planned_minutes(shift, rules) if day_kind == "working" else 0
    if status == "half_day":
        planned //= 2
    ev.planned_minutes = planned
    worked = worked_minutes(ev.check_in, ev.check_out, rules)
    if worked is None:
        # Marked worked without both punches: assume the plan, no OT / short.
        ev.worked_minutes = planned
        if ev.check_in and not ev.check_out and d < today:
            ev.missing_check_out = True
            ev.notes.append("Checked in but no check-out — regularize the day to evaluate it.")
        return ev
    ev.has_punches = True
    ev.worked_minutes = worked
    if day_kind == "working":
        ev.short_minutes = max(0, planned - worked)
        if status != "half_day":
            ev.late_minutes = late_by(ev.check_in, shift, d)
            ev.early_minutes = early_by(ev.check_out, shift, d)
    else:
        ev.notes.append("Worked on a " + ("holiday" if day_kind == "holiday" else "weekly off")
                        + " — a compensatory day off is due (Factories Act s.52/53).")
    ev.ot_daily_minutes = max(0, worked - rules.daily_ot)
    return ev


def evaluate_range(cache: CalendarCache, ctx: EmployeeContext, start: date, end: date,
                   rows: dict[tuple[int, date], HrAttendance], rules: TimeRules) -> list[DayEval]:
    """Days start..end evaluated, with the weekly limit applied from the
    Monday of the first week (`rows` must cover that Monday too)."""
    today = today_ist()
    week_start = start - timedelta(days=start.weekday())
    regular: dict[date, int] = {}
    out: list[DayEval] = []
    for d in daterange(week_start, end):
        row = rows.get((ctx.user.id, d))
        view = day_view(cache, ctx, d, row, today)
        # Worked shift on the attendance row → roster (PT01) → profile default.
        shift = (cache.shift(row.shift_id) if row is not None else None) or cache.shift_on(ctx, d)
        ev = evaluate_day(d, view.status, view.day_kind, row, shift, rules, today)
        wk = d - timedelta(days=d.weekday())
        before = regular.get(wk, 0)
        after = before + ev.worked_minutes - ev.ot_daily_minutes
        regular[wk] = after
        if ev.has_punches:
            ev.ot_weekly_minutes = max(0, after - rules.weekly_ot) - max(0, before - rules.weekly_ot)
        total = ev.ot_daily_minutes + ev.ot_weekly_minutes
        ev.ot_minutes = total if total >= max(rules.ot_min, 1) else 0
        if d >= start:
            out.append(ev)
    return out


def evaluation_rows(db: Session, user_ids: list[int], start: date, end: date) -> dict[tuple[int, date], HrAttendance]:
    return rows_for(db, user_ids, start - timedelta(days=start.weekday()), end)


def attach_overtime(days: list[DayEval], requests: dict[date, object]) -> None:
    for ev in days:
        req = requests.get(ev.date)
        if req is None:
            continue
        ev.ot_request_id, ev.ot_request_no, ev.ot_status = req.id, req.request_no, req.status
        ev.ot_claimed_minutes, ev.ot_approved_minutes = req.claimed_minutes, req.approved_minutes


def totals(days: list[DayEval]) -> dict:
    t = {
        "planned_minutes": 0, "worked_minutes": 0, "short_minutes": 0, "short_days": 0, "late_days": 0,
        "late_minutes": 0, "early_days": 0, "early_minutes": 0, "ot_minutes": 0, "ot_approved_minutes": 0,
        "ot_pending_minutes": 0, "ot_unclaimed_minutes": 0, "ot_days": 0, "punched_days": 0, "missing_check_out_days": 0,
        "off_day_worked_days": 0,
    }
    for ev in days:
        t["planned_minutes"] += ev.planned_minutes
        t["worked_minutes"] += ev.worked_minutes
        t["short_minutes"] += ev.short_minutes
        t["short_days"] += 1 if ev.short_minutes else 0
        t["late_days"] += 1 if ev.late_minutes else 0
        t["late_minutes"] += ev.late_minutes
        t["early_days"] += 1 if ev.early_minutes else 0
        t["early_minutes"] += ev.early_minutes
        t["ot_minutes"] += ev.ot_minutes
        t["ot_days"] += 1 if ev.ot_minutes else 0
        t["punched_days"] += 1 if ev.has_punches else 0
        t["missing_check_out_days"] += 1 if ev.missing_check_out else 0
        t["off_day_worked_days"] += 1 if ev.has_punches and ev.day_kind != "working" else 0
        if ev.ot_status == "approved":
            t["ot_approved_minutes"] += ev.ot_approved_minutes or 0
        elif ev.ot_status == "pending":
            t["ot_pending_minutes"] += ev.ot_claimed_minutes or 0
        elif ev.ot_minutes and ev.ot_status not in ("rejected",):
            t["ot_unclaimed_minutes"] += ev.ot_minutes
    return t


def man_minutes(db: Session, start: date, end: date, branch_id: int | None = None) -> int:
    """Total minutes worked by everyone (or one plant) in start..end — the
    exposure for LTIFR / severity rate. Days marked worked without punches
    count as planned (shift) hours."""
    rules = TimeRules.load(db)
    cache = CalendarCache(db)
    rows = db.query(HrAttendance).filter(
        HrAttendance.attendance_date >= start, HrAttendance.attendance_date <= end,
        HrAttendance.status.in_(WORKED_STATUSES),
    ).all()
    from app.modules.main.models.user import User

    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in rows} or {-1})).all()}
    contexts: dict[int, EmployeeContext] = {}
    total = 0
    for row in rows:
        user = users.get(row.user_id)
        if user is None:
            continue
        if user.id not in contexts:
            contexts[user.id] = cache.context(user)
        ctx = contexts[user.id]
        if branch_id and ctx.branch_id != branch_id:
            continue
        shift = cache.shift(row.shift_id) or cache.shift_on(ctx, row.attendance_date)
        worked = worked_minutes(row.check_in, row.check_out, rules)
        if worked is None:
            worked = shift_planned_minutes(shift, rules)
            if row.status == "half_day":
                worked //= 2
        total += worked
    return total


def fmt_hours(minutes: int | None) -> str:
    """475 -> '7.92' (decimal hours, the ADP input format)."""
    return f"{(minutes or 0) / 60:.2f}"
