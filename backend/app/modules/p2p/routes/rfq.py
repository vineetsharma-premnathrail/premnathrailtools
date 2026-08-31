from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access
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
from app.modules.vendor.models.vendor import Vendor
from app.modules.p2p.schemas.rfq import (
    RFQCreate, RFQUpdate, RFQResponse, RFQAttachmentResponse,
    VendorQuotationCreate, VendorQuotationUpdate, VendorQuotationEvaluatePayload,
    VendorQuotationSelectPayload, VendorQuotationResponse,
)
from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderCreate, P2PPurchaseOrderUpdate, P2PPurchaseOrderResponse
from app.modules.p2p.service import generate_rfq_number, generate_po_number, compute_line_total
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P"])


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _write_audit(db: Session, rfq_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="rfq", entity_id=rfq_id, action=action, performed_by_id=user.id, summary=summary))


def _get_rfq_or_404(db: Session, rfq_id: int) -> RFQ:
    rfq = db.query(RFQ).options(
        selectinload(RFQ.attachments), selectinload(RFQ.vendor_quotations),
    ).filter(RFQ.id == rfq_id).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
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
    if rfq.created_by_id:
        creator = db.query(User).filter(User.id == rfq.created_by_id).first()
        if creator:
            resp.created_by_name = creator.name or creator.email
    return resp


@router.post("", response_model=RFQResponse)
async def create_rfq(
    payload: RFQCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(P2PRequest).filter(P2PRequest.id == payload.p2p_request_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="P2P request not found")
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"An RFQ can only be raised on an approved PR (current status: {pr.status})")

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
    user: User = Depends(require_app_access("purchase")),
):
    query = db.query(RFQ).options(selectinload(RFQ.attachments))
    if p2p_request_id:
        query = query.filter(RFQ.p2p_request_id == p2p_request_id)
    if status:
        query = query.filter(RFQ.status == status)
    rfqs = query.order_by(RFQ.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, r) for r in rfqs]


@router.get("/{rfq_id}", response_model=RFQResponse)
async def get_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    return _to_response(db, rfq)


@router.patch("/{rfq_id}", response_model=RFQResponse)
async def update_rfq(
    rfq_id: int,
    payload: RFQUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
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
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    _assert_editable(rfq, user)
    if vendor_tier not in RFQ_VENDOR_TIERS:
        raise HTTPException(status_code=400, detail=f"Invalid vendor_tier '{vendor_tier}' — must be one of {RFQ_VENDOR_TIERS}")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "rfq", rfq.rfq_number)

    saved: list[RFQAttachment] = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        attachment = RFQAttachment(
            rfq_id=rfq.id,
            vendor_tier=vendor_tier,
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


@router.get("/{rfq_id}/attachments/{attachment_id}/content")
async def get_rfq_attachment_content(
    rfq_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Raw bytes for in-app preview, fetched via the app-only Graph token —
    never the raw SharePoint webUrl."""
    rfq = _get_rfq_or_404(db, rfq_id)
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


@router.delete("/{rfq_id}/attachments/{attachment_id}")
async def delete_rfq_attachment(
    rfq_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    _assert_editable(rfq, user)

    attachment = db.query(RFQAttachment).filter(
        RFQAttachment.id == attachment_id, RFQAttachment.rfq_id == rfq_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}


@router.post("/{rfq_id}/submit", response_model=RFQResponse)
async def submit_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Locks the RFQ — no further edits except by an admin. Validates the
    single-quotation and commercial-terms rules before locking."""
    rfq = _get_rfq_or_404(db, rfq_id)
    _assert_editable(rfq, user)

    tiers_present = {a.vendor_tier for a in rfq.attachments}
    if not tiers_present:
        raise HTTPException(status_code=400, detail="At least one vendor quotation (L1) attachment is required")
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
    if not rfq.ld_clause:
        raise HTTPException(status_code=400, detail="LD clause is required")

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
    _write_audit(db, pr.id, "vendor_quotations_started", user,
                 summary=f"RFQ '{rfq.rfq_number}' was locked and {pr.p2p_number} moved to Vendor Quotations.",
                 old_status="approved", new_status="vendor_quotations")

    db.commit()
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
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_quotations":
        raise HTTPException(status_code=409, detail=f"Vendor quotations can only be recorded while the PR is at 'vendor_quotations' (current status: {pr.status})")

    if payload.vendor_id:
        vendor = db.query(Vendor).filter(Vendor.id == payload.vendor_id).first()
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")

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
    _write_audit(db, pr.id, "vendor_quotation_added", user,
                 summary=f"{user.name or user.email} recorded a quotation from '{payload.vendor_name}' for {pr.p2p_number}.")
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.get("/{rfq_id}/vendor-quotations", response_model=list[VendorQuotationResponse])
async def list_vendor_quotations(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Read-only Quotation Comparison view — every quotation recorded
    against this RFQ, side by side. Not gated on PR status; useful at any
    stage from vendor_quotations through vendor_selected."""
    rfq = _get_rfq_or_404(db, rfq_id)
    return [_to_vq_response(db, vq) for vq in rfq.vendor_quotations]


@router.patch("/{rfq_id}/vendor-quotations/{vq_id}", response_model=VendorQuotationResponse)
async def update_vendor_quotation(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
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
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_quotations":
        raise HTTPException(status_code=409, detail=f"Technical evaluation can only start from 'vendor_quotations' (current status: {pr.status})")
    if not rfq.requires_technical_evaluation:
        raise HTTPException(status_code=409, detail="This RFQ does not require a Technical Evaluation stage — go straight to start-commercial-evaluation")
    if not rfq.vendor_quotations:
        raise HTTPException(status_code=400, detail="At least one vendor quotation is required before evaluation")

    old_status = pr.status
    pr.status = "technical_evaluation"
    _write_audit(db, pr.id, "technical_evaluation_started", user,
                 summary=f"{user.name or user.email} started Technical Evaluation for {pr.p2p_number}.",
                 old_status=old_status, new_status="technical_evaluation")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/technical-evaluation", response_model=VendorQuotationResponse)
async def evaluate_technical(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationEvaluatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "technical_evaluation":
        raise HTTPException(status_code=409, detail=f"Technical evaluation can only be recorded while the PR is at 'technical_evaluation' (current status: {pr.status})")
    if payload.status not in ("qualified", "disqualified"):
        raise HTTPException(status_code=400, detail=f"Invalid technical status '{payload.status}' — must be one of {VENDOR_QUOTATION_TECHNICAL_STATUSES[1:]}")
    vq = _get_vendor_quotation_or_404(db, rfq_id, vq_id)

    vq.technical_status = payload.status
    vq.technical_remarks = payload.remarks
    vq.technical_evaluated_by_id = user.id
    vq.technical_evaluated_at = datetime.now(timezone.utc)
    _write_audit(db, pr.id, "vendor_quotation_technical_evaluated", user,
                 summary=f"{user.name or user.email} marked '{vq.vendor_name}' as {payload.status} (technical) for {pr.p2p_number}.")
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.post("/{rfq_id}/start-commercial-evaluation", response_model=RFQResponse)
async def start_commercial_evaluation(
    rfq_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
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
    _write_audit(db, pr.id, "commercial_evaluation_started", user,
                 summary=f"{user.name or user.email} started Commercial Evaluation for {pr.p2p_number}.",
                 old_status=old_status, new_status="commercial_evaluation")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/vendor-quotations/{vq_id}/commercial-evaluation", response_model=VendorQuotationResponse)
async def evaluate_commercial(
    rfq_id: int,
    vq_id: int,
    payload: VendorQuotationEvaluatePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "commercial_evaluation":
        raise HTTPException(status_code=409, detail=f"Commercial evaluation can only be recorded while the PR is at 'commercial_evaluation' (current status: {pr.status})")
    if payload.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail=f"Invalid commercial status '{payload.status}' — must be one of {VENDOR_QUOTATION_COMMERCIAL_STATUSES[1:]}")
    vq = _get_vendor_quotation_or_404(db, rfq_id, vq_id)
    if rfq.requires_technical_evaluation and vq.technical_status != "qualified":
        raise HTTPException(status_code=409, detail="Only technically qualified vendor quotations can be commercially evaluated")

    vq.commercial_status = payload.status
    vq.commercial_remarks = payload.remarks
    vq.commercial_evaluated_by_id = user.id
    vq.commercial_evaluated_at = datetime.now(timezone.utc)
    _write_audit(db, pr.id, "vendor_quotation_commercial_evaluated", user,
                 summary=f"{user.name or user.email} marked '{vq.vendor_name}' as {payload.status} (commercial) for {pr.p2p_number}.")
    db.commit()
    db.refresh(vq)
    return _to_vq_response(db, vq)


@router.post("/{rfq_id}/select-vendor-quotation", response_model=RFQResponse)
async def select_vendor_quotation(
    rfq_id: int,
    payload: VendorQuotationSelectPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
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
    _write_audit(db, pr.id, "vendor_selected", user,
                 summary=f"{user.name or user.email} selected vendor '{vq.vendor_name}' for {pr.p2p_number}.",
                 old_status=old_status, new_status="vendor_selected")
    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)


@router.post("/{rfq_id}/po-draft", response_model=P2PPurchaseOrderResponse)
async def create_po_draft(
    rfq_id: int,
    payload: P2PPurchaseOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Creates an editable draft PO (status='draft') from the selected
    vendor's quotation. Still requires the existing submit-po-draft step
    before it enters the unchanged Purchase Head -> Director -> MD approval
    chain (see p2p_requests.py approve_po)."""
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    if pr.status != "vendor_selected":
        raise HTTPException(status_code=409, detail=f"A PO draft can only be created once a vendor is selected (current status: {pr.status})")

    selected = next((vq for vq in rfq.vendor_quotations if vq.is_selected), None)
    if not selected:
        raise HTTPException(status_code=409, detail="No vendor quotation has been selected for this RFQ")

    po = P2PPurchaseOrder(
        po_number=generate_po_number(db),
        p2p_request_id=pr.id,
        vendor_id=selected.vendor_id,
        vendor_name=selected.vendor_name,
        status="draft",
        po_date=payload.po_date or date.today(),
        expected_delivery=payload.expected_delivery,
        delivery_terms=payload.delivery_terms or selected.payment_terms,
        created_by_id=user.id,
    )
    db.add(po)
    db.flush()

    # Default to the PR's own line items (editable afterwards) when the
    # buyer doesn't supply an explicit item breakdown.
    source_items = payload.items if payload.items else [
        type("Item", (), {
            "item_name": i.item_name, "make": i.make, "part_code": i.part_code,
            "unit": i.unit, "quantity": i.quantity, "unit_price": None, "tax_rate": None,
        })()
        for i in pr.items
    ]

    total = 0.0
    has_pricing = False
    for item in source_items:
        line_total = compute_line_total(item.quantity, item.unit_price, item.tax_rate)
        if line_total is not None:
            has_pricing = True
            total += line_total
        db.add(P2PPurchaseOrderItem(
            purchase_order_id=po.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            unit_price=item.unit_price,
            tax_rate=item.tax_rate,
            line_total=line_total,
        ))
    po.total_value = round(total, 2) if has_pricing else selected.quoted_price

    old_status = pr.status
    pr.status = "po_drafted"
    pr.po_number = po.po_number
    _write_audit(db, pr.id, "po_draft_created", user,
                 summary=f"{user.name or user.email} created draft PO '{po.po_number}' for {pr.p2p_number}.",
                 old_status=old_status, new_status="po_drafted")

    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


@router.patch("/{rfq_id}/po-draft/{po_id}", response_model=P2PPurchaseOrderResponse)
async def update_po_draft(
    rfq_id: int,
    po_id: int,
    payload: P2PPurchaseOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")
    if pr.status != "po_drafted" or po.status != "draft":
        raise HTTPException(status_code=409, detail="This PO draft is no longer editable")

    updates = payload.model_dump(exclude_unset=True)
    updates.pop("status", None)  # status transition happens via the submit route below
    for field, val in updates.items():
        setattr(po, field, val)

    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp


@router.post("/{rfq_id}/po-draft/{po_id}/submit", response_model=P2PPurchaseOrderResponse)
async def submit_po_draft(
    rfq_id: int,
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Finalizes the draft PO and hands the PR off to the existing,
    unchanged PO approval chain (Purchase Head -> Director -> MD)."""
    rfq = _get_rfq_or_404(db, rfq_id)
    pr = _get_pr_for_rfq(db, rfq)
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.id == po_id, P2PPurchaseOrder.p2p_request_id == pr.id
    ).first()
    if not po:
        raise HTTPException(status_code=404, detail="Draft PO not found")
    if pr.status != "po_drafted" or po.status != "draft":
        raise HTTPException(status_code=409, detail=f"Only a drafted PO on a 'po_drafted' PR can be submitted (current status: {pr.status})")

    old_status = pr.status
    po.status = "issued"
    pr.status = "po_raised"
    pr.po_date = po.po_date
    pr.po_value = po.total_value
    pr.expected_delivery = po.expected_delivery
    pr.ordered_quantity = pr.ordered_quantity if pr.ordered_quantity is not None else sum(i.quantity for i in po.items)
    _write_audit(db, pr.id, "po_raised", user,
                 summary=f"{user.name or user.email} submitted PO '{po.po_number}' for {pr.p2p_number} — entering PO approval.",
                 old_status=old_status, new_status="po_raised")

    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp
