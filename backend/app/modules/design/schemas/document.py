from datetime import datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.event import DesignEventResponse
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
    # obsolete | draft | in_review | in_approval | released | revising
    display_status: str = "draft"
    released_revision_id: int | None = None
    released_revision_label: str | None = None
    released_at: datetime | None = None
    open_revision_id: int | None = None
    open_revision_label: str | None = None
    open_revision_status: str | None = None
    pending_with_name: str | None = None


class DesignDocumentDetail(DesignDocumentResponse):
    revisions: list[DesignDocumentRevisionResponse] = []
    events: list[DesignEventResponse] = []
    # Approved, not-yet-implemented ECNs that list this document — the ones
    # its next revision can be raised under.
    open_ecns: list[DesignDocumentEcnRef] = []
    allowed_actions: list[str] = []
