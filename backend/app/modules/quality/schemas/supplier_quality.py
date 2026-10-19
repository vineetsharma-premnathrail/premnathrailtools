from datetime import date, datetime
from pydantic import BaseModel


class QualityVendorStatusEventResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    event: str
    from_status: str | None = None
    to_status: str | None = None
    reason: str | None = None
    user_id: int | None = None
    created_at: datetime | None = None
    user_name: str | None = None


class QualityApprovedVendorCreate(BaseModel):
    item_id: int
    vendor_name: str
    vendor_id: int | None = None
    remarks: str | None = None


class QualityApprovedVendorReasonPayload(BaseModel):
    reason: str | None = None


class QualityApprovedVendorDecisionPayload(BaseModel):
    approve: bool
    remarks: str | None = None


class QualityApprovedVendorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    vendor_name: str
    vendor_id: int | None = None
    status: str
    valid_until: date | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    fai_id: int | None = None
    sampling_state: str
    recent_lots: list[bool] | None = None
    consecutive_accepted: int = 0
    skip_lot_active: bool = False
    lots_since_inspected: int = 0
    pending_action: str | None = None
    pending_reason: str | None = None
    pending_requested_at: datetime | None = None
    # A block / unblock raised before the central approval engine — decided
    # with the old Partner buttons (detail responses only).
    legacy_pending: bool = False
    last_score: float | None = None
    last_rated_period: str | None = None
    status_reason: str | None = None
    status_changed_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    item_code: str | None = None
    item_name: str | None = None
    approved_by_name: str | None = None
    fai_number: str | None = None
    expired: bool = False
    pending_requested_by_name: str | None = None
    events: list[QualityVendorStatusEventResponse] = []


class QualityRatingRunPayload(BaseModel):
    period: str


class QualitySupplierScorecardResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    vendor_id: int | None = None
    vendor_name: str
    vendor_key: str | None = None
    period: str
    period_start: date | None = None
    lots_count: int = 0
    received_qty: float = 0
    accepted_qty: float = 0
    rejected_lots: int = 0
    quality_score: float | None = None
    ncr_minor: int = 0
    ncr_major: int = 0
    ncr_critical: int = 0
    ncr_score: float | None = None
    deliveries: int = 0
    on_time_deliveries: int = 0
    on_time_delivery_score: float | None = None
    overall_score: float | None = None
    weights: dict | None = None
    rating_band: str | None = None
    rejection_count: int = 0
    ncr_count: int = 0
    status: str
    notes: str | None = None
    computed_at: datetime | None = None
    created_at: datetime | None = None


class QualityVendorAuditCreate(BaseModel):
    vendor_name: str
    planned_date: date
    scope: str | None = None
    auditor_id: int | None = None


class QualityVendorAuditFinding(BaseModel):
    type: str
    description: str


class QualityVendorAuditCompletePayload(BaseModel):
    audit_date: date
    score: float | None = None
    result: str
    findings: list[QualityVendorAuditFinding] = []
    remarks: str | None = None


class QualityVendorAuditResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    audit_number: str
    vendor_name: str
    scope: str | None = None
    planned_date: date
    auditor_id: int | None = None
    status: str
    audit_date: date | None = None
    score: float | None = None
    result: str | None = None
    findings: list[dict] | None = None
    capa_id: int | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    auditor_name: str | None = None
    capa_number: str | None = None
