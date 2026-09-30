from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → under_review → approved → superseded. Returning a circuit from
# review puts it back to draft. Only a draft can be edited; changing an
# approved circuit means raising its next revision, and approving that
# revision supersedes the previously approved one.
HYD_CIRCUIT_STATUSES = ("draft", "under_review", "approved", "superseded")


class HydCircuit(Base, TimestampMixin, SoftDeleteMixin):
    """A hydraulic or pneumatic circuit diagram (ISO 1219 schematic) for a
    system, under revision control. The drawing files themselves are
    HydDocuments attached to the circuit (entity_type "circuit"). Every
    revision is its own row sharing `circuit_number`."""

    __tablename__ = "hyd_circuits"
    __table_args__ = (UniqueConstraint("circuit_number", "revision", name="uq_hyd_circuits_number_revision"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    circuit_number: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    revision: Mapped[str] = mapped_column(String(10), default="A", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", nullable=False)
    system_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)

    drawing_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    symbol_standard: Mapped[str | None] = mapped_column(String(100), default="ISO 1219-1", nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
