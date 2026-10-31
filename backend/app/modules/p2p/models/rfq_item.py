from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Integer, Float, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.rfq import RFQ
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem


class RFQItem(Base, TimestampMixin):
    """One purchase-requisition line an RFQ asks quotes for (2026-10-31, multi-buyer split).

    An RFQ belongs to one requisition and one buyer; this table is the explicit set of
    that requisition's lines the buyer is quoting. Quotes (VendorQuotationItem) may only be
    recorded against these lines. `quantity` is the qty the RFQ asks for (the line's open
    qty when the RFQ was made; the buyer can still award less or split it between vendors).

    A line moved to another buyer (reassigned) is not deleted: it gets `withdrawn_at` and
    `withdrawn_reason`, so the old RFQ keeps its history. Active line = withdrawn_at IS NULL.
    """

    __tablename__ = "rfq_items"
    __table_args__ = (UniqueConstraint("rfq_id", "pr_item_id", name="uq_rfq_items_rfq_pr_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # No separate index on rfq_id: the (rfq_id, pr_item_id) unique constraint covers lookups by rfq.
    rfq_id: Mapped[int] = mapped_column(Integer, ForeignKey("rfqs.id", ondelete="CASCADE"), nullable=False)
    pr_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("p2p_request_items.id"), nullable=False, index=True)
    # The line's Item Master item, copied from the PR line (items are matched by id, never by name).
    store_item_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("store_items.id"), nullable=True, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)

    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    rfq: Mapped["RFQ"] = relationship("RFQ", back_populates="items")
    pr_item: Mapped["P2PRequestItem"] = relationship("P2PRequestItem")
    store_item = relationship("StoreItem")

    @property
    def is_active(self) -> bool:
        return self.withdrawn_at is None
