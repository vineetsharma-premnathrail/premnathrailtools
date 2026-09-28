from __future__ import annotations
from sqlalchemy import String, Integer, Text, Boolean, Date, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class Company(Base, TimestampMixin):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Basic Information
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    legal_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True, index=True)
    short_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    company_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(100), nullable=True)
    business_nature: Mapped[str | None] = mapped_column(String(100), nullable=True)
    website: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_of_incorporation: Mapped[Date | None] = mapped_column(Date, nullable=True)
    country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    default_language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(60), nullable=True)

    # Legal & Registration
    legal_entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    legal_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    cin: Mapped[str | None] = mapped_column(String(21), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    tan: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    udyam_registration_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    iec: Mapped[str | None] = mapped_column(String(50), nullable=True)
    msme_registration_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pf_registration_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    esic_registration_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    other_registration_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    other_registration_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    other_registration_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    issuing_authority: Mapped[str | None] = mapped_column(String(150), nullable=True)
    expiry_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    authorized_capital: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    paid_up_capital: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    legal_representative: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Tax Configuration
    gst_registration_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tds_applicable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tcs_applicable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    default_tax_region: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tax_deductibility: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tax_registration_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tax_effective_date: Mapped[Date | None] = mapped_column(Date, nullable=True)

    # Branding
    logo_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    primary_brand_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    secondary_brand_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    company_header: Mapped[str | None] = mapped_column(Text, nullable=True)
    company_footer: Mapped[str | None] = mapped_column(Text, nullable=True)
    watermark: Mapped[str | None] = mapped_column(String(500), nullable=True)
    email_signature: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Company Defaults & Controls
    default_tax: Mapped[str | None] = mapped_column(String(100), nullable=True)
    default_plant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    default_warehouse_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    default_cost_center: Mapped[str | None] = mapped_column(String(100), nullable=True)
    default_profit_center: Mapped[str | None] = mapped_column(String(100), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
