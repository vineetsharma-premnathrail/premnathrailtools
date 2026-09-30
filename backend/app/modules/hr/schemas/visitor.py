from datetime import datetime

from pydantic import BaseModel, Field


class HrVisitorCreate(BaseModel):
    visitor_name: str = Field(..., min_length=1, max_length=150)
    visitor_company: str | None = Field(None, max_length=200)
    visitor_phone: str | None = Field(None, max_length=30)
    visitor_email: str | None = Field(None, max_length=255)
    id_proof_type: str | None = Field(None, max_length=50)
    # Only the last 4 characters are ever stored; longer input is trimmed.
    id_proof_last4: str | None = Field(None, max_length=40)
    purpose: str | None = None
    # Ignored for non-HR users: they can only pre-register their own visitors.
    host_user_id: int | None = None
    branch_id: int | None = None
    expected_at: datetime | None = None
    vehicle_no: str | None = Field(None, max_length=50)
    items_carried: str | None = None
    number_of_persons: int = Field(1, ge=1, le=100)
    remarks: str | None = None
    # Reception only: register a walk-in and check them in straight away.
    check_in_now: bool = False
    badge_no: str | None = Field(None, max_length=50)


class HrVisitorUpdate(BaseModel):
    visitor_name: str | None = Field(None, min_length=1, max_length=150)
    visitor_company: str | None = Field(None, max_length=200)
    visitor_phone: str | None = Field(None, max_length=30)
    visitor_email: str | None = Field(None, max_length=255)
    id_proof_type: str | None = Field(None, max_length=50)
    id_proof_last4: str | None = Field(None, max_length=40)
    purpose: str | None = None
    host_user_id: int | None = None
    branch_id: int | None = None
    expected_at: datetime | None = None
    vehicle_no: str | None = Field(None, max_length=50)
    items_carried: str | None = None
    number_of_persons: int | None = Field(None, ge=1, le=100)
    remarks: str | None = None
    badge_no: str | None = Field(None, max_length=50)


class HrVisitorCheckInPayload(BaseModel):
    badge_no: str | None = Field(None, max_length=50)
    check_in_at: datetime | None = None
    id_proof_type: str | None = Field(None, max_length=50)
    id_proof_last4: str | None = Field(None, max_length=40)
    vehicle_no: str | None = Field(None, max_length=50)
    items_carried: str | None = None


class HrVisitorCheckOutPayload(BaseModel):
    check_out_at: datetime | None = None
    remarks: str | None = None


class HrVisitorCancelPayload(BaseModel):
    remarks: str | None = None


class HrVisitorResponse(BaseModel):
    id: int
    visit_no: str
    visitor_name: str
    visitor_company: str | None = None
    visitor_phone: str | None = None
    visitor_email: str | None = None
    id_proof_type: str | None = None
    id_proof_last4: str | None = None
    purpose: str | None = None
    host_user_id: int
    branch_id: int | None = None
    expected_at: datetime | None = None
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    badge_no: str | None = None
    vehicle_no: str | None = None
    items_carried: str | None = None
    number_of_persons: int
    status: str
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    host_name: str | None = None
    host_department: str | None = None
    branch_name: str | None = None
    created_by_name: str | None = None


class HrVisitorBoardResponse(BaseModel):
    date: str
    expected: list[HrVisitorResponse]
    inside: list[HrVisitorResponse]
    checked_out: list[HrVisitorResponse]
