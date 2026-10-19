from datetime import datetime, timezone
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.task import PmProjectTask
from app.modules.projects.models.document import PmProjectDocument, PM_DOCUMENT_TYPES
from app.modules.projects.schemas.document import PmProjectDocumentResponse
from app.modules.projects import views, workflow as wf
from app.modules.projects import access as pm_access
from app.core.data_scope import apply_scope, ensure_in_scope
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

router = APIRouter(
    prefix="/projects/{project_id}/documents", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


async def store_files(db: Session, project: PmProject, files: list[UploadFile], user: User, *, doc_type: str, title: str,
                      milestone_id: int | None = None, task_id: int | None = None,
                      description: str | None = None, message_id: int | None = None) -> list[PmProjectDocument]:
    """Uploads to SharePoint and records the pointers — shared by project
    documents, WBS evidence and task files (routes/work.py)."""
    if doc_type not in PM_DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Document type '{doc_type}' is not valid — use one of {', '.join(PM_DOCUMENT_TYPES)}.")
    if not files:
        raise HTTPException(status_code=422, detail="Choose at least one file to upload.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) is not configured on the server, so files can't be uploaded. Ask IT to set SHAREPOINT_SITE_ID.")
    folder_path = build_sharepoint_folder_path(
        user.name or user.email or "", "Projects", f"projects/{project.project_code}", root_folder="Projects-media",
    )
    docs = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        doc = PmProjectDocument(
            project_id=project.id, milestone_id=milestone_id, task_id=task_id, message_id=message_id, doc_type=doc_type,
            title=(title or "").strip() or result["name"], file_name=result["name"], file_path=result["path"],
            sharepoint_path=result["path"], sharepoint_url=result.get("webUrl"), file_size=result["size"],
            mime_type=f.content_type, description=description, uploaded_by_id=user.id, uploaded_by_name=user.name or user.email,
        )
        db.add(doc)
        docs.append(doc)
    db.flush()
    wf.audit(db, project.id, user, "document_uploaded", f"{len(docs)} file(s) uploaded by {wf.user_label(user)}: {', '.join(d.file_name for d in docs)}.", subtab_key="documents")
    return docs


async def file_response(doc: PmProjectDocument) -> Response:
    """Raw bytes for in-app viewing via the app-only Graph token — never the
    raw SharePoint webUrl (same pattern as crm/routes/documents.py)."""
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) is not configured on the server.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    # Headers are latin-1 only: ASCII fallback plus RFC 5987 UTF-8 name, so
    # names with ₹, Hindi text or curly quotes don't crash the download.
    name = doc.file_name or "file"
    ascii_name = name.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "").strip() or "file"
    return Response(content=content, media_type=doc.mime_type or content_type, headers={
        "Content-Disposition": f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}",
        "X-Content-Type-Options": "nosniff",
    })


async def soft_delete(db: Session, doc: PmProjectDocument, user: User) -> None:
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # the record is removed even if SharePoint cleanup fails
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    wf.audit(db, doc.project_id, user, "document_deleted", f"File '{doc.file_name}' deleted by {wf.user_label(user)}.", subtab_key="documents")


def _project_or_404(db: Session, project_id: int, user: User | None = None) -> PmProject:
    project = db.get(PmProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    if user is not None:
        ensure_in_scope(db, user, project)
    return project


def _document_or_404(db: Session, project_id: int, document_id: int, user: User | None = None) -> PmProjectDocument:
    if user is not None:
        _project_or_404(db, project_id, user)
    doc = db.query(PmProjectDocument).filter(
        PmProjectDocument.id == document_id, PmProjectDocument.project_id == project_id, PmProjectDocument.is_deleted == False,  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"File #{document_id} not found on this project — it may have been deleted.")
    return doc


@router.get("", response_model=list[PmProjectDocumentResponse])
async def list_documents(project_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("projects", "documents"))):
    _project_or_404(db, project_id, _user)
    return views.documents_for(db, views.names(db), project_id=project_id)


@router.post("", response_model=list[PmProjectDocumentResponse])
async def upload_documents(
    project_id: int,
    doc_type: str = Form("other"),
    title: str = Form(""),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("projects", "documents", "create")),
):
    project = _project_or_404(db, project_id, user)
    wf.require_manage(project, user, "upload project documents")
    docs = await store_files(db, project, files, user, doc_type=doc_type, title=title, description=description)
    db.commit()
    cache = views.names(db)
    return [views.document_response(d, cache) for d in docs]


@router.get("/{document_id}/content")
async def get_document_content(project_id: int, document_id: int, db: Session = Depends(get_db),
                               _user: User = Depends(require_tab_access("projects", "documents"))):
    return await file_response(_document_or_404(db, project_id, document_id, _user))


@router.delete("/{document_id}")
async def delete_document(project_id: int, document_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_access("projects", "documents"))):
    doc = _document_or_404(db, project_id, document_id, user)
    # Documents › Delete + only the uploader (admins: anyone).
    ensure_can_delete(user, doc, "projects", "documents", what="file")
    # Same record locks as /pm-work/files — evidence of a submitted/accepted
    # milestone and files of a closed task are kept as a record.
    if doc.milestone_id:
        m = db.get(PmProjectMilestone, doc.milestone_id)
        if m and m.status not in ("not_started", "in_progress"):
            label = wf.MILESTONE_STATUS_LABELS.get(m.status, m.status)
            raise HTTPException(status_code=409, detail=f"WBS '{m.title}' is {label}, so its evidence is kept as a record and can't be deleted."
                                + (" If it is wrong, reject the WBS first so the department can replace it." if m.status == "submitted" else ""))
    if doc.task_id:
        t = db.get(PmProjectTask, doc.task_id)
        if t and t.status in ("done", "cancelled"):
            raise HTTPException(status_code=409, detail=f"Task '{t.title}' is {wf.TASK_STATUS_LABELS.get(t.status, t.status)}, so its files are kept as a record and can't be deleted.")
    if doc.milestone_id or doc.task_id:
        # On hold freezes all work — same rule as /pm-work/files.
        wf.require_project_active(_project_or_404(db, project_id, user))
    await soft_delete(db, doc, user)
    db.commit()
    return {"message": "File deleted"}
