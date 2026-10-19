"""Delivery events (SAP VL01N / PGI / POD) and the Sales-order <-> AR invoice
link (SAP VF01 document flow).

SalesDeliveryEvent: one dispatch, delivery (proof of delivery) or
commissioning against one delivery-schedule row. The row's dispatched_on /
delivered_on / commissioned_on and qty_* are derived from its live events
(sales/delivery.py apply_row_events) — never typed. An event is never deleted:
an admin reverses it with a reason, and the row is derived again.

SalesInvoiceLink: one AR invoice line raised from a Sales Order (per order
line, billing milestone and — for delivery-linked milestones — schedule row).
SalesOrderLine.qty_invoiced and SalesBillingPlanLine.invoiced_amount / status
are derived from the live links (accounts/services/billing.py sync_order), so
cancelling an invoice or posting a credit note against it reverses them."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Quantity

SALES_DELIVERY_EVENTS = ("dispatch", "delivery", "commissioning")
# store_issue = Store dispatch material issue (PGI); rrv_handover = Production's
# Handover stage; manual = Sales "Mark delivered / commissioned".
SALES_DELIVERY_SOURCES = ("store_issue", "rrv_handover", "manual")


class SalesDeliveryEvent(Base, TimestampMixin):
    __tablename__ = "sales_delivery_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    schedule_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_schedules.id"), index=True, nullable=False)
    so_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_lines.id"), nullable=False)
    event: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[float] = mapped_column(Quantity, default=1, nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(150), nullable=True)  # challan / R-note / commissioning certificate
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    material_issue_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_material_issues.id"), index=True, nullable=True)
    rrv_build_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reversed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reverse_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class SalesInvoiceLink(Base, TimestampMixin):
    __tablename__ = "sales_invoice_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ar_transaction_id: Mapped[int] = mapped_column(Integer, ForeignKey("ar_transactions.id"), index=True, nullable=False)
    ar_transaction_line_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transaction_lines.id"), nullable=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id"), index=True, nullable=False)
    so_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_lines.id"), index=True, nullable=False)
    billing_plan_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_billing_plan_lines.id"), index=True, nullable=False)
    schedule_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_order_schedules.id"), index=True, nullable=True)
    # Units of the schedule row this line bills (delivery-linked milestones); the
    # order line's share otherwise.
    quantity: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)
    taxable_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    gst_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
