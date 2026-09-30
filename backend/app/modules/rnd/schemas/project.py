from datetime import date, datetime
from pydantic import BaseModel


class RndProjectMember(BaseModel):
    id: int
    name: str


class RndProjectExperimentSummary(BaseModel):
    id: int
    experiment_number: str
    title: str
    status: str
    result: str | None = None
    experiment_date: date | None = None


class RndProjectPrototypeSummary(BaseModel):
    id: int
    prototype_number: str
    name: str
    version: str
    status: str
    bom_cost: float = 0
    production_bom_id: int | None = None
    production_bom_number: str | None = None


class RndProjectCreate(BaseModel):
    title: str
    project_type: str = "new_product"
    priority: str = "medium"
    objective: str
    scope: str | None = None
    lead_id: int | None = None
    team_member_ids: list[int] = []
    start_date: date | None = None
    target_end_date: date | None = None
    budget_amount: float | None = None
    remarks: str | None = None


class RndProjectUpdate(BaseModel):
    title: str | None = None
    project_type: str | None = None
    priority: str | None = None
    status: str | None = None
    objective: str | None = None
    scope: str | None = None
    lead_id: int | None = None
    team_member_ids: list[int] | None = None
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None
    budget_amount: float | None = None
    handover_specs_final: bool | None = None
    handover_bom_approved: bool | None = None
    handover_process_documented: bool | None = None
    handover_quality_standards: bool | None = None
    handover_notes: str | None = None
    remarks: str | None = None


class RndProjectStagePayload(BaseModel):
    stage: str


class RndProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_number: str
    title: str
    project_type: str
    priority: str
    stage: str
    status: str
    objective: str
    scope: str | None = None
    lead_id: int | None = None
    team_member_ids: list[int] = []
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None
    budget_amount: float | None = None
    handover_specs_final: bool = False
    handover_bom_approved: bool = False
    handover_process_documented: bool = False
    handover_quality_standards: bool = False
    handover_notes: str | None = None
    handed_over_at: datetime | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    lead_name: str | None = None
    team_members: list[RndProjectMember] = []
    actual_cost: float = 0
    experiment_count: int = 0
    prototype_count: int = 0


class RndProjectDetailResponse(RndProjectResponse):
    experiments: list[RndProjectExperimentSummary] = []
    prototypes: list[RndProjectPrototypeSummary] = []
    has_feasibility: bool = False
    feasibility_recommendation: str | None = None
