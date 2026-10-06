from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# requested (call raised on the agency) → scheduled (agency gave a date /
# inspector) → accepted | partially_accepted | rejected (result recorded,
# never edited afterwards) ; cancelled while requested/scheduled.
QUALITY_CALL_STATUSES = ("requested", "scheduled", "accepted", "partially_accepted", "rejected", "cancelled")
QUALITY_CALL_OPEN_STATUSES = ("requested", "scheduled")
QUALITY_CALL_RESULTS = ("accepted", "partially_accepted", "rejected")


class QualityInspectionCall(Base, TimestampMixin):
    """A customer / third-party inspection call (RITES, RDSO, the customer
    itself…) before dispatch. When the contract (ERP machine / order) is
    flagged third_party_inspection_required, the accepted call with its
    certificate is what releases the finished goods for dispatch (rule 8)."""

    __tablename__ = "quality_inspection_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    call_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(25), default="requested", index=True, nullable=False)

    # The contract: ERP machine / order (erp_projects) — its PO is the order.
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), index=True, nullable=True)
    order_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), index=True, nullable=False)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Final inspection lot the offered material passed (optional link).
    lot_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_inspection_lots.id"), nullable=True)

    # Quality → Settings → master list "inspection_agencies" (RITES / RDSO / Customer / Other).
    agency: Mapped[str] = mapped_column(String(50), nullable=False)
    requested_date: Mapped[date] = mapped_column(Date, nullable=False)
    call_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    inspector_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    result_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    accepted_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejected_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    certificate_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    certificate_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    certificate_file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    certificate_content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    result_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NCR raised for the quantity the agency rejected (rule 5).
    ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    result_recorded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    result_recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
