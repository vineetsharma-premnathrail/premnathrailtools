from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.accounts.schemas.tax_line import TaxLinePayload, TaxLineResponse


class VendorInvoiceCreate(BaseModel):
    # PO invoice: purchase_order_id (vendor comes from the PO).
    # Direct invoice: vendor_id, no PO.
    purchase_order_id: int | None = None
    vendor_id: int | None = None
    invoice_number: str
    invoice_date: date
    due_date: date | None = None
    place_of_supply_state_code: str | None = None
    is_reverse_charge: bool = False
    round_off: float = 0
    narration: str | None = None
    lines: list[TaxLinePayload] = Field(default_factory=list)
    # Legacy single-amount payload (kept for old clients):
    invoice_amount: float | None = None
    invoice_gst: float | None = None
    invoice_qty: float | None = None
    expense_gl_account_id: int | None = None
    # Foreign currency: line rates in `currency`; blank rate = the rate master's rate on the document date.
    currency: str | None = None
    exchange_rate: float | None = None


class VendorInvoiceCancelPayload(BaseModel):
    reason: str


class ApproveVariancePayload(BaseModel):
    note: str | None = None


class VendorInvoiceResponse(BaseModel):
    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    id: int
    invoice_type: str = "po"
    purchase_order_id: int | None = None
    po_number: str | None = None
    vendor_id: int
    vendor_name: str | None = None
    invoice_number: str
    invoice_date: date
    due_date: date | None = None
    vendor_gstin: str | None = None
    place_of_supply_state_code: str | None = None
    is_interstate: bool = False
    is_reverse_charge: bool = False
    cgst_amount: float = 0
    sgst_amount: float = 0
    igst_amount: float = 0
    invoice_amount: float
    invoice_gst: float
    round_off: float = 0
    invoice_total: float
    expense_gl_account_id: int | None = None
    expense_gl_account_code: str | None = None
    narration: str | None = None
    qty_po: float | None = None
    qty_gr: float | None = None
    qty_invoice: float | None = None
    matching_status: str
    payment_status: str
    amount_paid: float
    amount_due: float
    currency: str = "INR"
    exchange_rate: float = 1
    amount_fc: float | None = None
    amount_due_fc: float | None = None
    journal_entry_id: int | None = None
    journal_entry_number: str | None = None
    status: str
    cancelled_reason: str | None = None
    variance_approved_by_id: int | None = None
    variance_approved_by_name: str | None = None
    variance_approved_at: datetime | None = None
    variance_note: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    lines: list[TaxLineResponse] = Field(default_factory=list)

    # Denormalized display fields, filled in by the route. posted_by_id is
    # the user who created the invoice's journal entry — the maker-checker
    # UI uses it and created_by_id to hide actions the viewer can't take.
    created_by_name: str | None = None
    # Central approval engine: latest request of this record (None = never submitted).
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
    posted_by_id: int | None = None
    posted_by_name: str | None = None


class MatchPreviewResponse(BaseModel):
    qty_po: float
    qty_gr: float
    qty_variance_pct: float
    amount_variance_pct: float
    matching_status: str
    po_value: float | None = None
    received_value: float | None = None
    already_invoiced_qty: float = 0
    already_invoiced_amount: float = 0
    variance_reasons: list[str] = []
    # Line-level match (POST /match-preview with lines): one row per PO line.
    lines: list[dict] = []
    tolerances: dict | None = None


class MatchPreviewLinesPayload(BaseModel):
    purchase_order_id: int
    lines: list[dict] = []
