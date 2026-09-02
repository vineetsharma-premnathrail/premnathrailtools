from datetime import datetime
from pydantic import BaseModel


class ItemCreate(BaseModel):
    item_code: str
    item_name: str
    item_type: str | None = None
    item_group: str | None = None
    description: str | None = None
    unit_of_measure: str | None = None
    purchase_uom: str | None = None
    item_specification: str | None = None
    manufacturer_part_number: str | None = None
    make_or_buy: str | None = None
    default_warehouse_id: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    hsn_sac: str | None = None
    gst_tax: str | None = None
    quality_inspection_required: bool = False
    batch_serial_tracking: str | None = None
    item_status: str = "Active"


class ItemUpdate(BaseModel):
    item_code: str | None = None
    item_name: str | None = None
    item_type: str | None = None
    item_group: str | None = None
    description: str | None = None
    unit_of_measure: str | None = None
    purchase_uom: str | None = None
    item_specification: str | None = None
    manufacturer_part_number: str | None = None
    make_or_buy: str | None = None
    default_warehouse_id: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    hsn_sac: str | None = None
    gst_tax: str | None = None
    quality_inspection_required: bool | None = None
    batch_serial_tracking: str | None = None
    item_status: str | None = None


class ItemBulkCreate(BaseModel):
    items: list[ItemCreate]


class ItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_code: str
    item_name: str
    item_type: str | None = None
    item_group: str | None = None
    description: str | None = None
    unit_of_measure: str | None = None
    purchase_uom: str | None = None
    item_specification: str | None = None
    manufacturer_part_number: str | None = None
    make_or_buy: str | None = None
    default_warehouse_id: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    hsn_sac: str | None = None
    gst_tax: str | None = None
    quality_inspection_required: bool = False
    batch_serial_tracking: str | None = None
    item_status: str = "Active"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    default_warehouse_name: str | None = None
