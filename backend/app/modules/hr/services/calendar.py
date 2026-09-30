"""Working-calendar helpers shared by leave and attendance.

- Dates/times are evaluated in India Standard Time (every plant is in India);
  check-in timestamps are stored timezone-aware.
- Weekly offs come from the employee's plant (Branch.working_days, free
  text such as "Mon-Sat", "Mon–Fri", "Monday to Saturday" or
  "Mon, Tue, Wed, Thu, Fri, Sat"). When it can't be parsed, Sunday is the
  only weekly off.
- Holidays that block a working day are the active *national* and
  *festival* holidays that apply to the employee's plant (plant-specific
  or all-plant). Restricted / optional holidays are taken as leave, so they
  do not reduce leave days and are not auto-marked as holidays.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.models.masters import HrShift

IST = ZoneInfo("Asia/Kolkata")

# Holiday types that close the plant for everyone.
BLOCKING_HOLIDAY_TYPES = ("national", "festival")

_DAY_TOKENS = [
    ("mon", 0), ("tue", 1), ("wed", 2), ("thu", 3), ("fri", 4), ("sat", 5), ("sun", 6),
]
_DEFAULT_WORKING = frozenset({0, 1, 2, 3, 4, 5})  # Sunday off


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def _day_index(token: str) -> int | None:
    token = token.strip().lower()[:3]
    for key, idx in _DAY_TOKENS:
        if token == key:
            return idx
    return None


def parse_working_days(text: str | None) -> frozenset[int]:
    """Weekday numbers (Mon=0 … Sun=6) that are working days."""
    if not text or not text.strip():
        return _DEFAULT_WORKING
    s = text.lower().replace("–", "-").replace("—", "-")
    s = re.sub(r"\bto\b|\bthrough\b|\btill\b|\buntil\b", "-", s)
    days: set[int] = set()
    # Ranges first: "mon - sat"
    for a, b in re.findall(r"([a-z]{3,9})\s*-\s*([a-z]{3,9})", s):
        ia, ib = _day_index(a), _day_index(b)
        if ia is None or ib is None:
            continue
        i = ia
        while True:
            days.add(i)
            if i == ib:
                break
            i = (i + 1) % 7
    s_no_ranges = re.sub(r"([a-z]{3,9})\s*-\s*([a-z]{3,9})", " ", s)
    for tok in re.findall(r"[a-z]{3,9}", s_no_ranges):
        idx = _day_index(tok)
        if idx is not None:
            days.add(idx)
    return frozenset(days) if days else _DEFAULT_WORKING


@dataclass
class EmployeeContext:
    user: User
    profile: HrEmployeeProfile | None
    branch_id: int | None
    department_id: int | None
    department_name: str | None
    gender: str | None
    shift: HrShift | None
    employee_code: str | None
    working_days: frozenset[int]


class CalendarCache:
    """Per-request cache of plant working days and holidays."""

    def __init__(self, db: Session):
        self.db = db
        self._branch_days: dict[int | None, frozenset[int]] = {}
        self._holidays: dict[tuple[int | None, date, date], dict[date, HrHoliday]] = {}
        self._dept_by_name: dict[str, Department] | None = None
        self._depts: dict[int, Department] | None = None
        self._shifts: dict[int, HrShift] | None = None

    def working_days(self, branch_id: int | None) -> frozenset[int]:
        if branch_id not in self._branch_days:
            text = None
            if branch_id:
                branch = self.db.get(Branch, branch_id)
                text = branch.working_days if branch else None
            self._branch_days[branch_id] = parse_working_days(text)
        return self._branch_days[branch_id]

    def holidays(self, branch_id: int | None, start: date, end: date) -> dict[date, HrHoliday]:
        """Blocking holidays for a plant in [start, end], keyed by date."""
        key = (branch_id, start, end)
        if key not in self._holidays:
            q = self.db.query(HrHoliday).filter(
                HrHoliday.is_active.is_(True),
                HrHoliday.holiday_type.in_(BLOCKING_HOLIDAY_TYPES),
                HrHoliday.holiday_date >= start,
                HrHoliday.holiday_date <= end,
            )
            if branch_id:
                q = q.filter(or_(HrHoliday.branch_id.is_(None), HrHoliday.branch_id == branch_id))
            else:
                q = q.filter(HrHoliday.branch_id.is_(None))
            self._holidays[key] = {h.holiday_date: h for h in q.all()}
        return self._holidays[key]

    def departments(self) -> dict[int, Department]:
        if self._depts is None:
            self._depts = {d.id: d for d in self.db.query(Department).all()}
            self._dept_by_name = {d.name.strip().lower(): d for d in self._depts.values() if d.name}
        return self._depts

    def department_by_name(self, name: str | None) -> Department | None:
        self.departments()
        if not name:
            return None
        return (self._dept_by_name or {}).get(name.strip().lower())

    def shift(self, shift_id: int | None) -> HrShift | None:
        if not shift_id:
            return None
        if self._shifts is None:
            self._shifts = {s.id: s for s in self.db.query(HrShift).all()}
        return self._shifts.get(shift_id)

    def context(self, user: User, profile: HrEmployeeProfile | None = None, *, load_profile: bool = True) -> EmployeeContext:
        if profile is None and load_profile:
            profile = self.db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user.id).first()
        branch_id = (profile.branch_id if profile and profile.branch_id else None) or user.branch_id
        dept = None
        if profile and profile.department_id:
            dept = self.departments().get(profile.department_id)
        if dept is None:
            dept = self.department_by_name(user.department)
        return EmployeeContext(
            user=user,
            profile=profile,
            branch_id=branch_id,
            department_id=dept.id if dept else None,
            department_name=dept.name if dept else user.department,
            gender=((profile.gender or "").strip().lower() or None) if profile else None,
            shift=self.shift(profile.shift_id if profile else None),
            employee_code=profile.employee_code if profile else None,
            working_days=self.working_days(branch_id),
        )

    def day_kind(self, ctx: EmployeeContext, d: date) -> tuple[str, str | None]:
        """('holiday', name) / ('weekly_off', None) / ('working', None)."""
        hol = self.holidays(ctx.branch_id, date(d.year, 1, 1), date(d.year, 12, 31)).get(d)
        if hol:
            return "holiday", hol.name
        if d.weekday() not in ctx.working_days:
            return "weekly_off", None
        return "working", None


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def active_employees(db: Session) -> list[tuple[User, HrEmployeeProfile | None]]:
    """Active portal users who are not marked exited in HR."""
    rows = (
        db.query(User, HrEmployeeProfile)
        .outerjoin(HrEmployeeProfile, HrEmployeeProfile.user_id == User.id)
        .filter(User.is_active.is_(True))
        .order_by(User.name.asc())
        .all()
    )
    return [(u, p) for u, p in rows if not (p and p.employment_status == "exited")]
