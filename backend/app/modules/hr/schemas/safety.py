from datetime import date, datetime

from pydantic import BaseModel, Field


class HrSafetyAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    filename: str
    size_bytes: int | None = None
    uploaded_by_id: int | None = None
    created_at: datetime | None = None
    uploaded_by_name: str | None = None


class HrSafetyWitness(BaseModel):
    user_id: int | None = None
    name: str | None = Field(None, max_length=150)
    statement: str | None = Field(None, max_length=4000)


class HrSafetyPersonPayload(BaseModel):
    person_type: str = "employee"
    user_id: int | None = None
    external_name: str | None = Field(None, max_length=150)
    external_company: str | None = Field(None, max_length=150)
    age: int | None = Field(None, ge=14, le=100)
    occupation: str | None = Field(None, max_length=120)
    outcome: str = "no_injury"
    injury_nature: str | None = Field(None, max_length=200)
    body_part: str | None = Field(None, max_length=120)
    treatment: str | None = Field(None, max_length=4000)
    lost_days: int = Field(0, ge=0, le=6000)
    return_to_work_date: date | None = None


class HrSafetyPersonResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    person_type: str
    user_id: int | None = None
    external_name: str | None = None
    external_company: str | None = None
    age: int | None = None
    occupation: str | None = None
    outcome: str
    injury_nature: str | None = None
    body_part: str | None = None
    treatment: str | None = None
    lost_days: int = 0
    return_to_work_date: date | None = None
    display_name: str | None = None
    employee_code: str | None = None


class HrSafetyActionPayload(BaseModel):
    action_type: str = "corrective"
    description: str = Field(..., min_length=3, max_length=4000)
    owner_id: int
    due_date: date


class HrSafetyActionUpdate(BaseModel):
    action_type: str | None = None
    description: str | None = Field(None, min_length=3, max_length=4000)
    owner_id: int | None = None
    due_date: date | None = None


class HrSafetyActionCompletePayload(BaseModel):
    remarks: str = Field(..., min_length=3, max_length=4000)
    completed_on: date | None = None


class HrSafetyActionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    action_type: str
    description: str
    owner_id: int
    due_date: date
    status: str
    completion_remarks: str | None = None
    completed_on: date | None = None
    completed_by_id: int | None = None
    owner_name: str | None = None
    completed_by_name: str | None = None
    is_overdue: bool = False
    can_complete: bool = False


class HrSafetyIncidentCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    incident_type: str
    severity: str
    branch_id: int | None = None
    department_id: int | None = None
    location_text: str | None = Field(None, max_length=200)
    occurred_at: datetime
    description: str = Field(..., min_length=10, max_length=8000)
    immediate_action: str | None = Field(None, max_length=8000)
    asset_id: int | None = None
    erp_project_id: int | None = None
    witnesses: list[HrSafetyWitness] = Field(default_factory=list, max_length=30)
    persons: list[HrSafetyPersonPayload] = Field(default_factory=list, max_length=50)


class HrSafetyIncidentUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=200)
    incident_type: str | None = None
    severity: str | None = None
    branch_id: int | None = None
    department_id: int | None = None
    location_text: str | None = Field(None, max_length=200)
    occurred_at: datetime | None = None
    description: str | None = Field(None, min_length=10, max_length=8000)
    immediate_action: str | None = Field(None, max_length=8000)
    asset_id: int | None = None
    erp_project_id: int | None = None
    witnesses: list[HrSafetyWitness] | None = Field(None, max_length=30)


class HrSafetyIncidentInvestigatePayload(BaseModel):
    investigation_lead_id: int


class HrSafetyIncidentInvestigationPayload(BaseModel):
    root_cause: str | None = Field(None, max_length=8000)
    root_cause_category: str | None = None
    contributing_factors: str | None = Field(None, max_length=8000)
    no_action_reason: str | None = Field(None, max_length=4000)
    complete: bool = False


class HrSafetyIncidentStatutoryPayload(BaseModel):
    reportable_manual: bool | None = None
    form18_submitted_on: date | None = None
    authority_ref: str | None = Field(None, max_length=100)


class HrSafetyIncidentClosePayload(BaseModel):
    remarks: str = Field(..., min_length=3, max_length=4000)


class HrSafetyIncidentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    incident_no: str
    title: str
    incident_type: str
    severity: str
    status: str
    branch_id: int | None = None
    department_id: int | None = None
    location_text: str | None = None
    occurred_at: datetime
    reported_at: datetime
    reported_by_id: int | None = None
    description: str
    immediate_action: str | None = None
    asset_id: int | None = None
    erp_project_id: int | None = None
    witnesses: list[HrSafetyWitness] | None = None
    investigation_lead_id: int | None = None
    investigation_started_at: datetime | None = None
    root_cause: str | None = None
    root_cause_category: str | None = None
    contributing_factors: str | None = None
    investigation_completed_at: datetime | None = None
    no_action_reason: str | None = None
    reportable_manual: bool = False
    form18_submitted_on: date | None = None
    authority_ref: str | None = None
    document_revision: int = 0
    closure_remarks: str | None = None
    closed_by_id: int | None = None
    closed_at: datetime | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    persons: list[HrSafetyPersonResponse] = []
    actions: list[HrSafetyActionResponse] = []
    attachments: list[HrSafetyAttachmentResponse] = []

    branch_name: str | None = None
    department_name: str | None = None
    reported_by_name: str | None = None
    investigation_lead_name: str | None = None
    closed_by_name: str | None = None
    asset_label: str | None = None
    erp_project_label: str | None = None
    reportable: bool = False
    reportable_reasons: list[str] = []
    lost_days: int = 0
    lti_count: int = 0
    injured_count: int = 0
    open_actions: int = 0
    overdue_actions: int = 0
    closure_blockers: list[str] = []
    # What the viewer may do (UI hints; the API enforces them).
    can_edit: bool = False
    can_investigate: bool = False
    can_submit_closure: bool = False
    can_withdraw_closure: bool = False
    can_delete: bool = False
    can_print: bool = False
