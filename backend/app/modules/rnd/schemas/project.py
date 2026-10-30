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
    bom_cost: float | None = 0  # None = hidden (R&D › Prototypes › BOM costs)
    production_bom_id: int | None = None
    production_bom_number: str | None = None


class RndProjectCreate(BaseModel):
    title: str
    project_type: str = "new_product"
    priority: str = "standard"
    objective: str
    scope: str | None = None
    lead_id: int | None = None
    lead_ids: list[int] | None = None
    team_member_ids: list[int] = []
    start_date: date | None = None
    target_end_date: date | None = None
    budget_amount: float | None = None
    # A budget Finance created to link instead of typing an amount (the amount then comes from Finance).
    internal_order_id: int | None = None
    remarks: str | None = None
    # Origin + source (services/project_origin.py validates per origin).
    origin: str | None = None
    source_kind: str | None = None
    source_id: int | None = None
    improvement_reason: str | None = None
    product_id: int | None = None
    machine_id: int | None = None
    origin_note: str | None = None
    # Files the form uploads right after create — proof for origins that need
    # an attached document (the files themselves go to /rnd/documents).
    attachment_count: int = 0


class RndProjectUpdate(BaseModel):
    title: str | None = None
    project_type: str | None = None
    priority: str | None = None
    status: str | None = None
    objective: str | None = None
    scope: str | None = None
    lead_id: int | None = None
    lead_ids: list[int] | None = None
    team_member_ids: list[int] | None = None
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None
    budget_amount: float | None = None
    internal_order_id: int | None = None
    handover_specs_final: bool | None = None
    handover_bom_approved: bool | None = None
    handover_process_documented: bool | None = None
    handover_quality_standards: bool | None = None
    handover_notes: str | None = None
    remarks: str | None = None
    # Origin + source (services/project_origin.py validates per origin).
    origin: str | None = None
    source_kind: str | None = None
    source_id: int | None = None
    improvement_reason: str | None = None
    product_id: int | None = None
    machine_id: int | None = None
    origin_note: str | None = None


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
    lead_ids: list[int] = []
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
    origin: str | None = None
    source_kind: str | None = None
    source_id: int | None = None
    source_ref: str | None = None
    improvement_reason: str | None = None
    product_id: int | None = None
    machine_id: int | None = None
    origin_note: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    # CRM requirements (R&D › Requirements) this project is linked to.
    linked_requirements: list[dict] = []
    lead_name: str | None = None  # all leads, comma-separated
    leads: list[RndProjectMember] = []
    team_members: list[RndProjectMember] = []
    actual_cost: float | None = 0  # None = hidden (R&D › Prototypes › BOM costs)
    # The Finance budget behind the project; budget_from_finance = linked to a
    # budget Finance created (its amount is Finance's, not typed on the project).
    internal_order_id: int | None = None
    internal_order_code: str | None = None
    internal_order_name: str | None = None
    budget_from_finance: bool = False
    experiment_count: int = 0
    prototype_count: int = 0
    origin_label: str | None = None
    improvement_reason_label: str | None = None
    product_name: str | None = None
    machine_label: str | None = None
    # Frontend detail page of the source record (null once it's deleted);
    # the signed source_id_ref is added by the record-ref middleware.
    source_path: str | None = None
    source_exists: bool = False


class RndProjectDetailResponse(RndProjectResponse):
    experiments: list[RndProjectExperimentSummary] = []
    prototypes: list[RndProjectPrototypeSummary] = []
    has_feasibility: bool = False
    feasibility_recommendation: str | None = None
