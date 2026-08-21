from pydantic import BaseModel, Field


class StockItemCreate(BaseModel):
    part_code: str
    description: str
    make: str | None = None
    unit: str | None = None
    category: str | None = None
    reorder_point: float = 0
    reorder_quantity: float = 0
    standard_cost: float | None = None


class StockItemUpdate(BaseModel):
    part_code: str | None = None
    description: str | None = None
    make: str | None = None
    unit: str | None = None
    category: str | None = None
    reorder_point: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    status: str | None = None
    remarks: str | None = None


class StockItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    part_code: str
    description: str
    make: str | None = None
    unit: str | None = None
    category: str | None = None
    reorder_point: float
    reorder_quantity: float
    standard_cost: float | None = None
    status: str
    remarks: str | None = None

    # Denormalized, filled in by the route: total quantity_on_hand across all locations.
    quantity_on_hand: float = 0
