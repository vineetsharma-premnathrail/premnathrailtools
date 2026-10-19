from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.modules.accounts.models._types import Money, Quantity, Rate, Percent


class TaxLineMixin:
    """Columns every GST document line carries — purchase invoice, sales
    invoice, debit note and credit note lines all use this, so GST registers
    and GSTR-1 HSN summaries read one shape.

    taxable_amount = quantity x rate - discount_amount. The tax split is
    computed server-side from gst_rate and the document's place of supply
    (services/gst.py) — never trusted from the client."""

    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    store_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    hsn_sac_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Quantity, nullable=False, default=1)
    uom: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rate: Mapped[float] = mapped_column(Rate, nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    taxable_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    gst_rate: Mapped[float] = mapped_column(Percent, nullable=False, default=0)
    cgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    sgst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    igst_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    # Purchase/expense ledger (purchase side) or sales/income ledger (sales side).
    gl_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=False)
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True, index=True)
