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
    # Actual cost moved out of the order into finished-goods stock by its
    # receipts so far (GR 101 at actual cost) — Σ of its goods_receipt cost
    # postings, kept here so the next receipt knows what is still open.
    cost_relieved: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    # CO01 sales-order assignment (make-to-order): the customer order line this
    # order builds for. Inherited from the RRV build / parent order when set.
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id", use_alter=True, name="fk_production_work_orders_sales_order_id"), index=True, nullable=True)
    sales_order_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_lines.id", use_alter=True, name="fk_production_work_orders_sales_order_line_id"), nullable=True)
    # Order Project element (vehicle / lot) this order works for. Inherited
    # from the RRV build / parent order; required when the sales order has an
    # Order Project (production/order_project_links.py).
    order_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    order_project_element_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), index=True, nullable=True)
    # CS11 multi-level explosion: the order whose sub-assembly (make item)
    # this dependent order builds.
    parent_work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=True)
    # CC01/ECM: set when an engineering change hits the product while this
    # order is open (built to the old structure) — Production reviews and
    # clears it with a note on what was done with the WIP.
    change_flag: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_flag_ecn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_change_notices.id"), nullable=True)
    change_flag_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    change_flag_cleared_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    change_flag_cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    change_flag_resolution: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    # stock = reserved and issued from Store; non_stock = bought directly
    # for this order (never reserved, not a Store shortage).
    item_category: Mapped[str] = mapped_column(String(20), default="stock", server_default="stock", nullable=False)
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
    # Quality Phase 2: the gate is an in-process inspection lot. Older steps
    # keep quality_inspection_id (legacy free-text inspection) and are still
    # read through it; new requests only set this.
    quality_lot_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Routing control key, copied from the BOM operation (see models/bom.py).
    control_key: Mapped[str] = mapped_column(String(20), default="internal", server_default="internal", nullable=False)
    confirmation: Mapped[str] = mapped_column(String(20), default="optional", server_default="optional", nullable=False)
    print_on_job_card: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    external_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    # External step: the Store job-work challan (Material Issue of type
    # job_work) the material went out on.
    job_work_issue_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_material_issues.id"), nullable=True)

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
    # Workstation hourly rate at the time of booking, so the order's labour
    # cost (and WIP) doesn't change when the rate is revised later. NULL on
    # logs booked before this was recorded: the current rate is used.
    activity_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    # CO activity type booked (accounts CO_ACTIVITY_TYPES: MCH / LAB / SET).
    # NULL = a plain workstation hour: machine + labour rate together.
    activity_type: Mapped[str | None] = mapped_column(String(10), nullable=True)


# What a cost posting does to the order's actual cost: issue and labour add
# to it, a return takes material back off it, a goods receipt moves cost out
# of the order (WIP) into finished-goods stock. overhead / overhead_reversal
# are the period-end costing-sheet surcharge (accounts services/co_overhead.py).
PRODUCTION_COST_POSTING_TYPES = ("material_issue", "material_return", "goods_receipt", "overhead", "overhead_reversal")


class ProductionOrderCostPosting(Base, TimestampMixin):
    """CO line item of a work order (SAP KOB1): one dated, valued material
    movement. Written when the stock moves, never recalculated, so a work
    order's actual cost and its period-end WIP don't change when an item's
    average or standard cost changes later. `amount` is always positive;
    the direction comes from `posting_type`. Labour comes from time logs."""

    __tablename__ = "production_order_cost_postings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_work_orders.id"), index=True, nullable=False)
    posting_type: Mapped[str] = mapped_column(String(20), nullable=False)
    posting_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    # Where the rate came from: "ledger" (the Store row's valued cost),
    # "item_cost" (standard / moving average when Store valuation is off),
    # "issue_rate" (a return at the order's own issue rate), "order_actual".
    cost_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    stock_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_stock_transactions.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
