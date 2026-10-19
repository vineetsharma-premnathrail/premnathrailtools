from datetime import date, datetime
from pydantic import BaseModel, Field


class PaymentLinePayload(BaseModel):
    gl_account_id: int
    amount: float
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    remarks: str | None = None


class AllocationPayload(BaseModel):
    target_type: str  # vendor_invoice | ar_transaction
    target_id: int
    amount: float


class DeductionPayload(BaseModel):
    """Part of one bill settled without cash (LD, penalty, bank charges...)."""
    target_type: str | None = None  # defaults to the party's invoice type
    target_id: int
    reason: str  # ld_deduction | penalty | bank_charges | short_payment | rounding | cash_discount | other
    amount: float
    gl_account_id: int | None = None  # required for 'other'; overrides the reason's ledger role
    cost_center_id: int | None = None
    remarks: str | None = None


class PaymentLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    line_number: int
    gl_account_id: int
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    cost_center_id: int | None = None
    internal_order_id: int | None = None
    amount: float
    remarks: str | None = None


class PaymentCreate(BaseModel):
    """Legacy: pay one vendor invoice in full or part."""
    vendor_invoice_id: int
    bank_account_id: int
    amount: float
    payment_mode: str
    payment_date: date
    cheque_number: str | None = None
    cheque_date: date | None = None


class VoucherCreate(BaseModel):
    # vendor | customer | expense | other_receipt | contra
    payment_type: str
    bank_account_id: int
    amount: float
    payment_mode: str
    payment_date: date
    vendor_id: int | None = None
    customer_id: int | None = None
    counter_bank_account_id: int | None = None
    lines: list[PaymentLinePayload] = Field(default_factory=list)
    allocations: list[AllocationPayload] = Field(default_factory=list)
    cheque_number: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    narration: str | None = None
    deductions: list[DeductionPayload] = Field(default_factory=list)
    # Down payment (customer / supplier advance) — held on its own ledger.
    is_advance: bool = False
    sales_order_id: int | None = None
    billing_line_id: int | None = None
    purchase_order_id: int | None = None
    advance_reason: str | None = None
    # Foreign currency (vendor / customer vouchers): amount_fc in `currency`;
    # amount (INR) = amount_fc x exchange_rate.
    currency: str | None = None
    exchange_rate: float | None = None
    amount_fc: float | None = None


class WriteOffCreate(BaseModel):
    """Standalone write-off of what is left on one invoice (no cash)."""
    target_type: str  # vendor_invoice | ar_transaction
    target_id: int
    amount: float
    reason: str
    write_off_date: date | None = None
    gl_account_id: int | None = None
    cost_center_id: int | None = None
    remarks: str | None = None


class AllocateCreate(BaseModel):
    """Set off an advance / unadjusted note / manual JV line against invoices later."""
    source_type: str  # payment | advance | party_note | journal (source_id = journal line id)
    source_id: int
    allocations: list[AllocationPayload] = Field(default_factory=list)
    allocation_date: date | None = None


class VoucherCancelPayload(BaseModel):
    reason: str


class AllocationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    source_type: str
    source_id: int
    target_type: str
    target_id: int
    amount: float
    allocation_date: date
    target_number: str | None = None
    journal_entry_id: int | None = None
    source_amount: float | None = None
    amount_fc: float | None = None
    fx_difference: float | None = None
    fx_journal_entry_id: int | None = None


class DeductionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    payment_transaction_id: int | None = None
    journal_entry_id: int | None = None
    target_type: str
    target_id: int
    target_number: str | None = None
    reason: str
    reason_label: str | None = None
    gl_account_id: int
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    cost_center_id: int | None = None
    amount: float
    adjustment_date: date
    remarks: str | None = None
    status: str


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
    counter_bank_account_id: int | None = None
    counter_bank_account_label: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    customer_id: int | None = None
    customer_name: str | None = None
    vendor_invoice_id: int | None = None
    vendor_invoice_number: str | None = None
    ar_transaction_id: int | None = None
    cheque_number: str | None = None
    cheque_date: date | None = None
    reference_no: str | None = None
    narration: str | None = None
    unallocated_amount: float = 0
    currency: str = "INR"
    exchange_rate: float = 1
    amount_fc: float | None = None
    status: str = "posted"
    reconciliation_status: str = "pending"
    cleared_date: date | None = None
    counter_reconciliation_status: str = "pending"
    counter_cleared_date: date | None = None
    journal_entry_id: int | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    lines: list[PaymentLineResponse] = Field(default_factory=list)
    allocations: list[AllocationResponse] = Field(default_factory=list)
    deductions: list[DeductionResponse] = Field(default_factory=list)
    deduction_total: float = 0
    is_advance: bool = False
    sales_order_id: int | None = None
    sales_order_number: str | None = None
    billing_line_id: int | None = None
    purchase_order_id: int | None = None
    purchase_order_number: str | None = None
    advance_reason: str | None = None
    pending_allocations: list[dict] | None = None
    payment_proposal_id: int | None = None
    approved_by_id: int | None = None
    approved_by_name: str | None = None
    rejection_reason: str | None = None
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
