"""ME21N: one approved requisition, several purchase orders.

A PR's buy lines can be ordered from different vendors — each PO line names
the PR line it orders (P2PPurchaseOrderItem.pr_item_id), and across all live
(non-cancelled) POs the quantity ordered per PR line never exceeds what is
still to buy (PR quantity minus what was issued from stock).

The requisition's status is then a roll-up of its POs (`rollup_pr_status`):

    any PO out for approval            -> po_raised
    else any PO still a draft          -> po_drafted
    else (every live PO released)      -> po_approved / partially_received /
                                          received (received only when every
                                          PO is fulfilled and nothing is left
                                          to order)

A PR with a single PO covering everything keeps the original one-PO status
flow untouched (`needs_rollup` is False) — the roll-up only takes over once a
PR has more than one live PO, or a PO that leaves PR quantity unordered."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

PO_ENTITY = "p2p_purchase_order"

# PR statuses the roll-up may move between — never a terminal one.
_MANAGED_PR_STATUSES = {
    "vendor_quotations", "technical_evaluation", "commercial_evaluation", "vendor_selected",
    "po_drafted", "po_raised", "po_approved", "partially_received", "received",
}
# PR statuses a further (split) PO can be drafted at.
SPLIT_PO_PR_STATUSES = _MANAGED_PR_STATUSES
_LEGACY_RELEASED_PR_STATUSES = ("po_approved", "partially_received", "received", "closed")


def live_pos(db: Session, pr_id: int) -> list[P2PPurchaseOrder]:
    return (db.query(P2PPurchaseOrder)
            .filter(P2PPurchaseOrder.p2p_request_id == pr_id, P2PPurchaseOrder.status != "cancelled")
            .order_by(P2PPurchaseOrder.id).all())


def po_approval_status(db: Session, po: P2PPurchaseOrder) -> str | None:
    """Status of the PO's latest engine approval request, or None."""
    from app.modules.organization.services import approval_engine as engine

    req = engine.latest_request(db, PO_ENTITY, po.id)
    return req.status if req is not None else None


def po_is_released(db: Session, po: P2PPurchaseOrder) -> bool:
    """True once the PO itself has its final approval (ME28 release). A PO
    approved before the approval engine has no request — its requisition's
    status tells."""
    if po.status in ("draft", "cancelled"):
        return False
    status = po_approval_status(db, po)
    if status is not None:
        return status == "approved"
    pr = db.get(P2PRequest, po.p2p_request_id) if po.p2p_request_id else None
    return bool(pr is not None and pr.status in _LEGACY_RELEASED_PR_STATUSES and not pr.pending_po_approval_roles)


def buy_qty_by_pr_item(pr: P2PRequest) -> dict[int, float]:
    """What is to be bought per PR line: quantity minus what was issued from stock."""
    out = {}
    for i in pr.items:
        if i.fulfillment_status == "stock_issued":
            continue
        qty = (i.quantity or 0) - (i.issued_qty or 0)
        if qty > 0:
            out[i.id] = qty
    return out


def ordered_qty_by_pr_item(db: Session, pr_id: int, exclude_po_id: int | None = None) -> dict[int, float]:
    q = (db.query(P2PPurchaseOrderItem)
         .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
         .filter(P2PPurchaseOrder.p2p_request_id == pr_id, P2PPurchaseOrder.status != "cancelled"))
    if exclude_po_id:
        q = q.filter(P2PPurchaseOrder.id != exclude_po_id)
    out: dict[int, float] = {}
    for line in q.all():
        if line.pr_item_id:
            out[line.pr_item_id] = out.get(line.pr_item_id, 0) + (line.quantity or 0)
    return out


def has_legacy_whole_pr_po(db: Session, pr_id: int) -> bool:
    """A live PO whose lines don't name their PR line (raised before
    2026-10-14) orders the whole requisition."""
    return (db.query(P2PPurchaseOrderItem.id)
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrder.p2p_request_id == pr_id, P2PPurchaseOrder.status != "cancelled",
                    P2PPurchaseOrderItem.pr_item_id.is_(None))
            .first()) is not None


def open_qty_by_pr_item(db: Session, pr: P2PRequest, exclude_po_id: int | None = None) -> dict[int, float]:
    """Quantity per PR line not yet on any live PO."""
    if has_legacy_whole_pr_po(db, pr.id):
        return {}
    ordered = ordered_qty_by_pr_item(db, pr.id, exclude_po_id)
    out = {}
    for pid, qty in buy_qty_by_pr_item(pr).items():
        left = round(qty - ordered.get(pid, 0), 6)
        if left > 0:
            out[pid] = left
    return out


def ensure_qty_fits(db: Session, pr: P2PRequest, wanted: dict[int, float], exclude_po_id: int | None = None) -> None:
    """422/409 with the reason when `wanted` (pr_item_id -> qty) would order
    more of a PR line than is left to buy."""
    lines = {i.id: i for i in pr.items}
    if has_legacy_whole_pr_po(db, pr.id):
        raise HTTPException(status_code=409, detail=(
            f"{pr.p2p_number} already has a PO for all its lines (raised before POs could be split by vendor). "
            "Cancel that PO first if the requisition must be ordered from several vendors."))
    buy = buy_qty_by_pr_item(pr)
    ordered = ordered_qty_by_pr_item(db, pr.id, exclude_po_id)
    for pid, qty in wanted.items():
        line = lines.get(pid)
        if line is None:
            raise HTTPException(status_code=422, detail=f"PR line #{pid} is not on {pr.p2p_number} — reload the page and pick its lines again.")
        if pid not in buy:
            raise HTTPException(status_code=409, detail=(
                f"'{line.item_name}' was issued from store stock, so there is nothing left to order for it on {pr.p2p_number}."))
        if qty <= 0:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}': the quantity to order must be more than 0.")
        left = round(buy[pid] - ordered.get(pid, 0), 6)
        if qty - left > 1e-6:
            on_po = ordered.get(pid, 0)
            raise HTTPException(status_code=409, detail=(
                f"'{line.item_name}': {qty:g} {line.unit or ''} is more than is left to order. {pr.p2p_number} needs "
                f"{buy[pid]:g}, {on_po:g} is already on other POs, so at most {max(left, 0):g} can go on this one."))


def needs_rollup(db: Session, pr: P2PRequest) -> bool:
    pos = live_pos(db, pr.id)
    if len(pos) > 1:
        return True
    return bool(pos) and bool(open_qty_by_pr_item(db, pr))


def rollup_pr_status(db: Session, pr: P2PRequest, actor_id: int | None, *, force: bool = False) -> str:
    """Re-derive the requisition's status (and PO value / quantities) from
    all its live POs. Returns the status. No-op for terminal statuses."""
    from app.modules.main.models.audit_log import AuditLog

    if pr.status not in _MANAGED_PR_STATUSES:
        return pr.status
    if not force and not needs_rollup(db, pr):
        return pr.status
    pos = live_pos(db, pr.id)
    if not pos:
        return pr.status
    states = []
    for po in pos:
        if po.status == "draft":
            states.append("draft")
        elif po_is_released(db, po):
            states.append(po.status)
        else:
            states.append("in_approval")
    left = open_qty_by_pr_item(db, pr)
    if "in_approval" in states:
        new = "po_raised"
    elif "draft" in states:
        new = "po_drafted"
    elif all(s == "fulfilled" for s in states) and not left:
        new = "received"
    elif any(s in ("partially_fulfilled", "fulfilled") for s in states):
        new = "partially_received"
    else:
        new = "po_approved"
    totals = [po.total_value for po in pos]
    pr.po_value = round(sum(t for t in totals if t), 2) if any(totals) else None
    pr.ordered_quantity = sum(i.quantity or 0 for po in pos for i in po.items)
    from app.modules.accounts.services.po_match import received_by_po_item
    pr.received_quantity = round(sum(sum(received_by_po_item(db, po).values()) for po in pos), 6)
    if new in ("received", "partially_received", "po_approved"):
        pr.receipt_status = {"received": "received", "partially_received": "partial"}.get(new, "pending")
    pr.po_number = ", ".join(po.po_number for po in pos)[:100] if len(pos) > 1 else pos[0].po_number
    if new != pr.status:
        old = pr.status
        pr.status = new
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=pr.id, action="po_rollup", performed_by_id=actor_id,
            summary=f"{pr.p2p_number} is now {new.replace('_', ' ')} — rolled up from its {len(pos)} PO(s) "
                    f"({', '.join(f'{p.po_number}: {s}' for p, s in zip(pos, states))}).",
            old_value=old, new_value=new,
        ))
    return pr.status
