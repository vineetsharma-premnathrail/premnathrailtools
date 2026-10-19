from pydantic import BaseModel


class ProductApplicationCreate(BaseModel):
    code: str
    name: str
    description: str | None = None


class ProductApplicationUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ProductApplicationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    description: str | None = None
    is_active: bool
    product_count: int = 0
