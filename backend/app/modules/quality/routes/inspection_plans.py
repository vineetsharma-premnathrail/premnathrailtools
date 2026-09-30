from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection_plan import (
    QualityInspectionPlan, QUALITY_INSPECTION_TYPES, QUALITY_INSPECTION_PLAN_STATUSES,
)
from app.modules.quality.models.quality_checklist import QualityChecklist
from app.modules.quality.models.quality_standard import QualityStandard
from app.modules.quality.schemas.inspection_plan import (
    QualityInspectionPlanCreate, QualityInspectionPlanUpdate, QualityInspectionPlanResponse,
)
from app.modules.quality.service import generate_inspection_plan_number

router = APIRouter(
    prefix="/quality/inspection-plans", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, plan: QualityInspectionPlan) -> QualityInspectionPlanResponse:
    resp = QualityInspectionPlanResponse.model_validate(plan)
    if plan.checklist_id:
        checklist = db.query(QualityChecklist).filter(QualityChecklist.id == plan.checklist_id).first()
        if checklist:
            resp.checklist_name = checklist.name
    if plan.standard_id:
        standard = db.query(QualityStandard).filter(QualityStandard.id == plan.standard_id).first()
        if standard:
            resp.standard_code = standard.standard_code
    return resp


def _get_or_404(db: Session, plan_id: int) -> QualityInspectionPlan:
    plan = db.query(QualityInspectionPlan).filter(QualityInspectionPlan.is_deleted == False, QualityInspectionPlan.id == plan_id).first()  # noqa: E712
    if not plan:
        raise HTTPException(status_code=404, detail="Inspection plan not found")
    return plan


@router.get("", response_model=list[QualityInspectionPlanResponse])
async def list_inspection_plans(
    inspection_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(QualityInspectionPlan).filter(QualityInspectionPlan.is_deleted == False)  # noqa: E712
    if inspection_type:
        query = query.filter(QualityInspectionPlan.inspection_type == inspection_type)
    if status_filter:
        query = query.filter(QualityInspectionPlan.status == status_filter)
    plans = query.order_by(QualityInspectionPlan.created_at.desc()).all()
    return [_to_response(db, p) for p in plans]


@router.post("", response_model=QualityInspectionPlanResponse)
async def create_inspection_plan(
    payload: QualityInspectionPlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.inspection_type not in QUALITY_INSPECTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid inspection_type '{payload.inspection_type}'")
    if payload.checklist_id is not None and not db.query(QualityChecklist).filter(QualityChecklist.is_deleted == False, QualityChecklist.id == payload.checklist_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Checklist #{payload.checklist_id} not found")
    if payload.standard_id is not None and not db.query(QualityStandard).filter(QualityStandard.is_deleted == False, QualityStandard.id == payload.standard_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Standard #{payload.standard_id} not found")

    plan = QualityInspectionPlan(
        plan_number=generate_inspection_plan_number(db),
        item_name=payload.item_name,
        item_code=payload.item_code,
        inspection_type=payload.inspection_type,
        checklist_id=payload.checklist_id,
        standard_id=payload.standard_id,
        sampling_plan=payload.sampling_plan,
        created_by_id=user.id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _to_response(db, plan)


@router.get("/{plan_id}", response_model=QualityInspectionPlanResponse)
async def get_inspection_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = _get_or_404(db, plan_id)
    return _to_response(db, plan)


@router.patch("/{plan_id}", response_model=QualityInspectionPlanResponse)
async def update_inspection_plan(
    plan_id: int,
    payload: QualityInspectionPlanUpdate,
    db: Session = Depends(get_db),
):
    plan = _get_or_404(db, plan_id)
    updates = payload.model_dump(exclude_unset=True)

    new_type = updates.get("inspection_type")
    if new_type and new_type not in QUALITY_INSPECTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid inspection_type '{new_type}'")
    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_INSPECTION_PLAN_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_checklist_id = updates.get("checklist_id")
    if new_checklist_id is not None and not db.query(QualityChecklist).filter(QualityChecklist.is_deleted == False, QualityChecklist.id == new_checklist_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Checklist #{new_checklist_id} not found")
    new_standard_id = updates.get("standard_id")
    if new_standard_id is not None and not db.query(QualityStandard).filter(QualityStandard.is_deleted == False, QualityStandard.id == new_standard_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Standard #{new_standard_id} not found")

    for field, val in updates.items():
        setattr(plan, field, val)

    db.commit()
    db.refresh(plan)
    return _to_response(db, plan)


@router.delete("/{plan_id}")
async def delete_inspection_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = _get_or_404(db, plan_id)
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    plan.is_deleted = True
    plan.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Inspection plan deleted"}
