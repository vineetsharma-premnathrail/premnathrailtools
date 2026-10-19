from __future__ import annotations
from sqlalchemy import Column, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.products.models.application import ProductApplication

# Product types are fixed (coded): they decide how a product is built and
# serviced — a vehicle has a chassis/engine and is commissioned on track, an
# attachment is fitted to another product.
PRODUCT_TYPES = ("vehicle", "machine", "equipment", "attachment")
PRODUCT_TYPE_LABELS = {
    "vehicle": "Rail-road vehicle", "machine": "Machine", "equipment": "Equipment", "attachment": "Attachment / accessory",
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    product_type: Mapped[str] = mapped_column(String(30), nullable=False)
    model_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", nullable=False)
    short_description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
