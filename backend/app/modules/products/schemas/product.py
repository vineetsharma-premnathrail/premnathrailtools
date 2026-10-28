from datetime import datetime

from pydantic import BaseModel


class ProductSpecificationPayload(BaseModel):
    parameter: str
    value: str
    unit: str | None = None


class ProductSpecificationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    sort_order: int
    parameter: str
    value: str
    unit: str | None = None


class ProductApplicationRef(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    is_active: bool


class ProductCreate(BaseModel):
    code: str
    name: str
    product_type: str
    model_number: str | None = None
    status: str = "active"
    short_description: str | None = None
    description: str | None = None
    # Free text, one specification per line (e.g. "Max speed on rail: 40 km/h").
    technical_specification: str | None = None
    hsn_code: str | None = None
    uom: str = "Nos"
    warranty_months: int | None = None
    store_item_id: int | None = None
    application_ids: list[int] = []
    specifications: list[ProductSpecificationPayload] = []


class ProductUpdate(BaseModel):
    name: str | None = None
    product_type: str | None = None
    model_number: str | None = None
    status: str | None = None
    short_description: str | None = None
    description: str | None = None
    # Free text, one specification per line (e.g. "Max speed on rail: 40 km/h").
    technical_specification: str | None = None
    hsn_code: str | None = None
    uom: str | None = None
    warranty_months: int | None = None
    store_item_id: int | None = None
    # Sent = replace the whole set; omitted = leave as is.
    application_ids: list[int] | None = None
    specifications: list[ProductSpecificationPayload] | None = None


class ProductResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    product_type: str
    model_number: str | None = None
    status: str
    short_description: str | None = None
    description: str | None = None
    # Free text, one specification per line (e.g. "Max speed on rail: 40 km/h").
    technical_specification: str | None = None
    hsn_code: str | None = None
    uom: str
    warranty_months: int | None = None
    store_item_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    applications: list[ProductApplicationRef] = []
    specifications: list[ProductSpecificationResponse] = []

    store_item_code: str | None = None
    store_item_name: str | None = None
    created_by_name: str | None = None
