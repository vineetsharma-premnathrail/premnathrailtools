from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class DesignRevisionFileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    revision_id: int
    file_role: str
    file_name: str
    file_size: int | None = None
    mime_type: str | None = None
    uploaded_by_id: int | None = None
    created_at: datetime | None = None

    uploaded_by_name: str | None = None


class DesignRevisionCreate(BaseModel):
    """Starts the next revision of a released document."""
    change_summary: str = Field(min_length=3, max_length=4000)
    reviewer_id: int | None = None
    approver_id: int | None = None
    ecn_id: int | None = None


class DesignRevisionUpdate(BaseModel):
    """Draft-only edits. Send `ecn_id: null` explicitly to unlink an ECN."""
    change_summary: str | None = Field(None, max_length=4000)
    reviewer_id: int | None = None
    approver_id: int | None = None
    ecn_id: int | None = None


class DesignRevisionSubmitPayload(BaseModel):
    """Optional last-minute checker/approver override at submission."""
    reviewer_id: int | None = None
    approver_id: int | None = None
    comment: str | None = Field(None, max_length=4000)


class DesignRevisionDecisionPayload(BaseModel):
    """Checker (review) or approver (approve) decision. `return` sends the
    revision back to its author as a draft and needs a comment."""
    decision: Literal["pass", "return"]
    comment: str | None = Field(None, max_length=4000)


class DesignRevisionRecallPayload(BaseModel):
    comment: str | None = Field(None, max_length=4000)


class DesignDocumentRevisionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int
    revision_index: int
    revision_label: str
    status: str
    change_summary: str | None = None
    ecn_id: int | None = None
    created_by_id: int | None = None
    reviewer_id: int | None = None
    approver_id: int | None = None
    submitted_at: datetime | None = None
    reviewed_by_id: int | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    approval_comment: str | None = None
    released_at: datetime | None = None
    superseded_at: datetime | None = None
    returned_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    files: list[DesignRevisionFileResponse] = []

    created_by_name: str | None = None
    reviewer_name: str | None = None
    approver_name: str | None = None
    reviewed_by_name: str | None = None
    approved_by_name: str | None = None
    ecn_number: str | None = None
