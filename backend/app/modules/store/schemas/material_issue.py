from datetime import date
from pydantic import BaseModel


class StoreMaterialIssueItemPayload(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None


class StoreMaterialIssueItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_id: int
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None


class StoreMaterialIssueCreate(BaseModel):
    location_id: int
    requested_by_id: int | None = None
    department_id: int | None = None
    project_or_work_order: str | None = None
    issue_date: date | None = None
    remarks: str | None = None
    items: list[StoreMaterialIssueItemPayload]


class StoreMaterialIssueResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    issue_number: str
    location_id: int
    location_name: str | None = None
    requested_by_id: int | None = None
    requested_by_name: str | None = None
    department_id: int | None = None
    department_name: str | None = None
    project_or_work_order: str | None = None
    issue_date: date
    issued_by_id: int | None = None
    issued_by_name: str | None = None
    remarks: str | None = None
    items: list[StoreMaterialIssueItemResponse] = []
