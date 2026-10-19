"""Purchase ↔ Order Project (2026-10-17).

RRVs are built to order: every requisition line bought for an RRV order is
tied to one element (vehicle / lot) of the order's Order Project, so Store,
Production and the project 360 page can see what was bought for which
vehicle.

Where the link lives
  PR line   order_project_id + order_project_element_id — picked per line
            (each line can be for a different vehicle). The PR header's
            order_project_id is the project in scope: set by the 'order_project'
            account assignment, or derived from a 'sales_order' assignment
            whose order has a project (p2p/account_assignment.py).
  PO line   copied from the PR line it orders (pr_item_id) when it is inserted.
  GRN line  copied from the PO line it receives, so Store can tag the stock.

Rule (owner decision: project-wise purchase is mandatory for RRV project
items) — on submit, every 'Project' line of a PR whose header is charged to
an order with an Order Project needs its element; 422 naming the line.
'Inhouse' lines are not project items and never carry one. The element is
filled automatically when it can be derived:
  * the line names it (the PR form's Order Project picker, MRP / shortage
    prefill passing order_project_element_id),
  * the PR is charged to a work order that carries an element
    (ProductionWorkOrder.order_project_element_id, read at runtime),
  * the project in scope has exactly one live element.
Plain stock / overhead PRs with no order link behave as before.

Registered at import (imported by routes/p2p_requests.py, loaded at startup):
  * mapper events that copy the element PR line -> PO line -> GRN line,
  * the 'purchase' department provider for the Order Project 360 table."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.sales import order_projects as op_core
from app.modules.sales.models.order_project import OrderProject, OrderProjectElement

EPS = 1e-6
# PR statuses whose lines no longer count as open demand.
_DEAD_PR_STATUSES = ("draft", "cancelled", "rejected", "closed")
_DECIDED_GRN_LINE_STATUSES = ("passed", "failed", "partial")


# ---------------------------------------------------------------- PR lines

def _work_order_element(db: Session, pr: P2PRequest) -> OrderProjectElement | None:
    """The element of the work order a PR is charged to — only when Production
    has added that link (read at runtime; nothing breaks without it)."""
    if pr.account_assignment != "work_order" or not pr.work_order_id:
        return None
    from app.modules.production.models.work_order import ProductionWorkOrder
    wo = db.get(ProductionWorkOrder, pr.work_order_id)
    eid = getattr(wo, "order_project_element_id", None) if wo is not None else None
    if not eid:
        return None
    el = db.get(OrderProjectElement, eid)
    return el if el is not None and el.status != "cancelled" else None


def _live_elements(db: Session, project_id: int) -> list[OrderProjectElement]:
    return (db.query(OrderProjectElement)
            .filter(OrderProjectElement.order_project_id == project_id, OrderProjectElement.status != "cancelled")
            .order_by(OrderProjectElement.id).all())


def link_pr_lines(db: Session, pr: P2PRequest, rows: list[tuple], *, draft: bool) -> None:
    """Set / check the Order Project element of each PR line.

    rows: (line no., payload line, Item Master row, P2PRequestItem) — call after
    the account assignment is applied (pr.order_project_id is the scope).
    Raises HTTPException 404/422 with the line named and the fix."""
    wo_el = _work_order_element(db, pr)
    scope_id = pr.order_project_id or (wo_el.order_project_id if wo_el is not None else None)
    scope = db.get(OrderProject, scope_id) if scope_id else None
    single = None
    if scope is not None:
        live = _live_elements(db, scope.id)
        single = live[0] if len(live) == 1 else None
    overhead = pr.account_assignment in ("cost_center", "internal_order")

    for idx, item, master, row in rows:
        name = f"Line {idx} ({master.item_code} {master.item_name})"
        eid = getattr(item, "order_project_element_id", None)
        inhouse = (item.project_inhouse or "") == "Inhouse"
        el = None
        if eid:
            if inhouse:
                raise HTTPException(status_code=422, detail=(
                    f"{name} is marked Inhouse but is tagged to an order project vehicle / lot — Inhouse items aren't bought "
                    f"for a project. Mark the line 'Project', or clear its Order Project."))
            if overhead:
                raise HTTPException(status_code=422, detail=(
                    f"{name} is tagged to an order project vehicle / lot, but the requisition is charged to a "
                    f"{'cost centre' if pr.account_assignment == 'cost_center' else 'internal order'}. Charge it to the "
                    f"order project (or its sales order) instead, or clear the line's Order Project."))
            try:
                # An element a saved line already had stays valid on an edit even
                # if a sales amendment cancelled it since — only new picks are refused.
                _project, el = op_core.resolve_element(
                    db, int(eid), project_id=scope.id if scope is not None else None,
                    allow_cancelled=row.order_project_element_id == int(eid))
                if row.order_project_element_id != int(eid):
                    op_core.resolve_project(db, _project.id)  # a new pick needs an active / on-hold project
            except HTTPException as e:
                raise HTTPException(status_code=e.status_code, detail=f"{name}: {e.detail}")
        elif not inhouse:
            el = wo_el or single
        if el is None and scope is not None and not draft and not inhouse:
            raise HTTPException(status_code=422, detail=(
                f"{name}: pick the vehicle / lot of {scope.op_number} this item is bought for — project-wise purchase "
                f"is mandatory for order project items. Use the Order Project picker on the line, or mark the line "
                f"Inhouse if it isn't for the project."))
        row.order_project_id = el.order_project_id if el is not None else None
        row.order_project_element_id = el.id if el is not None else None


def check_saved_pr(db: Session, pr: P2PRequest) -> None:
    """Re-run the rule on a saved requisition's own lines before a draft /
    returned PR goes for approval (fills derivable elements, 422 otherwise)."""
    from types import SimpleNamespace
    rows = []
    for idx, row in enumerate(pr.items, start=1):
        master = SimpleNamespace(item_code=row.item_code or row.part_code or "", item_name=row.item_name)
        item = SimpleNamespace(order_project_element_id=row.order_project_element_id, project_inhouse=row.project_inhouse)
        rows.append((idx, item, master, row))
    link_pr_lines(db, pr, rows, draft=False)


# ---------------------------------------------------------------- inheritance

@event.listens_for(P2PPurchaseOrderItem, "before_insert")
def _po_line_from_pr_line(_mapper, connection, target: P2PPurchaseOrderItem) -> None:
    if target.order_project_element_id is None and target.pr_item_id:
        row = connection.execute(
            select(P2PRequestItem.order_project_id, P2PRequestItem.order_project_element_id)
            .where(P2PRequestItem.id == target.pr_item_id)).first()
        if row is not None and row[1] is not None:
            target.order_project_id, target.order_project_element_id = row[0], row[1]


@event.listens_for(P2PGoodsReceiptItem, "before_insert")
def _grn_line_from_po_line(_mapper, connection, target: P2PGoodsReceiptItem) -> None:
    if target.order_project_element_id is None and target.po_item_id:
        row = connection.execute(
            select(P2PPurchaseOrderItem.order_project_id, P2PPurchaseOrderItem.order_project_element_id)
            .where(P2PPurchaseOrderItem.id == target.po_item_id)).first()
        if row is not None and row[1] is not None:
            target.order_project_id, target.order_project_element_id = row[0], row[1]


# ---------------------------------------------------------------- 360 provider

def _fmt(d: date) -> str:
    return d.strftime("%d %b %Y")


def purchase_cells(db: Session, project: OrderProject, elements: list[OrderProjectElement]) -> dict[int, dict | None]:
    """Per element: open PR lines (not yet on a live PO), open PO lines, fully
    received PO lines; warning when an open PO line is past its delivery date."""
    ids = [e.id for e in elements]
    if not ids:
        return {}
    today = date.today()
    po_rows = (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
               .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
               .filter(P2PPurchaseOrderItem.order_project_element_id.in_(ids), P2PPurchaseOrder.status != "cancelled")
               .all())
    received: dict[int, float] = {}
    if po_rows:
        grn_lines = (db.query(P2PGoodsReceiptItem)
                     .join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
                     .filter(P2PGoodsReceiptItem.po_item_id.in_([li.id for li, _ in po_rows]),
                             P2PGoodsReceipt.status != "reversed").all())
        for g in grn_lines:
            qty = (max((g.accepted_quantity or 0) - (g.returned_quantity or 0), 0.0)
                   if g.quality_status in _DECIDED_GRN_LINE_STATUSES else (g.received_quantity or 0))
            received[g.po_item_id] = received.get(g.po_item_id, 0.0) + qty
    on_po = {li.pr_item_id for li, _ in po_rows if li.pr_item_id}
    legacy_po_prs = {po.p2p_request_id for li, po in po_rows if not li.pr_item_id and po.p2p_request_id}
    pr_rows = (db.query(P2PRequestItem, P2PRequest)
               .join(P2PRequest, P2PRequest.id == P2PRequestItem.p2p_request_id)
               .filter(P2PRequestItem.order_project_element_id.in_(ids), P2PRequest.status.notin_(_DEAD_PR_STATUSES),
                       P2PRequestItem.fulfillment_status != "stock_issued")
               .all())

    stats = {i: {"pr": 0, "po": 0, "done": 0, "overdue": [], "next": None} for i in ids}
    for li, pr in pr_rows:
        if li.id in on_po or pr.id in legacy_po_prs:
            continue
        stats[li.order_project_element_id]["pr"] += 1
    for li, po in po_rows:
        s = stats[li.order_project_element_id]
        if received.get(li.id, 0.0) + EPS >= (li.quantity or 0):
            s["done"] += 1
            continue
        s["po"] += 1
        due = li.delivery_date or po.expected_delivery
        if due is not None:
            if due < today:
                s["overdue"].append((due, po.po_number))
            if s["next"] is None or due < s["next"]:
                s["next"] = due

    out: dict[int, dict | None] = {}
    for eid, s in stats.items():
        if not (s["pr"] or s["po"] or s["done"]):
            out[eid] = None
            continue
        parts = []
        if s["pr"]:
            parts.append(f"{s['pr']} PR line{'s' if s['pr'] != 1 else ''} not yet ordered")
        if s["po"]:
            parts.append(f"{s['po']} PO line{'s' if s['po'] != 1 else ''} open")
        if s["done"]:
            parts.append(f"{s['done']} line{'s' if s['done'] != 1 else ''} fully received")
        detail = " · ".join(parts)
        if s["overdue"]:
            first_due, po_no = min(s["overdue"])
            n = len(s["overdue"])
            detail += f" · {n} overdue (earliest {po_no}, due {_fmt(first_due)})"
            out[eid] = {"status": "overdue", "label": f"{n} overdue", "tone": "warning", "detail": detail,
                        "date": first_due.isoformat()}
        elif s["po"]:
            out[eid] = {"status": "ordered", "label": f"{s['po']} on order" + (f", {s['pr']} to order" if s["pr"] else ""),
                        "tone": "info", "detail": detail, "date": s["next"].isoformat() if s["next"] else None}
        elif s["pr"]:
            out[eid] = {"status": "requested", "label": f"{s['pr']} to order", "tone": "neutral", "detail": detail, "date": None}
        else:
            out[eid] = {"status": "received", "label": "Received", "tone": "success", "detail": detail, "date": None}
    return out


op_core.register_department_provider("purchase", purchase_cells)
