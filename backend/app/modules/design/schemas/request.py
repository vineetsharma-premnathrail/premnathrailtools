from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.event import DesignEventResponse


class DesignRequirementRevisionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    revision: int
    requirement: str
    change_note: str | None = None
    revised_by_id: int | None = None
    created_at: datetime | None = None

    revised_by_name: str | None = None


class DesignRequestCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    source: str = "internal"
    crm_source: str | None = None  # inquiry | tender
    crm_record_id: int | None = None
    customer_id: int | None = None
    pm_project_id: int | None = None
    pm_milestone_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    requirement: str = Field(min_length=5, max_length=20000)
    priority: str = "standard"
    due_date: date | None = None
    lead_designer_id: int | None = None


class DesignRequestUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=255)
    customer_id: int | None = None
    pm_project_id: int | None = None
    pm_milestone_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    priority: str | None = None
    due_date: date | None = None
    lead_designer_id: int | None = None


class DesignRequestRevisePayload(BaseModel):
    """New version of the technical requirement (BD revised it)."""
    requirement: str = Field(min_length=5, max_length=20000)
    change_note: str = Field(min_length=3, max_length=4000)


class DesignRequestStatusPayload(BaseModel):
    """accept | start | hold | resume | complete | cancel | reopen."""
    action: str
    reason: str | None = Field(None, max_length=4000)


class DesignRequestWaitingPayload(BaseModel):
    waiting_on: str  # design | requester
    note: str | None = Field(None, max_length=4000)


class DesignRequestDeliverable(BaseModel):
    """A drawing or BOM produced for the request."""
    kind: str  # document | bom
    id: int
    number: str
    title: str
    status: str
    released_revision_label: str | None = None


class DesignRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    request_number: str
    title: str
    source: str
    crm_source: str | None = None
    crm_record_id: int | None = None
    crm_reference: str | None = None
    customer_id: int | None = None
    pm_project_id: int | None = None
    pm_milestone_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    requirement: str
    requirement_revision: int
    requirement_revised_at: datetime | None = None
    reviewed_revision: int
    reviewed_at: datetime | None = None
    priority: str
    due_date: date | None = None
    status: str
    waiting_on: str
    waiting_note: str | None = None
    lead_designer_id: int | None = None
    requested_by_id: int | None = None
    closed_at: datetime | None = None
    close_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    customer_name: str | None = None
    pm_project_label: str | None = None
    pm_milestone_label: str | None = None
    erp_project_label: str | None = None
    # Project chip: project code (order_project_number), unit no / label.
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    order_project_display: str | None = None
    lead_designer_name: str | None = None
    requested_by_name: str | None = None
    # The lead designer hasn't confirmed the latest requirement revision.
    changed_since_review: bool = False
    is_overdue: bool = False
    document_count: int = 0
    released_count: int = 0


class DesignRequestDetail(DesignRequestResponse):
    history: list[DesignRequirementRevisionResponse] = []
    deliverables: list[DesignRequestDeliverable] = []
    events: list[DesignEventResponse] = []
    allowed_actions: list[str] = []


class DesignMilestoneEvidence(BaseModel):
    """What Design has released for a project WBS — the evidence the
    Design head attaches when submitting the WBS."""
    milestone_id: int
    milestone_title: str
    project_label: str | None = None
    target_date: date | None = None
    status: str
    released_documents: list[DesignRequestDeliverable] = []
    released_boms: list[DesignRequestDeliverable] = []
    pending_documents: list[DesignRequestDeliverable] = []
    customer_approvals_pending: int = 0


class DesignTaskDeliverableCreate(BaseModel):
    pm_task_id: int
    document_id: int | None = None
    bom_id: int | None = None


class DesignWorkTask(BaseModel):
    """One of my Project Management tasks, with the deliverable it produces."""
    task_id: int
    title: str
    status: str
    priority: str
    due_date: date | None = None
    project_id: int
    project_label: str | None = None
    milestone_id: int | None = None
    milestone_title: str | None = None
    is_overdue: bool = False
    deliverables: list[DesignRequestDeliverable] = []
    # Every linked deliverable is released → the task can be marked Done.
    ready_to_close: bool = False
    # A request linked to this task's project revised its requirement since review.
    requirement_changed: bool = False
    link_ids: list[int] = []
