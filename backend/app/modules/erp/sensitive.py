"""The Service "Charges, costs & billing amounts" switch
(erp:service_requests.charges:view — core/features/erp.py).

Users without it get the money on service requests blanked (None) in API
responses — never changed in the database — and may not change it. Roles
that were never customised inherit it from Service Requests › View, so
nobody lost sight of a number on day 1."""
from __future__ import annotations

from fastapi import HTTPException

from app.core.permission_registry import can_feature
from app.modules.erp.schemas.service_request import ServiceMaterialResponse, ServiceRequestResponse

# Money on the SR itself (tax % stays visible: it is a rate, not an amount).
SR_MONEY = (
    "service_cost", "transport_cost", "accommodation_cost", "miscellaneous_cost",
    "total_material_cost", "tax_amount", "total_bill", "material_cost_actual",
)
MATERIAL_MONEY = ("estimated_budget", "unit_cost", "unit_price")
# Keys blanked anywhere inside a dict answer (visits summary, invoice card).
DICT_MONEY = frozenset({
    *SR_MONEY, "travel_cost", "stay_cost", "misc_cost", "labour_rate_per_hour", "travel_rate_per_hour",
    "taxable_amount", "cgst_amount", "sgst_amount", "igst_amount", "total_amount", "amount_due", "rate",
})

_DENIED = (
    "You can't see or change charges on service requests — that needs Service & Commissioning › Service Requests › "
    "Charges, costs & billing amounts. Leave the {what} out, or ask an admin "
    "to add it to your role in Organization › Role & Permissions."
)


def sees_charges(user) -> bool:
    return can_feature(user, "erp", "service_requests", "charges", "view")


def material_out(user, mat, sees: bool | None = None) -> ServiceMaterialResponse:
    out = ServiceMaterialResponse.model_validate(mat)
    if not (sees_charges(user) if sees is None else sees):
        for f in MATERIAL_MONEY:
            setattr(out, f, None)
    return out


def materials_out(user, mats) -> list[ServiceMaterialResponse]:
    sees = sees_charges(user)
    return [material_out(user, m, sees) for m in mats]


def sr_out(user, sr, sees: bool | None = None) -> ServiceRequestResponse:
    out = ServiceRequestResponse.model_validate(sr)
    if not (sees_charges(user) if sees is None else sees):
        for f in SR_MONEY:
            setattr(out, f, None)
        for m in out.materials:
            for f in MATERIAL_MONEY:
                setattr(m, f, None)
    return out


def srs_out(user, srs) -> list[ServiceRequestResponse]:
    sees = sees_charges(user)
    return [sr_out(user, s, sees) for s in srs]


def mask_dict(user, data):
    """Blank money keys anywhere in a plain dict / list answer."""
    if sees_charges(user):
        return data

    def walk(x):
        if isinstance(x, dict):
            return {k: (None if k in DICT_MONEY and isinstance(v, (int, float)) and not isinstance(v, bool) else walk(v))
                    for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return x

    return walk(data)


def ensure_may_change(user, changes: dict, current, fields, what: str = "charge fields") -> None:
    """403 when a user without the switch sends a money value that differs
    from what is stored (an unchanged / blank echo is fine)."""
    if sees_charges(user):
        return
    for f in fields:
        if f not in changes or changes[f] is None:
            continue
        old = getattr(current, f, None) if current is not None else None
        if float(old or 0) != float(changes[f] or 0):
            raise HTTPException(status_code=403, detail=_DENIED.format(what=what))
