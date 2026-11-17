from app.core.like import like_escape
import mimetypes
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import can_perform, is_admin_user
from app.core.permissions import ensure_tab_action, require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.scope import apply_scope, ensure_in_scope
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.document import RndDocument, RND_DOCUMENT_TYPES
from app.modules.rnd.services import project_roles as roles
from app.modules.rnd.schemas.document import RndDocumentResponse
from app.modules.rnd.service import user_names
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    download_file_content,
)

# Documents show up inside project pages as well as
# on their own tab, so this is gated on the R&D app only — not on a subtab —
# otherwise a user without the Documents tab would get 403s on a project page.
router = APIRouter(
    prefix="/documents", tags=["RnD Documents"],
    dependencies=[Depends(require_app_access("rnd"))],
)

_INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp"}

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so R&D documents can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


def _to_response(db: Session, doc: RndDocument, numbers: dict[int, str] | None = None) -> RndDocumentResponse:
    """`numbers` = project id -> RND number, built once for a whole list (no per-row query)."""
    resp = RndDocumentResponse.model_validate(doc)
    if numbers is not None:
        resp.project_number = numbers.get(doc.project_id) if doc.project_id else None
        return resp
    project = db.query(RndProject.project_number).filter(RndProject.id == doc.project_id).first()
    resp.project_number = project[0] if project else None
    return resp


def _project_numbers(db: Session, docs: list[RndDocument]) -> dict[int, str]:
    ids = {d.project_id for d in docs if d.project_id}
    if not ids:
        return {}
    return {pid: num for pid, num in db.query(RndProject.id, RndProject.project_number).filter(RndProject.id.in_(ids)).all()}


def _ensure_task_file_visible(db: Session, doc: RndDocument, user: User) -> None:
    """Task files follow the task: same people as project_tasks._visible (assignee, creator, people
    on the main task, and the project's managers / leads / admins). 403 with the reason otherwise."""
    from app.modules.rnd.models.project_task import RndProjectTask
    from app.modules.rnd.routes.project_tasks import _machine_parent, _pm_parent

    denied = HTTPException(
        status_code=403,
        detail="This file belongs to an R&D task that isn't yours — only the task's assignee, its creator, an R&D head "
               "or the project's lead / manager can open it. Ask one of them to share it or to give you the task.",
    )
    task = db.query(RndProjectTask).filter(RndProjectTask.id == doc.task_id).first()
    if not task:
        raise denied
    if user.id in (task.assigned_to_id, task.created_by_id):
        return
    if task.parent_task_id:
        main = db.query(RndProjectTask).filter(RndProjectTask.id == task.parent_task_id).first()
        if main and user.id in (main.assigned_to_id, main.created_by_id):
            return
    if doc.machine_id:
        can_manage = _machine_parent(db, doc.machine_id, user).can_manage(user)
    elif doc.pm_project_id:
        can_manage = _pm_parent(db, doc.pm_project_id, user).can_manage(user)
    else:
        project = db.query(RndProject).filter(RndProject.id == doc.project_id, RndProject.is_deleted == False).first()  # noqa: E712
        can_manage = bool(project and roles.can_manage(user, project))
    if not can_manage:
        raise denied


def _get_or_404(db: Session, document_id: int, user: User | None = None) -> RndDocument:
    doc = db.query(RndDocument).filter(RndDocument.id == document_id, RndDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"R&D document #{document_id} not found (it may have been deleted).")
    if user is not None:
        if doc.task_id:
            # A file of an R&D task (Prototype / Research project, Project Management project or past
            # machine): open to the task's assignee / creator, the assignee or creator of its main task
            # and whoever manages the project (the same people routes/project_tasks.py::_visible shows
            # the task to) — never through the broader R&D data scope.
            _ensure_task_file_visible(db, doc, user)
            return doc
        ensure_in_scope(db, user, doc)
    return doc


def _ensure_can_open(user: User, doc: RndDocument) -> None:
    """Opening a file needs the tab it is shown on (owner 2026-11-14, the tick
    decides): R&D › Documents, or the project page it sits on; a task's file
    also opens from R&D › R&D Tasks."""
    ok = (
        can_perform(user, "rnd", "documents", "view")
        or (doc.project_id and can_perform(user, "rnd", "projects", "view"))
        or (doc.task_id and can_perform(user, "rnd", "tasks", "view"))
    )
    if not ok:
        raise HTTPException(
            status_code=403,
            detail="Opening R&D documents needs 'View' on R&D › Documents (or on R&D › Prototype / Research for "
                   "the project the file belongs to, or R&D › R&D Tasks for a task's file). Ask an admin to tick it in Organization › Role & Permissions.",
        )


def _resolve_project(db: Session, project_id: int) -> RndProject:
    project = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found — pick the project again.")
    return project


@router.get("", response_model=list[RndDocumentResponse])
async def list_documents(
    project_id: int | None = None,
    doc_type: str | None = None,
    search: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    # The R&D › Documents tab lists every project's files and needs 'view' on it. The same list
    # filtered to one project is the Documents card of the project page, so 'view' on
    # R&D › Prototype / Research is enough there.
    if not (
        can_perform(user, "rnd", "documents", "view")
        or (project_id and can_perform(user, "rnd", "projects", "view"))
    ):
        raise HTTPException(
            status_code=403,
            detail="Seeing R&D documents needs 'View' on R&D › Documents (or on R&D › Prototype / Research for the "
                   "project they belong to). Ask an admin to add it to your role in Organization › Role & Permissions.",
        )
    # Task files are shown on their task, not in the document lists.
    query = db.query(RndDocument).filter(RndDocument.is_deleted == False, RndDocument.task_id.is_(None))  # noqa: E712
    query = apply_scope(query, user, RndDocument)
    if project_id:
        query = query.filter(RndDocument.project_id == project_id)
    if doc_type:
        query = query.filter(RndDocument.doc_type == doc_type)
    if search:
        like = f"%{like_escape(search)}%"
        query = query.filter((RndDocument.title.ilike(like, escape="\\")) | (RndDocument.file_name.ilike(like, escape="\\")))
    docs = query.order_by(RndDocument.id.desc()).offset(offset).limit(limit).all()
    numbers = _project_numbers(db, docs)
    return [_to_response(db, d, numbers) for d in docs]


@router.post("", response_model=list[RndDocumentResponse])
async def upload_documents(
    project_id: int = Form(...),
    doc_type: str = Form("other"),
    title: str = Form(...),
    version: str | None = Form(None),
    description: str | None = Form(None),
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
    # Uploading is a create: 'create' on R&D › Documents, or 'edit' on
    # R&D › Prototype / Research (files added from the project page).
    if not (can_perform(user, "rnd", "documents", "create") or can_perform(user, "rnd", "projects", "edit")):
        raise HTTPException(
            status_code=403,
            detail="Uploading R&D documents needs 'Create' on R&D › Documents or 'Edit' on "
                   "R&D › Prototype / Research. Ask an admin to add one to your role in "
                   "Organization › Role & Permissions.",
        )
    project = _resolve_project(db, project_id)
    # The project (and so everything filed under it) must be in the user's R&D data scope.
    ensure_in_scope(db, user, project)
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
    numbers = _project_numbers(db, documents)
    return [_to_response(db, d, numbers) for d in documents]


@router.get("/{document_id}/content")
async def get_document_content(document_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    """Raw bytes for in-app viewing via the app-only Graph token — never the
    raw SharePoint webUrl, same pattern as quality/routes/documents.py."""
    doc = _get_or_404(db, document_id, user=user)
    _ensure_can_open(user, doc)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, _claimed = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    # The type comes from the file name, never the uploader's claimed MIME type;
    # only PDFs and images open inline, everything else downloads. The header
    # carries an ASCII name plus filename* so non-latin-1 names (Devanagari,
    # em dash) or quotes can't break it. Same rules as design/files.stream_file.
    file_name = doc.file_name or "document"
    mime = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
    kind = "inline" if mime in _INLINE_TYPES else "attachment"
    ascii_name = (file_name.encode("ascii", "ignore").decode().replace('"', "").strip()) or "document"
    return Response(
        content=content,
        media_type=mime,
        headers={
            "Content-Disposition": f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    doc = _get_or_404(db, document_id, user=user)
    # One rule (owner 2026-11-14, same on the Documents tab and the record pages):
    # 'Delete' on R&D › Documents AND (you uploaded the file — the company delete
    # rule — or you lead the project / manage the task's project, or are admin).
    ensure_tab_action(user, "rnd", "documents", "delete")
    own = doc.uploaded_by_id is not None and doc.uploaded_by_id == user.id
    if not own and (doc.pm_project_id or doc.machine_id):
        # A file of an R&D task on a Project Management project or a past machine: whoever manages
        # R&D tasks on that project (admin, R&D head, project manager / management) removes others' files.
        from app.modules.rnd.routes.project_tasks import _machine_parent, _pm_parent
        parent = _machine_parent(db, doc.machine_id, user) if doc.machine_id else _pm_parent(db, doc.pm_project_id, user)
        if not parent.can_manage(user):
            raise HTTPException(status_code=403, detail=f"You can delete only the files you uploaded — '{doc.title}' was uploaded by "
                                                        f"{doc.uploaded_by_name or 'someone else'}. Ask them, an R&D head or the project manager of {parent.project_number} to remove it.")
    project = db.query(RndProject).filter(RndProject.id == doc.project_id).first() if doc.project_id else None
    if not own and project and not roles.can_manage(user, project):
        lead_names = ", ".join(n for n in user_names(db, roles.lead_ids(project)).values()) or "the project lead"
        raise HTTPException(
            status_code=403,
            detail=f"You can delete only the files you uploaded — '{doc.title}' was uploaded by {doc.uploaded_by_name or 'someone else'}. "
                   f"Ask them or a project lead of {project.project_number} ({lead_names}) to remove it.",
        )
    if not own and not project and not doc.pm_project_id and not doc.machine_id and not is_admin_user(user):
        raise HTTPException(status_code=403, detail=f"You can delete only the files you uploaded — ask {doc.uploaded_by_name or 'its uploader'} or an admin to remove '{doc.title}'.")
    if settings.SHAREPOINT_SITE_ID and doc.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if the SharePoint delete fails
    doc.is_deleted = True
    doc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"'{doc.title}' deleted"}
