"""Where every line of a requisition stands, derived (never stored).

A purchase requisition line is the unit of work: its buyer quotes it on an RFQ,
awards it (the whole quantity or a split between vendors), uploads one PO per
vendor, and the goods arrive per PO. This module turns those facts into one
`LineProgress` per line with a fixed number of queries, for the requester's
tracker, the buyers' My Lines page and the header roll-up chip.

    buy_qty          quantity - issued from stock - short-closed (what procurement must buy)
    ordered_qty      sum of live (not cancelled) PO line quantities, drafts and POs in approval included
    released_qty     the part of ordered_qty on POs that have their final approval
    accepted_qty     passed inspection and still with us (GRN accepted - returned, plus accepted service entries)
    rejected_qty     failed inspection
    open_to_order    buy_qty - ordered_qty, never below 0 (`over_ordered` is set instead)
    pending_receipt  ordered_qty - what has been received (accepted for inspected lines, received for
                     lines still in inspection - the same rule as the goods-receipt screen)

State (the badge on a line) is that of the least-advanced unfinished quantity.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

_EPS = 1e-6
_PR_CHUNK = 200
_DECIDED = ("passed", "failed", "partial")

STATE_LABELS: dict[str, str] = {
    "awaiting_stock_decision": "Waiting for stock check",
    "issued_from_stock": "Issued from stock",
    "to_quote": "With buyer - RFQ not sent yet",
    "quoting": "Waiting for vendor quotes",
    "awarded": "Vendor chosen - PO to upload",
    "po_in_approval": "PO in approval",
    "with_vendor": "With vendor",
    "partly_received": "Partly received",
    "received": "Received",
    "short_closed": "Closed short",
}

# Badge of an "awarded" line whose PO was rejected by the approvers (the state stays "awarded").
PO_REJECTED_LABEL = "Vendor chosen - PO rejected, upload again"


@dataclass
class LineProgress:
    pr_item_id: int
    buy_qty: float
    short_closed_qty: float
    ordered_qty: float
    released_qty: float
    accepted_qty: float
    rejected_qty: float
    open_to_order: float
    pending_receipt: float
    state: str
    state_label: str
    over_ordered: bool = False
    # Awarded to a vendor but not yet on a PO (sum over quote lines of awarded - already ordered).
    awarded_no_po: float = 0.0
    # The line's latest PO was rejected by its approvers (it is cancelled) and the awarded quantity is waiting for a new PO.
    po_rejected: bool = False


def _chunks(ids: list[int], size: int = 500):
    for i in range(0, len(ids), size):
        yield ids[i:i + size]


def _legacy_line_map(pr: P2PRequest) -> dict[int, int]:
    """store_item_id -> PR line id for lines whose item appears once on the
    requisition. Only used to place PO lines raised before PO lines named their
    requisition line (pr_item_id NULL); matched by item id, never by name."""
    seen: dict[int, list[int]] = {}
    for i in pr.items:
        if i.store_item_id:
            seen.setdefault(i.store_item_id, []).append(i.id)
    return {sid: ids[0] for sid, ids in seen.items() if len(ids) == 1}


def _label(state: str, over: bool, open_to_order: float, ordered: float, draft_only: bool, po_rejected: bool = False) -> str:
    label = PO_REJECTED_LABEL if (state == "awarded" and po_rejected) else STATE_LABELS[state]
    if state == "po_in_approval" and draft_only:
        label = "PO being prepared"
    if state in ("to_quote", "quoting", "awarded") and ordered > _EPS and open_to_order > _EPS:
        label += " (part already ordered)"
    if over:
        label += " - ordered above need"
    return label


def line_progress(db: Session, pr: P2PRequest) -> dict[int, LineProgress]:
    """pr_item_id -> LineProgress for every line of `pr`, a fixed number of queries."""
    return line_progress_many(db, [pr]).get(pr.id, {})


def line_progress_many(db: Session, prs: list[P2PRequest]) -> dict[int, dict[int, LineProgress]]:
    """pr id -> {pr_item_id -> LineProgress} for several requisitions at once. The queries are shared (one pass per
    chunk of requisitions, not per requisition), so a worklist over hundreds of requisitions stays cheap."""
    out: dict[int, dict[int, LineProgress]] = {}
    for i in range(0, len(prs), _PR_CHUNK):
        out.update(_progress_chunk(db, prs[i:i + _PR_CHUNK]))
    return out


def _progress_chunk(db: Session, prs: list[P2PRequest]) -> dict[int, dict[int, LineProgress]]:
    from app.modules.organization.models.approval import ApprovalRequest
    from app.modules.p2p.approvals import PO_ENTITY
    from app.modules.p2p.models.rfq import RFQ
    from app.modules.p2p.models.rfq_item import RFQItem
    from app.modules.p2p.models.service_entry import P2PServiceEntry
    from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
    from app.modules.p2p.po_tracking import load_infos

    by_pr = {pr.id: pr for pr in prs}
    items: list[P2PRequestItem] = [i for pr in prs for i in pr.items]
    if not items:
        return {pr.id: {} for pr in prs}
    line_ids = [i.id for i in items]
    legacy_by_pr = {pr.id: _legacy_line_map(pr) for pr in prs}

    def line_of(it: P2PPurchaseOrderItem, po: P2PPurchaseOrder) -> int | None:
        return it.pr_item_id or legacy_by_pr.get(po.p2p_request_id, {}).get(it.store_item_id or 0)

    # Live PO lines of these requisitions, with their PO.
    rows = (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrder.p2p_request_id.in_(list(by_pr)), P2PPurchaseOrder.status != "cancelled")
            .order_by(P2PPurchaseOrderItem.id).all())
    pos = list({po.id: po for _, po in rows}.values())
    infos = load_infos(db, pos) if pos else {}

    po_item_ids = [it.id for it, _ in rows]
    received_fig: dict[int, float] = {}   # per PO line: what no longer counts as pending from the vendor
    accepted: dict[int, float] = {}
    rejected: dict[int, float] = {}
    for chunk in _chunks(po_item_ids):
        grn_items = (db.query(P2PGoodsReceiptItem)
                     .join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
                     .filter(P2PGoodsReceiptItem.po_item_id.in_(chunk), P2PGoodsReceipt.status != "reversed").all())
        for g in grn_items:
            if g.quality_status in _DECIDED:
                kept = max((g.accepted_quantity or 0) - (g.returned_quantity or 0), 0.0)
                received_fig[g.po_item_id] = received_fig.get(g.po_item_id, 0.0) + kept
                accepted[g.po_item_id] = accepted.get(g.po_item_id, 0.0) + kept
                rejected[g.po_item_id] = rejected.get(g.po_item_id, 0.0) + (g.rejected_quantity or 0.0)
            else:
                received_fig[g.po_item_id] = received_fig.get(g.po_item_id, 0.0) + (g.received_quantity or 0.0)
        for ses in (db.query(P2PServiceEntry.po_item_id, P2PServiceEntry.quantity)
                    .filter(P2PServiceEntry.po_item_id.in_(chunk), P2PServiceEntry.status == "accepted").all()):
            received_fig[ses[0]] = received_fig.get(ses[0], 0.0) + (ses[1] or 0.0)
            accepted[ses[0]] = accepted.get(ses[0], 0.0) + (ses[1] or 0.0)

    ordered: dict[int, float] = {}
    released: dict[int, float] = {}
    pending: dict[int, float] = {}
    accepted_by_line: dict[int, float] = {}
    rejected_by_line: dict[int, float] = {}
    on_quote_line: dict[int, float] = {}       # vendor_quotation_item_id -> qty on live POs
    unreleased_pos: dict[int, set[str]] = {}   # line -> {"draft", "in_approval"}
    latest_live: dict[int, int] = {}           # line -> id of its newest live PO
    for it, po in rows:
        lid = line_of(it, po)
        if not lid:
            continue
        qty = it.quantity or 0.0
        ordered[lid] = ordered.get(lid, 0.0) + qty
        latest_live[lid] = max(latest_live.get(lid, 0), po.id)
        info = infos.get(po.id)
        if info is not None and info.released:
            released[lid] = released.get(lid, 0.0) + qty
        else:
            unreleased_pos.setdefault(lid, set()).add("draft" if po.status == "draft" else "in_approval")
        pending[lid] = pending.get(lid, 0.0) + max(qty - received_fig.get(it.id, 0.0), 0.0)
        accepted_by_line[lid] = accepted_by_line.get(lid, 0.0) + accepted.get(it.id, 0.0)
        rejected_by_line[lid] = rejected_by_line.get(lid, 0.0) + rejected.get(it.id, 0.0)
        if it.vendor_quotation_item_id:
            on_quote_line[it.vendor_quotation_item_id] = on_quote_line.get(it.vendor_quotation_item_id, 0.0) + qty

    # Awards that have no PO yet.
    awarded_no_po: dict[int, float] = {}
    for chunk in _chunks(line_ids):
        for vqi in (db.query(VendorQuotationItem)
                    .join(VendorQuotation, VendorQuotation.id == VendorQuotationItem.vendor_quotation_id)
                    .filter(VendorQuotationItem.pr_item_id.in_(chunk), VendorQuotationItem.awarded_qty > 0).all()):
            left = (vqi.awarded_qty or 0.0) - on_quote_line.get(vqi.id, 0.0)
            if left > _EPS:
                awarded_no_po[vqi.pr_item_id] = awarded_no_po.get(vqi.pr_item_id, 0.0) + left

    # Lines whose LATEST PO was rejected by its approvers (a rejection cancels just that PO and keeps the award).
    latest_cancelled: dict[int, int] = {}
    for chunk in _chunks(list(awarded_no_po)):
        for it, po in (db.query(P2PPurchaseOrderItem, P2PPurchaseOrder)
                       .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
                       .filter(P2PPurchaseOrder.status == "cancelled", P2PPurchaseOrderItem.pr_item_id.in_(chunk))
                       .order_by(P2PPurchaseOrderItem.id).all()):
            latest_cancelled[it.pr_item_id] = max(latest_cancelled.get(it.pr_item_id, 0), po.id)
    rejected_po_ids: set[int] = set()
    if latest_cancelled:
        rejected_po_ids = {eid for (eid,) in db.query(ApprovalRequest.entity_id)
                           .filter(ApprovalRequest.entity_type == PO_ENTITY,
                                   ApprovalRequest.entity_id.in_(set(latest_cancelled.values())),
                                   ApprovalRequest.status == "rejected").all()}

    # Lines on an RFQ that is out for quotes (locked) or still being prepared (draft).
    on_locked_rfq: set[int] = set()
    for chunk in _chunks(line_ids):
        for line_id, status, source in (db.query(RFQItem.pr_item_id, RFQ.status, RFQ.source)
                                        .join(RFQ, RFQ.id == RFQItem.rfq_id)
                                        .filter(RFQItem.pr_item_id.in_(chunk), RFQItem.withdrawn_at.is_(None),
                                                RFQ.status == "locked").all()):
            if source != "before_po":
                on_locked_rfq.add(line_id)

    result: dict[int, dict[int, LineProgress]] = {pr.id: {} for pr in prs}
    for i in items:
        pr_closed = by_pr[i.p2p_request_id].status == "closed"
        qty = i.quantity or 0.0
        issued = i.issued_qty or 0.0
        short = getattr(i, "short_closed_qty", 0.0) or 0.0
        stock_issued = i.fulfillment_status == "stock_issued"
        buy = 0.0 if stock_issued else max(round(qty - issued - short, 6), 0.0)
        ord_q = round(ordered.get(i.id, 0.0), 6)
        rel_q = round(released.get(i.id, 0.0), 6)
        acc_q = round(accepted_by_line.get(i.id, 0.0), 6)
        rej_q = round(rejected_by_line.get(i.id, 0.0), 6)
        pend_q = round(pending.get(i.id, 0.0), 6)
        open_q = max(round(buy - ord_q, 6), 0.0)
        over = ord_q - buy > _EPS
        awarded_q = round(awarded_no_po.get(i.id, 0.0), 6)
        draft_only = unreleased_pos.get(i.id, set()) == {"draft"}
        cancelled_id = latest_cancelled.get(i.id, 0)
        po_rej = awarded_q > _EPS and cancelled_id > latest_live.get(i.id, 0) and cancelled_id in rejected_po_ids

        if stock_issued or (buy <= _EPS and ord_q <= _EPS and issued > _EPS and short <= _EPS):
            state = "issued_from_stock"
        elif buy <= _EPS and ord_q <= _EPS:
            state = "short_closed" if (short > _EPS or pr_closed) else "issued_from_stock"
        elif ord_q <= _EPS and i.fulfillment_status in (None, "pending") and not pr_closed:
            state = "awaiting_stock_decision"
        elif pr_closed and (open_q > _EPS or pend_q > _EPS):
            state = "short_closed"
        elif open_q > _EPS:
            # Part of the line has not been ordered: it is at the least-advanced stage.
            if awarded_q > _EPS:
                state = "awarded"
            elif i.id in on_locked_rfq:
                state = "quoting"
            else:
                state = "to_quote"
        elif unreleased_pos.get(i.id):
            state = "po_in_approval"
        elif pend_q <= _EPS:
            state = "short_closed" if short > _EPS else "received"
        elif pend_q + _EPS < ord_q:
            state = "partly_received"
        else:
            state = "with_vendor"
        flag = po_rej and state == "awarded"
        result[i.p2p_request_id][i.id] = LineProgress(
            pr_item_id=i.id, buy_qty=buy, short_closed_qty=round(short, 6), ordered_qty=ord_q, released_qty=rel_q,
            accepted_qty=acc_q, rejected_qty=rej_q, open_to_order=open_q, pending_receipt=pend_q, state=state,
            state_label=_label(state, over, open_q, ord_q, draft_only, flag), over_ordered=over,
            awarded_no_po=awarded_q, po_rejected=flag)
    return result
