from datetime import date, datetime
from pydantic import BaseModel, Field


class BankReconciliationCreate(BaseModel):
    bank_account_id: int
    statement_date: date
    statement_balance: float


class ReconcilePaymentsPayload(BaseModel):
    payment_transaction_ids: list[int] = Field(default_factory=list)
    # Bank (clearing) date; defaults to the statement date.
    cleared_date: date | None = None


class UnreconciledPaymentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    payment_number: str
    payment_type: str
    payment_mode: str
    payment_date: date
    amount: float
    direction: str | None = None
    cheque_number: str | None = None
    reference_no: str | None = None
    vendor_name: str | None = None
    customer_name: str | None = None
    party_name: str | None = None


class BankReconciliationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bank_account_id: int
    bank_account_label: str | None = None
    statement_date: date
    statement_balance: float
    book_balance: float
    status: str
    created_by_id: int | None = None
    completed_by_id: int | None = None
    completed_by_name: str | None = None
    completed_at: datetime | None = None
    created_at: datetime | None = None

    outstanding_cheques: float = 0
    deposits_in_transit: float = 0
    reconciled_balance: float = 0
    difference: float = 0
