from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Shared master between Purchase (transactional: PR/PO issuance against a
# vendor) and Vendor Development (qualification: onboarding, certification,
# AVL status) — one table, split ownership. See
# docs/product/PURCHASE_DEPARTMENT_MODULE_PLAN.md Phase 1.
VENDOR_CATEGORIES = ("materials", "services", "both")
VENDOR_STATUSES = ("active", "blacklisted", "under_review")
VENDOR_QUALIFICATION_STATUSES = ("pending", "qualified", "disqualified")
SUPPLIER_GROUPS = (
    "Distributor", "Electrical", "Hardware", "Local", "Raw Material",
    "Services", "Pneumatic", "Hydraulic", "Consumable", "Market",
)


class Vendor(Base, TimestampMixin):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    category: Mapped[str] = mapped_column(String(20), default="materials", nullable=False)
    payment_terms: Mapped[str | None] = mapped_column(String(150), nullable=True)
    bank_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)

    # Vendor Development-owned fields — Purchase reads qualification_status
    # as a hard gate before PO issuance (Phase 2), doesn't write it.
    qualification_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    is_avl: Mapped[bool] = mapped_column(default=False, nullable=False)
    last_audit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_audit_score: Mapped[float | None] = mapped_column(nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # P2P Supplier quick-create form fields.
    supplier_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    supplier_group: Mapped[str | None] = mapped_column(String(30), nullable=True)
    gst_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    contact_first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_mobile: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_draft: Mapped[bool] = mapped_column(default=False, nullable=False)
