from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_any_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.maintenance.models.attachment import (
    MaintenanceAttachment, MAINTENANCE_ATTACHMENT_ENTITIES, MAINTENANCE_ATTACHMENT_DOC_TYPES,
)
from app.modules.maintenance.schemas.attachment import MaintenanceAttachmentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint, download_file_content,
)

# Requesters attach breakdown photos to their own requests, so this router
# accepts production users too; everything else is checked per entity below.
router = APIRouter(
    prefix="/maintenance/attachments", tags=["Maintenance"],
    dependencies=[Depends(require_any_app_access("maintenance", "production"))],
)

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so maintenance attachments can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


def _resolve(db: Session, entity_type: str, entity_id: int, user: User) -> str:
    """Checks the entity exists and the user may touch it; returns its
    reference number (used as the SharePoint sub-folder)."""
    if entity_type not in MAINTENANCE_ATTACHMENT_ENTITIES:
        raise HTTPException(status_code=400, detail=f"Invalid entity type '{entity_type}'. Valid: {', '.join(MAINTENANCE_ATTACHMENT_ENTITIES)}.")
    is_maint = "maintenance" in user.get_apps()
    if entity_type == "request":
        req = db.query(MaintenanceRequest).filter(MaintenanceRequest.id == entity_id).first()
        if not req:
            raise HTTPException(status_code=404, detail=f"Maintenance request #{entity_id} not found.")
        if not is_maint and req.raised_by_id != user.id:
            raise HTTPException(status_code=403, detail="You can only attach files to requests you raised.")
        return req.request_number
    if not is_maint:
        raise HTTPException(status_code=403, detail="Only the Maintenance team can manage asset and work-order attachments.")
    if entity_type == "asset":
        asset = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == entity_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
        if not asset:
            raise HTTPException(status_code=404, detail=f"Asset #{entity_id} not found.")
        return asset.asset_code
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == entity_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Work order #{entity_id} not found.")
    return wo.wo_number


def _get_or_404(db: Session, attachment_id: int) -> MaintenanceAttachment:
    att = db.query(MaintenanceAttachment).filter(MaintenanceAttachment.id == attachment_id, MaintenanceAttachment.is_deleted == False).first()  # noqa: E712
    if not att:
        raise HTTPException(status_code=404, detail=f"Attachment #{attachment_id} not found (it may have been deleted).")
    return att


@router.get("", response_model=list[MaintenanceAttachmentResponse])
async def list_attachments(
    entity_type: str, entity_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    _resolve(db, entity_type, entity_id, user)
    return db.query(MaintenanceAttachment).filter(
        MaintenanceAttachment.entity_type == entity_type, MaintenanceAttachment.entity_id == entity_id,
        MaintenanceAttachment.is_deleted == False,  # noqa: E712
    ).order_by(MaintenanceAttachment.id.desc()).all()


@router.post("", response_model=list[MaintenanceAttachmentResponse])
async def upload_attachments(
    entity_type: str = Form(...),
    entity_id: int = Form(...),
    doc_type: str = Form("other"),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    if doc_type not in MAINTENANCE_ATTACHMENT_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document type '{doc_type}'. Valid: {', '.join(MAINTENANCE_ATTACHMENT_DOC_TYPES)}.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    ref = _resolve(db, entity_type, entity_id, user)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    folder = build_sharepoint_folder_path(user.name or user.email or "", "Maintenance", f"{entity_type}/{ref}", root_folder="Maintenance-media")
    rows = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        att = MaintenanceAttachment(
            entity_type=entity_type, entity_id=entity_id, doc_type=doc_type,
            filename=result["name"], content_type=f.content_type, size=result.get("size"),
            sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
            created_by_id=user.id, created_by_name=user.name or user.email,
        )
        db.add(att)
        rows.append(att)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


@router.get("/{attachment_id}/content")
async def get_attachment_content(
    attachment_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    att = _get_or_404(db, attachment_id)
    _resolve(db, att.entity_type, att.entity_id, user)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, att.sharepoint_path or "")
    return Response(content=content, media_type=att.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{att.filename}"'})


@router.delete("/{attachment_id}")
async def delete_attachment(
    attachment_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_any_app_access("maintenance", "production")),
):
    att = _get_or_404(db, attachment_id)
    _resolve(db, att.entity_type, att.entity_id, user)
    if not (user.role == "admin" or att.created_by_id == user.id):
        raise HTTPException(status_code=403, detail=f"Only the uploader ({att.created_by_name or 'unknown'}) or an admin can delete this file.")
    if settings.SHAREPOINT_SITE_ID and att.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, att.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    att.is_deleted = True
    att.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{att.filename}' deleted"}
