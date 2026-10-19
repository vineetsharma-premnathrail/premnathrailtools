from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

from app.modules.design.schemas.document import DesignWhereUsedRow
from app.modules.design.schemas.event import DesignEventResponse
from app.modules.design.schemas.library import DesignChecklistAnswer, DesignChecklistResponse, DesignReviewResultResponse


class DesignBomLinePayload(BaseModel):
    position: int | None = None
    store_item_id: int | None = None
    new_item_name: str | None = Field(None, max_length=255)
    new_item_spec: str | None = Field(None, max_length=4000)
    quantity: float = Field(gt=0)
    uom: str | None = Field(None, max_length=20)
    document_id: int | None = None
    make_buy: str = "buy"
    remarks: str | None = Field(None, max_length=4000)


class DesignBomLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    position: int
    store_item_id: int | None = None
    new_item_name: str | None = None
    new_item_spec: str | None = None
    new_item_requested_at: datetime | None = None
    quantity: float
    uom: str | None = None
    document_id: int | None = None
    document_revision_label: str | None = None
    make_buy: str
    remarks: str | None = None

    item_code: str | None = None
    item_name: str | None = None
    item_status: str | None = None
    doc_number: str | None = None
    # Drawing's released revision right now (live, not the release snapshot).
    current_drawing_revision: str | None = None
    drawing_status: str | None = None
    approved_makes: list[str] = []
    # The item has its own released BOM → it's a sub-assembly.
    sub_bom_id: int | None = None
    sub_bom_number: str | None = None
    # Why this line would block release, if it would.
    release_blocker: str | None = None


class DesignBomCreate(BaseModel):
    """Creates the BOM and its R0 draft with the given lines."""
    product_item_id: int
    title: str = Field(min_length=2, max_length=255)
    description: str | None = Field(None, max_length=4000)
    document_id: int | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    design_request_id: int | None = None
    owner_id: int | None = None
    reviewer_id: int | None = None
    approver_id: int | None = None
    lines: list[DesignBomLinePayload] = []
    copy_from_bom_id: int | None = None


class DesignBomUpdate(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = Field(None, max_length=4000)
    document_id: int | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    design_request_id: int | None = None
    owner_id: int | None = None


class DesignBomRevisionUpdate(BaseModel):
    change_summary: str | None = Field(None, max_length=4000)
    reviewer_id: int | None = None
    approver_id: int | None = None
    ecn_id: int | None = None
    lines: list[DesignBomLinePayload] | None = None


class DesignBomRevisionCreate(BaseModel):
    change_summary: str = Field(min_length=3, max_length=4000)
    reviewer_id: int | None = None
    approver_id: int | None = None
    ecn_id: int | None = None


class DesignBomSubmitPayload(BaseModel):
    reviewer_id: int | None = None
    approver_id: int | None = None
    comment: str | None = Field(None, max_length=4000)


class DesignBomDecisionPayload(BaseModel):
    decision: Literal["pass", "return"]
    comment: str | None = Field(None, max_length=4000)
    checklist: list[DesignChecklistAnswer] = []


class DesignBomObsoletePayload(BaseModel):
    reason: str = Field(min_length=3, max_length=4000)


class DesignBomRevisionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bom_id: int
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
    lines: list[DesignBomLineResponse] = []
    review_results: list[DesignReviewResultResponse] = []

    created_by_name: str | None = None
    reviewer_name: str | None = None
    approver_name: str | None = None
    reviewed_by_name: str | None = None
    approved_by_name: str | None = None
    ecn_number: str | None = None
    line_count: int = 0


class DesignBomResponse(BaseModel):
    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version

    id: int
    bom_number: str
    product_item_id: int
    title: str
    description: str | None = None
    document_id: int | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    design_request_id: int | None = None
    owner_id: int | None = None
    created_by_id: int | None = None
    status: str
    obsoleted_at: datetime | None = None
    obsolete_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    product_item_code: str | None = None
    product_item_name: str | None = None
    doc_number: str | None = None
    pm_project_label: str | None = None
    erp_project_label: str | None = None
    # Order Project chip (OrderProjectChip): OP number, element no / label.
    order_project_number: str | None = None
    order_project_element_no: str | None = None
    order_project_element_label: str | None = None
    order_project_display: str | None = None
    request_number: str | None = None
    owner_name: str | None = None
    # draft | in_review | in_approval | released | revising | obsolete
    display_status: str = "draft"
    released_revision_id: int | None = None
    released_revision_label: str | None = None
    released_at: datetime | None = None
    open_revision_id: int | None = None
    open_revision_label: str | None = None
    open_revision_status: str | None = None
    pending_with_name: str | None = None
    line_count: int = 0


class DesignBomDetail(DesignBomResponse):
    revisions: list[DesignBomRevisionResponse] = []
    events: list[DesignEventResponse] = []
    open_ecns: list[dict] = []
    allowed_actions: list[str] = []
    checklist: DesignChecklistResponse | None = None
    where_used: list[DesignWhereUsedRow] = []
    viewer_only: bool = False
    # The open revision was submitted through the central approval engine —
    # the page shows the approval panel (Organization › Approval Workflows).
    approval_engine: bool = False


class DesignBomExplosionRow(BaseModel):
    """One row of the multi-level explosion of the released BOM."""
    level: int
    path: str
    store_item_id: int | None = None
    item_code: str | None = None
    item_name: str | None = None
    quantity: float
    total_quantity: float
    uom: str | None = None
    make_buy: str
    doc_number: str | None = None
    drawing_revision: str | None = None
    bom_id: int | None = None
    bom_number: str | None = None
    new_item_name: str | None = None


class DesignNewItemRequest(BaseModel):
    """A BOM line still waiting for Store to create its item code."""
    line_id: int
    bom_id: int
    bom_number: str
    revision_label: str
    new_item_name: str
    new_item_spec: str | None = None
    uom: str | None = None
    requested_at: datetime | None = None
    requested_by_name: str | None = None
