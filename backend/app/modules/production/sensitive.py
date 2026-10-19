"""The Production "costs" sensitive switch (core/features/production.py):
users without it get cost / value fields blanked (None) in API responses.
Only the serialised output changes — never the stored data."""
from app.core.permission_registry import can_feature
from app.modules.main.models.user import User


def sees_costs(user: User, *tabs: str) -> bool:
    """True if `user` holds the costs switch on any of `tabs`."""
    return any(can_feature(user, "production", tab, "costs", "view") for tab in tabs)


def mask_bom(resp) -> None:
    resp.standard_material_cost = resp.standard_labour_cost = resp.standard_overhead_cost = None
    for line in resp.items:
        line.unit_cost = None
    for op in resp.operations:
        op.external_cost = None


def mask_explosion(payload) -> None:
    """Explosion payload (dict or model) — rows' unit / extended cost and the total."""
    get = payload.get if isinstance(payload, dict) else (lambda k, d=None: getattr(payload, k, d))
    rows = get("rows", []) or []
    for row in rows:
        for f in ("unit_cost", "extended_cost"):
            if isinstance(row, dict):
                if f in row:
                    row[f] = None
            elif hasattr(row, f):
                setattr(row, f, None)
    if isinstance(payload, dict):
        if "total_material_cost" in payload:
            payload["total_material_cost"] = None
    elif hasattr(payload, "total_material_cost"):
        payload.total_material_cost = None


def mask_work_order(resp) -> None:
    for op in getattr(resp, "operations", None) or []:
        if hasattr(op, "external_cost"):
            op.external_cost = None
    if hasattr(resp, "cost_relieved"):
        resp.cost_relieved = None


def mask_movement(resp) -> None:
    resp.order_unit_cost = None
    resp.order_value = None


def mask_consumption(resp) -> None:
    for row in resp.rows:
        row.unit_cost = None
        row.consumed_value = None
    resp.total_consumed_value = None
