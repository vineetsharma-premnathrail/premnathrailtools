from datetime import date, datetime
from pydantic import BaseModel


class InternalOrderCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    order_type: str
    start_date: date | None = None
    end_date: date | None = None
    budgeted_amount: float | None = None
    gl_account_id: int | None = None
    cost_center_id: int | None = None
    status: str = "open"


class InternalOrderUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    description: str | None = None
    order_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    budgeted_amount: float | None = None
    gl_account_id: int | None = None
    cost_center_id: int | None = None
    status: str | None = None


class InternalOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    description: str | None = None
    order_type: str
    start_date: date | None = None
    end_date: date | None = None
    budgeted_amount: float | None = None
    gl_account_id: int | None = None
    gl_account_code: str | None = None
    cost_center_id: int | None = None
    cost_center_name: str | None = None
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
