from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Text, ForeignKey, DateTime
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
    official_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    official_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    contacts: Mapped[list["OrgContact"]] = relationship(
        "OrgContact", back_populates="organization", cascade="all, delete-orphan"
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
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="contacts")
