from __future__ import annotations
from sqlalchemy import String, Integer, Text, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# What the item is used for — drives which downstream doc types (Purchase,
# Manufacturing BOM) it can be picked into. Free text, not an enum column in
# the DB (see item_type below) — kept as a suggested set for the frontend.
STORE_ITEM_TYPES = ("material", "service", "asset", "consumable", "tool_equipment")

# Item-code prefix per type. Auto codes are <TYPE>-<CATEGORY CODE>-<NNNN>,
# e.g. RM-HYD-0001 (see service.generate_item_code).
STORE_ITEM_TYPE_PREFIXES: dict[str, str] = {
    "material": "MT", "service": "SV", "asset": "AS", "consumable": "CN", "tool_equipment": "TE",
}
STORE_ITEM_TYPE_LABELS: dict[str, str] = {
    "material": "Material", "service": "Service", "asset": "Asset", "consumable": "Consumable",
    "tool_equipment": "Tool & Equipment",
}

# Standard categories per item type: (name, code). Seeded by migration;
# the Category dropdown on the item form is filtered by the picked type.
STORE_TYPE_CATEGORIES: dict[str, list[tuple[str, str]]] = {
    "material": [("Raw Material", "RAW"), ("Production Material", "PRD"), ("Electrical", "ELE"),
                 ("Hydraulic & Pneumatic", "HYD"), ("Mechanical Components", "MEC"),
                 ("Hardware & Fasteners", "HWF"), ("Paint & Chemicals", "PNT"), ("Packaging", "PKG")],
    "service": [("Job Work", "JOB"), ("Maintenance Service", "MSV"), ("Professional Service", "PSV"),
                ("Consultancy", "CON"), ("Other Service", "OSV")],
    "asset": [("Machinery", "MCH"), ("Equipment", "EQP"), ("Vehicle", "VEH"), ("IT Asset", "ITA"),
              ("Furniture", "FUR")],
    "consumable": [("Office Consumables", "OFC"), ("Cleaning", "CLN"), ("PPE", "PPE"),
                   ("Workshop Consumables", "WSC"), ("Production Consumables", "PRC")],
    "tool_equipment": [("Hand Tools", "HTL"), ("Power Tools", "PTL"), ("Measuring Instruments", "MIN"),
                       ("Testing Equipment", "TEQ"), ("Engineering Tools", "ENG")],
}
# Category code used when an item has no category picked.
STORE_ITEM_NO_CATEGORY_CODE = "GEN"

# Seed list for the store_uoms table (code -> label). Users add/edit units
# from the UOM dropdown; codes are stored uppercase so "Nos" / "NOS" / "nos."
# stay one unit.
STORE_UOMS: dict[str, str] = {
    "NOS": "Numbers", "PCS": "Pieces", "SET": "Set", "PAIR": "Pair", "KIT": "Kit", "LOT": "Lot",
    "KG": "Kilogram", "GM": "Gram", "TON": "Tonne",
    "MTR": "Metre", "MM": "Millimetre", "CM": "Centimetre", "FT": "Foot", "INCH": "Inch",
    "SQM": "Square metre", "SQFT": "Square foot", "CUM": "Cubic metre",
    "LTR": "Litre", "ML": "Millilitre",
    "BOX": "Box", "PKT": "Packet", "ROLL": "Roll", "BAG": "Bag", "DRUM": "Drum", "CAN": "Can",
    "BTL": "Bottle", "SHEET": "Sheet", "COIL": "Coil", "BUNDLE": "Bundle",
    "HR": "Hour", "DAY": "Day", "JOB": "Job",
}

STORE_ITEM_STATUSES = ("active", "inactive", "discontinued")


class StoreItem(Base, TimestampMixin):
    """Item Master. category/subcategory are free-text (not FK'd to
    StoreItemCategory) — matches the existing store_items table, which
    predates the StoreItemCategory master added alongside this model."""

    __tablename__ = "store_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    item_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subcategory: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    conversion_factor: Mapped[float | None] = mapped_column(Float, nullable=True)

    manufacturer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    manufacturer_part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hsn_sac_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    material_grade: Mapped[str | None] = mapped_column(String(100), nullable=True)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    batch_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    serial_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expiry_controlled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    shelf_life_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    minimum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    reorder_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    safety_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    reorder_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    standard_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    moving_average_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    # Item photo in SharePoint (see routes/item_photo.py).
    photo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    photo_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    plant: Mapped[str | None] = mapped_column(String(100), nullable=True)
    preferred_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    preferred_supplier: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


class StoreItemType(Base, TimestampMixin):
    """Item type master (Material, Service, ...). `value` is what items and
    categories store and never changes; label and code prefix are editable
    from the Item Type dropdown. Seeded from STORE_ITEM_TYPES."""

    __tablename__ = "store_item_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    value: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    prefix: Mapped[str] = mapped_column(String(6), unique=True, nullable=False)


class StoreUom(Base, TimestampMixin):
    """Unit of measure master — the UOM dropdown on Store items and PR lines.
    Users can add new units and edit existing ones from the dropdown."""

    __tablename__ = "store_uoms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
