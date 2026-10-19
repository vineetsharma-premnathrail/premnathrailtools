from __future__ import annotations
from datetime import date
from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class P2PSourceListEntry(Base, TimestampMixin):
    """ME01 source list: the vendors approved to supply an Item Master item,
    for a validity period. `is_fixed` marks the preferred source (shown first
    and used as the default vendor); `is_blocked` keeps a vendor on the list
    for history but stops new POs for that item going to it. When an item has
    a source list, PO lines for it may only go to a listed, unblocked vendor
    valid on the PO date (p2p/info_records.py ensure_source_allowed). An item
    with no source list is unrestricted."""

    __tablename__ = "p2p_source_list"
    __table_args__ = (UniqueConstraint("store_item_id", "vendor_id", name="uq_p2p_source_list_item_vendor"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    store_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=False, index=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_fixed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
