"""Material master plant views (SAP MM01 Plant / MRP 1-2 / Purchasing views).

One row per item per plant (organization `branches`). Planning data that
differs from plant to plant lives here: reorder / safety / min / max stock,
purchase lead time, in-house production time, the default receiving store,
the MRP type and the procurement type. A plant with no row for an item falls
back to the company-wide fields on store_items (services/plant_data.py), so
single-plant setups keep working unchanged."""
from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

# SAP MRP type: VB (reorder point), PD (MRP), ND (no planning).
STORE_MRP_TYPES = {
    "reorder_point": "Reorder point (VB) — Store reorder list raises the PR",
    "mrp": "MRP (PD) — planned by Production MRP from demand",
    "none": "No planning (ND)",
}
# SAP procurement type: F external, E in-house, X both.
STORE_PROCUREMENT_TYPES = {
    "buy": "Buy (external procurement, F)",
    "make": "Make (in-house production, E)",
    "both": "Make or buy (X)",
}


class StoreItemPlant(Base, TimestampMixin):
    __tablename__ = "store_item_plants"
    __table_args__ = (UniqueConstraint("item_id", "branch_id", name="uq_store_item_plants_item_branch"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False, index=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branches.id"), nullable=False, index=True)
    mrp_type: Mapped[str] = mapped_column(String(20), nullable=False, default="reorder_point", server_default="reorder_point")
    procurement_type: Mapped[str] = mapped_column(String(10), nullable=False, default="buy", server_default="buy")
    reorder_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    safety_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    minimum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    maximum_stock: Mapped[float | None] = mapped_column(Float, nullable=True)
    reorder_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Purchase lead time in calendar days (PO -> goods in this plant's store).
    lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # In-house production time in days (make items).
    inhouse_production_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    purchasing_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
