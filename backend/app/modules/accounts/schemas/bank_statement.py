from datetime import date, datetime
from pydantic import BaseModel, Field


class BankStatementLineMatchPayload(BaseModel):
    payment_transaction_ids: list[int] = Field(min_length=1)


class BankStatementLineBookPayload(BaseModel):
    kind: str = "bank_charges"
    gl_account_id: int | None = None
    cost_center_id: int | None = None
    narration: str | None = Field(default=None, max_length=300)


class BankStatementLineResponse(BaseModel):
    id: int
    statement_id: int
    line_number: int
    txn_date: date | None = None
    value_date: date
    description: str | None = None
    reference: str | None = None
    cheque_number: str | None = None
    debit: float
    credit: float
    balance: float | None = None
    match_status: str
    match_method: str | None = None
    matched_payments: list | None = None
    booked_payment_id: int | None = None
    matched_at: datetime | None = None

    model_config = {"from_attributes": True}

    direction: str | None = None
    amount: float | None = None
    matched_numbers: list[str] = []
    matched_by_name: str | None = None


class BankStatementResponse(BaseModel):
    id: int
    bank_account_id: int
    bank_reconciliation_id: int
    statement_format: str
    file_name: str | None = None
    from_date: date | None = None
    to_date: date | None = None
    opening_balance: float | None = None
    closing_balance: float | None = None
    line_count: int
    skipped_duplicates: int
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    uploaded_by_name: str | None = None


class BankStatementImportResponse(BaseModel):
    statement: BankStatementResponse
    warnings: list[str] = []
    auto_match: dict | None = None


class StatementCandidateResponse(BaseModel):
    payment_transaction_id: int
    payment_number: str
    payment_date: date
    payment_type: str
    payment_mode: str
    amount: float
    direction: str
    reference_no: str | None = None
    cheque_number: str | None = None
    party_name: str | None = None
    exact_amount: bool = False
