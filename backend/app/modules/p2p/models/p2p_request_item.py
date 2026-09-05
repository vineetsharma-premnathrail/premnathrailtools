from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment


class P2PRequestItem(Base, TimestampMixin):
    """One item/part line within a P2PRequest — a requester can add multiple."""

    __tablename__ = "p2p_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)

    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    project_inhouse: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ship_to: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Nullable, non-blocking mapping to the Store catalog — set by the buyer at
    # GRN time (or left unmapped, see PURCHASE_STORE_INTEGRATION.md). Only
    # items with this set get a stock-in transaction posted on receipt.
    stock_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("stock_items.id"), nullable=True)

    # Nullable, non-blocking mapping to the shared Item master — set by the
    # requester at creation time when they pick a catalog item instead of
    # typing one in free text. Independent of stock_item_id above.
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("items.id"), nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="items")
    attachments: Mapped[list["P2PRequestAttachment"]] = relationship(
        "P2PRequestAttachment", back_populates="item", cascade="all, delete-orphan"
    )
