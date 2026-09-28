from pydantic import BaseModel


class StoreLocationCreate(BaseModel):
    name: str
    code: str
    branch_id: int | None = None
    warehouse_type: str | None = None
    manager_user_id: int | None = None
    address: str | None = None
    storage_type: str | None = None
    inventory_type: str | None = None
    operating_hours: str | None = None
    status: str = "active"


class StoreLocationUpdate(BaseModel):
    name: str | None = None
    branch_id: int | None = None
    warehouse_type: str | None = None
    manager_user_id: int | None = None
    address: str | None = None
    storage_type: str | None = None
    inventory_type: str | None = None
    operating_hours: str | None = None
    status: str | None = None
    is_active: bool | None = None


class StoreLocationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    branch_id: int | None = None
    branch_name: str | None = None
    warehouse_type: str | None = None
    manager_user_id: int | None = None
    manager_user_name: str | None = None
    address: str | None = None
    storage_type: str | None = None
    inventory_type: str | None = None
    operating_hours: str | None = None
    status: str
    is_active: bool
