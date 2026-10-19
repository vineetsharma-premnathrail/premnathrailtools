from __future__ import annotations
from datetime import datetime
from sqlalchemy import JSON, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# pending_approval -> approved (changes applied to the PO, amendment_no bumped)
#                  \-> rejected | returned | withdrawn (PO stays as it was)
PO_AMENDMENT_STATUSES = ("pending_approval", "approved", "rejected", "returned", "withdrawn")


class P2PPOAmendment(Base, TimestampMixin):
    """ME22N change of a released PO: quantity / price / delivery date edits,
    added and deleted lines. Nothing is changed on the PO until the amendment
    is approved through the central approval engine (workflow
    p2p.po_amendment — the PO approvers, then any one Partner); approval
    applies `changes`, bumps the PO's amendment_no and revision (so the Word
    PO is rebuilt as "Amendment N"). `before` / `after` are full PO snapshots
    (header + lines), which is the PO's version history."""

    __tablename__ = "p2p_po_amendments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True)
    amendment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending_approval")
    # [{"op": "change", "po_item_id", "field", "old", "new"}, {"op": "add", "line": {...}}, {"op": "delete", "po_item_id", "old": {...}}]
    changes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    before: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    after: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    old_total: Mapped[float | None] = mapped_column(nullable=True)
    new_total: Mapped[float | None] = mapped_column(nullable=True)
    requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    purchase_order = relationship("P2PPurchaseOrder")
