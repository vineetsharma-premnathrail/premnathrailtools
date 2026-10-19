from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.modules.sales.schemas.order import (
    SalesOrderLinePayload, SalesOrderSchedulePayload, SalesBillingPlanPayload, SalesApprovalResponse,
)


class SalesOrderAmendmentCreate(BaseModel):
    reason: str
    customer_amendment_ref: str | None = None
    customer_amendment_date: date | None = None


class SalesOrderAmendmentUpdate(BaseModel):
    """Edits the proposal. Any of header / lines / schedule / billing_plan may
    be sent; each replaces that part of the proposed order."""
    reason: str | None = None
    customer_amendment_ref: str | None = None
    customer_amendment_date: date | None = None
    header: dict | None = None
    lines: list[SalesOrderLinePayload] | None = None
    schedule: list[SalesOrderSchedulePayload] | None = None
    billing_plan: list[SalesBillingPlanPayload] | None = None


class SalesOrderAmendmentResponse(BaseModel):
    id: int
    so_id: int
    amendment_no: int
    customer_amendment_ref: str | None = None
    customer_amendment_date: date | None = None
    reason: str
    proposed: dict
    changes: list = Field(default_factory=list)
    value_change: float | None  # None = hidden (Prices & margins)
    new_grand_total: float | None
    deviation_flags: list[str] = Field(default_factory=list)
    status: str
    required_approval_level: str | None = None
    approval_round: int
    submitted_at: datetime | None = None
    submitted_by_id: int | None = None
    approved_by_id: int | None = None
    approved_at: datetime | None = None
    rejection_reason: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    # display
    so_display: str | None = None
    submitted_by_name: str | None = None
    created_by_name: str | None = None
    next_approval_level: str | None = None
    approval_via_engine: bool = False
    approval_stage: str | None = None
    approvals: list[SalesApprovalResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}
