from datetime import date, datetime
from pydantic import BaseModel, Field


class ElectricalJobStageUpdate(BaseModel):
    assignee_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    remarks: str | None = None


class ElectricalJobStageResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    stage_key: str
    sequence: int
    status: str
    assignee_id: int | None = None
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by_id: int | None = None
    remarks: str | None = None

    # Denormalized display fields, filled in by the route.
    label: str = ""
    phase: str = ""
    assignee_name: str | None = None
    completed_by_name: str | None = None
    is_mandatory: bool = False
    is_overdue: bool = False
    # What still blocks completion (empty once the gate is clear).
    gate_problems: list[str] = []


class ElectricalJobCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    erp_project_id: int | None = None
    rrv_model: str | None = Field(None, max_length=150)
    vehicle_number: str | None = Field(None, max_length=100)
    customer_name: str | None = Field(None, max_length=255)
    branch_id: int | None = None
    lead_engineer_id: int | None = None
    priority: str = "normal"
    planned_start_date: date | None = None
    target_handover_date: date | None = None
    system_voltage: str | None = Field(None, max_length=50)
    battery_spec: str | None = Field(None, max_length=255)
    alternator_spec: str | None = Field(None, max_length=255)
    applicable_standards: str | None = Field(None, max_length=500)
    customer_spec_ref: str | None = Field(None, max_length=255)
    requirement_notes: str | None = None
    remarks: str | None = None


class ElectricalJobUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    erp_project_id: int | None = None
    rrv_model: str | None = Field(None, max_length=150)
    vehicle_number: str | None = Field(None, max_length=100)
    customer_name: str | None = Field(None, max_length=255)
    branch_id: int | None = None
    lead_engineer_id: int | None = None
    priority: str | None = None
    planned_start_date: date | None = None
    target_handover_date: date | None = None
    system_voltage: str | None = Field(None, max_length=50)
    battery_spec: str | None = Field(None, max_length=255)
    alternator_spec: str | None = Field(None, max_length=255)
    applicable_standards: str | None = Field(None, max_length=500)
    customer_spec_ref: str | None = Field(None, max_length=255)
    requirement_notes: str | None = None
    commissioning_location: str | None = Field(None, max_length=255)
    commissioned_on: date | None = None
    handover_to_name: str | None = Field(None, max_length=150)
    handover_to_organization: str | None = Field(None, max_length=255)
    handover_date: date | None = None
    handover_remarks: str | None = None
    remarks: str | None = None


class ElectricalJobReasonPayload(BaseModel):
    reason: str = Field(min_length=1)


class ElectricalStageActionPayload(BaseModel):
    remarks: str | None = None


class ElectricalJobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_number: str
    title: str
    erp_project_id: int | None = None
    rrv_model: str | None = None
    vehicle_number: str | None = None
    customer_name: str | None = None
    branch_id: int | None = None
    lead_engineer_id: int | None = None
    priority: str
    status: str
    planned_start_date: date | None = None
    target_handover_date: date | None = None
    started_at: datetime | None = None
    system_voltage: str | None = None
    battery_spec: str | None = None
    alternator_spec: str | None = None
    applicable_standards: str | None = None
    customer_spec_ref: str | None = None
    requirement_notes: str | None = None
    quality_inspection_id: int | None = None
    commissioning_location: str | None = None
    commissioned_on: date | None = None
    handover_to_name: str | None = None
    handover_to_organization: str | None = None
    handover_date: date | None = None
    handover_remarks: str | None = None
    handed_over_at: datetime | None = None
    closed_at: datetime | None = None
    hold_reason: str | None = None
    cancel_reason: str | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    project_label: str | None = None
    branch_name: str | None = None
    lead_engineer_name: str | None = None
    created_by_name: str | None = None
    total_stages: int = 0
    done_stages: int = 0
    progress_percent: int = 0
    current_stage_key: str | None = None
    current_stage_label: str | None = None
    current_phase: str | None = None
    is_overdue: bool = False


class ElectricalJobSummary(BaseModel):
    """Counters for the detail page's tab badges and QC & Handover panel."""
    bom_count: int = 0
    bom_required: int = 0
    bom_estimated_cost: float = 0.0
    cable_count: int = 0
    cables_installed: int = 0
    panel_count: int = 0
    panels_assembled: int = 0
    drawing_count: int = 0
    drawings_pending_approval: int = 0
    as_built_approved: int = 0
    factory_tests: int = 0
    commissioning_tests: int = 0
    open_failures: int = 0
    open_issues: int = 0
    document_count: int = 0
    inspection_number: str | None = None
    inspection_status: str | None = None


class ElectricalJobDetail(ElectricalJobResponse):
    stages: list[ElectricalJobStageResponse] = []
    summary: ElectricalJobSummary = ElectricalJobSummary()
