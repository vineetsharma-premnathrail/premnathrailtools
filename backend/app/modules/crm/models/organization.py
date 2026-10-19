from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, String, Integer, Text, Float, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender


class Organization(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_code: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    org_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    parent_org: Mapped[str | None] = mapped_column(String(255), nullable=True)
    railway_zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    division_workshop: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(String(50), default="India")
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gst_number: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True)
    # BP master (SAP VD01 tax data): PAN = GSTIN chars 3-12 when both are set;
    # gst_state_code = GSTIN chars 1-2 (else the state name) — the default place
    # of supply on sales orders / invoices for this customer.
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    gst_state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    official_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    official_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    additional_phones: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True, default=list)
    additional_emails: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True, default=list)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Accounts module — this organization acting as a customer master for AR.
    # See old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 1.
    credit_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    credit_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    discount_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    gl_reconciliation_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)

    contacts: Mapped[list["OrgContact"]] = relationship(
        "OrgContact", back_populates="organization", cascade="all, delete-orphan"
    )
    addresses: Mapped[list["OrgAddress"]] = relationship(
        "OrgAddress", back_populates="organization", cascade="all, delete-orphan", order_by="OrgAddress.id"
    )
    inquiries: Mapped[list["Inquiry"]] = relationship("Inquiry", back_populates="organization")
    tenders: Mapped[list["Tender"]] = relationship("Tender", back_populates="organization")


class OrgContact(Base):
    __tablename__ = "crm_org_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    designation: Mapped[str | None] = mapped_column(String(150), nullable=True)
    mobile: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    additional_mobiles: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True, default=list)
    additional_emails: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True, default=list)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # The ship-to / consignee / bill-to address this person works at (null = head office).
    address_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_addresses.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="contacts")


# Partner functions (SAP SH ship-to / consignee, BP bill-to, PY payer).
ORG_ADDRESS_TYPES = ("ship_to", "consignee", "bill_to", "payer")


class OrgAddress(Base, TimestampMixin):
    """One extra address of a customer — a ship-to / consignee (Railway depot,
    shed or workshop), a bill-to or a paying-authority office — each with its
    own GSTIN and state, picked on the sales order delivery schedule."""

    __tablename__ = "crm_org_addresses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    address_type: Mapped[str] = mapped_column(String(20), default="ship_to", nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(30), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="addresses")
