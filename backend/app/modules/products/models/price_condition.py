"""Pricing conditions (SAP VK11–VK13), kept deliberately simple — no
condition technique / access sequences.

Vehicles and machines are engineered to order and priced per quotation, so
conditions exist for the things sold off a list: spares, service rates
(labour / visit / transport) and the odd standard product. One row is one
condition record:

  condition_type  price     a unit rate (list price, or a customer price)
                  discount  a % off the price (customer discount)
                  freight   a freight charge per order (amount) or % of value
  item_kind       product   a finished product (products.id)
                  spare     an Item Master item sold as a spare (store_items.id)
                  service   a service rate key (SERVICE_RATE_CODES)
                  any       no item — only for a customer-wide discount / freight
  customer_id     NULL = applies to every customer (list); set = that customer only

Validity is a date range (valid_to NULL = open ended). Two live records with
the same key (type, item, customer) may not overlap — the price on a day is
never ambiguous. A customer record beats the list record; see
products/pricing.py resolve()."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Percent, Rate

PRICE_CONDITION_TYPES = ("price", "discount", "freight")
PRICE_CONDITION_TYPE_LABELS = {"price": "Price", "discount": "Discount", "freight": "Freight"}
PRICE_ITEM_KINDS = ("product", "spare", "service", "any")
PRICE_ITEM_KIND_LABELS = {"product": "Product", "spare": "Spare (Item Master)", "service": "Service rate", "any": "All items"}
# Service rates read by service billing (erp/billing.py). Coded, not configurable.
SERVICE_RATE_CODES = ("labour_hour", "visit", "transport_km", "stay_day")
SERVICE_RATE_LABELS = {
    "labour_hour": "Service engineer labour (per hour)",
    "visit": "Visit charge (per visit)",
    "transport_km": "Transport (per km)",
    "stay_day": "Stay / boarding (per day)",
}
SERVICE_RATE_UOM = {"labour_hour": "Hr", "visit": "Visit", "transport_km": "Km", "stay_day": "Day"}
FREIGHT_BASES = ("per_order", "percent")


class ProductPriceCondition(Base, TimestampMixin):
    __tablename__ = "product_price_conditions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    condition_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    item_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True)
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id", ondelete="CASCADE"), nullable=True, index=True)
    service_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("crm_organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    # Country price (2026-10-28): applies to customers whose CRM organisation is in this
    # country, usually in that country's currency. Customer price > country price > list price.
    country: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    # price: amount = unit rate; discount: percent; freight: amount (per order) or percent.
    amount: Mapped[float | None] = mapped_column(Rate, nullable=True)
    percent: Mapped[float | None] = mapped_column(Percent, nullable=True)
    freight_basis: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Floor for a price record: selling below it is a deviation (approval).
    min_price: Mapped[float | None] = mapped_column(Rate, nullable=True)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR", server_default="INR", nullable=False)

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    product = relationship("FinishedProduct", foreign_keys=[product_id], viewonly=True)
    store_item = relationship("StoreItem", foreign_keys=[store_item_id], viewonly=True)
    customer = relationship("Organization", foreign_keys=[customer_id], viewonly=True)
