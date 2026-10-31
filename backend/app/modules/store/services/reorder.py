"""Reorder-point planning (SAP "VB" consumption-based planning).

An item is due when its PROJECTED stock — free on-hand minus reserved, plus
what is already on order — is at or below its reorder level (or below its
minimum stock when no reorder level is set). "On order" counts the part of open PR lines
that is on no PO yet and open PO lines not yet received, so the same shortage
is never ordered twice. Planning data comes from the material master plant
views (services/plant_data.py): per plant, with that plant's stores' stock,
or company-wide from the Item Master when the item has no plant rows."""
from math import ceil
from types import SimpleNamespace

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, aliased

from app.modules.store.models.item import StoreItem
from app.modules.store.models.stock_balance import StoreStockBalance

# PR stages before a PO exists — the PR line itself is the open demand.
PRE_PO_PR_STATUSES = ("submitted", "returned", "approved", "vendor_quotations", "technical_evaluation",
                      "commercial_evaluation", "vendor_selected", "po_drafted")
OPEN_PO_STATUSES = ("issued", "acknowledged", "partially_fulfilled")
CLOSED_PR_STATUSES = ("closed", "cancelled", "rejected")
# Requisitions whose lines are no demand: not yet submitted, or ended.
NOT_OPEN_PR_STATUSES = ("draft", "rejected", "cancelled", "closed")


def _positive(expr):
    """max(expr, 0) that works on every database (no GREATEST on SQLite)."""
    return case((expr > 0, expr), else_=0)


def on_order(db: Session, item_ids: set[int]) -> tuple[dict[int, float], dict[int, list[str]]]:
    """Quantity on order per item and the document numbers behind it.

    One requisition can have several POs from several buyers, so the PR's own status says nothing about
    what is still to be ordered. Two set-based queries instead:
      1. PR lines of every open requisition (not draft / rejected / cancelled / closed): the part of each
         line that is on NO live PO yet = quantity - issued - short-closed - quantity on live POs.
      2. PO lines of live POs: ordered - received (a line already on a PO is counted here, not in 1).
    """
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

    qty: dict[int, float] = {}
    docs: dict[int, list[str]] = {}
    if not item_ids:
        return qty, docs

    # Quantity per PR line already on a live PO (any live status, a delivered one is no longer "to order").
    live_po_qty = (select(P2PPurchaseOrderItem.pr_item_id.label("pr_item_id"), func.sum(P2PPurchaseOrderItem.quantity).label("qty"))
                   .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
                   .where(P2PPurchaseOrder.status != "cancelled", P2PPurchaseOrderItem.pr_item_id.is_not(None))
                   .group_by(P2PPurchaseOrderItem.pr_item_id).subquery())
    # A PO raised before POs named their PR lines covers the whole PR: its lines carry no pr_item_id,
    # so the PR lines must not be counted again next to it.
    legacy_po = aliased(P2PPurchaseOrder)
    legacy_line = aliased(P2PPurchaseOrderItem)
    has_legacy_po = (select(legacy_po.id).join(legacy_line, legacy_line.purchase_order_id == legacy_po.id)
                     .where(legacy_po.p2p_request_id == P2PRequest.id, legacy_po.status != "cancelled",
                            legacy_line.pr_item_id.is_(None)).exists())
    to_order = _positive(P2PRequestItem.quantity - func.coalesce(P2PRequestItem.issued_qty, 0)
                         - func.coalesce(P2PRequestItem.short_closed_qty, 0) - func.coalesce(live_po_qty.c.qty, 0))
    for item_id, pr_no, open_qty in (
            db.query(P2PRequestItem.store_item_id, P2PRequest.p2p_number, func.sum(to_order))
            .join(P2PRequest, P2PRequest.id == P2PRequestItem.p2p_request_id)
            .outerjoin(live_po_qty, live_po_qty.c.pr_item_id == P2PRequestItem.id)
            .filter(P2PRequestItem.store_item_id.in_(item_ids), P2PRequest.status.notin_(NOT_OPEN_PR_STATUSES),
                    func.coalesce(P2PRequestItem.fulfillment_status, "") != "stock_issued", ~has_legacy_po)
            .group_by(P2PRequestItem.store_item_id, P2PRequest.p2p_number)
            .having(func.sum(to_order) > 1e-9).order_by(P2PRequest.p2p_number).all()):
        qty[item_id] = qty.get(item_id, 0) + float(open_qty)
        docs.setdefault(item_id, []).append(pr_no)

    # A PO whose requisition was short-closed (vendor won't supply the
    # balance) keeps status 'partially_fulfilled', but nothing more will be
    # received on it — its balance is not on order any more. A draft PO is
    # still on order: its quantity has already left the PR line's "to order".
    decided = ("passed", "failed", "partial")
    got_expr = case((P2PGoodsReceiptItem.quality_status.in_(decided),
                     _positive(func.coalesce(P2PGoodsReceiptItem.accepted_quantity, 0) - func.coalesce(P2PGoodsReceiptItem.returned_quantity, 0))),
                    else_=func.coalesce(P2PGoodsReceiptItem.received_quantity, 0))
    received = (select(P2PGoodsReceiptItem.po_item_id.label("po_item_id"), func.sum(got_expr).label("got"))
                .join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
                .where(P2PGoodsReceipt.status != "reversed").group_by(P2PGoodsReceiptItem.po_item_id).subquery())
    po_open = _positive(P2PPurchaseOrderItem.quantity - func.coalesce(received.c.got, 0))
    for item_id, po_no, open_qty in (
            db.query(P2PPurchaseOrderItem.store_item_id, P2PPurchaseOrder.po_number, func.sum(po_open))
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .outerjoin(P2PRequest, P2PRequest.id == P2PPurchaseOrder.p2p_request_id)
            .outerjoin(received, received.c.po_item_id == P2PPurchaseOrderItem.id)
            .filter(P2PPurchaseOrderItem.store_item_id.in_(item_ids), P2PPurchaseOrder.status.in_(("draft",) + OPEN_PO_STATUSES),
                    P2PRequest.status.is_(None) | P2PRequest.status.notin_(CLOSED_PR_STATUSES))
            .group_by(P2PPurchaseOrderItem.store_item_id, P2PPurchaseOrder.po_number)
            .having(func.sum(po_open) > 1e-9).order_by(P2PPurchaseOrder.po_number).all()):
        qty[item_id] = qty.get(item_id, 0) + float(open_qty)
        docs.setdefault(item_id, []).append(po_no)
    return qty, docs


def suggest(item: StoreItem, projected: float) -> float:
    """Top up to maximum stock when set; else the reorder quantity; else the
    shortfall to the reorder level / minimum — rounded up to whole units and
    to multiples of the minimum order quantity."""
    if item.maximum_stock:
        need = item.maximum_stock - projected
    elif item.reorder_quantity:
        need = float(item.reorder_quantity)
        target = item.reorder_level if item.reorder_level is not None else (item.minimum_stock or 0)
        while projected + need <= target:  # one lot may not lift it above the reorder point
            need += float(item.reorder_quantity)
    else:
        target = item.reorder_level if item.reorder_level is not None else (item.minimum_stock or 0)
        need = target - projected + (1 if item.reorder_level is not None else 0)
    need = max(float(ceil(need - 1e-9)), 1.0)
    moq = item.min_order_qty or 0
    if moq > 0:
        need = max(moq, ceil(need / moq) * moq)
    return float(need)


def _plan_units(db: Session, items: list[StoreItem], branch_id: int | None) -> list[tuple[StoreItem, int | None, SimpleNamespace]]:
    """(item, plant, planning data) per reorder-point planning unit.

    Material master plant views (store_item_plants) decide where an item is
    planned: an item with plant rows is planned per plant (rows with MRP type
    'mrp' / 'none' are left to Production MRP / not planned); an item with no
    plant row keeps the company-wide Item Master fields. With `branch_id`,
    only that plant is planned (an item without a row there falls back to its
    Item Master fields, with that plant's stock)."""
    from app.modules.store.models.item_plant import StoreItemPlant
    from app.modules.store.services.plant_data import plant_view

    ids = [i.id for i in items]
    rows: dict[int, list[StoreItemPlant]] = {}
    for r in db.query(StoreItemPlant).filter(StoreItemPlant.item_id.in_(ids or [-1])).all():
        rows.setdefault(r.item_id, []).append(r)
    units = []
    for it in items:
        own = rows.get(it.id, [])
        if branch_id is not None:
            plants = [branch_id]
        elif own:
            plants = sorted(r.branch_id for r in own)
        else:
            plants = [None]
        for b in plants:
            v = plant_view(db, it, b)
            if v["mrp_type"] != "reorder_point":
                continue
            if v["reorder_level"] is None and v["minimum_stock"] is None:
                continue
            ns = SimpleNamespace(**{k: v[k] for k in ("reorder_level", "minimum_stock", "maximum_stock", "reorder_quantity",
                                                      "safety_stock", "lead_time_days", "default_location_id")},
                                 min_order_qty=it.min_order_qty, source=v["source"])
            units.append((it, b, ns))
    return units


def reorder_rows(db: Session, *, category: str | None = None, due_only: bool = True, branch_id: int | None = None) -> list[dict]:
    from app.modules.organization.models.branch import Branch
    from app.modules.store.models.location import StoreLocation

    q = db.query(StoreItem).filter(StoreItem.status == "active")
    if category:
        q = q.filter(StoreItem.category == category)
    units = _plan_units(db, q.all(), branch_id)
    ids = {it.id for it, _b, _v in units}
    plant_of = {lid: bid for lid, bid in db.query(StoreLocation.id, StoreLocation.branch_id).all()}
    stock: dict[tuple[int, int | None], tuple[float, float]] = {}
    for iid, lid, on, res in db.query(
        StoreStockBalance.item_id, StoreStockBalance.location_id, func.sum(StoreStockBalance.on_hand_qty), func.sum(StoreStockBalance.reserved_qty)
    ).filter(StoreStockBalance.item_id.in_(ids or {-1})).group_by(StoreStockBalance.item_id, StoreStockBalance.location_id).all():
        plant = plant_of.get(lid)
        for key in ((iid, None),) + (((iid, plant),) if plant is not None else ()):
            o, r = stock.get(key, (0.0, 0.0))
            stock[key] = (o + float(on or 0), r + float(res or 0))
    # P2P documents carry no plant, so what is on order counts at every plant
    # the item is planned at (never orders the same shortage twice; may
    # under-suggest at a second plant — review the plant row's suggestion).
    ordered, docs = on_order(db, ids)
    plants = {b.id: b.name for b in db.query(Branch).all()}
    rows = []
    for it, b, v in units:
        on_hand, reserved = stock.get((it.id, b), (0.0, 0.0))
        available = on_hand - reserved
        projected = available + ordered.get(it.id, 0.0)
        if v.reorder_level is not None:
            due = projected <= v.reorder_level
        else:
            due = projected < (v.minimum_stock or 0)
        if due_only and not due:
            continue
        rows.append({
            "row_key": f"{it.id}-{b or 0}", "item_id": it.id, "item_code": it.item_code, "item_name": it.item_name, "uom": it.uom,
            "category": it.category, "make": it.make, "branch_id": b, "plant_name": plants.get(b) if b else None,
            "planning_source": v.source, "default_location_id": v.default_location_id,
            "on_hand": round(on_hand, 4), "reserved": round(reserved, 4), "available": round(available, 4),
            "on_order": round(ordered.get(it.id, 0.0), 4), "on_order_docs": sorted(set(docs.get(it.id, []))),
            "projected": round(projected, 4), "minimum_stock": v.minimum_stock, "reorder_level": v.reorder_level,
            "safety_stock": v.safety_stock, "maximum_stock": v.maximum_stock, "reorder_quantity": v.reorder_quantity,
            "min_order_qty": it.min_order_qty, "lead_time_days": v.lead_time_days, "due": due,
            "suggested_qty": suggest(v, projected) if due else None,
        })
    rows.sort(key=lambda r: (not r["due"], r["projected"] - (r["reorder_level"] if r["reorder_level"] is not None else (r["minimum_stock"] or 0)), r["item_name"].lower(), r["plant_name"] or ""))
    return rows
