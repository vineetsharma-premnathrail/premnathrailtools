from datetime import date, datetime
from pydantic import BaseModel


class RndExperimentParameter(BaseModel):
    parameter: str
    specification: str | None = None
    measured: str | None = None
    unit: str | None = None
    result: str | None = None  # pass / fail / blank


class RndExperimentCreate(BaseModel):
    project_id: int
    prototype_id: int | None = None
    title: str
    experiment_type: str = "lab_test"
    objective: str | None = None
    method: str | None = None
    experiment_date: date | None = None
    conducted_by_id: int | None = None
    parameters: list[RndExperimentParameter] = []
    observations: str | None = None
    conclusion: str | None = None


class RndExperimentUpdate(BaseModel):
    project_id: int | None = None
    prototype_id: int | None = None
    title: str | None = None
    experiment_type: str | None = None
    status: str | None = None
    result: str | None = None
    objective: str | None = None
    method: str | None = None
    experiment_date: date | None = None
    conducted_by_id: int | None = None
    parameters: list[RndExperimentParameter] | None = None
    observations: str | None = None
    conclusion: str | None = None


class RndExperimentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    experiment_number: str
    project_id: int
    prototype_id: int | None = None
    title: str
    experiment_type: str
    status: str
    result: str | None = None
    objective: str | None = None
    method: str | None = None
    experiment_date: date | None = None
    conducted_by_id: int | None = None
    parameters: list[RndExperimentParameter] = []
    observations: str | None = None
    conclusion: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    project_number: str | None = None
    project_title: str | None = None
    prototype_number: str | None = None
    conducted_by_name: str | None = None
