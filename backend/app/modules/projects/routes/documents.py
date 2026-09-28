from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.document import PmProjectDocument, PM_DOCUMENT_TYPES
from app.modules.projects.schemas.document import PmProjectDocumentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

router = APIRouter(
    prefix="/projects/{project_id}/documents", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="documents",
        action=action, performed_by_id=user.id, summary=summary,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_document_or_404(db: Session, project_id: int, document_id: int) -> PmProjectDocument:
    doc = db.query(PmProjectDocument).filter(
        PmProjectDocument.id == document_id, PmProjectDocument.project_id == project_id,
        PmProjectDocument.is_deleted == False,  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} not found on project #{project_id}")
    return doc


@router.get("", response_model=list[PmProjectDocumentResponse])
async def list_documents(
    project_id: int,
    doc_type: str | None = None,
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmProjectDocument).filter(
        PmProjectDocument.project_id == project_id, PmProjectDocument.is_deleted == False,  # noqa: E712
    )
    if doc_type:
        query = query.filter(PmProjectDocument.doc_type == doc_type)
    return query.order_by(PmProjectDocument.id.desc()).all()


@router.post("", response_model=list[PmProjectDocumentResponse])
async def upload_documents(
    project_id: int,
    doc_type: str = Form(...),
    title: str = Form(...),
    version: str | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if doc_type not in PM_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc_type '{doc_type}'. Must be one of {PM_DOCUMENT_TYPES}.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", "Projects", f"projects/{project_id}",
        root_folder="Projects-media",
    )

    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = PmProjectDocument(
            project_id=project_id,
            doc_type=doc_type,
            title=title,
            version=version,
            file_name=result["name"],
            file_path=result["path"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            file_size=result["size"],
            mime_type=f.content_type,
            description=description,
            uploaded_by_id=user.id,
            uploaded_by_name=user.name or user.email,
        )
        db.add(doc)
        documents.append(doc)

    if documents:
        db.flush()
        for d in documents:
            db.refresh(d)
        _write_audit(db, project_id, "created", user, summary=f"{len(documents)} document(s) uploaded by {user.name or user.email}.")

    db.commit()
    return documents


@router.get("/{document_id}/content")
async def get_document_content(
    project_id: int,
    document_id: int,
    db: Session = Depends(get_db),
):
    """Raw bytes for in-app viewing (img/pdf tags, or a same-origin
    download), fetched via the app-only Graph token — never the raw
    SharePoint webUrl, same pattern as crm/routes/documents.py and
    quality/routes/documents.py."""
    doc = _get_document_or_404(db, project_id, document_id)
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
    project_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    doc = _get_document_or_404(db, project_id, document_id)
    if not (user.role == "admin" or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can delete this document.")

    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    _write_audit(db, project_id, "deleted", user, summary=f"Document '{doc.title}' deleted by {user.name or user.email}.")
    db.commit()
    return {"message": "Document deleted"}
