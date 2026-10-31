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
    from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover

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
# Before "approved" the status is the requester's / approver's workflow state
# (draft, submitted, returned, rejected, cancelled). From "approved" onwards it
# is only a ROLL-UP SUMMARY of the work underneath, written solely by
# p2p/po_split.rollup_pr_status (2026-10-31, multi-buyer split): one
# requisition has several lines, each line may have its own buyer, RFQ
# (models/rfq.py + rfq_item.py), qty-split awards (vendor_quotation.py) and
# several purchase orders. Per-line progress (ordered / received / short-closed)
# is computed from PO + GRN lines, never stored. Nothing in procurement may gate
# on this status except po_split.is_procurement_open(pr); the stages named in
# the arrow chain above (vendor_quotations ... received) are labels of the
# summary, not steps one document walks through.
P2P_REQUEST_STATUSES = (
    "submitted", "approved",
    "vendor_quotations", "technical_evaluation", "commercial_evaluation",
    "vendor_selected", "po_drafted",
    "po_raised", "po_approved",
    "partially_received", "received", "closed",
    "rejected", "cancelled",
    # An approver sent the requisition back for changes (or the requester
    # withdrew it from approval) — the requester resubmits or cancels it.
    "returned",
    # Saved by the requester without submitting (2026-10-13): visible only to
    # them, no approval started, no validation beyond category. Submitted
    # later from the edit form.
    "draft",
)

# A requisition's content (header + lines) can be edited until purchasing
# starts work on it — i.e. until an RFQ exists for it. Editing one that is in
# approval or already approved withdraws that approval: the changed PR is
# saved as a draft or sent for approval afresh (see edit_p2p_request).
P2P_EDITABLE_STATUSES = ("draft", "returned", "submitted", "approved")

P2P_REQUEST_PRIORITIES = ("standard", "urgent")

# Category code of a requisition whose lines decide what is bought (see below).
LINE_CATEGORY = "ITM"

# Category code -> display label. Codes fed the old PR number format
# P2P-[CODE]-[YEAR]-[NUMBER] (requisitions raised before 2026-10-27).
P2P_CATEGORIES: dict[str, str] = {
    "MKT": "Market Items",
    "PNH": "Pneumatic & Hydraulic",
    "RAW": "Raw Material",
    "ELE": "Electrical",
    "HWC": "Hardware & Consumables",
    "JOB": "Job Work",
    # 2026-10-23: office / running-cost buying (housekeeping, AMC, repairs).
    "SRV": "Services",
    "ADM": "Office & Admin",
    # Asset / capital purchases (machines, computers) — numbered P2P-CAP-.
    "CAP": "Capital Equipment",
    # Kept for requisitions raised before Purpose; never offered on a new one.
    "OTH": "Others",
    # 2026-10-27: the header category is gone from the PR form — each line's
    # Item Master type and category say what is bought (and pick its buyer).
    # New requisitions carry this code and are numbered P2P-[YEAR]-[NUMBER].
    LINE_CATEGORY: "By line item",
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
    """The buyer a new requisition of this category goes to: the one picked in
    Procurement › Settings › Buyer for each requisition category (2026-10-23),
    else the standard buyer above (looked up by email). None — no buyer
    auto-assigned, the PR still creates fine — when neither is an active user,
    rather than letting a stale id 500 the whole PR creation."""
    from app.modules.main.models.user import User  # local import avoids a cross-module cycle at startup
    from app.modules.p2p.settings import get_setting
    picked = (get_setting(db, f"buyer_{(category_code or '').lower()}")
              if category_code in P2P_CATEGORIES and category_code != LINE_CATEGORY else None)
    if picked:
        buyer = db.query(User).filter(User.id == int(picked), User.is_active.is_(True)).first()
        if buyer:
            return buyer.id
    return standard_buyer_id(db, category_code)


def standard_buyer_id(db, category_code: str, *, active_only: bool = False) -> int | None:
    """Current user id of the category's standard buyer (looked up by email),
    or None when the category has none or the user is missing. The one place
    that does this lookup."""
    from app.modules.main.models.user import User  # local import avoids a cross-module cycle at startup
    email = P2P_CATEGORY_AUTO_BUYERS.get(category_code)
    if not email:
        return None
    q = db.query(User).filter(User.email == email)
    if active_only:
        q = q.filter(User.is_active.is_(True))
    buyer = q.first()
    return buyer.id if buyer else None


# Buyer of a line by its Item Master item type (2026-10-27). The standard buyer
# of each type is the standard buyer of the category it is usually bought
# under (P2P_CATEGORY_AUTO_BUYERS); Procurement › Settings › Buyer for each item
# type overrides it. Types Store added beyond these use the "other" setting.
P2P_ITEM_TYPE_BUYER_TYPES: dict[str, str] = {
    "material": "Material",
    "consumable": "Consumable",
    "tool_equipment": "Tool / equipment",
    "service": "Service",
    "asset": "Asset",
    "other": "Any other item type",
}
P2P_ITEM_TYPE_STANDARD_CATEGORY: dict[str, str] = {
    "material": "RAW", "consumable": "HWC", "tool_equipment": "HWC", "service": "JOB",
}


def resolve_line_buyer_id(db, item_type: str | None) -> int | None:
    """The buyer a requisition line of this item type goes to: the one picked
    in Procurement › Settings, else the type's standard buyer. None when
    neither is an active user (the requisition's assigned buyer then applies)."""
    from app.modules.main.models.user import User  # local import avoids a cross-module cycle at startup
    from app.modules.p2p.settings import get_setting
    key = item_type if item_type in P2P_ITEM_TYPE_BUYER_TYPES else "other"
    picked = get_setting(db, f"buyer_type_{key}")
    if picked:
        buyer = db.query(User).filter(User.id == int(picked), User.is_active.is_(True)).first()
        if buyer:
            return buyer.id
    category = P2P_ITEM_TYPE_STANDARD_CATEGORY.get(key)
    return standard_buyer_id(db, category, active_only=True) if category else None

# Purpose of a requisition (2026-10-23) — the first question on the PR form.
# It decides what the purchase must be charged to (p2p/purpose.py):
#   customer_order   production of an ordered machine — its PM project;
#                    lines name their vehicle / lot
#   machine_project  service / repair of a delivered machine (ERP project)
#   development      new product development — an internal order
#   department       department running cost (office, housekeeping, small
#                    tools, AMC) — the department's cost centre
#   capital          asset / capital purchase — an internal order
#   stock            store stock refill — charged when Store issues it
# NULL on requisitions raised before it (they keep project_type rules).
P2P_PURPOSES: dict[str, str] = {
    "customer_order": "Project",
    "machine_project": "Service",
    "development": "New development",
    "department": "Department running cost",
    "capital": "Asset / capital purchase",
    "stock": "Store stock refill",
}

P2P_REQUIREMENT_TYPES = ("Material", "Service", "Material + Service", "Capital Equipment", "Others")

# Manager-role approval matrix (in force since 2026-09). Which manager roles
# sign a PR and a PO depends on whether the request is for an EXISTING project
# or a NEW project — the requester picks that explicitly on the New PR form
# (project_type below). PR approval: the requester names one user per role and
# ALL of them must approve. PO approval: it goes to every holder of every role
# in the set, and ANY ONE approval approves the PO.
#
# PRs created before this matrix have project_type = NULL and keep the legacy
# flow (Department/Project/Plant Head columns; Purchase Head -> Director -> Partner
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
# both matrix role sets plus the legacy Purchase Head / Partner flags carried by
# in-flight pre-matrix PRs. Drives the P.O Approval tab visibility
# (is_po_approver on /auth/me).
P2P_PO_APPROVER_FLAGS: tuple[str, ...] = ("is_director", "is_partner", "is_purchase_head")

# The PO-approval roles the requester fills with a named person on the New
# PR form — every role in the set except Director, which is a user flag and
# goes to every Director.
PO_PICKED_ROLE_SETS: dict[str, tuple[str, ...]] = {
    ptype: tuple(r for r in roles if r != "director") for ptype, roles in PO_APPROVAL_ROLE_SETS.items()
}

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
    "partner": "Partner",
    # Settings scheme slots (approval_scheme == "settings"): one row per person
    # in Procurement → Settings, keyed pr_approver_1.. / po_approver_1..
    **{f"pr_approver_{i}": "PR Approver" for i in range(1, 51)},
    **{f"po_approver_{i}": "PO Approver" for i in range(1, 51)},
}

# approval_scheme value for requisitions whose approvers come from
# Procurement → Settings (2026-10-07): all PR approvers must approve; the PO
# needs every Settings PO approver, then any ONE Partner (partner_* columns).
SETTINGS_SCHEME = "settings"
# approval_scheme for requisitions approved through the central approval
# engine (Organization › Approval Workflows, 2026-10-08) — every new PR, and
# every PR whose PO goes for approval after the move. Their approval state
# lives in approval_requests, not in the p2p_request_approvals /
# p2p_request_po_approvers tables (see app/modules/p2p/approvals.py).
ENGINE_SCHEME = "engine"


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
    # Account assignment (SAP ME51N account assignment category): what the
    # purchase is charged to. One of P2P_ACCOUNT_ASSIGNMENTS; exactly the
    # matching FK below is set. project_label stays as the display text.
    account_assignment: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    work_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_work_orders.id"), nullable=True)
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True)
    # R&D project the purchase is charged to (New development).
    rnd_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rnd_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    # PM project (2026-10-17): set when charged to 'order_project', and also
    # filled from the sales order's project when charged to a 'sales_order'.
    # The default for the lines; each line carries its own element.
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    # 'existing' | 'new' — picks the approval role sets above. NULL on PRs
    # from before the manager-role matrix (legacy approval flow).
    project_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # One of P2P_PURPOSES — what the purchase is for (see p2p/purpose.py).
    purpose: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 'settings' = approvers from Procurement → Settings (SETTINGS_SCHEME); NULL = the older
    # requester-picked matrix / legacy flows, kept for requisitions raised before it.
    approval_scheme: Mapped[str | None] = mapped_column(String(20), nullable=True)
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
    priority: Mapped[str] = mapped_column(String(10), default="standard", nullable=False)  # standard | urgent
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
    # whoever holds the purchase-head/director/Partner flag at the time acts — so
    # the actor's name is stamped here as each stage is approved, otherwise
    # the PO Approval panel can only say a stage was approved, not by whom.
    purchase_head_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purchase_head_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    purchase_head_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    director_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    director_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    director_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    partner_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    partner_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    partner_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Manager-matrix PO approval (project_type set): ALL roles must approve
    # (production_manager, purchase_manager, project_manager, director).
    # Named roles: tracked in po_approvers.approved_at. Director role:
    # tracked here since it's automatic (any ONE director approves).
    director_po_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    director_po_approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    director_po_approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    director_po_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Legacy field (deprecated): kept for backward compatibility with
    # reporting/audit; new matrix PRs use po_approvers + director fields above.
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
    po_approvers: Mapped[list["P2PRequestPOApprover"]] = relationship(
        "P2PRequestPOApprover", back_populates="p2p_request", cascade="all, delete-orphan",
        order_by="P2PRequestPOApprover.id",
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
        if self.approval_scheme == ENGINE_SCHEME:
            # Tracked by the approval engine; the PR status says it all.
            return []
        if self.approval_scheme == SETTINGS_SCHEME:
            # Level 1: every Settings PO approver; level 2: any one Partner.
            pending = [a.role for a in self.po_approvers if a.approved_at is None]
            if self.partner_approved_at is None:
                pending.append("partner")
            return pending
        # Manager matrix: ALL roles must approve (production_manager,
        # purchase_manager, project_manager, director). Check which are still pending.
        if self.project_type in PO_APPROVAL_ROLE_SETS:
            pending = []
            role_set = PO_APPROVAL_ROLE_SETS[self.project_type]
            for role in role_set:
                if role == "director":
                    if not self.director_po_approved_at:
                        pending.append(role)
                else:
                    approver_row = next((a for a in self.po_approvers if a.role == role), None)
                    if not approver_row or not approver_row.approved_at:
                        pending.append(role)
            return pending
        return [
            role for role in ("purchase_head", "director", "partner")
            if getattr(self, f"{role}_approved_at") is None
        ]
