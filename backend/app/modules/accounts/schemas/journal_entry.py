from datetime import date, datetime
from pydantic import BaseModel, Field


class JournalEntryLinePayload(BaseModel):
    gl_account_id: int
    debit_amount: float = 0
    credit_amount: float = 0
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    # Required on a line hitting a party control account (Sundry Debtors /
    # Creditors), so the party ledger stays in step with the control account.
    vendor_id: int | None = None
    customer_id: int | None = None
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
    # adjustment | accrual | correction | depreciation
    posting_type: str = "adjustment"
    # Accruals: the date a reversal is auto-posted (usually the 1st of next month).
    auto_reverse_on: date | None = None
    lines: list[JournalEntryLinePayload] = Field(default_factory=list)


class JournalEntryReversePayload(BaseModel):
    reason: str
    reversal_date: date | None = None


class JournalEntryLineTextChange(BaseModel):
    line_id: int
    remarks: str | None = None


class JournalEntryDetailsPayload(BaseModel):
    """FB02-style change of a posted voucher: only text that moves no amount,
    ledger, party, cost centre or date. Omitted fields are left as they are."""
    description: str | None = None
    lines: list[JournalEntryLineTextChange] | None = None


class JournalEntryHistoryRow(BaseModel):
    id: int
    action: str
    summary: str | None = None
    field_name: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    performed_by_name: str | None = None
    performed_at: datetime


class OpeningLedgerLine(BaseModel):
    gl_account_id: int
    debit_amount: float = 0
    credit_amount: float = 0


class OpeningVendorBill(BaseModel):
    vendor_id: int
    bill_number: str
    bill_date: date | None = None
    due_date: date | None = None
    amount: float


class OpeningCustomerBill(BaseModel):
    customer_id: int
    invoice_number: str
    invoice_date: date | None = None
    due_date: date | None = None
    amount: float


class OpeningBalancesCreate(BaseModel):
    as_of: date
    narration: str | None = None
    ledger_lines: list[OpeningLedgerLine] = Field(default_factory=list)
    vendor_bills: list[OpeningVendorBill] = Field(default_factory=list)
    customer_bills: list[OpeningCustomerBill] = Field(default_factory=list)


class JournalEntryResponse(BaseModel):
    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    id: int
    entry_number: str
    voucher_type: str = "journal"
    financial_year: str | None = None
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
    # Central approval engine: latest request of this record (None = never submitted).
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
    posted_by_id: int | None = None
    posted_by_name: str | None = None
    reversal_date: date | None = None
    reversal_reason: str | None = None
    reversed_by_id: int | None = None
    reverses_journal_entry_id: int | None = None
    reverses_entry_number: str | None = None
    # On a reversed original: the entry that reversed it, and who did it.
    reversal_journal_entry_id: int | None = None
    reversal_entry_number: str | None = None
    reversed_by_name: str | None = None
    auto_reverse_on: date | None = None
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
