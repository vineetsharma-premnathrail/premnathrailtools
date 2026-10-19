"""NCR register and workflow endpoints. Rules live in services/ncr.py."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import ensure_can_delete, ensure_feature_action, require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.masters import QualityDefectCode, QualityDispositionCode, QUALITY_DISPOSITION_TYPE_LABELS
from app.modules.quality.models.ncr import (
    QualityNcr, QUALITY_NCR_SEVERITIES, QUALITY_NCR_STATUSES, QUALITY_NCR_APPROVAL_ROLE_LABELS,
)
from app.modules.quality.schemas.ncr import (
    QualityNcrCreate, QualityNcrUpdate, QualityNcrResponse, QualityNcrProposePayload, QualityNcrApprovePayload,
    QualityNcrActionPayload, QualityNcrVerifyPayload, QualityNcrClosePayload, QualityNcrCancelPayload,
)
from app.modules.quality.services import ncr as ncr_service
from app.modules.quality.services.ncr import NcrError
from app.modules.quality.services import authz
from app.modules.store.models.location import StoreLocation

router = APIRouter(prefix="/quality/ncr", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "ncr", "create")


def _mask_costs(resp: QualityNcrResponse, user: User | None) -> QualityNcrResponse:
    """Blank the money fields for a user without the NCR costs switch. An NCR
    also opens for approvers outside the NCR tab (Design, Purchase, Partner
    stages), so the switch binds roles that hold the NCR tab."""
    if (user is not None and can_view_tab(user, "quality", "ncr")
            and not can_feature(user, "quality", "ncr", "costs", "view")):
        resp.estimated_value = resp.material_cost = resp.rework_cost = resp.other_cost = resp.cost_of_non_quality = None
    return resp


def _to_response(db: Session, ncr: QualityNcr, detail: bool = True, user: User | None = None) -> QualityNcrResponse:
    resp = QualityNcrResponse.model_validate(ncr)
    uids = {ncr.raised_by_id} | ({a.approved_by_id for a in ncr.approvals} if detail else set())
    uids.discard(None)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    resp.raised_by_name = users.get(ncr.raised_by_id)
    resp.disposition_label = QUALITY_DISPOSITION_TYPE_LABELS.get(ncr.disposition_type) if ncr.disposition_type else None
    resp.cost_of_non_quality = ncr_service.cost_of_non_quality(ncr)
    if not detail:
        resp.approvals = []
        return _mask_costs(resp, user)
    for a in resp.approvals:
        a.approved_by_name = users.get(a.approved_by_id)
    if ncr.inspection_id:
        insp = db.query(QualityInspection).filter(QualityInspection.id == ncr.inspection_id).first()
        resp.inspection_number = insp.inspection_number if insp else None
    for attr, target in (("lot_id", "lot_number"), ("reinspection_lot_id", "reinspection_lot_number")):
        lid = getattr(ncr, attr)
        if lid:
            lot = db.query(QualityInspectionLot.lot_number).filter(QualityInspectionLot.id == lid).first()
            setattr(resp, target, lot[0] if lot else None)
    if ncr.location_id:
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == ncr.location_id).first()
        resp.location_name = loc[0] if loc else None
    if ncr.defect_code_id:
        code = db.query(QualityDefectCode).filter(QualityDefectCode.id == ncr.defect_code_id).first()
        resp.defect_code_label = f"{code.code} — {code.name}" if code else None
    if ncr.disposition_code_id:
        dc = db.query(QualityDispositionCode).filter(QualityDispositionCode.id == ncr.disposition_code_id).first()
        if dc:
            resp.disposition_label = f"{dc.code} — {dc.name}"
    req = ncr_service.engine_request(db, ncr)
    if req is not None and ncr.disposition_type:
        resp.required_roles, pending = authz.ncr_engine_roles(req)
        resp.pending_roles = pending if ncr.disposition_status == "pending_approval" else []
    else:
        # Legacy: disposition proposed before the central approval engine.
        resp.required_roles = ncr_service.required_roles(db, ncr) if ncr.disposition_type else []
        resp.pending_roles = ncr_service.pending_roles(db, ncr) if ncr.disposition_status == "pending_approval" else []
    resp.legacy_approval = req is None and ncr.disposition_status == "pending_approval"
    from app.modules.quality.services.capa import covering_capas, ncr_closure_problem
    capas = covering_capas(db, ncr)
    resp.capa_ids = [c.id for c in capas]
    resp.capas = [{"id": c.id, "capa_number": c.capa_number, "status": c.status} for c in capas]
    resp.closure_problem = ncr_closure_problem(db, ncr) if ncr.status == "verified" else None
    resp.scrap_value_limit = authz.scrap_partner_limit(db)
    return _mask_costs(resp, user)


def _get_or_404(db: Session, ncr_id: int, user: User | None = None, lock: bool = False) -> QualityNcr:
    q = db.query(QualityNcr).options(selectinload(QualityNcr.approvals)).filter(QualityNcr.is_deleted == False, QualityNcr.id == ncr_id)  # noqa: E712
    ncr = (q.with_for_update() if lock else q).first()
    if not ncr:
        raise HTTPException(status_code=404, detail=f"NCR #{ncr_id} not found — it may have been deleted. Reload the NCR register.")
    if user is not None:
        ensure_in_scope(db, user, ncr)
    return ncr


def _run(db: Session, fn):
    try:
        result = fn()
    except NcrError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return result


def _detail(db: Session, ncr_id: int, user: User | None = None) -> QualityNcrResponse:
    db.expire_all()
    return _to_response(db, _get_or_404(db, ncr_id), user=user)


@router.get("/meta")
async def ncr_meta():
    return {"statuses": list(QUALITY_NCR_STATUSES), "severities": list(QUALITY_NCR_SEVERITIES),
            "approval_roles": QUALITY_NCR_APPROVAL_ROLE_LABELS, "disposition_types": QUALITY_DISPOSITION_TYPE_LABELS}


@router.get("", response_model=list[QualityNcrResponse])
async def list_ncrs(
    status_filter: str | None = Query(None, alias="status"), severity: str | None = None, open_only: bool = False,
    awaiting_my_approval: bool = False, search: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(require_app_access("quality")),
):
    query = apply_scope(db.query(QualityNcr).options(selectinload(QualityNcr.approvals)).filter(QualityNcr.is_deleted == False), user, QualityNcr)  # noqa: E712
    if status_filter:
        query = query.filter(QualityNcr.status == status_filter)
    if open_only:
        query = query.filter(QualityNcr.status.notin_(("closed", "cancelled")))
    if severity:
        query = query.filter(QualityNcr.severity == severity)
    if search:
        like = f"%{search}%"
        query = query.filter(QualityNcr.item_name.ilike(like) | QualityNcr.ncr_number.ilike(like)
                             | QualityNcr.description.ilike(like) | QualityNcr.vendor_name.ilike(like))
    ncrs = query.order_by(QualityNcr.created_at.desc()).all()
    if awaiting_my_approval:
        from app.modules.organization.services.approval_engine import can_act_on_entity
        ncrs = [n for n in ncrs if n.disposition_status == "pending_approval" and (
            can_act_on_entity(db, user, authz.NCR_ENTITY, n.id) if ncr_service.engine_request(db, n) is not None
            else any(ncr_service._role_holder(user, r) for r in ncr_service.pending_roles(db, n)))]
    return [_to_response(db, n, detail=False, user=user) for n in ncrs]


@router.post("", response_model=QualityNcrResponse)
async def create_ncr(payload: QualityNcrCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    ncr = _run(db, lambda: ncr_service.create_manual(db, payload.model_dump(), user))
    return _detail(db, ncr.id, user)


@router.get("/{ncr_id}", response_model=QualityNcrResponse)
async def get_ncr(ncr_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return _to_response(db, _get_or_404(db, ncr_id, user), user=user)


@router.patch("/{ncr_id}", response_model=QualityNcrResponse)
async def update_ncr(ncr_id: int, payload: QualityNcrUpdate, db: Session = Depends(get_db),
                     _user: User = Depends(require_tab_action("quality", "ncr", "edit"))):
    ncr = _get_or_404(db, ncr_id, _user)
    if ncr.status != "open":
        raise HTTPException(status_code=409, detail=f"{ncr.ncr_number} is {ncr.status.replace('_', ' ')} — its details are frozen once a disposition is decided. Add notes on the action / verification instead.")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("severity") and updates["severity"] not in QUALITY_NCR_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"Invalid severity '{updates['severity']}' — use minor, major or critical.")
    if ncr.disposition_status == "pending_approval" and "severity" in updates and updates["severity"] != ncr.severity:
        raise HTTPException(status_code=409, detail="Severity can't change while a disposition is waiting for approval — the required approvals depend on it.")
    for field, val in updates.items():
        setattr(ncr, field, val)
    db.commit()
    return _detail(db, ncr.id, _user)


@router.post("/{ncr_id}/propose-disposition", response_model=QualityNcrResponse)
async def propose(ncr_id: int, payload: QualityNcrProposePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "ncr", "disposition", "submit")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.propose_disposition(
        db, ncr, disposition_code_id=payload.disposition_code_id, remarks=payload.remarks,
        customer_approval_required=payload.customer_approval_required,
        customer_approval_reference=payload.customer_approval_reference, user=user))
    return _detail(db, ncr_id, user)


@router.post("/{ncr_id}/approve-disposition", response_model=QualityNcrResponse)
async def approve(ncr_id: int, payload: QualityNcrApprovePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    # Design / Purchase / Partner approvers may hold no NCR tab at all — the
    # disposition switch binds roles that do; the stage's role check still applies.
    if can_view_tab(user, "quality", "ncr"):
        ensure_feature_action(user, "quality", "ncr", "disposition", "approve" if payload.approve else "reject")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.approve_disposition(db, ncr, role=payload.role, approve=payload.approve, remarks=payload.remarks, user=user))
    return _detail(db, ncr_id, user)


@router.post("/{ncr_id}/action", response_model=QualityNcrResponse)
async def action(ncr_id: int, payload: QualityNcrActionPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "ncr", "action_verify", "edit")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.execute_action(db, ncr, action_reference=payload.action_reference, remarks=payload.remarks, user=user))
    return _detail(db, ncr_id, user)


@router.post("/{ncr_id}/verify", response_model=QualityNcrResponse)
async def verify(ncr_id: int, payload: QualityNcrVerifyPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "ncr", "action_verify", "edit")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.verify(db, ncr, remarks=payload.remarks, user=user))
    return _detail(db, ncr_id, user)


@router.post("/{ncr_id}/close", response_model=QualityNcrResponse)
async def close(ncr_id: int, payload: QualityNcrClosePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "ncr", "closure", "approve")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.close(db, ncr, material_cost=payload.material_cost, rework_cost=payload.rework_cost,
                                       other_cost=payload.other_cost, root_cause=payload.root_cause, user=user))
    return _detail(db, ncr_id, user)


@router.post("/{ncr_id}/cancel", response_model=QualityNcrResponse)
async def cancel(ncr_id: int, payload: QualityNcrCancelPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "ncr", "closure", "cancel")
    ncr = _get_or_404(db, ncr_id, user, lock=True)
    _run(db, lambda: ncr_service.cancel(db, ncr, reason=payload.reason, user=user))
    return _detail(db, ncr_id, user)


@router.delete("/{ncr_id}")
async def delete_ncr(ncr_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    ncr = _get_or_404(db, ncr_id, user)
    ensure_can_delete(user, ncr, "quality", "ncr", what="NCR")
    # Only a manual NCR still open with nothing decided may be removed
    # (soft delete, audit-logged) — everything else is a quality record.
    if ncr.auto_raised or ncr.status != "open" or ncr.disposition_status != "none" or ncr.stock_blocked:
        raise HTTPException(status_code=409, detail=f"{ncr.ncr_number} is a quality record (auto-raised, holding Blocked stock, or already in disposition) — cancel it instead of deleting.")
    ncr.is_deleted = True
    ncr.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "NCR deleted"}
