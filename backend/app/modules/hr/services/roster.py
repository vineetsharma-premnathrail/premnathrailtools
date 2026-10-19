"""Shift roster (SAP PT01) — patterns, generation, CSV upload, grid.

See models/roster.py for precedence. Every write checks:
- the date isn't in a payroll-locked attendance period (period_lock);
- the shift is active and valid at the employee's plant (shift.branch_id
  NULL = all plants);
- an employee can't roster themself (same segregation as attendance).
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.hr.models.masters import HrShift
from app.modules.hr.models.roster import PATTERN_OFF, HrShiftPattern, HrShiftRoster
from app.modules.hr.services import period_lock
from app.modules.hr.services.calendar import CalendarCache, daterange
from app.modules.main.models.user import User

MAX_RANGE_DAYS = 92
MAX_GENERATE_CELLS = 40_000
OFF_TOKENS = {"off", "wo", "w/o", "weekly off", "weekly_off", "o"}
ROSTER_TEMPLATE = ("employee_code,email,date,shift,weekly_off\nE001,,2026-11-02,A,\n,name@premnathrail.com,02-11-2026,,yes\n")


def _fmt(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def shifts_by_code(db: Session) -> dict[str, HrShift]:
    return {s.code.strip().upper(): s for s in db.query(HrShift).all()}


def validate_pattern(db: Session, pattern: list, branch_id: int | None) -> list[str]:
    if not pattern:
        raise HTTPException(status_code=400, detail="The pattern is empty. Add one entry per day of the cycle: a shift code or 'off'.")
    if len(pattern) > 62:
        raise HTTPException(status_code=400, detail=f"A cycle of {len(pattern)} days is too long — keep it to 62 days or less (e.g. a 21-day A/B/C rotation).")
    by_code = shifts_by_code(db)
    out = []
    for i, raw in enumerate(pattern, start=1):
        tok = str(raw or "").strip()
        if tok.lower() in OFF_TOKENS:
            out.append(PATTERN_OFF)
            continue
        s = by_code.get(tok.upper())
        if s is None:
            raise HTTPException(status_code=400, detail=f"Day {i} of the pattern: shift '{tok}' doesn't exist. Use a shift code from HR > Masters > Shifts, or 'off'.")
        if not s.is_active:
            raise HTTPException(status_code=400, detail=f"Day {i} of the pattern: shift {s.code} is inactive. Re-activate it in HR > Masters > Shifts or use another.")
        if branch_id and s.branch_id and s.branch_id != branch_id:
            raise HTTPException(status_code=400, detail=f"Day {i} of the pattern: shift {s.code} belongs to another plant. Use a shift of this plant or an all-plants shift.")
        out.append(s.code)
    if all(x == PATTERN_OFF for x in out):
        raise HTTPException(status_code=400, detail="Every day of the pattern is 'off'. Put at least one shift in it.")
    return out


def _check_shift_for(cache: CalendarCache, ctx, shift: HrShift | None, d: date) -> None:
    if shift is None:
        return
    if not shift.is_active:
        raise HTTPException(status_code=400, detail=f"Shift {shift.code} is inactive, so it can't be rostered. Re-activate it in HR > Masters > Shifts or pick another.")
    if ctx.branch_id and shift.branch_id and shift.branch_id != ctx.branch_id:
        raise HTTPException(
            status_code=400,
            detail=f"Shift {shift.code} belongs to another plant, but {ctx.user.name} works at a different plant. Pick a shift of their plant or an all-plants shift.",
        )


def set_cell(db: Session, cache: CalendarCache, user: User, d: date, shift: HrShift | None, weekly_off: bool, *,
             source: str, actor: User, pattern_id: int | None = None, remarks: str | None = None,
             clear: bool = False) -> HrShiftRoster | None:
    """Create / update / clear one employee-day. Does not commit."""
    if user.id == actor.id:
        raise HTTPException(status_code=403, detail="You can't change your own shift roster. Ask another HR user to do it.")
    period_lock.assert_open(db, user.id, d)
    ctx = cache.context(user)
    row = db.query(HrShiftRoster).filter(HrShiftRoster.user_id == user.id, HrShiftRoster.roster_date == d).first()
    if clear:
        if row is not None:
            db.delete(row)
        return None
    if shift is None and not weekly_off:
        raise HTTPException(status_code=400, detail=f"{user.name} on {_fmt(d)}: pick a shift or mark the day as a weekly off.")
    _check_shift_for(cache, ctx, shift, d)
    if row is None:
        row = HrShiftRoster(user_id=user.id, roster_date=d, created_by_id=actor.id)
        db.add(row)
    row.shift_id = shift.id if shift else None
    row.is_weekly_off = bool(weekly_off)
    row.source = source
    row.pattern_id = pattern_id
    if remarks is not None:
        row.remarks = remarks or None
    return row


def check_range(start: date, end: date, limit: int = MAX_RANGE_DAYS) -> None:
    if end < start:
        raise HTTPException(status_code=400, detail=f"The end date {_fmt(end)} is before the start date {_fmt(start)}. Swap them.")
    if (end - start).days + 1 > limit:
        raise HTTPException(status_code=400, detail=f"Pick at most {limit} days at a time (you picked {(end - start).days + 1}).")


def generate(db: Session, pattern: HrShiftPattern, users: list[User], start: date, end: date, *, anchor: date | None,
             offset_by_user: dict[int, int] | None, overwrite: bool, actor: User) -> dict:
    """Lay the pattern over start..end for each user. Cycle day of date d =
    (d − anchor + offset) mod cycle_days; anchor defaults to `start`, so
    staggering crews (A team on day 0, B team on day 7) is just an offset."""
    check_range(start, end)
    if not pattern.is_active:
        raise HTTPException(status_code=400, detail=f"Pattern {pattern.code} is inactive. Re-activate it before generating a roster from it.")
    cells = len(users) * ((end - start).days + 1)
    if cells > MAX_GENERATE_CELLS:
        raise HTTPException(status_code=400, detail=f"That is {cells:,} roster cells — too many at once. Generate fewer employees or a shorter range (max {MAX_GENERATE_CELLS:,}).")
    by_code = shifts_by_code(db)
    anchor = anchor or start
    cache = CalendarCache(db)
    cache.prefetch_roster([u.id for u in users], start, end)
    created = updated = 0
    skipped: list[dict] = []
    for u in users:
        if u.id == actor.id:
            skipped.append({"user_id": u.id, "user_name": u.name, "date": None, "reason": "You can't roster yourself."})
            continue
        off = (offset_by_user or {}).get(u.id, 0)
        for d in daterange(start, end):
            tok = pattern.pattern[((d - anchor).days + off) % pattern.cycle_days]
            existing = cache.roster_row(u.id, d)
            if existing is not None and not overwrite:
                skipped.append({"user_id": u.id, "user_name": u.name, "date": d, "reason": "Already rostered (tick overwrite to replace)."})
                continue
            shift = None if tok == PATTERN_OFF else by_code.get(str(tok).upper())
            try:
                set_cell(db, cache, u, d, shift, tok == PATTERN_OFF, source="pattern", actor=actor, pattern_id=pattern.id)
            except HTTPException as exc:
                skipped.append({"user_id": u.id, "user_name": u.name, "date": d, "reason": str(exc.detail)})
                continue
            created += int(existing is None)
            updated += int(existing is not None)
    db.flush()
    return {"created": created, "updated": updated, "skipped": skipped}


def grid(db: Session, users: list[User], start: date, end: date) -> list[dict]:
    """Rows of employees × days with the effective plan per day."""
    check_range(start, end)
    cache = CalendarCache(db)
    cache.prefetch_roster([u.id for u in users], start, end)
    out = []
    for u in users:
        ctx = cache.context(u)
        days = []
        for d in daterange(start, end):
            r = cache.roster_row(u.id, d)
            kind, hol = cache.day_kind(ctx, d)
            shift = cache.shift_on(ctx, d)
            days.append({
                "date": d, "rostered": r is not None, "shift_id": shift.id if shift and kind == "working" else None,
                "shift_code": shift.code if shift and kind == "working" else None,
                "is_weekly_off": kind == "weekly_off", "holiday": hol, "source": r.source if r else None,
                "locked": period_lock.is_locked(db, u.id, d),
            })
        out.append({"user_id": u.id, "user_name": u.name, "employee_code": ctx.employee_code,
                    "default_shift_code": ctx.shift.code if ctx.shift else None, "days": days})
    return out


def parse_bool(v: str) -> bool:
    return (v or "").strip().lower() in ("y", "yes", "true", "1", "off", "wo")


def next_cycle_day(pattern: HrShiftPattern, anchor: date, d: date, offset: int = 0) -> int:
    return ((d - anchor).days + offset) % pattern.cycle_days


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())
