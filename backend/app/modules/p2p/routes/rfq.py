from datetime import datetime, timezone
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
from app.modules.p2p.schemas.rfq import RFQCreate, RFQUpdate, RFQResponse, RFQAttachmentResponse
from app.modules.p2p.service import generate_rfq_number
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P"])


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _write_audit(db: Session, rfq_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="rfq", entity_id=rfq_id, action=action, performed_by_id=user.id, summary=summary))


def _get_rfq_or_404(db: Session, rfq_id: int) -> RFQ:
    rfq = db.query(RFQ).options(selectinload(RFQ.attachments)).filter(RFQ.id == rfq_id).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    return rfq


def _assert_editable(rfq: RFQ, user: User) -> None:
    if rfq.status != "draft" and not _is_admin(user):
        raise HTTPException(status_code=409, detail="This RFQ has been submitted and is locked. Only an admin can edit it.")


def _to_response(db: Session, rfq: RFQ) -> RFQResponse:
    resp = RFQResponse.model_validate(rfq)
    pr = db.query(P2PRequest).filter(P2PRequest.id == rfq.p2p_request_id).first()
    if pr:
        resp.p2p_number = pr.p2p_number
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
    pr.status = "po_raised"
    pr.rfq_number = rfq.rfq_number
    _write_audit(db, pr.id, "po_approval_started", user,
                 summary=f"RFQ '{rfq.rfq_number}' was locked and {pr.p2p_number} moved to PO approval.",
                 old_status="approved", new_status="po_raised")

    db.commit()
    db.refresh(rfq)
    return _to_response(db, rfq)
