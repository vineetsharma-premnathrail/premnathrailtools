from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.event import DesignEventResponse


class DesignSubmissionLinePayload(BaseModel):
    revision_id: int


class DesignSubmissionLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int
    revision_id: int
    response: str
    response_comment: str | None = None

    doc_number: str | None = None
    title: str | None = None
    revision_label: str | None = None
    revision_status: str | None = None


class DesignSubmissionCommentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int | None = None
    comment: str
    assigned_to_id: int | None = None
    status: str
    resolution: str | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None

    doc_number: str | None = None
    assigned_to_name: str | None = None
    closed_by_name: str | None = None


class DesignCustomerSubmissionCreate(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = Field(None, max_length=255)
    contact_name: str | None = Field(None, max_length=255)
    contact_email: str | None = Field(None, max_length=255)
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    cover_note: str | None = Field(None, max_length=8000)
    lines: list[DesignSubmissionLinePayload] = []


class DesignCustomerSubmissionUpdate(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = Field(None, max_length=255)
    contact_name: str | None = Field(None, max_length=255)
    contact_email: str | None = Field(None, max_length=255)
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    cover_note: str | None = Field(None, max_length=8000)
    lines: list[DesignSubmissionLinePayload] | None = None


class DesignSubmissionSendPayload(BaseModel):
    sent_date: date | None = None


class DesignSubmissionLineResponsePayload(BaseModel):
    line_id: int
    response: str  # approved | approved_with_comments | rejected
    comment: str | None = Field(None, max_length=8000)


class DesignSubmissionResponsePayload(BaseModel):
    """The customer's answer — per drawing — and optional action items."""
    response_date: date
    remarks: str | None = Field(None, max_length=8000)
    lines: list[DesignSubmissionLineResponsePayload]


class DesignSubmissionCommentCreate(BaseModel):
    document_id: int | None = None
    comment: str = Field(min_length=2, max_length=8000)
    assigned_to_id: int | None = None


class DesignSubmissionCommentClosePayload(BaseModel):
    resolution: str = Field(min_length=2, max_length=8000)


class DesignSubmissionCancelPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=4000)


class DesignCustomerSubmissionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    submission_number: str
    customer_id: int | None = None
    customer_name: str
    contact_name: str | None = None
    contact_email: str | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    cover_note: str | None = None
    status: str
    sent_date: date | None = None
    response_due_date: date | None = None
    response_date: date | None = None
    response_remarks: str | None = None
    letter_file_name: str | None = None
    letter_size: int | None = None
    created_by_id: int | None = None
    cancel_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    lines: list[DesignSubmissionLineResponse] = []

    pm_project_label: str | None = None
    erp_project_label: str | None = None
    created_by_name: str | None = None
    # Days the customer has had it (sent, no response yet).
    days_waiting: int = 0
    is_overdue: bool = False
    turnaround_days: int | None = None
    open_comments: int = 0


class DesignCustomerSubmissionDetail(DesignCustomerSubmissionResponse):
    comments: list[DesignSubmissionCommentResponse] = []
    events: list[DesignEventResponse] = []
    allowed_actions: list[str] = []
