"""Order Projects (sales/order_projects.py)."""
from datetime import date, datetime

from pydantic import BaseModel, Field


class OrderProjectElementResponse(BaseModel):
    id: int
    element_no: str
    kind: str
    label: str
    sales_order_line_id: int
    sales_schedule_id: int | None = None
    quantity: float
    contractual_date: date | None = None
    status: str

    model_config = {"from_attributes": True}

    line_number: int | None = None
    line_type: str | None = None
    line_description: str | None = None
    rrv_model: str | None = None
    uom: str | None = None
    current_delivery_date: date | None = None
    # {design|purchase|store|production|quality|dispatch|delivery: cell | None} — None = not linked yet.
    departments: dict = Field(default_factory=dict)


class OrderProjectUpdate(BaseModel):
    project_manager_id: int | None = None
    status: str | None = None  # active / on_hold only
    planned_start: date | None = None
    planned_end: date | None = None


class OrderProjectResponse(BaseModel):
    id: int
    op_number: str
    sales_order_id: int
    customer_id: int | None = None
    customer_name: str | None = None
    title: str
    project_manager_id: int | None = None
    status: str
    planned_start: date | None = None
    planned_end: date | None = None
    branch_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    so_number: str | None = None
    so_status: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    order_value: float | None = None
    currency: str | None = None
    project_manager_name: str | None = None
    created_by_name: str | None = None
    branch_name: str | None = None
    vehicles_total: int = 0
    vehicles_delivered: int = 0
    lots_total: int = 0
    elements: list[OrderProjectElementResponse] = Field(default_factory=list)
    can: dict = Field(default_factory=dict)


class OrderProjectLookupItem(BaseModel):
    project_id: int
    op_number: str
    element_id: int | None = None
    element_no: str | None = None
    label: str | None = None
    kind: str | None = None
    customer_name: str | None = None
    so_number: str | None = None
    display: str
