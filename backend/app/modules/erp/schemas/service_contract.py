from datetime import date, datetime

from pydantic import BaseModel


class ServiceContractBillingResponse(BaseModel):
    id: int
    sequence: int
    period_start: date
    period_end: date
    due_date: date
    amount: float
    status: str
    ar_transaction_id: int | None = None
    invoice_number: str | None = None
    invoice_status: str | None = None
    invoice_total: float | None = None
    collection_status: str | None = None


class ServiceContractMachineResponse(BaseModel):
    project_id: int
    serial_number: str | None = None
    model_name: str | None = None
    site_name: str | None = None
    product_name: str | None = None


class ServiceContractCreate(BaseModel):
    contract_type: str = "amc"
    title: str | None = None
    customer_id: int
    start_date: date
    end_date: date
    contract_value: float = 0
    gst_rate: float = 18
    sac_code: str | None = None
    billing_frequency: str = "quarterly"
    bill_in_advance: bool = True
    visits_included: int = 0
    labour_covered: bool = True
    spares_covered: bool = False
    sla_response_hours: int | None = None
    sla_resolution_hours: int | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    terms: str | None = None
    machine_ids: list[int] = []


class ServiceContractUpdate(BaseModel):
    contract_type: str | None = None
    title: str | None = None
    customer_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    contract_value: float | None = None
    gst_rate: float | None = None
    sac_code: str | None = None
    billing_frequency: str | None = None
    bill_in_advance: bool | None = None
    visits_included: int | None = None
    labour_covered: bool | None = None
    spares_covered: bool | None = None
    sla_response_hours: int | None = None
    sla_resolution_hours: int | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    terms: str | None = None
    machine_ids: list[int] | None = None


class ServiceContractReasonPayload(BaseModel):
    reason: str


class ServiceContractInvoicePayload(BaseModel):
    invoice_date: date | None = None


class ServiceContractResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    contract_number: str
    contract_type: str
    title: str | None = None
    customer_id: int
    status: str
    start_date: date
    end_date: date
    contract_value: float
    gst_rate: float
    sac_code: str | None = None
    billing_frequency: str
    bill_in_advance: bool
    visits_included: int
    labour_covered: bool
    spares_covered: bool
    sla_response_hours: int | None = None
    sla_resolution_hours: int | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    terms: str | None = None
    renewed_from_id: int | None = None
    submitted_at: datetime | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    approval_remarks: str | None = None
    cancel_reason: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    customer_name: str | None = None
    machines: list[ServiceContractMachineResponse] = []
    billing_lines: list[ServiceContractBillingResponse] = []
    visits_used: int = 0
    billed_amount: float = 0
    renewed_by_id: int | None = None
    renewed_from_number: str | None = None
    days_to_expiry: int | None = None
