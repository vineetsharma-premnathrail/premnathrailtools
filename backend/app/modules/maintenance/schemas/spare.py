from pydantic import BaseModel, Field


class MaintenanceAssetSparePayload(BaseModel):
    store_item_id: int
    qty_per_replacement: float = 1.0
    is_critical: bool = False
    remarks: str | None = Field(default=None, max_length=255)


class MaintenanceAssetSparesUpdate(BaseModel):
    """PUT body — replaces the asset's whole bill of spares."""
    lines: list[MaintenanceAssetSparePayload] = []


class MaintenanceAssetSpareResponse(BaseModel):
    id: int
    asset_id: int
    store_item_id: int
    qty_per_replacement: float
    is_critical: bool
    remarks: str | None = None
    # Denormalised from the Store item / stock balances (read-only).
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    item_type: str | None = None
    on_hand_total: float = 0.0
    minimum_stock: float | None = None
    reorder_level: float | None = None
    reorder_quantity: float | None = None
    below_min: bool = False

    model_config = {"from_attributes": True}


class MaintenanceSpareLocationStock(BaseModel):
    location_id: int
    location_name: str
    branch_id: int | None = None
    on_hand: float
    reserved: float


class MaintenanceSpareAssetRef(BaseModel):
    asset_id: int
    asset_code: str
    asset_name: str
    branch_id: int | None = None
    qty_per_replacement: float
    is_critical: bool


class MaintenanceSpareResponse(BaseModel):
    """One Store item on the Spares page — every number here is read from
    the Store (item master + stock balances + ledger), never stored here."""
    store_item_id: int
    item_code: str
    item_name: str
    uom: str | None = None
    item_type: str | None = None
    part_number: str | None = None
    make: str | None = None
    category: str | None = None
    locations: list[MaintenanceSpareLocationStock] = []
    on_hand_total: float = 0.0
    minimum_stock: float | None = None
    reorder_level: float | None = None
    reorder_quantity: float | None = None
    below_min: bool = False
    at_reorder: bool = False
    is_critical: bool = False
    suggested_order_qty: float | None = None
    assets: list[MaintenanceSpareAssetRef] = []
    consumed_90d: float = 0.0
