from datetime import date, datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import ensure_can_delete, ensure_feature_action, ensure_tab_action, require_app_access
from app.modules.p2p.pricing import mask_for
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ, RFQ_VENDOR_TIERS
from app.modules.p2p.models.rfq_attachment import RFQAttachment
from app.modules.p2p.models.vendor_quotation import (
    VendorQuotation, VENDOR_QUOTATION_TECHNICAL_STATUSES, VENDOR_QUOTATION_COMMERCIAL_STATUSES,
)
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.item_link import item_category_for
from app.modules.p2p.schemas.rfq import (
    RFQCreate, RFQUpdate, RFQResponse, RFQAttachmentResponse, RFQAttachmentVendorUpdate,
    VendorQuotationCreate, VendorQuotationUpdate, VendorQuotationEvaluatePayload,
    VendorQuotationSelectPayload, VendorQuotationResponse,
)
from app.modules.p2p.schemas.purchase_order import (
    P2PPurchaseOrderCreate, P2PPurchaseOrderDraftUpdatePayload, P2PPurchaseOrderResponse,
)
from app.modules.p2p.service import generate_rfq_number, generate_po_number, compute_line_total
from app.modules.p2p import approvals as p2p_approvals
from app.modules.p2p.access import ensure_pr_in_scope
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.p2p.settings import get_setting as get_p2p_setting
from app.modules.accounts.models.vendor import Vendor
from app.core.notify_rules import fire_rule
from app.modules.p2p.routes.p2p_requests import _write_audit as _write_pr_audit, _send_p2p_po_approval_emails_background
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P"])

# PR statuses at which a draft PO can still be edited / sent (ME21N split:
# other POs of the same PR may already be in approval or released).
MAX_TALLY_PDF_BYTES = 15 * 1024 * 1024
_SPLIT_PO_PR_STATUSES = ("po_drafted", "po_raised", "po_approved", "partially_received", "received")


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
        selectinload(RFQ.attachments), selectinload(RFQ.vendor_quotations),
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


def _assert_editable(rfq: RFQ, user: User) -> None:
    if rfq.status != "draft" and not _is_admin(user):
        raise HTTPException(status_code=409, detail="This RFQ has been submitted and is locked. Only an admin can edit it.")


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


def _to_response(db: Session, rfq: RFQ) -> RFQResponse:
    resp = RFQResponse.model_validate(rfq)
    resp.vendor_quotations = [_to_vq_response(db, vq) for vq in rfq.vendor_quotations]
    pr = db.query(P2PRequest).filter(P2PRequest.id == rfq.p2p_request_id).first()
    if pr:
        resp.p2p_number = pr.p2p_number
        resp.p2p_status = pr.status
        resp.p2p_created_at = pr.created_at
        resp.p2p_required_date = pr.required_date
    if rfq.created_by_id:
        creator = db.query(User).filter(User.id == rfq.created_by_id).first()
        if creator:
            resp.created_by_name = creator.name or creator.email
    from app.modules.p2p.models.rfq_invite import RFQVendorInvite
    resp.invite_count = db.query(RFQVendorInvite).filter(RFQVendorInvite.rfq_id == rfq.id).count()
    resp.awarded_line_count = sum(1 for vq in rfq.vendor_quotations for i in vq.items if i.is_awarded)
    resp.awarded_vendors = [vq.vendor_name for vq in rfq.vendor_quotations if any(i.is_awarded for i in vq.items)]
    resp.other_quoted_vendors = [vq.vendor_name for vq in rfq.vendor_quotations if vq.vendor_name not in resp.awarded_vendors]
    return resp


@router.post("", response_model=RFQResponse)
async def create_rfq(
    payload: RFQCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "create")),
):
    pr = db.query(P2PRequest).filter(P2PRequest.id == payload.p2p_request_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="P2P request not found")
    ensure_pr_in_scope(db, user, pr)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"An RFQ can only be raised on an approved PR (current status: {pr.status})")

    # An RFQ only makes sense once the buyer has decided every line: lines
    # still 'pending' may yet be issued from store stock (no purchase), and
    # if nothing was sent to procurement there is nothing to quote for.
    pending = [i for i in pr.items if i.fulfillment_status == "pending"]
    if pending:
        names = ", ".join(f"'{i.item_name}'" for i in pending)
        raise HTTPException(
            status_code=409,
            detail=f"{len(pending)} line(s) on {pr.p2p_number} still await the stock decision ({names}). "
                   "Open the PR and either issue each from store stock or send it to procurement — the RFQ can be raised once every line is decided.",
        )
    if not any(i.fulfillment_status == "sent_to_procurement" for i in pr.items):
        raise HTTPException(
            status_code=409,
            detail=f"Every line on {pr.p2p_number} was issued from store stock — there is nothing left to purchase, so no RFQ is needed.",
        )

    # Reuse an already-started draft RFQ for this PR instead of minting a
    # duplicate one. The PR's status doesn't change until the RFQ is
    # submitted/locked, so nothing else here stops a retried/duplicate
    # create call (network retry, resubmitted form after a page reload —
    # the frontend's own draftRfqId guard only survives within one page
    # session) from leaving an orphaned draft RFQ row behind every time.
    existing_draft = db.query(RFQ).filter(
        RFQ.p2p_request_id == pr.id, RFQ.status == "draft"
    ).order_by(RFQ.created_at.desc()).first()
    if existing_draft:
        return _to_response(db, existing_draft)

    rfq = RFQ(
        rfq_number=generate_rfq_number(db),
        p2p_request_id=pr.id,
        status="draft",
        created_by_id=user.id,
        requires_technical_evaluation=payload.requires_technical_evaluation,
    )
    db.add(rfq)
    db.flush()
    _write_audit(db, rfq.id, "created", user, summary=f"{user.name or user.email} started RFQ '{rfq.rfq_number}' for {pr.p2p_number}.")
    fire_rule(db, background_tasks, "p2p", "rfq_create", "RFQ Created",
              f"RFQ '{rfq.rfq_number}' was started for PR '{pr.p2p_number}' by {user.name or user.email}.", "p2p_request", pr.id, user,
              [("RFQ", rfq.rfq_number), ("Requisition", pr.p2p_number), ("Project", pr.project_label or ""), ("By", user.name or user.email)])
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.get("", response_model=list[RFQResponse])
async def list_rfqs(
    p2p_request_id: int | None = None,
    status: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    # RFQs behind a PO made from a Before-PO receipt are internal plumbing (RFQ.source), never listed.
    query = apply_scope(db.query(RFQ).options(selectinload(RFQ.attachments)), user, RFQ).filter(
        RFQ.source.is_(None) | (RFQ.source != "before_po"))
    if p2p_request_id:
        query = query.filter(RFQ.p2p_request_id == p2p_request_id)
    if status:
        query = query.filter(RFQ.status == status)
    rfqs = query.order_by(RFQ.created_at.desc()).offset(skip).limit(limit).all()
    return mask_for(user, "rfq", [_to_response(db, r) for r in rfqs])


@router.get("/{rfq_id}", response_model=RFQResponse)
async def get_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
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
    _get_rfq_or_404(db, rfq_id, user)  # 404 / data-scope check
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
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"The linked P2P request cannot enter PO approval from status '{pr.status}'")

    rfq.is_single_quotation = is_single
    rfq.status = "locked"
    rfq.locked_by_id = user.id
    rfq.locked_at = datetime.now(timezone.utc)
    _write_audit(db, rfq.id, "submitted", user, summary=f"{user.name or user.email} submitted and locked RFQ '{rfq.rfq_number}'.")
    pr.status = "vendor_quotations"
    pr.rfq_number = rfq.rfq_number
    _write_pr_audit(db, pr.id, "vendor_quotations_started", user,
                 summary=f"RFQ '{rfq.rfq_number}' was locked and {pr.p2p_number} moved to Vendor Quotations.",
                 old_status="approved", new_status="vendor_quotations")

    db.commit()
    if invites:
        # Email every invited vendor now; failures stay on the invite row (Resend).
        from app.modules.p2p.routes.rfq_invites import send_invites
        await send_invites(db, rfq, invites, user)
    db.refresh(rfq)
    return _to_response(db, rfq)


# ---------------------------------------------------------------------------
# Vendor Quotations -> Quotation Comparison -> Technical Evaluation
# (optional) -> Commercial Evaluation -> Vendor Selection -> PO Draft
# ---------------------------------------------------------------------------

@router.post("/{rfq_id}/vendor-quotations", response_model=VendorQuotationResponse)
async def add_vendor_quotation(
    rfq_id: int,
    payload: VendorQuotationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "create")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_quotations":
        raise HTTPException(status_code=409, detail=f"Vendor quotations can only be recorded while the PR is at 'vendor_quotations' (current status: {pr.status})")

    vq = VendorQuotation(
        rfq_id=rfq.id,
        p2p_request_id=pr.id,
        vendor_id=payload.vendor_id,
        vendor_name=payload.vendor_name,
        quoted_price=payload.quoted_price,
        delivery_time=payload.delivery_time,
        payment_terms=payload.payment_terms,
        remarks=payload.remarks,
        created_by_id=user.id,
    )
    db.add(vq)
    _write_pr_audit(db, pr.id, "vendor_quotation_added", user,
                 summary=f"{user.name or user.email} recorded a quotation from '{payload.vendor_name}' for {pr.p2p_number}.")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.vendor_quote_received(db, background_tasks, rfq, pr, user, payload.vendor_name)
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.get("/{rfq_id}/vendor-quotations", response_model=list[VendorQuotationResponse])
async def list_vendor_quotations(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    """Read-only Quotation Comparison view — every quotation recorded
    against this RFQ, side by side. Not gated on PR status; useful at any
    stage from vendor_quotations through vendor_selected."""
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "view")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    return mask_for(user, "rfq", [_to_vq_response(db, vq) for vq in rfq.vendor_quotations])


@router.patch("/{rfq_id}/vendor-quotations/{vq_id}", response_model=VendorQuotationResponse)
async def update_vendor_quotation(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "edit")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_quotations":
        raise HTTPException(status_code=409, detail=f"A vendor quotation can only be edited while the PR is at 'vendor_quotations' (current status: {pr.status})")
    vq = _get_vendor_quotation_or_404(db, rfq_id, vq_id)

    updates = payload.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(vq, field, val)
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.post("/{rfq_id}/start-technical-evaluation", response_model=RFQResponse)
async def start_technical_evaluation(
    rfq_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "evaluation", "edit")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_quotations":
        raise HTTPException(status_code=409, detail=f"Technical evaluation can only start from 'vendor_quotations' (current status: {pr.status})")
    if not rfq.requires_technical_evaluation:
        raise HTTPException(status_code=409, detail="This RFQ does not require a Technical Evaluation stage — go straight to start-commercial-evaluation")
    if not rfq.vendor_quotations:
        raise HTTPException(status_code=400, detail="At least one vendor quotation is required before evaluation")

    old_status = pr.status
    pr.status = "technical_evaluation"
    _write_pr_audit(db, pr.id, "technical_evaluation_started", user,
                 summary=f"{user.name or user.email} started Technical Evaluation for {pr.p2p_number}.",
                 old_status=old_status, new_status="technical_evaluation")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.rfq_evaluation_waiting(db, background_tasks, rfq, pr, user, "technical")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/technical-evaluation", response_model=VendorQuotationResponse)
async def evaluate_technical(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationEvaluatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "technical_evaluation":
        raise HTTPException(status_code=409, detail=f"Technical evaluation can only be recorded while the PR is at 'technical_evaluation' (current status: {pr.status})")
    if payload.status not in ("qualified", "disqualified"):
        raise HTTPException(status_code=400, detail=f"Invalid technical status '{payload.status}' — must be one of {VENDOR_QUOTATION_TECHNICAL_STATUSES[1:]}")
    # An evaluation is a decision with no named approver: qualifying needs
    # 'Approve' on R.F.Q, disqualifying needs 'Reject'.
    ensure_tab_action(user, "p2p", "rfq", "approve" if payload.status == "qualified" else "reject")
    if payload.status == "qualified":
        ensure_feature_action(user, "p2p", "rfq", "evaluation", "approve")
    else:
        ensure_feature_action(user, "p2p", "rfq", "evaluation", "reject")
    vq = _get_vendor_quotation_or_404(db, rfq_id, vq_id)

    vq.technical_status = payload.status
    vq.technical_remarks = payload.remarks
    vq.technical_evaluated_by_id = user.id
    vq.technical_evaluated_at = datetime.now(timezone.utc)
    _write_pr_audit(db, pr.id, "vendor_quotation_technical_evaluated", user,
                 summary=f"{user.name or user.email} marked '{vq.vendor_name}' as {payload.status} (technical) for {pr.p2p_number}.")
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.post("/{rfq_id}/start-commercial-evaluation", response_model=RFQResponse)
async def start_commercial_evaluation(
    rfq_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "evaluation", "edit")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)

    if rfq.requires_technical_evaluation:
        if pr.status != "technical_evaluation":
            raise HTTPException(status_code=409, detail=f"Commercial evaluation can only start from 'technical_evaluation' for this RFQ (current status: {pr.status})")
        if any(vq.technical_status == "pending" for vq in rfq.vendor_quotations):
            raise HTTPException(status_code=400, detail="Every vendor quotation must be technically evaluated first")
        if not any(vq.technical_status == "qualified" for vq in rfq.vendor_quotations):
            raise HTTPException(status_code=400, detail="At least one vendor quotation must be technically qualified to proceed")
    else:
        if pr.status != "vendor_quotations":
            raise HTTPException(status_code=409, detail=f"Commercial evaluation can only start from 'vendor_quotations' (current status: {pr.status})")
        if not rfq.vendor_quotations:
            raise HTTPException(status_code=400, detail="At least one vendor quotation is required before evaluation")

    old_status = pr.status
    pr.status = "commercial_evaluation"
    _write_pr_audit(db, pr.id, "commercial_evaluation_started", user,
                 summary=f"{user.name or user.email} started Commercial Evaluation for {pr.p2p_number}.",
                 old_status=old_status, new_status="commercial_evaluation")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.rfq_evaluation_waiting(db, background_tasks, rfq, pr, user, "commercial")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/commercial-evaluation", response_model=VendorQuotationResponse)
async def evaluate_commercial(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationEvaluatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "view")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "commercial_evaluation":
        raise HTTPException(status_code=409, detail=f"Commercial evaluation can only be recorded while the PR is at 'commercial_evaluation' (current status: {pr.status})")
    if payload.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail=f"Invalid commercial status '{payload.status}' — must be one of {VENDOR_QUOTATION_COMMERCIAL_STATUSES[1:]}")
    ensure_tab_action(user, "p2p", "rfq", "approve" if payload.status == "approved" else "reject")
    if payload.status == "approved":
        ensure_feature_action(user, "p2p", "rfq", "evaluation", "approve")
    else:
        ensure_feature_action(user, "p2p", "rfq", "evaluation", "reject")
    vq = _get_vendor_quotation_or_404(db, rfq_id, vq_id)
    if rfq.requires_technical_evaluation and vq.technical_status != "qualified":
        raise HTTPException(status_code=409, detail="Only technically qualified vendor quotations can be commercially evaluated")

    vq.commercial_status = payload.status
    vq.commercial_remarks = payload.remarks
    vq.commercial_evaluated_by_id = user.id
    vq.commercial_evaluated_at = datetime.now(timezone.utc)
    _write_pr_audit(db, pr.id, "vendor_quotation_commercial_evaluated", user,
                 summary=f"{user.name or user.email} marked '{vq.vendor_name}' as {payload.status} (commercial) for {pr.p2p_number}.")
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.post("/{rfq_id}/select-vendor-quotation", response_model=RFQResponse)
async def select_vendor_quotation(
    rfq_id: int,
    payload: VendorQuotationSelectPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("rfq", "edit")),
):
    ensure_feature_action(user, "p2p", "rfq", "award", "edit")
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "commercial_evaluation":
        raise HTTPException(status_code=409, detail=f"A vendor can only be selected while the PR is at 'commercial_evaluation' (current status: {pr.status})")

    vq = _get_vendor_quotation_or_404(db, rfq_id, payload.vendor_quotation_id)
    if vq.commercial_status != "approved":
        raise HTTPException(status_code=409, detail="Only a commercially approved vendor quotation can be selected")

    for other in rfq.vendor_quotations:
        other.is_selected = (other.id == vq.id)

    old_status = pr.status
    pr.selected_vendor = vq.vendor_name
    pr.status = "vendor_selected"
    _write_pr_audit(db, pr.id, "vendor_selected", user,
                 summary=f"{user.name or user.email} selected vendor '{vq.vendor_name}' for {pr.p2p_number}.",
                 old_status=old_status, new_status="vendor_selected")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


def _derive_po_total(items) -> float | None:
    """Sum of line totals (qty x unit price + tax), or None while any line is
    still unpriced — a partial sum would understate what's being approved."""
    if not items or any(i.line_total is None for i in items):
        return None
    return round(sum(i.line_total for i in items), 2)


def build_po_draft(db: Session, rfq: RFQ, pr: P2PRequest, user: User, payload: P2PPurchaseOrderCreate) -> P2PPurchaseOrder:
    """Creates an editable draft PO (status='draft') and flushes it; the caller
    commits. Shared by the RFQ route below and the Before-PO receipt route
    (p2p/routes/pre_po_receipts.py), so both apply the same vendor block,
    approved-supplier check, price proposal and terms. Most RFQs go through
    formal vendor selection first (pr.status == 'vendor_selected'), but the
    frontend's current flow also attaches a PO that was already agreed/
    issued outside the system directly from 'vendor_quotations' — the buyer
    supplies vendor_name (and optionally po_number) by hand instead of
    picking a selected VendorQuotation. Line prices are then filled in on the
    draft (PATCH below); submit-po-draft refuses to send it into PO
    approval (p2p/approvals.py) until every line is priced."""
    if pr.status not in ("vendor_quotations", "vendor_selected"):
        raise HTTPException(status_code=409, detail=f"A PO draft can only be created while the PR is at 'vendor_quotations' or 'vendor_selected' (current status: {pr.status})")

    selected = next((vq for vq in rfq.vendor_quotations if vq.is_selected), None)
    # The PO goes to the RFQ quote the buyer picks — L1 (lowest) by default;
    # any other tier must carry a reason (standard control on non-L1 buying).
    tier = (payload.vendor_tier or "L1").upper()
    chosen = next((a for a in rfq.attachments if a.vendor_tier == tier and a.vendor_name), None)
    if payload.vendor_tier and not chosen:
        raise HTTPException(status_code=400, detail=f"There is no {tier} quote on RFQ {rfq.rfq_number} — pick one of the vendors quoted on it.")
    reason = (payload.selection_reason or "").strip()
    if tier != "L1" and not reason:
        raise HTTPException(status_code=400, detail=f"You picked the {tier} vendor instead of L1 (lowest) — give the reason (e.g. L1 can't meet the delivery date).")
    if not selected and chosen:
        payload.vendor_name = chosen.vendor_name
        # Linked to the vendor master → the vendor invoice can be matched to this PO in Finance.
        if chosen.vendor_id:
            payload.vendor_id = chosen.vendor_id
    if not selected and not (payload.vendor_name or "").strip():
        raise HTTPException(status_code=400, detail="A vendor name is required to create the PO")
    # Vendor master posting block: a vendor set Blocked / Inactive in
    # Procurement → Vendors (shared with Finance) gets no new PO.
    _po_vendor_id = selected.vendor_id if selected else payload.vendor_id
    if _po_vendor_id:
        _ensure_vendor_can_get_po(db, _po_vendor_id)

    if payload.po_number:
        if db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == payload.po_number).first():
            raise HTTPException(status_code=409, detail=f"PO number '{payload.po_number}' already exists")
        po_number = payload.po_number
    else:
        po_number = generate_po_number(db)

    po = P2PPurchaseOrder(
        po_number=po_number,
        p2p_request_id=pr.id,
        vendor_id=selected.vendor_id if selected else payload.vendor_id,
        vendor_name=selected.vendor_name if selected else payload.vendor_name,
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

    # PO lines are always the PR's own lines (prices filled on the draft) —
    # each carries its Item Master id forward to the GRN. A free-typed line
    # list is refused: what is ordered must be what was requisitioned.
    # Items already fulfilled from existing store stock (see
    # issue_item_from_stock in p2p_requests.py) are excluded — otherwise the
    # same requirement could be issued from stock AND ordered on a PO.
    if payload.items:
        db.rollback()
        raise HTTPException(status_code=422, detail="A PO's lines come from its requisition's lines — they can't be typed in. "
                                                    "To order something else, raise a requisition for it (picked from the Item Master).")
    source_items = [
        type("Item", (), {
            "store_item_id": i.store_item_id, "item_name": i.item_name, "make": i.make, "part_code": i.part_code,
            "unit": i.unit, "quantity": i.quantity - (i.issued_qty or 0), "unit_price": None, "tax_rate": None,
            "pr_item_id": i.id,
        })()
        for i in pr.items
        if i.fulfillment_status != "stock_issued" and i.quantity - (i.issued_qty or 0) > 0
    ]

    # Quality: a vendor BLOCKED on the approved vendor list gets no PO for
    # those items (services/supplier_quality.ensure_po_allowed).
    from app.modules.quality.services.supplier_quality import ensure_po_allowed, SupplierError
    try:
        ensure_po_allowed(db, po.vendor_name, [i.store_item_id for i in source_items])
    except SupplierError as e:
        db.rollback()
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
            price_source=getattr(item, "price_source", None),
        )
        db.add(po_item)
        po_items.append(po_item)
    # The PO value is always derived from its priced lines — never a typed-in
    # lump sum or the quotation's headline price — because the approvers sign
    # off on it and AP's 3-way match pays against those line prices. Unpriced
    # lines leave it null until the buyer fills them in on the draft.
    po.total_value = _derive_po_total(po_items)

    old_status = pr.status
    pr.status = "po_drafted"
    pr.po_number = po.po_number
    _write_pr_audit(db, pr.id, "po_draft_created", user,
                 summary=f"{user.name or user.email} created draft PO '{po.po_number}' for {pr.p2p_number} to {po.vendor_name} ({tier})."
                         + (f" Reason for not using L1: {reason}" if tier != "L1" else ""),
                 old_status=old_status, new_status="po_drafted")
    return po


@router.post("/{rfq_id}/po-draft", response_model=P2PPurchaseOrderResponse)
async def create_po_draft(
    rfq_id: int,
    payload: P2PPurchaseOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "create")),
):
    """Creates an editable draft PO from the RFQ (see build_po_draft)."""
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    po = build_po_draft(db, rfq, pr, user, payload)
    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


@router.patch("/{rfq_id}/po-draft/{po_id}", response_model=P2PPurchaseOrderResponse)
async def update_po_draft(
    rfq_id: int,
    po_id: int,
    payload: P2PPurchaseOrderDraftUpdatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_purchase_tab("purchase_orders", "edit")),
):
    rfq = _get_rfq_or_404(db, rfq_id, user)
    pr = _get_pr_for_rfq(db, rfq)
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")
    # ME21N split: a PR can carry several POs, so the PO's own status decides.
    if po.status != "draft" or pr.status not in _SPLIT_PO_PR_STATUSES:
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
        from app.modules.p2p.pre_po import po_line_min_quantity
        raised: list[str] = []
        for pricing in payload.items:
            item = items_by_id[pricing.id]
            # Quantity may be raised above the requisition (vendor lot size, spares), never below it.
            if pricing.quantity is not None and abs(pricing.quantity - (item.quantity or 0)) > 1e-9:
                floor = po_line_min_quantity(item, db, lock=True)
                if floor is not None and pricing.quantity < floor - 1e-9:
                    raise HTTPException(status_code=422, detail=(
                        f"{item.item_name}: quantity can't be below {floor:g} {item.unit or 'units'} — that is what the "
                        "requisition asks for. You can only increase it."))
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
    pr = _get_pr_for_rfq(db, rfq)
    po = db.query(P2PPurchaseOrder).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found — it may have been cancelled; reload the page.")
    if po.status != "draft" or pr.status not in _SPLIT_PO_PR_STATUSES:
        raise HTTPException(status_code=409, detail=f"{po.po_number} is no longer a draft, so its Tally PO can't be changed. Raise a PO amendment if the Tally PO changed.")
    ref = (tally_po_no or "").strip()
    if not ref:
        raise HTTPException(status_code=422, detail="Enter the Tally PO number — the voucher number of this PO in Tally.")
    if len(ref) > 100:
        raise HTTPException(status_code=422, detail="The Tally PO number is longer than 100 characters — enter only the voucher number.")
    clash = db.query(P2PPurchaseOrder.po_number).filter(
        P2PPurchaseOrder.id != po.id, P2PPurchaseOrder.status != "cancelled",
        func.upper(P2PPurchaseOrder.external_ref) == ref.upper(),
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail=f"Tally PO {ref} is already on {clash[0]} — check the number in Tally; one Tally PO belongs to one portal PO.")
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

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "po", po.po_number)
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    replaced = po.document_filename
    po.external_ref = ref
    po.document_filename = result["name"]
    po.document_content_type = "application/pdf"
    po.document_size = result["size"]
    po.document_sharepoint_path = result["path"]
    po.document_sharepoint_url = result.get("webUrl")
    po.document_uploaded_by_id = user.id
    po.document_uploaded_at = datetime.now(timezone.utc)

    _write_pr_audit(db, pr.id, "po_document_uploaded", user,
                 summary=(f"{user.name or user.email} uploaded Tally PO {ref} ({result['name']}) for '{po.po_number}'"
                          + (f", replacing {replaced}." if replaced else ".")))

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
    po = db.query(P2PPurchaseOrder).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
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
    pr = _get_pr_for_rfq(db, rfq)
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")
    if po.status != "draft" or pr.status not in _SPLIT_PO_PR_STATUSES:
        raise HTTPException(status_code=409, detail=f"Only a drafted PO on a 'po_drafted' PR can be submitted (current status: {pr.status})")
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
    pr.po_value = po.total_value
    pr.expected_delivery = po.expected_delivery
    pr.ordered_quantity = pr.ordered_quantity if pr.ordered_quantity is not None else sum(i.quantity for i in po.items)
    _write_pr_audit(db, pr.id, "po_raised", user,
                 summary=f"{user.name or user.email} submitted PO '{po.po_number}' for {pr.p2p_number} — entering PO approval.",
                 old_status=old_status, new_status="po_raised")
    # PR → po_raised, PO → issued. The engine resolves and notifies the
    # approvers (bell + Teams; the full-PO email goes after commit), or
    # refuses with the reason when a stage has nobody to approve.
    p2p_approvals.submit_po(db, pr, po, user)
    # ME21N split: the PR's status / value roll up from all its POs.
    from app.modules.p2p.po_split import rollup_pr_status
    rollup_pr_status(db, pr, user.id)

    fire_rule(db, background_tasks, "p2p", "po_raised", "Purchase Order Raised",
              f"PO '{po.po_number}' ({po.vendor_name}, {po.total_value:,.2f}) for PR '{pr.p2p_number}' was sent for approval by {user.name or user.email}.",
              "p2p_request", pr.id, user,
              [("PO", po.po_number), ("Vendor", po.vendor_name or ""), ("Value", f"{po.total_value:,.2f}" if po.total_value else ""),
               ("Requisition", pr.p2p_number), ("By", user.name or user.email)])
    db.commit()
    background_tasks.add_task(_send_p2p_po_approval_emails_background, pr.id)
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


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
