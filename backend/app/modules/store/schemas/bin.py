from pydantic import BaseModel


class StoreBinCreate(BaseModel):
    location_id: int
    parent_id: int | None = None
    bin_type: str
    code: str
    name: str | None = None


class StoreBinUpdate(BaseModel):
    parent_id: int | None = None
    bin_type: str | None = None
    code: str | None = None
    name: str | None = None
    is_active: bool | None = None


class StoreBinResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    location_id: int
    parent_id: int | None = None
    bin_type: str
    code: str
    name: str | None = None
    is_active: bool
