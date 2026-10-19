"""Material Issue form standard — what each issue type asks for (2026-10-12).

Like an SAP movement type, the issue type decides the mandatory "against"
(who the material is for / where its cost goes) and the extra details. Two
rules run through it:
  1. every issue says who the material is for (work order, project,
     department, vendor, customer …);
  2. material that leaves the factory always travels on a delivery challan.

The form (GET /store/material-issues/form-standard) and the server
validation (validate_issue) both read ISSUE_FORMS, so they can't disagree.
Fields a type doesn't list are cleared on save, so switching type in the
form never leaves stale values behind. Production is kept simple for now
(user decision 2026-10-12 — no work-order link yet)."""
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.store.services.project_stock import PROJECT_ISSUE_TYPES

JOB_WORK_PROCESSES = {
    "machining": "Machining", "plating": "Plating / Coating", "heat_treatment": "Heat treatment",
    "fabrication": "Fabrication / Welding", "outside_testing": "Testing at outside lab", "other": "Other",
}
SAMPLE_PURPOSES = {"sample": "Sample", "trial": "Trial"}

# Field catalogue: label + input kind (the form renders by kind).
FIELDS: dict[str, dict] = {
    "department_id": {"label": "Department", "kind": "department"},
    "maintenance_work_order_id": {"label": "Maintenance work order", "kind": "maintenance_work_order"},
    "asset_id": {"label": "Machine / asset", "kind": "asset"},
    "erp_project_id": {"label": "Project / machine (order)", "kind": "erp_project"},
    "service_request_id": {"label": "Service request", "kind": "service_request"},
    "site_address": {"label": "Site address", "kind": "text"},
    "ncr_id": {"label": "NCR", "kind": "ncr"},
    "inspection_lot_id": {"label": "Inspection lot", "kind": "inspection_lot"},
    "project_or_work_order": {"label": "Work order no.", "kind": "text"},
    "destructive": {"label": "Destructive test? (material used up)", "kind": "bool"},
    "vendor_id": {"label": "Vendor", "kind": "vendor"},
    "process": {"label": "Process", "kind": "choice", "options": JOB_WORK_PROCESSES},
    "output_item_id": {"label": "Item to receive back", "kind": "item"},
    "customer_id": {"label": "Customer", "kind": "customer"},
    "purpose": {"label": "Purpose", "kind": "choice", "options": SAMPLE_PURPOSES},
    "returnable": {"label": "Returnable? (comes back)", "kind": "bool"},
    "expected_return_date": {"label": "Expected return date", "kind": "date"},
    "scrap_buyer": {"label": "Scrap buyer (if sold)", "kind": "text"},
    "challan_number": {"label": "Delivery challan no.", "kind": "text"},
    "vehicle_number": {"label": "Vehicle / courier no.", "kind": "text"},
    "transporter": {"label": "Transporter", "kind": "text"},
    "lr_number": {"label": "LR no.", "kind": "text"},
}

# Per type: fields shown, in order, with their rule:
#   "required" · "optional" · "one_of:<group>" (at least one of the group)
#   · "if:<field>=<value>" (required when that field has that value)
#   · "unless:sales_order" (required unless a Sales Order / schedule row is given).
# leaves_factory → challan required. manager_only → only a Store Manager / admin posts it.
# remarks_label → remarks are required, with this prompt.
ISSUE_FORMS: dict[str, dict] = {
    "production": {"fields": {"project_or_work_order": "optional"}},
    "maintenance": {"fields": {"maintenance_work_order_id": "one_of:against", "asset_id": "one_of:against"}},
    "project": {"leaves_factory": True, "fields": {
        "erp_project_id": "required", "site_address": "optional", "returnable": "optional",
        "expected_return_date": "if:returnable=true", "challan_number": "required", "vehicle_number": "optional"}},
    "general": {"fields": {"department_id": "required"}},
    "rework": {"fields": {"ncr_id": "one_of:against", "project_or_work_order": "one_of:against"}},
    "testing": {"fields": {
        "inspection_lot_id": "one_of:against", "ncr_id": "one_of:against", "destructive": "required",
        "expected_return_date": "if:destructive=false"}},
    "job_work": {"leaves_factory": True, "fields": {
        "vendor_id": "required", "process": "required", "output_item_id": "optional", "expected_return_date": "required",
        "challan_number": "required", "vehicle_number": "optional"}},
    "scrap": {"manager_only": True, "remarks_label": "Reason for scrapping / disposal", "fields": {
        "scrap_buyer": "optional", "challan_number": "if:scrap_buyer", "vehicle_number": "optional"}},
    "customer_sample": {"leaves_factory": True, "fields": {
        "customer_id": "required", "purpose": "required", "returnable": "required",
        "expected_return_date": "if:returnable=true", "challan_number": "required", "vehicle_number": "optional"}},
    # A spares / sales-order dispatch has no machine: the Sales Order (or its
    # delivery-schedule row) names what is dispatched instead (2026-10-14).
    "dispatch": {"leaves_factory": True, "fields": {
        "erp_project_id": "unless:sales_order", "challan_number": "required", "transporter": "optional",
        "vehicle_number": "optional", "lr_number": "optional"}},
    # Spares sent to a customer site for a service request — the SR names the
    # machine and customer; erp/spares.py books the quantities on the SR.
    "service": {"leaves_factory": True, "fields": {
        "service_request_id": "required", "site_address": "optional", "challan_number": "required",
        "vehicle_number": "optional"}},
}

_ONE_OF_LABELS = {"against": "what it is against"}
# Fields every issue may carry whatever its type — never cleared, only
# required where a type lists them (e.g. General / Office → department).
COMMON_FIELDS = ("department_id", "project_or_work_order")


def public_standard() -> dict:
    """The standard for the form: per type, its fields with label / kind /
    rule / options, plus the flags."""
    out = {}
    for t, spec in ISSUE_FORMS.items():
        out[t] = {
            "leaves_factory": bool(spec.get("leaves_factory")),
            "manager_only": bool(spec.get("manager_only")),
            "remarks_label": spec.get("remarks_label"),
            # Order Project element picker (store/services/project_stock.py —
            # validated there, not by validate_issue): shown for these types.
            "order_project": t in PROJECT_ISSUE_TYPES,
            "fields": [{"key": k, "rule": rule, **FIELDS[k]} for k, rule in spec["fields"].items()],
        }
    return out


def _filled(v) -> bool:
    return v is not None and (not isinstance(v, str) or bool(v.strip()))


def _matches(cond: str, data: dict) -> bool:
    """"field" (field is filled) or "field=true|false"."""
    if "=" not in cond:
        return _filled(data.get(cond))
    field, want = cond.split("=", 1)
    return data.get(field) is (want == "true")


def validate_issue(db: Session, issue_type: str, issue_label: str, data: dict, issue_date: date) -> dict:
    """Checks `data` (the payload fields) against the standard for
    `issue_type` and returns the cleaned values to save: listed fields
    trimmed, every other type field set to None. Raises 422 naming exactly
    what is missing. Linked rows are checked to exist."""
    spec = ISSUE_FORMS.get(issue_type)
    if spec is None:
        return {k: None for k in FIELDS if k not in COMMON_FIELDS}
    missing: list[str] = []
    groups: dict[str, list[str]] = {}
    for key, rule in spec["fields"].items():
        filled = _filled(data.get(key))
        if rule == "required" and not filled:
            missing.append(FIELDS[key]["label"])
        elif rule.startswith("one_of:"):
            groups.setdefault(rule.split(":", 1)[1], []).append(key)
        elif rule.startswith("if:") and _matches(rule[3:], data) and not filled:
            missing.append(FIELDS[key]["label"])
        elif rule == "unless:sales_order" and not filled and not (
                data.get("sales_order_id") or any((i or {}).get("sales_schedule_id") for i in (data.get("items") or []))):
            missing.append(f"{FIELDS[key]['label']} (or the Sales Order / delivery row being dispatched)")
    for group, keys in groups.items():
        if not any(_filled(data.get(k)) for k in keys):
            missing.append(f"{_ONE_OF_LABELS.get(group, group)} — {' or '.join(FIELDS[k]['label'] for k in keys)}")
    if missing:
        raise HTTPException(status_code=422, detail=f"Issue type '{issue_label}' needs: {'; '.join(missing)}.")

    for key, opts_key in (("process", JOB_WORK_PROCESSES), ("purpose", SAMPLE_PURPOSES)):
        v = data.get(key)
        if key in spec["fields"] and _filled(v) and v not in opts_key:
            raise HTTPException(status_code=422, detail=f"{FIELDS[key]['label']} must be one of: {', '.join(opts_key.values())}.")
    ret = data.get("expected_return_date")
    if "expected_return_date" in spec["fields"] and ret and ret < issue_date:
        raise HTTPException(status_code=422, detail=f"Expected return date ({ret:%d-%m-%Y}) is before the issue date ({issue_date:%d-%m-%Y}).")

    _check_links(db, {k: data.get(k) for k in spec["fields"] if _filled(data.get(k))})
    cleaned = {}
    for key in FIELDS:
        if key in COMMON_FIELDS and key not in spec["fields"]:
            continue
        v = data.get(key) if key in spec["fields"] else None
        cleaned[key] = v.strip() if isinstance(v, str) else v
        if cleaned[key] == "":
            cleaned[key] = None
    return cleaned


def _check_links(db: Session, values: dict) -> None:
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.crm.models.organization import Organization
    from app.modules.erp.models.project import Project
    from app.modules.erp.models.service_request import ServiceRequest
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
    from app.modules.organization.models.department import Department
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    from app.modules.quality.models.ncr import QualityNcr
    from app.modules.store.models.item import StoreItem

    models = {
        "department_id": Department, "maintenance_work_order_id": MaintenanceWorkOrder, "asset_id": MaintenanceAsset,
        "erp_project_id": Project, "ncr_id": QualityNcr, "inspection_lot_id": QualityInspectionLot,
        "service_request_id": ServiceRequest,
        "vendor_id": Vendor, "customer_id": Organization, "output_item_id": StoreItem,
    }
    for key, model in models.items():
        if key in values and db.get(model, values[key]) is None:
            raise HTTPException(status_code=422, detail=f"{FIELDS[key]['label']} #{values[key]} wasn't found — pick it again from the list.")
