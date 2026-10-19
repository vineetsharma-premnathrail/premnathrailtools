from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, Boolean, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# Vendors are free text across P2P / Store / Quality (POs, GRNs, lots, FAIs
# all carry vendor_name; the Accounts vendor master isn't wired to P2P yet).
# Supplier quality therefore keys a vendor by its normalized name
# (vendor_key = lower-cased, trimmed) — the same rule first_article uses —
# and keeps vendor_id (Accounts vendor master) as an optional link.

QUALITY_SUPPLIER_SCORECARD_STATUSES = ("draft", "final")

# Approved vendor list status per item × vendor.
#   trial → approved (first article approved, or Quality head approval for
#   items without FAI control) → on_watch (rating below the On-watch limit:
#   tightened sampling + vendor CAPA) → blocked (rating below the Blocked
#   limit, or a Quality head request — only with a Partner's approval).
# blocked: no new PO lines and no lot acceptance for that item from that vendor.
QUALITY_AVL_STATUSES = ("trial", "approved", "on_watch", "blocked")
QUALITY_AVL_STATUS_LABELS = {"trial": "Trial", "approved": "Approved", "on_watch": "On watch", "blocked": "Blocked"}

# ISO 2859-1 switching state per item × vendor (+ skip-lot for consistently
# good vendors). Kept on the AVL row and applied to every new lot.
QUALITY_SAMPLING_STATES = ("normal", "tightened", "reduced")

QUALITY_VENDOR_AUDIT_STATUSES = ("planned", "completed", "cancelled")
QUALITY_VENDOR_AUDIT_RESULTS = ("satisfactory", "conditional", "unsatisfactory")


class QualitySupplierScorecard(Base, TimestampMixin, SoftDeleteMixin):
    """Monthly vendor rating, computed automatically (services/supplier_quality
    compute_monthly_ratings): quality = accepted ÷ received over the month's
    decided incoming / job work / first-article lots; NCR score from the
    month's NCR count and severity; delivery = GRNs on or before the PO's
    expected delivery date. Weighted per Quality → Settings. One row per
    vendor per period (YYYY-MM); re-running the month refreshes it."""

    __tablename__ = "quality_supplier_scorecards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    # "2026-03" for monthly ratings (legacy free text like "2026-Q1" kept).
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    lots_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    received_qty: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)
    accepted_qty: Mapped[float] = mapped_column(Float, default=0, server_default="0", nullable=False)
    rejected_lots: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ncr_minor: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    ncr_major: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    ncr_critical: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    ncr_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    deliveries: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    on_time_deliveries: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    on_time_delivery_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Weights used (quality / delivery / ncr) — the settings can change later.
    weights: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # approved / on_watch / blocked band by the limits in force at the time.
    rating_band: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rejection_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ncr_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="draft", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class QualityApprovedVendor(Base, TimestampMixin):
    """Approved vendor list (AVL): one row per item × vendor. Rows are added
    automatically when a vendor first supplies an inspection-controlled
    item (Trial, or Approved when the vendor already has accepted history)
    or by hand. Status changes are logged in quality_vendor_status_events."""

    __tablename__ = "quality_approved_vendors"
    __table_args__ = (UniqueConstraint("item_id", "vendor_key", name="uq_quality_avl_item_vendor"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="trial", nullable=False, index=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # First article that approved the vendor for this item (Trial → Approved).
    fai_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_first_articles.id"), nullable=True)

    # Sampling switching (ISO 2859-1) and skip-lot.
    sampling_state: Mapped[str] = mapped_column(String(10), default="normal", server_default="normal", nullable=False)
    # Outcome of recent decided lots, newest last (True = accepted) — max 10.
    recent_lots: Mapped[list | None] = mapped_column(JSON, nullable=True)
    consecutive_accepted: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    skip_lot_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    lots_since_inspected: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    # Block request waiting for a Partner (rating below the Blocked limit or
    # raised by a Quality head). Unblocking also needs a Partner.
    pending_action: Mapped[str | None] = mapped_column(String(10), nullable=True)  # block | unblock
    pending_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    pending_requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    pending_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_rated_period: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class QualityVendorStatusEvent(Base, TimestampMixin):
    """History of an AVL row: status changes, block requests and decisions,
    sampling switches."""

    __tablename__ = "quality_vendor_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    avl_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_approved_vendors.id"), index=True, nullable=False)
    event: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class QualityVendorAudit(Base, TimestampMixin):
    """Vendor audit: scheduled, then completed with score / result and
    findings (Phase 4 may extend this into the general audit module)."""

    __tablename__ = "quality_vendor_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audit_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    planned_date: Mapped[date] = mapped_column(Date, nullable=False)
    auditor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    audit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    result: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # [{"type": "major|minor|observation", "description": "…"}]
    findings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    capa_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_capas.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
