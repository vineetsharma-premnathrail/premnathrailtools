from pydantic import BaseModel


class StoreItemCreate(BaseModel):
    item_code: str
    item_name: str
    item_type: str | None = "raw_material"
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    uom: str | None = None
    secondary_uom: str | None = None
    conversion_factor: float | None = None
    manufacturer: str | None = None
    manufacturer_part_number: str | None = None
    part_number: str | None = None
    hsn_sac_code: str | None = None
    material_grade: str | None = None
    specification: str | None = None
    make: str | None = None
    model: str | None = None
    batch_controlled: bool = False
    serial_controlled: bool = False
    expiry_controlled: bool = False
    shelf_life_days: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    plant: str | None = None
    preferred_warehouse_id: int | None = None
    preferred_supplier: str | None = None
    remarks: str | None = None


class StoreItemUpdate(BaseModel):
    item_name: str | None = None
    item_type: str | None = None
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    uom: str | None = None
    secondary_uom: str | None = None
    conversion_factor: float | None = None
    manufacturer: str | None = None
    manufacturer_part_number: str | None = None
    part_number: str | None = None
    hsn_sac_code: str | None = None
    material_grade: str | None = None
    specification: str | None = None
    make: str | None = None
    model: str | None = None
    batch_controlled: bool | None = None
    serial_controlled: bool | None = None
    expiry_controlled: bool | None = None
    shelf_life_days: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    moving_average_cost: float | None = None
    status: str | None = None
    plant: str | None = None
    preferred_warehouse_id: int | None = None
    preferred_supplier: str | None = None
    remarks: str | None = None


class StoreItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    item_code: str
    item_name: str
    item_type: str | None = None
    category: str | None = None
    subcategory: str | None = None
    description: str | None = None
    uom: str | None = None
    secondary_uom: str | None = None
    conversion_factor: float | None = None
    manufacturer: str | None = None
    manufacturer_part_number: str | None = None
    part_number: str | None = None
    hsn_sac_code: str | None = None
    material_grade: str | None = None
    specification: str | None = None
    make: str | None = None
    model: str | None = None
    batch_controlled: bool
    serial_controlled: bool
    expiry_controlled: bool
    shelf_life_days: int | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    moving_average_cost: float | None = None
    status: str
    plant: str | None = None
    preferred_warehouse_id: int | None = None
    preferred_warehouse_name: str | None = None
    preferred_supplier: str | None = None
    remarks: str | None = None
