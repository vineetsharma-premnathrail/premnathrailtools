from datetime import date, datetime
from pydantic import BaseModel, Field


class BankReconciliationCreate(BaseModel):
    bank_account_id: int
    statement_date: date
    statement_balance: float


class ReconcilePaymentsPayload(BaseModel):
    payment_transaction_ids: list[int] = Field(default_factory=list)


class UnreconciledPaymentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    payment_number: str
    payment_type: str
    payment_mode: str
    payment_date: date
    amount: float
    vendor_name: str | None = None
    customer_name: str | None = None


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
