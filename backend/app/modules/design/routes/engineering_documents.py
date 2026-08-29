from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.erp.models.project import Project
from app.modules.design.models.engineering_document import (
    EngineeringDocument, DOCUMENT_DISCIPLINES, DOCUMENT_TYPES, DOCUMENT_STATUSES,
)
from app.modules.design.schemas.engineering_document import (
    EngineeringDocumentResponse, EngineeringDocumentStatusUpdate,
)
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content

router = APIRouter(prefix="/design/documents", tags=["Design"])


def _to_response(db: Session, doc: EngineeringDocument) -> EngineeringDocumentResponse:
    resp = EngineeringDocumentResponse.model_validate(doc)
    project = db.query(Project).filter(Project.id == doc.project_id).first()
    resp.project_label = project.serial_number if project else None
    if doc.uploaded_by_id:
        uploader = db.query(User).filter(User.id == doc.uploaded_by_id).first()
        resp.uploaded_by_name = (uploader.name or uploader.email) if uploader else None
    return resp


@router.get("", response_model=list[EngineeringDocumentResponse])
async def list_documents(
    project_id: int | None = None,
    discipline: str | None = None,
    document_type: str | None = None,
    latest_only: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("design")),
):
    query = db.query(EngineeringDocument)
    if project_id:
        query = query.filter(EngineeringDocument.project_id == project_id)
    if discipline:
        query = query.filter(EngineeringDocument.discipline == discipline)
    if document_type:
        query = query.filter(EngineeringDocument.document_type == document_type)
    docs = query.order_by(EngineeringDocument.created_at.desc()).all()
    if latest_only:
        # Keep only the highest-version doc per (project, discipline, document_type,
        # title) group — a lightweight "latest revision" view for a document list
        # rather than surfacing every historical version by default.
        best: dict[tuple, EngineeringDocument] = {}
        for d in docs:
            key = (d.project_id, d.discipline, d.document_type, d.title)
            if key not in best or d.version > best[key].version:
                best[key] = d
        docs = list(best.values())
    return [_to_response(db, d) for d in docs]


@router.get("/{document_id}/revisions", response_model=list[EngineeringDocumentResponse])
async def revision_history(
    document_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("design")),
):
    doc = db.query(EngineeringDocument).filter(EngineeringDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    siblings = db.query(EngineeringDocument).filter(
        EngineeringDocument.project_id == doc.project_id,
        EngineeringDocument.discipline == doc.discipline,
        EngineeringDocument.document_type == doc.document_type,
        EngineeringDocument.title == doc.title,
    ).order_by(EngineeringDocument.version.desc()).all()
    return [_to_response(db, d) for d in siblings]


@router.post("", response_model=EngineeringDocumentResponse)
async def upload_document(
    project_id: int = Form(...),
    discipline: str = Form(...),
    document_type: str = Form(...),
    title: str = Form(...),
    supersedes_id: int | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    if discipline not in DOCUMENT_DISCIPLINES:
        raise HTTPException(status_code=400, detail=f"Invalid discipline '{discipline}'")
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document_type '{document_type}'")
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    version = 1
    superseded = None
    if supersedes_id:
        superseded = db.query(EngineeringDocument).filter(EngineeringDocument.id == supersedes_id).first()
        if not superseded:
            raise HTTPException(status_code=404, detail="Document being superseded not found")
        version = superseded.version + 1

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "design", project.serial_number or str(project_id))
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    doc = EngineeringDocument(
        project_id=project_id,
        discipline=discipline,
        document_type=document_type,
        title=title,
        version=version,
        status="draft",
        filename=result["name"],
        content_type=file.content_type,
        size=result.get("size"),
        sharepoint_path=result.get("path"),
        sharepoint_url=result.get("webUrl"),
        uploaded_by_id=user.id,
    )
    db.add(doc)
    db.flush()

    if superseded:
        superseded.superseded_by_id = doc.id
        if superseded.status != "superseded":
            superseded.status = "superseded"

    db.commit()
    db.refresh(doc)
    return _to_response(db, doc)


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("design")),
):
    """Raw bytes for in-app preview, fetched via the app-only Graph token —
    never the raw SharePoint webUrl."""
    doc = db.query(EngineeringDocument).filter(EngineeringDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )


@router.patch("/{document_id}/status", response_model=EngineeringDocumentResponse)
async def update_status(
    document_id: int,
    payload: EngineeringDocumentStatusUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("design")),
):
    if payload.status not in DOCUMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")
    doc = db.query(EngineeringDocument).filter(EngineeringDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = payload.status
    db.commit()
    db.refresh(doc)
    return _to_response(db, doc)
