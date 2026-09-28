from datetime import datetime
from pydantic import BaseModel


class PmApprovalCreate(BaseModel):
    approval_type: str
    reference_id: int | None = None
    approver_id: int | None = None
    comments: str | None = None


class PmApprovalUpdate(BaseModel):
    status: str | None = None
    comments: str | None = None


class PmApprovalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    approval_type: str
    reference_id: int | None = None
    requested_by_id: int | None = None
    approver_id: int | None = None
    status: str
    comments: str | None = None
    requested_at: datetime | None = None
    decided_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    requested_by_name: str | None = None
    approver_name: str | None = None
