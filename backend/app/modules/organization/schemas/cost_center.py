from datetime import date, datetime
from pydantic import BaseModel


class CostCenterCreate(BaseModel):
    branch_id: int | None = None
    code: str
    name: str
    cost_center_type: str | None = None
    department_id: int | None = None
    head_user_id: int | None = None
    parent_cost_center_id: int | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    status: str = "active"
    annual_budget: float | None = None
    budget_period: str | None = None
    gl_account_id: int | None = None


class CostCenterUpdate(BaseModel):
    branch_id: int | None = None
    code: str | None = None
    name: str | None = None
    cost_center_type: str | None = None
    department_id: int | None = None
    head_user_id: int | None = None
    parent_cost_center_id: int | None = None
    effective_from: date | None = None
    effective_to: date | None = None
    status: str | None = None
    annual_budget: float | None = None
    budget_period: str | None = None
    gl_account_id: int | None = None


class CostCenterResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    branch_id: int | None
    branch_name: str | None = None
    code: str
    name: str
    cost_center_type: str | None
    department_id: int | None
    department_name: str | None = None
    head_user_id: int | None
    head_user_name: str | None = None
    parent_cost_center_id: int | None
    parent_cost_center_name: str | None = None
    effective_from: date | None
    effective_to: date | None
    status: str
    annual_budget: float | None = None
    budget_period: str | None = None
    gl_account_id: int | None = None
    gl_account_code: str | None = None
    created_at: datetime
    updated_at: datetime
