from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.electrical.models.document import ElectricalDocument, ELECTRICAL_DOCUMENT_CATEGORIES
from app.modules.electrical.models.job import ELECTRICAL_STAGE_KEYS, ELECTRICAL_STAGE_LABELS
from app.modules.electrical.schemas.document import ElectricalDocumentResponse
from app.modules.electrical.service import ELECTRICAL_APP, get_job_or_404, require_working, user_names
from app.modules.main.models.user import User
from app.utils.sharepoint import (
    upload_file_to_sharepoint, delete_file_from_sharepoint, download_file_content, sanitize_folder_name,
)

# Shown inside the job page, so gated on the app only — not on a subtab.
router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

_CAN_EDIT = require_tab_action(ELECTRICAL_APP, "jobs", "edit")

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so electrical documents can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


def _to_responses(db: Session, docs: list[ElectricalDocument]) -> list[ElectricalDocumentResponse]:
    names = user_names(db, {d.uploaded_by_id for d in docs})
    out = []
    for d in docs:
        resp = ElectricalDocumentResponse.model_validate(d)
        resp.uploaded_by_name = names.get(d.uploaded_by_id)
        resp.stage_label = ELECTRICAL_STAGE_LABELS.get(d.stage_key) if d.stage_key else None
        out.append(resp)
    return out


def _get_doc(db: Session, document_id: int) -> ElectricalDocument:
    doc = db.query(ElectricalDocument).filter(ElectricalDocument.id == document_id, ElectricalDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"Electrical document #{document_id} not found (it may have been deleted).")
    return doc


@router.get("/jobs/{job_id}/documents", response_model=list[ElectricalDocumentResponse])
async def list_documents(job_id: int, category: str | None = None, stage_key: str | None = None, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    query = db.query(ElectricalDocument).filter(ElectricalDocument.job_id == job_id, ElectricalDocument.is_deleted == False)  # noqa: E712
    if category:
        query = query.filter(ElectricalDocument.category == category)
    if stage_key:
        query = query.filter(ElectricalDocument.stage_key == stage_key)
    return _to_responses(db, query.order_by(ElectricalDocument.id.desc()).all())


@router.post("/jobs/{job_id}/documents", response_model=list[ElectricalDocumentResponse])
async def upload_documents(
    job_id: int,
    title: str = Form(...),
    category: str = Form("other"),
    stage_key: str | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "upload documents")
    if category not in ELECTRICAL_DOCUMENT_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid document category '{category}'. Use one of: {', '.join(ELECTRICAL_DOCUMENT_CATEGORIES)}.")
    if stage_key and stage_key not in ELECTRICAL_STAGE_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown stage '{stage_key}'.")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Document title is required.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file to upload.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)

    folder = f"Electrical-media/{sanitize_folder_name(job.job_number)}/documents"
    docs = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        doc = ElectricalDocument(
            job_id=job_id, stage_key=stage_key or None, category=category, title=title.strip(), description=description,
            file_name=result["name"], sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"),
            file_size=result.get("size"), mime_type=f.content_type, uploaded_by_id=user.id,
        )
        db.add(doc)
        docs.append(doc)
    db.commit()
    for d in docs:
        db.refresh(d)
    return _to_responses(db, docs)


@router.get("/documents/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db)):
    """Raw bytes for in-app viewing via the app-only Graph token — never the
    raw SharePoint webUrl, same pattern as rnd/routes/documents.py."""
    doc = _get_doc(db, document_id)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(
        content=content,
        media_type=doc.mime_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
    )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    doc = _get_doc(db, document_id)
    job = get_job_or_404(db, doc.job_id, lock=True)
    require_working(job, "change its documents")
    if not (user.role == "admin" or doc.uploaded_by_id == user.id):
        raise HTTPException(status_code=403, detail="Only the person who uploaded this document (or an admin) can delete it.")
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{doc.title}' deleted"}
