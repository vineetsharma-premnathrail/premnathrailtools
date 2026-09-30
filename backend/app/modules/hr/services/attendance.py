"""Attendance helpers: upserts, computed day statuses, late detection,
monthly summaries and CSV import parsing.

A day with no hr_attendance row is shown with a *computed* status:
'holiday' / 'weekly_off' from the plant calendar, 'unmarked' for a past or
current working day, and None for a future working day. Computed statuses
are never written to the table."""
from __future__ import annotations

import csv
import io
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.hr.models.attendance import ATTENDANCE_STATUSES, HrAttendance
from app.modules.hr.models.masters import HrShift
from app.modules.hr.services.calendar import IST, CalendarCache, EmployeeContext, daterange, today_ist

STATUS_LABELS = {
    "present": "Present", "absent": "Absent", "half_day": "Half day", "on_leave": "On leave",
    "holiday": "Holiday", "weekly_off": "Weekly off", "on_duty": "On duty", "work_from_home": "Work from home",
    "unmarked": "Not marked",
}

STATUS_ALIASES = {
    "p": "present", "present": "present",
    "a": "absent", "ab": "absent", "absent": "absent",
    "hd": "half_day", "half": "half_day", "half day": "half_day", "half_day": "half_day", "halfday": "half_day",
    "l": "on_leave", "leave": "on_leave", "on leave": "on_leave", "on_leave": "on_leave",
    "h": "holiday", "holiday": "holiday",
    "wo": "weekly_off", "off": "weekly_off", "weekly off": "weekly_off", "weekly_off": "weekly_off",
    "od": "on_duty", "on duty": "on_duty", "on_duty": "on_duty",
    "wfh": "work_from_home", "work from home": "work_from_home", "work_from_home": "work_from_home",
}

SUMMARY_KEYS = ("present", "absent", "half_day", "on_leave", "holiday", "weekly_off", "on_duty", "work_from_home", "unmarked")


def month_bounds(year: int, month: int) -> tuple[date, date]:
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail=f"Month must be 1–12, got {month}. Pick a month from the list.")
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def combine_ist(d: date, t: time | None) -> datetime | None:
    if t is None:
        return None
    return datetime.combine(d, t.replace(tzinfo=None)).replace(tzinfo=IST)


def resolve_check_times(d: date, check_in: time | None, check_out: time | None, shift: HrShift | None) -> tuple[datetime | None, datetime | None]:
    ci = combine_ist(d, check_in)
    co = combine_ist(d, check_out)
    if ci and co and co <= ci:
        if shift and shift.is_night:
            co = co + timedelta(days=1)
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Check-out ({check_out.strftime('%H:%M')}) is not after check-in ({check_in.strftime('%H:%M')}). "
                    "Fix the times — for a night shift, assign the employee a night shift in their profile."
                ),
            )
    return ci, co


def late_minutes(check_in: datetime | None, shift: HrShift | None) -> int | None:
    """Minutes after (shift start + grace). None when there is no check-in or
    no shift; 0 when on time."""
    if not check_in or not shift:
        return None
    local = check_in.astimezone(IST)
    start = datetime.combine(local.date(), shift.start_time).replace(tzinfo=IST)
    diff = (local - start).total_seconds() / 60 - (shift.grace_minutes or 0)
    return max(0, int(diff))


def fmt_time(dt: datetime | None) -> str | None:
    return dt.astimezone(IST).strftime("%H:%M") if dt else None


def upsert_attendance(
    db: Session,
    *,
    user_id: int,
    attendance_date: date,
    status: str,
    source: str,
    actor_id: int | None,
    check_in: datetime | None = None,
    check_out: datetime | None = None,
    remarks: str | None = None,
    shift_id: int | None = None,
    keep_times: bool = False,
) -> tuple[HrAttendance, bool]:
    """Returns (row, created)."""
    if status not in ATTENDANCE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unknown attendance status '{status}'. Use one of: {', '.join(ATTENDANCE_STATUSES)}.")
    row = db.query(HrAttendance).filter(HrAttendance.user_id == user_id, HrAttendance.attendance_date == attendance_date).first()
    created = row is None
    if created:
        row = HrAttendance(user_id=user_id, attendance_date=attendance_date)
        db.add(row)
    row.status = status
    row.source = source
    row.marked_by_id = actor_id
    if not keep_times or check_in is not None:
        row.check_in = check_in
    if not keep_times or check_out is not None:
        row.check_out = check_out
    if remarks is not None:
        row.remarks = remarks or None
    if shift_id is not None:
        row.shift_id = shift_id
    return row, created


@dataclass
class DayView:
    date: date
    status: str | None
    computed: bool
    source: str | None = None
    id: int | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    remarks: str | None = None
    holiday_name: str | None = None
    day_kind: str = "working"
    late_minutes: int | None = None

    def as_dict(self) -> dict:
        return {
            "date": self.date, "status": self.status, "computed": self.computed, "source": self.source, "id": self.id,
            "check_in": self.check_in, "check_out": self.check_out, "check_in_time": fmt_time(self.check_in),
            "check_out_time": fmt_time(self.check_out), "remarks": self.remarks, "holiday_name": self.holiday_name,
            "day_kind": self.day_kind, "late_minutes": self.late_minutes,
        }


def day_view(cache: CalendarCache, ctx: EmployeeContext, d: date, row: HrAttendance | None, today: date | None = None) -> DayView:
    today = today or today_ist()
    kind, hol_name = cache.day_kind(ctx, d)
    if row is not None:
        shift = cache.shift(row.shift_id) or ctx.shift
        return DayView(
            date=d, status=row.status, computed=False, source=row.source, id=row.id, check_in=row.check_in,
            check_out=row.check_out, remarks=row.remarks, holiday_name=hol_name, day_kind=kind,
            late_minutes=late_minutes(row.check_in, shift) if row.status in ("present", "half_day") else None,
        )
    if kind == "holiday":
        return DayView(date=d, status="holiday", computed=True, holiday_name=hol_name, day_kind=kind)
    if kind == "weekly_off":
        return DayView(date=d, status="weekly_off", computed=True, day_kind=kind)
    return DayView(date=d, status="unmarked" if d <= today else None, computed=True, day_kind=kind)


def rows_for(db: Session, user_ids: list[int], start: date, end: date) -> dict[tuple[int, date], HrAttendance]:
    if not user_ids:
        return {}
    rows = (
        db.query(HrAttendance)
        .filter(HrAttendance.user_id.in_(user_ids), HrAttendance.attendance_date >= start, HrAttendance.attendance_date <= end)
        .all()
    )
    return {(r.user_id, r.attendance_date): r for r in rows}


def month_days(cache: CalendarCache, ctx: EmployeeContext, start: date, end: date, rows: dict[tuple[int, date], HrAttendance]) -> list[DayView]:
    today = today_ist()
    return [day_view(cache, ctx, d, rows.get((ctx.user.id, d)), today) for d in daterange(start, end)]


def summarize(days: list[DayView]) -> dict:
    counts = {k: 0 for k in SUMMARY_KEYS}
    late = 0
    for v in days:
        if v.status in counts:
            counts[v.status] += 1
        if v.late_minutes and v.late_minutes > 0:
            late += 1
    counts["late_days"] = late
    counts["present_equivalent"] = counts["present"] + counts["on_duty"] + counts["work_from_home"] + 0.5 * counts["half_day"]
    return counts


# ─────────────────────────── CSV import ───────────────────────────
_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d")
_TIME_FORMATS = ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p")


def parse_date_cell(value: str) -> date | None:
    value = (value or "").strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_time_cell(value: str) -> time | None | str:
    """time, None for empty, or 'invalid'."""
    value = (value or "").strip()
    if not value:
        return None
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(value.upper(), fmt).time()
        except ValueError:
            continue
    return "invalid"


def read_csv(content: bytes) -> tuple[list[str], list[dict[str, str]]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    headers = [(h or "").strip().lower() for h in (reader.fieldnames or [])]
    rows = []
    for raw in reader:
        rows.append({(k or "").strip().lower(): (v or "").strip() if isinstance(v, str) else "" for k, v in raw.items()})
    return headers, rows


IMPORT_TEMPLATE = "email,employee_code,date,status,check_in,check_out,remarks\nname@premnathrail.com,,2026-09-01,present,09:05,17:45,\n,EMP001,01-09-2026,absent,,,Uninformed\n"
