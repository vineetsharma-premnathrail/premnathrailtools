"""
Translate raw database errors into messages a user can act on.

Postgres rejects bad data with messages like "value too long for type
character varying(300)" — accurate, but meaningless to whoever is filling in
the form, and until now those surfaced as a blank "Internal server error.
Please contact support." Everything here turns one of those failures into a
plain sentence that names the field, says what the limit or rule is, and tells
the user what to change.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import String
from sqlalchemy.exc import DBAPIError

from app.db.base import Base

# Postgres SQLSTATE codes we can explain.
STRING_TOO_LONG = "22001"
NUMERIC_OUT_OF_RANGE = "22003"
INVALID_TEXT_REPRESENTATION = "22P02"
DATETIME_FIELD_OVERFLOW = "22008"
INVALID_DATETIME_FORMAT = "22007"
DIVISION_BY_ZERO = "22012"
NOT_NULL_VIOLATION = "23502"
FOREIGN_KEY_VIOLATION = "23503"
UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"

_TABLE_RE = re.compile(r"(?:INSERT\s+INTO|UPDATE)\s+\"?([a-zA-Z0-9_]+)\"?", re.IGNORECASE)
_VARCHAR_LIMIT_RE = re.compile(r"character varying\((\d+)\)")


def humanize(name: str | None) -> str:
    """`issue_title` -> `Issue title`; falls back to a neutral word."""
    if not name:
        return "One of the fields"
    return name.replace("_id", "").replace("_", " ").strip().capitalize() or "One of the fields"


def _table_name(exc: DBAPIError) -> str | None:
    statement = getattr(exc, "statement", None)
    if not statement:
        return None
    match = _TABLE_RE.search(statement)
    return match.group(1) if match else None


def _params(exc: DBAPIError) -> dict[str, Any]:
    params = getattr(exc, "params", None)
    if isinstance(params, dict):
        return params
    if isinstance(params, (list, tuple)) and params and isinstance(params[0], dict):
        return params[0]
    return {}


def _diag(exc: DBAPIError) -> Any:
    return getattr(getattr(exc, "orig", None), "diag", None)


def _sqlstate(exc: DBAPIError) -> str | None:
    orig = getattr(exc, "orig", None)
    state = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    if state:
        return str(state)
    diag = _diag(exc)
    return getattr(diag, "sqlstate", None) if diag else None


def _overlong_fields(exc: DBAPIError) -> list[tuple[str, int, int]]:
    """
    Postgres does not say WHICH column overflowed, so find it ourselves:
    match the statement's table against the model metadata and compare every
    string column's limit with the value that was actually sent.
    """
    table_name = _table_name(exc)
    table = Base.metadata.tables.get(table_name) if table_name else None
    if table is None:
        return []
    params = _params(exc)
    found: list[tuple[str, int, int]] = []
    for column in table.columns:
        limit = getattr(column.type, "length", None)
        if not isinstance(column.type, String) or not limit:
            continue
        value = params.get(column.name)
        if isinstance(value, str) and len(value) > limit:
            found.append((column.name, limit, len(value)))
    return found


def _constraint_columns(exc: DBAPIError, constraint_name: str | None) -> list[str]:
    """Map a violated constraint/index name back to the columns it covers."""
    if not constraint_name:
        return []
    table_name = _table_name(exc)
    table = Base.metadata.tables.get(table_name) if table_name else None
    if table is None:
        return []
    for constraint in table.constraints:
        if constraint.name == constraint_name:
            return [c.name for c in getattr(constraint, "columns", [])]
    for index in table.indexes:
        if index.name == constraint_name:
            return [c.name for c in index.columns]
    # Constraints created implicitly by `unique=True` / `ForeignKey(...)` are
    # unnamed in the metadata, so Postgres' auto-generated name
    # ("<table>_<column>_key") is all we have to go on — read the column out of it.
    remainder = constraint_name
    if remainder.startswith(f"{table.name}_"):
        remainder = remainder[len(table.name) + 1:]
    matches = [c.name for c in table.columns if c.name in remainder]
    return sorted(matches, key=len, reverse=True)[:1]


def _labelled(columns: list[str]) -> str:
    return " and ".join(humanize(c) for c in columns)


def describe_db_error(exc: DBAPIError) -> tuple[int, str] | None:
    """
    Return `(status_code, message)` for a database error we can explain, or
    None to let the caller fall back to its generic handling.
    """
    state = _sqlstate(exc)
    diag = _diag(exc)
    message = str(getattr(exc, "orig", exc))

    if state == STRING_TOO_LONG:
        overlong = _overlong_fields(exc)
        if overlong:
            return 400, " ".join(
                f"{humanize(name)} is too long — it can hold up to {limit} characters, "
                f"but you entered {actual}. Please shorten it by {actual - limit} characters."
                for name, limit, actual in overlong
            )
        limit_match = _VARCHAR_LIMIT_RE.search(message)
        if limit_match:
            return 400, (
                f"One of the fields is too long — it can hold up to {limit_match.group(1)} "
                "characters. Please shorten the longest text on this form and save again."
            )
        return 400, "One of the fields is too long. Please shorten it and save again."

    if state == NOT_NULL_VIOLATION:
        field = humanize(getattr(diag, "column_name", None) if diag else None)
        return 400, f"{field} is required. Please fill it in before saving."

    if state == UNIQUE_VIOLATION:
        constraint = getattr(diag, "constraint_name", None) if diag else None
        columns = _constraint_columns(exc, constraint)
        field = _labelled(columns) if columns else "One of the values you entered"
        return 409, (
            f"{field} is already used by another record, and it has to be unique. "
            "Please enter a different value."
        )

    if state == FOREIGN_KEY_VIOLATION:
        constraint = getattr(diag, "constraint_name", None) if diag else None
        columns = _constraint_columns(exc, constraint)
        field = _labelled(columns) if columns else "One of the linked records"
        if "still referenced" in message:
            return 409, (
                "This record is still linked to other records, so it can't be removed. "
                "Please delete or re-link those records first."
            )
        return 400, (
            f"{field} points to a record that no longer exists. "
            "Please refresh the page and select it again."
        )

    if state == CHECK_VIOLATION:
        constraint = getattr(diag, "constraint_name", None) if diag else None
        columns = _constraint_columns(exc, constraint)
        field = _labelled(columns) if columns else "One of the values you entered"
        return 400, (
            f"{field} is not allowed by the rule '{constraint or 'set on this field'}'. "
            "Please correct it and save again."
        )

    if state == NUMERIC_OUT_OF_RANGE:
        return 400, (
            "One of the numbers you entered is too large for the field it goes in. "
            "Please enter a smaller value."
        )

    if state in (INVALID_TEXT_REPRESENTATION, INVALID_DATETIME_FORMAT, DATETIME_FIELD_OVERFLOW):
        return 400, (
            "One of the values isn't in the format the field expects — most often a date "
            "or a number typed as text. Please check the highlighted fields and save again."
        )

    if state == DIVISION_BY_ZERO:
        return 400, "A calculation divided by zero. Please check the quantities and rates you entered."

    return None
