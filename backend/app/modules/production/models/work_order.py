from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Text, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → released → in_progress → completed → closed; cancelled from draft,
# released, or in_progress (only once nothing is still issued or received).
PRODUCTION_WORK_ORDER_STATUSES = ("draft", "released", "in_progress", "completed", "closed", "cancelled")
PRODUCTION_WORK_ORDER_PRIORITIES = ("low", "normal", "high", "urgent")
PRODUCTION_OPERATION_STATUSES = ("pending", "in_progress", "completed")

# Stock ledger reference_type for everything a work order posts (material
# issue/return, finished-goods receipt) — reference_number is the WO number.
WORK_ORDER_REFERENCE_TYPE = "work_order"


class ProductionWorkOrder(Base, TimestampMixin, SoftDeleteMixin):
    """An order to build `quantity_planned` units of a product from an active
    BOM. Creating it snapshots the BOM's components and routing into its own
    material and operation lines, so later BOM versions don't change it.
    Optionally tied to the ERP machine (erp_projects row) it's building."""

    __tablename__ = "production_work_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wo_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    product_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_boms.id"), nullable=False)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    quantity_planned: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_completed: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    quantity_scrapped: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    # Where components are issued from, and where finished goods are received into.
    source_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    target_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    supervisor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The RRV this order builds part of (see models/rrv_build.py): role
    # "main" = final vehicle assembly (one per build), "sub_assembly" = a
    # module that feeds it.
    rrv_build_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=True)
    build_role: Mapped[str | None] = mapped_column(String(20), nullable=True)

    materials: Mapped[list["ProductionWorkOrderMaterial"]] = relationship(
        "ProductionWorkOrderMaterial", back_populates="work_order", cascade="all, delete-orphan",
        order_by="ProductionWorkOrderMaterial.id",
    )
    operations: Mapped[list["ProductionWorkOrderOperation"]] = relationship(
        "ProductionWorkOrderOperation", back_populates="work_order", cascade="all, delete-orphan",
        order_by="ProductionWorkOrderOperation.sequence",
    )


class ProductionWorkOrderMaterial(Base, TimestampMixin):
    """One component the work order needs. `issued_qty - returned_qty` is
    what's actually been consumed from Store. A line with required_qty 0 is
    an extra issue of an item that wasn't on the BOM."""

    __tablename__ = "production_work_order_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=False)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False)
    required_qty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    issued_qty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    returned_qty: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # The Store reservation holding this line's stock at the source location
    # (made on release, drawn down by each issue). Store users can see and
    # cancel it from their Reservations page, so its own status — not a copy
    # here — is the truth about how much is still held.
    reservation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_stock_reservations.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order: Mapped["ProductionWorkOrder"] = relationship("ProductionWorkOrder", back_populates="materials")


class ProductionWorkOrderOperation(Base, TimestampMixin):
    """One routing step of a work order. qty_good/qty_scrap are the running
    totals of the shop-floor time logs booked against it."""

    __tablename__ = "production_work_order_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    operation_name: Mapped[str] = mapped_column(String(150), nullable=False)
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), nullable=True)
    planned_hours: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    requires_inspection: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    qty_good: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qty_scrap: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The in-process/final inspection raised in Quality for this step's gate.
    quality_inspection_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspections.id"), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    work_order: Mapped["ProductionWorkOrder"] = relationship("ProductionWorkOrder", back_populates="operations")


class ProductionTimeLog(Base, TimestampMixin):
    """A shop-floor booking: hours worked on an operation and the good/scrap
    quantity produced in that time. Hours × the workstation's hourly_rate is
    the work order's labour/machine cost."""

    __tablename__ = "production_time_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=False)
    operation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_order_operations.id"), index=True, nullable=True)
    workstation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_workstations.id"), nullable=True)
    operator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    log_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[float] = mapped_column(Float, nullable=False)
    qty_good: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    qty_scrap: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
