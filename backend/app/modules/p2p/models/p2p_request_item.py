from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.p2p.models.order_project_mixin import OrderProjectLineMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment


class P2PRequestItem(Base, TimestampMixin, OrderProjectLineMixin):
    """One item/part line within a P2PRequest — a requester can add multiple."""

    __tablename__ = "p2p_request_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)

    # The line's real identity: the Item Master row it was picked from. The
    # PO and GRN lines carry the same id forward, and stock posts against it.
    # item_name / part_code / unit / category below are a snapshot of the
    # master at PR time. Null only on lines raised before 2026-10-11 that the
    # migration couldn't link.
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    project_inhouse: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ship_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Buyer of this line (2026-10-27): picked from the line's Item Master item
    # type (Procurement › Settings › Buyer for each item type). One requisition
    # can carry lines for different buyers. Null on lines raised before it and
    # on item types with no buyer set; the header's assigned buyer then applies.
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

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

    # PM project link (2026-10-17): the vehicle / lot of the build-to-order
    # project this line is bought for — required when the PR is charged to an order
    # that has a project (p2p/order_project_links.py).
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("pm_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)

    # Short-close (2026-10-31): quantity the buyer/purchase head decided NOT to buy (supplier cannot
    # supply, need dropped, ...). Reduces what is still open to order:
    # open_to_order = quantity - issued_qty - short_closed_qty - qty on live POs.
    short_closed_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    short_closed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_closed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    short_closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    store_item = relationship("StoreItem")
    order_project_element = relationship("PmProjectElement", viewonly=True, lazy="select")
    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="items")
    attachments: Mapped[list["P2PRequestAttachment"]] = relationship(
        "P2PRequestAttachment", back_populates="item", cascade="all, delete-orphan"
    )

    @property
    def item_code(self) -> str | None:
        return self.store_item.item_code if self.store_item is not None else None
