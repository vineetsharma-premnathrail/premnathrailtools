"""First Article Inspection (FAI) register — rule 9. FAIs open
automatically from GRN / job work receipt / production output; manual ones
here. Approve / reject after the first-article lot is decided. Rules live in
services/first_article.py."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.first_article import (
    QualityFirstArticle, QUALITY_FAI_STATUSES, QUALITY_FAI_TRIGGER_LABELS,
)
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.schemas.first_article import (
    QualityFirstArticleCreate, QualityFirstArticleDecisionPayload, QualityFirstArticleResponse,
)
from app.modules.quality.services import first_article as fai_service
from app.modules.quality.services.first_article import FaiError
from app.modules.quality.services.lots import LotError
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation

router = APIRouter(prefix="/quality/first-articles", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "first_article", "create")


def _responses(db: Session, rows: list[QualityFirstArticle], detail: bool = False) -> list[QualityFirstArticleResponse]:
    lots = {l.id: l for l in db.query(QualityInspectionLot).filter(QualityInspectionLot.id.in_({r.lot_id for r in rows} - {None})).all()}
    uids = {r.created_by_id for r in rows} | {r.decided_by_id for r in rows}
    uids.discard(None)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    out = []
    for r in rows:
        resp = QualityFirstArticleResponse.model_validate(r)
        lot = lots.get(r.lot_id)
        if lot:
            resp.lot_number, resp.lot_status, resp.lot_decision = lot.lot_number, lot.status, lot.decision
        resp.created_by_name = users.get(r.created_by_id)
        resp.decided_by_name = users.get(r.decided_by_id)
        if detail:
            resp.current_drawing_ref = fai_service.current_drawing_ref(db, r.item_id)
        out.append(resp)
    return out


def _get(db: Session, fai_id: int, user: User | None = None, lock: bool = False) -> QualityFirstArticle:
    q = db.query(QualityFirstArticle).filter(QualityFirstArticle.id == fai_id)
    fai = (q.with_for_update() if lock else q).first()
    if not fai:
        raise HTTPException(status_code=404, detail=f"First article #{fai_id} not found — it may have been removed. Reload the list.")
    if user is not None:
        ensure_in_scope(db, user, fai)
    return fai


@router.get("/meta")
async def meta():
    return {"statuses": list(QUALITY_FAI_STATUSES), "triggers": [{"value": k, "label": v} for k, v in QUALITY_FAI_TRIGGER_LABELS.items()]}


@router.get("", response_model=list[QualityFirstArticleResponse])
async def list_fais(status_filter: str | None = Query(None, alias="status"), search: str | None = None, db: Session = Depends(get_db),
                    user: User = Depends(require_app_access("quality"))):
    q = apply_scope(db.query(QualityFirstArticle), user, QualityFirstArticle)
    if status_filter:
        q = q.filter(QualityFirstArticle.status == status_filter)
    if search:
        like = f"%{search}%"
        q = q.filter(QualityFirstArticle.fai_number.ilike(like) | QualityFirstArticle.item_name.ilike(like)
                     | QualityFirstArticle.item_code.ilike(like) | QualityFirstArticle.vendor_name.ilike(like)
                     | QualityFirstArticle.source_reference.ilike(like))
    return _responses(db, q.order_by(QualityFirstArticle.id.desc()).limit(500).all())


@router.get("/requirement")
async def fai_requirement(item_id: int, vendor_name: str | None = None, db: Session = Depends(get_db)):
    """Is this item + source released for regular lots? (Shown on the FAI
    form before raising one.)"""
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{item_id} isn't in the Item Master.")
    base = "incoming" if (vendor_name or "").strip() else "final"
    req = fai_service.requirement(db, item, vendor_name, base)
    return {
        "applies": fai_service.applies(db, item, base), "released": req is None,
        "trigger": req["trigger"] if req else None, "drawing_ref": fai_service.current_drawing_ref(db, item.id),
        "open_fai": req["open"].fai_number if req and req["open"] else None,
    }


@router.post("", response_model=QualityFirstArticleResponse)
async def create_fai(payload: QualityFirstArticleCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    item = db.query(StoreItem).filter(StoreItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{payload.item_id} isn't in the Item Master.")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="First-article quantity must be greater than zero.")
    if payload.take_from_free and not payload.location_id:
        raise HTTPException(status_code=422, detail="Pick the store whose Free stock holds the first article(s).")
    if payload.location_id and not db.query(StoreLocation.id).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail=f"Store #{payload.location_id} not found")
    try:
        fai = fai_service.create_manual(db, item=item, vendor_name=payload.vendor_name, quantity=payload.quantity,
                                        location_id=payload.location_id, take_from_free=payload.take_from_free,
                                        source_reference=payload.source_reference, remarks=payload.remarks, user=user)
    except (FaiError, LotError) as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return _responses(db, [_get(db, fai.id)], detail=True)[0]


@router.get("/{fai_id}", response_model=QualityFirstArticleResponse)
async def get_fai(fai_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return _responses(db, [_get(db, fai_id, user)], detail=True)[0]


@router.post("/{fai_id}/decision", response_model=QualityFirstArticleResponse)
async def decide_fai(fai_id: int, payload: QualityFirstArticleDecisionPayload, db: Session = Depends(get_db),
                     user: User = Depends(require_app_access("quality"))):
    ensure_feature_action(user, "quality", "first_article", "decision", "approve" if payload.approve else "reject")
    fai = _get(db, fai_id, user, lock=True)
    try:
        if payload.approve:
            fai_service.approve(db, fai, remarks=payload.remarks, user=user)
        else:
            fai_service.reject(db, fai, remarks=payload.remarks, user=user)
    except FaiError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return _responses(db, [_get(db, fai_id)], detail=True)[0]
