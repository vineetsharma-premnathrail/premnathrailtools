from datetime import date, datetime
from pydantic import BaseModel


class StoreMaterialReturnItemPayload(BaseModel):
    item_id: int
    quantity: float
    condition: str = "good"
    batch_number: str | None = None
    remarks: str | None = None


class StoreMaterialReturnItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    quantity: float
    condition: str
    condition_label: str | None = None
    batch_number: str | None = None
    remarks: str | None = None


class StoreMaterialReturnApprovalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rule: str
    label: str
    approver_user_ids: list[int] = []
    approver_names: list[str] = []
    status: str
    acted_by_id: int | None = None
    acted_by_name: str | None = None
    acted_at: datetime | None = None
    comment: str | None = None


class StoreMaterialReturnCreate(BaseModel):
    location_id: int
    source_type: str = "issue"
    source_issue_id: int | None = None
    source_description: str | None = None
    department_id: int | None = None
    reason: str | None = None
    return_date: date | None = None
    remarks: str | None = None
    items: list[StoreMaterialReturnItemPayload]


class StoreMaterialReturnResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    return_number: str
    location_id: int
    location_name: str | None = None
    source_type: str
    source_type_label: str | None = None
    source_issue_id: int | None = None
    source_issue_number: str | None = None
    source_description: str | None = None
    reason: str | None = None
    return_date: date
    returned_by_id: int | None = None
    returned_by_name: str | None = None
    remarks: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    status: str = "approved"
    decided_at: datetime | None = None
    rejected_reason: str | None = None
    # True when the viewer can approve/reject a pending step right now.
    can_act: bool = False
    items: list[StoreMaterialReturnItemResponse] = []
    approvals: list[StoreMaterialReturnApprovalResponse] = []
