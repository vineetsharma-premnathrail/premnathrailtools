from datetime import date, datetime
from pydantic import BaseModel


class QualityLotResultPayload(BaseModel):
    result_id: int
    measured_values: list[float] | None = None
    defects_found: int | None = None
    defect_code_id: int | None = None
    gauge_id: int | None = None
    gauge_reference: str | None = None
    remarks: str | None = None


class QualityLotResultResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    plan_line_id: int | None = None
    characteristic_id: int
    sequence: int
    characteristic_name: str
    char_type: str
    classification: str
    unit: str | None = None
    method: str | None = None
    nominal: float | None = None
    min_value: float | None = None
    max_value: float | None = None
    aql: float | None = None
    sample_size: int
    accept_number: int
    reject_number: int
    measured_values: list[float] | None = None
    defects_found: int | None = None
    result: str | None = None
    defect_code_id: int | None = None
    gauge_id: int | None = None
    gauge_reference: str | None = None
    remarks: str | None = None
    recorded_by_id: int | None = None
    recorded_at: datetime | None = None

    defect_code_label: str | None = None
    recorded_by_name: str | None = None


class QualityInspectionLotCreate(BaseModel):
    """Manual lot (stock re-inspection, sales return, or a check with no
    stock behind it). From store stock: give location_id + take_from_free
    to move the quantity FREE → QUALITY for the inspection."""
    inspection_type: str
    item_id: int
    quantity: float
    location_id: int | None = None
    take_from_free: bool = False
    batch_number: str | None = None
    vendor_name: str | None = None
    source_reference: str | None = None
    assigned_to_id: int | None = None
    remarks: str | None = None


class QualityLotRecordResultsPayload(BaseModel):
    entries: list[QualityLotResultPayload]


class QualityLotAssignPayload(BaseModel):
    user_id: int


class QualityLotSeverityPayload(BaseModel):
    sampling_severity: str


class QualityLotCertificatePayload(BaseModel):
    received: bool
    reference: str | None = None


class QualityLotDecisionPayload(BaseModel):
    decision: str
    accepted_qty: float | None = None
    rejected_qty: float | None = None
    deviation_reference: str | None = None
    remarks: str | None = None


class QualityLotCancelPayload(BaseModel):
    reason: str


class QualityInspectionLotResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    lot_number: str
    inspection_type: str
    status: str
    source_type: str
    source_id: int | None = None
    source_reference: str | None = None
    grn_item_id: int | None = None
    ncr_id: int | None = None
    item_id: int
    item_code: str | None = None
    item_name: str
    uom: str | None = None
    quantity: float
    batch_number: str | None = None
    vendor_name: str | None = None
    location_id: int | None = None
    stock_in_quality: bool
    plan_id: int | None = None
    plan_revision: int | None = None
    sampling_severity: str
    sample_size: int | None = None
    test_certificate_required: bool
    test_certificate_received: bool
    test_certificate_reference: str | None = None
    assigned_to_id: int | None = None
    created_by_id: int | None = None
    started_at: datetime | None = None
    results_recorded_by_id: int | None = None
    results_recorded_at: datetime | None = None
    decision: str | None = None
    accepted_qty: float | None = None
    rejected_qty: float | None = None
    deviation_reference: str | None = None
    decision_remarks: str | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    closed_at: datetime | None = None
    lot_date: date
    remarks: str | None = None
    created_at: datetime | None = None
    results: list[QualityLotResultResponse] = []

    # Denormalized display fields, filled in by the route.
    location_name: str | None = None
    plan_number: str | None = None
    assigned_to_name: str | None = None
    results_recorded_by_name: str | None = None
    decided_by_name: str | None = None
    age_days: int = 0
    failed_count: int = 0
    critical_failed: bool = False
    ncrs: list[dict] = []
    # Phase 2: photos taken during inspection, the FAI this lot is the first
    # article of, and the production gate it decides.
    photos: list[dict] = []
    first_article: dict | None = None
    gate: dict | None = None
