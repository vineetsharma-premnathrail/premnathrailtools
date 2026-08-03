from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.note import Note
from app.modules.crm.schemas.note import NoteCreate, NoteUpdate, NoteResponse

router = APIRouter(prefix="/crm/notes", tags=["CRM - Notes"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("", response_model=list[NoteResponse])
async def list_notes(
    search: str | None = None,
    org_id: int | None = None,
    related_module: str | None = None,
    related_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Note).filter(Note.is_deleted == False)  # noqa: E712
    if org_id:
        query = query.filter(Note.org_id == org_id)
    if related_module:
        query = query.filter(Note.related_module == related_module)
    if related_id:
        query = query.filter(Note.related_id == related_id)
    if search:
        like = f"%{search}%"
        query = query.filter((Note.universal_id.ilike(like)) | (Note.note.ilike(like)))
    return query.order_by(Note.id.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=NoteResponse, status_code=201)
async def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    note = Note(**payload.model_dump(), created_by_name=user.name or user.email, created_by_id=user.id)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: int,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    note = db.query(Note).filter(Note.id == note_id, Note.is_deleted == False).first()  # noqa: E712
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if not _can_modify(note, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this note.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(note, field, value)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
async def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    note = db.query(Note).filter(Note.id == note_id, Note.is_deleted == False).first()  # noqa: E712
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if not _can_modify(note, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this note.")
    note.is_deleted = True
    note.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Note deleted"}
