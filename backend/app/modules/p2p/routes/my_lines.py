"""My Lines: the buyer's worklist (2026-10-31, multi-buyer split).

    GET /p2p/my-lines    the requisition lines a buyer must still quote, order or chase, one row per line

A buyer sees the lines whose buyer they are (the line's own buyer, else the requisition's assigned buyer).
Another buyer's lines, all lines, or the unassigned ones (buyer_id=0) need the Purchase head's grant
(p2p > Purchase Requisitions > All buyers' lines). Every row comes through the Procurement data scope and only
from requisitions that are with procurement. No prices. Sorted by requisition number then line, ascending."""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_feature
from app.core.permissions import GRANT_HINT, ensure_feature_action, ensure_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p import po_split
from app.modules.p2p.access import scope_prs
from app.modules.p2p.line_progress import line_progress_many
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
from app.modules.p2p.models.p2p_request import P2P_PURPOSES, P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.service_entry import P2PServiceEntry
from app.modules.p2p.po_tracking import STAGES, load_infos
from app.modules.p2p.schemas.pr_lines import MyLinePo, MyLineRfq, MyLineRow, MyLinesResponse
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/p2p/my-lines", tags=["P2P"])

_EPS = 1e-6
_CHUNK = 500


def _natural(code: str | None):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", code or "")]


def _can_see_all_lines(user: User) -> bool:
    return po_split.can_work_all_lines(user) or can_feature(user, "p2p", "purchase_requisitions", "all_lines", "view")


# States of lines that have nothing left to do (shown only when asked for by name).
_DONE_STATES = ("received", "short_closed", "issued_from_stock")


def _has_work_sql():
    """SQL test on P2PRequestItem: 'something is still to do on this line' - quantity still to order, or a live PO
    line not fully received. It mirrors line_progress (open_to_order / pending_receipt) closely enough to be a SAFE
    SUPERSET (never drops a line that has work; PO lines that name no requisition line count as open), so the
    exact figures are computed only for requisitions that can really appear. Final decision: line_progress_many."""
    poi, po = P2PPurchaseOrderItem, P2PPurchaseOrder
    ordered = (select(func.coalesce(func.sum(poi.quantity), 0.0))
               .join(po, po.id == poi.purchase_order_id)
               .where(poi.pr_item_id == P2PRequestItem.id, po.status != "cancelled")
               .correlate(P2PRequestItem).scalar_subquery())
    def floor0(x):  # GREATEST(x, 0) without GREATEST (the tests run on SQLite)
        return case((x > 0, x), else_=0.0)

    buy = case((P2PRequestItem.fulfillment_status == "stock_issued", 0.0),
               else_=floor0(P2PRequestItem.quantity - func.coalesce(P2PRequestItem.issued_qty, 0.0)
                            - func.coalesce(P2PRequestItem.short_closed_qty, 0.0)))
    grn_kept = (select(func.coalesce(func.sum(case(
        (P2PGoodsReceiptItem.quality_status.in_(("passed", "failed", "partial")),
         floor0(func.coalesce(P2PGoodsReceiptItem.accepted_quantity, 0.0)
                - func.coalesce(P2PGoodsReceiptItem.returned_quantity, 0.0))),
        else_=func.coalesce(P2PGoodsReceiptItem.received_quantity, 0.0))), 0.0))
        .join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
        .where(P2PGoodsReceiptItem.po_item_id == poi.id, P2PGoodsReceipt.status != "reversed")
        .correlate(poi).scalar_subquery())
    entries = (select(func.coalesce(func.sum(P2PServiceEntry.quantity), 0.0))
               .where(P2PServiceEntry.po_item_id == poi.id, P2PServiceEntry.status == "accepted")
               .correlate(poi).scalar_subquery())
    pending_po_line = (exists().where(poi.pr_item_id == P2PRequestItem.id, po.id == poi.purchase_order_id,
                                      po.status != "cancelled", poi.quantity - grn_kept - entries > _EPS)
                       .correlate(P2PRequestItem))
    return or_(buy - ordered > _EPS, pending_po_line)


def _chunks(ids: list[int]):
    for i in range(0, len(ids), _CHUNK):
        yield ids[i:i + _CHUNK]


@router.get("", response_model=MyLinesResponse)
def my_lines(
    buyer_id: int | None = Query(None, description="Another buyer's id (0 = lines with no buyer); needs All buyers' lines"),
    all_buyers: bool = Query(False, alias="all", description="Every buyer's lines; needs All buyers' lines"),
    state: str | None = Query(None, description="Only lines in this state (see counts)"),
    search: str | None = Query(None, description="Requisition number, item code or name, charged-to"),
    p2p_request_id: int | None = Query(None),
    urgent: bool = Query(False, description="Only requisitions with priority Urgent"),
    overdue: bool = Query(False, description="Only open lines whose requisition is past its required date"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_tab_action(user, "p2p", "purchase_requisitions", "view")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "my_lines", "view")
    other = all_buyers or (buyer_id is not None and buyer_id != user.id)
    if other and not _can_see_all_lines(user):
        raise HTTPException(
            status_code=403,
            detail="You can see only your own lines. Another buyer's lines, all lines and the unassigned ones need "
                   f"'All buyers' lines (purchase head)' on Procurement > Purchase Requisitions. {GRANT_HINT}")
    target = None if all_buyers else (user.id if buyer_id is None else buyer_id)  # None = every buyer, 0 = unassigned

    q = scope_prs(db.query(P2PRequest), db, user).filter(P2PRequest.status.in_(po_split.PROCUREMENT_OPEN_STATUSES))
    if p2p_request_id is not None:
        q = q.filter(P2PRequest.id == p2p_request_id)
    if urgent:
        q = q.filter(P2PRequest.priority == "urgent")
    if overdue:
        q = q.filter(P2PRequest.required_date.is_not(None), P2PRequest.required_date < date.today())
    # Only requisitions with at least one line of this buyer that still has work (SQL), then exact progress for those.
    done_ok = bool(state) and state in _DONE_STATES and not overdue  # finished lines are shown only when asked for
    line_cond = []
    if target is not None:
        if target == 0:
            line_cond.append(and_(P2PRequestItem.buyer_id.is_(None), P2PRequest.assigned_buyer_id.is_(None)))
        else:
            line_cond.append(or_(P2PRequestItem.buyer_id == target,
                                 and_(P2PRequestItem.buyer_id.is_(None), P2PRequest.assigned_buyer_id == target)))
    if not done_ok:
        line_cond.append(_has_work_sql())
    if line_cond:
        q = q.filter(exists().where(P2PRequestItem.p2p_request_id == P2PRequest.id, *line_cond).correlate(P2PRequest))
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            P2PRequest.p2p_number.ilike(like), P2PRequest.project_label.ilike(like),
            P2PRequest.items.any(or_(P2PRequestItem.item_name.ilike(like), P2PRequestItem.part_code.ilike(like),
                                     P2PRequestItem.store_item.has(StoreItem.item_code.ilike(like))))))
    prs = (q.options(selectinload(P2PRequest.items).selectinload(P2PRequestItem.store_item))
           .order_by(P2PRequest.p2p_number, P2PRequest.id).all())

    # The lines this view is about (this buyer's, matching the search), then their derived progress in one batched pass.
    wanted: list[tuple[P2PRequest, P2PRequestItem]] = []
    for pr in prs:
        for it in sorted(pr.items, key=lambda i: i.id):
            eff = po_split.effective_buyer_id(it, pr)
            if target is not None and (eff or 0) != target:
                continue
            if term and not (term.lower() in (pr.p2p_number or "").lower() or term.lower() in (pr.project_label or "").lower()
                             or term.lower() in (it.item_name or "").lower() or term.lower() in (it.part_code or "").lower()
                             or term.lower() in (it.item_code or "").lower()):
                continue
            wanted.append((pr, it))
    progress = line_progress_many(db, list({pr.id: pr for pr, _ in wanted}.values()))
    candidates: list[tuple[P2PRequest, P2PRequestItem, object]] = []
    counts: dict[str, int] = defaultdict(int)
    for pr, it in wanted:
        lp = progress[pr.id][it.id]
        if lp.open_to_order > _EPS or lp.pending_receipt > _EPS:  # still something to do
            counts[lp.state] += 1
            candidates.append((pr, it, lp))
        elif done_ok and lp.state == state:  # an explicitly requested finished state shows its lines too
            candidates.append((pr, it, lp))
    if state:
        candidates = [c for c in candidates if c[2].state == state]
    candidates.sort(key=lambda c: (_natural(c[0].p2p_number), c[1].id))
    total = len(candidates)
    page = candidates[skip:skip + limit]

    # ── Names, RFQs and POs of the page's lines ──
    line_ids = [it.id for _, it, _ in page]
    user_ids = {pr.requested_by_id for pr, _, _ in page} | {po_split.effective_buyer_id(it, pr) for pr, it, _ in page}
    names = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_([i for i in user_ids if i])).all()} if user_ids else {}
    rfqs: dict[int, list[MyLineRfq]] = defaultdict(list)
    rfq_seen: set[tuple[int, int]] = set()
    pos_by_line: dict[int, dict[int, P2PPurchaseOrder]] = defaultdict(dict)
    activity: dict[int, list[datetime]] = defaultdict(list)
    if line_ids:
        for chunk in _chunks(line_ids):
            for lid, rfq in (db.query(RFQItem.pr_item_id, RFQ).join(RFQ, RFQ.id == RFQItem.rfq_id)
                             .filter(RFQItem.pr_item_id.in_(chunk), RFQItem.withdrawn_at.is_(None)).order_by(RFQ.id).all()):
                if rfq.source == "before_po" or (lid, rfq.id) in rfq_seen:
                    continue
                rfq_seen.add((lid, rfq.id))
                rfqs[lid].append(MyLineRfq(id=rfq.id, rfq_number=rfq.rfq_number, status=rfq.status))
                activity[lid].append(rfq.updated_at)
            for lid, po in (db.query(P2PPurchaseOrderItem.pr_item_id, P2PPurchaseOrder)
                            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
                            .filter(P2PPurchaseOrderItem.pr_item_id.in_(chunk), P2PPurchaseOrder.status != "cancelled")
                            .order_by(P2PPurchaseOrder.id).all()):
                pos_by_line[lid][po.id] = po
                activity[lid].append(po.updated_at)
    all_pos = list({po.id: po for per in pos_by_line.values() for po in per.values()}.values())
    infos = load_infos(db, all_pos) if all_pos else {}

    def naive(dt: datetime | None) -> datetime | None:
        return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo else dt

    rows: list[MyLineRow] = []
    for pr, it, lp in page:
        buyer = po_split.effective_buyer_id(it, pr)
        stamps = [naive(x) for x in (*activity.get(it.id, []), it.updated_at, pr.updated_at) if x is not None]
        rows.append(MyLineRow(
            pr_item_id=it.id, p2p_request_id=pr.id, p2p_number=pr.p2p_number, pr_status=pr.status, priority=pr.priority,
            required_date=pr.required_date, requester_name=names.get(pr.requested_by_id),
            purpose_label=P2P_PURPOSES.get(pr.purpose) if pr.purpose else None, charged_to=pr.project_label,
            item_code=it.item_code, item_name=it.item_name, unit=it.unit, buy_qty=lp.buy_qty,
            short_closed_qty=lp.short_closed_qty, ordered_qty=lp.ordered_qty, released_qty=lp.released_qty,
            accepted_qty=lp.accepted_qty, open_to_order=lp.open_to_order, pending_receipt=lp.pending_receipt,
            state=lp.state, state_label=lp.state_label, buyer_id=buyer, buyer_name=names.get(buyer),
            po_rejected=lp.po_rejected, rfqs=rfqs.get(it.id, []),
            pos=[MyLinePo(id=po.id, po_number=po.po_number, stage=infos[po.id].stage, stage_label=STAGES[infos[po.id].stage])
                 for po in sorted(pos_by_line.get(it.id, {}).values(), key=lambda p: p.id)],
            last_activity=max(stamps) if stamps else None))
    return MyLinesResponse(rows=rows, total=total, skip=skip, limit=limit, counts=dict(counts))
