"""Date maths for reports. IST is a fixed offset, so tests (SQLite) and
production (Postgres) group days identically; naive datetimes are UTC."""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException

IST = timezone(timedelta(hours=5, minutes=30))
MAX_DAYS = 3 * 366

PRESETS: list[tuple[str, str]] = [
    ("this_month", "This month"), ("last_month", "Last month"),
    ("this_quarter", "This quarter"), ("last_quarter", "Last quarter"),
    ("this_fy", "This financial year"), ("last_fy", "Last financial year"),
    ("last_30_days", "Last 30 days"), ("last_90_days", "Last 90 days"), ("custom", "Custom"),
]
COMPARE_OPTIONS: list[tuple[str, str]] = [("previous_period", "Previous period"), ("previous_year", "Same period last year")]


def fmt(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def to_ist(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def ist_date(value: datetime | date | None) -> date | None:
    """IST calendar date of a datetime (a plain date is returned as is)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return to_ist(value).date()
    return value


def today_ist() -> date:
    return datetime.now(timezone.utc).astimezone(IST).date()


def bounds(d_from: date, d_to: date) -> tuple[datetime, datetime]:
    """[d_from 00:00 IST, d_to + 1 day 00:00 IST) as UTC datetimes."""
    start = datetime.combine(d_from, time.min, tzinfo=IST).astimezone(timezone.utc)
    end = datetime.combine(d_to + timedelta(days=1), time.min, tzinfo=IST).astimezone(timezone.utc)
    return start, end


def _fy_start_year(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def fy_label(start: date) -> str:
    return f"FY {start.year}-{str(start.year + 1)[2:]}"


def bucket(d: date, kind: str) -> date:
    """Start date of the bucket holding `d` (week = ISO, Monday; fy = April)."""
    if kind == "day":
        return d
    if kind == "week":
        return d - timedelta(days=d.weekday())
    if kind == "month":
        return d.replace(day=1)
    if kind == "quarter":
        return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)
    if kind == "fy":
        return date(_fy_start_year(d), 4, 1)
    raise ValueError(f"Unknown bucket '{kind}'.")


def bucket_end(start: date, kind: str) -> date:
    """Last day of the bucket starting at `start`."""
    if kind == "day":
        return start
    if kind == "week":
        return start + timedelta(days=6)
    if kind == "month":
        return start.replace(day=calendar.monthrange(start.year, start.month)[1])
    if kind == "quarter":
        m = start.month + 2
        return date(start.year, m, calendar.monthrange(start.year, m)[1])
    if kind == "fy":
        return date(start.year + 1, 3, 31)
    raise ValueError(f"Unknown bucket '{kind}'.")


def bucket_label(start: date, kind: str) -> str:
    if kind == "day":
        return fmt(start)
    if kind == "week":
        iso = start.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d} (from {fmt(start)})"
    if kind == "month":
        return start.strftime("%b %Y")
    if kind == "quarter":
        return f"{start.year} Q{(start.month - 1) // 3 + 1}"
    return fy_label(start)


def _month_add(d: date, months: int) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    return date(idx // 12, idx % 12 + 1, 1)


def resolve(preset: str | None, d_from: date | None, d_to: date | None, today: date | None = None) -> tuple[date, date, str]:
    """(from, to, label). Explicit dates win; a preset names the range when
    no dates are given. Raises 422 with a fix-it message."""
    today = today or today_ist()
    labels = dict(PRESETS)
    if preset is not None and preset not in labels:
        raise HTTPException(422, f"Period '{preset}' is not valid. Use one of: {', '.join(labels.values())}.")
    if d_from is not None and d_to is not None:
        label = labels.get(preset or "custom", "Custom") if preset else "Custom"
        start, end = d_from, d_to
    elif d_from is not None or d_to is not None:
        raise HTTPException(422, "Give both a 'From' and a 'To' date (or choose a period such as This month).")
    else:
        preset = preset if preset and preset != "custom" else "this_month"
        label = labels[preset]
        m0 = today.replace(day=1)
        if preset == "this_month":
            start, end = m0, bucket_end(m0, "month")
        elif preset == "last_month":
            start = _month_add(m0, -1)
            end = bucket_end(start, "month")
        elif preset == "this_quarter":
            start = bucket(today, "quarter")
            end = bucket_end(start, "quarter")
        elif preset == "last_quarter":
            start = _month_add(bucket(today, "quarter"), -3)
            end = bucket_end(start, "quarter")
        elif preset == "this_fy":
            start = bucket(today, "fy")
            end = bucket_end(start, "fy")
        elif preset == "last_fy":
            start = date(bucket(today, "fy").year - 1, 4, 1)
            end = bucket_end(start, "fy")
        elif preset == "last_30_days":
            start, end = today - timedelta(days=29), today
        else:  # last_90_days
            start, end = today - timedelta(days=89), today
    if start > end:
        raise HTTPException(422, f"'From' date {fmt(start)} is after 'To' date {fmt(end)} - swap them.")
    if (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(422, "The period is longer than 3 years - pick a shorter range (for example one financial year).")
    return start, end, label


def compare_range(kind: str, d_from: date, d_to: date) -> tuple[date, date]:
    """Previous period of equal length, or the same dates one year earlier."""
    if kind == "previous_period":
        days = (d_to - d_from).days + 1
        prev_to = d_from - timedelta(days=1)
        return prev_to - timedelta(days=days - 1), prev_to
    if kind == "previous_year":
        def back(d: date) -> date:
            try:
                return d.replace(year=d.year - 1)
            except ValueError:  # 29 Feb
                return d.replace(year=d.year - 1, day=28)
        return back(d_from), back(d_to)
    raise HTTPException(422, f"Comparison '{kind}' is not valid. Use one of: {', '.join(k for k, _ in COMPARE_OPTIONS)}.")
