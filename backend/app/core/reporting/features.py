"""Permission feature shared by every module's Reports tab."""
from __future__ import annotations

def management_feature() -> tuple:
    """`<module>:reports.management:view` - explicit-only (never inherited from
    the tab, never granted by module wildcards)."""
    from app.core.permission_registry import _feature  # lazy: permission_registry imports core.features at load

    return _feature(
        "management", "People & performance", "sensitive", {"view": None},
        "Per-person figures across the team: engineer / buyer / owner performance tables, grouping and "
        "filtering by another person. Without it a user sees only their own figures.",
    )
