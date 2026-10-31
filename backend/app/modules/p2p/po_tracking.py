"""Purchase Order tracking: the lifecycle stage of every PO, in batches.

A PO's own `status` is not enough to say where it stands: submitting a PO for
approval already sets it to "issued", the requisition is what gets closed or
short-closed (the PO keeps "partially_fulfilled"), and "released" is decided by
the approval engine. This module turns those facts into ONE stage per PO — only
states the backend really has, never an invented one:

    draft            being prepared by Purchase
    in_approval      sent for approval, final approval not given yet
    with_vendor      released, nothing delivered yet
    partly_received  released, part of the quantity delivered
    received         released, everything delivered (requisition still open)
    short_closed     requisition closed with a balance — the vendor won't
                     supply it; the balance is written off
    closed           everything delivered and the requisition closed
    cancelled        cancelled / rejected

`stage_of` is the pure rule; `stages_for` / `load_infos` apply it to many POs
with a fixed number of queries (same release rule as po_split.po_is_released).
Only `with_vendor` and `partly_received` are still awaited from the vendor —
only those can be overdue, count in open value, or get a reminder."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased, selectinload

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.po_split import _LEGACY_RELEASED_PR_STATUSES, EXTERNAL_PO_SOURCES, PO_ENTITY
from app.modules.store.models.item import StoreItem

STAGES: dict[str, str] = {
    "draft": "Draft",
    "in_approval": "In approval",
    "with_vendor": "With vendor",
    "partly_received": "Partly received",
    "received": "Received",
    "short_closed": "Short-closed",
    "closed": "Closed",
    "cancelled": "Cancelled",
}
# Stages where the vendor still owes goods.
OPEN_STAGES = ("with_vendor", "partly_received")
# Stages of a PO that has its final approval.
RELEASED_STAGES = ("with_vendor", "partly_received", "received", "short_closed", "closed")
# A requisition in these states will never receive more goods.
DEAD_PR_STATUSES = ("closed", "cancelled", "rejected")
DUE_SOON_DAYS = 7
_EPS = 1e-9
_CHUNK = 500


def stage_of(po_status: str, released: bool, pr_status: str | None) -> str:
    """The tracking stage from the PO's status, whether it is released and its
    requisition's status."""
    if po_status == "cancelled":
        return "cancelled"
    if po_status == "draft":
        return "draft"
    if not released:
        return "in_approval"
    pr_closed = pr_status == "closed"
    if po_status == "fulfilled":
        return "closed" if pr_closed else "received"
    if pr_closed:
        return "short_closed"
    if po_status == "partially_fulfilled":
        return "partly_received"
    return "with_vendor"


@dataclass
class PoInfo:
    po: P2PPurchaseOrder
    pr: P2PRequest | None
    released: bool
    stage: str


def _chunks(ids: list[int]):
    for i in range(0, len(ids), _CHUNK):
        yield ids[i:i + _CHUNK]


def _approval_status_by_po(db: Session, po_ids: list[int]) -> dict[int, str]:
    """Status of each PO's latest approval request (POs without one are absent)."""
    from app.modules.organization.models.approval import ApprovalRequest

    out: dict[int, str] = {}
    for chunk in _chunks(po_ids):
        rows = (db.query(ApprovalRequest.entity_id, ApprovalRequest.status)
                .filter(ApprovalRequest.entity_type == PO_ENTITY, ApprovalRequest.entity_id.in_(chunk))
                .order_by(ApprovalRequest.id).all())
        for entity_id, status in rows:  # ascending id: the latest request wins
            out[entity_id] = status
    return out


def load_infos(db: Session, pos: list[P2PPurchaseOrder]) -> dict[int, PoInfo]:
    """PoInfo for every PO — approval requests and requisitions loaded in batches."""
    ids = [po.id for po in pos]
    approvals = _approval_status_by_po(db, ids)
    pr_ids = list({po.p2p_request_id for po in pos if po.p2p_request_id})
    prs: dict[int, P2PRequest] = {}
    for chunk in _chunks(pr_ids):
        for pr in db.query(P2PRequest).options(selectinload(P2PRequest.po_approvers)).filter(P2PRequest.id.in_(chunk)).all():
            prs[pr.id] = pr
    out: dict[int, PoInfo] = {}
    for po in pos:
        pr = prs.get(po.p2p_request_id) if po.p2p_request_id else None
        if po.status in ("draft", "cancelled"):
            released = False
        elif po.source in EXTERNAL_PO_SOURCES:
            released = True
        elif po.id in approvals:
            released = approvals[po.id] == "approved"
        else:  # approved before the approval engine: the requisition's status tells
            released = bool(pr is not None and pr.status in _LEGACY_RELEASED_PR_STATUSES and not pr.pending_po_approval_roles)
        out[po.id] = PoInfo(po, pr, released, stage_of(po.status, released, pr.status if pr else None))
    return out


def stages_for(db: Session, pos: list[P2PPurchaseOrder]) -> dict[int, str]:
    return {pid: info.stage for pid, info in load_infos(db, pos).items()}


def _natural(code: str | None):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", code or "")]


def _progress(db: Session, pos: list[P2PPurchaseOrder], today: date) -> dict[int, dict]:
    """Per PO: lines, value, delivered share and open value, from its lines' GRNs / service entries."""
    from app.modules.p2p.routes.po_reports import item_lines

    if not pos:
        return {}
    by_id = {po.id: po for po in pos}
    pairs: list = []
    for chunk in _chunks(list(by_id)):
        pairs += (db.query(P2PPurchaseOrderItem).options(selectinload(P2PPurchaseOrderItem.store_item))
                  .filter(P2PPurchaseOrderItem.purchase_order_id.in_(chunk)).order_by(P2PPurchaseOrderItem.id).all())
    lines = item_lines(db, [(it, by_id[it.purchase_order_id]) for it in pairs], today)
    last_receipt = _last_receipt_dates(db, list(by_id))
    out: dict[int, dict] = {}
    for r in lines:
        p = out.setdefault(r["po_id"], {"lines": 0, "lines_complete": 0, "units": set(), "ordered_qty": 0.0, "delivered_qty": 0.0,
                                        "open_qty": 0.0, "open_value": 0.0, "value": 0.0, "share": 0.0, "weight": 0.0})
        p["lines"] += 1
        p["units"].add((r["unit"] or "").strip())
        ordered, delivered = r["ordered_qty"] or 0.0, r["delivered_qty"]
        if r["open_qty"] <= _EPS:
            p["lines_complete"] += 1
        p["ordered_qty"] += ordered
        p["delivered_qty"] += min(delivered, ordered)
        p["open_qty"] += r["open_qty"]
        p["open_value"] += r["open_value"]
        line_value = ordered * (r["unit_price"] or 0.0)
        p["value"] += line_value
        # Share delivered, weighted by line value (equal weight when nothing is priced).
        weight = line_value if line_value > 0 else 1e-6
        p["share"] += weight * (min(delivered / ordered, 1.0) if ordered > 0 else 1.0)
        p["weight"] += weight
    for pid, p in out.items():
        p["received_pct"] = round(100.0 * p["share"] / p["weight"], 1) if p["weight"] else 0.0
        units = p.pop("units")
        p["unit"] = next(iter(units)) if len(units) == 1 else None
        for k in ("share", "weight"):
            p.pop(k)
        p["open_value"] = round(p["open_value"], 2)
        p["last_receipt_date"] = last_receipt.get(pid)
    return out


def _last_receipt_dates(db: Session, po_ids: list[int]) -> dict[int, date]:
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt

    out: dict[int, date] = {}
    for chunk in _chunks(po_ids):
        rows = (db.query(P2PGoodsReceipt.purchase_order_id, func.max(P2PGoodsReceipt.received_date))
                .filter(P2PGoodsReceipt.purchase_order_id.in_(chunk), P2PGoodsReceipt.status != "reversed")
                .group_by(P2PGoodsReceipt.purchase_order_id).all())
        out.update({pid: d for pid, d in rows if d})
    return out


def _names(db: Session, user_ids: set[int | None]) -> dict[int, str]:
    from app.modules.main.models.user import User

    ids = [i for i in user_ids if i]
    out: dict[int, str] = {}
    for chunk in _chunks(ids):
        for u in db.query(User).filter(User.id.in_(chunk)).all():
            out[u.id] = u.name or u.email
    return out


def _purpose_label(code: str | None) -> str | None:
    from app.modules.p2p.models.p2p_request import P2P_PURPOSES

    return P2P_PURPOSES.get(code) if code else None


SORTS = ("code", "urgency", "due", "date", "vendor", "stage", "value", "progress")


def _join_buyer(q):
    """Join the PO's RFQ and return (query, buyer expression). The buyer of a PO is whoever ran its RFQ
    (RFQ.buyer_id via po.rfq_id), else who raised the PO, else the requisition's single assigned buyer —
    with several buyers on one requisition the requisition's buyer says nothing about this PO."""
    rfq = aliased(RFQ)
    q = q.outerjoin(rfq, rfq.id == P2PPurchaseOrder.rfq_id)
    return q, func.coalesce(rfq.buyer_id, P2PPurchaseOrder.created_by_id, P2PRequest.assigned_buyer_id)


def _buyer_ids(db: Session, pos: list[P2PPurchaseOrder], infos: dict[int, PoInfo]) -> dict[int, int | None]:
    """po.id -> buyer user id, same rule as `_join_buyer` for the rows on a page (one query for the RFQs)."""
    rfq_ids = {po.rfq_id for po in pos if po.rfq_id}
    rfq_buyer = {rid: bid for rid, bid in db.query(RFQ.id, RFQ.buyer_id).filter(RFQ.id.in_(rfq_ids)).all()} if rfq_ids else {}
    out: dict[int, int | None] = {}
    for po in pos:
        pr = infos[po.id].pr
        out[po.id] = (rfq_buyer.get(po.rfq_id) if po.rfq_id else None) or po.created_by_id or (pr.assigned_buyer_id if pr else None)
    return out


def tracking(db: Session, query, *, stage: str | None = None, search: str | None = None, vendor_id: int | None = None,
             buyer_id: int | None = None, overdue_only: bool = False, due_soon_only: bool = False,
             date_from: date | None = None, date_to: date | None = None, order_project_id: int | None = None,
             order_project_element_id: int | None = None, sort: str = "code", desc: bool = False,
             skip: int = 0, limit: int = 50, today: date | None = None) -> dict:
    """The PO tracking list. `query` is a P2PPurchaseOrder query already limited to the viewer's data scope.
    Filters, sorting and paging are applied here on the full matching set, so totals are real; the stage
    counts ignore the stage / overdue / due-soon choice (they are what the filter chips show)."""
    today = today or date.today()
    q = query.outerjoin(P2PRequest, P2PRequest.id == P2PPurchaseOrder.p2p_request_id)
    if vendor_id is not None:
        q = q.filter(P2PPurchaseOrder.vendor_id == vendor_id)
    if buyer_id is not None:
        q, buyer_expr = _join_buyer(q)
        q = q.filter(buyer_expr == buyer_id)
    if date_from:
        q = q.filter(P2PPurchaseOrder.po_date >= date_from)
    if date_to:
        q = q.filter(P2PPurchaseOrder.po_date <= date_to)
    if order_project_element_id:
        q = q.filter(P2PPurchaseOrder.items.any(P2PPurchaseOrderItem.order_project_element_id == order_project_element_id))
    elif order_project_id:
        q = q.filter(P2PPurchaseOrder.items.any(P2PPurchaseOrderItem.order_project_id == order_project_id))
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            P2PPurchaseOrder.po_number.ilike(like), P2PPurchaseOrder.vendor_name.ilike(like),
            P2PRequest.p2p_number.ilike(like), P2PRequest.project_label.ilike(like),
            P2PPurchaseOrder.items.any(or_(P2PPurchaseOrderItem.item_name.ilike(like), P2PPurchaseOrderItem.part_code.ilike(like),
                                           P2PPurchaseOrderItem.store_item.has(StoreItem.item_code.ilike(like)))),
        ))
    pos = q.all()
    infos = load_infos(db, pos)

    counts = {k: 0 for k in STAGES}
    for info in infos.values():
        counts[info.stage] += 1
    open_ids = [po.id for po in pos if infos[po.id].stage in OPEN_STAGES]
    need = {po.id: po for po in pos} if sort == "progress" else {i: infos[i].po for i in open_ids}
    progress = _progress(db, list(need.values()), today)

    def days_to_due(po: P2PPurchaseOrder) -> int | None:
        p = progress.get(po.id)
        if infos[po.id].stage not in OPEN_STAGES or po.expected_delivery is None or not p or p["open_qty"] <= _EPS:
            return None
        return (po.expected_delivery - today).days

    overdue_total = sum(1 for po in pos if (d := days_to_due(po)) is not None and d < 0)
    due_soon_total = sum(1 for po in pos if (d := days_to_due(po)) is not None and 0 <= d <= DUE_SOON_DAYS)
    open_value = round(sum(progress[i]["open_value"] for i in open_ids if i in progress), 2)

    chosen = [po for po in pos if not stage or infos[po.id].stage == stage]
    if overdue_only:
        chosen = [po for po in chosen if (d := days_to_due(po)) is not None and d < 0]
    if due_soon_only:
        chosen = [po for po in chosen if (d := days_to_due(po)) is not None and 0 <= d <= DUE_SOON_DAYS]

    def key(po: P2PPurchaseOrder):
        code = _natural(po.po_number)
        if sort == "urgency":
            d = days_to_due(po)
            return (0, d, code) if d is not None else (1, 0, code)
        if sort == "due":
            return (po.expected_delivery is None, po.expected_delivery or date.max, code)
        if sort == "date":
            return (po.po_date, code)
        if sort == "vendor":
            return ((po.vendor_name or "").lower(), code)
        if sort == "stage":
            return (list(STAGES).index(infos[po.id].stage), code)
        if sort == "value":
            return (po.total_value or 0.0, code)
        if sort == "progress":
            return (progress.get(po.id, {}).get("received_pct", 0.0), code)
        return code
    chosen.sort(key=key, reverse=desc)
    total = len(chosen)
    page = chosen[skip:skip + limit]

    missing = {po.id: po for po in page if po.id not in progress}
    progress.update(_progress(db, list(missing.values()), today))
    buyers = _buyer_ids(db, page, infos)
    names = _names(db, set(buyers.values()))
    rows = []
    for po in page:
        info, p = infos[po.id], progress.get(po.id)
        pr = info.pr
        buyer_id_ = buyers.get(po.id)
        d = days_to_due(po)
        activity = [x for x in (po.updated_at, datetime.combine(p["last_receipt_date"], datetime.min.time()) if p and p.get("last_receipt_date") else None) if x]
        activity = [a.replace(tzinfo=None) if a.tzinfo else a for a in activity]
        single_unit = bool(p and p["unit"] is not None)
        rows.append({
            "po_id": po.id, "po_number": po.po_number, "po_date": po.po_date, "po_status": po.status,
            "stage": info.stage, "stage_label": STAGES[info.stage], "amendment_no": po.amendment_no or 0,
            "p2p_request_id": po.p2p_request_id, "p2p_number": pr.p2p_number if pr else None, "pr_status": pr.status if pr else None,
            "purpose": pr.purpose if pr else None, "purpose_label": _purpose_label(pr.purpose if pr else None),
            "charged_to": pr.project_label if pr else None,
            "vendor_id": po.vendor_id, "vendor_name": po.vendor_name,
            "buyer_id": buyer_id_, "buyer_name": names.get(buyer_id_),
            "expected_delivery": po.expected_delivery, "days_to_due": d,
            "is_overdue": d is not None and d < 0, "is_due_soon": d is not None and 0 <= d <= DUE_SOON_DAYS,
            "lines": p["lines"] if p else 0, "lines_complete": p["lines_complete"] if p else 0,
            "ordered_qty": round(p["ordered_qty"], 6) if single_unit else None,
            "delivered_qty": round(p["delivered_qty"], 6) if single_unit else None,
            "unit": p["unit"] if single_unit else None,
            "received_pct": p["received_pct"] if p else 0.0,
            "total_value": po.total_value, "open_value": p["open_value"] if p and info.stage in OPEN_STAGES else 0.0,
            "last_receipt_date": p.get("last_receipt_date") if p else None,
            "last_activity": max(activity) if activity else None,
        })
    return {"rows": rows, "total": total, "skip": skip, "limit": limit, "counts": counts, "all": len(pos),
            "overdue": overdue_total, "due_soon": due_soon_total, "open_value": open_value, "due_soon_days": DUE_SOON_DAYS}


def filter_options(db: Session, query) -> dict:
    """Vendors and buyers that appear on the viewer's POs — for the filter pickers (sorted by name)."""
    from app.modules.main.models.user import User

    sub = query.outerjoin(P2PRequest, P2PRequest.id == P2PPurchaseOrder.p2p_request_id)
    vendors = sub.with_entities(P2PPurchaseOrder.vendor_id, P2PPurchaseOrder.vendor_name).filter(
        P2PPurchaseOrder.vendor_name.is_not(None)).distinct().all()
    sub, buyer_expr = _join_buyer(sub)
    buyer_ids = [b for (b,) in sub.with_entities(buyer_expr).distinct().all() if b]
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(buyer_ids)).all()} if buyer_ids else {}
    by_vendor: dict = {}
    for vid, name in vendors:
        by_vendor.setdefault(vid if vid is not None else name, {"id": vid, "name": name})
    return {
        "vendors": sorted((v for v in by_vendor.values() if v["id"] is not None), key=lambda v: v["name"].lower()),
        "buyers": sorted(({"id": i, "name": n} for i, n in users.items()), key=lambda b: b["name"].lower()),
    }


def reminder_pos(db: Session, today: date | None = None) -> list[tuple[P2PPurchaseOrder, int]]:
    """POs the daily reminder may chase, with days overdue: released, delivery date passed, goods still
    to come (balance > 0) and a requisition that is still open. In approval, short-closed, closed,
    received and cancelled POs never qualify."""
    today = today or date.today()
    candidates = (db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.p2p_request))
                  .filter(P2PPurchaseOrder.status.in_(("issued", "acknowledged", "partially_fulfilled")),
                          P2PPurchaseOrder.expected_delivery.is_not(None), P2PPurchaseOrder.expected_delivery < today).all())
    infos = load_infos(db, candidates)
    live = [po for po in candidates if infos[po.id].stage in OPEN_STAGES
            and not (infos[po.id].pr is not None and infos[po.id].pr.status in DEAD_PR_STATUSES)]
    progress = _progress(db, live, today)
    return [(po, (today - po.expected_delivery).days) for po in live if progress.get(po.id, {}).get("open_qty", 0.0) > _EPS]
