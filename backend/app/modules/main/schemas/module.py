from pydantic import BaseModel


class ModuleCreate(BaseModel):
    key: str
    label: str
    icon: str | None = None
    description: str | None = None
    sort_order: int = 0


class ModuleUpdate(BaseModel):
    label: str | None = None
    icon: str | None = None
    description: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class ModuleResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    key: str
    label: str
    icon: str | None = None
    description: str | None = None
    is_active: bool
    sort_order: int
