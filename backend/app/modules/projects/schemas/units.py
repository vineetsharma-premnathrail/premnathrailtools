"""Units (vehicles / lots) of a historic Project Management project created from a Sales Order
(projects/so_projects.py), and the "Whole project" row of every other project (one project = one
machine, no units)."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class ProjectUnitResponse(BaseModel):
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


class ProjectWholeRow(BaseModel):
    """The single 360 row of a project with no units: what every department has linked to the project itself."""
    label: str
    machine_id: int | None = None
    machine_serial: str | None = None
    lifecycle_stage: str | None = None
    lifecycle_stage_label: str | None = None
    departments: dict = Field(default_factory=dict)


class ProjectUnitsResponse(BaseModel):
    # False for a project made in Project Management (one project = one machine): see whole_project.
    has_units: bool = True
    whole_project: ProjectWholeRow | None = None
    # Historic sales-order header (None for a project without a sales order).
    sales_order_id: int | None = None
    so_number: str | None = None
    so_status: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    order_value: float | None = None
    currency: str | None = None
    vehicles_total: int = 0
    vehicles_delivered: int = 0
    lots_total: int = 0
    elements: list[ProjectUnitResponse] = Field(default_factory=list)


class ProjectUnitLookupItem(BaseModel):
    project_id: int
    project_code: str
    element_id: int | None = None
    element_no: str | None = None
    label: str | None = None
    kind: str | None = None
    client_name: str | None = None
    so_number: str | None = None
    # True: a project row with no units — pick it and the work links to the project itself.
    project_level: bool = False
    machine_id: int | None = None
    machine_serial: str | None = None
    display: str
