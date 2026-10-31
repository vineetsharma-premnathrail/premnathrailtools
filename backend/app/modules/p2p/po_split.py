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

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

PO_ENTITY = "p2p_purchase_order"

# Multi-buyer split (2026-10-31): once a requisition is approved its `status` is only a
# roll-up summary written by `rollup_pr_status(..., force=True)`. The ONE thing procurement
# gates may ask of it is `is_procurement_open(pr)` — everything else (can this line be
# quoted, awarded, ordered, received) is decided from the line, RFQ and PO themselves.
PROCUREMENT_OPEN_STATUSES = (
    "approved", "vendor_quotations", "technical_evaluation", "commercial_evaluation", "vendor_selected",
    "po_drafted", "po_raised", "po_approved", "partially_received", "received",
)

# PR statuses the roll-up may move between — never a terminal one.
_MANAGED_PR_STATUSES = set(PROCUREMENT_OPEN_STATUSES)
# PR statuses a further (split) PO can be drafted at.
SPLIT_PO_PR_STATUSES = _MANAGED_PR_STATUSES
_LEGACY_RELEASED_PR_STATUSES = ("po_approved", "partially_received", "received", "closed")
# POs approved outside the portal and uploaded (purchase_order.source) —
# released from import, there is no portal approval to wait for.
EXTERNAL_PO_SOURCES = ("tally",)


def is_procurement_open(pr: P2PRequest) -> bool:
    """True while the requisition is at procurement stage: approved onward, not
    closed, cancelled or rejected. The only gate that may read `pr.status`."""
    return pr is not None and pr.status in PROCUREMENT_OPEN_STATUSES


def effective_buyer_id(item: P2PRequestItem, pr: P2PRequest) -> int | None:
    """Who buys this line: its own buyer (set per item type / by the purchase head),
    else the requisition's assigned buyer."""
    return getattr(item, "buyer_id", None) or getattr(pr, "assigned_buyer_id", None)


def can_work_all_lines(user) -> bool:
    """Admin, or the explicit Purchase-head grant p2p > purchase_requisitions >
    All buyers' lines > edit: may raise RFQs, award, upload POs and short-close
    lines that another buyer owns. Never raises; deny by default."""
    from app.core.permission_registry import can_feature, is_admin_user

    if user is None:
        return False
    return is_admin_user(user) or can_feature(user, "p2p", "purchase_requisitions", "all_lines", "edit")


def lock_pr(db: Session, pr_id: int) -> P2PRequest:
    """The requisition row, locked FOR UPDATE NOWAIT and re-read from the database
    (populate_existing), with its lines reloaded too. It is the one serialisation
    point for award, upload-PO, reassign, short-close, close and amendments that
    add lines: take it, then run `ensure_qty_fits` against the fresh rows.
    Never `await` between this call and the commit (the event loop is shared)."""
    try:
        pr = (db.query(P2PRequest).filter(P2PRequest.id == pr_id)
              .populate_existing().with_for_update(nowait=True).first())
    except OperationalError:
        db.rollback()
        raise HTTPException(status_code=409, detail=(
            "Another buyer is changing this requisition right now (quotes, awards, a PO upload or a line move). "
            "Wait a few seconds, reload the page to see their change, then try again."))
    if pr is None:
        raise HTTPException(status_code=404, detail="That requisition no longer exists — go back to Procurement > Requisitions and pick another.")
    # Lines may have been changed by the request that held the lock before us.
    db.query(P2PRequestItem).filter(P2PRequestItem.p2p_request_id == pr_id).populate_existing().all()
    db.expire(pr, ["items"])
    return pr


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
    if po.source in EXTERNAL_PO_SOURCES:
        return True
    status = po_approval_status(db, po)
    if status is not None:
        return status == "approved"
    pr = db.get(P2PRequest, po.p2p_request_id) if po.p2p_request_id else None
    return bool(pr is not None and pr.status in _LEGACY_RELEASED_PR_STATUSES and not pr.pending_po_approval_roles)


def buy_qty_by_pr_item(pr: P2PRequest) -> dict[int, float]:
    """What is to be bought per PR line: quantity minus what was issued from stock
    and minus what the buyer short-closed (decided not to buy)."""
    out = {}
    for i in pr.items:
        if i.fulfillment_status == "stock_issued":
            continue
        qty = round((i.quantity or 0) - (i.issued_qty or 0) - (getattr(i, "short_closed_qty", 0) or 0), 6)
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


def _has_locked_rfq(db: Session, pr_id: int) -> tuple[bool, bool]:
    """(any RFQ out for quotes, every such RFQ is a Before-PO plumbing RFQ)."""
    from app.modules.p2p.models.rfq import RFQ

    rows = db.query(RFQ.source).filter(RFQ.p2p_request_id == pr_id, RFQ.status == "locked").all()
    return bool(rows), bool(rows) and all(src == "before_po" for (src,) in rows)


def _po_states(db: Session, pos: list[P2PPurchaseOrder]) -> list[str]:
    states = []
    for po in pos:
        if po.status == "draft":
            states.append("draft")
        elif po_is_released(db, po):
            states.append(po.status)
        else:
            states.append("in_approval")
    return states


def rollup_pr_status(db: Session, pr: P2PRequest, actor_id: int | None = None, *, force: bool = False) -> str:
    """Re-derive the approved requisition's header status (and PO value /
    quantities) from its lines, RFQs and live POs. Returns the status. No-op for
    statuses outside procurement (draft, submitted, returned, rejected,
    cancelled, closed).

    With `force=True` (every event: RFQ submit, award, PO upload / decision /
    cancel, GRN, short-close, reassign) it always runs, also with no live PO:

        no live PO, nothing left to buy and nothing bought -> closed (auto, audited)
        no live PO, an RFQ is out for quotes                -> vendor_quotations
                                                               (vendor_selected if only Before-PO RFQs)
        no live PO otherwise                                -> approved
        any PO in approval                                  -> po_raised
        any PO still a draft                                -> po_drafted
        every PO fulfilled and nothing left to order        -> received
        any PO part/fully fulfilled                         -> partially_received
        else                                                -> po_approved

    Without `force` it only takes over for several POs or a PO that leaves PR
    quantity unordered (the old one-PO flow is untouched)."""
    from app.modules.main.models.audit_log import AuditLog

    if pr.status not in _MANAGED_PR_STATUSES:
        return pr.status
    if not force and not needs_rollup(db, pr):
        return pr.status
    pos = live_pos(db, pr.id)
    if not pos:
        return _rollup_without_pos(db, pr, actor_id)
    states = _po_states(db, pos)
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


def _rollup_without_pos(db: Session, pr: P2PRequest, actor_id: int | None) -> str:
    """Header status of an approved requisition with no live PO (all POs
    cancelled / rejected, or none raised yet)."""
    from app.modules.main.models.audit_log import AuditLog

    old = pr.status
    # Nothing left to buy (every line from stock or short-closed) and nothing bought: done.
    if pr.items and not buy_qty_by_pr_item(pr) and not has_legacy_whole_pr_po(db, pr.id):
        pr.status = "closed"
        pr.closed_at = datetime.now(timezone.utc)
        pr.closed_by_id = actor_id
        if old != "closed":
            db.add(AuditLog(
                entity_type="p2p_request", entity_id=pr.id, action="closed", performed_by_id=actor_id,
                summary=f"{pr.p2p_number} closed automatically — every line was issued from store stock or short-closed, "
                        "so there is nothing left to buy and no PO exists.",
                old_value=old, new_value="closed"))
        return pr.status
    locked, only_before_po = _has_locked_rfq(db, pr.id)
    new = ("vendor_selected" if only_before_po else "vendor_quotations") if locked else "approved"
    if new != old:
        pr.status = new
        pr.po_number = None
        pr.po_value = None
        pr.ordered_quantity = 0
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=pr.id, action="po_rollup", performed_by_id=actor_id,
            summary=f"{pr.p2p_number} is now {new.replace('_', ' ')} — it has no live PO "
                    f"({'an RFQ is out for quotes' if locked else 'no RFQ is out for quotes'}).",
            old_value=old, new_value=new))
    return pr.status
