from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_material_attachment import ServiceMaterialAttachment
from app.modules.purchase.models.purchase_requisition import PurchaseRequisition, PR_STATUSES
from app.modules.purchase.models.purchase_requisition_item import PurchaseRequisitionItem
from app.modules.purchase.schemas.purchase_requisition import (
    PurchaseRequisitionResponse,
    PurchaseRequisitionUpdate,
    PurchaseRequisitionActionPayload,
    PurchaseRequisitionItemUpdate,
    PurchaseRequisitionItemResponse,
    PurchaseRequisitionItemAttachmentResponse,
)
from app.modules.purchase.service import sync_material_pr_fields, unlink_materials
from app.utils.notifications import broadcast_notification, notify_user
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint

router = APIRouter(prefix="/purchase/requisitions", tags=["Purchase"])


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="purchase_requisition", entity_id=pr_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(db: Session, pr: PurchaseRequisition) -> PurchaseRequisitionResponse:
    project = db.query(Project).filter(Project.id == pr.project_id).first()
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    resp = PurchaseRequisitionResponse.model_validate(pr)
    if project:
        resp.project_label = f"{project.serial_number} — {project.model_name}" if project.model_name else project.serial_number
        resp.client_company = project.client_company
        resp.site_name = project.site_name
    if sr:
        resp.sr_request_number = sr.request_number

    # Photos live on the underlying ServiceMaterial (same gallery the ERP side
    # uploads to) — surface them read/write from the PR item too, so Purchase
    # doesn't need to jump into the Service Request to view/add material photos.
    material_ids = [item.service_material_id for item in pr.items]
    materials_by_id: dict[int, ServiceMaterial] = {}
    if material_ids:
        materials = db.query(ServiceMaterial).options(selectinload(ServiceMaterial.attachments)).filter(
            ServiceMaterial.id.in_(material_ids)
        ).all()
        materials_by_id = {m.id: m for m in materials}
    for item_resp in resp.items:
        material = materials_by_id.get(item_resp.service_material_id)
        if material:
            item_resp.attachments = [
                PurchaseRequisitionItemAttachmentResponse.model_validate(a) for a in material.attachments
            ]
    return resp


@router.get("", response_model=list[PurchaseRequisitionResponse])
async def list_requisitions(
    status: str | None = None,
    project_id: int | None = None,
    service_request_id: int | None = None,
    search: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    query = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items))
    if status:
        query = query.filter(PurchaseRequisition.status == status)
    if project_id:
        query = query.filter(PurchaseRequisition.project_id == project_id)
    if service_request_id:
        query = query.filter(PurchaseRequisition.service_request_id == service_request_id)
    if search:
        query = query.filter(PurchaseRequisition.pr_number.ilike(f"%{search}%"))

    prs = query.order_by(PurchaseRequisition.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, pr) for pr in prs]


@router.get("/{pr_id}", response_model=PurchaseRequisitionResponse)
async def get_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    return _to_response(db, pr)


@router.get("/{pr_id}/audit")
async def get_requisition_audit(
    pr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "purchase_requisition", AuditLog.entity_id == pr_id
    ).order_by(AuditLog.performed_at.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


@router.patch("/{pr_id}", response_model=PurchaseRequisitionResponse)
async def update_requisition(
    pr_id: int,
    payload: PurchaseRequisitionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Update vendor/PO/delivery-date details, and/or manually override the status.

    A manual `status` override is allowed from and to any status (including
    reopening a closed/rejected/cancelled PR) — it's an explicit admin action,
    distinct from the guided approve/reject/cancel/close workflow below."""
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")

    updates = payload.model_dump(exclude_unset=True)
    new_status = updates.pop("status", None)

    if updates and pr.status in ("closed", "rejected", "cancelled") and new_status is None:
        raise HTTPException(status_code=409, detail=f"Cannot edit a {pr.status} purchase requisition")

    for field, val in updates.items():
        setattr(pr, field, val)

    if updates.get("po_number") and pr.status == "approved":
        pr.status = "po_raised"
        sync_material_pr_fields(db, pr)

    if new_status and new_status != pr.status:
        if new_status not in PR_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
        old_status = pr.status
        pr.status = new_status
        if new_status == "approved" and not pr.approved_by_id:
            pr.approved_by_id = user.id
            pr.approved_at = datetime.now(timezone.utc)
        if new_status == "closed" and not pr.closed_by_id:
            pr.closed_by_id = user.id
            pr.closed_at = datetime.now(timezone.utc)
        sync_material_pr_fields(db, pr)
        _write_audit(db, pr.id, "status_changed", user, summary=f"{user.name or user.email} manually changed status of {pr.pr_number} from '{old_status}' to '{new_status}'.")

    if updates:
        _write_audit(db, pr.id, "updated", user, summary=f"{user.name or user.email} updated purchase requisition {pr.pr_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.patch("/{pr_id}/items/{item_id}", response_model=PurchaseRequisitionResponse)
async def update_requisition_item(
    pr_id: int,
    item_id: int,
    payload: PurchaseRequisitionItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    item = db.query(PurchaseRequisitionItem).filter(
        PurchaseRequisitionItem.id == item_id, PurchaseRequisitionItem.purchase_requisition_id == pr_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Purchase requisition item not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(item, field, val)

    if updates:
        _write_audit(db, pr.id, "item_updated", user, summary=f"{user.name or user.email} updated remarks on '{item.material_name}' in {pr.pr_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


# ── Material photos (shared gallery with the underlying ServiceMaterial) ───

@router.post("/{pr_id}/items/{item_id}/attachments", response_model=PurchaseRequisitionResponse)
async def upload_item_attachments(
    pr_id: int,
    item_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    item = db.query(PurchaseRequisitionItem).filter(
        PurchaseRequisitionItem.id == item_id, PurchaseRequisitionItem.purchase_requisition_id == pr_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Purchase requisition item not found")
    material = db.query(ServiceMaterial).filter(ServiceMaterial.id == item.service_material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Linked service material not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is not an image — only photos can be attached to a material.")

    project = db.query(Project).filter(Project.id == pr.project_id).first()
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    project_name = (project.serial_number or project.model_name or str(pr.project_id)) if project else str(pr.project_id)
    request_number = sr.request_number if sr else pr.pr_number
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", project_name, request_number) + "/materials"

    uploaded, failed = [], []
    for f in files:
        try:
            result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
            attachment = ServiceMaterialAttachment(
                service_material_id=material.id,
                filename=result["name"],
                content_type=f.content_type,
                size=result["size"],
                sharepoint_path=result["path"],
                sharepoint_url=result.get("webUrl"),
                created_by_id=user.id,
            )
            db.add(attachment)
            uploaded.append(attachment)
        except HTTPException as exc:
            failed.append({"filename": f.filename or "photo", "error": exc.detail})

    if not uploaded and failed:
        raise HTTPException(status_code=502, detail=failed[0]["error"])

    if uploaded:
        _write_audit(db, pr.id, "item_photo_uploaded", user, summary=f"{user.name or user.email} added {len(uploaded)} photo(s) to '{item.material_name}' in {pr.pr_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.delete("/{pr_id}/items/{item_id}/attachments/{attachment_id}", response_model=PurchaseRequisitionResponse)
async def delete_item_attachment(
    pr_id: int,
    item_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    item = db.query(PurchaseRequisitionItem).filter(
        PurchaseRequisitionItem.id == item_id, PurchaseRequisitionItem.purchase_requisition_id == pr_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Purchase requisition item not found")

    attachment = db.query(ServiceMaterialAttachment).filter(
        ServiceMaterialAttachment.id == attachment_id, ServiceMaterialAttachment.service_material_id == item.service_material_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Photo not found")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    db.delete(attachment)
    _write_audit(db, pr.id, "item_photo_deleted", user, summary=f"{user.name or user.email} removed a photo from '{item.material_name}' in {pr.pr_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/approve", response_model=PurchaseRequisitionResponse)
async def approve_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Only a submitted PR can be approved (current status: {pr.status})")

    pr.status = "approved"
    pr.approved_by_id = user.id
    pr.approved_at = datetime.now(timezone.utc)
    sync_material_pr_fields(db, pr)
    _write_audit(db, pr.id, "approved", user, summary=f"{user.name or user.email} approved purchase requisition {pr.pr_number}.")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr and sr.created_by_id:
        notify_user(
            db, user_id=sr.created_by_id,
            title="Purchase Requisition Approved",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' was approved by {user.name or user.email}.",
            notification_type="pr_approved", entity_type="purchase_requisition", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/reject", response_model=PurchaseRequisitionResponse)
async def reject_requisition(
    pr_id: int,
    payload: PurchaseRequisitionActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status not in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a PR with status '{pr.status}'")

    pr.status = "rejected"
    unlink_materials(db, pr)
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "rejected", user, summary=f"{user.name or user.email} rejected purchase requisition {pr.pr_number}.{reason_note}")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr and sr.created_by_id:
        notify_user(
            db, user_id=sr.created_by_id,
            title="Purchase Requisition Rejected",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' was rejected by {user.name or user.email}.{reason_note}",
            notification_type="pr_rejected", entity_type="purchase_requisition", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/cancel", response_model=PurchaseRequisitionResponse)
async def cancel_requisition(
    pr_id: int,
    payload: PurchaseRequisitionActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status in ("closed", "rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel a PR with status '{pr.status}'")

    pr.status = "cancelled"
    unlink_materials(db, pr)
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "cancelled", user, summary=f"{user.name or user.email} cancelled purchase requisition {pr.pr_number}.{reason_note}")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/close", response_model=PurchaseRequisitionResponse)
async def close_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != "received":
        raise HTTPException(status_code=409, detail="A purchase requisition can only be closed once every item has been received.")

    pr.status = "closed"
    pr.closed_by_id = user.id
    pr.closed_at = datetime.now(timezone.utc)
    sync_material_pr_fields(db, pr)
    _write_audit(db, pr.id, "closed", user, summary=f"{user.name or user.email} closed purchase requisition {pr.pr_number}.")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr:
        broadcast_notification(
            db,
            title="Purchase Requisition Closed",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' has been closed by {user.name or user.email}.",
            notification_type="pr_closed", entity_type="purchase_requisition", entity_id=pr.id,
            exclude_user_id=user.id, app_name="erp",
        )
        if sr.created_by_id and sr.created_by_id != user.id:
            notify_user(
                db, user_id=sr.created_by_id,
                title="Purchase Requisition Closed",
                message=f"PR '{pr.pr_number}' on your SR '{sr.request_number}' has been closed by {user.name or user.email}.",
                notification_type="pr_closed", entity_type="purchase_requisition", entity_id=pr.id,
            )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)
