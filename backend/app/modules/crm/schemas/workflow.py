from datetime import date, datetime
from pydantic import BaseModel


# ---------- Inquiry / Tender Tasks ----------

class TaskCreate(BaseModel):
    department: str
    task_title: str
    assigned_user_id: int | None = None
    assigned_user_name: str | None = None
    due_date: date | None = None
    priority: str = "Medium"
    status: str = "Pending"
    remarks: str | None = None


class TaskUpdate(BaseModel):
    department: str | None = None
    task_title: str | None = None
    assigned_user_id: int | None = None
    assigned_user_name: str | None = None
    due_date: date | None = None
    priority: str | None = None
    status: str | None = None
    remarks: str | None = None


class InquiryTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int
    department: str
    task_title: str
    assigned_user_id: int | None = None
    assigned_user_name: str | None = None
    due_date: date | None = None
    priority: str
    status: str
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class TenderTaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tender_id: int
    department: str
    task_title: str
    assigned_user_id: int | None = None
    assigned_user_name: str | None = None
    due_date: date | None = None
    priority: str
    status: str
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


# ---------- Inquiry Approvals ----------

class ApprovalCreate(BaseModel):
    approval_type: str
    status: str = "Pending"
    comments: str | None = None
    version: str = "1"


class ApprovalUpdate(BaseModel):
    status: str | None = None
    comments: str | None = None


class InquiryApprovalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int
    approval_type: str
    status: str
    approved_by_id: int | None = None
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    comments: str | None = None
    version: str
    created_by_id: int | None = None
    created_at: datetime | None = None


# ---------- Quotations ----------

class QuotationLineItemPayload(BaseModel):
    description: str | None = None
    model_number: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    gst_percent: float | None = None
    subtotal: float | None = None
    total: float | None = None


class QuotationLineItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    description: str | None = None
    model_number: str | None = None
    quantity: float | None = None
    unit_price: float | None = None
    gst_percent: float | None = None
    subtotal: float | None = None
    total: float | None = None


class QuotationCreate(BaseModel):
    quotation_type: str = "Domestic"
    gst_type: str = "CGST_SGST"
    quote_date: date | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: str = "— Awaiting —"
    discount: float | None = None
    discount_type: str | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    items: list[QuotationLineItemPayload] = []


class QuotationReviseItem(BaseModel):
    """Only the line item's price can be revised post-creation — never its description,
    model, quantity, or GST%. `id` identifies the existing QuotationLineItem row."""
    id: int
    unit_price: float | None = None


class QuotationUpdate(BaseModel):
    """Once a quotation is created, only these fields may change — a limited revision, not a
    full edit. `customer_response`/`submitted_date` are status tracking, not content, so they
    don't count as a revision. Anything else requires creating a new quotation instead."""
    payment_terms: str | None = None
    valid_until: date | None = None
    delivery_time: str | None = None
    customer_response: str | None = None
    submitted_date: date | None = None
    items: list[QuotationReviseItem] | None = None


class QuotationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int
    quot_number: str | None = None
    revision_number: int
    quotation_type: str
    gst_type: str
    quote_date: date | None = None
    client_name: str | None = None
    client_contact_name: str | None = None
    client_contact_email: str | None = None
    client_contact_phone: str | None = None
    valid_until: date | None = None
    price: float | None = None
    delivery_time: str | None = None
    payment_terms: str | None = None
    submitted_date: date | None = None
    customer_response: str
    discount: float | None = None
    discount_type: str | None = None
    quote_conditions: str | None = None
    notes: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    items: list[QuotationLineItemResponse] = []


# ---------- Purchase Orders ----------

class PurchaseOrderCreate(BaseModel):
    inquiry_id: int | None = None
    tender_id: int | None = None
    org_id: int
    po_number: str | None = None
    po_date: date | None = None
    po_value: float | None = None
    delivery_schedule: str | None = None
    special_conditions: str | None = None
    status: str = "Active"


class PurchaseOrderUpdate(BaseModel):
    po_number: str | None = None
    po_date: date | None = None
    po_value: float | None = None
    delivery_schedule: str | None = None
    special_conditions: str | None = None
    status: str | None = None


class PurchaseOrderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    inquiry_id: int | None = None
    tender_id: int | None = None
    org_id: int
    po_number: str | None = None
    po_date: date | None = None
    po_value: float | None = None
    delivery_schedule: str | None = None
    special_conditions: str | None = None
    status: str
    created_by_id: int | None = None
    created_at: datetime | None = None


# ---------- Tender Competitors ----------

class CompetitorCreate(BaseModel):
    competitor_name: str
    expected_price: float | None = None
    remarks: str | None = None


class CompetitorUpdate(BaseModel):
    competitor_name: str | None = None
    expected_price: float | None = None
    remarks: str | None = None


class TenderCompetitorResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tender_id: int
    competitor_name: str
    expected_price: float | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


# ---------- Discussions ----------

class DiscussionCreate(BaseModel):
    message: str
    department: str | None = None


class DiscussionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    related_module: str
    related_id: int
    universal_id: str | None = None
    message: str
    department: str | None = None
    sent_by_id: int
    sent_by_name: str | None = None
    created_at: datetime | None = None


# ---------- Stage Logs ----------

class StageLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    related_module: str
    related_id: int
    universal_id: str | None = None
    stage: str
    entered_by_id: int | None = None
    entered_by_name: str | None = None
    notes: str | None = None
    created_at: datetime | None = None
