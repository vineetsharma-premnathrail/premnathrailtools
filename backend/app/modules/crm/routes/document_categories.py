from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access, require_tab_action
from app.modules.main.models.user import User
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.document_category import CrmDocumentCategory
from app.modules.crm.schemas.document_category import (
    CrmDocumentCategoryCreate, CrmDocumentCategoryUpdate, CrmDocumentCategoryResponse,
)
from app.modules.crm.services import technical_offer, requirement_movement

router = APIRouter(prefix="/crm/document-categories", tags=["CRM - Document Categories"])

# Only documents users upload into these folders carry a picked category.
USER_FOLDERS = ("client", "internal")
# Labels the system writes itself (sent TOR PDFs, R&D replies, discussion
# files) — a user category with the same name would mix with them.
RESERVED = {technical_offer.DOC_CATEGORY.lower(), requirement_movement.RESPONSE_DOC_CATEGORY.lower(), "discussion"}


def _live(db: Session):
    return db.query(CrmDocumentCategory).filter(CrmDocumentCategory.is_deleted == False)  # noqa: E712


def _counts(db: Session) -> dict[str, int]:
    rows = (
        db.query(CrmDocument.doc_category, func.count(CrmDocument.id))
        .filter(CrmDocument.is_deleted == False, CrmDocument.folder_type.in_(USER_FOLDERS))  # noqa: E712
        .group_by(CrmDocument.doc_category)
        .all()
    )
    return {label: n for label, n in rows if label}


def _response(cat: CrmDocumentCategory, counts: dict[str, int]) -> CrmDocumentCategoryResponse:
    out = CrmDocumentCategoryResponse.model_validate(cat)
    out.document_count = counts.get(cat.label, 0)
    return out


def _clean_label(db: Session, raw: str | None, exclude_id: int | None = None) -> str:
    label = " ".join((raw or "").split())
    if not label:
        raise HTTPException(status_code=422, detail="Enter a category name.")
    if len(label) > 100:
        raise HTTPException(status_code=422, detail="Category name is too long — keep it to 100 characters.")
    if label.lower() in RESERVED:
        raise HTTPException(status_code=422, detail=f'"{label}" is used by the system for generated documents. Pick a different name.')
    q = _live(db).filter(func.lower(CrmDocumentCategory.label) == label.lower())
    if exclude_id:
        q = q.filter(CrmDocumentCategory.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f'A document category named "{label}" already exists.')
    return label


@router.get("", response_model=list[CrmDocumentCategoryResponse])
async def list_document_categories(
    # Read by every Documents tab upload picker — any CRM user; writes need Settings › Edit.
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    counts = _counts(db)
    return [_response(c, counts) for c in _live(db).order_by(CrmDocumentCategory.label).all()]


@router.post("", response_model=CrmDocumentCategoryResponse, status_code=201)
async def create_document_category(
    payload: CrmDocumentCategoryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("crm", "settings", "edit")),
):
    cat = CrmDocumentCategory(label=_clean_label(db, payload.label), created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return _response(cat, _counts(db))


@router.patch("/{category_id}", response_model=CrmDocumentCategoryResponse)
async def update_document_category(
    category_id: int,
    payload: CrmDocumentCategoryUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("crm", "settings", "edit")),
):
    cat = _live(db).filter(CrmDocumentCategory.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Document category not found — it may have been deleted. Reload the list.")
    if payload.label is not None:
        new_label = _clean_label(db, payload.label, exclude_id=cat.id)
        if new_label != cat.label:
            # Rename = re-label the documents already filed under it, so the
            # Documents tab and search keep showing one consistent name.
            db.query(CrmDocument).filter(
                CrmDocument.doc_category == cat.label, CrmDocument.folder_type.in_(USER_FOLDERS),
            ).update({CrmDocument.doc_category: new_label}, synchronize_session=False)
            cat.label = new_label
    db.commit()
    db.refresh(cat)
    return _response(cat, _counts(db))


@router.delete("/{category_id}")
async def delete_document_category(
    category_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("crm", "settings", "edit")),
):
    """Removes the category from the upload picker. Documents already filed
    under it keep their label (it's part of their history)."""
    cat = _live(db).filter(CrmDocumentCategory.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Document category not found — it may already have been deleted. Reload the list.")
    cat.is_deleted = True
    cat.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}
