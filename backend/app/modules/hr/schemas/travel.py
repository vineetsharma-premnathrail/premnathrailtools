from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class HrTravelRequestCreate(BaseModel):
    purpose: str = Field(..., min_length=1)
    from_city: str = Field(..., min_length=1, max_length=100)
    to_city: str = Field(..., min_length=1, max_length=100)
    depart_date: date
    return_date: date | None = None
    travel_mode: str
    accommodation_required: bool = False
    advance_required: Decimal = Field(Decimal("0"), ge=0)
    estimated_cost: Decimal | None = Field(None, ge=0)
    project_reference: str | None = Field(None, max_length=200)


class HrTravelRequestUpdate(BaseModel):
    purpose: str | None = Field(None, min_length=1)
    from_city: str | None = Field(None, min_length=1, max_length=100)
    to_city: str | None = Field(None, min_length=1, max_length=100)
    depart_date: date | None = None
    return_date: date | None = None
    travel_mode: str | None = None
    accommodation_required: bool | None = None
    advance_required: Decimal | None = Field(None, ge=0)
    estimated_cost: Decimal | None = Field(None, ge=0)
    project_reference: str | None = Field(None, max_length=200)


class HrTravelRequestDecisionPayload(BaseModel):
    remarks: str | None = None


class HrTravelRequestResponse(BaseModel):
    id: int
    request_no: str
    user_id: int
    purpose: str
    from_city: str
    to_city: str
    depart_date: date
    return_date: date | None = None
    travel_mode: str
    accommodation_required: bool
    advance_required: Decimal
    estimated_cost: Decimal | None = None
    project_reference: str | None = None
    status: str
    approver_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    user_name: str | None = None
    user_email: str | None = None
    user_department: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    # What the signed-in viewer may do with this request.
    can_decide: bool = False
    can_cancel: bool = False
    can_edit: bool = False
