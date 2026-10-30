"""Two-value priority used app-wide: Standard (default) and Urgent.

Every module that stores or accepts a priority goes through this file so that
no third value (low / medium / high / critical) can be saved or selected.
"""
from fastapi import HTTPException

PRIORITIES: tuple[str, ...] = ("standard", "urgent")
DEFAULT_PRIORITY = "standard"

PRIORITY_LABELS: dict[str, str] = {"standard": "Standard", "urgent": "Urgent"}

# Sort rank: lower sorts first, so Urgent comes before Standard.
PRIORITY_RANK: dict[str, int] = {"urgent": 0, "standard": 1}

# Legacy words that meant "needs attention first" in the old 3/4-level scales.
_LEGACY_URGENT = {"urgent", "critical", "high"}


def parse_priority(v: str | None, default: str = DEFAULT_PRIORITY) -> str:
    """Return 'standard' or 'urgent' (any case). Empty -> default. Else HTTP 422."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return default
    key = str(v).strip().lower()
    if key in PRIORITIES:
        return key
    raise HTTPException(status_code=422, detail="Priority must be Standard or Urgent.")


def map_legacy_priority(v: str | None) -> str:
    """For imports only: urgent / critical / high -> urgent, everything else -> standard."""
    if v is None:
        return DEFAULT_PRIORITY
    key = str(v).strip().lower()
    return "urgent" if key in _LEGACY_URGENT else DEFAULT_PRIORITY


def priority_rank(v: str | None) -> int:
    """Sort rank for a stored value; unknown/legacy values sort as the mapped value."""
    return PRIORITY_RANK[map_legacy_priority(v)]


def priority_label(v: str | None) -> str:
    """'Standard' or 'Urgent' for any stored value (legacy values are mapped)."""
    return PRIORITY_LABELS[map_legacy_priority(v)]


def coerce_priority_field(v: str | None, *, blank_to: str | None = None) -> str | None:
    """For pydantic field validators: None stays None, a blank becomes `blank_to`, anything else
    must be Standard or Urgent (any case). Raises ValueError so the API answers 422 with the reason."""
    if v is None:
        return None
    if not str(v).strip():
        return blank_to
    key = str(v).strip().lower()
    if key in PRIORITIES:
        return key
    raise ValueError("Priority must be Standard or Urgent.")
