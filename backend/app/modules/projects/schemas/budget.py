from datetime import date, datetime
from pydantic import BaseModel


class PmBudgetLineCreate(BaseModel):
    category: str
    budgeted_amount: float
    notes: str | None = None


class PmBudgetLineUpdate(BaseModel):
    category: str | None = None
    budgeted_amount: float | None = None
    notes: str | None = None


class PmBudgetLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    category: str
    budgeted_amount: float
    notes: str | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Computed by the route from PmCostEntry rows, not stored.
    spent_amount: float = 0
    remaining_amount: float = 0


class PmCostEntryCreate(BaseModel):
    budget_line_id: int | None = None
    amount: float
    cost_date: date
    description: str | None = None


class PmCostEntryUpdate(BaseModel):
    budget_line_id: int | None = None
    amount: float | None = None
    cost_date: date | None = None
    description: str | None = None


class PmCostEntryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    budget_line_id: int | None = None
    amount: float
    cost_date: date
    description: str | None = None
    recorded_by_id: int | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display field, filled in by the route.
    recorded_by_name: str | None = None
