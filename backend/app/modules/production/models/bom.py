from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → active → obsolete. Only a draft can be edited; changing an active
# BOM means creating its next version, so work orders already exploded from
# it keep matching the BOM they were built against.
PRODUCTION_BOM_STATUSES = ("draft", "active", "obsolete")


class ProductionBom(Base, TimestampMixin, SoftDeleteMixin):
    """Bill of materials + routing for one product (a Store item). Components
    are Store items too, so a work order's material requirement can be
    issued straight from the stock ledger. At most one version per product
    is `active` at a time."""

    __tablename__ = "production_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    product_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # Component quantities are per this many units of the product (usually 1).
    base_quantity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    activated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ProductionBomItem"]] = relationship(
        "ProductionBomItem", back_populates="bom", cascade="all, delete-orphan",
        order_by="ProductionBomItem.sort_order",
    )
    operations: Mapped[list["ProductionBomOperation"]] = relationship(
        "ProductionBomOperation", back_populates="bom", cascade="all, delete-orphan",
        order_by="ProductionBomOperation.sequence",
    )


class ProductionBomItem(Base, TimestampMixin):
    """One component line — `quantity` of a Store item per `base_quantity`
    units of the product, plus an expected scrap allowance."""

    __tablename__ = "production_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_boms.id"), index=True, nullable=False)
    component_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    scrap_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    bom: Mapped["ProductionBom"] = relationship("ProductionBom", back_populates="items")


class ProductionBomOperation(Base, TimestampMixin):
    """One routing step. Planned hours for a work order = setup_hours +
    run_hours_per_unit × quantity. `requires_inspection` makes the step a
    quality gate: it can't be completed until Quality passes an inspection
    raised against it."""

    __tablename__ = "production_bom_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_boms.id"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    operation_name: Mapped[str] = mapped_column(String(150), nullable=False)
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), nullable=True)
    setup_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    run_hours_per_unit: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    requires_inspection: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)

    bom: Mapped["ProductionBom"] = relationship("ProductionBom", back_populates="operations")
