from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey
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

    # Per-item buyer decision after a manual store-stock check on an approved
    # PR — "stock_issued" items are excluded from PO creation (see
    # create_po in p2p/routes/p2p_requests.py) since they were already
    # fulfilled out of existing store stock instead of being purchased.
    fulfillment_status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    # Automatic store-stock snapshot (see _refresh_stock_snapshot in
    # routes/p2p_requests.py): taken at PR creation so approvers see what is
    # already in store, refreshed at final PR approval when out-of-stock
    # lines are auto-routed to procurement. stock_status is one of
    # in_stock / partial / not_in_stock / no_match (no Item Master match);
    # stock_available_qty is the summed available (on hand minus reserved)
    # across all warehouses at stock_checked_at.
    stock_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    stock_available_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    stock_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_from_location_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    issued_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    material_issue_id: Mapped[int | None] = mapped_column(ForeignKey("store_material_issues.id"), nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="items")
    attachments: Mapped[list["P2PRequestAttachment"]] = relationship(
        "P2PRequestAttachment", back_populates="item", cascade="all, delete-orphan"
    )
