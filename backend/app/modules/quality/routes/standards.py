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
    standard = db.query(QualityStandard).filter(QualityStandard.id == standard_id).first()
    if not standard:
        raise HTTPException(status_code=404, detail="Quality standard not found")
    return standard


@router.get("", response_model=list[QualityStandardResponse])
async def list_quality_standards(
    status_filter: str | None = Query(None, alias="status"),
    category: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityStandard)
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
    if db.query(QualityStandard).filter(QualityStandard.standard_code == payload.standard_code).first():
        raise HTTPException(status_code=409, detail=f"Standard code '{payload.standard_code}' already exists")

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
        if db.query(QualityStandard).filter(QualityStandard.standard_code == new_code).first():
            raise HTTPException(status_code=409, detail=f"Standard code '{new_code}' already exists")

    for field, val in updates.items():
        setattr(standard, field, val)

    db.commit()
    db.refresh(standard)
    return _to_response(db, standard)


@router.delete("/{standard_id}")
async def delete_quality_standard(standard_id: int, db: Session = Depends(get_db)):
    standard = _get_or_404(db, standard_id)
    db.delete(standard)
    db.commit()
    return {"message": "Quality standard deleted"}
