"""CAPA (8D) register and workflow endpoints. Rules live in services/capa.py."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_feature_action, require_app_access, require_feature_action, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.capa import (
    QualityCapa, QualityCapaAction, QUALITY_CAPA_STATUSES, QUALITY_CAPA_STATUS_LABELS, QUALITY_CAPA_TRIGGER_LABELS,
    QUALITY_CAPA_PREVENTION_LABELS, QUALITY_FISHBONE_CATEGORIES, QUALITY_CAPA_TEAM_ROLES, QUALITY_CAPA_OPEN_STATUSES,
)
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.schemas.capa import (
    QualityCapaCreate, QualityCapaUpdate, QualityCapaResponse, QualityCapaTeamPayload, QualityCapaLinkNcrPayload,
    QualityCapaActionPayload, QualityCapaActionDonePayload, QualityCapaReasonPayload, QualityCapaEffectivenessPayload,
    QualityCapaActionResponse, QualityCapaTeamMemberResponse,
)
from app.modules.quality.services import access, authz, capa as capa_service
from app.modules.quality.services.capa import CapaError

router = APIRouter(prefix="/quality/capa", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "capa", "create")
_CAN_EDIT = require_tab_action("quality", "capa", "edit")

_OPTIONS = (selectinload(QualityCapa.team), selectinload(QualityCapa.actions), selectinload(QualityCapa.ncr_links))


def _to_response(db: Session, capa: QualityCapa, detail: bool = True) -> QualityCapaResponse:
    resp = QualityCapaResponse.model_validate(capa)
    today = date.today()
    uids = {capa.responsible_user_id, capa.effectiveness_checked_by_id}
    if detail:
        uids |= {m.user_id for m in capa.team} | {a.owner_id for a in capa.actions} | {a.done_by_id for a in capa.actions}
    uids.discard(None)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    resp.responsible_user_name = users.get(capa.responsible_user_id)
    resp.effectiveness_checked_by_name = users.get(capa.effectiveness_checked_by_id)
    resp.overdue = capa_service.is_overdue(capa, today)
    resp.open_actions = sum(1 for a in capa.actions if a.status == "open" and not a.superseded)
    if capa.defect_code_id:
        code = db.query(QualityDefectCode).filter(QualityDefectCode.id == capa.defect_code_id).first()
        resp.defect_code_label = f"{code.code} — {code.name}" if code else None
    if capa.complaint_id:
        resp.complaint_number = db.query(QualityCustomerComplaint.complaint_number).filter(
            QualityCustomerComplaint.id == capa.complaint_id).scalar()
    ncrs = capa_service.linked_ncrs(db, capa) if (detail or capa.ncr_id) else []
    resp.ncr_number = next((n.ncr_number for n in ncrs if n.id == capa.ncr_id), None)
    if not detail:
        resp.team, resp.actions = [], []
        return resp
    resp.team = [QualityCapaTeamMemberResponse(id=m.id, user_id=m.user_id, role=m.role, department=m.department,
                                               user_name=users.get(m.user_id)) for m in capa.team]
    acts = []
    for a in capa.actions:
        r = QualityCapaActionResponse.model_validate(a)
        r.owner_name = users.get(a.owner_id)
        r.done_by_name = users.get(a.done_by_id)
        r.overdue = a.status == "open" and not a.superseded and a.due_date < today
        acts.append(r)
    resp.actions = acts
    resp.ncrs = [{"id": n.id, "ncr_number": n.ncr_number, "severity": n.severity, "status": n.status, "ncr_date": n.ncr_date,
                  "quantity": n.quantity, "uom": n.uom, "item_name": n.item_name} for n in ncrs]
    resp.recurrences = [{"id": n.id, "ncr_number": n.ncr_number, "ncr_date": n.ncr_date} for n in capa_service.recurrences(db, capa)]
    return resp


def _get_or_404(db: Session, capa_id: int, user: User | None = None, lock: bool = False) -> QualityCapa:
    q = db.query(QualityCapa).options(*_OPTIONS).filter(QualityCapa.is_deleted == False, QualityCapa.id == capa_id)  # noqa: E712
    capa = (q.with_for_update() if lock else q).first()
    if not capa:
        raise HTTPException(status_code=404, detail=f"CAPA #{capa_id} not found — it may have been removed. Refresh the page.")
    if user is not None:
        ensure_in_scope(db, user, capa)
    return capa


def _run(db: Session, capa_id: int, fn) -> QualityCapaResponse:
    try:
        fn()
    except CapaError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.expire_all()
    return _to_response(db, _get_or_404(db, capa_id))


@router.get("/meta")
async def capa_meta():
    return {"statuses": QUALITY_CAPA_STATUS_LABELS, "triggers": QUALITY_CAPA_TRIGGER_LABELS,
            "prevention_types": QUALITY_CAPA_PREVENTION_LABELS, "fishbone_categories": list(QUALITY_FISHBONE_CATEGORIES),
            "team_roles": list(QUALITY_CAPA_TEAM_ROLES)}


@router.get("", response_model=list[QualityCapaResponse])
async def list_capas(
    status_filter: str | None = Query(None, alias="status"), trigger: str | None = None, open_only: bool = False,
    overdue_only: bool = False, mine: bool = False, ncr_id: int | None = None, vendor_name: str | None = None,
    search: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality")),
):
    q = apply_scope(db.query(QualityCapa).options(*_OPTIONS).filter(QualityCapa.is_deleted == False), user, QualityCapa)  # noqa: E712
    if status_filter:
        if status_filter not in QUALITY_CAPA_STATUSES:
            raise HTTPException(status_code=422, detail=f"Unknown CAPA status '{status_filter}'.")
        q = q.filter(QualityCapa.status == status_filter)
    if open_only:
        q = q.filter(QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES))
    if trigger:
        q = q.filter(QualityCapa.trigger == trigger)
    if vendor_name:
        q = q.filter(QualityCapa.vendor_name.ilike(vendor_name.strip()))
    if search:
        like = f"%{search}%"
        q = q.filter(QualityCapa.capa_number.ilike(like) | QualityCapa.title.ilike(like) | QualityCapa.item_name.ilike(like))
    capas = q.order_by(QualityCapa.created_at.desc()).all()
    if ncr_id:
        capas = [c for c in capas if c.ncr_id == ncr_id or any(l.ncr_id == ncr_id for l in c.ncr_links)]
    if mine:
        capas = [c for c in capas if c.responsible_user_id == user.id or any(m.user_id == user.id for m in c.team)
                 or any(a.owner_id == user.id and a.status == "open" for a in c.actions)]
    if overdue_only:
        capas = [c for c in capas if capa_service.is_overdue(c)]
    return [_to_response(db, c, detail=False) for c in capas]


@router.post("", response_model=QualityCapaResponse)
async def create_capa(payload: QualityCapaCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    authz.ensure_may_assign(db, user, authz.CAPA_OWNER_RULE, payload.responsible_user_id)
    try:
        capa = capa_service.create_manual(db, payload.model_dump(), user)
    except CapaError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return _to_response(db, _get_or_404(db, capa.id))


@router.get("/{capa_id}", response_model=QualityCapaResponse)
async def get_capa(capa_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return _to_response(db, _get_or_404(db, capa_id, user))


@router.patch("/{capa_id}", response_model=QualityCapaResponse)
async def update_capa(capa_id: int, payload: QualityCapaUpdate, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    capa = _get_or_404(db, capa_id, user, lock=True)
    authz.ensure_may_assign(db, user, authz.CAPA_OWNER_RULE, payload.responsible_user_id, capa.responsible_user_id)
    return _run(db, capa_id, lambda: capa_service.update(db, capa, payload.model_dump(exclude_unset=True), user))


@router.put("/{capa_id}/team", response_model=QualityCapaResponse)
async def set_team(capa_id: int, payload: QualityCapaTeamPayload, db: Session = Depends(get_db), user: User = Depends(require_feature_action("quality", "capa", "team", "edit"))):
    capa = _get_or_404(db, capa_id, user, lock=True)
    current = {m.user_id for m in capa.team}
    for m in payload.members:  # only people being added — existing members stay
        if m.user_id not in current:
            authz.ensure_may_assign(db, user, authz.CAPA_TEAM_RULE, m.user_id)
    return _run(db, capa_id, lambda: capa_service.set_team(db, capa, [m.model_dump() for m in payload.members], user))


@router.post("/{capa_id}/ncrs", response_model=QualityCapaResponse)
async def link_ncr(capa_id: int, payload: QualityCapaLinkNcrPayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    capa = _get_or_404(db, capa_id, user, lock=True)
    return _run(db, capa_id, lambda: capa_service.add_ncr(db, capa, payload.ncr_id, user))


@router.post("/{capa_id}/actions", response_model=QualityCapaResponse)
async def add_action(capa_id: int, payload: QualityCapaActionPayload, db: Session = Depends(get_db), user: User = Depends(require_feature_action("quality", "capa", "actions", "create"))):
    capa = _get_or_404(db, capa_id, user, lock=True)
    authz.ensure_may_assign(db, user, authz.CAPA_ACTION_RULE, payload.owner_id)
    return _run(db, capa_id, lambda: capa_service.add_action(db, capa, payload.model_dump(), user))


def _action(capa: QualityCapa, action_id: int) -> QualityCapaAction:
    act = next((a for a in capa.actions if a.id == action_id), None)
    if not act:
        raise HTTPException(status_code=404, detail=f"Action #{action_id} isn't on {capa.capa_number}.")
    return act


@router.post("/{capa_id}/actions/{action_id}/done", response_model=QualityCapaResponse)
async def complete_action(capa_id: int, action_id: int, payload: QualityCapaActionDonePayload, db: Session = Depends(get_db),
                          user: User = Depends(require_app_access("quality"))):
    # The action owner may be outside Quality's matrix grants; the service
    # allows the owner or a Quality engineer / head.
    capa = _get_or_404(db, capa_id, user, lock=True)
    act = _action(capa, action_id)
    return _run(db, capa_id, lambda: capa_service.complete_action(
        db, capa, act, evidence=payload.evidence, evidence_reference=payload.evidence_reference, user=user))


@router.post("/{capa_id}/actions/{action_id}/cancel", response_model=QualityCapaResponse)
async def cancel_action(capa_id: int, action_id: int, payload: QualityCapaReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_feature_action("quality", "capa", "actions", "cancel"))):
    capa = _get_or_404(db, capa_id, user, lock=True)
    act = _action(capa, action_id)
    return _run(db, capa_id, lambda: capa_service.cancel_action(db, capa, act, reason=payload.reason, user=user))


@router.post("/{capa_id}/advance", response_model=QualityCapaResponse)
async def advance(capa_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    capa = _get_or_404(db, capa_id, user, lock=True)
    return _run(db, capa_id, lambda: capa_service.advance(db, capa, user))


@router.post("/{capa_id}/effectiveness", response_model=QualityCapaResponse)
async def effectiveness(capa_id: int, payload: QualityCapaEffectivenessPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_app_access("quality"))):
    """The D8 verdict — a Quality head's one-click decision, recorded in
    Organization › Approval Workflows › CAPA effectiveness (D8)."""
    ensure_feature_action(user, "quality", "capa", "effectiveness", "approve")
    capa = _get_or_404(db, capa_id, user, lock=True)
    if not access.can_close_capa(user):
        raise HTTPException(status_code=403, detail="Only a Quality head can record the D8 effectiveness check and close a CAPA.")
    if capa.status != "effectiveness_check":
        raise HTTPException(status_code=409, detail=f"{capa.capa_number} isn't waiting for its effectiveness check "
                                                    f"(status: {QUALITY_CAPA_STATUS_LABELS.get(capa.status, capa.status)}).")
    verdict = "effective" if payload.effective else "not effective"
    authz.one_click(db, authz.CAPA_KEY, entity_id=capa.id, actor=user, title=f"{capa.capa_number} — D8 verdict: {verdict}",
                    reference=capa.capa_number, context={"effective": bool(payload.effective)},
                    proposal={"effective": bool(payload.effective), "remarks": payload.remarks},
                    comment=(payload.remarks or "").strip() or None)
    db.commit()
    db.expire_all()
    return _to_response(db, _get_or_404(db, capa_id))


@router.post("/{capa_id}/reopen", response_model=QualityCapaResponse)
async def reopen(capa_id: int, payload: QualityCapaReasonPayload, db: Session = Depends(get_db),
                 user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "capa", "effectiveness", "approve")
    capa = _get_or_404(db, capa_id, user, lock=True)
    return _run(db, capa_id, lambda: capa_service.reopen(db, capa, reason=payload.reason, user=user))
