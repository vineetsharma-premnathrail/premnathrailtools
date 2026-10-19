"""Product cost estimates (SAP CK11N / CK13N) and the standard price they
release to the Item Master (CK24), with price history.

An estimate is a dated, versioned snapshot of what one lot of a product
costs to make from its production BOM + routing on `costing_date`:

  material   components × (1 + scrap %) × their cost (a sub-assembly takes
             its own released estimate, else it is rolled up level by level)
  labour     routing operations: (setup + run hours × lot) × activity rate
  overhead   costing-sheet % on material and on labour
  job_work   the vendor's job charge for components bought back from job work

draft → marked → released (→ superseded by the next release). Releasing
writes the unit cost to StoreItem.standard_cost and a history row with its
validity period. Periodic inventory (Finance decision): no revaluation
posting is made."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin

COST_ESTIMATE_STATUSES = ("draft", "marked", "released", "superseded", "cancelled")
COST_COMPONENTS = ("material", "labour", "overhead", "job_work")
COST_LINE_TYPES = ("material", "activity", "overhead")
# Where a line's unit cost came from.
COST_SOURCES = (
    "sub_estimate",     # the sub-assembly's own released estimate
    "sub_rollup",       # the sub-assembly's BOM costed inside this estimate
    "job_work",         # last job-work receipt: component value + job charge
    "standard",         # Item Master standard cost
    "moving_average",   # Store moving-average cost
    "activity_rate",    # dated activity rate of the work centre
    "workstation_rate", # the work centre's flat hourly rate
    "costing_sheet",    # overhead %
    "none",             # no cost found — a warning on the estimate
)
STANDARD_PRICE_SOURCES = ("estimate", "manual", "import")


class ProductionCostEstimate(Base, TimestampMixin):
    __tablename__ = "production_cost_estimates"
    __table_args__ = (UniqueConstraint("item_id", "version", name="uq_production_cost_estimate_item_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    estimate_number: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_boms.id"), index=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    costing_date: Mapped[date] = mapped_column(Date, nullable=False)
    lot_size: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)

    material_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    labour_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    overhead_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    job_work_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    material_overhead_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    labour_overhead_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # Lines the estimator could not cost ("RM-123 has no standard cost …").
    warnings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    # Period validity of the released standard price.
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    previous_standard_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    marked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["ProductionCostEstimateLine"]] = relationship(
        "ProductionCostEstimateLine", back_populates="estimate", cascade="all, delete-orphan",
        order_by="ProductionCostEstimateLine.line_number", foreign_keys="ProductionCostEstimateLine.estimate_id",
    )


class ProductionCostEstimateLine(Base, TimestampMixin):
    """One itemisation row (CK13N): a component, a routing activity or an
    overhead row. Children of a rolled-up sub-assembly sit one level deeper
    with parent_line_id set; their amounts are already in the parent row."""

    __tablename__ = "production_cost_estimate_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    estimate_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_cost_estimates.id", ondelete="CASCADE"), index=True, nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    parent_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_cost_estimate_lines.id"), nullable=True)
    line_type: Mapped[str] = mapped_column(String(20), nullable=False)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    operation_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # Cost-component split of `amount`.
    material_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    labour_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    overhead_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    job_work_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_source: Mapped[str] = mapped_column(String(20), nullable=False)
    sub_estimate_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_cost_estimates.id"), nullable=True)

    estimate: Mapped["ProductionCostEstimate"] = relationship(
        "ProductionCostEstimate", back_populates="lines", foreign_keys=[estimate_id])


class StoreItemStandardPrice(Base, TimestampMixin):
    """Standard price history of an item: every price the item carried, from
    when to when, and what set it (a released cost estimate, a manual edit,
    an import)."""

    __tablename__ = "store_item_standard_price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    standard_cost: Mapped[float] = mapped_column(Float, nullable=False)
    previous_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    cost_estimate_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_cost_estimates.id"), nullable=True)
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
