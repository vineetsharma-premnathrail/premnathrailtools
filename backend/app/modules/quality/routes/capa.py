from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa, QUALITY_CAPA_ACTION_TYPES, QUALITY_CAPA_STATUSES
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.schemas.capa import QualityCapaCreate, QualityCapaUpdate, QualityCapaResponse
from app.modules.quality.service import generate_capa_number

router = APIRouter(
    prefix="/quality/capa", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, capa: QualityCapa) -> QualityCapaResponse:
    resp = QualityCapaResponse.model_validate(capa)
    if capa.responsible_user_id:
        responsible = db.query(User).filter(User.id == capa.responsible_user_id).first()
        if responsible:
            resp.responsible_user_name = responsible.name or responsible.email
    if capa.ncr_id:
        ncr = db.query(QualityNcr).filter(QualityNcr.id == capa.ncr_id).first()
        if ncr:
            resp.ncr_number = ncr.ncr_number
    return resp


def _get_or_404(db: Session, capa_id: int) -> QualityCapa:
    capa = db.query(QualityCapa).filter(QualityCapa.is_deleted == False, QualityCapa.id == capa_id).first()  # noqa: E712
    if not capa:
        raise HTTPException(status_code=404, detail="CAPA not found")
    return capa


@router.get("", response_model=list[QualityCapaResponse])
async def list_capas(
    action_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    ncr_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityCapa).filter(QualityCapa.is_deleted == False)  # noqa: E712
    if action_type:
        query = query.filter(QualityCapa.action_type == action_type)
    if status_filter:
        query = query.filter(QualityCapa.status == status_filter)
    if ncr_id:
        query = query.filter(QualityCapa.ncr_id == ncr_id)
    capas = query.order_by(QualityCapa.created_at.desc()).all()
    return [_to_response(db, c) for c in capas]


@router.post("", response_model=QualityCapaResponse)
async def create_capa(
    payload: QualityCapaCreate,
    db: Session = Depends(get_db),
):
    if payload.action_type not in QUALITY_CAPA_ACTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid action_type '{payload.action_type}'")
    if payload.ncr_id is not None and not db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.id == payload.ncr_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"NCR #{payload.ncr_id} not found")

    capa = QualityCapa(
        capa_number=generate_capa_number(db),
        action_type=payload.action_type,
        ncr_id=payload.ncr_id,
        complaint_id=payload.complaint_id,
        title=payload.title,
        root_cause=payload.root_cause,
        action_plan=payload.action_plan,
        responsible_user_id=payload.responsible_user_id,
        due_date=payload.due_date,
        status="open",
    )
    db.add(capa)
    db.commit()
    db.refresh(capa)
    return _to_response(db, capa)


@router.get("/{capa_id}", response_model=QualityCapaResponse)
async def get_capa(capa_id: int, db: Session = Depends(get_db)):
    capa = _get_or_404(db, capa_id)
    return _to_response(db, capa)


@router.patch("/{capa_id}", response_model=QualityCapaResponse)
async def update_capa(
    capa_id: int,
    payload: QualityCapaUpdate,
    db: Session = Depends(get_db),
):
    capa = _get_or_404(db, capa_id)
    updates = payload.model_dump(exclude_unset=True)

    new_action_type = updates.get("action_type")
    if new_action_type and new_action_type not in QUALITY_CAPA_ACTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid action_type '{new_action_type}'")
    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_CAPA_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_ncr_id = updates.get("ncr_id")
    if new_ncr_id is not None and not db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.id == new_ncr_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"NCR #{new_ncr_id} not found")

    if new_status == "closed" and capa.closed_at is None:
        capa.closed_at = datetime.now(timezone.utc)

    for field, val in updates.items():
        setattr(capa, field, val)

    db.commit()
    db.refresh(capa)
    return _to_response(db, capa)


@router.delete("/{capa_id}")
async def delete_capa(capa_id: int, db: Session = Depends(get_db)):
    capa = _get_or_404(db, capa_id)
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    capa.is_deleted = True
    capa.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "CAPA deleted"}
