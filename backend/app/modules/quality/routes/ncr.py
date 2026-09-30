from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.ncr import QualityNcr, QUALITY_NCR_SOURCES, QUALITY_NCR_SEVERITIES, QUALITY_NCR_STATUSES
from app.modules.quality.schemas.ncr import QualityNcrCreate, QualityNcrUpdate, QualityNcrResponse
from app.modules.quality.service import generate_ncr_number

router = APIRouter(
    prefix="/quality/ncr", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, ncr: QualityNcr) -> QualityNcrResponse:
    resp = QualityNcrResponse.model_validate(ncr)
    if ncr.raised_by_id:
        raiser = db.query(User).filter(User.id == ncr.raised_by_id).first()
        if raiser:
            resp.raised_by_name = raiser.name or raiser.email
    if ncr.inspection_id:
        inspection = db.query(QualityInspection).filter(QualityInspection.id == ncr.inspection_id).first()
        if inspection:
            resp.inspection_number = inspection.inspection_number
    return resp


def _get_or_404(db: Session, ncr_id: int) -> QualityNcr:
    ncr = db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.id == ncr_id).first()  # noqa: E712
    if not ncr:
        raise HTTPException(status_code=404, detail="NCR not found")
    return ncr


@router.get("", response_model=list[QualityNcrResponse])
async def list_ncrs(
    status_filter: str | None = Query(None, alias="status"),
    severity: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityNcr).filter(QualityNcr.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(QualityNcr.status == status_filter)
    if severity:
        query = query.filter(QualityNcr.severity == severity)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (QualityNcr.item_name.ilike(like))
            | (QualityNcr.ncr_number.ilike(like))
            | (QualityNcr.description.ilike(like))
        )
    ncrs = query.order_by(QualityNcr.created_at.desc()).all()
    return [_to_response(db, n) for n in ncrs]


@router.post("", response_model=QualityNcrResponse)
async def create_ncr(
    payload: QualityNcrCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.source not in QUALITY_NCR_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid source '{payload.source}'")
    if payload.severity not in QUALITY_NCR_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{payload.severity}'")
    if payload.inspection_id is not None and not db.query(QualityInspection).filter(
        QualityInspection.id == payload.inspection_id, QualityInspection.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection #{payload.inspection_id} not found")

    ncr = QualityNcr(
        ncr_number=generate_ncr_number(db),
        source=payload.source,
        severity=payload.severity,
        inspection_id=payload.inspection_id,
        item_name=payload.item_name,
        item_code=payload.item_code,
        description=payload.description,
        root_cause=payload.root_cause,
        raised_by_id=user.id,
        ncr_date=payload.ncr_date,
        remarks=payload.remarks,
        status="open",
    )
    db.add(ncr)
    db.commit()
    db.refresh(ncr)
    return _to_response(db, ncr)


@router.get("/{ncr_id}", response_model=QualityNcrResponse)
async def get_ncr(ncr_id: int, db: Session = Depends(get_db)):
    ncr = _get_or_404(db, ncr_id)
    return _to_response(db, ncr)


@router.patch("/{ncr_id}", response_model=QualityNcrResponse)
async def update_ncr(
    ncr_id: int,
    payload: QualityNcrUpdate,
    db: Session = Depends(get_db),
):
    ncr = _get_or_404(db, ncr_id)
    updates = payload.model_dump(exclude_unset=True)

    new_source = updates.get("source")
    if new_source and new_source not in QUALITY_NCR_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid source '{new_source}'")
    new_severity = updates.get("severity")
    if new_severity and new_severity not in QUALITY_NCR_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{new_severity}'")
    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_NCR_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_inspection_id = updates.get("inspection_id")
    if new_inspection_id is not None and not db.query(QualityInspection).filter(
        QualityInspection.id == new_inspection_id, QualityInspection.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection #{new_inspection_id} not found")

    if new_status == "closed" and ncr.closed_at is None:
        ncr.closed_at = datetime.now(timezone.utc)

    for field, val in updates.items():
        setattr(ncr, field, val)

    db.commit()
    db.refresh(ncr)
    return _to_response(db, ncr)


@router.delete("/{ncr_id}")
async def delete_ncr(ncr_id: int, db: Session = Depends(get_db)):
    ncr = _get_or_404(db, ncr_id)
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    ncr.is_deleted = True
    ncr.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "NCR deleted"}
