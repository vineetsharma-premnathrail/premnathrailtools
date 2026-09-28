from datetime import date, datetime
from pydantic import BaseModel, Field


class JournalEntryLinePayload(BaseModel):
    gl_account_id: int
    debit_amount: float = 0
    credit_amount: float = 0
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    due_date: date | None = None
    remarks: str | None = None


class JournalEntryLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    line_number: int
    gl_account_id: int
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    cost_center_id: int | None = None
    cost_center_name: str | None = None
    internal_order_id: int | None = None
    internal_order_name: str | None = None
    vendor_id: int | None = None
    customer_id: int | None = None
    debit_amount: float
    credit_amount: float
    due_date: date | None = None
    remarks: str | None = None


class JournalEntryCreate(BaseModel):
    posting_date: date
    description: str | None = None
    lines: list[JournalEntryLinePayload] = Field(default_factory=list)


class JournalEntryReversePayload(BaseModel):
    reason: str


class JournalEntryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    entry_number: str
    posting_date: date
    accounting_period: str
    posting_type: str
    reference_document_type: str | None = None
    reference_document_id: int | None = None
    description: str | None = None
    total_debit: float
    total_credit: float
    status: str
    created_by_id: int | None = None
    created_by_name: str | None = None
    posted_by_id: int | None = None
    posted_by_name: str | None = None
    reversal_date: date | None = None
    reversal_reason: str | None = None
    reversed_by_id: int | None = None
    reverses_journal_entry_id: int | None = None
    created_at: datetime | None = None
    lines: list[JournalEntryLineResponse] = Field(default_factory=list)


class GLAccountBalanceResponse(BaseModel):
    model_config = {"from_attributes": True}

    gl_account_id: int
    accounting_period: str
    opening_balance: float
    total_debits: float
    total_credits: float
    closing_balance: float
    is_locked: bool
