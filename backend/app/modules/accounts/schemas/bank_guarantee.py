from datetime import date, datetime
from pydantic import BaseModel, Field


class BankGuaranteeEventResponse(BaseModel):
    id: int
    event_type: str
    event_date: date
    amount: float | None = None
    old_expiry_date: date | None = None
    new_expiry_date: date | None = None
    old_claim_expiry_date: date | None = None
    new_claim_expiry_date: date | None = None
    payment_transaction_id: int | None = None
    journal_entry_id: int | None = None
    notes: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    created_by_name: str | None = None
    voucher_number: str | None = None


class BankGuaranteeCreate(BaseModel):
    direction: str = "issued"
    instrument_type: str
    instrument_form: str = "bank_guarantee"
    instrument_number: str | None = Field(default=None, max_length=80)
    bank_account_id: int | None = None
    issuing_bank_name: str | None = Field(default=None, max_length=150)
    issuing_bank_branch: str | None = Field(default=None, max_length=150)
    customer_id: int | None = None
    vendor_id: int | None = None
    sales_order_id: int | None = None
    tender_id: int | None = None
    purchase_order_id: int | None = None
    counterparty_name: str | None = Field(default=None, max_length=255)
    amount: float = Field(gt=0)
    currency: str = "INR"
    issue_date: date | None = None
    expiry_date: date | None = None
    claim_expiry_date: date | None = None
    margin_percent: float | None = None
    margin_amount: float = 0
    margin_gl_account_id: int | None = None
    commission_rate: float | None = None
    purpose: str | None = Field(default=None, max_length=300)
    remarks: str | None = None


class BankGuaranteeUpdate(BaseModel):
    instrument_type: str | None = None
    instrument_form: str | None = None
    instrument_number: str | None = Field(default=None, max_length=80)
    bank_account_id: int | None = None
    issuing_bank_name: str | None = Field(default=None, max_length=150)
    issuing_bank_branch: str | None = Field(default=None, max_length=150)
    customer_id: int | None = None
    vendor_id: int | None = None
    sales_order_id: int | None = None
    tender_id: int | None = None
    purchase_order_id: int | None = None
    counterparty_name: str | None = Field(default=None, max_length=255)
    amount: float | None = Field(default=None, gt=0)
    currency: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    claim_expiry_date: date | None = None
    margin_percent: float | None = None
    margin_amount: float | None = None
    margin_gl_account_id: int | None = None
    commission_rate: float | None = None
    purpose: str | None = Field(default=None, max_length=300)
    remarks: str | None = None


class BankGuaranteeIssuePayload(BaseModel):
    instrument_number: str = Field(min_length=1, max_length=80)
    issue_date: date
    expiry_date: date | None = None
    claim_expiry_date: date | None = None


class BankGuaranteeMoneyPayload(BaseModel):
    posting_date: date
    amount: float | None = None
    payment_mode: str = "neft"
    reference_no: str | None = Field(default=None, max_length=100)


class BankGuaranteeExtendPayload(BaseModel):
    new_expiry_date: date
    new_claim_expiry_date: date | None = None
    amendment_date: date
    reason: str = Field(min_length=1, max_length=1000)


class BankGuaranteeReleasePayload(BaseModel):
    release_date: date
    reason: str = Field(min_length=1, max_length=1000)
    payment_mode: str = "neft"
    reference_no: str | None = Field(default=None, max_length=100)


class BankGuaranteeInvokePayload(BaseModel):
    invoke_date: date
    amount: float = Field(gt=0)
    reason: str = Field(min_length=1, max_length=1000)
    gl_account_id: int | None = None
    payment_mode: str = "neft"
    reference_no: str | None = Field(default=None, max_length=100)


class BankGuaranteeCancelPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class BankGuaranteeResponse(BaseModel):
    id: int
    bg_number: str
    direction: str
    instrument_type: str
    instrument_form: str
    instrument_number: str | None = None
    status: str
    bank_account_id: int | None = None
    issuing_bank_name: str | None = None
    issuing_bank_branch: str | None = None
    customer_id: int | None = None
    vendor_id: int | None = None
    sales_order_id: int | None = None
    tender_id: int | None = None
    purchase_order_id: int | None = None
    counterparty_name: str | None = None
    amount: float
    currency: str
    issue_date: date | None = None
    expiry_date: date | None = None
    claim_expiry_date: date | None = None
    margin_percent: float | None = None
    margin_amount: float
    margin_status: str
    margin_gl_account_id: int | None = None
    commission_rate: float | None = None
    commission_total: float
    purpose: str | None = None
    remarks: str | None = None
    document_name: str | None = None
    closed_on: date | None = None
    invoked_amount: float
    closure_reason: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    instrument_type_label: str | None = None
    bank_account_label: str | None = None
    customer_name: str | None = None
    vendor_name: str | None = None
    sales_order_number: str | None = None
    tender_label: str | None = None
    purchase_order_number: str | None = None
    created_by_name: str | None = None
    days_to_expiry: int | None = None
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
    events: list[BankGuaranteeEventResponse] = []
