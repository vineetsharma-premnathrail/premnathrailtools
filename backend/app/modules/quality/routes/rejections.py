from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.rejection import (
    QualityRejection, QUALITY_REJECTION_DISPOSITIONS, QUALITY_REJECTION_STATUSES,
)
from app.modules.quality.schemas.rejection import (
    QualityRejectionCreate, QualityRejectionUpdate, QualityRejectionResponse,
)
from app.modules.quality.service import generate_rejection_number

router = APIRouter(
    prefix="/quality/rejections", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, rejection: QualityRejection) -> QualityRejectionResponse:
    resp = QualityRejectionResponse.model_validate(rejection)
    if rejection.ncr_id:
        ncr = db.query(QualityNcr).filter(QualityNcr.id == rejection.ncr_id).first()
        if ncr:
            resp.ncr_number = ncr.ncr_number
    return resp


def _get_or_404(db: Session, rejection_id: int) -> QualityRejection:
    rejection = db.query(QualityRejection).filter(QualityRejection.id == rejection_id).first()
    if not rejection:
        raise HTTPException(status_code=404, detail="Rejection not found")
    return rejection


@router.get("", response_model=list[QualityRejectionResponse])
async def list_rejections(
    status_filter: str | None = Query(None, alias="status"),
    ncr_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityRejection)
    if status_filter:
        query = query.filter(QualityRejection.status == status_filter)
    if ncr_id:
        query = query.filter(QualityRejection.ncr_id == ncr_id)
    rejections = query.order_by(QualityRejection.created_at.desc()).all()
    return [_to_response(db, r) for r in rejections]


@router.post("", response_model=QualityRejectionResponse)
async def create_rejection(
    payload: QualityRejectionCreate,
    db: Session = Depends(get_db),
):
    if payload.disposition not in QUALITY_REJECTION_DISPOSITIONS:
        raise HTTPException(status_code=400, detail=f"Invalid disposition '{payload.disposition}'")
    if payload.ncr_id is not None and not db.query(QualityNcr).filter(QualityNcr.id == payload.ncr_id).first():
        raise HTTPException(status_code=404, detail=f"NCR #{payload.ncr_id} not found")
    if payload.inspection_id is not None and not db.query(QualityInspection).filter(
        QualityInspection.id == payload.inspection_id
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection #{payload.inspection_id} not found")

    rejection = QualityRejection(
        rejection_number=generate_rejection_number(db),
        ncr_id=payload.ncr_id,
        inspection_id=payload.inspection_id,
        item_name=payload.item_name,
        item_code=payload.item_code,
        quantity=payload.quantity,
        disposition=payload.disposition,
        vendor_id=payload.vendor_id,
        vendor_name=payload.vendor_name,
        rejection_date=payload.rejection_date,
        remarks=payload.remarks,
        status="open",
    )
    db.add(rejection)
    db.commit()
    db.refresh(rejection)
    return _to_response(db, rejection)


@router.get("/{rejection_id}", response_model=QualityRejectionResponse)
async def get_rejection(rejection_id: int, db: Session = Depends(get_db)):
    rejection = _get_or_404(db, rejection_id)
    return _to_response(db, rejection)


@router.patch("/{rejection_id}", response_model=QualityRejectionResponse)
async def update_rejection(
    rejection_id: int,
    payload: QualityRejectionUpdate,
    db: Session = Depends(get_db),
):
    rejection = _get_or_404(db, rejection_id)
    updates = payload.model_dump(exclude_unset=True)

    new_disposition = updates.get("disposition")
    if new_disposition and new_disposition not in QUALITY_REJECTION_DISPOSITIONS:
        raise HTTPException(status_code=400, detail=f"Invalid disposition '{new_disposition}'")
    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_REJECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_ncr_id = updates.get("ncr_id")
    if new_ncr_id is not None and not db.query(QualityNcr).filter(QualityNcr.id == new_ncr_id).first():
        raise HTTPException(status_code=404, detail=f"NCR #{new_ncr_id} not found")
    new_inspection_id = updates.get("inspection_id")
    if new_inspection_id is not None and not db.query(QualityInspection).filter(
        QualityInspection.id == new_inspection_id
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection #{new_inspection_id} not found")

    for field, val in updates.items():
        setattr(rejection, field, val)

    db.commit()
    db.refresh(rejection)
    return _to_response(db, rejection)


@router.delete("/{rejection_id}")
async def delete_rejection(rejection_id: int, db: Session = Depends(get_db)):
    rejection = _get_or_404(db, rejection_id)
    db.delete(rejection)
    db.commit()
    return {"message": "Rejection deleted"}
