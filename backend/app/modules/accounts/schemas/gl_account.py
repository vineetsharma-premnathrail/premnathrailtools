from datetime import datetime
from pydantic import BaseModel


class GLAccountCreate(BaseModel):
    code: str
    name: str
    account_type: str
    account_sub_type: str | None = None
    currency: str | None = "INR"
    status: str = "active"
    opening_balance: float | None = 0
    is_posting_account: bool = True
    is_control_account: bool = False


class GLAccountUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    account_type: str | None = None
    account_sub_type: str | None = None
    currency: str | None = None
    status: str | None = None
    opening_balance: float | None = None
    is_posting_account: bool | None = None
    is_control_account: bool | None = None


class GLAccountResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    account_type: str
    account_sub_type: str | None = None
    currency: str | None = None
    status: str
    opening_balance: float | None = None
    is_posting_account: bool
    is_control_account: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
