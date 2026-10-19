from datetime import date
from pydantic import BaseModel


class StoreMaterialIssueItemPayload(BaseModel):
    item_id: int
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None
    # Dispatch: the Sales Order delivery row (vehicle / lot) this line ships (sales/delivery.py).
    sales_schedule_id: int | None = None
    # WM: the bin it is picked from; serialised item: one serial per unit.
    bin_id: int | None = None
    serials: list[str] = []
    # Order Project element of this line (defaults to the issue's; a dispatch
    # line takes its delivery row's element).
    order_project_element_id: int | None = None


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
    bin_id: int | None = None
    bin_code: str | None = None
    serial_numbers: list[str] | None = None
    order_project_element_id: int | None = None
    element_display: str | None = None


class StoreMaterialIssueCreate(BaseModel):
    location_id: int
    requested_by_id: int | None = None
    department_id: int | None = None
    project_or_work_order: str | None = None
    issue_type: str | None = None
    challan_number: str | None = None
    vendor_name: str | None = None
    expected_return_date: date | None = None
    issue_date: date | None = None
    remarks: str | None = None
    # Dispatch to customer: the ERP machine / order it goes against (rule 8).
    erp_project_id: int | None = None
    # Service: the service request the spares are sent for (erp/spares.py).
    service_request_id: int | None = None
    # Dispatch against a Sales Order (VL01N/PGI): its delivery rows are picked per item.
    sales_order_id: int | None = None
    # Per-type fields — which apply is decided by the issue type
    # (store/issue_forms.py); vendor_name above is ignored (vendor_id wins).
    vendor_id: int | None = None
    maintenance_work_order_id: int | None = None
    asset_id: int | None = None
    ncr_id: int | None = None
    inspection_lot_id: int | None = None
    customer_id: int | None = None
    process: str | None = None
    output_item_id: int | None = None
    purpose: str | None = None
    returnable: bool | None = None
    destructive: bool | None = None
    site_address: str | None = None
    vehicle_number: str | None = None
    transporter: str | None = None
    lr_number: str | None = None
    scrap_buyer: str | None = None
    # Order Project (production / rework / project / dispatch issues): the
    # vehicle / lot the material goes to — mandatory for an RRV order.
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    # Store Manager issuing stock held for another element: why (mandatory then).
    project_stock_override_reason: str | None = None
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
    issue_type: str | None = None
    issue_type_label: str | None = None
    challan_number: str | None = None
    vendor_name: str | None = None
    expected_return_date: date | None = None
    erp_project_id: int | None = None
    erp_project_label: str | None = None
    service_request_id: int | None = None
    vendor_id: int | None = None
    maintenance_work_order_id: int | None = None
    asset_id: int | None = None
    ncr_id: int | None = None
    inspection_lot_id: int | None = None
    customer_id: int | None = None
    process: str | None = None
    output_item_id: int | None = None
    purpose: str | None = None
    returnable: bool | None = None
    destructive: bool | None = None
    site_address: str | None = None
    vehicle_number: str | None = None
    transporter: str | None = None
    lr_number: str | None = None
    scrap_buyer: str | None = None
    order_project_id: int | None = None
    order_project_element_id: int | None = None
    op_number: str | None = None
    element_no: str | None = None
    element_label: str | None = None
    project_stock_override_reason: str | None = None
    # Display text for the "against" links, filled in by the route.
    against_label: str | None = None
    issue_date: date
    issued_by_id: int | None = None
    issued_by_name: str | None = None
    remarks: str | None = None
    # Set when the issue fulfils a Purchase Requisition line.
    p2p_request_id: int | None = None
    p2p_number: str | None = None
    items: list[StoreMaterialIssueItemResponse] = []
