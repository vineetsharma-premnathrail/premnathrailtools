"""The Maintenance "Maintenance costs" switch
(maintenance:work_orders.costs:view — core/features/maintenance.py).

Users without it get maintenance money blanked (None) in API responses —
never changed in the database — and may not enter it: work-order spare /
labour / outside-service cost and totals, an asset's history cost, the cost
KPI on the dashboard and the cost section of Maintenance Reports. Roles never
customised inherit it from Work Orders › View, so nobody lost a number on
day 1. An asset's purchase cost is not covered: it is part of the asset
master that Assets › Edit already maintains."""
from __future__ import annotations

from fastapi import HTTPException

from app.core.permission_registry import can_feature

WO_MONEY = ("external_cost", "labour_cost", "spares_cost", "total_cost", "procured_cost")
COST_KEYS = ("spares", "labour", "external", "total")

_DENIED = (
    "You can't see or enter maintenance costs — that needs Maintenance › Work Orders › Maintenance costs. "
    "Leave the {what} blank, or ask an admin to add it to your role in "
    "Organization › Role & Permissions."
)


def sees_costs(user) -> bool:
    return can_feature(user, "maintenance", "work_orders", "costs", "view")


def mask_work_order(user, resp):
    """Blank the money on a MaintenanceWorkOrderResponse (in place); returns it."""
    if user is None or sees_costs(user):
        return resp
    for f in WO_MONEY:
        setattr(resp, f, None)
    for s in resp.spares:
        s.unit_cost = None
        s.net_cost = None
    for lg in resp.labour_logs:
        lg.hourly_rate = None
        lg.cost = None
    return resp


def mask_summary(user, summary: dict) -> dict:
    """Blank the cost KPI and the cost section of a reporting summary."""
    if user is None or sees_costs(user):
        return summary
    summary.get("kpis", {})["maintenance_cost"] = None
    cost = summary.get("cost") or {}
    rows = [cost.get("total") or {}, *(cost.get("by_month") or []), *(cost.get("by_asset") or [])]
    for row in rows:
        for k in COST_KEYS:
            if k in row:
                row[k] = None
    return summary


def ensure_may_enter(user, data: dict, current, fields, what: str = "cost") -> None:
    """403 when a user without the switch sends a cost that differs from the
    stored value (0 / blank / an unchanged echo is fine)."""
    if sees_costs(user):
        return
    for f in fields:
        if data.get(f) is None:
            continue
        old = getattr(current, f, None) if current is not None else None
        if float(old or 0) != float(data[f] or 0):
            raise HTTPException(status_code=403, detail=_DENIED.format(what=what))
