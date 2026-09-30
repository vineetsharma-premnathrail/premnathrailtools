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
    created_by_id: int | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route. posted_by_id is
    # the user who created the invoice's journal entry — the maker-checker
    # UI uses it and created_by_id to hide actions the viewer can't take.
    created_by_name: str | None = None
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


class ApproveVariancePayload(BaseModel):
    note: str | None = None
