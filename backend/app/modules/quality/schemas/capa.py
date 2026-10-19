from datetime import date, datetime
from pydantic import BaseModel


class QualityCapaTeamMemberPayload(BaseModel):
    user_id: int
    role: str = "member"
    department: str | None = None


class QualityCapaTeamMemberResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    role: str
    department: str | None = None
    user_name: str | None = None


class QualityCapaActionPayload(BaseModel):
    kind: str = "corrective"
    prevention_type: str | None = None
    description: str
    owner_id: int
    due_date: date


class QualityCapaActionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    kind: str
    prevention_type: str | None = None
    description: str
    owner_id: int
    due_date: date
    status: str
    evidence: str | None = None
    evidence_reference: str | None = None
    done_by_id: int | None = None
    done_at: datetime | None = None
    cancel_reason: str | None = None
    superseded: bool = False
    created_at: datetime | None = None
    owner_name: str | None = None
    done_by_name: str | None = None
    overdue: bool = False


class QualityCapaCreate(BaseModel):
    action_type: str = "corrective"
    severity: str = "major"
    title: str
    ncr_ids: list[int] = []
    complaint_id: int | None = None
    item_id: int | None = None
    item_name: str | None = None
    vendor_name: str | None = None
    defect_code_id: int | None = None
    audit_reference: str | None = None
    problem_statement: str | None = None
    responsible_user_id: int | None = None
    due_date: date | None = None


class QualityCapaUpdate(BaseModel):
    action_type: str | None = None
    severity: str | None = None
    title: str | None = None
    item_id: int | None = None
    vendor_name: str | None = None
    defect_code_id: int | None = None
    responsible_user_id: int | None = None
    due_date: date | None = None
    problem_statement: str | None = None
    containment_actions: str | None = None
    root_cause_method: str | None = None
    why_analysis: list[str] | None = None
    fishbone: dict[str, list[str]] | None = None
    root_cause: str | None = None
    implementation_summary: str | None = None
    prevention_not_needed_reason: str | None = None
    verification_notes: str | None = None


class QualityCapaTeamPayload(BaseModel):
    members: list[QualityCapaTeamMemberPayload]


class QualityCapaLinkNcrPayload(BaseModel):
    ncr_id: int


class QualityCapaActionDonePayload(BaseModel):
    evidence: str | None = None
    evidence_reference: str | None = None


class QualityCapaReasonPayload(BaseModel):
    reason: str | None = None


class QualityCapaEffectivenessPayload(BaseModel):
    effective: bool
    remarks: str | None = None


class QualityCapaResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    capa_number: str
    action_type: str
    trigger: str
    severity: str
    ncr_id: int | None = None
    complaint_id: int | None = None
    audit_reference: str | None = None
    item_id: int | None = None
    item_name: str | None = None
    vendor_name: str | None = None
    defect_code_id: int | None = None
    title: str
    responsible_user_id: int | None = None
    due_date: date | None = None
    problem_statement: str | None = None
    containment_actions: str | None = None
    containment_done_at: datetime | None = None
    root_cause_method: str | None = None
    why_analysis: list[str] | None = None
    fishbone: dict[str, list[str]] | None = None
    root_cause: str | None = None
    root_cause_found_at: datetime | None = None
    action_plan: str | None = None
    implementation_summary: str | None = None
    prevention_not_needed_reason: str | None = None
    actions_completed_at: datetime | None = None
    effectiveness_due_date: date | None = None
    effectiveness_result: str | None = None
    effectiveness_remarks: str | None = None
    effectiveness_checked_by_id: int | None = None
    effectiveness_checked_at: datetime | None = None
    verification_notes: str | None = None
    closure_remarks: str | None = None
    status: str
    reopen_count: int = 0
    report_revision: int = 0
    created_by_id: int | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    responsible_user_name: str | None = None
    ncr_number: str | None = None
    complaint_number: str | None = None
    defect_code_label: str | None = None
    effectiveness_checked_by_name: str | None = None
    overdue: bool = False
    open_actions: int = 0
    team: list[QualityCapaTeamMemberResponse] = []
    actions: list[QualityCapaActionResponse] = []
    ncrs: list[dict] = []
    recurrences: list[dict] = []
