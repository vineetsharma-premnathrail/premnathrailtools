from datetime import date, datetime
from pydantic import BaseModel


class QualityNcrApprovalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    role: str
    decision: str
    disposition_type: str
    approved_by_id: int
    remarks: str | None = None
    superseded: bool
    created_at: datetime | None = None

    approved_by_name: str | None = None


class QualityNcrCreate(BaseModel):
    source: str
    severity: str = "minor"
    item_id: int | None = None
    item_name: str | None = None
    item_code: str | None = None
    quantity: float | None = None
    uom: str | None = None
    batch_number: str | None = None
    vendor_name: str | None = None
    location_id: int | None = None
    block_stock: bool = False
    defect_code_id: int | None = None
    source_reference: str | None = None
    description: str
    root_cause: str | None = None
    ncr_date: date | None = None
    remarks: str | None = None


class QualityNcrUpdate(BaseModel):
    """Only while the NCR is open — descriptive fields, never quantity/stock."""
    severity: str | None = None
    defect_code_id: int | None = None
    description: str | None = None
    root_cause: str | None = None
    remarks: str | None = None
    vendor_name: str | None = None
    source_reference: str | None = None


class QualityNcrProposePayload(BaseModel):
    disposition_code_id: int
    remarks: str | None = None
    customer_approval_required: bool = False
    customer_approval_reference: str | None = None


class QualityNcrApprovePayload(BaseModel):
    role: str
    approve: bool = True
    remarks: str | None = None


class QualityNcrActionPayload(BaseModel):
    action_reference: str
    remarks: str | None = None


class QualityNcrVerifyPayload(BaseModel):
    remarks: str | None = None


class QualityNcrClosePayload(BaseModel):
    material_cost: float | None = None
    rework_cost: float | None = None
    other_cost: float | None = None
    root_cause: str | None = None


class QualityNcrCancelPayload(BaseModel):
    reason: str


class QualityNcrResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ncr_number: str
    source: str
    severity: str
    status: str
    auto_raised: bool = False
    inspection_id: int | None = None
    lot_id: int | None = None
    source_reference: str | None = None
    item_id: int | None = None
    item_name: str
    item_code: str | None = None
    quantity: float | None = None
    uom: str | None = None
    batch_number: str | None = None
    vendor_name: str | None = None
    location_id: int | None = None
    stock_blocked: bool = False
    defect_code_id: int | None = None
    description: str
    root_cause: str | None = None
    raised_by_id: int | None = None
    ncr_date: date
    disposition_code_id: int | None = None
    disposition_type: str | None = None
    disposition_status: str = "none"
    disposition_remarks: str | None = None
    customer_approval_required: bool = False
    customer_approval_reference: str | None = None
    disposition_proposed_by_id: int | None = None
    disposition_proposed_at: datetime | None = None
    disposition_decided_at: datetime | None = None
    estimated_value: float | None = None
    action_reference: str | None = None
    action_remarks: str | None = None
    action_done_by_id: int | None = None
    action_done_at: datetime | None = None
    reinspection_lot_id: int | None = None
    verified_by_id: int | None = None
    verified_at: datetime | None = None
    verification_remarks: str | None = None
    material_cost: float | None = None
    rework_cost: float | None = None
    other_cost: float | None = None
    closed_by_id: int | None = None
    closed_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    approvals: list[QualityNcrApprovalResponse] = []

    # Denormalized display fields, filled in by the route.
    raised_by_name: str | None = None
    inspection_number: str | None = None
    lot_number: str | None = None
    reinspection_lot_number: str | None = None
    location_name: str | None = None
    defect_code_label: str | None = None
    disposition_label: str | None = None
    required_roles: list[str] = []
    pending_roles: list[str] = []
    cost_of_non_quality: float = 0
    capa_ids: list[int] = []
    scrap_value_limit: float | None = None
