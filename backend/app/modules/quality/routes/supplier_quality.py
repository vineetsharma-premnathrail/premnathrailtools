from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.supplier_quality import (
    QualitySupplierScorecard,
    QUALITY_SUPPLIER_SCORECARD_STATUSES,
)
from app.modules.quality.schemas.supplier_quality import (
    QualitySupplierScorecardCreate,
    QualitySupplierScorecardUpdate,
    QualitySupplierScorecardResponse,
)

router = APIRouter(
    prefix="/quality/supplier-quality", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, scorecard: QualitySupplierScorecard) -> QualitySupplierScorecardResponse:
    resp = QualitySupplierScorecardResponse.model_validate(scorecard)
    if scorecard.created_by_id:
        creator = db.query(User).filter(User.id == scorecard.created_by_id).first()
        if creator:
            resp.created_by_name = creator.name or creator.email
    return resp


def _get_or_404(db: Session, scorecard_id: int) -> QualitySupplierScorecard:
    scorecard = db.query(QualitySupplierScorecard).filter(QualitySupplierScorecard.id == scorecard_id).first()
    if not scorecard:
        raise HTTPException(status_code=404, detail="Supplier scorecard not found")
    return scorecard


@router.get("", response_model=list[QualitySupplierScorecardResponse])
async def list_scorecards(
    vendor_id: int | None = None,
    period: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(QualitySupplierScorecard)
    if vendor_id is not None:
        query = query.filter(QualitySupplierScorecard.vendor_id == vendor_id)
    if period:
        query = query.filter(QualitySupplierScorecard.period == period)
    if status_filter:
        query = query.filter(QualitySupplierScorecard.status == status_filter)
    scorecards = query.order_by(QualitySupplierScorecard.created_at.desc()).all()
    return [_to_response(db, s) for s in scorecards]


@router.post("", response_model=QualitySupplierScorecardResponse)
async def create_scorecard(
    payload: QualitySupplierScorecardCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.status not in QUALITY_SUPPLIER_SCORECARD_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{payload.status}'")

    scorecard = QualitySupplierScorecard(
        vendor_id=payload.vendor_id,
        vendor_name=payload.vendor_name,
        period=payload.period,
        quality_score=payload.quality_score,
        on_time_delivery_score=payload.on_time_delivery_score,
        rejection_count=payload.rejection_count,
        ncr_count=payload.ncr_count,
        status=payload.status or "draft",
        notes=payload.notes,
        created_by_id=user.id,
    )
    db.add(scorecard)
    db.commit()
    db.refresh(scorecard)
    return _to_response(db, scorecard)


@router.get("/{scorecard_id}", response_model=QualitySupplierScorecardResponse)
async def get_scorecard(scorecard_id: int, db: Session = Depends(get_db)):
    scorecard = _get_or_404(db, scorecard_id)
    return _to_response(db, scorecard)


@router.patch("/{scorecard_id}", response_model=QualitySupplierScorecardResponse)
async def update_scorecard(
    scorecard_id: int,
    payload: QualitySupplierScorecardUpdate,
    db: Session = Depends(get_db),
):
    scorecard = _get_or_404(db, scorecard_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_SUPPLIER_SCORECARD_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")

    for field, val in updates.items():
        setattr(scorecard, field, val)

    db.commit()
    db.refresh(scorecard)
    return _to_response(db, scorecard)


@router.delete("/{scorecard_id}")
async def delete_scorecard(scorecard_id: int, db: Session = Depends(get_db)):
    scorecard = _get_or_404(db, scorecard_id)
    db.delete(scorecard)
    db.commit()
    return {"message": "Supplier scorecard deleted"}
