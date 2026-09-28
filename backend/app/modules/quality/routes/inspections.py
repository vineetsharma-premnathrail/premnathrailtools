from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import (
    QualityInspection, QualityInspectionResult, QUALITY_INSPECTION_STATUSES, QUALITY_INSPECTION_RESULT_VALUES,
)
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPES, QualityInspectionPlan
from app.modules.quality.schemas.inspection import (
    QualityInspectionCreate, QualityInspectionUpdate, QualityInspectionResponse,
)
from app.modules.quality.service import generate_inspection_number

router = APIRouter(
    prefix="/quality/inspections", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)

# inspection_type -> number-series type code, per the Phase 1 spec.
_TYPE_CODES = {"incoming": "INC", "in_process": "PROC", "final": "FIN"}


def _to_response(db: Session, inspection: QualityInspection) -> QualityInspectionResponse:
    resp = QualityInspectionResponse.model_validate(inspection)
    if inspection.inspected_by_id:
        inspector = db.query(User).filter(User.id == inspection.inspected_by_id).first()
        if inspector:
            resp.inspected_by_name = inspector.name or inspector.email
    return resp


def _get_or_404(db: Session, inspection_id: int) -> QualityInspection:
    inspection = db.query(QualityInspection).options(
        selectinload(QualityInspection.results),
        selectinload(QualityInspection.attachments),
    ).filter(QualityInspection.id == inspection_id).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


@router.get("", response_model=list[QualityInspectionResponse])
async def list_inspections(
    inspection_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityInspection).options(
        selectinload(QualityInspection.results),
        selectinload(QualityInspection.attachments),
    )
    if inspection_type:
        query = query.filter(QualityInspection.inspection_type == inspection_type)
    if status_filter:
        query = query.filter(QualityInspection.status == status_filter)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (QualityInspection.item_name.ilike(like)) | (QualityInspection.inspection_number.ilike(like))
        )
    inspections = query.order_by(QualityInspection.created_at.desc()).all()
    return [_to_response(db, i) for i in inspections]


@router.post("", response_model=QualityInspectionResponse)
async def create_inspection(
    payload: QualityInspectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.inspection_type not in QUALITY_INSPECTION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid inspection_type '{payload.inspection_type}'")
    if payload.inspection_plan_id is not None and not db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.id == payload.inspection_plan_id
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection plan #{payload.inspection_plan_id} not found")

    type_code = _TYPE_CODES[payload.inspection_type]

    inspection = QualityInspection(
        inspection_number=generate_inspection_number(db, type_code),
        inspection_type=payload.inspection_type,
        inspection_plan_id=payload.inspection_plan_id,
        item_name=payload.item_name,
        item_code=payload.item_code,
        batch_number=payload.batch_number,
        quantity_inspected=payload.quantity_inspected,
        quantity_accepted=payload.quantity_accepted,
        quantity_rejected=payload.quantity_rejected,
        vendor_id=payload.vendor_id,
        vendor_name=payload.vendor_name,
        p2p_request_id=payload.p2p_request_id,
        project_label=payload.project_label,
        inspected_by_id=user.id,
        inspection_date=payload.inspection_date,
        remarks=payload.remarks,
        status="pending",
    )
    db.add(inspection)
    db.flush()

    for result in payload.results:
        if result.result is not None and result.result not in QUALITY_INSPECTION_RESULT_VALUES:
            raise HTTPException(status_code=400, detail=f"Invalid result value '{result.result}'")
        db.add(QualityInspectionResult(
            inspection_id=inspection.id,
            parameter=result.parameter,
            method=result.method,
            acceptance_criteria=result.acceptance_criteria,
            observed_value=result.observed_value,
            result=result.result,
            sort_order=result.sort_order,
        ))

    db.commit()
    db.refresh(inspection)
    return _to_response(db, _get_or_404(db, inspection.id))


@router.get("/{inspection_id}", response_model=QualityInspectionResponse)
async def get_inspection(inspection_id: int, db: Session = Depends(get_db)):
    inspection = _get_or_404(db, inspection_id)
    return _to_response(db, inspection)


@router.patch("/{inspection_id}", response_model=QualityInspectionResponse)
async def update_inspection(
    inspection_id: int,
    payload: QualityInspectionUpdate,
    db: Session = Depends(get_db),
):
    inspection = _get_or_404(db, inspection_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_INSPECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_plan_id = updates.get("inspection_plan_id")
    if new_plan_id is not None and not db.query(QualityInspectionPlan).filter(QualityInspectionPlan.id == new_plan_id).first():
        raise HTTPException(status_code=404, detail=f"Inspection plan #{new_plan_id} not found")

    results = updates.pop("results", None)
    for field, val in updates.items():
        setattr(inspection, field, val)

    if results is not None:
        # Replace all existing results — delete then re-insert, matching the
        # nested-item replace pattern used elsewhere in the codebase (see
        # checklists.py / p2p_requests.py update endpoints).
        for res in results:
            result_val = res.get("result")
            if result_val is not None and result_val not in QUALITY_INSPECTION_RESULT_VALUES:
                raise HTTPException(status_code=400, detail=f"Invalid result value '{result_val}'")
        for existing in list(inspection.results):
            db.delete(existing)
        db.flush()
        for res in results:
            db.add(QualityInspectionResult(
                inspection_id=inspection.id,
                parameter=res["parameter"],
                method=res.get("method"),
                acceptance_criteria=res.get("acceptance_criteria"),
                observed_value=res.get("observed_value"),
                result=res.get("result"),
                sort_order=res.get("sort_order", 0),
            ))

    db.commit()
    db.refresh(inspection)
    return _to_response(db, _get_or_404(db, inspection.id))


@router.delete("/{inspection_id}")
async def delete_inspection(inspection_id: int, db: Session = Depends(get_db)):
    inspection = _get_or_404(db, inspection_id)
    db.delete(inspection)
    db.commit()
    return {"message": "Inspection deleted"}
