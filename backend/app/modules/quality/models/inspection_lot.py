from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# created → in_inspection → results_recorded → decision_made → closed.
# cancelled only from created/in_inspection on a manual lot with no stock.
# A lot is never edited after decision_made (rule 10) — corrections are a
# new lot (re-inspection) or an NCR.
QUALITY_LOT_STATUSES = ("created", "in_inspection", "results_recorded", "decision_made", "closed", "cancelled")
QUALITY_LOT_OPEN_STATUSES = ("created", "in_inspection", "results_recorded")

# What created the lot. grn / work_order are automatic (store receipts of
# items flagged inspection_on_receipt), ncr = re-inspection after rework /
# repair, manual = raised by hand from Quality → Inspection Lots.
# work_order_operation = in-process gate on a routing step (Phase 2; no
# stock behind it), material_return = job work receipt back from a vendor.
QUALITY_LOT_SOURCES = ("grn", "work_order", "ncr", "manual", "work_order_operation", "material_return")

# Usage decision. partial = part accepted (→ Free), part rejected (→ Blocked).
QUALITY_LOT_DECISIONS = ("accept", "accept_with_deviation", "reject", "partial")
QUALITY_LOT_DECISION_LABELS = {
    "accept": "Accept", "accept_with_deviation": "Accept with deviation",
    "reject": "Reject (full)", "partial": "Reject (partial)",
}

QUALITY_RESULT_VALUES = ("pass", "fail")


class QualityInspectionLot(Base, TimestampMixin):
    """One inspection of one quantity of one item at one inspection point.
    Holds the quantity in QUALITY stock (when it came from a store receipt)
    until the usage decision moves it to FREE / BLOCKED."""

    __tablename__ = "quality_inspection_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    inspection_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="created", nullable=False, index=True)

    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    grn_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_goods_receipt_items.id"), nullable=True, index=True)
    # Re-inspection lots: the NCR whose rework/repair this lot verifies.
    # Plain id (no FK) — quality_ncrs already points at this table, and a
    # two-way FK cycle breaks metadata create/drop ordering.
    ncr_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False, index=True)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Store location whose QUALITY stock holds this lot. NULL = the lot has
    # no stock behind it (manual lot for a check only) — decisions then
    # don't post stock.
    location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    stock_in_quality: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    plan_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_plans.id"), nullable=True)
    plan_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sampling_severity: Mapped[str] = mapped_column(String(10), default="normal", nullable=False)
    sample_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    test_certificate_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    test_certificate_received: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    test_certificate_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)

    assigned_to_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    results_recorded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    results_recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    decision: Mapped[str | None] = mapped_column(String(30), nullable=True)
    accepted_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejected_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    deviation_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lot_date: Mapped[date] = mapped_column(Date, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    results: Mapped[list["QualityLotResult"]] = relationship(
        "QualityLotResult", back_populates="lot", cascade="all, delete-orphan", order_by="QualityLotResult.sequence",
    )


class QualityLotResult(Base, TimestampMixin):
    """One characteristic of the attached plan, copied onto the lot when the
    plan is attached (so later plan revisions never change it), plus what
    the inspector found. Variable characteristics take a list of measured
    values; attribute ones take a defect count. The system evaluates
    pass/fail against min/max and the accept number."""

    __tablename__ = "quality_lot_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), index=True, nullable=False)
    plan_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_plan_lines.id"), nullable=True)
    characteristic_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_characteristics.id"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    characteristic_name: Mapped[str] = mapped_column(String(200), nullable=False)
    char_type: Mapped[str] = mapped_column(String(20), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    method: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nominal: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    aql: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_size: Mapped[int] = mapped_column(Integer, nullable=False)
    accept_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reject_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    measured_values: Mapped[list | None] = mapped_column(JSON, nullable=True)
    defects_found: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    defect_code_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_defect_codes.id"), nullable=True)
    # Gauge master arrives in Phase 4 (which also enforces rule 3 — only an
    # in-calibration gauge may be used); until then this is a free id.
    gauge_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gauge_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lot: Mapped["QualityInspectionLot"] = relationship("QualityInspectionLot", back_populates="results")
