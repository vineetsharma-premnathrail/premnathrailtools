from datetime import datetime
from pydantic import BaseModel, Field

from app.modules.design.schemas.document import DesignWhereUsedRow
from app.modules.design.schemas.event import DesignEventResponse


class DesignChangeRequestItemPayload(BaseModel):
    document_id: int | None = None
    bom_id: int | None = None
    note: str | None = Field(None, max_length=4000)


class DesignChangeRequestItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int | None = None
    bom_id: int | None = None
    note: str | None = None

    number: str | None = None
    title: str | None = None
    released_revision_label: str | None = None
    where_used: list[DesignWhereUsedRow] = []


class DesignEcrVoteResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int
    vote: str
    comment: str | None = None
    updated_at: datetime | None = None

    user_name: str | None = None


class DesignChangeRequestCreate(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    source: str = "design"
    quality_ncr_id: int | None = None
    quality_capa_id: int | None = None
    source_reference: str | None = Field(None, max_length=255)
    urgency: str = "normal"
    reason: str = Field(min_length=3, max_length=8000)
    proposed_change: str = Field(min_length=3, max_length=8000)
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    items: list[DesignChangeRequestItemPayload] = []


class DesignChangeRequestUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=255)
    source: str | None = None
    quality_ncr_id: int | None = None
    quality_capa_id: int | None = None
    source_reference: str | None = Field(None, max_length=255)
    urgency: str | None = None
    reason: str | None = Field(None, min_length=3, max_length=8000)
    proposed_change: str | None = Field(None, min_length=3, max_length=8000)
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    items: list[DesignChangeRequestItemPayload] | None = None


class DesignEcrImpactPayload(BaseModel):
    impact_summary: str = Field(min_length=3, max_length=8000)
    impact_stock: str | None = Field(None, max_length=8000)
    impact_open_orders: str | None = Field(None, max_length=8000)
    impact_cost: float | None = None
    impact_delivery_days: int | None = None
    # Board members to vote; defaults to the Settings change board.
    board_member_ids: list[int] | None = None


class DesignEcrVotePayload(BaseModel):
    vote: str  # approve | reject | defer
    comment: str | None = Field(None, max_length=4000)


class DesignEcrDecisionPayload(BaseModel):
    decision: str  # approved | rejected | deferred
    comment: str | None = Field(None, max_length=4000)


class DesignEcrToEcnPayload(BaseModel):
    """Creates the ECN from an approved ECR."""
    target_date: str | None = None
    effectivity_type: str = "immediate"
    effectivity_date: str | None = None
    effectivity_serial: str | None = Field(None, max_length=100)
    effectivity_note: str | None = Field(None, max_length=4000)
    stock_disposition: str = "not_applicable"
    wip_disposition: str = "not_applicable"
    disposition_note: str | None = Field(None, max_length=4000)


class DesignChangeRequestResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ecr_number: str
    title: str
    source: str
    quality_ncr_id: int | None = None
    quality_capa_id: int | None = None
    source_reference: str | None = None
    urgency: str
    reason: str
    proposed_change: str
    pm_project_id: int | None = None
    erp_project_id: int | None = None
    impact_summary: str | None = None
    impact_stock: str | None = None
    impact_open_orders: str | None = None
    impact_cost: float | None = None
    impact_delivery_days: int | None = None
    impact_checked_by_id: int | None = None
    impact_checked_at: datetime | None = None
    status: str
    board_member_ids: list[int] | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    raised_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[DesignChangeRequestItemResponse] = []

    raised_by_name: str | None = None
    impact_checked_by_name: str | None = None
    decided_by_name: str | None = None
    ncr_number: str | None = None
    capa_number: str | None = None
    pm_project_label: str | None = None
    erp_project_label: str | None = None
    ecn_id: int | None = None
    ecn_number: str | None = None
    votes_cast: int = 0
    votes_needed: int = 0
    days_open: int = 0


class DesignChangeRequestDetail(DesignChangeRequestResponse):
    votes: list[DesignEcrVoteResponse] = []
    board_members: list[dict] = []
    events: list[DesignEventResponse] = []
    allowed_actions: list[str] = []
