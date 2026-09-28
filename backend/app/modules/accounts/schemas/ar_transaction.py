from datetime import date, datetime
from pydantic import BaseModel


class ARTransactionCreate(BaseModel):
    customer_id: int
    invoice_date: date
    invoice_amount: float
    gst_amount: float = 0
    discount_amount: float = 0
    revenue_gl_account_id: int
    reference_type: str | None = None
    reference_id: int | None = None


class ARTransactionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    invoice_number: str
    customer_id: int
    customer_name: str | None = None
    invoice_date: date
    due_date: date
    invoice_amount: float
    gst_amount: float
    discount_amount: float
    total_amount: float
    revenue_gl_account_id: int
    revenue_gl_account_code: str | None = None
    reference_type: str | None = None
    reference_id: int | None = None
    amount_received: float
    amount_due: float
    collection_status: str
    dunning_level: int
    days_outstanding: int | None = None
    journal_entry_id: int | None = None
    status: str
    created_at: datetime | None = None


class CollectionCreate(BaseModel):
    bank_account_id: int
    amount: float
    payment_mode: str
    payment_date: date
