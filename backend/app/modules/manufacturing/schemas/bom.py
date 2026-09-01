from pydantic import BaseModel


class BOMItemPayload(BaseModel):
    material_id: int
    quantity: float


class BOMItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    material_id: int
    quantity: float
    material_name: str | None = None
    material_code: str | None = None


class BOMCreate(BaseModel):
    code: str
    name: str
    output_material_id: int
    output_quantity: float = 1
    items: list[BOMItemPayload] = []


class BOMUpdate(BaseModel):
    name: str | None = None
    output_quantity: float | None = None
    is_active: bool | None = None
    items: list[BOMItemPayload] | None = None


class BOMResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    output_material_id: int
    output_quantity: float
    is_active: bool
    output_material_name: str | None = None
    items: list[BOMItemResponse] = []
