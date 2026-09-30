from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

HYD_SPARE_CATEGORIES = (
    "seal_kit", "o_ring", "filter_element", "hose_assembly", "valve_cartridge", "solenoid_coil",
    "pump_spare", "cylinder_spare", "fitting", "fluid_lubricant", "sensor", "pneumatic_spare", "other",
)
HYD_SPARE_CRITICALITY = ("critical", "essential", "desirable")
HYD_SPARE_STATUSES = ("active", "obsolete")


class HydSparePart(Base, TimestampMixin, SoftDeleteMixin):
    """A spare part the module tracks for its systems — seal kits, filter
    elements, hoses, cartridges. Same rule as the Maintenance plan: this
    module owns no stock. When `store_item_id` is set, stock on hand is read
    from the Store ledger and issues post through it; `min_stock_qty` is
    this module's own reorder signal on top of that.

    `component_id` says which component the spare belongs to; the systems
    it applies to follow from the BOMs that use that component."""

    __tablename__ = "hyd_spare_parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    part_code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    criticality: Mapped[str] = mapped_column(String(20), default="essential", nullable=False)

    component_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_components.id"), index=True, nullable=True)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(150), nullable=True)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uom: Mapped[str] = mapped_column(String(20), default="NOS", nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    min_stock_qty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    reorder_qty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Elastomer seals and hoses age on the shelf — ISO 2230 storage life.
    shelf_life_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    interchangeable_with: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
