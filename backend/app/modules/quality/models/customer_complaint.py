from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

QUALITY_COMPLAINT_SEVERITIES = ("minor", "major", "critical")

# Where the complaint came in. service_ticket: the Service module has no
# tickets yet — the ticket number is kept as a reference (service_ticket_ref)
# and service_ticket_id is reserved for the link once tickets exist.
QUALITY_COMPLAINT_SOURCES = ("service_ticket", "email", "inspection_report", "phone", "site_visit", "other")
QUALITY_COMPLAINT_SOURCE_LABELS = {
    "service_ticket": "Service ticket", "email": "Email / letter", "inspection_report": "Customer inspection report",
    "phone": "Phone call", "site_visit": "Site visit", "other": "Other",
}

# open (logged) → under_investigation (NCR + CAPA raised, traceability and
# containment) → response_sent (8D / reply sent to the customer) →
# customer_accepted → closed (only once the CAPA is closed effective).
# rejected = not a valid complaint (reason recorded). Legacy capa_assigned
# was migrated to under_investigation, resolved to response_sent.
QUALITY_COMPLAINT_STATUSES = ("open", "under_investigation", "response_sent", "customer_accepted", "closed", "rejected")
QUALITY_COMPLAINT_OPEN_STATUSES = ("open", "under_investigation", "response_sent", "customer_accepted")
QUALITY_COMPLAINT_STATUS_LABELS = {
    "open": "Logged", "under_investigation": "Under investigation", "response_sent": "Response sent",
    "customer_accepted": "Customer accepted", "closed": "Closed", "rejected": "Rejected (not valid)",
}


class QualityCustomerComplaint(Base, TimestampMixin, SoftDeleteMixin):
    """A customer complaint against delivered goods: logged with the item and
    serial / batch, traced back through production / inspection / GRN,
    contained (same batch in stock and at customers), investigated through an
    NCR + CAPA, answered (8D) and closed when the customer accepts and the
    CAPA is effective. Tracks response time, repeats and cost."""

    __tablename__ = "quality_customer_complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(30), default="email", server_default="email", nullable=False)
    source_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    service_ticket_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Plain int, no FK — CRM organizations aren't guaranteed reachable from here.
    customer_org_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ERP machine / order (the contract) the complaint is about.
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True, index=True)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    quantity_affected: Mapped[float | None] = mapped_column(Float, nullable=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    defect_code_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_defect_codes.id"), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="minor", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="open", nullable=False)
    complaint_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Investigation — NCR + CAPA raised when the investigation starts.
    ncr_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("quality_ncrs.id"), nullable=True)
    # Plain id (no FK) — quality_capas.complaint_id already points here and a
    # two-way FK cycle breaks metadata create / drop ordering.
    capa_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    investigation_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    containment_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Repeat: an earlier complaint for the same customer + item in the window.
    repeat_of_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Customer response.
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response_sent_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    customer_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    customer_acceptance_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Cost of the complaint (₹).
    replacement_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    travel_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    rework_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    other_cost: Mapped[float | None] = mapped_column(Float, nullable=True)

    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)


class QualityComplaintPhoto(Base, TimestampMixin):
    """A photo of the failed part / site, stored in SharePoint like lot photos."""

    __tablename__ = "quality_complaint_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_id: Mapped[int] = mapped_column(Integer, ForeignKey("quality_customer_complaints.id"), index=True, nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caption: Mapped[str | None] = mapped_column(String(255), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
