"""Per-line actions on a requisition and the requester's tracker (2026-10-31, multi-buyer split).

    POST /p2p/requests/{pr_id}/lines/{item_id}/reassign-buyer   the Purchase head moves a line's un-ordered quantity to another buyer
    POST /p2p/requests/{pr_id}/lines/{item_id}/short-close      the line's buyer (or the head) writes off its un-ordered quantity
    GET  /p2p/requests/{pr_id}/tracker                          who approved the PR, and per line buyer, RFQ, PO, PO approval, GRNs

Rules shared by all three:
  * the requisition is loaded through the Procurement data scope first (403 outside it); a line or
    child record that is not on that requisition is a 404, never someone else's data;
  * the two actions run under the requisition row lock (po_split.lock_pr) and commit before returning;
    they are plain `def` routes, so nothing awaits between the lock and the commit;
  * "own lines only" unless the user holds All buyers' lines (po_split.can_work_all_lines);
  * notifications are bell only (Teams is for approvals and reminders);
  * the tracker never carries money; a vendor name only for people who may see PO commercials.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core import assignee_rules
from app.core.permission_registry import can_view_tab
from app.core.permissions import GRANT_HINT, ensure_feature_action, ensure_tab_action, require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p import po_split
from app.modules.p2p.line_progress import LineProgress, _legacy_line_map, line_progress
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.p2p_request import P2P_ROLE_LABELS, P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.modules.p2p.po_tracking import STAGES, load_infos
from app.modules.p2p.routes.p2p_requests import (
    BUYER_RULE_KEY,
    _can_see_po_commercials,
    _check_view_access,
    _get_pr_or_404,
    _requester_or_purchase,
    _sees_pr_feature,
    _to_response,
    _write_audit,
)
from app.modules.p2p.schemas.p2p_request import P2PRequestResponse
from app.modules.p2p.schemas.pr_lines import (
    PrTrackerResponse,
    ReassignBuyerPayload,
    ShortClosePayload,
    TrackerApproval,
    TrackerApprovalStep,
    TrackerGrn,
    TrackerLine,
    TrackerPo,
    TrackerProgress,
    TrackerRfq,
)
from app.utils.notifications import notify_user

router = APIRouter(prefix="/p2p/requests", tags=["P2P"])

_EPS = 1e-6
MIN_REASON = 5
_DONE_STATES = ("received", "issued_from_stock", "short_closed")

STATUS_LABELS = {
    "draft": "Draft", "submitted": "Waiting for approval", "returned": "Returned for changes", "rejected": "Rejected",
    "cancelled": "Cancelled", "approved": "Approved - with procurement", "vendor_quotations": "RFQ out for quotes",
    "technical_evaluation": "Technical evaluation", "commercial_evaluation": "Commercial evaluation",
    "vendor_selected": "Vendor chosen", "po_drafted": "PO being prepared", "po_raised": "PO in approval",
    "po_approved": "PO approved", "partially_received": "Partly received", "received": "Received", "closed": "Closed",
}


def _who(user: User) -> str:
    return user.name or user.email


def _names(db: Session, ids) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(wanted)).all()}


def _line_or_404(pr: P2PRequest, item_id: int) -> P2PRequestItem:
    """The line, only if it is on THIS requisition (never trust the id alone)."""
    for item in pr.items:
        if item.id == item_id:
            return item
    raise HTTPException(
        status_code=404,
        detail=f"Line #{item_id} is not on {pr.p2p_number}. Reload the requisition and pick the line from its own list.")


def _clean_reason(reason: str | None, what: str) -> str:
    text = (reason or "").strip()
    if len(text) < MIN_REASON:
        raise HTTPException(
            status_code=422,
            detail=f"Give the reason for {what} (at least {MIN_REASON} characters). It is written on the requisition's history "
                   "and sent to the people concerned.")
    return text


def _ensure_open(pr: P2PRequest, what: str) -> None:
    if not po_split.is_procurement_open(pr):
        raise HTTPException(
            status_code=409,
            detail=f"{pr.p2p_number} is {STATUS_LABELS.get(pr.status, pr.status).lower()}, so you can't {what}. This works only while "
                   "the requisition is with procurement (approved, up to received). Reopen the work with a new requisition if it is needed again.")


def _live_po_qty_by_vqi(db: Session, vqi_ids: list[int]) -> dict[int, float]:
    """Quantity already on live POs, per quote line."""
    if not vqi_ids:
        return {}
    rows = (db.query(P2PPurchaseOrderItem.vendor_quotation_item_id, func.coalesce(func.sum(P2PPurchaseOrderItem.quantity), 0.0))
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrderItem.vendor_quotation_item_id.in_(vqi_ids), P2PPurchaseOrder.status != "cancelled")
            .group_by(P2PPurchaseOrderItem.vendor_quotation_item_id).all())
    return {vid: float(q or 0.0) for vid, q in rows}


def _po_numbers_for_line(db: Session, pr: P2PRequest, item: P2PRequestItem) -> list[str]:
    rows = (db.query(P2PPurchaseOrder.po_number)
            .join(P2PPurchaseOrderItem, P2PPurchaseOrderItem.purchase_order_id == P2PPurchaseOrder.id)
            .filter(P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled",
                    P2PPurchaseOrderItem.pr_item_id == item.id)
            .order_by(P2PPurchaseOrder.id).distinct().all())
    return [n for (n,) in rows]


def _can_work_line(user: User, item: P2PRequestItem, pr: P2PRequest) -> bool:
    return po_split.can_work_all_lines(user) or po_split.effective_buyer_id(item, pr) == user.id


def _bell(db: Session, user_ids, *, actor: User, title: str, message: str, notification_type: str, pr: P2PRequest) -> None:
    """Bell notice (never Teams) to each person once, except the one who acted."""
    for uid in dict.fromkeys(i for i in user_ids if i and i != actor.id):
        notify_user(db, user_id=uid, title=title, message=message, notification_type=notification_type,
                    entity_type="p2p_request", entity_id=pr.id)


# ── Reassign a line's buyer ──────────────────────────────────────────────

@router.post("/{pr_id}/lines/{item_id}/reassign-buyer", response_model=P2PRequestResponse)
def reassign_line_buyer(
    pr_id: int,
    item_id: int,
    payload: ReassignBuyerPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),  # Purchase desk only, like assigning the main buyer
):
    """The Purchase head hands the NOT-YET-ORDERED quantity of one line to another buyer. Quantity that is
    already on a PO stays with that PO's buyer. The old buyer's RFQ line is withdrawn (kept as history with the
    reason) and their awards that have no PO yet are cleared; quotes stay as history."""
    ensure_tab_action(user, "p2p", "purchase_requisitions", "edit")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "buyer", "edit")
    # Moving a line takes it from its buyer: the Purchase head's grant only (a buyer can't pull other buyers' lines
    # to themselves). This also means nobody but an admin / head can make themselves the buyer of a line.
    if not po_split.can_work_all_lines(user):
        raise HTTPException(
            status_code=403,
            detail="Moving a line from one buyer to another is for the Purchase head. You can work only your own lines; "
                   "ask the Purchase head to move it, or ask an admin to give you 'All buyers' lines' (Edit) on "
                   f"Procurement > Purchase Requisitions. {GRANT_HINT}")
    pr = _get_pr_or_404(db, pr_id, user=user)  # data scope
    _ensure_open(pr, "move a line to another buyer")
    if payload.buyer_id is None:
        raise HTTPException(status_code=422, detail="Pick the buyer who should take this line over (the 'Move to buyer' list).")
    reason = _clean_reason(payload.reason, "moving this line to another buyer")
    new_buyer = db.query(User).filter(User.id == payload.buyer_id, User.is_active == True).first()  # noqa: E712
    if new_buyer is None:
        raise HTTPException(status_code=404, detail=f"User #{payload.buyer_id} is not an active user, so they can't be made the buyer. Pick someone from the buyer list.")
    if new_buyer.id == pr.requested_by_id:
        raise HTTPException(
            status_code=422,
            detail="The requester can't be the buyer of their own requisition — pick someone from the Purchase team.")
    if "purchase" not in new_buyer.get_apps() or not can_view_tab(new_buyer, "p2p", "purchase_requisitions"):
        raise HTTPException(
            status_code=409,
            detail=f"{_who(new_buyer)} is not in the Purchase team (they need the Procurement buyer desk and 'View' on "
                   "Purchase Requisitions), so they could not open or work this line. "
                   "Pick another buyer, or ask an admin to give them Procurement access first.")
    # The role's assign-to rule (Role & Permissions > Procurement > Purchase Requisitions > Assign buyer).
    assignee_rules.ensure_allowed(db, user, BUYER_RULE_KEY, new_buyer)

    pr = po_split.lock_pr(db, pr_id)  # one at a time on this requisition; reads fresh rows
    _ensure_open(pr, "move a line to another buyer")
    item = _line_or_404(pr, item_id)
    old_id = po_split.effective_buyer_id(item, pr)
    if old_id == new_buyer.id:
        raise HTTPException(status_code=409, detail=f"{_who(new_buyer)} is already the buyer of '{item.item_name}'. Pick a different buyer.")
    prog = line_progress(db, pr)[item.id]
    if prog.open_to_order <= _EPS:
        on = _po_numbers_for_line(db, pr, item)
        where = f"already on PO {', '.join(on)}" if on else "already issued from stock, ordered or short-closed"
        raise HTTPException(
            status_code=409,
            detail=f"All {prog.buy_qty:g} {item.unit or ''} of '{item.item_name}' are {where}. There is nothing left to reassign. "
                   "Quantity on a PO stays with that PO's buyer.".replace("  ", " "))

    moved_qty = prog.open_to_order
    names = _names(db, [old_id, new_buyer.id, pr.requested_by_id])
    old_name = names.get(old_id) if old_id else "nobody"
    head = _who(user)
    now = datetime.now(timezone.utc)

    # 1. The line's new buyer.
    item.buyer_id = new_buyer.id

    # 2. The old buyer's RFQ line(s) on this requisition are withdrawn, with the reason, not deleted.
    rfq_rows = (db.query(RFQItem, RFQ).join(RFQ, RFQ.id == RFQItem.rfq_id)
                .filter(RFQItem.pr_item_id == item.id, RFQItem.withdrawn_at.is_(None), RFQ.p2p_request_id == pr.id).all())
    moved_rfqs = [(ri, rfq) for ri, rfq in rfq_rows if rfq.source != "before_po" and rfq.buyer_id != new_buyer.id]
    why = f"Moved to {names.get(new_buyer.id, new_buyer.email)} by {head}: {reason}"
    for ri, _rfq in moved_rfqs:
        ri.withdrawn_at = now
        ri.withdrawn_reason = why

    # 3. Awards on those RFQs that have no PO yet are cleared (what is on a PO stays).
    cleared: list[str] = []
    if moved_rfqs:
        vqis = (db.query(VendorQuotationItem, VendorQuotation)
                .join(VendorQuotation, VendorQuotation.id == VendorQuotationItem.vendor_quotation_id)
                .filter(VendorQuotation.rfq_id.in_([rfq.id for _, rfq in moved_rfqs]),
                        VendorQuotationItem.pr_item_id == item.id, VendorQuotationItem.awarded_qty > 0).all())
        on_po = _live_po_qty_by_vqi(db, [v.id for v, _ in vqis])
        for vqi, vq in vqis:
            keep = on_po.get(vqi.id, 0.0)
            freed = (vqi.awarded_qty or 0.0) - keep
            if freed <= _EPS:
                continue
            vqi.awarded_qty = keep
            vqi.is_awarded = keep > _EPS
            if keep <= _EPS:
                vqi.award_reason = None
            cleared.append(f"{freed:g} awarded to {vq.vendor_name}")
            _write_audit(db, pr.id, "award_cleared", user,
                         summary=f"The award of {freed:g} {item.unit or ''} of '{item.item_name}' to {vq.vendor_name} was cleared "
                                 f"because the line moved to {names.get(new_buyer.id, new_buyer.email)}. {reason}".replace("  ", " "))

    db.flush()
    _write_audit(
        db, pr.id, "line_buyer_reassigned", user,
        summary=(f"{head} moved '{item.item_name}' ({moved_qty:g} {item.unit or ''} not yet ordered) from {old_name} to "
                 f"{names.get(new_buyer.id, new_buyer.email)} on {pr.p2p_number}: {reason}"
                 + (f" Withdrawn from RFQ {', '.join(rfq.rfq_number for _, rfq in moved_rfqs)}." if moved_rfqs else "")
                 + (f" Cleared awards: {'; '.join(cleared)}." if cleared else "")).replace("  ", " "))
    po_split.rollup_pr_status(db, pr, user.id, force=True)

    # Bell only: old buyer, new buyer, requester.
    msg = (f"'{item.item_name}' on PR '{pr.p2p_number}' ({moved_qty:g} {item.unit or ''} not yet ordered) was moved from "
           f"{old_name} to {names.get(new_buyer.id, new_buyer.email)} by {head}. Reason: {reason}").replace("  ", " ")
    _bell(db, [old_id], actor=user, title="Line moved to another buyer", message=msg,
          notification_type="p2p_line_buyer_reassigned", pr=pr)
    _bell(db, [new_buyer.id], actor=user, title="A requisition line was assigned to you", message=msg,
          notification_type="p2p_line_buyer_reassigned", pr=pr)
    _bell(db, [pr.requested_by_id], actor=user, title="Buyer changed on your requisition", message=msg,
          notification_type="p2p_line_buyer_reassigned", pr=pr)
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


# ── Short-close a line's un-ordered quantity ─────────────────────────────

@router.post("/{pr_id}/lines/{item_id}/short-close", response_model=P2PRequestResponse)
def short_close_line(
    pr_id: int,
    item_id: int,
    payload: ShortClosePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),  # Purchase desk only, like the other line actions
):
    """Writes off quantity of ONE line that has not been ordered (the buyer decided not to buy it). The line's
    buy quantity drops, awards above the new quantity are trimmed, and the requisition closes by itself when
    nothing is left to buy and nothing was bought."""
    ensure_tab_action(user, "p2p", "purchase_requisitions", "view")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "close", "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)  # data scope
    _ensure_open(pr, "short-close a line")
    reason = _clean_reason(payload.reason, "short-closing this line")
    if payload.quantity is not None and payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Enter a quantity greater than 0 to short-close, or leave it empty to write off everything not yet ordered.")

    pr = po_split.lock_pr(db, pr_id)
    _ensure_open(pr, "short-close a line")
    item = _line_or_404(pr, item_id)
    if not _can_work_line(user, item, pr):
        buyer_id = po_split.effective_buyer_id(item, pr)
        buyer = _names(db, [buyer_id]).get(buyer_id, "another buyer") if buyer_id else "nobody yet"
        raise HTTPException(
            status_code=403,
            detail=f"'{item.item_name}' is assigned to {buyer}. Ask the Purchase head to reassign it, or ask {buyer} to short-close it.")
    prog = line_progress(db, pr)[item.id]
    open_qty = prog.open_to_order
    if open_qty <= _EPS:
        on = _po_numbers_for_line(db, pr, item)
        where = f"on PO {', '.join(on)}" if on else "issued from stock or already short-closed"
        raise HTTPException(
            status_code=409,
            detail=f"Nothing to short-close on '{item.item_name}': all of its {prog.buy_qty:g} {item.unit or ''} is {where}. "
                   "To stop the balance of an ordered line, close the requisition instead.".replace("  ", " "))
    qty = open_qty if payload.quantity is None else round(payload.quantity, 6)
    if qty - open_qty > _EPS:
        raise HTTPException(
            status_code=422,
            detail=f"Only {open_qty:g} {item.unit or ''} of '{item.item_name}' is not yet ordered, so you can't short-close {qty:g}. "
                   f"Enter {open_qty:g} or less.".replace("  ", " "))

    now = datetime.now(timezone.utc)
    new_buy = round(prog.buy_qty - qty, 6)
    item.short_closed_qty = round((item.short_closed_qty or 0.0) + qty, 6)
    item.short_closed_reason = f"{item.short_closed_reason}; {reason}" if item.short_closed_reason else reason
    item.short_closed_by_id = user.id
    item.short_closed_at = now

    # Awards above what is still to buy are trimmed (never below what is already on a PO).
    trimmed: list[str] = []
    vqis = (db.query(VendorQuotationItem, VendorQuotation)
            .join(VendorQuotation, VendorQuotation.id == VendorQuotationItem.vendor_quotation_id)
            .filter(VendorQuotation.p2p_request_id == pr.id, VendorQuotationItem.pr_item_id == item.id,
                    VendorQuotationItem.awarded_qty > 0)
            .order_by(VendorQuotationItem.id.desc()).all())
    excess = round(sum(v.awarded_qty or 0.0 for v, _ in vqis) - new_buy, 6)
    if excess > _EPS:
        on_po = _live_po_qty_by_vqi(db, [v.id for v, _ in vqis])
        for vqi, vq in vqis:
            if excess <= _EPS:
                break
            cut = min(excess, (vqi.awarded_qty or 0.0) - on_po.get(vqi.id, 0.0))
            if cut <= _EPS:
                continue
            vqi.awarded_qty = round((vqi.awarded_qty or 0.0) - cut, 6)
            vqi.is_awarded = vqi.awarded_qty > _EPS
            if not vqi.is_awarded:
                vqi.award_reason = None
            excess = round(excess - cut, 6)
            trimmed.append(f"{cut:g} less awarded to {vq.vendor_name}")
            _write_audit(db, pr.id, "award_trimmed", user,
                         summary=f"The award of '{item.item_name}' to {vq.vendor_name} was reduced by {cut:g} because {qty:g} "
                                 f"{item.unit or ''} was short-closed. {reason}".replace("  ", " "))

    db.flush()
    _write_audit(
        db, pr.id, "line_short_closed", user,
        summary=(f"{_who(user)} short-closed {qty:g} {item.unit or ''} of '{item.item_name}' on {pr.p2p_number} (not ordered; "
                 f"{new_buy:g} left to buy): {reason}" + (f" Awards adjusted: {'; '.join(trimmed)}." if trimmed else "")).replace("  ", " "))
    old_status = pr.status
    po_split.rollup_pr_status(db, pr, user.id, force=True)
    auto_closed = pr.status == "closed" and old_status != "closed"

    msg = (f"{qty:g} {item.unit or ''} of '{item.item_name}' on your PR '{pr.p2p_number}' will not be purchased "
           f"(short-closed by {_who(user)}). Reason: {reason}" + (" The requisition is now closed - nothing is left to buy." if auto_closed else "")).replace("  ", " ")
    _bell(db, [pr.requested_by_id], actor=user, title="Part of your requisition will not be bought", message=msg,
          notification_type="p2p_line_short_closed", pr=pr)
    line_buyer = po_split.effective_buyer_id(item, pr)
    if line_buyer != user.id:  # the head acted on someone else's line: tell the buyer
        _bell(db, [line_buyer], actor=user, title="Your line was short-closed",
              message=f"{_who(user)} short-closed '{item.item_name}' on PR '{pr.p2p_number}'. Reason: {reason}",
              notification_type="p2p_line_short_closed", pr=pr)
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


# ── Tracker ──────────────────────────────────────────────────────────────

def _approval_from_request(req: ApprovalRequest, names: dict[int, str], *, show_comments: bool = True) -> TrackerApproval:
    steps = [
        TrackerApprovalStep(
            sequence=s.sequence, stage_name=s.stage_name, approver_name=names.get(s.approver_id), status=s.status,
            decided_by_name=names.get(s.decided_by_id), decided_at=s.decided_at,
            comment=s.comment if show_comments else None, via=s.via)
        for s in req.steps
    ]
    return TrackerApproval(status=req.status, submitted_at=req.submitted_at, completed_at=req.completed_at, steps=steps)


# Legacy department / project / plant head slots of requisitions raised before the approval engine.
_LEGACY_HEADS = (
    ("approver_id", "approver_name", "department_head_approved_at", "department_head_comment", "Department Head"),
    ("project_head_id", "project_head_name", "project_head_approved_at", "project_head_comment", "Project Head"),
    ("plant_head_id", "plant_head_name", "plant_head_approved_at", "plant_head_comment", "Plant Head"),
)


def _legacy_pr_approval(pr: P2PRequest) -> TrackerApproval | None:
    steps: list[TrackerApprovalStep] = []
    if pr.approvals:
        for n, a in enumerate(sorted(pr.approvals, key=lambda a: a.id), start=1):
            steps.append(TrackerApprovalStep(
                sequence=n, stage_name=P2P_ROLE_LABELS.get(a.role, a.role), approver_name=a.approver_name,
                status="approved" if a.approved_at else "pending", decided_by_name=a.approver_name if a.approved_at else None,
                decided_at=a.approved_at, comment=a.comment))
    else:
        for n, (id_f, name_f, at_f, comment_f, label) in enumerate(_LEGACY_HEADS, start=1):
            if not getattr(pr, id_f, None):
                continue
            at = getattr(pr, at_f, None)
            steps.append(TrackerApprovalStep(
                sequence=len(steps) + 1, stage_name=label, approver_name=getattr(pr, name_f, None),
                status="approved" if at else "pending", decided_by_name=getattr(pr, name_f, None) if at else None,
                decided_at=at, comment=getattr(pr, comment_f, None)))
    if not steps:
        return None
    done = all(s.status == "approved" for s in steps)
    status = "approved" if done else ("rejected" if pr.status == "rejected" else "pending")
    return TrackerApproval(status=status, submitted_at=pr.created_at, completed_at=pr.approved_at if done else None, steps=steps)


def _po_requests(db: Session, po_ids: list[int]) -> dict[int, ApprovalRequest]:
    """Latest approval request of each PO, steps loaded, in one query."""
    if not po_ids:
        return {}
    rows = (db.query(ApprovalRequest).options(selectinload(ApprovalRequest.steps))
            .filter(ApprovalRequest.entity_type == p2p_approvals.PO_ENTITY, ApprovalRequest.entity_id.in_(po_ids))
            .order_by(ApprovalRequest.id).all())
    return {r.entity_id: r for r in rows}  # ascending id: the latest wins


def _pct(done: float, total: float, empty: float) -> float:
    return round(100.0 * done / total, 1) if total > _EPS else empty


@router.get("/{pr_id}/tracker", response_model=PrTrackerResponse)
def get_tracker(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """What is happening to this requisition, for the person who raised it and the people who work it: the PR's
    approval trail, then per line the buyer, RFQ, PO(s) with their approval (who, when), GRNs and the ordered /
    accepted / pending quantities. No prices or values; the vendor name only for people who may see PO commercials."""
    pr = _get_pr_or_404(db, pr_id, user=user)  # data scope
    _check_view_access(pr, user)  # a draft stays private; the rest is for people on the requisition
    can_see_commercials = _can_see_po_commercials(pr, user) and _sees_pr_feature(user, "purchase_order", "view")

    pr_req = p2p_approvals.pr_request(db, pr.id)
    if pr.status == "draft":
        return PrTrackerResponse(
            p2p_request_id=pr.id, p2p_number=pr.p2p_number, status=pr.status, status_label=STATUS_LABELS["draft"],
            progress=TrackerProgress(lines=0, lines_done=0, ordered_pct=0.0, received_pct=0.0), pr_approval=None, lines=[])

    items = sorted(pr.items, key=lambda i: i.id)
    line_ids = [i.id for i in items]
    progress = line_progress(db, pr)

    # ── Batched reads (a fixed number of queries, whatever the number of lines) ──
    pos = (db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items))
           .filter(P2PPurchaseOrder.p2p_request_id == pr.id).order_by(P2PPurchaseOrder.id).all())
    infos = load_infos(db, pos) if pos else {}
    po_reqs = _po_requests(db, [po.id for po in pos])
    grns_by_po: dict[int, list[P2PGoodsReceipt]] = defaultdict(list)
    if pos:
        for g in (db.query(P2PGoodsReceipt).options(selectinload(P2PGoodsReceipt.items))
                  .filter(P2PGoodsReceipt.purchase_order_id.in_([po.id for po in pos]))
                  .order_by(P2PGoodsReceipt.id).all()):
            grns_by_po[g.purchase_order_id].append(g)
    rfq_rows = (db.query(RFQItem.pr_item_id, RFQ)
                .join(RFQ, RFQ.id == RFQItem.rfq_id)
                .filter(RFQItem.pr_item_id.in_(line_ids), RFQItem.withdrawn_at.is_(None), RFQ.p2p_request_id == pr.id)
                .order_by(RFQ.id).all())
    rfq_rows = [(lid, rfq) for lid, rfq in rfq_rows if rfq.source != "before_po"]
    quote_counts: dict[tuple[int, int], int] = {}
    if rfq_rows:
        for rfq_id, lid, n in (db.query(VendorQuotation.rfq_id, VendorQuotationItem.pr_item_id,
                                        func.count(func.distinct(VendorQuotation.id)))
                               .join(VendorQuotationItem, VendorQuotationItem.vendor_quotation_id == VendorQuotation.id)
                               .filter(VendorQuotation.rfq_id.in_({rfq.id for _, rfq in rfq_rows}),
                                       VendorQuotationItem.pr_item_id.in_(line_ids))
                               .group_by(VendorQuotation.rfq_id, VendorQuotationItem.pr_item_id).all()):
            quote_counts[(rfq_id, lid)] = n

    legacy = _legacy_line_map(pr)
    po_lines_by_line: dict[int, list[tuple[P2PPurchaseOrder, list[P2PPurchaseOrderItem]]]] = defaultdict(list)
    for po in pos:
        per_line: dict[int, list[P2PPurchaseOrderItem]] = defaultdict(list)
        for it in po.items:
            lid = it.pr_item_id or legacy.get(it.store_item_id or 0)
            if lid:
                per_line[lid].append(it)
        for lid, its in per_line.items():
            po_lines_by_line[lid].append((po, its))

    buyer_ids = {po_split.effective_buyer_id(i, pr) for i in items} | {rfq.buyer_id or rfq.created_by_id for _, rfq in rfq_rows}
    step_users = set()
    for r in [pr_req, *po_reqs.values()]:
        if r is not None:
            for s in r.steps:
                step_users.update((s.approver_id, s.decided_by_id))
    names = _names(db, buyer_ids | step_users | {i.short_closed_by_id for i in items})

    pr_approval = _approval_from_request(pr_req, names) if pr_req is not None else _legacy_pr_approval(pr)

    # Who may see a PO's vendor name (and the approvers' comments on that PO, which often name the vendor or its price):
    # needs PO commercials on this requisition AND one of -
    #   * admin, or the Purchase head grant (All buyers' lines);
    #   * the PO's own buyer (the buyer of the RFQ it was uploaded from, else whoever uploaded it);
    #   * an approver (or the person who decided) on that PO's approval;
    #   * management - a viewer outside the Purchase team who already passes the commercials check.
    # Any other buyer on the same requisition sees the PO number and stage only; a requester never sees either.
    see_all = po_split.can_work_all_lines(user)
    purchase_team = "purchase" in user.get_apps()
    rfq_buyer = {rid: (b or c) for rid, b, c in db.query(RFQ.id, RFQ.buyer_id, RFQ.created_by_id)
                 .filter(RFQ.id.in_({po.rfq_id for po in pos if po.rfq_id})).all()} if pos else {}

    def sees_po(po: P2PPurchaseOrder) -> bool:
        if not can_see_commercials:
            return False
        if see_all or not purchase_team:
            return True
        if user.id == (rfq_buyer.get(po.rfq_id) if po.rfq_id else None) or user.id == po.created_by_id:
            return True
        req = po_reqs.get(po.id)
        return req is not None and any(user.id in (st.approver_id, st.decided_by_id) for st in req.steps)

    def po_approval(po: P2PPurchaseOrder) -> TrackerApproval | None:
        req = po_reqs.get(po.id)
        show = sees_po(po)
        if req is not None:
            return _approval_from_request(req, names, show_comments=show)
        if pr.po_approved_at and po.status != "draft":  # approved before the approval engine existed
            label = P2P_ROLE_LABELS.get(pr.po_approved_role, pr.po_approved_role) if pr.po_approved_role else "PO approval"
            return TrackerApproval(status="approved", submitted_at=None, completed_at=pr.po_approved_at, steps=[
                TrackerApprovalStep(sequence=1, stage_name=label or "PO approval", approver_name=pr.po_approved_by_name,
                                    status="approved", decided_by_name=pr.po_approved_by_name, decided_at=pr.po_approved_at,
                                    comment=pr.po_approval_comment if show else None)])
        return None

    lines: list[TrackerLine] = []
    ordered_cap = received_cap = buy_total = 0.0
    for it in items:
        lp: LineProgress = progress[it.id]
        rfqs = [TrackerRfq(rfq_id=rfq.id, rfq_number=rfq.rfq_number, status=rfq.status,
                           buyer_name=names.get(rfq.buyer_id or rfq.created_by_id), quote_count=quote_counts.get((rfq.id, lid), 0))
                for lid, rfq in rfq_rows if lid == it.id]
        po_out: list[TrackerPo] = []
        for po, po_items in po_lines_by_line.get(it.id, []):
            info = infos.get(po.id)
            stage = info.stage if info is not None else "draft"
            ids = {x.id for x in po_items}
            grns: list[TrackerGrn] = []
            for g in grns_by_po.get(po.id, []):
                mine = [gi for gi in g.items if gi.po_item_id in ids]
                if not mine:
                    continue
                reversed_ = g.status == "reversed"
                accepted = 0.0 if reversed_ else sum(max((gi.accepted_quantity or 0) - (gi.returned_quantity or 0), 0.0)
                                                    for gi in mine if gi.quality_status in ("passed", "failed", "partial"))
                grns.append(TrackerGrn(
                    grn_id=g.id, grn_number=g.grn_number, received_date=g.received_date, status=g.status,
                    received_qty=0.0 if reversed_ else sum(gi.received_quantity or 0.0 for gi in mine),
                    accepted_qty=accepted, rejected_qty=0.0 if reversed_ else sum(gi.rejected_quantity or 0.0 for gi in mine)))
            po_out.append(TrackerPo(
                po_id=po.id, po_number=po.po_number, vendor_name=po.vendor_name if sees_po(po) else None,
                quantity=sum(x.quantity or 0.0 for x in po_items), stage=stage, stage_label=STAGES.get(stage, stage),
                expected_delivery=po.expected_delivery, approval=po_approval(po), grns=grns))
        buyer_id = po_split.effective_buyer_id(it, pr)
        lines.append(TrackerLine(
            pr_item_id=it.id, item_code=it.item_code, item_name=it.item_name, unit=it.unit, quantity=it.quantity or 0.0,
            issued_qty=it.issued_qty or 0.0, short_closed_qty=lp.short_closed_qty, short_closed_reason=it.short_closed_reason,
            buyer_id=buyer_id, buyer_name=names.get(buyer_id), fulfillment_status=it.fulfillment_status or "pending",
            ordered_qty=lp.ordered_qty, accepted_qty=lp.accepted_qty, rejected_qty=lp.rejected_qty, pending_qty=lp.pending_receipt,
            state=lp.state, state_label=lp.state_label, over_ordered=lp.over_ordered, po_rejected=lp.po_rejected,
            rfqs=rfqs, pos=po_out))
        buy_total += lp.buy_qty
        ordered_cap += min(lp.ordered_qty, lp.buy_qty)
        received_cap += min(max(lp.ordered_qty - lp.pending_receipt, 0.0), lp.buy_qty)

    empty = 100.0 if lines else 0.0  # nothing to buy (every line from stock) counts as done
    return PrTrackerResponse(
        p2p_request_id=pr.id, p2p_number=pr.p2p_number, status=pr.status,
        status_label=STATUS_LABELS.get(pr.status, pr.status.replace("_", " ").capitalize()),
        progress=TrackerProgress(
            lines=len(lines), lines_done=sum(1 for ln in lines if ln.state in _DONE_STATES),
            ordered_pct=_pct(ordered_cap, buy_total, empty), received_pct=_pct(received_cap, buy_total, empty)),
        pr_approval=pr_approval, lines=lines)
