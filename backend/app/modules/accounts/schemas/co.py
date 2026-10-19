"""Payloads for Finance › Controlling (CO planning, activity rates,
allocation cycles, overhead). Responses are plain dicts built by the
services (report-shaped, like the other controlling reports)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class CoPlanVersionCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=150)
    financial_year: str = Field(min_length=4, max_length=10)
    version_type: Literal["original", "revised"] = "original"
    is_primary: bool = False
    notes: str | None = None
    copy_from_version_id: int | None = None
    copy_actuals_from_fy: str | None = None
    uplift_pct: float = Field(0.0, ge=-100, le=1000)


class CoPlanVersionUpdate(BaseModel):
    name: str | None = Field(None, max_length=150)
    version_type: Literal["original", "revised"] | None = None
    is_primary: bool | None = None
    notes: str | None = None


class CoPlanGridRow(BaseModel):
    cost_center_id: int
    gl_account_id: int
    amounts: dict[str, float] = {}


class CoPlanGridPayload(BaseModel):
    rows: list[CoPlanGridRow]


class CoReasonPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CoActivityRatePayload(BaseModel):
    activity_type: str
    workstation_id: int | None = None
    cost_center_id: int | None = None
    valid_from: date
    valid_to: date | None = None
    fixed_rate: float = Field(0.0, ge=0)
    variable_rate: float = Field(0.0, ge=0)
    notes: str | None = None


class CoAllocationReceiver(BaseModel):
    cost_center_id: int
    percent: float | None = None


class CoAllocationSegmentPayload(BaseModel):
    name: str | None = None
    sender_cost_center_id: int
    sender_gl_account_ids: list[int] = []
    basis: Literal["fixed_percent", "headcount", "activity_hours"] = "fixed_percent"
    activity_type: str | None = None
    receivers: list[CoAllocationReceiver]


class CoAllocationCyclePayload(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=150)
    method: Literal["distribution", "assessment"] = "distribution"
    assessment_gl_account_id: int | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    status: Literal["active", "inactive"] = "active"
    notes: str | None = None
    segments: list[CoAllocationSegmentPayload]


class CoRunPayload(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")
    test_run: bool = True


class CoCostingSheetRatePayload(BaseModel):
    branch_id: int | None = None
    valid_from: date
    valid_to: date | None = None
    material_overhead_pct: float = Field(0.0, ge=0, le=500)
    labour_overhead_pct: float = Field(0.0, ge=0, le=500)
    notes: str | None = None
