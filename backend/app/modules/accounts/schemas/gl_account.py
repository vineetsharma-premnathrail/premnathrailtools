from datetime import datetime
from pydantic import BaseModel


class GLAccountCreate(BaseModel):
    code: str
    name: str
    account_type: str | None = None
    group_id: int | None = None
    account_sub_type: str | None = None
    currency: str | None = "INR"
    status: str = "active"
    opening_balance: float | None = 0
    is_posting_account: bool = True
    is_control_account: bool = False
    # None = decided from the group: overhead ledgers (Other Expenses /
    # Employee Benefits) need a cost centre or internal order.
    cost_object_required: bool | None = None
    default_cost_center_id: int | None = None


class GLAccountUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    account_type: str | None = None
    group_id: int | None = None
    account_sub_type: str | None = None
    currency: str | None = None
    status: str | None = None
    opening_balance: float | None = None
    is_posting_account: bool | None = None
    is_control_account: bool | None = None
    cost_object_required: bool | None = None
    default_cost_center_id: int | None = None


class GLAccountResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    account_type: str
    group_id: int | None = None
    group_name: str | None = None
    account_sub_type: str | None = None
    currency: str | None = None
    status: str
    opening_balance: float | None = None
    is_posting_account: bool
    is_control_account: bool
    cost_object_required: bool = False
    default_cost_center_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
