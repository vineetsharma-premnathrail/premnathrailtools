from pydantic import BaseModel


class StoreItemCategoryCreate(BaseModel):
    name: str
    code: str | None = None  # blank → generated from the name
    parent_id: int | None = None
    item_type: str | None = None


class StoreItemCategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    item_type: str | None = None
    is_active: bool | None = None


class StoreItemCategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    parent_id: int | None = None
    item_type: str | None = None
    parent_name: str | None = None
    is_active: bool
