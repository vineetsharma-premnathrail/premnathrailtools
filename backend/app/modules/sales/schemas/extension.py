from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class SalesDeliveryExtensionCreate(BaseModel):
    schedule_ids: list[int]
    requested_new_date: date
    reason_category: str
    reason: str
    customer_letter_ref: str | None = None
    customer_letter_date: date | None = None


class SalesDeliveryExtensionGrantPayload(BaseModel):
    granted_new_date: date
    with_ld: bool
    token_penalty_amount: float | None = None
    customer_letter_ref: str
    customer_letter_date: date | None = None
    remarks: str | None = None


class SalesDeliveryExtensionRefusePayload(BaseModel):
    reason: str = ""


class SalesDeliveryExtensionResponse(BaseModel):
    id: int
    so_id: int
    schedule_ids: list[int] = Field(default_factory=list)
    requested_on: date
    requested_new_date: date
    reason_category: str
    reason: str
    customer_letter_ref: str | None = None
    customer_letter_date: date | None = None
    granted_new_date: date | None = None
    with_ld: bool | None = None
    token_penalty_amount: float | None = None
    status: str
    decision_remarks: str | None = None
    decided_at: datetime | None = None
    decided_by_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    # display
    so_display: str | None = None
    customer_name: str | None = None
    vehicles: list[str] = Field(default_factory=list)
    created_by_name: str | None = None
    decided_by_name: str | None = None
    status_label: str | None = None  # "Closed (order ended)" for requests auto-closed when the order ended

    model_config = {"from_attributes": True}
