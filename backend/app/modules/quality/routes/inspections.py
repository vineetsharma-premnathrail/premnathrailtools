from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_can_delete, ensure_tab_action, require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import (
    QualityInspection, QualityInspectionResult, QUALITY_INSPECTION_STATUSES, QUALITY_INSPECTION_RESULT_VALUES,
)
from app.modules.quality.models.inspection_plan import QualityInspectionPlan
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


def _get_or_404(db: Session, inspection_id: int, user: User | None = None) -> QualityInspection:
    inspection = db.query(QualityInspection).options(
        selectinload(QualityInspection.results),
        selectinload(QualityInspection.attachments),
    ).filter(QualityInspection.id == inspection_id, QualityInspection.is_deleted == False).first()  # noqa: E712
    if not inspection:
        raise HTTPException(status_code=404, detail=f"Inspection #{inspection_id} not found — it may have been deleted. Reload the list.")
    if user is not None:
        ensure_in_scope(db, user, inspection)
    return inspection


@router.get("", response_model=list[QualityInspectionResponse])
async def list_inspections(
    inspection_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    query = apply_scope(db.query(QualityInspection).options(
        selectinload(QualityInspection.results),
        selectinload(QualityInspection.attachments),
    ).filter(QualityInspection.is_deleted == False), user, QualityInspection)  # noqa: E712
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
    if payload.inspection_type not in _TYPE_CODES:
        raise HTTPException(status_code=400, detail=f"Invalid inspection_type '{payload.inspection_type}'")
    if payload.inspection_type == "incoming":
        # Retired (Quality Phase 1): incoming inspection is an inspection lot
        # created automatically from the GRN, with stock held in Quality.
        raise HTTPException(status_code=410, detail="Free-text incoming inspections are retired — incoming lots are created automatically from the GRN for items flagged 'inspection on receipt'. Use Quality → Inspection Lots.")
    if payload.inspection_type == "in_process":
        # Retired (Quality Phase 2): in-process inspection is an inspection lot
        # raised by Production's "Request Inspection" on a gated step.
        raise HTTPException(status_code=410, detail="Free-text in-process inspections are retired — Production's 'Request Inspection' on a gated routing step raises an in-process inspection lot (Quality → In-process Inspections), or create a manual lot in Quality → Inspection Lots.")
    if payload.inspection_plan_id is not None and not db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.id == payload.inspection_plan_id, QualityInspectionPlan.is_deleted == False  # noqa: E712
    ).first():
        raise HTTPException(status_code=404, detail=f"Inspection plan #{payload.inspection_plan_id} not found")

    ensure_tab_action(user, "quality", _LEGACY_INSPECTION_TAB.get(payload.inspection_type, "inspection_lots"), "create")
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
async def get_inspection(inspection_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    inspection = _get_or_404(db, inspection_id, user)
    return _to_response(db, inspection)


@router.patch("/{inspection_id}", response_model=QualityInspectionResponse)
async def update_inspection(
    inspection_id: int,
    payload: QualityInspectionUpdate,
    db: Session = Depends(get_db), user: User = Depends(require_app_access("quality")),
):
    inspection = _get_or_404(db, inspection_id, user)
    # Recording results / changing a legacy inspection needs 'Edit' on the
    # tab its inspection type belongs to (same mapping as delete below).
    ensure_tab_action(user, "quality", _LEGACY_INSPECTION_TAB.get(inspection.inspection_type, "inspection_lots"), "edit")
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_INSPECTION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
    new_plan_id = updates.get("inspection_plan_id")
    if new_plan_id is not None and not db.query(QualityInspectionPlan).filter(QualityInspectionPlan.is_deleted == False, QualityInspectionPlan.id == new_plan_id).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Inspection plan #{new_plan_id} not found")

    results = updates.pop("results", None)
    if inspection.status in _DECIDED_STATUSES:
        # A decided inspection is a quality record (it releases a production /
        # RRV gate): only remarks may still change. The edit form re-sends
        # every field, so only fields whose value actually changes count.
        changed = sorted(f for f, v in updates.items() if f != "remarks" and getattr(inspection, f) != v)
        if results is not None:
            def _key(r):
                return (r.get("parameter"), r.get("method"), r.get("acceptance_criteria"), r.get("observed_value"), r.get("result"))
            old = [_key({c: getattr(r, c) for c in ("parameter", "method", "acceptance_criteria", "observed_value", "result")})
                   for r in sorted(inspection.results, key=lambda r: (r.sort_order, r.id))]
            if old != [_key(r) for r in sorted(results, key=lambda r: r.get("sort_order", 0))]:
                changed.append("results")
        if changed:
            raise HTTPException(
                status_code=409,
                detail=f"Inspection {inspection.inspection_number} is already {inspection.status.replace('_', ' ')}, so its "
                       f"{', '.join(c.replace('_', ' ') for c in changed)} can't be changed — a decided inspection is a quality record. "
                       "Only remarks can be added. If the decision was wrong, request a fresh inspection (re-inspection) instead.",
            )
        results = None
    status_changed = new_status is not None and new_status != inspection.status
    for field, val in updates.items():
        setattr(inspection, field, val)
    if status_changed:
        # If this inspection is a Production quality gate, tell the work
        # order's supervisor the step can be completed (or must be reworked).
        from app.modules.production.service import notify_inspection_result
        notify_inspection_result(db, inspection)

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


_DECIDED_STATUSES = ("passed", "failed", "conditionally_passed")

_LEGACY_INSPECTION_TAB = {
    "incoming": "inspection_lots", "job_work": "inspection_lots", "first_article": "first_article",
    "in_process": "in_process_inspection", "final": "final_inspection",
}


@router.delete("/{inspection_id}")
async def delete_inspection(
    inspection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    inspection = _get_or_404(db, inspection_id, user)
    # Legacy single inspections: the tab follows the inspection type. They
    # carry no creator column, so anyone with 'Delete' on that tab may delete.
    tab = _LEGACY_INSPECTION_TAB.get(inspection.inspection_type, "inspection_lots")
    ensure_can_delete(user, inspection, "quality", tab, what="inspection")
    if inspection.status in _DECIDED_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Inspection {inspection.inspection_number} is already {inspection.status.replace('_', ' ')} — a decided "
                   "inspection is a quality record (it may have released a production / RRV gate) and can't be deleted.",
        )
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    inspection.is_deleted = True
    inspection.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Inspection deleted"}
