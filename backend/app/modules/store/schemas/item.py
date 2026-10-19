from datetime import date

from pydantic import BaseModel


class StoreItemCreate(BaseModel):
    # Leave blank to auto-generate <TYPE>-<CATEGORY>-<NNNN> (service.generate_item_code).
    item_code: str | None = None
    item_name: str
    item_type: str | None = "material"
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
    inspection_on_receipt: bool = False
    test_certificate_required: bool = False
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    # Purchase lead time, calendar days (0–730); v3 / Tally code.
    lead_time_days: int | None = None
    legacy_code: str | None = None
    min_order_qty: float | None = None
    gst_rate: float | None = None
    preferred_vendor_id: int | None = None
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None
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
    inspection_on_receipt: bool | None = None
    test_certificate_required: bool | None = None
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    # moving_average_cost is not accepted: it is the system weighted average
    # (read-only mirror of store_item_valuations, foundation plan §3.4).
    lead_time_days: int | None = None
    legacy_code: str | None = None
    min_order_qty: float | None = None
    gst_rate: float | None = None
    preferred_vendor_id: int | None = None
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None
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
    inspection_on_receipt: bool = False
    test_certificate_required: bool = False
    minimum_stock: float | None = None
    maximum_stock: float | None = None
    reorder_level: float | None = None
    safety_stock: float | None = None
    reorder_quantity: float | None = None
    standard_cost: float | None = None
    moving_average_cost: float | None = None
    lead_time_days: int | None = None
    legacy_code: str | None = None
    min_order_qty: float | None = None
    gst_rate: float | None = None
    preferred_vendor_id: int | None = None
    purchase_gl_account_id: int | None = None
    sales_gl_account_id: int | None = None
    # Display (names resolved from the ids above).
    preferred_vendor_name: str | None = None
    purchase_gl_account_name: str | None = None
    sales_gl_account_name: str | None = None
    # Ledger that will actually be used, and where it comes from
    # ('item' / 'category' / 'default' / 'none') — services/item_accounts.py.
    effective_purchase_gl: str | None = None
    effective_purchase_gl_source: str | None = None
    effective_sales_gl: str | None = None
    effective_sales_gl_source: str | None = None
    status: str
    has_photo: bool = False
    plant: str | None = None
    preferred_warehouse_id: int | None = None
    preferred_warehouse_name: str | None = None
    preferred_supplier: str | None = None
    remarks: str | None = None
    # Last priced receipt (store_item_valuations) — shown next to the read-only average.
    last_receipt_rate: float | None = None
    last_receipt_date: date | None = None
