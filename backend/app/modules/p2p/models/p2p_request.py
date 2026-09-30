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
    from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval

# Lifecycle of a standalone P2P Request raised directly by any department —
# including PRs raised out of an ERP Service Request's Materials tab, which
# used to be handled by a separate app.modules.purchase module (removed;
# all PRs are now P2PRequest rows).
#
#   submitted -> approved -> vendor_quotations -> [technical_evaluation] ->
#   commercial_evaluation -> vendor_selected -> po_drafted -> po_raised ->
#   po_approved -> partially_received -> received -> closed
#            \-> rejected            \-> cancelled
#
# The RFQ tab (see models/rfq.py) is raised once a PR is "approved"; once
# that RFQ is submitted/locked the PR moves to "vendor_quotations" — buyer
# records structured VendorQuotation rows (see models/vendor_quotation.py)
# against it. "technical_evaluation" is skipped straight to
# "commercial_evaluation" when the RFQ's requires_technical_evaluation flag
# is False. "po_drafted" is an editable draft P2PPurchaseOrder (status
# 'draft') built from the selected vendor's quotation; finalizing it moves
# the PR to "po_raised" and the PO to status 'issued' — unchanged from here
# on (PO approval chain, GRN, Payment).
P2P_REQUEST_STATUSES = (
    "submitted", "approved",
    "vendor_quotations", "technical_evaluation", "commercial_evaluation",
    "vendor_selected", "po_drafted",
    "po_raised", "po_approved",
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
# picking a buyer from the Purchase Processing panel. Keyed by email, not a
# hardcoded user id: auto-increment ids get renumbered by any database
# restore or Azure re-sync (this broke PR creation in production with
# "Assigned buyer points to a record that no longer exists" the moment a
# restore changed every user's id), while email is stable. Re-map here if
# buyers change. Resolved to the current id via resolve_auto_buyer_id().
P2P_CATEGORY_AUTO_BUYERS: dict[str, str] = {
    "MKT": "suraj.panwar@premnathrail.com",
    "PNH": "suraj.panwar@premnathrail.com",
    "RAW": "suraj.panwar@premnathrail.com",
    "ELE": "manish.kumar@premnathrail.com",
    "HWC": "mahender.singh@premnathrail.com",
    "JOB": "gaurav.katiyar@premnathrail.com",
}


def resolve_auto_buyer_id(db, category_code: str) -> int | None:
    """Look up the auto-assigned buyer's current user id by email. Returns
    None (no buyer auto-assigned, PR still creates fine) if the category has
    no mapping or that email doesn't match any user, rather than letting a
    stale id 500 the whole PR creation."""
    email = P2P_CATEGORY_AUTO_BUYERS.get(category_code)
    if not email:
        return None
    from app.modules.main.models.user import User  # local import avoids a cross-module cycle at startup
    buyer = db.query(User).filter(User.email == email).first()
    return buyer.id if buyer else None

P2P_REQUIREMENT_TYPES = ("Material", "Service", "Material + Service", "Capital Equipment", "Others")

# Manager-role approval matrix (in force since 2026-09). Which manager roles
# sign a PR and a PO depends on whether the request is for an EXISTING project
# or a NEW project — the requester picks that explicitly on the New PR form
# (project_type below). PR approval: the requester names one user per role and
# ALL of them must approve. PO approval: it goes to every holder of every role
# in the set, and ANY ONE approval approves the PO.
#
# PRs created before this matrix have project_type = NULL and keep the legacy
# flow (Department/Project/Plant Head columns; Purchase Head -> Director -> MD
# PO chain) until they finish.
P2P_PROJECT_TYPES = ("existing", "new")

PR_APPROVAL_ROLE_SETS: dict[str, tuple[str, ...]] = {
    "existing": ("design_manager", "production_manager", "project_manager", "store_manager"),
    "new": ("rnd_manager", "production_manager", "store_manager"),
}

PO_APPROVAL_ROLE_SETS: dict[str, tuple[str, ...]] = {
    "existing": ("production_manager", "purchase_manager", "project_manager", "director"),
    "new": ("rnd_manager", "purchase_manager", "production_manager", "director"),
}

# Role key -> User boolean flag that marks a holder of the role.
P2P_ROLE_FLAGS: dict[str, str] = {
    "design_manager": "is_design_manager",
    "rnd_manager": "is_rnd_manager",
    "production_manager": "is_production_manager",
    "project_manager": "is_project_manager",
    "store_manager": "is_store_manager",
    "purchase_manager": "is_purchase_manager",
    "director": "is_director",
}

# Every User flag that makes someone a PO approver on SOME PR: the union of
# both matrix role sets plus the legacy Purchase Head / MD flags carried by
# in-flight pre-matrix PRs. Drives the P.O Approval tab visibility
# (is_po_approver on /auth/me).
P2P_PO_APPROVER_FLAGS: tuple[str, ...] = tuple(sorted(
    {P2P_ROLE_FLAGS[r] for roles in PO_APPROVAL_ROLE_SETS.values() for r in roles} | {"is_purchase_head", "is_md"}
))

# Display labels for every role key that can appear on a PR — the matrix
# roles plus the legacy ones still carried by in-flight PRs.
P2P_ROLE_LABELS: dict[str, str] = {
    "design_manager": "Design Manager",
    "rnd_manager": "R&D Manager",
    "production_manager": "Production Manager",
    "project_manager": "Project Manager",
    "store_manager": "Store Manager",
    "purchase_manager": "Purchase Manager",
    "director": "Director",
    "department_head": "Department Head",
    "project_head": "Project Head",
    "plant_head": "Plant Head",
    "purchase_head": "Purchase Head",
    "md": "MD",
}


class P2PRequest(Base, TimestampMixin):
    """A standalone P2P request raised by any department, tracked and
    processed end-to-end by the Purchase team — including PRs raised out of
    an ERP Service Request's Materials tab (see erp/routes/service_requests.py)."""

    __tablename__ = "p2p_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    category_code: Mapped[str] = mapped_column(String(10), nullable=False)

    # Request Details
    project_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 'existing' | 'new' — picks the approval role sets above. NULL on PRs
    # from before the manager-role matrix (legacy approval flow).
    project_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
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
    # PO approvers aren't assigned upfront the way the three heads above are —
    # whoever holds the purchase-head/director/MD flag at the time acts — so
    # the actor's name is stamped here as each stage is approved, otherwise
    # the PO Approval panel can only say a stage was approved, not by whom.
    purchase_head_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchase_head_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    purchase_head_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    director_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    director_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    director_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    md_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    md_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    md_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Manager-matrix PO approval (project_type set): any ONE holder of the
    # PR's PO role set approves, stamped here. The per-role columns above
    # stay for legacy PRs only.
    po_approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    po_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    po_approved_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    po_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    po_approval_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejected_by_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    rejected_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
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
    approvals: Mapped[list["P2PRequestApproval"]] = relationship(
        "P2PRequestApproval", back_populates="p2p_request", cascade="all, delete-orphan",
        order_by="P2PRequestApproval.id",
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
        if self.approvals:
            return {a.role: a.approver_id for a in self.approvals}
        return {
            role: getattr(self, "approver_id" if role == "department_head" else f"{role}_id")
            for role in self._APPROVAL_SLOTS
            if getattr(self, "approver_id" if role == "department_head" else f"{role}_id") is not None
        }

    @property
    def pending_approval_roles(self) -> list[str]:
        if self.approvals:
            return [a.role for a in self.approvals if a.approved_at is None]
        return [
            role for role, _id in self.assigned_approver_ids.items()
            if getattr(self, f"{role}_approved_at") is None
        ]

    @property
    def pending_po_approval_roles(self) -> list[str]:
        # Manager matrix: any-one-approves, so either nothing is pending (an
        # approval is stamped) or the whole role set is.
        if self.project_type in PO_APPROVAL_ROLE_SETS:
            return [] if self.po_approved_at else list(PO_APPROVAL_ROLE_SETS[self.project_type])
        return [
            role for role in ("purchase_head", "director", "md")
            if getattr(self, f"{role}_approved_at") is None
        ]
