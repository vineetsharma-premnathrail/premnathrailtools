from __future__ import annotations
from datetime import date
from decimal import Decimal
from sqlalchemy import String, Integer, Boolean, Text, Date, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

ASSET_CATEGORIES = (
    "laptop", "desktop", "mobile", "sim", "tablet", "monitor", "vehicle",
    "id_card", "access_card", "furniture", "tool", "other",
)
ASSET_STATUSES = ("in_stock", "issued", "under_repair", "retired", "lost")
ASSET_CONDITIONS = ("new", "good", "fair", "poor", "damaged")


class HrAsset(Base, TimestampMixin):
    """Company asset issued to employees (laptops, SIMs, ID cards...).
    asset_code defaults to AST-NNNN but is editable."""

    __tablename__ = "hr_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warranty_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="in_stock", server_default="in_stock", index=True, nullable=False)
    condition: Mapped[str | None] = mapped_column(String(20), nullable=True)
    current_holder_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    assignments: Mapped[list["HrAssetAssignment"]] = relationship(
        "HrAssetAssignment", back_populates="asset", order_by="HrAssetAssignment.issued_on.desc()",
    )


class HrAssetAssignment(Base, TimestampMixin):
    __tablename__ = "hr_asset_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("hr_assets.id"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    issued_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expected_return_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    condition_on_issue: Mapped[str | None] = mapped_column(String(20), nullable=True)
    returned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    condition_on_return: Mapped[str | None] = mapped_column(String(20), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    asset: Mapped["HrAsset"] = relationship("HrAsset", back_populates="assignments")
