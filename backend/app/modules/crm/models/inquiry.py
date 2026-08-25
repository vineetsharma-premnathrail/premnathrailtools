from __future__ import annotations
from typing import TYPE_CHECKING
from datetime import date, datetime
from sqlalchemy import String, Integer, Text, Float, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

if TYPE_CHECKING:
    from app.modules.crm.models.organization import Organization


class Inquiry(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_inquiries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    universal_id: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)

    org_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    org_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)

    railway_zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    division: Mapped[str | None] = mapped_column(String(150), nullable=True)
    lead_source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bd_owner: Mapped[str | None] = mapped_column(String(150), nullable=True)
    sales_engineer: Mapped[str | None] = mapped_column(String(150), nullable=True)

    status: Mapped[str] = mapped_column(String(50), default="Requirement Received", nullable=False)
    current_stage: Mapped[str] = mapped_column(String(50), default="Customer Requirement", nullable=False)

    product: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_spec: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requirement_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    detailed_requirement: Mapped[str | None] = mapped_column(Text, nullable=True)
    inspection_req: Mapped[str | None] = mapped_column(String(255), nullable=True)
    warranty_req: Mapped[str | None] = mapped_column(String(255), nullable=True)

    budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    probability: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="Medium", nullable=False)

    next_followup_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    followup_priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    followup_assigned_to: Mapped[str | None] = mapped_column(String(150), nullable=True)
    followup_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="inquiries")
    tasks: Mapped[list["InquiryTask"]] = relationship(
        "InquiryTask", back_populates="inquiry", cascade="all, delete-orphan"
    )
    approvals: Mapped[list["InquiryApproval"]] = relationship(
        "InquiryApproval", back_populates="inquiry", cascade="all, delete-orphan"
    )
    quotations: Mapped[list["Quotation"]] = relationship(
        "Quotation", back_populates="inquiry", cascade="all, delete-orphan"
    )


class InquiryTask(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "crm_inquiry_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inquiry_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_inquiries.id"), nullable=False, index=True)
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    task_title: Mapped[str] = mapped_column(String(255), nullable=False)
    assigned_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_user_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="Medium", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Pending", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    inquiry: Mapped["Inquiry"] = relationship("Inquiry", back_populates="tasks")


class InquiryApproval(Base):
    __tablename__ = "crm_inquiry_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inquiry_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_inquiries.id"), nullable=False, index=True)
    approval_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Pending", nullable=False)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str] = mapped_column(String(20), default="1")
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    inquiry: Mapped["Inquiry"] = relationship("Inquiry", back_populates="approvals")


class Quotation(Base):
    __tablename__ = "crm_quotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    inquiry_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_inquiries.id"), nullable=False, index=True)
    quot_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    version: Mapped[str] = mapped_column(String(20), default="V1")
    revision_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quotation_type: Mapped[str] = mapped_column(String(20), default="Domestic", nullable=False)
    gst_type: Mapped[str] = mapped_column(String(20), default="CGST_SGST", nullable=False)
    quote_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    client_contact_email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    client_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_time: Mapped[str | None] = mapped_column(String(150), nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    customer_response: Mapped[str] = mapped_column(String(30), default="— Awaiting —")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    inquiry: Mapped["Inquiry"] = relationship("Inquiry", back_populates="quotations")
    items: Mapped[list["QuotationLineItem"]] = relationship(
        "QuotationLineItem", back_populates="quotation", cascade="all, delete-orphan", order_by="QuotationLineItem.sort_order"
    )


class QuotationLineItem(Base):
    __tablename__ = "crm_quotation_line_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    quotation_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_quotations.id"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_number: Mapped[str | None] = mapped_column(String(150), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    gst_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    subtotal: Mapped[float | None] = mapped_column(Float, nullable=True)
    total: Mapped[float | None] = mapped_column(Float, nullable=True)

    quotation: Mapped["Quotation"] = relationship("Quotation", back_populates="items")
