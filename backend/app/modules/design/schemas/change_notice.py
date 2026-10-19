from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.event import DesignEventResponse


class DesignChangeNoticeDocumentPayload(BaseModel):
    document_id: int
    change_description: str | None = Field(None, max_length=4000)


class DesignChangeNoticeDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int
    change_description: str | None = None

    doc_number: str | None = None
    title: str | None = None
    document_status: str | None = None
    owner_name: str | None = None
    released_revision_label: str | None = None
    # The revision raised under this ECN, if any, and where it stands:
    # pending (none yet) | draft | in_review | in_approval | released
    ecn_revision_id: int | None = None
    ecn_revision_label: str | None = None
    implementation_status: str = "pending"


class DesignChangeNoticeBomPayload(BaseModel):
    bom_id: int
    change_description: str | None = Field(None, max_length=4000)


class DesignChangeNoticeBomResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bom_id: int
    change_description: str | None = None

    bom_number: str | None = None
    title: str | None = None
    released_revision_label: str | None = None
    ecn_revision_id: int | None = None
    ecn_revision_label: str | None = None
    implementation_status: str = "pending"


class DesignEcnAcknowledgementResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    department: str
    acknowledged_by_id: int | None = None
    acknowledged_at: datetime | None = None
    remarks: str | None = None

    acknowledged_by_name: str | None = None
    # Whether the caller may acknowledge for this department.
    can_acknowledge: bool = False


class DesignEcnAcknowledgePayload(BaseModel):
    department: str
    remarks: str | None = Field(None, max_length=4000)


class DesignEcnEffectivityPayload(BaseModel):
    """Effectivity and stock/WIP disposition — editable until release."""
    effectivity_type: str | None = None
    effectivity_date: date | None = None
    effectivity_serial: str | None = Field(None, max_length=100)
    effectivity_note: str | None = Field(None, max_length=4000)
    stock_disposition: str | None = None
    wip_disposition: str | None = None
    disposition_note: str | None = Field(None, max_length=4000)
    target_date: date | None = None


class DesignChangeNoticeCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    reason: str = "design_improvement"
    priority: str = "medium"
    description: str | None = Field(None, max_length=8000)
    impact_assessment: str | None = Field(None, max_length=8000)
    target_date: date | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    approver_id: int | None = None
    documents: list[DesignChangeNoticeDocumentPayload] = []
    boms: list[DesignChangeNoticeBomPayload] = []
    effectivity_type: str = "immediate"
    effectivity_date: date | None = None
    effectivity_serial: str | None = Field(None, max_length=100)
    effectivity_note: str | None = Field(None, max_length=4000)
    stock_disposition: str = "not_applicable"
    wip_disposition: str = "not_applicable"
    disposition_note: str | None = Field(None, max_length=4000)


class DesignChangeNoticeUpdate(BaseModel):
    """Draft-only partial update; `documents`, when sent, replaces the list."""
    title: str | None = Field(None, min_length=3, max_length=255)
    reason: str | None = None
    priority: str | None = None
    description: str | None = Field(None, max_length=8000)
    impact_assessment: str | None = Field(None, max_length=8000)
    target_date: date | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    approver_id: int | None = None
    documents: list[DesignChangeNoticeDocumentPayload] | None = None
    boms: list[DesignChangeNoticeBomPayload] | None = None
    effectivity_type: str | None = None
    effectivity_date: date | None = None
    effectivity_serial: str | None = Field(None, max_length=100)
    effectivity_note: str | None = Field(None, max_length=4000)
    stock_disposition: str | None = None
    wip_disposition: str | None = None
    disposition_note: str | None = Field(None, max_length=4000)


class DesignChangeNoticeDecisionPayload(BaseModel):
    comment: str | None = Field(None, max_length=4000)


class DesignChangeNoticeCancelPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=4000)


class DesignChangeNoticeResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ecn_number: str
    title: str
    reason: str
    priority: str
    description: str | None = None
    impact_assessment: str | None = None
    target_date: date | None = None
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    status: str
    created_by_id: int | None = None
    approver_id: int | None = None
    submitted_at: datetime | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    implemented_by_id: int | None = None
    implemented_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    ecr_id: int | None = None
    effectivity_type: str = "immediate"
    effectivity_date: date | None = None
    effectivity_serial: str | None = None
    effectivity_note: str | None = None
    stock_disposition: str = "not_applicable"
    wip_disposition: str = "not_applicable"
    disposition_note: str | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    documents: list[DesignChangeNoticeDocumentResponse] = []
    boms: list[DesignChangeNoticeBomResponse] = []
    acknowledgements: list[DesignEcnAcknowledgementResponse] = []

    created_by_name: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    implemented_by_name: str | None = None
    pm_project_label: str | None = None
    erp_project_label: str | None = None
    ecr_number: str | None = None
    document_count: int = 0
    released_count: int = 0
    acknowledged_count: int = 0


class DesignChangeNoticeDetail(DesignChangeNoticeResponse):
    events: list[DesignEventResponse] = []
    allowed_actions: list[str] = []
    # Submitted through the central approval engine (approval panel on the page).
    approval_engine: bool = False
