from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import JSON, String, Integer, Float, Text, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → active → obsolete. Only a draft can be edited; changing an active
# BOM means creating its next version, so work orders already exploded from
# it keep matching the BOM they were built against.
# `scheduled` (CS02 validity / CC01 date effectivity): approved, but its
# valid_from is still in the future — the current active version stays in
# force until that day (valid_to = the day before), then the scheduled one
# becomes active and the old one obsolete (see production/effectivity.py).
PRODUCTION_BOM_STATUSES = ("draft", "scheduled", "active", "obsolete")

# SAP item categories (CS01): L stock (reserved + issued from Store),
# N non-stock (bought directly for the order — no reservation), T text and
# D document (information lines: no material requirement at all).
PRODUCTION_BOM_ITEM_CATEGORIES = ("stock", "non_stock", "text", "document")
MATERIAL_ITEM_CATEGORIES = ("stock", "non_stock")

# Routing control key (CA01, SAP PP01 / PP02): internal = own workstation;
# external = subcontracted to a job-work vendor (material goes out on a
# job-work challan and must come back before the step is confirmed).
PRODUCTION_CONTROL_KEYS = ("internal", "external")
# Confirmation (SAP control key "confirmation" field): required = the step
# needs a yield confirmation (good qty booked) before it can be completed;
# optional = may be completed without one; none = milestone, no time logs.
PRODUCTION_CONFIRMATION_TYPES = ("required", "optional", "none")


class ProductionBom(Base, TimestampMixin, SoftDeleteMixin):
    """Bill of materials + routing for one product (a Store item). Components
    are Store items too, so a work order's material requirement can be
    issued straight from the stock ledger. At most one version per product
    is `active` at a time."""

    __tablename__ = "production_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
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
    # eBOM -> mBOM transfer: the released Design (engineering) BOM revision
    # this version's components were taken from. The label is a snapshot, so
    # the link still reads "DBOM-… B2" after Design supersedes it.
    design_bom_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_boms.id"), index=True, nullable=True)
    design_bom_revision_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_bom_revisions.id"), index=True, nullable=True)
    design_revision_label: Mapped[str | None] = mapped_column(String(10), nullable=True)
    transferred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transferred_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # CS02 validity + change number. A work order planned to start outside
    # [valid_from, valid_to] can't use this version. change_number is the
    # ECN number (ecn_id) that created it, or a free change reference.
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    change_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ecn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_change_notices.id"), index=True, nullable=True)
    # ECN effectivity copied on creation: immediate / date / next_order /
    # serial / project. For "serial", machines numbered below
    # effective_serial keep being built to the previous version.
    effectivity_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    effective_serial: Mapped[str | None] = mapped_column(String(100), nullable=True)

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
    # NULL only on text / document lines.
    component_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    scrap_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Copied from the Design BOM line on transfer ("make" / "buy"); NULL on
    # lines keyed in Production (e.g. shop consumables).
    make_buy: Mapped[str | None] = mapped_column(String(10), nullable=True)
    item_category: Mapped[str] = mapped_column(String(20), default="stock", server_default="stock", nullable=False)
    # Text line content / the drawing a document line points at.
    line_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("design_documents.id"), nullable=True)
    # Where the line came from when it was merged in from a discipline BOM
    # (CWBPP): e.g. "HYD HB-2026-0001 rev A" / "ELEC EJ-2026-0003".
    source_tag: Mapped[str | None] = mapped_column(String(255), nullable=True)

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
    # Control key (see PRODUCTION_CONTROL_KEYS / PRODUCTION_CONFIRMATION_TYPES).
    control_key: Mapped[str] = mapped_column(String(20), default="internal", server_default="internal", nullable=False)
    confirmation: Mapped[str] = mapped_column(String(20), default="optional", server_default="optional", nullable=False)
    print_on_job_card: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    # External (subcontracted) step: the job-work vendor and its charge per unit.
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True)
    external_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    bom: Mapped["ProductionBom"] = relationship("ProductionBom", back_populates="operations")


class ProductionBomDisciplineMerge(Base, TimestampMixin):
    """CWBPP: one electrical job BOM or hydraulic BOM merged into a Production
    BOM. `quantities` ({item_id: qty per base_quantity}) is what this merge
    added, so merging the same source again (after it was revised) first
    takes the old quantities back off instead of double-counting."""

    __tablename__ = "production_bom_discipline_merges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("production_boms.id"), index=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)  # electrical | hydraulic
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    source_label: Mapped[str] = mapped_column(String(255), nullable=False)
    quantities: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    merged_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
