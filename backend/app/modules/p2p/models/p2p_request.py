from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment

# Lifecycle of a standalone P2P Request raised directly by any
# department (distinct from app.modules.purchase, which only handles PRs
# raised out of a Service Request's Materials tab).
#
#   submitted -> approved -> po_raised -> partially_received -> received -> closed
#            \-> rejected            \-> cancelled
P2P_REQUEST_STATUSES = (
    "submitted", "approved", "po_raised",
    "partially_received", "received", "closed",
    "rejected", "cancelled",
)

P2P_REQUEST_PRIORITIES = ("low", "medium", "high")

# Category code -> display label. Codes feed directly into the PR number
# format P2P-[CODE]-[YEAR]-[NUMBER].
P2P_CATEGORIES: dict[str, str] = {
    "MKT": "Market Items",
    "PNH": "Pneumatic & Hydraulic",
    "RAW": "Raw Material",
    "ELE": "Electrical",
    "HWC": "Hardware & Consumables",
    "JOB": "Job Work",
    "OTH": "Others",
}

# Buyer auto-assigned at PR creation based on category — replaces manually
# picking a buyer from the Purchase Processing panel. User ids are fixed
# per the current buyer roster; re-map here if buyers change.
P2P_CATEGORY_AUTO_BUYERS: dict[str, int] = {
    "MKT": 127,  # Suraj Panwar
    "PNH": 127,  # Suraj Panwar
    "RAW": 127,  # Suraj Panwar
    "ELE": 174,  # Manish Kumar
    "HWC": 137,  # Mahender Singh
    "JOB": 130,  # Gaurav Katiyar
}

P2P_REQUIREMENT_TYPES = ("Material", "Service", "Material + Service", "Capital Equipment", "Others")


class P2PRequest(Base, TimestampMixin):
    """A standalone P2P request raised by any department, tracked and
    processed end-to-end by the Purchase team. Fully independent of the
    `purchase` module's `PurchaseRequisition` (which is scoped to Service
    Request materials only)."""

    __tablename__ = "p2p_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    category_code: Mapped[str] = mapped_column(String(10), nullable=False)

    # Request Details
    project_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    required_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    requirement_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    request_date: Mapped[date] = mapped_column(Date, nullable=False)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # Approval — three independent sign-offs, each optional (a PR with none
    # assigned falls back to the old "anyone with purchase access" behavior).
    # `approver_id`/`approver_name` is the Department Head slot (kept under
    # its original name for backward compatibility with the auto-assign-by-
    # department flow already wired to it); Project Head and Plant Head are
    # picked explicitly on the New PR form via search-select.
    priority: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)
    approver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approver_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    department_head_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    department_head_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_head_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    project_head_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    project_head_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    project_head_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    plant_head_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    plant_head_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    plant_head_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    plant_head_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejected_by_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="submitted", nullable=False)

    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Purchase Processing — Buyer Assignment
    assigned_buyer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    assignment_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Purchase Processing — Vendor & RFQ
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rfq_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quotation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quotation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_comparison: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Purchase Processing — PO Details
    po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    po_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_delivery: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Purchase Processing — Receiving
    ordered_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    receipt_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    grn_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    receiving_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["P2PRequestItem"]] = relationship(
        "P2PRequestItem", back_populates="p2p_request", cascade="all, delete-orphan"
    )
    attachments: Mapped[list["P2PRequestAttachment"]] = relationship(
        "P2PRequestAttachment", back_populates="p2p_request", cascade="all, delete-orphan"
    )

    @property
    def pending_quantity(self) -> float | None:
        if self.ordered_quantity is None:
            return None
        return max(0.0, self.ordered_quantity - (self.received_quantity or 0))

    # (assigned_id, name field, approved_at field, role key) for each of the
    # three approver slots — a slot with no id assigned isn't required.
    _APPROVAL_SLOTS = ("department_head", "project_head", "plant_head")

    @property
    def assigned_approver_ids(self) -> dict[str, int]:
        return {
            role: getattr(self, "approver_id" if role == "department_head" else f"{role}_id")
            for role in self._APPROVAL_SLOTS
            if getattr(self, "approver_id" if role == "department_head" else f"{role}_id") is not None
        }

    @property
    def pending_approval_roles(self) -> list[str]:
        return [
            role for role, _id in self.assigned_approver_ids.items()
            if getattr(self, f"{role}_approved_at") is None
        ]
