from datetime import date, datetime
from pydantic import BaseModel, Field


class PaymentProposalLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    vendor_id: int
    vendor_name: str | None = None
    vendor_invoice_id: int
    invoice_number: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    amount_due: float
    credit_amount: float
    discount_amount: float
    amount: float
    excluded: bool
    exclusion_reason: str | None = None
    payment_transaction_id: int | None = None
    payment_number: str | None = None


class PaymentProposalCreate(BaseModel):
    pay_by_date: date
    bank_account_id: int
    payment_mode: str = "neft"
    vendor_ids: list[int] = Field(default_factory=list)
    run_date: date | None = None
    notes: str | None = None
    apply_credits: bool = True
    take_discounts: bool = True


class PaymentProposalLineUpdatePayload(BaseModel):
    excluded: bool | None = None
    exclusion_reason: str | None = None
    amount: float | None = None


class PaymentProposalExecutePayload(BaseModel):
    payment_date: date | None = None


class PaymentProposalCancelPayload(BaseModel):
    reason: str


class PaymentBlockPayload(BaseModel):
    payment_block: bool
    reason: str | None = None


class PaymentProposalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    proposal_number: str
    run_date: date
    pay_by_date: date
    bank_account_id: int
    payment_mode: str
    status: str
    total_amount: float
    notes: str | None = None
    created_by_id: int | None = None
    approved_by_id: int | None = None
    executed_by_id: int | None = None
    executed_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime | None = None
    lines: list[PaymentProposalLineResponse] = Field(default_factory=list)
    bank_account_label: str | None = None
    created_by_name: str | None = None
    approved_by_name: str | None = None
    executed_by_name: str | None = None
    vendor_count: int = 0
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
