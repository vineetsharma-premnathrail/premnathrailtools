from datetime import date, datetime
from pydantic import BaseModel


class VendorInvoiceCreate(BaseModel):
    purchase_order_id: int
    invoice_number: str
    invoice_date: date
    invoice_amount: float
    invoice_gst: float = 0
    invoice_qty: float
    expense_gl_account_id: int


class VendorInvoiceResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    purchase_order_id: int
    po_number: str | None = None
    vendor_id: int
    vendor_name: str | None = None
    invoice_number: str
    invoice_date: date
    invoice_amount: float
    invoice_gst: float
    invoice_total: float
    expense_gl_account_id: int
    expense_gl_account_code: str | None = None
    qty_po: float | None = None
    qty_gr: float | None = None
    qty_invoice: float | None = None
    matching_status: str
    payment_status: str
    amount_paid: float
    amount_due: float
    journal_entry_id: int | None = None
    status: str
    variance_approved_by_id: int | None = None
    variance_approved_by_name: str | None = None
    variance_approved_at: datetime | None = None
    variance_note: str | None = None
    created_at: datetime | None = None


class MatchPreviewResponse(BaseModel):
    qty_po: float
    qty_gr: float
    qty_variance_pct: float
    amount_variance_pct: float
    matching_status: str


class ApproveVariancePayload(BaseModel):
    note: str | None = None
