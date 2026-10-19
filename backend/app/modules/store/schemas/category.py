from pydantic import BaseModel


class StoreItemCategoryCreate(BaseModel):
    name: str
    code: str | None = None  # blank → generated from the name
    parent_id: int | None = None
    item_type: str | None = None
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None


class StoreItemCategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    item_type: str | None = None
    is_active: bool | None = None
    # Default ledgers for the category's items (top-level categories only).
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None


class StoreItemCategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    parent_id: int | None = None
    item_type: str | None = None
    parent_name: str | None = None
    is_active: bool
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None
    purchase_gl_account_name: str | None = None
    sales_gl_account_name: str | None = None
