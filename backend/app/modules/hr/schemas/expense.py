from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class HrExpenseClaimItemPayload(BaseModel):
    expense_date: date
    category: str
    description: str | None = None
    amount: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)


class HrExpenseClaimItemUpdate(BaseModel):
    expense_date: date | None = None
    category: str | None = None
    description: str | None = None
    amount: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)


class HrExpenseClaimItemResponse(BaseModel):
    id: int
    claim_id: int
    expense_date: date
    category: str
    description: str | None = None
    amount: Decimal
    receipt_filename: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    has_receipt: bool = False
    receipt_required: bool = False


class HrExpenseClaimCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    claim_date: date | None = None
    travel_request_id: int | None = None
    items: list[HrExpenseClaimItemPayload] = []


class HrExpenseClaimUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    claim_date: date | None = None
    travel_request_id: int | None = None
    # Explicit flag so "unlink the travel request" is distinguishable from
    # "field not sent".
    clear_travel_request: bool = False


class HrExpenseClaimDecisionPayload(BaseModel):
    remarks: str | None = None


class HrExpenseClaimMarkPaidPayload(BaseModel):
    paid_on: date | None = None
    payment_reference: str = Field(..., min_length=1, max_length=100)


class HrExpenseClaimResponse(BaseModel):
    id: int
    claim_no: str
    user_id: int
    travel_request_id: int | None = None
    title: str
    claim_date: date
    total_amount: Decimal
    status: str
    approver_id: int | None = None
    submitted_at: datetime | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_remarks: str | None = None
    paid_on: date | None = None
    payment_reference: str | None = None
    paid_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    user_name: str | None = None
    user_email: str | None = None
    user_department: str | None = None
    approver_name: str | None = None
    decided_by_name: str | None = None
    paid_by_name: str | None = None
    travel_request_no: str | None = None
    travel_route: str | None = None
    item_count: int = 0
    items: list[HrExpenseClaimItemResponse] | None = None
    receipt_threshold: Decimal | None = None
    can_edit: bool = False
    can_decide: bool = False
    can_mark_paid: bool = False
    can_cancel: bool = False
