from datetime import datetime
from pydantic import BaseModel


class ProductCategoryCreate(BaseModel):
    name: str


class ProductCategoryUpdate(BaseModel):
    name: str | None = None


class ProductCategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    created_by_id: int | None = None
    created_at: datetime | None = None
