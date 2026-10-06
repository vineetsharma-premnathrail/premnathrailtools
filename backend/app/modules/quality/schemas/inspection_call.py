from datetime import date, datetime
from pydantic import BaseModel


class QualityInspectionCallCreate(BaseModel):
    erp_project_id: int | None = None
    order_reference: str | None = None
    customer_name: str | None = None
    item_id: int
    quantity: float
    batch_number: str | None = None
    lot_id: int | None = None
    agency: str | None = None
    requested_date: date | None = None
    call_date: date | None = None
    inspector_name: str | None = None
    remarks: str | None = None


class QualityInspectionCallSchedulePayload(BaseModel):
    call_date: date
    inspector_name: str | None = None
    remarks: str | None = None


class QualityInspectionCallResultPayload(BaseModel):
    result: str                                   # accepted | partially_accepted | rejected
    accepted_qty: float | None = None
    rejected_qty: float | None = None
    certificate_number: str | None = None
    result_date: date | None = None
    inspector_name: str | None = None
    remarks: str | None = None
    # Rejected quantity: block it in this store's Free stock under the NCR.
    location_id: int | None = None
    severity: str = "major"


class QualityInspectionCallCancelPayload(BaseModel):
    reason: str


class QualityContractRequirementPayload(BaseModel):
    third_party_inspection_required: bool
    inspection_agency: str | None = None


class QualityDispatchCheckPayload(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = None
    erp_project_id: int | None = None


class QualityInspectionCallResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    call_number: str
    status: str
    erp_project_id: int | None = None
    order_reference: str | None = None
    customer_name: str | None = None
    item_id: int
    item_code: str | None = None
    item_name: str
    uom: str | None = None
    quantity: float
    batch_number: str | None = None
    lot_id: int | None = None
    agency: str
    requested_date: date
    call_date: date | None = None
    inspector_name: str | None = None
    result_date: date | None = None
    accepted_qty: float | None = None
    rejected_qty: float | None = None
    certificate_number: str | None = None
    certificate_file_name: str | None = None
    result_remarks: str | None = None
    ncr_id: int | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    result_recorded_by_id: int | None = None
    result_recorded_at: datetime | None = None
    created_at: datetime | None = None

    project_label: str | None = None
    agency_label: str | None = None
    lot_number: str | None = None
    ncr_number: str | None = None
    created_by_name: str | None = None
    result_recorded_by_name: str | None = None
    days_to_call: int | None = None
