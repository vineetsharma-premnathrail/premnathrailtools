from datetime import date, datetime

from pydantic import BaseModel


class ProductPriceConditionCreate(BaseModel):
    condition_type: str
    item_kind: str
    product_id: int | None = None
    store_item_id: int | None = None
    service_code: str | None = None
    customer_id: int | None = None
    amount: float | None = None
    percent: float | None = None
    freight_basis: str | None = None
    min_price: float | None = None
    uom: str | None = None
    valid_from: date
    valid_to: date | None = None
    is_active: bool = True
    remarks: str | None = None


class ProductPriceConditionUpdate(BaseModel):
    amount: float | None = None
    percent: float | None = None
    freight_basis: str | None = None
    min_price: float | None = None
    uom: str | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    is_active: bool | None = None
    remarks: str | None = None


class ProductPriceConditionResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    condition_type: str
    item_kind: str
    product_id: int | None = None
    store_item_id: int | None = None
    service_code: str | None = None
    customer_id: int | None = None
    amount: float | None = None
    percent: float | None = None
    freight_basis: str | None = None
    min_price: float | None = None
    uom: str | None = None
    currency: str
    valid_from: date
    valid_to: date | None = None
    is_active: bool
    remarks: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    item_label: str | None = None
    customer_name: str | None = None
    is_current: bool = False
