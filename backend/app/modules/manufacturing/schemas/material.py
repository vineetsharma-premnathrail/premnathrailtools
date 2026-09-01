from pydantic import BaseModel


class MaterialCreate(BaseModel):
    code: str
    name: str
    unit: str | None = None
    category: str | None = None
    remarks: str | None = None


class MaterialUpdate(BaseModel):
    name: str | None = None
    unit: str | None = None
    category: str | None = None
    remarks: str | None = None
    is_active: bool | None = None


class MaterialResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    unit: str | None = None
    category: str | None = None
    remarks: str | None = None
    is_active: bool
