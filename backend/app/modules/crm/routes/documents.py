from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.routes.auth import get_current_user
from app.modules.main.models.user import User
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.organization import Organization
from app.modules.crm.schemas.document import CrmDocumentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

router = APIRouter(prefix="/crm/documents", tags=["CRM - Documents"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("", response_model=list[CrmDocumentResponse])
async def list_documents(
    related_module: str,
    related_id: int,
    related_sub_module: str | None = None,
    related_sub_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(CrmDocument).filter(
        CrmDocument.related_module == related_module,
        CrmDocument.related_id == related_id,
        CrmDocument.is_deleted == False,  # noqa: E712
    )
    if related_sub_module:
        query = query.filter(CrmDocument.related_sub_module == related_sub_module)
    if related_sub_id:
        query = query.filter(CrmDocument.related_sub_id == related_sub_id)
    return query.order_by(CrmDocument.id.desc()).all()


@router.post("", response_model=list[CrmDocumentResponse])
async def upload_documents(
    related_module: str = Form(...),
    related_id: int = Form(...),
    folder_type: str = Form(...),
    doc_category: str | None = Form(None),
    related_sub_module: str | None = Form(None),
    related_sub_id: int | None = Form(None),
    universal_id: str | None = Form(None),
    org_id: int | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    org_name = "General"
    if org_id:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if org:
            org_name = org.name

    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", org_name, f"crm/{related_module}/{universal_id or related_id}",
        root_folder="CRM-media",
    )

    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = CrmDocument(
            related_module=related_module,
            related_id=related_id,
            related_sub_module=related_sub_module,
            related_sub_id=related_sub_id,
            universal_id=universal_id,
            folder_type=folder_type,
            doc_category=doc_category,
            file_name=result["name"],
            file_path=result["path"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            file_size=result["size"],
            mime_type=f.content_type,
            description=description,
            uploaded_by_name=user.name or user.email,
            org_id=org_id,
            created_by_id=user.id,
        )
        db.add(doc)
        documents.append(doc)

    if documents:
        db.flush()
        for d in documents:
            db.refresh(d)
    db.commit()
    return documents


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Raw bytes for in-app viewing (img/pdf tags, or a same-origin download),
    fetched via the app-only Graph token — never the raw SharePoint webUrl,
    which bypasses our own auth and exposes the SharePoint folder structure
    to anyone who has or guesses the link.

    Access check: normal CRM documents still require the 'crm' module grant.
    Technical Offer Request PDFs are the one exception — they're emailed
    cross-department (to R&D, who may not have 'crm' access at all), so any
    logged-in portal user can fetch one *by its specific id*. That's narrower
    than opening module access wide: you still need the id from a real email,
    the doc list/other CRM data stays behind the normal 'crm' gate."""
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.doc_category != "technical_offer_request" and user.role != "admin" and "crm" not in user.get_apps():
        raise HTTPException(status_code=403, detail="Access to 'crm' module required")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.mime_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not _can_modify(doc, user):
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can delete this document.")

    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Document deleted"}
