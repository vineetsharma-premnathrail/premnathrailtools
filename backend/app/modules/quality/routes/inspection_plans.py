"""Inspection plans: item × inspection type × revision, draft → approved →
obsolete. Only drafts are edited; an approved plan changes via a new
revision."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.characteristic import QualityCharacteristic, QUALITY_CHARACTERISTIC_CLASSES
from app.modules.quality.models.inspection_plan import (
    QualityInspectionPlan, QualityInspectionPlanLine, QUALITY_INSPECTION_TYPES, QUALITY_INSPECTION_PLAN_STATUSES,
    QUALITY_SAMPLING_TYPES, QUALITY_INSPECTION_LEVELS, QUALITY_INSPECTION_TYPE_LABELS,
)
from app.modules.quality.schemas.inspection_plan import (
    QualityInspectionPlanCreate, QualityInspectionPlanUpdate, QualityInspectionPlanResponse,
)
from app.modules.quality.service import generate_inspection_plan_number
from app.modules.quality.services import access
from app.modules.quality.services.plans import PlanError, approve_plan, new_revision, obsolete_plan
from app.modules.quality.services.sampling import nearest_aql
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/quality/inspection-plans", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "inspection_plans", "create")
_CAN_EDIT = require_tab_action("quality", "inspection_plans", "edit")


def _to_response(db: Session, plan: QualityInspectionPlan, detail: bool = True) -> QualityInspectionPlanResponse:
    resp = QualityInspectionPlanResponse.model_validate(plan)
    resp.line_count = len(plan.lines)
    ids = {plan.created_by_id, plan.approved_by_id} - {None}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    resp.created_by_name = users.get(plan.created_by_id)
    resp.approved_by_name = users.get(plan.approved_by_id)
    if detail:
        chars = {c.id: c for c in db.query(QualityCharacteristic).filter(
            QualityCharacteristic.id.in_([l.characteristic_id for l in plan.lines])).all()} if plan.lines else {}
        for line in resp.lines:
            ch = chars.get(line.characteristic_id)
            if ch:
                line.characteristic_code, line.characteristic_name = ch.code, ch.name
                line.char_type, line.unit = ch.char_type, ch.unit
                line.effective_classification = line.classification or ch.classification
    else:
        resp.lines = []
    return resp


def _get_or_404(db: Session, plan_id: int) -> QualityInspectionPlan:
    plan = db.query(QualityInspectionPlan).options(selectinload(QualityInspectionPlan.lines)).filter(
        QualityInspectionPlan.id == plan_id, QualityInspectionPlan.is_deleted == False,  # noqa: E712
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail=f"Inspection plan #{plan_id} not found")
    return plan


def _validate_header(data: dict) -> None:
    if data.get("sampling_type") is not None and data["sampling_type"] not in QUALITY_SAMPLING_TYPES:
        raise HTTPException(status_code=422, detail="Sampling must be 'aql' (ISO 2859-1 table), 'full' (100%) or 'fixed'.")
    if data.get("inspection_level") is not None and data["inspection_level"] not in QUALITY_INSPECTION_LEVELS:
        raise HTTPException(status_code=422, detail="Inspection level must be I, II or III.")
    if data.get("aql") is not None:
        try:
            data["aql"] = nearest_aql(data["aql"])
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    if data.get("fixed_sample_size") is not None and data["fixed_sample_size"] <= 0:
        raise HTTPException(status_code=422, detail="Fixed sample size must be at least 1.")


def _set_lines(db: Session, plan: QualityInspectionPlan, lines: list) -> None:
    ids = [l.characteristic_id for l in lines]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="A characteristic can appear only once on a plan.")
    chars = {c.id: c for c in db.query(QualityCharacteristic).filter(QualityCharacteristic.id.in_(ids)).all()} if ids else {}
    plan.lines.clear()
    db.flush()
    for l in lines:
        ch = chars.get(l.characteristic_id)
        if not ch:
            raise HTTPException(status_code=422, detail=f"Characteristic #{l.characteristic_id} not found.")
        if not ch.is_active:
            raise HTTPException(status_code=422, detail=f"Characteristic '{ch.code}' is retired — pick an active one.")
        if l.classification is not None and l.classification not in QUALITY_CHARACTERISTIC_CLASSES:
            raise HTTPException(status_code=422, detail=f"'{ch.name}': classification must be critical, major or minor.")
        aql = l.aql
        if aql is not None:
            try:
                aql = nearest_aql(aql)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=f"'{ch.name}': {e}")
        if l.min_value is not None and l.max_value is not None and l.min_value > l.max_value:
            raise HTTPException(status_code=422, detail=f"'{ch.name}': min ({l.min_value:g}) is above max ({l.max_value:g}).")
        plan.lines.append(QualityInspectionPlanLine(
            characteristic_id=ch.id, sequence=l.sequence, nominal=l.nominal, min_value=l.min_value, max_value=l.max_value,
            classification=l.classification, method=l.method, aql=aql, remarks=l.remarks,
        ))


@router.get("/meta")
async def plans_meta():
    return {
        "inspection_types": [{"value": t, "label": QUALITY_INSPECTION_TYPE_LABELS[t]} for t in QUALITY_INSPECTION_TYPES],
        "statuses": list(QUALITY_INSPECTION_PLAN_STATUSES), "sampling_types": list(QUALITY_SAMPLING_TYPES),
        "inspection_levels": list(QUALITY_INSPECTION_LEVELS),
    }


@router.get("", response_model=list[QualityInspectionPlanResponse])
async def list_inspection_plans(
    status_filter: str | None = Query(None, alias="status"), inspection_type: str | None = None,
    item_id: int | None = None, search: str | None = None, db: Session = Depends(get_db),
):
    q = db.query(QualityInspectionPlan).options(selectinload(QualityInspectionPlan.lines)).filter(QualityInspectionPlan.is_deleted == False)  # noqa: E712
    if status_filter:
        q = q.filter(QualityInspectionPlan.status == status_filter)
    if inspection_type:
        q = q.filter(QualityInspectionPlan.inspection_type == inspection_type)
    if item_id:
        q = q.filter(QualityInspectionPlan.item_id == item_id)
    if search:
        like = f"%{search}%"
        q = q.filter(QualityInspectionPlan.plan_number.ilike(like) | QualityInspectionPlan.item_name.ilike(like) | QualityInspectionPlan.item_code.ilike(like))
    return [_to_response(db, p, detail=False) for p in q.order_by(QualityInspectionPlan.created_at.desc()).all()]


@router.post("", response_model=QualityInspectionPlanResponse)
async def create_inspection_plan(payload: QualityInspectionPlanCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    if payload.inspection_type not in QUALITY_INSPECTION_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid inspection type '{payload.inspection_type}'.")
    item = db.query(StoreItem).filter(StoreItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{payload.item_id} isn't in the Item Master.")
    data = payload.model_dump(exclude={"lines"})
    _validate_header(data)
    draft = db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.item_id == item.id, QualityInspectionPlan.inspection_type == payload.inspection_type,
        QualityInspectionPlan.status == "draft", QualityInspectionPlan.is_deleted == False,  # noqa: E712
    ).first()
    if draft:
        raise HTTPException(status_code=409, detail=f"Draft plan {draft.plan_number} already exists for {item.item_name} "
                                                    f"({QUALITY_INSPECTION_TYPE_LABELS[payload.inspection_type]}) — edit that draft instead.")
    current = db.query(QualityInspectionPlan).filter(
        QualityInspectionPlan.item_id == item.id, QualityInspectionPlan.inspection_type == payload.inspection_type,
        QualityInspectionPlan.status == "approved", QualityInspectionPlan.is_deleted == False,  # noqa: E712
    ).first()
    if current:
        raise HTTPException(status_code=409, detail=f"{item.item_name} already has approved plan {current.plan_number} (rev {current.revision}) "
                                                    "for this inspection type — open it and use 'New revision'.")
    plan = QualityInspectionPlan(
        plan_number=generate_inspection_plan_number(db), item_id=item.id, item_name=item.item_name, item_code=item.item_code,
        status="draft", created_by_id=user.id, **{k: v for k, v in data.items() if k != "item_id"},
    )
    db.add(plan)
    db.flush()
    _set_lines(db, plan, payload.lines)
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id))


@router.get("/{plan_id}", response_model=QualityInspectionPlanResponse)
async def get_inspection_plan(plan_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, plan_id))


@router.patch("/{plan_id}", response_model=QualityInspectionPlanResponse)
async def update_inspection_plan(plan_id: int, payload: QualityInspectionPlanUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    plan = _get_or_404(db, plan_id)
    if plan.status != "draft":
        raise HTTPException(status_code=409, detail=f"Plan {plan.plan_number} is {plan.status} — only drafts are edited. Use 'New revision' to change an approved plan.")
    data = payload.model_dump(exclude_unset=True, exclude={"lines"})
    _validate_header(data)
    for k, v in data.items():
        setattr(plan, k, v)
    if payload.lines is not None:
        _set_lines(db, plan, payload.lines)
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id))


def _plan_action(fn):
    try:
        return fn()
    except PlanError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/{plan_id}/approve", response_model=QualityInspectionPlanResponse)
async def approve_inspection_plan(plan_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    if not access.can_approve_plan(user):
        raise HTTPException(status_code=403, detail="Only a Quality head can approve inspection plans. Ask an admin to apply the Quality head role.")
    plan = _get_or_404(db, plan_id)
    _plan_action(lambda: approve_plan(db, plan, user.id))
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id))


@router.post("/{plan_id}/new-revision", response_model=QualityInspectionPlanResponse)
async def revise_inspection_plan(plan_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    plan = _get_or_404(db, plan_id)
    copy = _plan_action(lambda: new_revision(db, plan, generate_inspection_plan_number(db), user.id))
    db.commit()
    return _to_response(db, _get_or_404(db, copy.id))


@router.post("/{plan_id}/obsolete", response_model=QualityInspectionPlanResponse)
async def obsolete_inspection_plan(plan_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    if not access.can_approve_plan(user):
        raise HTTPException(status_code=403, detail="Only a Quality head can make a plan obsolete.")
    plan = _get_or_404(db, plan_id)
    _plan_action(lambda: obsolete_plan(db, plan))
    db.commit()
    return _to_response(db, _get_or_404(db, plan.id))


@router.delete("/{plan_id}")
async def delete_inspection_plan(plan_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("quality", "inspection_plans", "delete"))):
    from datetime import datetime, timezone
    plan = _get_or_404(db, plan_id)
    if plan.status != "draft":
        raise HTTPException(status_code=409, detail=f"Plan {plan.plan_number} is {plan.status} — approved/obsolete plans are kept as records. Make it obsolete instead.")
    plan.is_deleted = True
    plan.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Draft plan {plan.plan_number} deleted"}
