from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.p2p.models.order_project_mixin import OrderProjectLineMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest

# draft -> issued -> acknowledged -> partially_fulfilled -> fulfilled
#      \-> cancelled (from any state before fulfilled)
P2P_PO_STATUSES = ("draft", "issued", "acknowledged", "partially_fulfilled", "fulfilled", "cancelled")

# PO line item categories (SAP ME21N item category: blank / D / A).
P2P_PO_ITEM_CATEGORIES = {
    "stock": "Stock item — received into store stock on the GRN",
    "service": "Service — received by a service entry (no store stock)",
    "asset": "Asset — received on the GRN, capitalised by Finance (no store stock)",
}


def po_item_category_for_type(item_type: str | None) -> str:
    """Item Master item type -> PO item category. Only the 'service' and
    'asset' types are kept out of store stock; materials, consumables and
    tools stay stock items."""
    t = (item_type or "").strip().lower()
    if t == "service":
        return "service"
    if t == "asset":
        return "asset"
    return "stock"


class P2PPurchaseOrder(Base, TimestampMixin):
    """A formal Purchase Order, optionally raised against a P2PRequest
    (p2p_request_id nullable — allows an ad-hoc PO raised directly, e.g. by
    Store for stock replenishment, without a prior request). See
    docs/product/PURCHASE_DEPARTMENT_MODULE_PLAN.md Phase 2."""

    __tablename__ = "p2p_purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    po_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    p2p_request_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="draft", nullable=False)
    po_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_delivery: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Company terms + the vendor's own terms, copied in when the PO is drafted.
    terms_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Bumped on every draft edit — the managed Word PO (p2p/reports/purchase_order.py)
    # compares it to know when the Word draft is out of date.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    total_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Finance internal order this PO is bought for (capital / maintenance job).
    # Its not-yet-invoiced value is the order's commitment
    # (accounts/services/controlling.py) and its invoice lines default to it.
    internal_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("internal_orders.id"), nullable=True, index=True)
    # Cost centre the PO is charged to (2026-10-23) — set by Purchase on the
    # PO, not by the requester: a department running-cost requisition's PO
    # starts with the requester's department's cost centre (p2p/purpose.py)
    # and can't go for approval without one. Invoice lines default to it.
    cost_center_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("cost_centers.id"), nullable=True, index=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # The signed PO document — uploaded once while the PO is still a draft
    # and then permanently locked (no re-upload/replace at any later stage,
    # including during the Purchase Head -> Director -> Partner approval chain).
    document_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document_sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    document_sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    document_uploaded_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ME21N (2026-10-14): one approved PR can be split into several POs by
    # vendor — each PO names its receiving plant and ship-to store, and the
    # quotation it was awarded from. amendment_no counts approved ME22N
    # amendments (0 = the PO as first released) — see p2p/po_amendments.py.
    plant_branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    ship_to_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    vendor_quotation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_vendor_quotations.id"), nullable=True)
    amendment_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # A PO made and approved outside the portal and uploaded here (2026-10-27:
    # "tally" = Tally ERP). Such a PO has no requisition and no portal approval —
    # it counts as released from import (po_split.po_is_released) so the store
    # can receive it. external_ref = the PO number in that system; one import
    # per (source, external_ref).
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    __table_args__ = (Index("uq_p2p_purchase_orders_source_external_ref", "source", "external_ref", unique=True),)

    p2p_request: Mapped["P2PRequest | None"] = relationship("P2PRequest")
    items: Mapped[list["P2PPurchaseOrderItem"]] = relationship(
        "P2PPurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan"
    )


class P2PPurchaseOrderItem(Base, TimestampMixin, OrderProjectLineMixin):
    __tablename__ = "p2p_purchase_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=False)

    # Item Master link copied from the PR line (see P2PRequestItem.store_item_id).
    # Null only on older lines — they must be linked ("Link to Item Master" on
    # the PO) before goods can be received against them.
    store_item_id: Mapped[int | None] = mapped_column(ForeignKey("store_items.id"), nullable=True, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    make: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Free-text lines printed under the item in the PO's Description of Goods
    # (e.g. "Pressure: 350 Bar") — one per line.
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    line_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    # SAP item category (ME21N): "stock" goes into store stock on the GRN;
    # "service" (job work charges, AMC, calibration, consultancy) is received
    # by a service entry, never as stock; "asset" is received on the GRN but
    # capitalised by Finance, not put into store stock. Set from the Item
    # Master item type when the PO line is drafted — see `category` for rows
    # created before the column existed.
    item_category: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # ME21N line detail (2026-10-14): the PR line this PO line orders (one PR
    # line can be spread over several POs; their quantities never exceed it),
    # the line's own delivery date and ship-to store, and where its price came
    # from — "quotation" (awarded quote line), "info_record" (vendor + item
    # purchasing info record) or "manual" (typed; an override of a quotation
    # price needs price_override_reason).
    pr_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_request_items.id"), nullable=True, index=True)
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    ship_to_location_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_locations.id"), nullable=True)
    vendor_quotation_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_vendor_quotation_items.id"), nullable=True)
    price_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    price_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Order Project link (2026-10-17): the vehicle / lot of the build-to-order
    # project this line is bought for — copied from its PR line (p2p/order_project_links.py).
    order_project_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_order_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    order_project_element_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("sales_order_project_elements.id", ondelete="SET NULL"), nullable=True, index=True)

    purchase_order: Mapped["P2PPurchaseOrder"] = relationship("P2PPurchaseOrder", back_populates="items")
    store_item = relationship("StoreItem")
    order_project_element = relationship("OrderProjectElement", viewonly=True, lazy="select")

    @property
    def category(self) -> str:
        """The effective item category — the stored one, else derived from the
        linked Item Master item's type."""
        if self.item_category:
            return self.item_category
        return po_item_category_for_type(self.store_item.item_type if self.store_item is not None else None)

    @property
    def item_code(self) -> str | None:
        return self.store_item.item_code if self.store_item is not None else None
