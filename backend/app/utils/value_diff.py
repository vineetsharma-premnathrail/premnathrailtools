"""Did a field really change? — used before writing an audit / timeline row.

A form sends "" for a box the user never filled, the database holds None, a
number comes back as Decimal("5.00") against a typed 5, a date as a date
object against "2026-09-14". Comparing with ``str(a) != str(b)`` calls all of
those a change and fills the history with "— → —" rows. ``same_value`` treats
them as equal: blank (None, "", spaces, empty list/dict) is one value, numbers
compare by amount, dates by their ISO text, enums by their value.
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def _norm(v: Any) -> Any:
    if isinstance(v, enum.Enum):
        v = v.value
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, (list, tuple, set, dict)) and len(v) == 0:
        return None
    return v


def _as_number(v: Any) -> Decimal | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    if isinstance(v, str):
        try:
            return Decimal(v)
        except InvalidOperation:
            return None
    return None


def same_value(old: Any, new: Any) -> bool:
    a, b = _norm(old), _norm(new)
    if a is None or b is None:
        return a is None and b is None
    if a == b:
        return True
    if isinstance(a, bool) or isinstance(b, bool):
        return str(a).lower() == str(b).lower()
    # Only treat as numbers when at least one side really is a number, so codes
    # like "007" and "7" typed as text stay different.
    if isinstance(a, (int, float, Decimal)) or isinstance(b, (int, float, Decimal)):
        na, nb = _as_number(a), _as_number(b)
        if na is not None and nb is not None:
            return na == nb
    if isinstance(a, (date, datetime)) or isinstance(b, (date, datetime)):
        ia = a.isoformat() if isinstance(a, (date, datetime)) else str(a)
        ib = b.isoformat() if isinstance(b, (date, datetime)) else str(b)
        return ia == ib
    return str(a) == str(b)


def changed(old: Any, new: Any) -> bool:
    return not same_value(old, new)
