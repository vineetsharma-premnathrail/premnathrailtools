from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.event import DesignEventResponse
from app.modules.design.schemas.library import DesignChecklistResponse
from app.modules.design.schemas.revision import DesignDocumentRevisionResponse


class DesignDocumentCreate(BaseModel):
    """Creates the document and its R0 draft. Files are uploaded afterwards
    to POST /design/revisions/{revision_id}/files."""
    title: str = Field(min_length=2, max_length=255)
    description: str | None = Field(None, max_length=4000)
    document_type: str
    discipline: str = "mechanical"
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    store_item_id: int | None = None
    department_id: int | None = None
    owner_id: int | None = None
    reviewer_id: int | None = None
    approver_id: int | None = None
    change_summary: str | None = Field(None, max_length=4000)
    customer_id: int | None = None
    customer_approval_required: bool = False
    standard_id: int | None = None
    design_request_id: int | None = None
    legacy_number: str | None = Field(None, max_length=100)


class DesignDocumentUpdate(BaseModel):
    """Partial update of the document's identity/associations. Only fields
    actually sent are applied, so `null` clears a link."""
    title: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = Field(None, max_length=4000)
    discipline: str | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    store_item_id: int | None = None
    department_id: int | None = None
    owner_id: int | None = None
    customer_id: int | None = None
    customer_approval_required: bool | None = None
    standard_id: int | None = None
    design_request_id: int | None = None
    legacy_number: str | None = Field(None, max_length=100)


class DesignDocumentObsoletePayload(BaseModel):
    reason: str = Field(min_length=3, max_length=4000)


class DesignDocumentEcnRef(BaseModel):
    id: int
    ecn_number: str
    title: str
    status: str


class DesignDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    doc_number: str
    title: str
    description: str | None = None
    document_type: str
    discipline: str
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    store_item_id: int | None = None
    department_id: int | None = None
    customer_id: int | None = None
    customer_approval_required: bool = False
    standard_id: int | None = None
    design_request_id: int | None = None
    legacy_number: str | None = None
    owner_id: int | None = None
    created_by_id: int | None = None
    status: str
    obsoleted_at: datetime | None = None
    obsoleted_by_id: int | None = None
    obsolete_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    owner_name: str | None = None
    created_by_name: str | None = None
    obsoleted_by_name: str | None = None
    pm_project_label: str | None = None
    erp_project_label: str | None = None
    store_item_label: str | None = None
    department_name: str | None = None
    customer_name: str | None = None
    standard_label: str | None = None
    request_number: str | None = None
    # obsolete | draft | in_review | in_approval | approved | released |
    # revising | customer_rejected
    display_status: str = "draft"
    released_revision_id: int | None = None
    released_revision_label: str | None = None
    released_at: datetime | None = None
    open_revision_id: int | None = None
    open_revision_label: str | None = None
    open_revision_status: str | None = None
    pending_with_name: str | None = None


class DesignDocumentSubmissionRef(BaseModel):
    """This document on a customer submission."""
    submission_id: int
    submission_number: str
    status: str
    revision_id: int
    revision_label: str | None = None
    response: str
    response_comment: str | None = None
    sent_date: date | None = None
    response_date: date | None = None


class DesignWhereUsedRow(BaseModel):
    """One BOM (and its project) that uses an item or drawing."""
    bom_id: int
    bom_number: str
    bom_title: str
    revision_id: int
    revision_label: str
    revision_status: str
    quantity: float | None = None
    product_item_label: str | None = None
    pm_project_label: str | None = None
    erp_project_label: str | None = None


class DesignDocumentDetail(DesignDocumentResponse):
    revisions: list[DesignDocumentRevisionResponse] = []
    events: list[DesignEventResponse] = []
    # Approved, not-yet-implemented ECNs that list this document — the ones
    # its next revision can be raised under.
    open_ecns: list[DesignDocumentEcnRef] = []
    allowed_actions: list[str] = []
    # Checklist the checker of the open revision must answer, if any.
    checklist: DesignChecklistResponse | None = None
    submissions: list[DesignDocumentSubmissionRef] = []
    where_used: list[DesignWhereUsedRow] = []
    # True when the viewer isn't on the Design team — only released and
    # superseded revisions are shown to them.
    viewer_only: bool = False
    # The open revision was submitted through the central approval engine —
    # the page shows the approval panel (Organization › Approval Workflows).
    approval_engine: bool = False
