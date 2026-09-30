from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype
from app.modules.rnd.models.document import RndDocument, RND_DOCUMENT_TYPES
from app.modules.rnd.schemas.document import RndDocumentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

# Documents show up inside project / experiment / prototype pages as well as
# on their own tab, so this is gated on the R&D app only — not on a subtab —
# otherwise a user without the Documents tab would get 403s on a project page.
router = APIRouter(
    prefix="/documents", tags=["RnD Documents"],
    dependencies=[Depends(require_app_access("rnd"))],
)

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so R&D documents can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


def _to_response(db: Session, doc: RndDocument) -> RndDocumentResponse:
    resp = RndDocumentResponse.model_validate(doc)
    project = db.query(RndProject.project_number).filter(RndProject.id == doc.project_id).first()
    resp.project_number = project[0] if project else None
    if doc.experiment_id:
        exp = db.query(RndExperiment.experiment_number).filter(RndExperiment.id == doc.experiment_id).first()
        resp.experiment_number = exp[0] if exp else None
    if doc.prototype_id:
        proto = db.query(RndPrototype.prototype_number).filter(RndPrototype.id == doc.prototype_id).first()
        resp.prototype_number = proto[0] if proto else None
    return resp


def _get_or_404(db: Session, document_id: int) -> RndDocument:
    doc = db.query(RndDocument).filter(RndDocument.id == document_id, RndDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"R&D document #{document_id} not found (it may have been deleted).")
    return doc


def _resolve_links(db: Session, project_id: int, experiment_id: int | None, prototype_id: int | None) -> RndProject:
    project = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found — pick the project again.")
    if experiment_id:
        exp = db.query(RndExperiment).filter(RndExperiment.id == experiment_id, RndExperiment.is_deleted == False).first()  # noqa: E712
        if not exp:
            raise HTTPException(status_code=404, detail=f"Experiment #{experiment_id} not found (it may have been deleted).")
        if exp.project_id != project_id:
            raise HTTPException(status_code=400, detail=f"Experiment {exp.experiment_number} belongs to a different project than {project.project_number}.")
    if prototype_id:
        proto = db.query(RndPrototype).filter(RndPrototype.id == prototype_id, RndPrototype.is_deleted == False).first()  # noqa: E712
        if not proto:
            raise HTTPException(status_code=404, detail=f"Prototype #{prototype_id} not found (it may have been deleted).")
        if proto.project_id != project_id:
            raise HTTPException(status_code=400, detail=f"Prototype {proto.prototype_number} belongs to a different project than {project.project_number}.")
    return project


@router.get("", response_model=list[RndDocumentResponse])
async def list_documents(
    project_id: int | None = None,
    experiment_id: int | None = None,
    prototype_id: int | None = None,
    doc_type: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(RndDocument).filter(RndDocument.is_deleted == False)  # noqa: E712
    if project_id:
        query = query.filter(RndDocument.project_id == project_id)
    if experiment_id:
        query = query.filter(RndDocument.experiment_id == experiment_id)
    if prototype_id:
        query = query.filter(RndDocument.prototype_id == prototype_id)
    if doc_type:
        query = query.filter(RndDocument.doc_type == doc_type)
    if search:
        like = f"%{search}%"
        query = query.filter((RndDocument.title.ilike(like)) | (RndDocument.file_name.ilike(like)))
    return [_to_response(db, d) for d in query.order_by(RndDocument.id.desc()).all()]


@router.post("", response_model=list[RndDocumentResponse])
async def upload_documents(
    project_id: int = Form(...),
    doc_type: str = Form("other"),
    title: str = Form(...),
    version: str | None = Form(None),
    description: str | None = Form(None),
    experiment_id: int | None = Form(None),
    prototype_id: int | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    if doc_type not in RND_DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document type '{doc_type}'. Valid types: {', '.join(RND_DOCUMENT_TYPES)}.")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Document title is required.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    project = _resolve_links(db, project_id, experiment_id, prototype_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)

    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", "RnD", project.project_number, root_folder="RnD-media",
    )
    documents = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = RndDocument(
            project_id=project_id,
            experiment_id=experiment_id,
            prototype_id=prototype_id,
            doc_type=doc_type,
            title=title.strip(),
            version=(version or "").strip() or None,
            description=description,
            file_name=result["name"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            file_size=result.get("size"),
            mime_type=f.content_type,
            uploaded_by_id=user.id,
            uploaded_by_name=user.name or user.email,
        )
        db.add(doc)
        documents.append(doc)
    db.commit()
    for d in documents:
        db.refresh(d)
    return [_to_response(db, d) for d in documents]


@router.get("/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db)):
    """Raw bytes for in-app viewing via the app-only Graph token — never the
    raw SharePoint webUrl, same pattern as quality/routes/documents.py."""
    doc = _get_or_404(db, document_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
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
    user: User = Depends(require_app_access("rnd")),
):
    doc = _get_or_404(db, document_id)
    if not (user.role == "admin" or doc.uploaded_by_id == user.id):
        raise HTTPException(
            status_code=403,
            detail=f"Only the uploader ({doc.uploaded_by_name or 'unknown'}) or an admin can delete this document.",
        )
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{doc.title}' deleted"}
