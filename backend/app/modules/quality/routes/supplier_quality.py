"""Supplier quality: approved vendor list, monthly vendor rating, escalation
(Partner block approval) and vendor audits. Rules live in
services/supplier_quality.py."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.first_article import QualityFirstArticle
from app.modules.quality.models.supplier_quality import (
    QualityApprovedVendor, QualitySupplierScorecard, QualityVendorStatusEvent, QualityVendorAudit,
    QUALITY_AVL_STATUSES, QUALITY_AVL_STATUS_LABELS,
)
from app.modules.quality.schemas.supplier_quality import (
    QualityApprovedVendorCreate, QualityApprovedVendorReasonPayload, QualityApprovedVendorDecisionPayload,
    QualityApprovedVendorResponse, QualityVendorStatusEventResponse, QualityRatingRunPayload,
    QualitySupplierScorecardResponse, QualityVendorAuditCreate, QualityVendorAuditCompletePayload,
    QualityVendorAuditResponse,
)
from app.modules.quality.services import access, authz, supplier_quality as sq
from app.modules.quality.services.supplier_quality import SupplierError
from app.modules.quality.services.settings import get_setting
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/quality/supplier-quality", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "supplier_quality", "create")
_CAN_EDIT = require_tab_action("quality", "supplier_quality", "edit")


def _avl_responses(db: Session, rows: list[QualityApprovedVendor], detail: bool = False) -> list[QualityApprovedVendorResponse]:
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.item_id for r in rows})).all()} if rows else {}
    uids = ({r.approved_by_id for r in rows} | {r.pending_requested_by_id for r in rows}) - {None}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    fais = {f.id: f.fai_number for f in db.query(QualityFirstArticle).filter(QualityFirstArticle.id.in_({r.fai_id for r in rows} - {None})).all()}
    today = date.today()
    out = []
    for r in rows:
        resp = QualityApprovedVendorResponse.model_validate(r)
        it = items.get(r.item_id)
        resp.item_code, resp.item_name = (it.item_code, it.item_name) if it else (None, None)
        resp.approved_by_name = users.get(r.approved_by_id)
        resp.pending_requested_by_name = users.get(r.pending_requested_by_id) if r.pending_requested_by_id else (
            "System (monthly rating)" if r.pending_action else None)
        resp.fai_number = fais.get(r.fai_id)
        resp.expired = bool(r.valid_until and r.valid_until < today and r.status == "approved")
        if detail:
            resp.legacy_pending = bool(r.pending_action) and authz.pending_request(db, authz.AVL_ENTITY, r.id) is None
            events = db.query(QualityVendorStatusEvent).filter(QualityVendorStatusEvent.avl_id == r.id).order_by(QualityVendorStatusEvent.id.desc()).all()
            eu = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_({e.user_id for e in events} - {None})).all()} if events else {}
            resp.events = []
            for e in events:
                er = QualityVendorStatusEventResponse.model_validate(e)
                er.user_name = eu.get(e.user_id) or ("System" if not e.user_id else None)
                resp.events.append(er)
        out.append(resp)
    return out


def _avl_or_404(db: Session, avl_id: int, user: User | None = None, lock: bool = False) -> QualityApprovedVendor:
    q = db.query(QualityApprovedVendor).filter(QualityApprovedVendor.id == avl_id)
    avl = (q.with_for_update() if lock else q).first()
    if not avl:
        raise HTTPException(status_code=404, detail=f"Approved vendor entry #{avl_id} not found.")
    if user is not None:
        ensure_in_scope(db, user, avl)
    return avl


def _run(db: Session, fn):
    try:
        result = fn()
    except SupplierError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.expire_all()
    return result


def _avl_detail(db: Session, avl_id: int) -> QualityApprovedVendorResponse:
    return _avl_responses(db, [_avl_or_404(db, avl_id)], detail=True)[0]


@router.get("/meta")
async def meta(db: Session = Depends(get_db)):
    return {
        "statuses": QUALITY_AVL_STATUS_LABELS,
        "limits": {"watch_below": get_setting(db, "vendor_watch_below"), "block_below": get_setting(db, "vendor_block_below"),
                   "weights": {"quality": get_setting(db, "vendor_weight_quality"), "delivery": get_setting(db, "vendor_weight_delivery"),
                               "ncr": get_setting(db, "vendor_weight_ncr")}},
        "ncr_points": sq.NCR_POINTS, "previous_period": sq.previous_period(),
    }


# --- Approved vendor list -------------------------------------------------------

@router.get("/avl", response_model=list[QualityApprovedVendorResponse])
async def list_avl(status_filter: str | None = Query(None, alias="status"), item_id: int | None = None,
                   vendor: str | None = None, pending_only: bool = False, search: str | None = None,
                   db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    q = apply_scope(db.query(QualityApprovedVendor), user, QualityApprovedVendor)
    if status_filter:
        if status_filter not in QUALITY_AVL_STATUSES:
            raise HTTPException(status_code=422, detail=f"Unknown status '{status_filter}' — use {', '.join(QUALITY_AVL_STATUSES)}.")
        q = q.filter(QualityApprovedVendor.status == status_filter)
    if item_id:
        q = q.filter(QualityApprovedVendor.item_id == item_id)
    if vendor:
        q = q.filter(QualityApprovedVendor.vendor_key == sq.vendor_key(vendor))
    if pending_only:
        q = q.filter(QualityApprovedVendor.pending_action.isnot(None))
    if search:
        like = f"%{search.lower()}%"
        ids = [i for (i,) in db.query(StoreItem.id).filter(func.lower(StoreItem.item_name).like(like) | func.lower(StoreItem.item_code).like(like)).all()]
        q = q.filter(QualityApprovedVendor.vendor_key.like(like) | QualityApprovedVendor.item_id.in_(ids))
    return _avl_responses(db, q.order_by(QualityApprovedVendor.vendor_key, QualityApprovedVendor.item_id).all())


@router.post("/avl", response_model=QualityApprovedVendorResponse)
async def create_avl(payload: QualityApprovedVendorCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    avl = _run(db, lambda: sq.create_manual(db, item_id=payload.item_id, vendor_name=payload.vendor_name,
                                             vendor_id=payload.vendor_id, remarks=payload.remarks, user=user))
    return _avl_detail(db, avl.id)


@router.get("/avl/{avl_id}", response_model=QualityApprovedVendorResponse)
async def get_avl(avl_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    _avl_or_404(db, avl_id, user)
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/approve", response_model=QualityApprovedVendorResponse)
async def approve(avl_id: int, payload: QualityApprovedVendorReasonPayload, db: Session = Depends(get_db),
                  user: User = Depends(_CAN_EDIT)):
    """Trial → Approved: a Quality head's one-click decision, recorded in
    Organization › Approval Workflows › Vendor approval."""
    avl = _avl_or_404(db, avl_id, user, lock=True)
    if not access.can_approve_vendor(user):
        raise HTTPException(status_code=403, detail="Only a Quality head can approve a vendor — ask an admin to apply the Quality head role.")
    item_name = db.query(StoreItem.item_name).filter(StoreItem.id == avl.item_id).scalar() or "item"
    authz.one_click(db, authz.VENDOR_APPROVAL_KEY, entity_id=avl.id, actor=user,
                    title=f"Approve {avl.vendor_name} for {item_name}"[:300], reference=f"{avl.vendor_name} / {item_name}"[:100],
                    proposal={"remarks": payload.reason}, comment=(payload.reason or "").strip() or None)
    db.commit()
    db.expire_all()
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/watch", response_model=QualityApprovedVendorResponse)
async def watch(avl_id: int, payload: QualityApprovedVendorReasonPayload, db: Session = Depends(get_db),
                user: User = Depends(_CAN_EDIT)):
    avl = _avl_or_404(db, avl_id, user, lock=True)
    _run(db, lambda: sq.put_on_watch(db, avl, reason=payload.reason, user=user))
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/release-watch", response_model=QualityApprovedVendorResponse)
async def release_watch(avl_id: int, payload: QualityApprovedVendorReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(_CAN_EDIT)):
    avl = _avl_or_404(db, avl_id, user, lock=True)
    _run(db, lambda: sq.release_watch(db, avl, reason=payload.reason, user=user))
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/request-block", response_model=QualityApprovedVendorResponse)
async def request_block(avl_id: int, payload: QualityApprovedVendorReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(_CAN_EDIT)):
    avl = _avl_or_404(db, avl_id, user, lock=True)
    _run(db, lambda: sq.request_block(db, avl, reason=payload.reason, user=user, action="block"))
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/request-unblock", response_model=QualityApprovedVendorResponse)
async def request_unblock(avl_id: int, payload: QualityApprovedVendorReasonPayload, db: Session = Depends(get_db),
                          user: User = Depends(_CAN_EDIT)):
    avl = _avl_or_404(db, avl_id, user, lock=True)
    _run(db, lambda: sq.request_block(db, avl, reason=payload.reason, user=user, action="unblock"))
    return _avl_detail(db, avl_id)


@router.post("/avl/{avl_id}/decision", response_model=QualityApprovedVendorResponse)
async def partner_decision(avl_id: int, payload: QualityApprovedVendorDecisionPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_app_access("quality"))):
    avl = _avl_or_404(db, avl_id, user, lock=True)
    _run(db, lambda: sq.decide_pending(db, avl, approve=payload.approve, remarks=payload.remarks, user=user))
    return _avl_detail(db, avl_id)


# --- Ratings -----------------------------------------------------------------------

@router.get("/ratings", response_model=list[QualitySupplierScorecardResponse])
async def list_ratings(period: str | None = None, vendor: str | None = None, db: Session = Depends(get_db)):
    q = db.query(QualitySupplierScorecard).filter(QualitySupplierScorecard.is_deleted == False)  # noqa: E712
    if period:
        q = q.filter(QualitySupplierScorecard.period == period)
    if vendor:
        q = q.filter(QualitySupplierScorecard.vendor_key == sq.vendor_key(vendor))
    return q.order_by(QualitySupplierScorecard.period.desc(), QualitySupplierScorecard.overall_score.asc()).all()


@router.post("/ratings/run", response_model=list[QualitySupplierScorecardResponse])
async def run_ratings(payload: QualityRatingRunPayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    if not access.can_approve_vendor(user):
        raise HTTPException(status_code=403, detail="Only a Quality head can (re)compute vendor ratings — they drive On-watch / Blocked escalation.")
    return _run(db, lambda: sq.compute_monthly_ratings(db, payload.period.strip(), user.id))


@router.get("/vendors")
async def vendor_summary(db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    """One row per vendor: items on the AVL by status, latest score, open vendor CAPA."""
    rows = apply_scope(db.query(QualityApprovedVendor), user, QualityApprovedVendor).all()
    vendors: dict[str, dict] = {}
    for r in rows:
        v = vendors.setdefault(r.vendor_key, {"vendor_name": r.vendor_name, "items": 0, "trial": 0, "approved": 0,
                                              "on_watch": 0, "blocked": 0, "pending": 0, "last_score": None, "last_period": None})
        v["items"] += 1
        v[r.status] += 1
        v["pending"] += 1 if r.pending_action else 0
        if r.last_rated_period and (v["last_period"] or "") <= r.last_rated_period:
            v["last_score"], v["last_period"] = r.last_score, r.last_rated_period
    capas = db.query(QualityCapa).filter(QualityCapa.trigger == "vendor_trend", QualityCapa.status != "closed",
                                         QualityCapa.is_deleted == False).all()  # noqa: E712
    for c in capas:
        k = sq.vendor_key(c.vendor_name)
        if k in vendors:
            vendors[k]["open_capa"] = {"id": c.id, "capa_number": c.capa_number}
    return sorted(vendors.values(), key=lambda v: v["vendor_name"].lower())


# --- Vendor audits -----------------------------------------------------------------

def _audit_responses(db: Session, rows: list[QualityVendorAudit]) -> list[QualityVendorAuditResponse]:
    uids = {r.auditor_id for r in rows} - {None}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    capas = {c.id: c.capa_number for c in db.query(QualityCapa).filter(QualityCapa.id.in_({r.capa_id for r in rows} - {None})).all()}
    out = []
    for r in rows:
        resp = QualityVendorAuditResponse.model_validate(r)
        resp.auditor_name = users.get(r.auditor_id)
        resp.capa_number = capas.get(r.capa_id)
        out.append(resp)
    return out


@router.get("/audits", response_model=list[QualityVendorAuditResponse])
async def list_audits(vendor: str | None = None, status_filter: str | None = Query(None, alias="status"), db: Session = Depends(get_db),
                      user: User = Depends(require_app_access("quality"))):
    q = apply_scope(db.query(QualityVendorAudit), user, QualityVendorAudit)
    if vendor:
        q = q.filter(QualityVendorAudit.vendor_key == sq.vendor_key(vendor))
    if status_filter:
        q = q.filter(QualityVendorAudit.status == status_filter)
    return _audit_responses(db, q.order_by(QualityVendorAudit.planned_date.desc()).all())


@router.post("/audits", response_model=QualityVendorAuditResponse)
async def schedule_audit(payload: QualityVendorAuditCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    authz.ensure_may_assign(db, user, authz.AUDITOR_RULE, payload.auditor_id)
    audit = _run(db, lambda: sq.schedule_audit(db, vendor_name=payload.vendor_name, planned_date=payload.planned_date,
                                                scope=payload.scope, auditor_id=payload.auditor_id, user=user))
    return _audit_responses(db, [db.get(QualityVendorAudit, audit.id)])[0]


@router.post("/audits/{audit_id}/complete", response_model=QualityVendorAuditResponse)
async def complete_audit(audit_id: int, payload: QualityVendorAuditCompletePayload, db: Session = Depends(get_db),
                         user: User = Depends(_CAN_EDIT)):
    audit = db.query(QualityVendorAudit).filter(QualityVendorAudit.id == audit_id).with_for_update().first()
    if not audit:
        raise HTTPException(status_code=404, detail=f"Vendor audit #{audit_id} not found.")
    ensure_in_scope(db, user, audit)
    _run(db, lambda: sq.complete_audit(db, audit, audit_date=payload.audit_date, score=payload.score, result=payload.result,
                                       findings=[f.model_dump() for f in payload.findings], remarks=payload.remarks, user=user))
    return _audit_responses(db, [db.get(QualityVendorAudit, audit_id)])[0]
