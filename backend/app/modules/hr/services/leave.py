"""Leave business rules: day counting, application checks, balance
movements and the attendance rows an approved leave creates.

Day counting (see services/calendar.py for what is a weekly off/holiday):
- Only working days count. Weekly offs and national/festival holidays that
  apply to the employee's plant are skipped.
- Single-day leave: session 'full' = 1 day, 'first_half'/'second_half' = 0.5.
- Multi-day leave: the first day may start in the 'second_half' (0.5) and
  the last day may end after the 'first_half' (0.5). Starting a multi-day
  leave with only the first half (or ending it with only the second half)
  would leave a working gap in the middle, so it is rejected.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.hr.models.attendance import HrAttendance
from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveRequest, HrLeaveType, LEAVE_SESSIONS
from app.modules.hr.services.attendance import STATUS_LABELS
from app.modules.hr.services.calendar import CalendarCache, EmployeeContext, active_employees, daterange

HALF = Decimal("0.5")
ONE = Decimal("1")
ZERO = Decimal("0")

SESSION_LABELS = {"full": "Full day", "first_half": "First half", "second_half": "Second half"}


def fmt_days(value: Decimal | float | int) -> str:
    d = Decimal(str(value)).normalize()
    text = f"{d:f}"
    return f"{text} day" if d == 1 else f"{text} days"


def fmt_date(d: date) -> str:
    return d.strftime("%d-%m-%Y")


@dataclass
class DayPortion:
    date: date
    kind: str  # working / weekly_off / holiday
    portion: Decimal
    holiday_name: str | None = None


@dataclass
class LeaveEvaluation:
    days: Decimal = ZERO
    breakdown: list[DayPortion] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    document_required: bool = False
    balance_available: Decimal | None = None
    balance_pending: Decimal = ZERO
    balance_checked: bool = False


def count_leave_days(
    cache: CalendarCache,
    ctx: EmployeeContext,
    from_date: date,
    to_date: date,
    from_session: str,
    to_session: str,
) -> tuple[Decimal, list[DayPortion], list[str]]:
    errors: list[str] = []
    if from_session not in LEAVE_SESSIONS or to_session not in LEAVE_SESSIONS:
        errors.append(f"Session must be one of: {', '.join(LEAVE_SESSIONS)}.")
        return ZERO, [], errors
    if to_date < from_date:
        errors.append(
            f"The 'to' date ({fmt_date(to_date)}) is before the 'from' date ({fmt_date(from_date)}). "
            "Pick a 'to' date on or after the start date."
        )
        return ZERO, [], errors
    if (to_date - from_date).days > 366:
        errors.append("A single leave request can't be longer than a year. Split it into shorter requests.")
        return ZERO, [], errors

    single = from_date == to_date
    if single:
        session = from_session if from_session != "full" else to_session
    else:
        if from_session == "first_half":
            errors.append(
                "A multi-day leave can't start with only the first half of the first day — you'd be working the "
                "afternoon and then on leave the next day. Choose 'Full day' or 'Second half' for the start date."
            )
        if to_session == "second_half":
            errors.append(
                "A multi-day leave can't end with only the second half of the last day. Choose 'Full day' or "
                "'First half' for the end date."
            )
        if errors:
            return ZERO, [], errors

    total = ZERO
    breakdown: list[DayPortion] = []
    for d in daterange(from_date, to_date):
        kind, name = cache.day_kind(ctx, d)
        portion = ZERO
        if kind == "working":
            portion = ONE
            if single and session != "full":
                portion = HALF
            elif not single and d == from_date and from_session == "second_half":
                portion = HALF
            elif not single and d == to_date and to_session == "first_half":
                portion = HALF
        total += portion
        breakdown.append(DayPortion(date=d, kind=kind, portion=portion, holiday_name=name))
    return total, breakdown, errors


def get_balance(db: Session, user_id: int, leave_type_id: int, year: int) -> HrLeaveBalance | None:
    return (
        db.query(HrLeaveBalance)
        .filter(HrLeaveBalance.user_id == user_id, HrLeaveBalance.leave_type_id == leave_type_id, HrLeaveBalance.year == year)
        .first()
    )


def get_or_create_balance(db: Session, user_id: int, leave_type_id: int, year: int, actor_id: int | None, lock: bool = False) -> HrLeaveBalance:
    """`lock=True` takes a row lock (SELECT ... FOR UPDATE) so two concurrent
    approvals/cancellations can't both read the same `used` and lose an update."""
    if lock:
        bal = (
            db.query(HrLeaveBalance)
            .filter(HrLeaveBalance.user_id == user_id, HrLeaveBalance.leave_type_id == leave_type_id, HrLeaveBalance.year == year)
            .with_for_update().populate_existing().first()
        )
    else:
        bal = get_balance(db, user_id, leave_type_id, year)
    if bal is None:
        bal = HrLeaveBalance(
            user_id=user_id, leave_type_id=leave_type_id, year=year,
            opening=ZERO, allotted=ZERO, adjusted=ZERO, used=ZERO, updated_by_id=actor_id,
        )
        db.add(bal)
        db.flush()
    return bal


def pending_days(db: Session, user_id: int, leave_type_id: int, year: int, exclude_id: int | None = None) -> Decimal:
    q = db.query(HrLeaveRequest).filter(
        HrLeaveRequest.user_id == user_id,
        HrLeaveRequest.leave_type_id == leave_type_id,
        HrLeaveRequest.status == "pending",
    )
    if exclude_id:
        q = q.filter(HrLeaveRequest.id != exclude_id)
    return sum((Decimal(r.days) for r in q.all() if r.from_date.year == year), ZERO)


def _overlaps(db: Session, user_id: int, from_date: date, to_date: date, from_session: str, to_session: str, exclude_id: int | None):
    q = db.query(HrLeaveRequest).filter(
        HrLeaveRequest.user_id == user_id,
        HrLeaveRequest.status.in_(("pending", "approved")),
        HrLeaveRequest.from_date <= to_date,
        HrLeaveRequest.to_date >= from_date,
    )
    if exclude_id:
        q = q.filter(HrLeaveRequest.id != exclude_id)
    clashes = []
    for other in q.all():
        # Two half-days on the same single date in different halves don't clash.
        if (
            from_date == to_date == other.from_date == other.to_date
            and from_session != "full" and other.from_session != "full"
            and from_session != other.from_session
        ):
            continue
        clashes.append(other)
    return clashes


def evaluate_application(
    db: Session,
    cache: CalendarCache,
    ctx: EmployeeContext,
    leave_type: HrLeaveType | None,
    from_date: date,
    to_date: date,
    from_session: str,
    to_session: str,
    *,
    has_attachment: bool,
    exclude_request_id: int | None = None,
) -> LeaveEvaluation:
    ev = LeaveEvaluation()
    if leave_type is None:
        ev.errors.append("That leave type doesn't exist. Pick a leave type from the list.")
        return ev
    if not leave_type.is_active:
        ev.errors.append(f"{leave_type.name} is no longer offered. Pick another leave type or ask HR to reactivate it.")
        return ev

    if from_date.year != to_date.year:
        ev.errors.append(
            f"Leave balances are per calendar year, so a leave can't run from {from_date.year} into {to_date.year}. "
            f"Apply in two parts: up to 31-12-{from_date.year}, then from 01-01-{to_date.year}."
        )
        return ev

    if not leave_type.allow_half_day and ("first_half" in (from_session, to_session) or "second_half" in (from_session, to_session)):
        ev.errors.append(f"{leave_type.name} can only be taken in full days. Set both sessions to 'Full day'.")

    days, breakdown, errs = count_leave_days(cache, ctx, from_date, to_date, from_session, to_session)
    ev.days, ev.breakdown = days, breakdown
    ev.errors.extend(errs)
    if errs:
        return ev
    if days <= 0:
        ev.errors.append(
            "Every date you picked is a weekly off or a plant holiday, so there is nothing to apply leave for. "
            "Pick dates that include at least one working day."
        )
        return ev

    if leave_type.gender_restriction:
        want = leave_type.gender_restriction.lower()
        if not ctx.gender:
            ev.errors.append(
                f"{leave_type.name} is only for {want} employees, and HR hasn't recorded your gender yet. "
                "Ask HR to update your employee profile."
            )
        elif ctx.gender != want:
            ev.errors.append(f"{leave_type.name} is only available to {want} employees.")

    if leave_type.max_consecutive_days and days > leave_type.max_consecutive_days:
        ev.errors.append(
            f"{leave_type.name} can be taken for at most {fmt_days(leave_type.max_consecutive_days)} at a stretch, "
            f"but this request is {fmt_days(days)}. Shorten it or split it with another leave type."
        )

    if leave_type.requires_document_after_days is not None and days > leave_type.requires_document_after_days:
        ev.document_required = True
        if not has_attachment:
            ev.errors.append(
                f"{leave_type.name} longer than {fmt_days(leave_type.requires_document_after_days)} needs a supporting "
                f"document (e.g. a medical certificate). Attach the document to submit this {fmt_days(days)} request."
            )

    clashes = _overlaps(db, ctx.user.id, from_date, to_date, from_session, to_session, exclude_request_id)
    if clashes:
        c = clashes[0]
        ev.errors.append(
            f"These dates overlap your {c.status} leave {c.request_no} ({fmt_date(c.from_date)} to {fmt_date(c.to_date)}). "
            "Pick other dates, or cancel that request first."
        )

    if leave_type.is_paid:
        ev.balance_checked = True
        bal = get_balance(db, ctx.user.id, leave_type.id, from_date.year)
        available = Decimal(bal.available) if bal else ZERO
        pend = pending_days(db, ctx.user.id, leave_type.id, from_date.year, exclude_request_id)
        ev.balance_available = available
        ev.balance_pending = pend
        if bal is None:
            ev.errors.append(
                f"No {leave_type.name} balance has been allotted to you for {from_date.year}. "
                "Ask HR to allot this year's leave, or apply as Leave Without Pay."
            )
        elif days > available - pend:
            if pend > 0:
                ev.errors.append(
                    f"Your {leave_type.name} balance is {fmt_days(available)}, of which {fmt_days(pend)} is already in "
                    f"pending requests, so {fmt_days(max(available - pend, ZERO))} is free — but {fmt_days(days)} "
                    "were requested. Pick fewer days, cancel a pending request, or ask HR to adjust your balance."
                )
            else:
                ev.errors.append(
                    f"Your {leave_type.name} balance is {fmt_days(available)} but {fmt_days(days)} were requested. "
                    "Pick fewer days, apply the rest as Leave Without Pay, or ask HR to adjust your balance."
                )
    return ev


def working_portions(ev_breakdown: list[DayPortion]) -> list[DayPortion]:
    return [p for p in ev_breakdown if p.portion > 0]


# Attendance statuses that mean the person worked (or was on company duty).
WORKED_STATUSES = ("present", "half_day", "on_duty", "work_from_home")


def leave_attendance_conflicts(db: Session, req: HrLeaveRequest, portions: list[DayPortion]) -> list[str]:
    """Days in `portions` that already have a non-leave attendance entry
    saying the person worked. Approving would overwrite those entries (and a
    later cancellation would delete them), so the caller refuses instead.
    A half-day leave next to a present / half-day entry is fine (they worked
    the other half)."""
    by_date = {p.date: p for p in portions}
    if not by_date:
        return []
    rows = (
        db.query(HrAttendance)
        .filter(
            HrAttendance.user_id == req.user_id,
            HrAttendance.attendance_date.in_(list(by_date)),
            HrAttendance.source != "leave",
            HrAttendance.status.in_(WORKED_STATUSES),
        )
        .order_by(HrAttendance.attendance_date)
        .all()
    )
    out = []
    for row in rows:
        p = by_date[row.attendance_date]
        if p.portion < ONE and row.status in ("present", "half_day"):
            continue
        out.append(f"{STATUS_LABELS.get(row.status, row.status)} on {fmt_date(row.attendance_date)}")
    return out


def apply_leave_to_attendance(db: Session, req: HrLeaveRequest, leave_type: HrLeaveType, portions: list[DayPortion], actor_id: int | None) -> int:
    """Upsert hr_attendance for each leave day. Returns rows touched."""
    count = 0
    for p in portions:
        row = db.query(HrAttendance).filter(HrAttendance.user_id == req.user_id, HrAttendance.attendance_date == p.date).first()
        status = "on_leave" if p.portion >= ONE else "half_day"
        remarks = f"{leave_type.code} leave {req.request_no}" + (" (half day)" if p.portion < ONE else "")
        if row is None:
            row = HrAttendance(user_id=req.user_id, attendance_date=p.date)
            db.add(row)
        row.status = status
        row.source = "leave"
        row.remarks = remarks
        if status == "on_leave":
            # A full day of leave has no punches; stale times from an absent/other row would contradict it.
            row.check_in = None
            row.check_out = None
        row.marked_by_id = actor_id
        count += 1
    db.flush()
    return count


def remove_leave_attendance(db: Session, req: HrLeaveRequest) -> int:
    rows = (
        db.query(HrAttendance)
        .filter(
            HrAttendance.user_id == req.user_id,
            HrAttendance.attendance_date >= req.from_date,
            HrAttendance.attendance_date <= req.to_date,
            HrAttendance.source == "leave",
        )
        .all()
    )
    n = 0
    for row in rows:
        if row.remarks and req.request_no in row.remarks:
            db.delete(row)
            n += 1
    db.flush()
    return n


def _prorated_quota(quota: Decimal, doj: date | None, year: int) -> Decimal | None:
    """None = employee joins after this year (skip)."""
    if doj is None or doj.year < year:
        return quota
    if doj.year > year:
        return None
    # Joining month counts if joined by the 15th.
    months = 12 - (doj.month - 1) - (0 if doj.day <= 15 else 1)
    raw = quota * Decimal(months) / Decimal(12)
    return (raw * 2).to_integral_value(rounding="ROUND_FLOOR") / 2


def allot_year(
    db: Session,
    year: int,
    actor: User,
    leave_type_ids: list[int] | None = None,
    prorate_joiners: bool = True,
) -> dict:
    """Idempotent: re-running sets the same opening/allotted values again;
    `adjusted` and `used` are never touched."""
    q = db.query(HrLeaveType).filter(HrLeaveType.is_active.is_(True))
    if leave_type_ids:
        q = q.filter(HrLeaveType.id.in_(leave_type_ids))
    types = q.order_by(HrLeaveType.sort_order, HrLeaveType.id).all()
    if not types:
        raise HTTPException(
            status_code=400,
            detail="There are no active leave types to allot. Activate a leave type in HR Masters → Leave Types first.",
        )

    cache = CalendarCache(db)
    existing = {
        (b.user_id, b.leave_type_id): b
        for b in db.query(HrLeaveBalance).filter(HrLeaveBalance.year == year).all()
    }
    previous = {
        (b.user_id, b.leave_type_id): b
        for b in db.query(HrLeaveBalance).filter(HrLeaveBalance.year == year - 1).all()
    }
    created = updated = unchanged = skipped_gender = skipped_not_joined = 0
    employees = active_employees(db)
    for user, profile in employees:
        ctx = cache.context(user, profile, load_profile=False)
        for lt in types:
            if lt.gender_restriction and ctx.gender != lt.gender_restriction.lower():
                skipped_gender += 1
                continue
            quota = _prorated_quota(Decimal(lt.annual_quota or 0), user.date_of_joining, year) if prorate_joiners else Decimal(lt.annual_quota or 0)
            if quota is None:
                skipped_not_joined += 1
                continue
            carry = None
            if lt.carry_forward:
                prev = previous.get((user.id, lt.id))
                carry = ZERO
                if prev is not None:
                    carry = max(ZERO, min(Decimal(prev.available), Decimal(lt.max_carry_forward or 0)))
            bal = existing.get((user.id, lt.id))
            if bal is None:
                if quota == 0 and not carry:
                    continue
                bal = HrLeaveBalance(
                    user_id=user.id, leave_type_id=lt.id, year=year,
                    opening=carry or ZERO, allotted=quota, adjusted=ZERO, used=ZERO, updated_by_id=actor.id,
                )
                db.add(bal)
                created += 1
                continue
            changed = False
            if Decimal(bal.allotted) != quota:
                bal.allotted = quota
                changed = True
            if carry is not None and Decimal(bal.opening) != carry:
                bal.opening = carry
                changed = True
            if changed:
                bal.updated_by_id = actor.id
                updated += 1
            else:
                unchanged += 1
    db.flush()
    return {
        "year": year,
        "employees": len(employees),
        "leave_types": [lt.code for lt in types],
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "skipped_gender": skipped_gender,
        "skipped_not_joined": skipped_not_joined,
    }
