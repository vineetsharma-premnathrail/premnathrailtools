from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.quality_standard import QualityStandard, QUALITY_STANDARD_STATUSES
from app.modules.quality.schemas.quality_standard import (
    QualityStandardCreate, QualityStandardUpdate, QualityStandardResponse,
)

router = APIRouter(prefix="/quality/standards", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])


def _to_response(db: Session, standard: QualityStandard) -> QualityStandardResponse:
    resp = QualityStandardResponse.model_validate(standard)
    if standard.created_by_id:
        creator = db.query(User).filter(User.id == standard.created_by_id).first()
        if creator:
            resp.created_by_name = creator.name or creator.email
    return resp


def _get_or_404(db: Session, standard_id: int) -> QualityStandard:
    standard = db.query(QualityStandard).filter(QualityStandard.is_deleted == False, QualityStandard.id == standard_id).first()  # noqa: E712
    if not standard:
        raise HTTPException(status_code=404, detail="Quality standard not found")
    return standard


def _ensure_code_free(db: Session, code: str) -> None:
    """Standard codes stay unique across deleted records too (deleted ones are
    kept for the audit trail), so say so when the clash is with a deleted
    standard the user can no longer see in the list."""
    existing = db.query(QualityStandard).filter(QualityStandard.standard_code == code).first()
    if not existing:
        return
    if existing.is_deleted:
        raise HTTPException(
            status_code=409,
            detail=f"Standard code '{code}' belongs to a deleted standard, which is kept for the audit trail — use a different code (e.g. '{code}-R1').",
        )
    raise HTTPException(status_code=409, detail=f"Standard code '{code}' already exists")


@router.get("", response_model=list[QualityStandardResponse])
async def list_quality_standards(
    status_filter: str | None = Query(None, alias="status"),
    category: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityStandard).filter(QualityStandard.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(QualityStandard.status == status_filter)
    if category:
        query = query.filter(QualityStandard.category == category)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (QualityStandard.title.ilike(like)) | (QualityStandard.standard_code.ilike(like))
        )
    standards = query.order_by(QualityStandard.created_at.desc()).all()
    return [_to_response(db, s) for s in standards]


@router.post("", response_model=QualityStandardResponse)
async def create_quality_standard(
    payload: QualityStandardCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.status not in QUALITY_STANDARD_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")
    _ensure_code_free(db, payload.standard_code)

    standard = QualityStandard(
        standard_code=payload.standard_code,
        title=payload.title,
        category=payload.category,
        description=payload.description,
        effective_date=payload.effective_date,
        status=payload.status,
        created_by_id=user.id,
    )
    db.add(standard)
    db.commit()
    db.refresh(standard)
    return _to_response(db, standard)


@router.get("/{standard_id}", response_model=QualityStandardResponse)
async def get_quality_standard(standard_id: int, db: Session = Depends(get_db)):
    standard = _get_or_404(db, standard_id)
    return _to_response(db, standard)


@router.patch("/{standard_id}", response_model=QualityStandardResponse)
async def update_quality_standard(
    standard_id: int,
    payload: QualityStandardUpdate,
    db: Session = Depends(get_db),
):
    standard = _get_or_404(db, standard_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_STANDARD_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")

    new_code = updates.get("standard_code")
    if new_code and new_code != standard.standard_code:
        _ensure_code_free(db, new_code)

    for field, val in updates.items():
        setattr(standard, field, val)

    db.commit()
    db.refresh(standard)
    return _to_response(db, standard)


@router.delete("/{standard_id}")
async def delete_quality_standard(standard_id: int, db: Session = Depends(get_db)):
    standard = _get_or_404(db, standard_id)
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    standard.is_deleted = True
    standard.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Quality standard deleted"}
