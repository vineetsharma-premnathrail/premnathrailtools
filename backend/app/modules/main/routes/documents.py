"""Generic routes for editable Word documents of record (generate → edit in
Word Online → versions/changes), shared by every document type that
registers a DocumentAdapter (see services/managed_documents.py).

URL: /managed-documents/{entity_type}/{entity_id}[/changes|/edit|/docx|/upload]
"""

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.modules.main.routes.auth import get_current_user
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents as md

router = APIRouter(prefix="/managed-documents", tags=["Managed Documents"])

MAX_UPLOAD_MB = 25


def _target(entity_type: str, entity_id: int, db: Session, user: User, modify: bool) -> md.DocumentTarget:
    adapter = md.adapter_for(entity_type)
    if adapter.app not in user.get_apps():
        raise HTTPException(status_code=403, detail=f"You need access to the '{adapter.app}' module to open this document. Ask an admin to assign it.")
    from app.core.permission_registry import has_grant
    from app.core.permission_words import words
    for grant, what in ((adapter.view_grant, "open"), (adapter.edit_grant if modify else None, "create or edit")):
        if grant and not has_grant(user, grant):
            raise HTTPException(
                status_code=403,
                detail=f"Your roles don't allow you to {what} this Word document (needs {words(grant)}). "
                       "Ask an admin to add it to one of your roles (Organization › Roles › Permissions).",
            )
    return adapter.load(db, entity_id, user, modify)


def _document(entity_type: str, target: md.DocumentTarget, db: Session, current_only: bool = False):
    doc = md.get_active(db, entity_type, target.entity_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"No Word document has been created for {target.title} yet. Click 'Create Word' first.")
    if current_only and doc.source_revision != target.revision:
        raise HTTPException(status_code=409, detail=f"This Word draft was made for an older revision of {target.title}, so it no longer matches the record. Click 'Create Word for current revision' first.")
    return doc


@router.get("/{entity_type}/{entity_id}")
async def get_document(entity_type: str, entity_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=False)
    return {"document": await md.state(db, md.get_active(db, entity_type, entity_id), target.revision)}


@router.post("/{entity_type}/{entity_id}")
async def create_document(entity_type: str, entity_id: int, regenerate: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=True)
    doc = await md.generate(
        db, entity_type=entity_type, entity_id=entity_id, source_revision=target.revision, title=target.title,
        folder=target.folder, filename=f"{target.filename_stem}.docx", docx_bytes=await md.build_bytes(target),
        user=user, regenerate=regenerate,
    )
    return {"document": await md.state(db, doc, target.revision)}


@router.get("/{entity_type}/{entity_id}/changes")
async def get_document_changes(entity_type: str, entity_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=False)
    return await md.changes(_document(entity_type, target, db))


@router.post("/{entity_type}/{entity_id}/edit")
async def open_document_for_edit(entity_type: str, entity_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=True)
    return {"url": await md.open_for_edit(db, _document(entity_type, target, db, current_only=True), user)}


@router.get("/{entity_type}/{entity_id}/docx")
async def download_document_docx(entity_type: str, entity_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=False)
    doc = _document(entity_type, target, db)
    return Response(
        content=await md.current_docx(doc), media_type=md.DOCX_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{target.filename_stem}.docx"'},
    )


@router.post("/{entity_type}/{entity_id}/upload")
async def upload_document_docx(entity_type: str, entity_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target = _target(entity_type, entity_id, db, user, modify=True)
    doc = _document(entity_type, target, db, current_only=True)
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail=f"'{file.filename}' is not a .docx file. Save it as a Word document (.docx) and upload again.")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"'{file.filename}' is {len(data) // (1024 * 1024)} MB — the limit is {MAX_UPLOAD_MB} MB. Compress large images in Word (File → Compress Pictures) and try again.")
    doc = await md.upload_revision(db, doc, data, user)
    return {"document": await md.state(db, doc, target.revision)}
