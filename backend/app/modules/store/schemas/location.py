from pydantic import BaseModel


class StoreLocationCreate(BaseModel):
    name: str
    code: str
    address: str | None = None


class StoreLocationUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    is_active: bool | None = None


class StoreLocationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    code: str
    address: str | None = None
    is_active: bool
