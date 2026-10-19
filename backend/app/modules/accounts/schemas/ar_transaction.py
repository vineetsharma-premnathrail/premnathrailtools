from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.accounts.schemas.tax_line import TaxLinePayload, TaxLineResponse


class ARTransactionCreate(BaseModel):
    customer_id: int
    invoice_date: date
    place_of_supply_state_code: str | None = None
    round_off: float = 0
    billing_address: str | None = None
    shipping_address: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    narration: str | None = None
    irn: str | None = None
    ack_no: str | None = None
    ack_date: date | None = None
    eway_bill_no: str | None = None
    eway_bill_date: date | None = None
    vehicle_no: str | None = None
    reference_type: str | None = None
    reference_id: int | None = None
    lines: list[TaxLinePayload] = Field(default_factory=list)
    # Legacy single-amount payload:
    invoice_amount: float | None = None
    gst_amount: float = 0
    discount_amount: float = 0
    revenue_gl_account_id: int | None = None
    # Foreign currency: line rates in `currency`; blank rate = the rate master's rate on the document date.
    currency: str | None = None
    exchange_rate: float | None = None


class ARTransactionEInvoicePayload(BaseModel):
    """E-invoice / e-way bill details captured after generating them on the portal."""
    irn: str | None = None
    ack_no: str | None = None
    ack_date: date | None = None
    eway_bill_no: str | None = None
    eway_bill_date: date | None = None
    vehicle_no: str | None = None


class ARTransactionCancelPayload(BaseModel):
    reason: str


class CollectionCreate(BaseModel):
    bank_account_id: int
    amount: float
    payment_mode: str
    payment_date: date


class ARTransactionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    invoice_number: str
    customer_id: int
    customer_name: str | None = None
    invoice_date: date
    due_date: date
    customer_gstin: str | None = None
    place_of_supply_state_code: str | None = None
    is_interstate: bool = False
    cgst_amount: float = 0
    sgst_amount: float = 0
    igst_amount: float = 0
    invoice_amount: float
    gst_amount: float
    discount_amount: float
    round_off: float = 0
    total_amount: float
    revenue_gl_account_id: int | None = None
    revenue_gl_account_code: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    narration: str | None = None
    irn: str | None = None
    ack_no: str | None = None
    ack_date: date | None = None
    eway_bill_no: str | None = None
    eway_bill_date: date | None = None
    vehicle_no: str | None = None
    reference_type: str | None = None
    reference_id: int | None = None
    amount_received: float
    amount_due: float
    currency: str = "INR"
    exchange_rate: float = 1
    amount_fc: float | None = None
    amount_due_fc: float | None = None
    collection_status: str
    dunning_level: int
    days_outstanding: int | None = None
    days_overdue: int | None = None
    journal_entry_id: int | None = None
    status: str
    cancelled_reason: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    # Central approval engine: latest request of this record (None = never submitted).
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
    created_at: datetime | None = None
    lines: list[TaxLineResponse] = Field(default_factory=list)
