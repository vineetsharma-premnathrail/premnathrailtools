from datetime import datetime
from pydantic import BaseModel


class BankAccountCreate(BaseModel):
    bank_name: str
    account_no: str
    account_holder_name: str | None = None
    branch_name: str | None = None
    ifsc_code: str | None = None
    currency: str | None = "INR"
    opening_balance: float = 0
    gl_account_id: int | None = None
    status: str = "active"


class BankAccountUpdate(BaseModel):
    bank_name: str | None = None
    account_no: str | None = None
    account_holder_name: str | None = None
    branch_name: str | None = None
    ifsc_code: str | None = None
    currency: str | None = None
    gl_account_id: int | None = None
    status: str | None = None


class BankAccountResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bank_name: str
    account_no: str
    account_holder_name: str | None = None
    branch_name: str | None = None
    ifsc_code: str | None = None
    currency: str | None = None
    opening_balance: float
    current_balance: float
    gl_account_id: int | None = None
    gl_account_code: str | None = None
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
