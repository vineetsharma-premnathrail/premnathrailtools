from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class SalesOrderAttachmentResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    doc_type: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_url: str | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class SalesOrderLinePayload(BaseModel):
    id: int | None = None
    line_number: int | None = None
    line_type: str = "rrv"
    crm_product_id: int | None = None
    product_id: int | None = None
    product_item_id: int | None = None
    rrv_model: str | None = None
    description: str
    specification: str | None = None
    customer_line_ref: str | None = None
    hsn_sac_code: str | None = None
    uom: str = "NOS"
    price_override_reason: str | None = None
    quantity: float = 1
    unit_price: float = 0
    discount_percent: float = 0
    gst_rate: float = 18


class SalesOrderLineResponse(BaseModel):
    id: int
    line_number: int
    line_type: str
    crm_product_id: int | None = None
    product_item_id: int | None = None
    rrv_model: str | None = None
    description: str
    specification: str | None = None
    customer_line_ref: str | None = None
    hsn_sac_code: str | None = None
    uom: str
    quantity: float
    # Amounts are None when hidden (Sales › Sales Orders › Prices & margins).
    unit_price: float | None
    discount_percent: float
    discount_amount: float | None
    taxable_amount: float | None
    gst_rate: float
    gst_amount: float | None
    line_total: float | None
    qty_scheduled: float
    qty_dispatched: float
    qty_delivered: float
    qty_invoiced: float
    qty_cancelled: float
    product_id: int | None = None
    list_price: float | None = None
    price_condition_id: int | None = None
    price_override_reason: str | None = None

    model_config = {"from_attributes": True}


class SalesOrderSchedulePayload(BaseModel):
    id: int | None = None
    line_number: int
    quantity: float = 1
    consignee_name: str | None = None
    consignee_address: str | None = None
    consignee_gstin: str | None = None
    consignee_state_code: str | None = None
    consignee_contact_name: str | None = None
    consignee_contact_phone: str | None = None
    # A ship-to / consignee address of the customer (CRM › Organization › Addresses):
    # blank consignee fields are filled from it.
    ship_to_address_id: int | None = None
    contract_delivery_date: date | None = None
    committed_date: date | None = None


class SalesOrderScheduleUpdate(BaseModel):
    """Changes allowed after confirmation without an amendment (plan §5.1)."""
    consignee_contact_name: str | None = None
    consignee_contact_phone: str | None = None
    committed_date: date | None = None


class SalesOrderScheduleLinkPayload(BaseModel):
    build_id: int


class SalesOrderScheduleResponse(BaseModel):
    id: int
    so_id: int
    so_line_id: int
    sequence: int
    quantity: float
    consignee_name: str | None = None
    consignee_address: str | None = None
    consignee_gstin: str | None = None
    consignee_state_code: str | None = None
    consignee_contact_name: str | None = None
    consignee_contact_phone: str | None = None
    ship_to_address_id: int | None = None
    contract_delivery_date: date | None = None
    current_delivery_date: date | None = None
    committed_date: date | None = None
    rrv_build_id: int | None = None
    erp_project_id: int | None = None
    status: str
    dispatched_on: date | None = None
    delivered_on: date | None = None
    commissioned_on: date | None = None
    qty_dispatched: float = 0
    qty_delivered: float = 0
    dispatch_reference: str | None = None
    delivery_reference: str | None = None
    commissioning_reference: str | None = None
    ld_weeks: int | None = None
    ld_amount: float | None = None
    ld_waived: bool = False
    risk_flag: str | None = None
    warranty_start: date | None = None
    warranty_end: date | None = None

    # display
    line_number: int | None = None
    line_description: str | None = None
    rrv_model: str | None = None
    unit_value: float | None = None
    build_number: str | None = None
    build_status: str | None = None
    build_stage: str | None = None
    # The Order Project vehicle / lot this row is (PEW-80/01) and its project (PEW-80).
    project_number: str | None = None
    project_element_no: str | None = None
    ld_forecast_periods: int | None = None
    ld_forecast_amount: float | None = None
    risk: str | None = None
    so_number: str | None = None
    so_display: str | None = None
    customer_name: str | None = None

    model_config = {"from_attributes": True}


class SalesBillingPlanPayload(BaseModel):
    id: int | None = None
    milestone_type: str
    description: str | None = None
    percent: float
    per_unit: bool = False
    due_days: int | None = None
    recovers_advance_percent: float | None = None


class SalesBillingPlanResponse(BaseModel):
    id: int
    sequence: int
    milestone_type: str
    description: str | None = None
    percent: float
    amount: float | None  # None = hidden (Prices & margins)
    per_unit: bool
    due_days: int | None = None
    recovers_advance_percent: float | None = None
    status: str
    invoiced_amount: float | None
    triggered_at: datetime | None = None
    invoice_requested_at: datetime | None = None

    model_config = {"from_attributes": True}


class SalesOrderHeaderFields(BaseModel):
    order_type: str | None = None
    customer_contact_id: int | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    customer_po_received_date: date | None = None
    loa_number: str | None = None
    loa_date: date | None = None
    contract_reference: str | None = None
    purchaser_name: str | None = None
    paying_authority: str | None = None
    billing_address: str | None = None
    customer_gstin: str | None = None
    place_of_supply_state_code: str | None = None
    currency: str | None = None
    price_basis: str | None = None
    freight_terms: str | None = None
    insurance_terms: str | None = None
    payment_terms_label: str | None = None
    inspection_agency: str | None = None
    third_party_inspection_required: bool | None = None
    ld_applicable: bool | None = None
    ld_rate_percent: float | None = None
    ld_rate_period: str | None = None
    ld_basis: str | None = None
    ld_max_percent: float | None = None
    warranty_months_from_delivery: int | None = None
    warranty_months_from_commissioning: int | None = None
    warranty_rule: str | None = None
    warranty_terms_text: str | None = None
    pbg_required: bool | None = None
    pbg_percent: float | None = None
    pbg_due_days: int | None = None
    delivery_terms_text: str | None = None
    special_conditions: str | None = None
    remarks: str | None = None
    sales_owner_id: int | None = None
    branch_id: int | None = None


class SalesOrderCreate(SalesOrderHeaderFields):
    customer_id: int
    source_type: str = "direct"
    source_inquiry_id: int | None = None
    source_tender_id: int | None = None
    source_quotation_id: int | None = None
    lines: list[SalesOrderLinePayload] = Field(default_factory=list)
    schedule: list[SalesOrderSchedulePayload] | None = None
    billing_plan: list[SalesBillingPlanPayload] = Field(default_factory=list)


class SalesOrderUpdate(SalesOrderHeaderFields):
    customer_id: int | None = None


class SalesOrderReasonPayload(BaseModel):
    reason: str = ""


class SalesOrderApprovePayload(BaseModel):
    comment: str | None = None


class SalesApprovalResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    revision: int
    level: str
    approver_id: int
    decision: str
    comment: str | None = None
    stand_in: bool
    decided_at: datetime
    approver_name: str | None = None

    model_config = {"from_attributes": True}


class SalesOrderResponse(BaseModel):
    id: int
    so_number: str | None = None
    display_number: str
    status: str
    order_type: str
    customer_id: int
    customer_contact_id: int | None = None
    source_type: str
    source_inquiry_id: int | None = None
    source_tender_id: int | None = None
    source_quotation_id: int | None = None
    source_quotation_number: str | None = None
    customer_po_number: str | None = None
    customer_po_date: date | None = None
    customer_po_received_date: date | None = None
    loa_number: str | None = None
    loa_date: date | None = None
    contract_reference: str | None = None
    purchaser_name: str | None = None
    paying_authority: str | None = None
    customer_name: str | None = None
    billing_address: str | None = None
    customer_gstin: str | None = None
    place_of_supply_state_code: str | None = None
    customer_state: str | None = None
    currency: str
    price_basis: str
    freight_terms: str | None = None
    insurance_terms: str | None = None
    payment_terms_label: str | None = None
    # Amounts are None when hidden (Sales › Sales Orders › Prices & margins).
    subtotal: float | None
    discount_total: float | None
    taxable_total: float | None
    gst_total: float | None
    grand_total: float | None
    inspection_agency: str | None = None
    third_party_inspection_required: bool
    ld_applicable: bool
    ld_rate_percent: float | None = None
    ld_rate_period: str | None = None
    ld_basis: str | None = None
    ld_max_percent: float | None = None
    warranty_months_from_delivery: int | None = None
    warranty_months_from_commissioning: int | None = None
    warranty_rule: str | None = None
    warranty_terms_text: str | None = None
    pbg_required: bool
    pbg_percent: float | None = None
    pbg_due_days: int | None = None
    delivery_terms_text: str | None = None
    special_conditions: str | None = None
    remarks: str | None = None
    sales_owner_id: int | None = None
    branch_id: int | None = None
    deviation_flags: list[str] = Field(default_factory=list)
    required_approval_level: str | None = None
    approval_round: int
    submitted_at: datetime | None = None
    submitted_by_id: int | None = None
    confirmed_at: datetime | None = None
    confirmed_by_id: int | None = None
    oa_issued_at: datetime | None = None
    oa_issued_by_id: int | None = None
    amendment_no: int
    hold_reason: str | None = None
    cancel_reason: str | None = None
    short_close_reason: str | None = None
    close_reason: str | None = None
    return_comment: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    lines: list[SalesOrderLineResponse] = Field(default_factory=list)
    schedules: list[SalesOrderScheduleResponse] = Field(default_factory=list)
    billing_lines: list[SalesBillingPlanResponse] = Field(default_factory=list)

    # display
    customer_contact_name: str | None = None
    sales_owner_name: str | None = None
    submitted_by_name: str | None = None
    confirmed_by_name: str | None = None
    created_by_name: str | None = None
    branch_name: str | None = None
    source_label: str | None = None
    units_total: int = 0
    units_delivered: int = 0
    units_overdue: int = 0
    units_at_risk: int = 0
    next_due_date: date | None = None
    ld_accrued: float | None = 0
    ld_forecast: float | None = 0
    next_approval_level: str | None = None
    next_approvers: list[str] = Field(default_factory=list)
    # True once the order went through the central approval engine (Organization ›
    # Approval Workflows); the UI then shows <ApprovalPanel>. False = legacy chain
    # (orders submitted before the move, finished through the old endpoints).
    approval_via_engine: bool = False
    approval_stage: str | None = None  # current engine stage name while pending
    approvals: list[SalesApprovalResponse] = Field(default_factory=list)
    credit: dict | None = None
    open_amendment_id: int | None = None
    # The Project Management project created at confirmation (projects/so_projects.py).
    pm_project_id: int | None = None
    pm_project_code: str | None = None
    # Deprecated alias of the two above: {id, op_number, status}; filled from the PM project.
    order_project: dict | None = None
    can: dict = Field(default_factory=dict)
    prices_hidden: bool = False  # amounts blanked — no Sales › Sales Orders › Prices & margins

    model_config = {"from_attributes": True}
    lock_version: int | None = None  # SM12 optimistic lock — echo back as X-Lock-Version
