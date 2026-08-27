from datetime import datetime
from pydantic import BaseModel


class ProductCreate(BaseModel):
    name: str
    model_number: str | None = None
    category: str | None = None
    unit: str | None = None
    default_price: float | None = None
    description: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    model_number: str | None = None
    category: str | None = None
    unit: str | None = None
    default_price: float | None = None
    description: str | None = None


class ProductResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    model_number: str | None = None
    category: str | None = None
    unit: str | None = None
    default_price: float | None = None
    description: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
