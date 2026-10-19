"""Work permits / safety measures on maintenance work orders (SAP WCM:
work clearance, permit-to-work, LOTO).

    issued ──activate──▶ active ──close──▶ closed
       └────────── cancel ─────────┘ (cancelled)

`issued`: the permit issuer (maintenance planner) wrote the hazards,
isolation points and precautions. `active`: the job's technician accepted
it at site, isolation is in place — the job may now start. `closed`: work
done, isolation removed, area handed back — the job may now complete."""
from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

MAINTENANCE_PERMIT_TYPES = ("hot_work", "height", "confined_space", "electrical_isolation", "general")
MAINTENANCE_PERMIT_TYPE_LABELS = {
    "hot_work": "Hot work (welding / cutting / grinding)",
    "height": "Work at height",
    "confined_space": "Confined space entry",
    "electrical_isolation": "Electrical isolation (LOTO)",
    "general": "General work permit",
}
MAINTENANCE_PERMIT_STATUSES = ("issued", "active", "closed", "cancelled")
MAINTENANCE_PERMIT_LIVE_STATUSES = ("issued", "active")


class MaintenanceWorkPermit(Base, TimestampMixin):
    __tablename__ = "maintenance_work_permits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    permit_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    permit_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="issued", nullable=False)

    work_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    hazards: Mapped[str | None] = mapped_column(Text, nullable=True)
    isolation_points: Mapped[str | None] = mapped_column(Text, nullable=True)
    precautions: Mapped[str | None] = mapped_column(Text, nullable=True)
    ppe_required: Mapped[str | None] = mapped_column(Text, nullable=True)

    issued_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    accepted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    isolation_removed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    close_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Bumped on every change, so the managed Word permit is regenerated.
    document_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
