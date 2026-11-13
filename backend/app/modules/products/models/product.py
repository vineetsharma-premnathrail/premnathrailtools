from __future__ import annotations
from sqlalchemy import Column, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.products.models.application import ProductApplication

# Product types are fixed (coded): they decide how a product is built and
# serviced — a vehicle has a chassis/engine and is commissioned on track, an
# attachment is fitted to another product; a paid service is work we sell
# (repair, overhaul, AMC, operator hire) with no physical product built.
# An application (2026-10-28) is an add-on sold with a product only when the
# customer asks for it — same master, same form, picked on a quotation line.
#
# 2026-11-12 (owner): only three types — Rail-road vehicle, Rail bound vehicle,
# Application. Machine / equipment / attachment / paid-service products were
# moved by migration d7a2c5e9b1f4 (attachment → application, the rest → vehicle).
# Codes are no longer typed: each type has its own running number 01, 02, 03 …
# (products/numbering.py), so the same number exists once per type.
PRODUCT_TYPES = ("vehicle", "rail_bound_vehicle", "application")
PRODUCT_TYPE_LABELS = {
    "vehicle": "Rail-road vehicle", "rail_bound_vehicle": "Rail bound vehicle", "application": "Application",
}

# Product lifecycle (standard PLM states). Only `active` products should be
# offered when quoting or selling; `phased_out` is still serviced but no
# longer sold new; `discontinued` is closed for everything except history.
PRODUCT_STATUSES = ("development", "active", "phased_out", "discontinued")
PRODUCT_STATUS_LABELS = {
    "development": "In development", "active": "Active", "phased_out": "Phased out", "discontinued": "Discontinued",
}

product_application_links = Table(
    "product_application_links",
    Base.metadata,
    Column("product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    Column("application_id", ForeignKey("product_applications.id", ondelete="CASCADE"), primary_key=True),
)


class FinishedProduct(Base, TimestampMixin):
    """Finished product the company manufactures and sells (e.g. RRB Sanding
    Vehicle, Scissor Lift) — the product master. The physical stock/BOM key
    is a Store item; `store_item_id` links the two so Design/Production BOMs
    and Sales order lines (which key on store_items) can be traced back here."""

    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("product_type", "code", name="uq_products_type_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Running number within the product type (01, 02 …), given by the system.
    code: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    # The hand-typed code it had before the 2026-11-12 renumbering (e.g. PRT-RRV-AUG),
    # kept so old documents / searches still find it.
    old_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    product_type: Mapped[str] = mapped_column(String(30), nullable=False)
    model_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    short_description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Technical specifications as free text, one per line (2026-10-28; replaced the
    # parameter / value / unit rows in product_specifications, which stay for history).
    technical_specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    # GST classification + selling unit — what an invoice line needs.
    hsn_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    uom: Mapped[str] = mapped_column(String(20), default="Nos", server_default="Nos", nullable=False)
    # Default warranty given on a new unit; Service uses it as the starting
    # point for a machine's warranty end date.
    warranty_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    applications: Mapped[list[ProductApplication]] = relationship(secondary=product_application_links, order_by=ProductApplication.name)
    specifications: Mapped[list["ProductSpecification"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductSpecification.sort_order",
    )
    store_item = relationship("StoreItem", foreign_keys=[store_item_id])
    created_by = relationship("User", foreign_keys=[created_by_id])


class ProductSpecification(Base):
    """One technical parameter of a product (e.g. Max speed on rail = 40 km/h).
    Kept as rows rather than fixed columns because each product type has a
    different parameter set."""

    __tablename__ = "product_specifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    parameter: Mapped[str] = mapped_column(String(150), nullable=False)
    value: Mapped[str] = mapped_column(String(200), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)

    product: Mapped[FinishedProduct] = relationship(back_populates="specifications")
