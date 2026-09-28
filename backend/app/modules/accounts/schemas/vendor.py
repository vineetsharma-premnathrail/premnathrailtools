from datetime import datetime
from pydantic import BaseModel


class VendorCreate(BaseModel):
    code: str
    name: str
    gstin: str | None = None
    pan: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    ifsc_code: str | None = None
    account_holder_name: str | None = None
    credit_limit: float | None = None
    payment_days: int | None = None
    early_payment_discount_pct: float | None = None
    gl_reconciliation_account_id: int | None = None
    status: str = "active"


class VendorUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    ifsc_code: str | None = None
    account_holder_name: str | None = None
    credit_limit: float | None = None
    payment_days: int | None = None
    early_payment_discount_pct: float | None = None
    gl_reconciliation_account_id: int | None = None
    status: str | None = None


class VendorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    gstin: str | None = None
    pan: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pin_code: str | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    bank_name: str | None = None
    bank_account_no: str | None = None
    ifsc_code: str | None = None
    account_holder_name: str | None = None
    credit_limit: float | None = None
    payment_days: int | None = None
    early_payment_discount_pct: float | None = None
    gl_reconciliation_account_id: int | None = None
    gl_reconciliation_account_code: str | None = None
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
