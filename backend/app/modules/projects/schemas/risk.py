from datetime import datetime
from pydantic import BaseModel


class PmRiskCreate(BaseModel):
    title: str
    description: str | None = None
    probability: str | None = None
    impact: str | None = None
    mitigation_plan: str | None = None
    owner_id: int | None = None


class PmRiskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    probability: str | None = None
    impact: str | None = None
    status: str | None = None
    mitigation_plan: str | None = None
    owner_id: int | None = None


class PmRiskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    title: str
    description: str | None = None
    probability: str
    impact: str
    status: str
    mitigation_plan: str | None = None
    owner_id: int | None = None

    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized/computed display fields, filled in by the route.
    owner_name: str | None = None
    risk_score: int = 0
