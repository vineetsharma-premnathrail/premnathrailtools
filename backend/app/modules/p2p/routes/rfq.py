from datetime import date, datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session, selectinload

from app.core import assignee_rules
from app.core.config import settings
from app.core.permissions import ensure_can_delete, ensure_feature_action, ensure_tab_action, require_app_access
from app.modules.p2p.pricing import mask_for
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.rfq import RFQ, RFQ_VENDOR_TIERS
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.rfq_item import RFQItem
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.item_link import item_category_for
from app.modules.p2p import po_split
from app.modules.p2p.line_progress import LineProgress, line_progress
from app.modules.p2p.schemas.rfq import (
    RFQCreate, RFQLinesUpdate, RFQUpdate, RFQResponse, RFQItemResponse, RFQAttachmentResponse, RFQAttachmentVendorUpdate,
    VendorQuotationResponse,
)
from app.modules.p2p.schemas.purchase_order import (
    P2PPurchaseOrderCreate, P2PPurchaseOrderDiscardPayload, P2PPurchaseOrderDraftUpdatePayload, P2PPurchaseOrderResponse,
    P2PUploadPOPayload,
)
from app.modules.store.models.location import StoreLocation
from pydantic import ValidationError
from app.modules.p2p.service import generate_rfq_number, generate_po_number, compute_line_total
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p.access import ensure_pr_in_scope, is_pr_approver_party
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.p2p.settings import get_setting as get_p2p_setting
from app.modules.accounts.models.vendor import Vendor
from app.core.notify_rules import fire_rule
from app.modules.p2p.routes.p2p_requests import (
    BUYER_RULE_KEY, _write_audit as _write_pr_audit, _send_p2p_po_approval_emails_background,
)
from app.utils.notifications import notify_user
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content, delete_file_from_sharepoint

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P"])

MAX_TALLY_PDF_BYTES = 15 * 1024 * 1024
_EPS = 1e-6


def _purchase_tab(tab: str, action: str):
    """Purchase-team gate (the `purchase` desk) plus the Permission Matrix
    action on Procurement › `tab` — RFQ work is the R.F.Q tab, the PO draft
    built from it is the Purchase Orders tab."""
    purchase_dep = require_app_access("purchase")

    def _dependency(user: User = Depends(purchase_dep)) -> User:
        ensure_tab_action(user, "p2p", tab, action)
        return user

    return _dependency


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _write_audit(db: Session, rfq_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="rfq", entity_id=rfq_id, action=action, performed_by_id=user.id, summary=summary))


def _get_rfq_or_404(db: Session, rfq_id: int, user: User | None = None) -> RFQ:
    """The RFQ (404 if missing); with `user`, also 403 when it is outside
    their Procurement data scope (p2p/access.py)."""
    rfq = db.query(RFQ).options(
        selectinload(RFQ.attachments), selectinload(RFQ.vendor_quotations), selectinload(RFQ.items),
    ).filter(RFQ.id == rfq_id).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if user is not None:
        ensure_in_scope(db, user, rfq)
    return rfq


def _get_pr_for_rfq(db: Session, rfq: RFQ) -> P2PRequest:
    pr = db.query(P2PRequest).filter(P2PRequest.id == rfq.p2p_request_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Linked P2P request not found")
    return pr


def _get_vendor_quotation_or_404(db: Session, rfq_id: int, vq_id: int) -> VendorQuotation:
    vq = db.query(VendorQuotation).filter(VendorQuotation.id == vq_id, VendorQuotation.rfq_id == rfq_id).first()
    if not vq:
        raise HTTPException(status_code=404, detail="Vendor quotation not found")
    return vq


def _user_label(db: Session, user_id: int | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    return (u.name or u.email) if u else None


def ensure_rfq_owner(db: Session, rfq: RFQ, user: User, action: str = "work on") -> None:
    """Record rule on top of the Procurement permission: an RFQ is worked by its own buyer
    (or by whoever may work all buyers' lines: the Purchase head, an admin). An RFQ with no
    buyer on record falls back to the user who started it."""
    if po_split.can_work_all_lines(user):
        return
    owner_id = rfq.buyer_id or rfq.created_by_id
    if owner_id is None or owner_id == user.id:
        return
    who = _user_label(db, owner_id) or f"user #{owner_id}"
    raise HTTPException(status_code=403, detail=(
        f"This RFQ belongs to {who}. Only {who} or the Purchase head can {action} it - ask {who}, "
        "or ask the Purchase head to move the lines to you."))


def ensure_rfq_readable(db: Session, rfq: RFQ, user: User, pr: P2PRequest | None = None) -> None:
    """Who may open an RFQ's detail (its quotes, comparison, invites, files, PO documents) on top of the
    data scope: its own buyer, whoever may work all buyers' lines (Purchase head, admin), and the
    approvers of the requisition / its POs (they sign off on what was bought). Another purchase user
    - even one whose data scope is wide - is told whose RFQ it is."""
    if po_split.can_work_all_lines(user):
        return
    owner_id = rfq.buyer_id or rfq.created_by_id
    if owner_id is None or owner_id == user.id:
        return
    if is_pr_approver_party(db, user, pr if pr is not None else db.get(P2PRequest, rfq.p2p_request_id)):
        return
    who = _user_label(db, owner_id) or f"user #{owner_id}"
    raise HTTPException(status_code=403, detail=(
        f"This RFQ belongs to {who} — only {who} or the Purchase head can open its quotes. "
        f"Ask {who} to share the comparison, or ask the Purchase head."))


def _assert_editable(rfq: RFQ, user: User) -> None:
    session = object_session(rfq)
    if session is not None:
        ensure_rfq_owner(session, rfq, user, "change")
    if rfq.status != "draft" and not _is_admin(user):
        raise HTTPException(status_code=409, detail="This RFQ has been submitted and is locked. Only an admin can edit it.")


def active_items(rfq: RFQ) -> list[RFQItem]:
    """The lines an RFQ currently asks quotes for (not withdrawn)."""
    return [i for i in rfq.items if i.withdrawn_at is None]


def _reload_rfq(db: Session, rfq_id: int) -> RFQ:
    """The RFQ re-read from the database (after taking the requisition lock) with its lines and quotes."""
    return (db.query(RFQ).options(selectinload(RFQ.attachments), selectinload(RFQ.items),
                                  selectinload(RFQ.vendor_quotations).selectinload(VendorQuotation.items))
            .filter(RFQ.id == rfq_id).populate_existing().one())


def _live_po_qty_by_quote_line(db: Session, quote_item_ids: list[int]) -> dict[int, float]:
    """vendor_quotation_item_id -> quantity on live (not cancelled) POs."""
    out: dict[int, float] = {}
    if not quote_item_ids:
        return out
    rows = (db.query(P2PPurchaseOrderItem.vendor_quotation_item_id, func.coalesce(func.sum(P2PPurchaseOrderItem.quantity), 0))
            .join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrderItem.vendor_quotation_item_id.in_(quote_item_ids), P2PPurchaseOrder.status != "cancelled")
            .group_by(P2PPurchaseOrderItem.vendor_quotation_item_id).all())
    for qid, qty in rows:
        out[qid] = float(qty or 0)
    return out


def rollup(db: Session, pr: P2PRequest, user: User | None) -> str:
    """The one writer of an approved requisition's header status (po_split.rollup_pr_status, forced)."""
    return po_split.rollup_pr_status(db, pr, user.id if user is not None else None, force=True)


def _to_vq_response(db: Session, vq: VendorQuotation) -> VendorQuotationResponse:
    resp = VendorQuotationResponse.model_validate(vq)
    user_ids = {vq.created_by_id, vq.technical_evaluated_by_id, vq.commercial_evaluated_by_id} - {None}
    if user_ids:
        users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if vq.created_by_id and vq.created_by_id in users:
            resp.created_by_name = users[vq.created_by_id].name or users[vq.created_by_id].email
        if vq.technical_evaluated_by_id and vq.technical_evaluated_by_id in users:
            resp.technical_evaluated_by_name = users[vq.technical_evaluated_by_id].name or users[vq.technical_evaluated_by_id].email
        if vq.commercial_evaluated_by_id and vq.commercial_evaluated_by_id in users:
            resp.commercial_evaluated_by_name = users[vq.commercial_evaluated_by_id].name or users[vq.commercial_evaluated_by_id].email
    return resp


def _to_response(db: Session, rfq: RFQ, progress_cache: dict[int, dict[int, LineProgress]] | None = None) -> RFQResponse:
    resp = RFQResponse.model_validate(rfq)
    resp.vendor_quotations = [_to_vq_response(db, vq) for vq in rfq.vendor_quotations]
    pr = db.query(P2PRequest).filter(P2PRequest.id == rfq.p2p_request_id).first()
    if pr:
        resp.p2p_number = pr.p2p_number
        resp.p2p_status = pr.status
        resp.p2p_created_at = pr.created_at
        resp.p2p_required_date = pr.required_date
        resp.items = _item_responses(db, rfq, pr, progress_cache)
    if rfq.created_by_id:
        creator = db.query(User).filter(User.id == rfq.created_by_id).first()
        if creator:
            resp.created_by_name = creator.name or creator.email
    resp.buyer_name = _user_label(db, rfq.buyer_id)
    from app.modules.p2p.models.rfq_invite import RFQVendorInvite
    resp.invite_count = db.query(RFQVendorInvite).filter(RFQVendorInvite.rfq_id == rfq.id).count()
    resp.awarded_line_count = sum(1 for vq in rfq.vendor_quotations for i in vq.items if i.is_awarded)
    resp.awarded_vendors = [vq.vendor_name for vq in rfq.vendor_quotations if any(i.is_awarded for i in vq.items)]
    resp.other_quoted_vendors = [vq.vendor_name for vq in rfq.vendor_quotations if vq.vendor_name not in resp.awarded_vendors]
    return resp


def _item_responses(db: Session, rfq: RFQ, pr: P2PRequest, progress_cache: dict | None) -> list[RFQItemResponse]:
    if not rfq.items:
        return []
    if progress_cache is not None and pr.id in progress_cache:
        progress = progress_cache[pr.id]
    else:
        progress = line_progress(db, pr)
        if progress_cache is not None:
            progress_cache[pr.id] = progress
    lines = {i.id: i for i in pr.items}
    out = []
    for it in sorted(rfq.items, key=lambda x: x.id or 0):
        line = lines.get(it.pr_item_id)
        lp = progress.get(it.pr_item_id)
        out.append(RFQItemResponse(
            id=it.id, pr_item_id=it.pr_item_id, store_item_id=it.store_item_id or (line.store_item_id if line else None),
            item_code=line.item_code if line else None, item_name=line.item_name if line else None,
            unit=line.unit if line else None, quantity=it.quantity or 0,
            open_qty=lp.open_to_order if lp is not None else None,
            withdrawn_at=it.withdrawn_at, withdrawn_reason=it.withdrawn_reason))
    return out


# ---------------------------------------------------------------------------
# Which requisition lines can go on a buyer's RFQ
# ---------------------------------------------------------------------------

def _on_other_rfqs(db: Session, pr_id: int, exclude_rfq_id: int | None) -> dict[int, RFQ]:
    """pr_item_id -> the other (not cancelled) RFQ of this requisition that has it as an active line."""
    q = (db.query(RFQItem.pr_item_id, RFQ).join(RFQ, RFQ.id == RFQItem.rfq_id)
         .filter(RFQ.p2p_request_id == pr_id, RFQItem.withdrawn_at.is_(None), RFQ.status != "cancelled"))
    if exclude_rfq_id is not None:
        q = q.filter(RFQ.id != exclude_rfq_id)
    return {pid: r for pid, r in q.order_by(RFQ.id).all()}


def _classify_line(db: Session, item: P2PRequestItem, pr: P2PRequest, buyer: User, user: User,
                   progress: dict[int, LineProgress], on_other: dict[int, RFQ]) -> tuple[str, str]:
    """(code, message): ok | claim (no buyer yet, the head may take it) | wait (stock check pending) |
    gone (nothing left to buy) | busy (on another RFQ) | nobuyer | other (another buyer's line)."""
    name = item.item_name
    if item.fulfillment_status == "pending":
        return "wait", (f"'{name}' is still waiting for the stock check - issue it from store stock or send it to procurement "
                        "in the requisition first, then add it to an RFQ.")
    if item.fulfillment_status == "stock_issued":
        return "gone", f"'{name}' was issued from store stock, so there is nothing to buy or quote for it."
    lp = progress.get(item.id)
    if lp is None or lp.open_to_order <= _EPS:
        return "gone", f"'{name}' has nothing left to order on {pr.p2p_number} - it is already on POs or short-closed."
    other = on_other.get(item.id)
    if other is not None:
        who = _user_label(db, other.buyer_id) or "another buyer"
        return "busy", (f"'{name}' is already on RFQ {other.rfq_number} ({who}). Quote it there, or ask {who} to take it "
                        "off that RFQ first.")
    owner = po_split.effective_buyer_id(item, pr)
    if owner is None:
        if po_split.can_work_all_lines(user):
            return "claim", ""
        return "nobuyer", f"'{name}' has no buyer. Ask the Purchase head to assign one."
    if owner != buyer.id:
        who = _user_label(db, owner) or f"user #{owner}"
        return "other", (f"'{name}' is assigned to {who}. Ask the Purchase head to reassign it, "
                         f"or ask {who} to raise the RFQ.")
    return "ok", ""


def _choose_lines(db: Session, pr: P2PRequest, buyer: User, user: User, pr_item_ids: list[int] | None,
                  exclude_rfq_id: int | None) -> tuple[list[P2PRequestItem], list[P2PRequestItem], dict[int, LineProgress]]:
    """(lines for the RFQ, lines among them to claim for the buyer, progress). With no explicit list:
    the buyer's ready lines (lines waiting for the stock check never block the others); when the buyer
    has none and the user may work all lines, the lines nobody buys yet."""
    progress = line_progress(db, pr)
    on_other = _on_other_rfqs(db, pr.id, exclude_rfq_id)
    verdict = {i.id: _classify_line(db, i, pr, buyer, user, progress, on_other) for i in pr.items}
    by_id = {i.id: i for i in pr.items}
    if pr_item_ids is not None:
        chosen: list[P2PRequestItem] = []
        seen: set[int] = set()
        for pid in pr_item_ids:
            if pid in seen:
                continue
            seen.add(pid)
            line = by_id.get(pid)
            if line is None:
                raise HTTPException(status_code=422, detail=f"Requisition line #{pid} is not on {pr.p2p_number} - reload the page and pick the lines again.")
            code, msg = verdict[pid]
            if code == "other":
                raise HTTPException(status_code=403, detail=msg)
            if code not in ("ok", "claim"):
                raise HTTPException(status_code=409, detail=msg)
            chosen.append(line)
        return chosen, [l for l in chosen if verdict[l.id][0] == "claim"], progress
    ok = [i for i in pr.items if verdict[i.id][0] == "ok"]
    claim = [i for i in pr.items if verdict[i.id][0] == "claim"]
    chosen = ok or claim
    if not chosen:
        who = buyer.name or buyer.email
        parts = []
        for code, label in (("wait", "waiting for the stock check"), ("busy", "already on another RFQ"),
                            ("nobuyer", "without a buyer"), ("other", "bought by other buyers")):
            names = [f"'{i.item_name}'" for i in pr.items if verdict[i.id][0] == code]
            if names:
                parts.append(f"{', '.join(names)} {label}")
        fixes = {"wait": "Decide the stock check on the waiting lines (issue from stock or send to procurement).",
                 "busy": "Quote those lines on the RFQ they are already on.",
                 "nobuyer": "Ask the Purchase head to assign a buyer to the lines without one.",
                 "other": "Ask the Purchase head to reassign them to you, or ask their buyer to raise the RFQ."}
        hints = [fixes[c] for c in ("wait", "busy", "nobuyer", "other") if any(verdict[i.id][0] == c for i in pr.items)]
        fix = (" ".join(hints) if parts else
               f"Every line of {pr.p2p_number} is issued from stock, already ordered or short-closed, so no RFQ is needed.")
        raise HTTPException(status_code=409, detail=(
            f"No line of {pr.p2p_number} is ready for an RFQ by {who}" + (f": {'; '.join(parts)}. " if parts else ". ") + fix))
    return chosen, claim if not ok else [], progress


def _sync_items(rfq: RFQ, chosen: list[P2PRequestItem], progress: dict[int, LineProgress]) -> None:
    """Make the draft RFQ's line set exactly `chosen` (a draft's lines have no history to keep)."""
    wanted = {l.id for l in chosen}
    for row in list(rfq.items):
        if row.pr_item_id not in wanted:
            rfq.items.remove(row)
    have = {r.pr_item_id: r for r in rfq.items}
    for line in chosen:
        qty = progress[line.id].open_to_order
        row = have.get(line.id)
        if row is None:
            rfq.items.append(RFQItem(pr_item_id=line.id, store_item_id=line.store_item_id, quantity=qty))
        else:
            row.quantity = qty
            row.withdrawn_at, row.withdrawn_reason = None, None


def _claim_lines(db: Session, pr: P2PRequest, lines: list[P2PRequestItem], buyer: User, user: User) -> None:
    for line in lines:
        line.buyer_id = buyer.id
        _write_pr_audit(db, pr.id, "line_buyer_claimed", user,
                        summary=f"{user.name or user.email} took '{line.item_name}' (no buyer yet) for {buyer.name or buyer.email} while raising an RFQ.")


def _resolve_buyer(db: Session, user: User, buyer_id: int | None) -> User:
    if buyer_id is None or buyer_id == user.id:
        return user
    if not po_split.can_work_all_lines(user):
        raise HTTPException(status_code=403, detail=(
            "Only the Purchase head can raise an RFQ for another buyer. Raise it for your own lines, "
            "or ask the Purchase head to do it."))
    buyer = db.get(User, buyer_id)
    if buyer is None or not buyer.is_active:
        raise HTTPException(status_code=422, detail=f"Buyer #{buyer_id} doesn't exist or is inactive - pick another buyer.")
    assignee_rules.ensure_allowed(db, user, BUYER_RULE_KEY, buyer)
    return buyer


@router.post("", response_model=RFQResponse)
def create_rfq(
    payload: RFQCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "create")),
):
    """One RFQ = one requisition + one buyer + that buyer's lines. Another buyer of the same
    requisition raises their own RFQ for their own lines. The buyer's still-open draft RFQ on the
    requisition is reused (its lines replaced), so a retried call never leaves a second draft."""
    pr = db.query(P2PRequest).filter(P2PRequest.id == payload.p2p_request_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="P2P request not found")
    ensure_pr_in_scope(db, user, pr)
    if payload.pr_item_ids is not None and not payload.pr_item_ids:
        raise HTTPException(status_code=422, detail="Pick at least one requisition line for the RFQ - or leave the lines out to take all your ready lines.")
    pr = po_split.lock_pr(db, pr.id)
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=(
            f"An RFQ can only be raised on an approved requisition that is still being bought - {pr.p2p_number} is "
            f"{pr.status.replace('_', ' ')}."))
    buyer = _resolve_buyer(db, user, payload.buyer_id)
    existing_draft = db.query(RFQ).filter(
        RFQ.p2p_request_id == pr.id, RFQ.status == "draft", RFQ.buyer_id == buyer.id).order_by(RFQ.created_at.desc(), RFQ.id.desc()).first()
    chosen, to_claim, progress = _choose_lines(db, pr, buyer, user, payload.pr_item_ids, existing_draft.id if existing_draft else None)
    _claim_lines(db, pr, to_claim, buyer, user)
    behalf = buyer.id != user.id

    if existing_draft is not None:
        _sync_items(existing_draft, chosen, progress)
        db.commit()
        db.refresh(existing_draft)
        return _to_response(db, existing_draft)

    rfq = RFQ(
        rfq_number=generate_rfq_number(db),
        p2p_request_id=pr.id,
        status="draft",
        created_by_id=user.id,
        buyer_id=buyer.id,
        requires_technical_evaluation=payload.requires_technical_evaluation,
    )
    db.add(rfq)
    db.flush()
    _sync_items(rfq, chosen, progress)
    names = ", ".join(l.item_name for l in chosen)
    _write_audit(db, rfq.id, "created", user, summary=(
        f"{user.name or user.email} started RFQ '{rfq.rfq_number}' for {pr.p2p_number}"
        + (f" on behalf of {buyer.name or buyer.email}" if behalf else "") + f" with {len(chosen)} line(s): {names}."))
    _write_pr_audit(db, pr.id, "rfq_created", user, summary=(
        f"{user.name or user.email} started RFQ '{rfq.rfq_number}' for {buyer.name or buyer.email}: {names}."))
    fire_rule(db, background_tasks, "p2p", "rfq_create", "RFQ Created",
              f"RFQ '{rfq.rfq_number}' was started for PR '{pr.p2p_number}' by {user.name or user.email}.", "p2p_request", pr.id, user,
              [("RFQ", rfq.rfq_number), ("Requisition", pr.p2p_number), ("Project", pr.project_label or ""), ("By", user.name or user.email)])
    if behalf:
        # Bell only: the buyer finds the RFQ the head raised for them.
        notify_user(db, user_id=buyer.id, title=f"RFQ {rfq.rfq_number} raised for you",
                    message=f"{user.name or user.email} started RFQ {rfq.rfq_number} for your lines on {pr.p2p_number}: {names}.",
                    notification_type="rfq_raised_for_buyer", entity_type="rfq", entity_id=rfq.id)
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.patch("/{rfq_id}/lines", response_model=RFQResponse)
def set_rfq_lines(
    rfq_id: int,
    payload: RFQLinesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    """Replace the line set of a DRAFT RFQ (same rules as create). A submitted RFQ's lines only
    leave it when the Purchase head moves them to another buyer."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "change the lines of")
    if rfq.status != "draft":
        raise HTTPException(status_code=409, detail=(
            f"RFQ {rfq.rfq_number} is already submitted, so its lines are fixed. To quote another line, raise a new RFQ for it; "
            "to move a line to another buyer ask the Purchase head."))
    pr = po_split.lock_pr(db, rfq.p2p_request_id)
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=f"{pr.p2p_number} is {pr.status.replace('_', ' ')} - RFQ lines can't be changed now.")
    rfq = _reload_rfq(db, rfq.id)
    buyer = db.get(User, rfq.buyer_id) if rfq.buyer_id else user
    if buyer is None:
        raise HTTPException(status_code=409, detail=f"The buyer of RFQ {rfq.rfq_number} no longer exists - ask the Purchase head to raise a new RFQ.")
    chosen, to_claim, progress = _choose_lines(db, pr, buyer, user, list(payload.pr_item_ids), rfq.id) if payload.pr_item_ids else ([], [], line_progress(db, pr))
    _claim_lines(db, pr, to_claim, buyer, user)
    before = {i.item_name for i in pr.items if i.id in {r.pr_item_id for r in rfq.items}}
    _sync_items(rfq, chosen, progress)
    after = {l.item_name for l in chosen}
    _write_audit(db, rfq.id, "lines_changed", user, summary=(
        f"{user.name or user.email} changed the lines of RFQ '{rfq.rfq_number}': "
        f"added {', '.join(sorted(after - before)) or 'none'}; removed {', '.join(sorted(before - after)) or 'none'}."))
    db.commit()
    db.refresh(rfq)
    return mask_for(user, "rfq", _to_response(db, rfq))


@router.get("", response_model=list[RFQResponse])
async def list_rfqs(
    p2p_request_id: int | None = None,
    status: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    # RFQs behind a Before-PO receipt's requisition are internal plumbing (RFQ.source): not in
    # the RFQ lists, but the requisition's own page still finds it (Upload PO needs it).
    query = apply_scope(db.query(RFQ).options(selectinload(RFQ.attachments), selectinload(RFQ.items)), user, RFQ)
    if p2p_request_id:
        query = query.filter(RFQ.p2p_request_id == p2p_request_id)
    else:
        query = query.filter(RFQ.source.is_(None) | (RFQ.source != "before_po"))
    if status:
        query = query.filter(RFQ.status == status)
    rfqs = query.order_by(RFQ.created_at.desc()).offset(skip).limit(limit).all()
    cache: dict = {}  # one line-progress query set per requisition, however many of its RFQs are listed
    out = [_to_response(db, r, cache) for r in rfqs]
    _blank_unreadable_rows(db, user, rfqs, out)
    return mask_for(user, "rfq", out)


def _blank_unreadable_rows(db: Session, user: User, rfqs: list[RFQ], out: list[RFQResponse]) -> None:
    """The list shows another buyer's RFQ only as 'RFQ of {buyer}': number, status, buyer and lines stay;
    quotes, files, vendors and commercial terms are emptied. Same rule as ensure_rfq_readable (own buyer,
    Purchase head / admin, approvers of the requisition), decided with one query for the whole page.
    Delegates and escalation targets (decided per requisition by the approval engine) open the detail instead."""
    if not rfqs or po_split.can_work_all_lines(user):
        return
    from app.modules.p2p.access import approver_expr

    hidden = [(r, resp) for r, resp in zip(rfqs, out) if (r.buyer_id or r.created_by_id) not in (None, user.id)]
    if not hidden:
        return
    pr_ids = {r.p2p_request_id for r, _ in hidden}
    party = {pid for (pid,) in db.query(P2PRequest.id).filter(P2PRequest.id.in_(pr_ids), approver_expr(user)).all()}
    for r, resp in hidden:
        if r.p2p_request_id in party:
            continue
        resp.vendor_quotations, resp.attachments = [], []
        resp.awarded_vendors, resp.other_quoted_vendors = [], []
        resp.awarded_line_count = resp.invite_count = 0
        resp.comments = resp.single_quotation_reason = resp.terms_conditions = resp.payment_terms = None
        resp.delivery_lead_time = resp.late_delivery_clause = resp.invite_message = None


@router.get("/{rfq_id}", response_model=RFQResponse)
async def get_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user)
    return mask_for(user, "rfq", _to_response(db, rfq))


@router.patch("/{rfq_id}", response_model=RFQResponse)
async def update_rfq(
    rfq_id: int,
    payload: RFQUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)

    updates = payload.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(rfq, field, val)

    if updates:
        action = "updated" if rfq.status == "draft" else "admin_edited"
        _write_audit(db, rfq.id, action, user, summary=f"{user.name or user.email} updated RFQ '{rfq.rfq_number}'.")

    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/attachments", response_model=list[RFQAttachmentResponse])
async def upload_rfq_attachments(
    rfq_id: int,
    vendor_tier: str = Form(...),
    vendor_name: str | None = Form(None),
    vendor_contact: str | None = Form(None),
    vendor_id: int | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "create")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)
    if vendor_tier not in RFQ_VENDOR_TIERS:
        raise HTTPException(status_code=400, detail=f"Invalid vendor_tier '{vendor_tier}' — must be one of {RFQ_VENDOR_TIERS}")
    if vendor_id is not None:
        # Picked from the vendor master: name / contact come from the master, not the form.
        vendor = _active_vendor_or_400(db, vendor_id)
        vendor_name = vendor.name
        vendor_contact = vendor.contact_phone or vendor.contact_email or vendor_contact
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "rfq", rfq.rfq_number)

    saved: list[RFQAttachment] = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        attachment = RFQAttachment(
            rfq_id=rfq.id,
            vendor_tier=vendor_tier,
            vendor_name=vendor_name,
            vendor_contact=vendor_contact,
            vendor_id=vendor_id,
            filename=result["name"],
            content_type=f.content_type,
            size=result["size"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            created_by_id=user.id,
        )
        db.add(attachment)
        saved.append(attachment)

    if saved:
        _write_audit(db, rfq.id, "attachment_added", user,
                     summary=f"{user.name or user.email} uploaded {len(saved)} {vendor_tier} quotation file(s) to RFQ '{rfq.rfq_number}'.")
        db.flush()
        for a in saved:
            db.refresh(a)
    db.commit()
    return saved


@router.patch("/{rfq_id}/attachments/{attachment_id}", response_model=RFQAttachmentResponse)
async def update_rfq_attachment_vendor(
    rfq_id: int,
    attachment_id: int,
    payload: RFQAttachmentVendorUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "edit")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)
    attachment = db.query(RFQAttachment).filter(RFQAttachment.id == attachment_id, RFQAttachment.rfq_id == rfq_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("vendor_id") is not None:
        vendor = _active_vendor_or_400(db, updates["vendor_id"])
        updates["vendor_name"] = vendor.name
        updates.setdefault("vendor_contact", vendor.contact_phone or vendor.contact_email)
    for field, val in updates.items():
        setattr(attachment, field, val)
    db.commit()
    db.refresh(attachment)
    return attachment


def _ensure_vendor_can_get_po(db: Session, vendor_id: int) -> None:
    """Refuses a PO to a vendor that is no longer in the master or is not
    Active (Blocked / Inactive) — SAP's purchasing block on the vendor."""
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=409, detail="The vendor on this PO is no longer in the vendor master — pick another quoted vendor, or re-add the vendor in Procurement → Vendors.")
    if vendor.status != "active":
        raise HTTPException(status_code=409, detail=f"Vendor {vendor.name} is {vendor.status} in the vendor master, so no purchase order can be raised to it. "
                                                    "Ask Purchase/Finance to set it Active in Procurement → Vendors, or pick another quoted vendor.")


def _active_vendor_or_400(db: Session, vendor_id: int) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=400, detail="That vendor is not in the vendor master any more — pick another one in Procurement → Vendors.")
    if vendor.status != "active":
        raise HTTPException(status_code=400, detail=f"Vendor {vendor.name} is {vendor.status} — activate it in Procurement → Vendors or pick another vendor.")
    return vendor


@router.delete("/{rfq_id}/attachments/{attachment_id}")
async def delete_rfq_attachment(
    rfq_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "delete")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)
    attachment = db.query(RFQAttachment).filter(RFQAttachment.id == attachment_id, RFQAttachment.rfq_id == rfq_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    # Company delete rule: 'Delete' on R.F.Q AND only a file you uploaded (admins any).
    ensure_can_delete(user, attachment, "p2p", "rfq", what="quotation file")
    db.delete(attachment)
    db.commit()
    return {"detail": "Attachment deleted"}


@router.get("/{rfq_id}/attachments/{attachment_id}/content")
async def get_rfq_attachment_content(
    rfq_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    """Raw bytes for in-app preview, fetched via the app-only Graph token —
    never the raw SharePoint webUrl."""
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "view")
    rfq = _get_rfq_or_404(db, rfq_id, user)  # 404 / data-scope check
    ensure_rfq_readable(db, rfq, user)
    attachment = db.query(RFQAttachment).filter(
        RFQAttachment.id == attachment_id, RFQAttachment.rfq_id == rfq_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.post("/{rfq_id}/submit", response_model=RFQResponse)
async def submit_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    """Locks the RFQ — no further edits except by an admin. Validates the
    single-quotation and commercial-terms rules before locking."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    _assert_editable(rfq, user)
    if rfq.status != "draft":
        raise HTTPException(status_code=409, detail=f"RFQ {rfq.rfq_number} is already submitted - record vendor quotes on its Quotations tab.")
    if not active_items(rfq):
        raise HTTPException(status_code=409, detail=f"RFQ {rfq.rfq_number} has no lines. Add a line from your requisition, or discard the RFQ.")
    from app.modules.p2p.models.rfq_invite import RFQVendorInvite
    invites = db.query(RFQVendorInvite).filter(RFQVendorInvite.rfq_id == rfq.id).all()

    if invites:
        # Emailed RFQ: vendors quote later by email; terms come with each quote.
        min_vendors = int(get_p2p_setting(db, "rfq_min_vendors") or 1)
        is_single = len(invites) < min_vendors
        if is_single and not (rfq.single_quotation_reason or "").strip():
            raise HTTPException(status_code=400, detail=f"Only {len(invites)} vendor(s) picked — Procurement › Settings asks for at least {min_vendors}. "
                                                        "Add more vendors, or write the reason for a limited quotation.")
        if not rfq.quote_due_date:
            raise HTTPException(status_code=400, detail="Set the quote-by date — the date vendors must reply by.")
        if rfq.quote_due_date < date.today():
            raise HTTPException(status_code=400, detail="The quote-by date is in the past — pick today or a later date.")
    else:
        tiers_present = {a.vendor_tier for a in rfq.attachments}
        if not tiers_present:
            raise HTTPException(status_code=400, detail="Pick the vendors to email the RFQ to (or attach the L1 quotation you already have).")
        if "L1" not in tiers_present:
            raise HTTPException(status_code=400, detail="An L1 quotation attachment is required")

        is_single = tiers_present == {"L1"}
        if is_single:
            if not rfq.single_quotation_reason:
                raise HTTPException(status_code=400, detail="Reason for single quotation is required when only L1 is attached")
            if not rfq.comments:
                raise HTTPException(status_code=400, detail="Comments are required when only L1 is attached")

        if not rfq.payment_terms:
            raise HTTPException(status_code=400, detail="Payment terms are required")
        if not rfq.delivery_lead_time:
            raise HTTPException(status_code=400, detail="Delivery lead time is required")
    if not (rfq.late_delivery_clause or "").strip():
        raise HTTPException(status_code=400, detail="Late delivery clause is required — write the penalty agreed with the L1 vendor for late supply (it prints on the PO).")

    pr = db.query(P2PRequest).filter(P2PRequest.id == rfq.p2p_request_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Linked P2P request not found")
    # Serialise with the other buyers' awards / uploads on this requisition, then re-read it.
    pr = po_split.lock_pr(db, pr.id)
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=(
            f"RFQ {rfq.rfq_number} can't be submitted: {pr.p2p_number} is {pr.status.replace('_', ' ')} - "
            "only a requisition that is approved and still being bought can go out for quotes."))
    rfq = _reload_rfq(db, rfq.id)
    progress = line_progress(db, pr)
    lines = {i.id: i for i in pr.items}
    gone = [lines[i.pr_item_id].item_name for i in active_items(rfq)
            if i.pr_item_id in lines and (i.pr_item_id not in progress or progress[i.pr_item_id].open_to_order <= _EPS)]
    if gone:
        raise HTTPException(status_code=409, detail=(
            f"{', '.join(repr(n) for n in gone)} on RFQ {rfq.rfq_number} has nothing left to order (issued from stock, on a PO or short-closed). "
            "Remove it from the RFQ's lines, then submit again."))

    old_status = pr.status
    rfq.is_single_quotation = is_single
    rfq.status = "locked"
    rfq.locked_by_id = user.id
    rfq.locked_at = datetime.now(timezone.utc)
    _write_audit(db, rfq.id, "submitted", user, summary=f"{user.name or user.email} submitted and locked RFQ '{rfq.rfq_number}'.")
    db.flush()
    # Header summary: every RFQ number of this requisition; the status itself comes from the roll-up.
    numbers = [n for (n,) in db.query(RFQ.rfq_number).filter(RFQ.p2p_request_id == pr.id, RFQ.status != "cancelled",
                                                              RFQ.source.is_(None) | (RFQ.source != "before_po")).order_by(RFQ.id).all()]
    pr.rfq_number = ", ".join(numbers)[:100] or rfq.rfq_number
    rollup(db, pr, user)
    _write_pr_audit(db, pr.id, "vendor_quotations_started", user,
                 summary=f"RFQ '{rfq.rfq_number}' ({_user_label(db, rfq.buyer_id) or 'buyer'}) was locked and sent for quotes for "
                         f"{len(active_items(rfq))} line(s) of {pr.p2p_number}.",
                 old_status=old_status, new_status=pr.status)

    db.commit()
    if invites:
        # Email every invited vendor now; failures stay on the invite row (Resend).
        from app.modules.p2p.routes.rfq_invites import send_invites
        await send_invites(db, rfq, invites, user)
    db.refresh(rfq)
    return _to_response(db, rfq)


# ---------------------------------------------------------------------------
# Header-level quotation steps (one quote per vendor for the whole RFQ, technical /
# commercial evaluation, select-vendor-quotation) were replaced by line quotations
# and the quotation comparison (award per line, split by quantity). These routes
# stay only to answer 410 with the way forward; old rows keep their data.
# ---------------------------------------------------------------------------

_REPLACED_BY_LINE_QUOTATIONS = (
    "This step was replaced by line quotations and the quotation comparison (award per line). "
    "Record quotes on the RFQ's Quotations tab."
)


def _gone() -> None:
    raise HTTPException(status_code=410, detail=_REPLACED_BY_LINE_QUOTATIONS)


@router.post("/{rfq_id}/vendor-quotations", include_in_schema=False)
def add_vendor_quotation(rfq_id: int, user: User = Depends(_purchase_tab("rfq", "edit"))):
    _gone()


@router.get("/{rfq_id}/vendor-quotations", response_model=list[VendorQuotationResponse])
def list_vendor_quotations(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    """Read-only list of the quotations recorded against this RFQ (old rows and line quotations),
    for the RFQ's own buyer / the Purchase head / anyone whose data scope covers the RFQ."""
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "view")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user)
    return mask_for(user, "rfq", [_to_vq_response(db, vq) for vq in rfq.vendor_quotations])


@router.patch("/{rfq_id}/vendor-quotations/{vq_id}", include_in_schema=False)
def update_vendor_quotation(rfq_id: int, vq_id: int, user: User = Depends(_purchase_tab("rfq", "edit"))):
    _gone()


@router.post("/{rfq_id}/start-technical-evaluation", include_in_schema=False)
def start_technical_evaluation(rfq_id: int, user: User = Depends(_purchase_tab("rfq", "edit"))):
    _gone()


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/technical-evaluation", include_in_schema=False)
def evaluate_technical(rfq_id: int, vq_id: int, user: User = Depends(_purchase_tab("rfq", "view"))):
    _gone()


@router.post("/{rfq_id}/start-commercial-evaluation", include_in_schema=False)
def start_commercial_evaluation(rfq_id: int, user: User = Depends(_purchase_tab("rfq", "edit"))):
    _gone()


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/commercial-evaluation", include_in_schema=False)
def evaluate_commercial(rfq_id: int, vq_id: int, user: User = Depends(_purchase_tab("rfq", "view"))):
    _gone()


@router.post("/{rfq_id}/select-vendor-quotation", include_in_schema=False)
def select_vendor_quotation(rfq_id: int, user: User = Depends(_purchase_tab("rfq", "edit"))):
    _gone()


def _derive_po_total(items) -> float | None:
    """Sum of line totals (qty x unit price + tax), or None while any line is
    still unpriced — a partial sum would understate what's being approved."""
    if not items or any(i.line_total is None for i in items):
        return None
    return round(sum(i.line_total for i in items), 2)


def build_po_draft(db: Session, rfq: RFQ, pr: P2PRequest, user: User, payload: P2PPurchaseOrderCreate,
                   lines: list[tuple[int, float]] | None = None,
                   vendor_quotation: VendorQuotation | None = None) -> P2PPurchaseOrder:
    """Creates an editable draft PO (status='draft') for ONE vendor and flushes it; the caller
    commits. Shared by the RFQ route below and the Before-PO receipt route
    (p2p/routes/pre_po_receipts.py), so both apply the same vendor block,
    approved-supplier check, price proposal and terms.

    `lines` = [(pr_item_id, quantity)]: only those lines, at those quantities. None = every active
    line of the RFQ at what is still open to order. Every line must be an active line of THIS RFQ and
    the quantities must fit what is left to order (checked here, so the caller must hold the
    requisition lock: po_split.lock_pr). The PO records its RFQ (rfq_id); when it is built from a
    vendor's awarded quote (`vendor_quotation`) each PO line also names the quote line it came from.

    The vendor is, in this order: the awarded `vendor_quotation`, the RFQ's selected quote (Before-PO),
    the L1-L4 quote file the buyer picked (any tier but L1 needs a reason), or the vendor named in the
    payload (vendor master). It never changes the requisition's status: the caller rolls it up."""
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=(
            f"A PO can only be made for a requisition that is approved and still being bought - {pr.p2p_number} is "
            f"{pr.status.replace('_', ' ')}."))

    selected = vendor_quotation or next((vq for vq in rfq.vendor_quotations if vq.is_selected), None)
    # The PO goes to the RFQ quote the buyer picks — L1 (lowest) by default;
    # any other tier must carry a reason (standard control on non-L1 buying).
    tier = (payload.vendor_tier or "L1").upper()
    chosen = next((a for a in rfq.attachments if a.vendor_tier == tier and a.vendor_name), None)
    if payload.vendor_tier and not chosen and vendor_quotation is None:
        raise HTTPException(status_code=400, detail=f"There is no {tier} quote on RFQ {rfq.rfq_number} — pick one of the vendors quoted on it.")
    reason = (payload.selection_reason or "").strip()
    if tier != "L1" and not reason and vendor_quotation is None:
        raise HTTPException(status_code=400, detail=f"You picked the {tier} vendor instead of L1 (lowest) — give the reason (e.g. L1 can't meet the delivery date).")
    if not selected and chosen:
        payload.vendor_name = chosen.vendor_name
        # Linked to the vendor master → the vendor invoice can be matched to this PO in Finance.
        # Always the quote's own vendor record (None when the quote names a vendor outside
        # the vendor master) — never an id sent alongside it.
        payload.vendor_id = chosen.vendor_id
    if not selected and not (payload.vendor_name or "").strip():
        raise HTTPException(status_code=400, detail="A vendor name is required to create the PO")
    # Vendor master posting block: a vendor set Blocked / Inactive in
    # Procurement → Vendors (shared with Finance) gets no new PO.
    _po_vendor_id = selected.vendor_id if selected else payload.vendor_id
    if _po_vendor_id:
        _ensure_vendor_can_get_po(db, _po_vendor_id)

    # What goes on the PO: only lines this RFQ asks for, only what is still open to order.
    # A PO's lines come from its requisition's lines — they can't be typed in.
    if payload.items:
        raise HTTPException(status_code=422, detail="A PO's lines come from its requisition's lines — they can't be typed in. "
                                                    "To order something else, raise a requisition for it (picked from the Item Master).")
    on_rfq = {i.pr_item_id: i for i in active_items(rfq)}
    pr_lines = {i.id: i for i in pr.items}
    open_qty = po_split.open_qty_by_pr_item(db, pr)
    if lines is None:
        lines = [(pid, open_qty[pid]) for pid in sorted(on_rfq) if pid in open_qty]
    if not lines:
        raise HTTPException(status_code=409, detail=(
            f"Nothing is left to order on RFQ {rfq.rfq_number} — every line is on a PO or short-closed."))
    wanted: dict[int, float] = {}
    for pid, qty in lines:
        line = pr_lines.get(pid)
        if line is None:
            raise HTTPException(status_code=422, detail=f"PR line #{pid} is not on {pr.p2p_number} — reload the page and pick its lines again.")
        if pid not in on_rfq:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' is not on RFQ {rfq.rfq_number} — a PO can only take the lines its RFQ asked quotes for.")
        if pid in wanted:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' is listed twice — keep one row per line.")
        wanted[pid] = qty
    po_split.ensure_qty_fits(db, pr, wanted)

    if payload.po_number:
        if db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == payload.po_number).first():
            raise HTTPException(status_code=409, detail=f"PO number '{payload.po_number}' already exists")
        po_number = payload.po_number
    else:
        po_number = generate_po_number(db)

    po = P2PPurchaseOrder(
        po_number=po_number,
        p2p_request_id=pr.id,
        rfq_id=rfq.id,
        vendor_id=selected.vendor_id if selected else payload.vendor_id,
        vendor_name=selected.vendor_name if selected else payload.vendor_name,
        vendor_quotation_id=vendor_quotation.id if vendor_quotation is not None else None,
        status="draft",
        po_date=payload.po_date or date.today(),
        expected_delivery=payload.expected_delivery,
        delivery_terms=payload.delivery_terms or (selected.payment_terms if selected else None),
        created_by_id=user.id,
    )
    po.terms_conditions = _po_terms(db, rfq, po.vendor_id)
    # PR account assignment: an internal order carries to the PO (CO commitment).
    if getattr(pr, "internal_order_id", None) and not po.internal_order_id:
        po.internal_order_id = pr.internal_order_id
    db.add(po)
    db.flush()

    # PO lines are the PR's own lines (prices filled on the draft) — each carries its Item Master id
    # forward to the GRN. Items already fulfilled from store stock are never open, so they can't be here.
    quote_lines = {qi.pr_item_id: qi for qi in vendor_quotation.items} if vendor_quotation is not None else {}
    source_items = [
        type("Item", (), {
            "store_item_id": pr_lines[pid].store_item_id, "item_name": pr_lines[pid].item_name, "make": pr_lines[pid].make,
            "part_code": pr_lines[pid].part_code, "unit": pr_lines[pid].unit, "quantity": qty, "unit_price": None,
            "tax_rate": None, "pr_item_id": pid,
            "vendor_quotation_item_id": quote_lines[pid].id if pid in quote_lines else None,
        })()
        for pid, qty in wanted.items()
    ]

    # Quality: a vendor BLOCKED on the approved vendor list gets no PO for
    # those items (services/supplier_quality.ensure_po_allowed).
    from app.modules.quality.services.supplier_quality import ensure_po_allowed, SupplierError
    try:
        ensure_po_allowed(db, po.vendor_name, [i.store_item_id for i in source_items])
    except SupplierError as e:
        raise HTTPException(status_code=e.status, detail=str(e))

    # ME01 source list + ME11 info record (keyed by vendor + Item Master id,
    # never by name): refuse a non-approved source, pre-price from the record.
    from app.modules.p2p import info_records
    info_records.ensure_source_allowed(db, po.vendor_id, [i.store_item_id for i in source_items], po.po_date, po.vendor_name)
    for item in source_items:
        if item.unit_price is None:
            item.unit_price = info_records.default_price(db, po.vendor_id, item.store_item_id, po.po_date)
            item.price_source = "info_record" if item.unit_price else None

    po_items: list[P2PPurchaseOrderItem] = []
    for item in source_items:
        line_total = compute_line_total(item.quantity, item.unit_price, item.tax_rate)
        po_item = P2PPurchaseOrderItem(
            purchase_order_id=po.id,
            store_item_id=item.store_item_id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            unit_price=item.unit_price,
            tax_rate=item.tax_rate,
            line_total=line_total,
            item_category=item_category_for(db, item.store_item_id),
            pr_item_id=item.pr_item_id,
            vendor_quotation_item_id=item.vendor_quotation_item_id,
            price_source=getattr(item, "price_source", None),
        )
        db.add(po_item)
        po_items.append(po_item)
    # The PO value is always derived from its priced lines — never a typed-in
    # lump sum or the quotation's headline price — because the approvers sign
    # off on it and AP's 3-way match pays against those line prices. Unpriced
    # lines leave it null until the buyer fills them in on the draft.
    po.total_value = _derive_po_total(po_items)

    source_note = "awarded quote" if vendor_quotation is not None else ("selected quote" if selected else tier)
    _write_pr_audit(db, pr.id, "po_draft_created", user,
                 summary=f"{user.name or user.email} created draft PO '{po.po_number}' for {pr.p2p_number} to {po.vendor_name} ({source_note}) "
                         f"from RFQ {rfq.rfq_number}, {len(po_items)} line(s)."
                         + (f" Reason for not using L1: {reason}" if tier != "L1" and reason and vendor_quotation is None else ""))
    # The session doesn't autoflush: callers query the new lines right after.
    db.flush()
    return po


def _clash_error(db: Session, ref: str) -> HTTPException:
    """The 409 for a Tally number another upload saved first (the database's unique index caught the race)."""
    clash = db.query(P2PPurchaseOrder.po_number).filter(
        P2PPurchaseOrder.status != "cancelled", func.upper(P2PPurchaseOrder.external_ref) == ref.upper()).first()
    if clash:
        return HTTPException(status_code=409, detail=f"Tally PO {ref} is already on {clash[0]} — check the number in Tally; one Tally PO belongs to one portal PO.")
    return HTTPException(status_code=409, detail=(
        "Another change was saved at the same moment as this upload (for example the same Tally PO number). "
        "Reload the page, check the requisition's POs, and upload again if yours is not there."))


def _queue_po_emails(background_tasks: BackgroundTasks, pr: P2PRequest, po: P2PPurchaseOrder) -> None:
    """Approval e-mail for exactly this PO (never 'the latest PO of the requisition')."""
    background_tasks.add_task(_send_p2p_po_approval_emails_background, pr.id, po.id)


def _award_remaining(db: Session, rfq: RFQ) -> list[tuple[VendorQuotation, VendorQuotationItem, float]]:
    """(quote, quote line, awarded qty still not on a live PO) for every award of this RFQ's active lines."""
    from app.modules.p2p.quotation_compare import awarded_qty_of

    active = {i.pr_item_id for i in active_items(rfq)}
    quote_items = [qi for vq in rfq.vendor_quotations for qi in vq.items]
    on_po = _live_po_qty_by_quote_line(db, [qi.id for qi in quote_items])
    out = []
    for vq in rfq.vendor_quotations:
        for qi in vq.items:
            if qi.pr_item_id not in active:
                continue
            rem = round(awarded_qty_of(qi) - on_po.get(qi.id, 0), 6)
            if rem > _EPS:
                out.append((vq, qi, rem))
    return out


@router.post("/{rfq_id}/upload-po", response_model=P2PPurchaseOrderResponse)
async def upload_po(
    rfq_id: int,
    background_tasks: BackgroundTasks,
    tally_po_no: str = Form(...),
    details: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "create")),
):
    """Upload PO on the requisition (owner, 2026-10-30): the PO is made in Tally,
    not in the portal. The buyer uploads the Tally PO (number + PDF) with ONE vendor,
    the ship-to store and, for each line it takes, its quantity and price. One RFQ can
    carry several POs (one per vendor, each its own approval), and one requisition
    several RFQs. The PO is built from the RFQ's own lines (so the GRN still receives
    against Item Master ids at the PO rate) and goes straight into PO approval.

    Vendor: `vendor_quotation_id` = a vendor's quote with awards - the PO takes its awarded
    lines (quantity up to what is awarded and not yet on a PO); otherwise the L1-L4 quote
    file (`vendor_tier`) or, for an RFQ with no quotes, the vendor master (`vendor_id`).
    The manual "Create PO" draft form is gone; a PO returned for changes is still edited on
    its draft and sent again (submit_po_draft)."""
    ensure_tab_action(user, "p2p", "purchase_orders", "submit")  # it goes straight into PO approval
    ensure_feature_action(user, "p2p", "purchase_orders", "po_document", "create")
    try:
        data = P2PUploadPOPayload.model_validate_json(details)
    except ValidationError as e:
        problems = "; ".join(f"{'.'.join(str(x) for x in err['loc']) or 'details'}: {err['msg']}" for err in e.errors())
        raise HTTPException(status_code=422, detail=f"The PO details are incomplete — {problems}. Fill them in and upload again.")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "upload the PO of")
    pr = db.get(P2PRequest, rfq.p2p_request_id)
    if pr is None:
        raise HTTPException(status_code=404, detail="The requisition of this RFQ was not found — reload the page.")
    _ensure_po_uploadable(rfq, pr)

    ref = _clean_tally_ref(db, tally_po_no, None)
    await _check_tally_pdf(file)
    ship_to = db.get(StoreLocation, data.ship_to_location_id)
    if ship_to is None or not ship_to.is_active:
        raise HTTPException(status_code=422, detail="Pick the store the goods are delivered to — the chosen store doesn't exist or is inactive.")
    ids = [ln.pr_item_id for ln in data.lines]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="A requisition line is listed twice in the PO — keep one row per line.")
    # A vendor-master pick is only for an RFQ without quotes; otherwise the PO
    # goes to the quoted vendor, so the PO name and its vendor record can't differ.
    has_quote = any(a.vendor_name for a in rfq.attachments) or any(vq.is_selected for vq in rfq.vendor_quotations)
    if data.vendor_id and data.vendor_quotation_id:
        raise HTTPException(status_code=422, detail="Pick the vendor once: either one of this RFQ's quotes (vendor_quotation_id) or a vendor from the vendor master, not both.")
    if data.vendor_id and has_quote:
        raise HTTPException(status_code=422, detail=f"{rfq.rfq_number} has vendor quotes — pick the vendor from its quotes (L1 by default), not from the vendor master.")
    vendor = _active_vendor_or_400(db, data.vendor_id) if data.vendor_id else None

    # The PDF goes to SharePoint BEFORE the requisition is locked: one event
    # loop serves every request, so no await may sit between the row lock and
    # the commit (a request waiting on that lock would freeze the server).
    stored = await _upload_tally_pdf(user, pr.p2p_number, file)
    try:
        pr = po_split.lock_pr(db, pr.id)  # FOR UPDATE NOWAIT; 409 when another upload / award is running
        rfq = _reload_rfq(db, rfq.id)
        _ensure_po_uploadable(rfq, pr)
        ensure_rfq_owner(db, rfq, user, "upload the PO of")
        po_lines, quote = _resolve_upload_lines(db, rfq, pr, user, data)
        po = build_po_draft(db, rfq, pr, user, P2PPurchaseOrderCreate(
            vendor_tier=data.vendor_tier, selection_reason=data.selection_reason,
            vendor_id=vendor.id if vendor else None, vendor_name=vendor.name if vendor else None,
            expected_delivery=data.expected_delivery, delivery_terms=data.delivery_terms or (quote.payment_terms if quote else None) or rfq.payment_terms),
            lines=[(pid, qty) for pid, qty, _ln in po_lines], vendor_quotation=quote)
        po.ship_to_location_id = ship_to.id
        po.plant_branch_id = ship_to.branch_id
        if data.cost_center_id:
            from app.modules.p2p.purpose import check_cost_center
            check_cost_center(db, data.cost_center_id)
            po.cost_center_id = data.cost_center_id

        # Every PO line is a PR line; the buyer gives each one its Tally price.
        priced = {pid: ln for pid, _qty, ln in po_lines}
        lines = db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.purchase_order_id == po.id).all()
        for item in lines:
            ln = priced[item.pr_item_id]
            item.unit_price = ln.unit_price
            item.tax_rate = ln.tax_rate
            item.price_source = "manual"
            item.line_total = compute_line_total(item.quantity, item.unit_price, item.tax_rate)
        po.total_value = _derive_po_total(lines)
        db.flush()

        _attach_tally_pdf(db, pr, po, user, ref, stored)
        _send_po_for_approval(db, background_tasks, pr, po, user)

        # Goods the store took before this PO existed (Before PO): the receipt now has its PO.
        from app.modules.store.models.pre_po_receipt import StorePrePoReceipt
        receipt = (db.query(StorePrePoReceipt)
                   .filter(StorePrePoReceipt.p2p_request_id == pr.id, StorePrePoReceipt.status == "pending_po").first())
        if receipt is not None:
            receipt.status = "po_created"
            receipt.purchase_order_id = po.id

        db.commit()
    except Exception as exc:
        db.rollback()
        # Nothing points at the stored PDF now — remove it (best effort).
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, stored["path"])
        except Exception:
            pass
        if isinstance(exc, IntegrityError):
            # Two uploads of the same Tally number at once: the unique index let one through.
            raise _clash_error(db, ref) from exc
        raise
    _queue_po_emails(background_tasks, pr, po)
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    resp.document_uploaded_by_name = user.name or user.email
    return resp


# RFQs raised before this date had no per-line buyers: one buyer's RFQ could carry lines that other
# buyers own (the header buyer's), so its owner uploads for every line of it.
SPLIT_START = datetime(2026, 10, 31, tzinfo=timezone.utc)


def _is_pre_split_rfq(rfq: RFQ) -> bool:
    created = rfq.created_at
    if created is None:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created < SPLIT_START


def _was_reassigned(db: Session, pr: P2PRequest, line: P2PRequestItem) -> bool:
    """True when the Purchase head moved this line to another buyer (the audit line names the item)."""
    return db.query(AuditLog.id).filter(
        AuditLog.entity_type == "p2p_request", AuditLog.entity_id == pr.id, AuditLog.action == "line_buyer_reassigned",
        AuditLog.summary.like(f"%'{line.item_name}'%")).first() is not None


def _resolve_upload_lines(db: Session, rfq: RFQ, pr: P2PRequest, user: User, data: P2PUploadPOPayload):
    """([(pr_item_id, quantity, payload line)], the vendor's quote or None) for an upload, with every
    ownership, RFQ-membership and quantity rule applied (under the requisition lock)."""
    from app.modules.p2p.quotation_compare import awarded_qty_of

    pr_lines = {i.id: i for i in pr.items}
    active = {i.pr_item_id: i for i in active_items(rfq)}
    withdrawn = {i.pr_item_id: i for i in rfq.items if i.withdrawn_at is not None and i.pr_item_id not in active}
    open_qty = po_split.open_qty_by_pr_item(db, pr)
    if not any(pid in open_qty for pid in active):
        raise HTTPException(status_code=409, detail=f"Nothing is left to order on RFQ {rfq.rfq_number} — every line is on a PO or short-closed.")
    expected_buyer = rfq.buyer_id or rfq.created_by_id
    # An RFQ raised before lines had their own buyers (before 2026-10-31) covers several buyers' lines
    # under its owner: the owner uploads all of them. Newer RFQs keep the line-buyer rule.
    head = po_split.can_work_all_lines(user) or _is_pre_split_rfq(rfq)

    for ln in data.lines:
        line = pr_lines.get(ln.pr_item_id)
        if line is None:
            raise HTTPException(status_code=422, detail="Some priced lines are not open lines of this requisition — reload the page and enter the prices again.")
        if ln.pr_item_id not in active:
            gone = withdrawn.get(ln.pr_item_id)
            if gone is not None:
                raise HTTPException(status_code=409, detail=(
                    f"'{line.item_name}' was taken off RFQ {rfq.rfq_number}" + (f" ({gone.withdrawn_reason})" if gone.withdrawn_reason else "")
                    + ". Reload the page and continue with the lines that are still on this RFQ."))
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' is not on RFQ {rfq.rfq_number} — upload only the lines this RFQ asked quotes for.")
        owner = po_split.effective_buyer_id(line, pr)
        if owner is not None and expected_buyer is not None and owner != expected_buyer and not head:
            who = _user_label(db, owner) or f"user #{owner}"
            raise HTTPException(status_code=403, detail=(
                f"'{line.item_name}' is bought by {who}, not by the owner of RFQ {rfq.rfq_number} — {who} raises their own RFQ for it, "
                "or the Purchase head reassigns the line."
                + (f" (The line was reassigned to {who}.)" if _was_reassigned(db, pr, line) else "")))

    quote = None
    out = []
    if data.vendor_quotation_id is not None:
        quote = next((vq for vq in rfq.vendor_quotations if vq.id == data.vendor_quotation_id), None)
        if quote is None:
            raise HTTPException(status_code=422, detail=f"That quotation is not on RFQ {rfq.rfq_number} — reload the page and pick the vendor again.")
        by_line = {qi.pr_item_id: qi for qi in quote.items}
        on_po = _live_po_qty_by_quote_line(db, [qi.id for qi in quote.items])
        for ln in data.lines:
            name = pr_lines[ln.pr_item_id].item_name
            qi = by_line.get(ln.pr_item_id)
            awarded = awarded_qty_of(qi) if qi is not None else 0.0
            if awarded <= _EPS:
                raise HTTPException(status_code=422, detail=(
                    f"'{name}' is not awarded to {quote.vendor_name} on RFQ {rfq.rfq_number} — award it on the Quotations tab first, "
                    "or leave it off this PO."))
            ordered = on_po.get(qi.id, 0.0)
            remaining = round(awarded - ordered, 6)
            if remaining <= _EPS:
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': all {awarded:g} awarded to {quote.vendor_name} is already on a PO. Cancel that PO, or award more, first."))
            qty = ln.quantity if ln.quantity is not None else remaining
            if qty - remaining > 1e-6:
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': {qty:g} is more than the {remaining:g} awarded to {quote.vendor_name}"
                    + (f" ({ordered:g} of the {awarded:g} awarded is already on a PO)." if ordered > _EPS else ".")))
            out.append((ln.pr_item_id, qty, ln))
    else:
        awarded = _award_remaining(db, rfq)
        if awarded:
            names = sorted({vq.vendor_name for vq, _qi, _rem in awarded})
            raise HTTPException(status_code=422, detail=(
                f"RFQ {rfq.rfq_number} has awards to {', '.join(names)}. Choose the vendor whose PO you are uploading "
                "(the vendor's quotation) — a PO built without it would not follow the awarded quantities."))
        for ln in data.lines:
            left = open_qty.get(ln.pr_item_id, 0.0)
            if left <= _EPS:
                raise HTTPException(status_code=409, detail=(
                    f"'{pr_lines[ln.pr_item_id].item_name}' has nothing left to order on {pr.p2p_number} — it is already on POs or short-closed. "
                    "Leave it off this PO."))
            out.append((ln.pr_item_id, ln.quantity if ln.quantity is not None else left, ln))
    return out, quote


def _po_of_rfq(db: Session, rfq: RFQ, pr: P2PRequest, po_id: int, with_items: bool = False,
               user: User | None = None) -> P2PPurchaseOrder | None:
    """A PO of this requisition that came from THIS RFQ (or has no RFQ on record: made before RFQs
    owned their POs). A PO of another buyer's RFQ is not found through this one. With `user`, a PO
    with no RFQ is only reachable by whoever drafted it or may work all buyers' lines (403 otherwise),
    so one RFQ owner can't reach an older PO through their own RFQ."""
    q = db.query(P2PPurchaseOrder)
    if with_items:
        q = q.options(selectinload(P2PPurchaseOrder.items))
    po = q.filter(P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id,
                  (P2PPurchaseOrder.rfq_id == rfq.id) | P2PPurchaseOrder.rfq_id.is_(None)).first()
    if po is not None and po.rfq_id is None and user is not None:
        if not (po.created_by_id == user.id or po_split.can_work_all_lines(user)):
            who = _user_label(db, po.created_by_id) or "its creator"
            raise HTTPException(status_code=403, detail=(
                f"PO {po.po_number} was made without an RFQ by {who} — only {who} or the Purchase head can work on it. "
                f"Ask {who}, or ask the Purchase head."))
    return po


@router.patch("/{rfq_id}/po-draft/{po_id}", response_model=P2PPurchaseOrderResponse)
async def update_po_draft(
    rfq_id: int,
    po_id: int,
    payload: P2PPurchaseOrderDraftUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "edit")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "edit the PO draft of")
    pr = _get_pr_for_rfq(db, rfq)
    po = _po_of_rfq(db, rfq, pr, po_id, with_items=True, user=user)
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")
    # A requisition carries several POs, so the PO's own status decides.
    if po.status != "draft" or not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail="This PO draft is no longer editable")

    updates = payload.model_dump(exclude_unset=True, exclude={"items"})
    if updates.get("cost_center_id"):
        from app.modules.p2p.purpose import check_cost_center
        check_cost_center(db, updates["cost_center_id"])
    # Any edit makes the managed Word PO out of date (it compares this revision).
    po.revision = (po.revision or 0) + 1
    for field, val in updates.items():
        setattr(po, field, val)

    if payload.items is not None:
        items_by_id = {i.id: i for i in po.items}
        unknown = [p.id for p in payload.items if p.id not in items_by_id]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Line item(s) {', '.join(map(str, unknown))} don't belong to PO '{po.po_number}' — reload the page and try again.")
        from app.modules.p2p.pre_po import po_line_floor_reason, po_line_min_quantity
        raised: list[str] = []
        for pricing in payload.items:
            item = items_by_id[pricing.id]
            # Quantity may be raised above the requisition (vendor lot size, spares), never below it.
            if pricing.quantity is not None and abs(pricing.quantity - (item.quantity or 0)) > 1e-9:
                floor = po_line_min_quantity(item, db, lock=True)
                if floor is not None and pricing.quantity < floor - 1e-9:
                    raise HTTPException(status_code=422, detail=(
                        f"{item.item_name}: quantity can't be below {floor:g} {item.unit or 'units'} — "
                        f"{po_line_floor_reason(item, db, floor)}. You can only increase it; to order less, discard this draft "
                        "and upload the PO again with the smaller quantity."))
                if pricing.quantity > (item.quantity or 0):
                    raised.append(f"'{item.item_name}' {item.quantity:g} to {pricing.quantity:g} {item.unit or ''}".rstrip())
                item.quantity = pricing.quantity
            # Prices may be left empty on a draft; Send for approval still needs every line priced.
            if "unit_price" in pricing.model_fields_set:
                item.unit_price = pricing.unit_price
            item.tax_rate = pricing.tax_rate
            if "specification" in pricing.model_fields_set:
                item.specification = (pricing.specification or "").strip() or None
            item.line_total = compute_line_total(item.quantity, item.unit_price, item.tax_rate)
        po.total_value = _derive_po_total(po.items)
        if raised:
            _write_pr_audit(db, pr.id, "po_qty_raised", user,
                            summary=f"{user.name or user.email} raised quantity on draft PO '{po.po_number}' above the requisition: "
                                    + "; ".join(raised) + ".")

    if updates or payload.items is not None:
        value_note = f" PO value now {po.total_value:,.2f}." if po.total_value is not None else ""
        _write_pr_audit(db, pr.id, "po_draft_updated", user,
                        summary=f"{user.name or user.email} updated draft PO '{po.po_number}'.{value_note}")

    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


def _clean_tally_ref(db: Session, tally_po_no: str | None, po_id: int | None) -> str:
    """The Tally PO number, checked: present, short, and on no other live PO."""
    ref = (tally_po_no or "").strip()
    if not ref:
        raise HTTPException(status_code=422, detail="Enter the Tally PO number — the voucher number of this PO in Tally.")
    if len(ref) > 100:
        raise HTTPException(status_code=422, detail="The Tally PO number is longer than 100 characters — enter only the voucher number.")
    q = db.query(P2PPurchaseOrder.po_number).filter(
        P2PPurchaseOrder.status != "cancelled", func.upper(P2PPurchaseOrder.external_ref) == ref.upper())
    if po_id is not None:
        q = q.filter(P2PPurchaseOrder.id != po_id)
    clash = q.first()
    if clash:
        raise HTTPException(status_code=409, detail=f"Tally PO {ref} is already on {clash[0]} — check the number in Tally; one Tally PO belongs to one portal PO.")
    return ref


async def _check_tally_pdf(file: UploadFile) -> None:
    """A real PDF within the size limit, and somewhere to store it."""
    if (file.content_type or "").lower() != "application/pdf" or not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Attach the Tally PO as a PDF file (print it from Tally to PDF).")
    head = await file.read(MAX_TALLY_PDF_BYTES + 1)
    if len(head) > MAX_TALLY_PDF_BYTES:
        raise HTTPException(status_code=413, detail=f"The PDF is larger than {MAX_TALLY_PDF_BYTES // (1024 * 1024)} MB — print it again at a lower quality.")
    if not head.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="That file isn't a real PDF — print the Tally PO to PDF and attach that file.")
    await file.seek(0)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Document storage (SharePoint) isn't set up on this server — ask the admin to configure it, then upload again.")


def _ensure_po_uploadable(rfq: RFQ, pr: P2PRequest) -> None:
    """Upload PO is for a submitted RFQ of a requisition that is still being bought. How much can be
    ordered is decided per line (open quantity, awards), never by the requisition's header status."""
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=(
            f"A PO can be uploaded only on a requisition that is approved and still being bought (RFQ stage) — "
            f"{pr.p2p_number} is '{pr.status}'."))
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail=(
            f"RFQ {rfq.rfq_number} is still a draft — submit it, record the vendors' quotes and award the lines before uploading a PO."))


async def _upload_tally_pdf(user: User, folder_key: str, file: UploadFile) -> dict:
    """Saves the checked Tally PDF to SharePoint under a name of its own (time
    prefix), so a later upload never overwrites a file an older history entry opens."""
    file.filename = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S%f}-{file.filename or 'tally-po.pdf'}"
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "po", folder_key)
    return await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)


def _attach_tally_pdf(db: Session, pr: P2PRequest, po: P2PPurchaseOrder, user: User, ref: str, result: dict) -> None:
    """Puts the stored Tally PDF on the PO and records it on the requisition's
    timeline. The caller commits."""
    replaced = po.document_filename
    po.external_ref = ref
    po.document_filename = result["name"]
    po.document_content_type = "application/pdf"
    po.document_size = result["size"]
    po.document_sharepoint_path = result["path"]
    po.document_sharepoint_url = result.get("webUrl")
    po.document_uploaded_by_id = user.id
    po.document_uploaded_at = datetime.now(timezone.utc)

    # The timeline entry keeps its own copy's path, so every uploaded version
    # stays openable from the requisition's history (p2p_requests audit document).
    db.add(AuditLog(
        entity_type="p2p_request", entity_id=pr.id, action="po_document_uploaded", performed_by_id=user.id,
        summary=(f"{user.name or user.email} uploaded Tally PO {ref} ({result['name']}) for '{po.po_number}'"
                 + (f", replacing {replaced}." if replaced else ".")),
        attachment_url=result["path"],
    ))


@router.post("/{rfq_id}/po-draft/{po_id}/document", response_model=P2PPurchaseOrderResponse)
async def upload_po_document(
    rfq_id: int,
    po_id: int,
    tally_po_no: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "edit")),
):
    """The Tally PO (owner, 2026-10-27): every portal PO is also made in Tally,
    and its Tally PO number + the Tally print (PDF) must be on the draft before
    it can be sent for approval (submit_po_draft). While the PO is a draft the
    upload can be repeated (wrong file, Tally PO revised after a return for
    changes); once it is in approval it is locked. The Tally number is kept as
    external_ref and can be used on one live PO only."""
    ensure_feature_action(user, "p2p", "purchase_orders", "po_document", "create")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "upload the Tally PO of")
    pr = _get_pr_for_rfq(db, rfq)
    po = _po_of_rfq(db, rfq, pr, po_id, user=user)
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found — it may have been cancelled; reload the page.")
    if po.status != "draft" or not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=f"{po.po_number} is no longer a draft, so its Tally PO can't be changed. Raise a PO amendment if the Tally PO changed.")
    ref = _clean_tally_ref(db, tally_po_no, po.id)
    await _check_tally_pdf(file)
    stored = await _upload_tally_pdf(user, po.po_number, file)
    _attach_tally_pdf(db, pr, po, user, ref, stored)
    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    resp.document_uploaded_by_name = user.name or user.email
    return resp


def _inline_disposition(name: str) -> str:
    """inline Content-Disposition that survives non-ASCII file names (a Tally PDF named in Hindi)."""
    ascii_name = name.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "") or "document.pdf"
    return f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


@router.get("/{rfq_id}/po-draft/{po_id}/document/content")
async def get_po_document_content(
    rfq_id: int,
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "view")),
):
    ensure_feature_action(user, "p2p", "purchase_orders", "po_document", "view")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    ensure_rfq_readable(db, rfq, user, pr)
    # The approvers of the requisition / its POs open the Tally PO they sign off on; anyone else must own it.
    po = _po_of_rfq(db, rfq, pr, po_id, user=None if is_pr_approver_party(db, user, pr) else user)
    if not po or not po.document_sharepoint_path:
        raise HTTPException(status_code=404, detail="PO document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, po.document_sharepoint_path)
    return Response(
        content=content,
        media_type=po.document_content_type or content_type,
        headers={"Content-Disposition": _inline_disposition(po.document_filename or f"{po.po_number}.pdf"), "X-Content-Type-Options": "nosniff"},
    )


@router.post("/{rfq_id}/po-draft/{po_id}/submit", response_model=P2PPurchaseOrderResponse)
async def submit_po_draft(
    rfq_id: int,
    po_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "submit")),
):
    """Finalizes the draft PO and sends it into PO approval — the "Purchase
    order" workflow of the central approval engine (Organization › Approval
    Workflows; default: the PO approvers, then any one Partner). Also how a PO
    returned for changes goes back for approval."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "send the PO draft of")
    pr = _get_pr_for_rfq(db, rfq)
    po = _po_of_rfq(db, rfq, pr, po_id, with_items=True, user=user)
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")

    po_number = po.po_number

    def _not_sendable() -> HTTPException:
        return HTTPException(status_code=409, detail=(
            f"{po_number} can't be sent for approval: it is {po.status if po is not None else 'no longer there'} "
            f"and {pr.p2p_number} is {pr.status.replace('_', ' ')}. "
            "Only a draft PO (for example one returned for changes) of a requisition still being bought can be sent."))

    if po.status != "draft" or not po_split.is_procurement_open(pr):
        raise _not_sendable()
    pr = po_split.lock_pr(db, pr.id)
    # Another request (a second click, the approver's return) may have changed the PO while we waited for the lock.
    db.expire(po)
    po = _po_of_rfq(db, rfq, pr, po_id, with_items=True, user=user)
    if po is None or po.status != "draft" or not po_split.is_procurement_open(pr):
        raise _not_sendable()
    _send_po_for_approval(db, background_tasks, pr, po, user)
    db.commit()
    _queue_po_emails(background_tasks, pr, po)
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


@router.post("/{rfq_id}/po-draft/{po_id}/discard", response_model=P2PPurchaseOrderResponse)
def discard_po_draft(
    rfq_id: int,
    po_id: int,
    payload: P2PPurchaseOrderDiscardPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "edit")),
):
    """Discard a DRAFT PO - one returned for changes or withdrawn from approval that the buyer no longer
    wants. The PO is cancelled (its Tally number is free again), the quantity on it is open to order again
    (it is computed from the live POs), and a Before-PO receipt behind it waits for a new PO. Only the
    RFQ's own buyer or the Purchase head; a PO in approval or released is not discarded here."""
    from app.modules.organization.services import approval_engine as engine
    from app.modules.p2p.pre_po import reopen_receipt_for_cancelled_po

    rfq = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "discard the PO draft of")
    pr = _get_pr_for_rfq(db, rfq)
    po = _po_of_rfq(db, rfq, pr, po_id, user=user)
    if po is None:
        raise HTTPException(status_code=404, detail="Draft PO not found on this RFQ - it may already be discarded; reload the page.")
    reason = (payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail=f"Write why PO {po.po_number} is discarded (at least 5 characters) - it is kept on the requisition's history.")

    def _not_a_draft() -> HTTPException:
        return HTTPException(status_code=409, detail=(
            f"PO {po_number} is {po.status if po is not None else 'no longer there'}, so it can't be discarded - only a draft PO can. "
            "A PO in approval is withdrawn from the approval first; a released PO is changed with an amendment."))

    po_number = po.po_number
    if po.status != "draft":
        raise _not_a_draft()
    pr = po_split.lock_pr(db, pr.id)   # no await between this lock and the commit
    db.expire(po)
    po = _po_of_rfq(db, rfq, pr, po_id, with_items=True, user=user)
    if po is None or po.status != "draft":
        raise _not_a_draft()

    pr_line_ids = [i.pr_item_id for i in po.items if i.pr_item_id]
    line_buyers = {b for (b,) in db.query(P2PRequestItem.buyer_id).filter(P2PRequestItem.id.in_(pr_line_ids or [-1])).all()}
    qty = ", ".join(f"{i.item_name} {i.quantity:g}" for i in po.items)
    # A draft has no open approval; this only matters if one was left behind.
    engine.cancel_for_entity(db, p2p_approvals.PO_ENTITY, po.id, user, f"PO discarded: {reason}")
    po.status = "cancelled"
    reopen_receipt_for_cancelled_po(db, po, user)
    db.flush()
    summary = (f"{user.name or user.email} discarded draft PO '{po.po_number}' ({po.vendor_name or 'no vendor'}) of {pr.p2p_number}: {reason} "
               f"Its quantity ({qty}) is open to order again.")
    _write_pr_audit(db, pr.id, "po_discarded", user, summary=summary, old_status="draft", new_status="cancelled")
    if po.rfq_id:
        _write_audit(db, po.rfq_id, "po_discarded", user, summary=summary)
    rollup(db, pr, user)

    # Bell only: the requester, the RFQ's buyer and the buyers of the lines that were on the PO.
    for uid in dict.fromkeys(u for u in [pr.requested_by_id, rfq.buyer_id, *sorted(line_buyers - {None})] if u and u != user.id):
        notify_user(db, user_id=uid, title=f"Draft PO {po.po_number} discarded",
                    message=f"{user.name or user.email} discarded draft PO {po.po_number} ({po.vendor_name or 'no vendor'}) of {pr.p2p_number}. "
                            f"Reason: {reason}. Its lines ({qty}) are open to order again.",
                    notification_type="p2p_po_discarded", entity_type="p2p_request", entity_id=pr.id)
    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


def _send_po_for_approval(db: Session, background_tasks: BackgroundTasks, pr: P2PRequest, po: P2PPurchaseOrder, user: User) -> None:
    """Checks a PO is complete and sends it into PO approval. Flushes, never
    commits; the caller commits and then queues the approval e-mails."""
    # Approvers must see — and sign off on — a real value. Without this the
    # chain approved blank POs and AP's 3-way match then accepted any amount.
    if not po.items:
        raise HTTPException(status_code=400, detail=f"PO '{po.po_number}' has no line items — it can't be sent for approval.")
    unpriced = [i.item_name for i in po.items if not i.unit_price or i.unit_price <= 0]
    if unpriced:
        raise HTTPException(
            status_code=400,
            detail=f"Enter a unit price for every line before sending the PO for approval — missing: {', '.join(unpriced)}.",
        )
    # The PO prints where to deliver (the ship-to store's address); without it the vendor can't ship.
    if not po.ship_to_location_id:
        raise HTTPException(status_code=400, detail=(
            f"Pick where the goods of '{po.po_number}' are delivered before sending it for approval — the receiving "
            "plant and ship-to store in section 1 (Ship to). The store's address is printed on the PO."))
    # Owner, 2026-10-27: the PO is made in Tally too; approvers sign off on it.
    if not (po.external_ref or "").strip() or not po.document_sharepoint_path:
        raise HTTPException(status_code=400, detail=(
            f"Upload the Tally PO for '{po.po_number}' before sending it for approval — enter its Tally PO number and "
            "attach the Tally PO print (PDF) in the 'Tally PO' section."))
    # The vendor may have been blocked in the vendor master since the draft was made.
    if po.vendor_id:
        _ensure_vendor_can_get_po(db, po.vendor_id)
    po.total_value = _derive_po_total(po.items)

    old_status = pr.status
    pr.po_date = po.po_date
    pr.expected_delivery = po.expected_delivery
    # PO -> issued. The engine resolves and notifies the approvers (bell + Teams; this PO's full
    # e-mail goes after commit), or refuses with the reason when a stage has nobody to approve.
    p2p_approvals.submit_po(db, pr, po, user)
    # The requisition's header status / value / quantities roll up from ALL its POs (this PO only
    # moves itself; other buyers' POs and RFQs are untouched).
    rollup(db, pr, user)
    _write_pr_audit(db, pr.id, "po_raised", user,
                 summary=f"{user.name or user.email} submitted PO '{po.po_number}' for {pr.p2p_number} — entering PO approval.",
                 old_status=old_status, new_status=pr.status)

    fire_rule(db, background_tasks, "p2p", "po_raised", "Purchase Order Raised",
              f"PO '{po.po_number}' ({po.vendor_name}, {po.total_value:,.2f}) for PR '{pr.p2p_number}' was sent for approval by {user.name or user.email}.",
              "p2p_request", pr.id, user,
              [("PO", po.po_number), ("Vendor", po.vendor_name or ""), ("Value", f"{po.total_value:,.2f}" if po.total_value else ""),
               ("Requisition", pr.p2p_number), ("By", user.name or user.email)])


def _po_terms(db: Session, rfq: RFQ, vendor_id: int | None) -> str | None:
    """Terms printed on the PO: the company's standard terms (Procurement → Settings,
    not editable per RFQ), then the late delivery clause agreed on this RFQ. The
    vendor's own terms & conditions are used on the RFQ only (rfq_mail), never on
    the PO (owner decision 2026-10-26). Older RFQs that carried a per-RFQ copy keep it."""
    parts = []
    company = rfq.terms_conditions or get_p2p_setting(db, "company_terms")
    if company:
        parts.append(f"Company terms:\n{company.strip()}")
    if (rfq.late_delivery_clause or "").strip():
        parts.append(f"Late delivery clause:\n{rfq.late_delivery_clause.strip()}")
    return "\n\n".join(parts) or None
