from datetime import date, datetime
from pydantic import BaseModel


class PaymentCreate(BaseModel):
    vendor_invoice_id: int
    bank_account_id: int
    amount: float
    payment_mode: str
    payment_date: date
    cheque_number: str | None = None
    cheque_date: date | None = None


class PaymentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    payment_number: str
    payment_type: str
    payment_mode: str
    payment_date: date
    amount: float
    bank_account_id: int
    bank_account_label: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    vendor_invoice_id: int | None = None
    vendor_invoice_number: str | None = None
    cheque_number: str | None = None
    cheque_date: date | None = None
    journal_entry_id: int | None = None
    created_at: datetime | None = None
