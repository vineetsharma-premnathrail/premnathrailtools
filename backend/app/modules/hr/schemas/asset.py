from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class HrAssetAssignmentResponse(BaseModel):
    id: int
    asset_id: int
    user_id: int
    issued_on: date
    issued_by_id: int | None = None
    expected_return_on: date | None = None
    condition_on_issue: str | None = None
    returned_on: date | None = None
    received_by_id: int | None = None
    condition_on_return: str | None = None
    remarks: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    user_name: str | None = None
    user_email: str | None = None
    issued_by_name: str | None = None
    received_by_name: str | None = None
    # Filled on per-user history lists so the row can name the asset.
    asset_code: str | None = None
    asset_name: str | None = None
    asset_category: str | None = None
    asset_serial_number: str | None = None
    asset_status: str | None = None


class HrAssetCreate(BaseModel):
    asset_code: str | None = Field(None, max_length=50, description="Leave blank to auto-number AST-NNNN")
    name: str = Field(..., min_length=1, max_length=200)
    category: str
    make: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=100)
    serial_number: str | None = Field(None, max_length=100)
    purchase_date: date | None = None
    purchase_cost: Decimal | None = Field(None, ge=0)
    vendor_name: str | None = Field(None, max_length=200)
    invoice_no: str | None = Field(None, max_length=100)
    warranty_until: date | None = None
    branch_id: int | None = None
    condition: str | None = "new"
    remarks: str | None = None


class HrAssetUpdate(BaseModel):
    asset_code: str | None = Field(None, max_length=50)
    name: str | None = Field(None, min_length=1, max_length=200)
    category: str | None = None
    make: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=100)
    serial_number: str | None = Field(None, max_length=100)
    purchase_date: date | None = None
    purchase_cost: Decimal | None = Field(None, ge=0)
    vendor_name: str | None = Field(None, max_length=200)
    invoice_no: str | None = Field(None, max_length=100)
    warranty_until: date | None = None
    branch_id: int | None = None
    condition: str | None = None
    remarks: str | None = None


class HrAssetIssuePayload(BaseModel):
    user_id: int
    issued_on: date | None = None
    expected_return_on: date | None = None
    condition_on_issue: str | None = None
    remarks: str | None = None


class HrAssetReturnPayload(BaseModel):
    returned_on: date | None = None
    condition_on_return: str
    # Where the asset goes after it comes back.
    next_status: str = "in_stock"
    remarks: str | None = None


class HrAssetStatusPayload(BaseModel):
    status: str
    remarks: str | None = None


class HrAssetResponse(BaseModel):
    id: int
    asset_code: str
    name: str
    category: str
    make: str | None = None
    model: str | None = None
    serial_number: str | None = None
    purchase_date: date | None = None
    purchase_cost: Decimal | None = None
    vendor_name: str | None = None
    invoice_no: str | None = None
    warranty_until: date | None = None
    branch_id: int | None = None
    status: str
    condition: str | None = None
    current_holder_id: int | None = None
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}

    branch_name: str | None = None
    current_holder_name: str | None = None
    current_holder_email: str | None = None
    issued_on: date | None = None
    expected_return_on: date | None = None
    created_by_name: str | None = None
    assignments: list[HrAssetAssignmentResponse] | None = None
