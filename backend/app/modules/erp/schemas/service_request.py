from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator
from app.core.validators import validate_email_format
from app.modules.erp.models.service_request import SR_PRIORITIES, SR_SERVICE_TYPES


def _validate_sr_priority(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if v not in SR_PRIORITIES:
        raise ValueError(f"Invalid priority '{v}' — choose Standard or Urgent.")
    return v


# Allowed SR workflow statuses — fixed in code (no admin customization). Must
# match SRStatus in frontend/src/types/index.ts and the status dropdown in
# ServiceRequestForm.tsx.
SR_STATUSES = (
    "open", "acknowledged", "assigned", "scheduled", "in_progress", "pending_parts",
    "on_hold", "work_completed", "review", "closed", "cancelled",
)


def _validate_sr_status(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if v not in SR_STATUSES:
        raise ValueError(f"Invalid status '{v}' — choose one of: {', '.join(SR_STATUSES)}.")
    return v


# A new SR starts at one of the opening steps. Work Completed / Review /
# Closed / Cancelled are reached only through the status steps, so closure
# approval and the cancel reason can't be skipped by creating the SR there.
SR_CREATE_STATUSES = ("open", "acknowledged", "assigned", "scheduled", "in_progress", "pending_parts", "on_hold")


def _validate_sr_create_status(v: str) -> str:
    v = _validate_sr_status(v) or "open"
    if v == "closed":
        raise ValueError(
            "A service request cannot be created as Closed — create it as Open, fill Corrective Action "
            "on the Diagnostics & RCA tab, then close it."
        )
    if v not in SR_CREATE_STATUSES:
        raise ValueError(
            f"A service request cannot be created as '{v.replace('_', ' ')}' — create it as Open (or Assigned / "
            "In Progress) and move it forward with the status steps on its page."
        )
    return v


def _validate_sr_service_type(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if v not in SR_SERVICE_TYPES:
        raise ValueError(f"Invalid service type '{v}' — choose one of: {', '.join(SR_SERVICE_TYPES)}.")
    return v


# Material issue statuses — fixed in code; must match the Materials tab
# dropdown in frontend/src/app/dashboard/erp/service-requests/[id]/page.tsx.
MATERIAL_STATUSES = ("pending", "issued", "returned")

# SR billing state — fixed in code; must match PAYMENT_STATUS_OPTIONS on the
# SR detail page's Execution & Billing card.
SR_PAYMENT_STATUSES = ("not_billable", "pending", "invoiced", "paid")

_COST_LABELS = {
    "service_cost": "Service cost",
    "transport_cost": "Transport cost",
    "accommodation_cost": "Accommodation cost",
    "miscellaneous_cost": "Miscellaneous cost",
}


def _validate_material_name(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip()
    if not v:
        raise ValueError("Material name can't be blank — enter the part or material description.")
    return v


def _validate_material_quantity(v: float | None) -> float | None:
    if v is None:
        return v
    if v <= 0:
        raise ValueError(f"Quantity must be more than 0 (got {v:g}).")
    return v


def _validate_material_budget(v: float | None) -> float | None:
    if v is None:
        return v
    if v < 0:
        raise ValueError(f"Estimated budget can't be negative (got {v:g}) — enter 0 or more.")
    return v


def _validate_material_status(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.strip().lower()
    if v not in MATERIAL_STATUSES:
        raise ValueError(f"Invalid material status '{v}' — choose one of: {', '.join(MATERIAL_STATUSES)}.")
    return v


class ServiceMaterialAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_material_id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_path: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class ServiceMaterialCreate(BaseModel):
    # Pick the spare from the Item Master (store_item_id) — name, part code
    # and unit then come from the item. Free text stays only for legacy use.
    store_item_id: int | None = None
    material_name: str | None = None
    part_number: str | None = None
    model_number: str | None = None
    description: str | None = None
    estimated_budget: float | None = None
    reason: str | None = None
    quantity: float = 1
    unit: str = "pcs"
    status: str | None = "pending"
    unit_price: float | None = None
    # None = from the SR: free job → covered, chargeable job → billed.
    is_warranty_covered: bool | None = None

    _validate_name = field_validator("material_name")(_validate_material_name)
    _validate_quantity = field_validator("quantity")(_validate_material_quantity)
    _validate_budget = field_validator("estimated_budget")(_validate_material_budget)
    _validate_status = field_validator("status")(_validate_material_status)


class ServiceMaterialUpdate(BaseModel):
    material_name: str | None = None
    part_number: str | None = None
    model_number: str | None = None
    description: str | None = None
    estimated_budget: float | None = None
    reason: str | None = None
    quantity: float | None = None
    unit: str | None = None
    status: str | None = None
    unit_price: float | None = None
    is_warranty_covered: bool | None = None

    _validate_name = field_validator("material_name")(_validate_material_name)
    _validate_quantity = field_validator("quantity")(_validate_material_quantity)
    _validate_budget = field_validator("estimated_budget")(_validate_material_budget)
    _validate_status = field_validator("status")(_validate_material_status)


class ServiceMaterialResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_request_id: int
    material_name: str
    part_number: str | None = None
    model_number: str | None = None
    description: str | None = None
    estimated_budget: float | None = None
    reason: str | None = None
    quantity: float
    unit: str
    status: str | None = None
    created_at: datetime | None = None

    pr_id: int | None = None
    pr_number: str | None = None
    pr_status: str | None = None
    received_quantity: float = 0
    receiving_status: str = "pending"
    store_item_id: int | None = None
    location_id: int | None = None
    qty_issued: float | None = 0
    qty_returned: float | None = 0
    net_issued: float = 0
    unit_cost: float | None = None
    unit_price: float | None = None
    is_warranty_covered: bool | None = False
    attachments: list[ServiceMaterialAttachmentResponse] = Field(default_factory=list)


class MaterialReceivePayload(BaseModel):
    received_quantity: float


class ServiceMaterialIssuePayload(BaseModel):
    """Issue an SR spare from Store (Material Issue type Service)."""
    location_id: int
    quantity: float
    challan_number: str
    vehicle_number: str | None = None
    site_address: str | None = None
    issue_date: date | None = None
    remarks: str | None = None


class ServiceMaterialReturnPayload(BaseModel):
    """Unused spare coming back to the store it was issued from."""
    quantity: float
    remarks: str | None = None


class ServiceInvoiceCreatePayload(BaseModel):
    """Draft the AR invoice of a chargeable SR (Finance approves / posts it)."""
    invoice_date: date | None = None
    customer_po_number: str | None = None
    narration: str | None = None


class ServiceRequestAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    service_request_id: int
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_path: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class ServiceRequestCreate(BaseModel):
    project_id: int
    issue_title: str
    issue_description: str | None = None
    issue_category: str | None = None
    priority: str = "standard"
    service_type: str = Field(..., description="Select a Service Type (e.g. Warranty, AMC, Paid Service).")
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    expected_completion_date: date | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None
    service_report_notes: str | None = None
    status: str = "open"
    # None = the default from the warranty check; a different choice needs
    # chargeable_reason (erp/warranty.py).
    is_chargeable: bool | None = None
    chargeable_reason: str | None = None

    _validate_email = field_validator("reported_by_email")(validate_email_format)
    _validate_status = field_validator("status")(_validate_sr_create_status)
    _validate_priority = field_validator("priority")(_validate_sr_priority)
    _validate_service_type = field_validator("service_type")(_validate_sr_service_type)


class ServiceRequestUpdate(BaseModel):
    issue_title: str | None = None
    issue_description: str | None = None
    issue_category: str | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    status: str | None = None
    priority: str | None = None
    service_type: str | None = None
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    expected_completion_date: date | None = None
    root_cause: str | None = None
    resolution_description: str | None = None
    preventive_actions: str | None = None
    service_report_notes: str | None = None
    actual_date_attended: date | None = None
    actual_completion_date: date | None = None
    service_cost: float | None = None
    transport_cost: float | None = None
    accommodation_cost: float | None = None
    miscellaneous_cost: float | None = None
    tax_percentage: float | None = None
    payment_status: str | None = None
    invoice_number: str | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None
    is_chargeable: bool | None = None
    chargeable_reason: str | None = None
    # Not a column: the reason for cancelling, or for reopening a closed /
    # cancelled SR. Required for those transitions and kept in the audit trail.
    status_reason: str | None = None

    _validate_email = field_validator("reported_by_email")(validate_email_format)
    _validate_status = field_validator("status")(_validate_sr_status)
    _validate_priority = field_validator("priority")(_validate_sr_priority)
    _validate_service_type = field_validator("service_type")(_validate_sr_service_type)

    @field_validator("service_cost", "transport_cost", "accommodation_cost", "miscellaneous_cost")
    @classmethod
    def _cost_not_negative(cls, v: float | None, info) -> float | None:
        if v is None:
            return 0.0  # a cleared cost box means "no cost" (column is NOT NULL)
        if v < 0:
            raise ValueError(f"{_COST_LABELS[info.field_name]} can't be negative (got {v:g}) — enter 0 or more.")
        return v

    @field_validator("tax_percentage")
    @classmethod
    def _tax_in_range(cls, v: float | None) -> float | None:
        if v is None:
            raise ValueError("Tax % can't be blank — enter 0 if the job is not taxed.")
        if not (0 <= v <= 100):
            raise ValueError(f"Tax % must be between 0 and 100 (got {v:g}).")
        return v

    @field_validator("payment_status")
    @classmethod
    def _payment_status_known(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().lower()
        if not v:
            return None
        if v not in SR_PAYMENT_STATUSES:
            raise ValueError(f"Invalid payment status '{v}' — choose one of: {', '.join(SR_PAYMENT_STATUSES)}.")
        return v

    @field_validator("invoice_number")
    @classmethod
    def _invoice_trim(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return v.strip() or None


class ServiceRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_number: str
    legacy_sr_number: str | None = None
    project_id: int
    issue_title: str
    issue_description: str | None = None
    issue_category: str | None = None
    sub_category: str | None = None
    failure_mode: str | None = None
    status: str
    priority: str
    service_type: str | None = None
    assigned_service_person_id: int | None = None
    assigned_to_name: str | None = None
    expected_date_to_attend: date | None = None
    expected_completion_date: date | None = None
    actual_date_attended: date | None = None
    actual_completion_date: date | None = None
    service_report_notes: str | None = None
    root_cause: str | None = None
    resolution_description: str | None = None
    preventive_actions: str | None = None

    # Money is None for a user without erp:service_requests.charges:view (erp/sensitive.py).
    service_cost: float | None = 0
    transport_cost: float | None = 0
    accommodation_cost: float | None = 0
    miscellaneous_cost: float | None = 0
    total_material_cost: float | None = 0
    tax_percentage: float = 18.0
    tax_amount: float | None = 0
    total_bill: float | None = 0
    payment_status: str | None = None
    invoice_number: str | None = None
    warranty_status: str | None = None
    is_chargeable: bool | None = None
    chargeable_reason: str | None = None
    ar_transaction_id: int | None = None
    billing_status: str | None = None
    material_cost_actual: float | None = 0
    service_contract_id: int | None = None  # AMC / CMC covering the machine (erp/contracts.py)

    is_locked: bool = False
    is_deleted: bool = False
    created_by_id: int | None = None
    created_at: datetime | None = None
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    updated_at: datetime | None = None
    reported_by_name: str | None = None
    reported_by_phone: str | None = None
    reported_by_email: str | None = None

    sla_response_hours: int | None = None
    sla_resolution_hours: int | None = None
    sla_response_met: bool | None = None
    sla_resolution_met: bool | None = None
    first_response_at: datetime | None = None
    resolution_at: datetime | None = None
    sla_profile: str | None = None
    sla_response_due_at: datetime | None = None
    sla_resolution_due_at: datetime | None = None
    sla_response_state: str | None = None
    sla_resolution_state: str | None = None

    attachments: list[ServiceRequestAttachmentResponse] = Field(default_factory=list)
    materials: list[ServiceMaterialResponse] = Field(default_factory=list)
