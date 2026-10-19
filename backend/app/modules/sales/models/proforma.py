"""Proforma invoice (SAP VA01 type PF / F-37 down-payment request).

Railway and PSU customers release an advance only against a proforma invoice.
A PI is raised from one advance milestone of a confirmed sales order
(SalesBillingPlanLine), numbered PI/<FY>/NNNN from the Accounts FY series, and
issued as a managed Word document (sales/reports/proforma.py). It never posts
to the ledger: Finance records the customer's advance receipt against the same
milestone (payment_transactions.billing_line_id), and the tax invoice for the
milestone is raised later through billing (accounts/services/billing.py).

status: issued → cancelled (with reason) | converted (the milestone was
invoiced). One live (issued) PI per milestone — cancel it to issue a new one."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, String, Integer, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

SALES_PROFORMA_STATUSES = ("issued", "cancelled", "converted")


class SalesProformaInvoice(Base, TimestampMixin):
    __tablename__ = "sales_proforma_invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pi_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    billing_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_billing_plan_lines.id"), index=True, nullable=False)
    pi_date: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    place_of_supply_state_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    interstate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    taxable_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    cgst_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    sgst_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    igst_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    total_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    # Frozen per-line breakdown printed on the document: [{line_number, description,
    # hsn_sac_code, gst_rate, taxable, cgst, sgst, igst, total}].
    lines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="issued", index=True, nullable=False)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
