"""Inspection lots: list / My Inspections, manual creation, results,
usage decision, close. All rules live in services/lots.py."""
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings

from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.inspection_lot import (
    QualityInspectionLot, QUALITY_LOT_STATUSES, QUALITY_LOT_OPEN_STATUSES, QUALITY_LOT_DECISION_LABELS,
)
from app.modules.quality.models.inspection_plan import QualityInspectionPlan, QUALITY_INSPECTION_TYPES
from app.modules.quality.models.first_article import QualityFirstArticle
from app.modules.quality.models.lot_attachment import QualityLotPhoto
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.schemas.inspection_lot import (
    QualityInspectionLotCreate, QualityInspectionLotResponse, QualityLotRecordResultsPayload, QualityLotAssignPayload,
    QualityLotSeverityPayload, QualityLotCertificatePayload, QualityLotDecisionPayload, QualityLotCancelPayload,
)
from app.modules.quality.services import lots as lot_service
from app.modules.quality.services.lots import LotError
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation

router = APIRouter(prefix="/quality/inspection-lots", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "inspection_lots", "create")
_CAN_EDIT = require_tab_action("quality", "inspection_lots", "edit")


def _to_responses(db: Session, lots: list[QualityInspectionLot], detail: bool = False) -> list[QualityInspectionLotResponse]:
    if not lots:
        return []
    uids = set()
    for l in lots:
        uids |= {l.assigned_to_id, l.results_recorded_by_id, l.decided_by_id}
        if detail:
            uids |= {r.recorded_by_id for r in l.results}
    uids.discard(None)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    locs = {x.id: x.name for x in db.query(StoreLocation).filter(StoreLocation.id.in_({l.location_id for l in lots} - {None})).all()}
    plans = {p.id: p.plan_number for p in db.query(QualityInspectionPlan).filter(QualityInspectionPlan.id.in_({l.plan_id for l in lots} - {None})).all()}
    codes = {c.id: f"{c.code} — {c.name}" for c in db.query(QualityDefectCode).all()} if detail else {}
    out = []
    for l in lots:
        resp = QualityInspectionLotResponse.model_validate(l)
        resp.location_name = locs.get(l.location_id)
        resp.plan_number = plans.get(l.plan_id)
        resp.assigned_to_name = users.get(l.assigned_to_id)
        resp.results_recorded_by_name = users.get(l.results_recorded_by_id)
        resp.decided_by_name = users.get(l.decided_by_id)
        resp.age_days = lot_service.lot_age_days(l)
        resp.failed_count = sum(1 for r in l.results if r.result == "fail")
        resp.critical_failed = any(r.result == "fail" and r.classification == "critical" for r in l.results)
        if detail:
            for r in resp.results:
                r.defect_code_label = codes.get(r.defect_code_id)
                r.recorded_by_name = users.get(r.recorded_by_id)
            resp.ncrs = [{"id": n.id, "ncr_number": n.ncr_number, "status": n.status, "severity": n.severity, "quantity": n.quantity}
                         for n in db.query(QualityNcr).filter(QualityNcr.lot_id == l.id, QualityNcr.is_deleted == False).all()]  # noqa: E712
            photo_users = {}
            photos = db.query(QualityLotPhoto).filter(QualityLotPhoto.lot_id == l.id).order_by(QualityLotPhoto.id).all()
            for ph in photos:
                if ph.uploaded_by_id and ph.uploaded_by_id not in photo_users:
                    photo_users[ph.uploaded_by_id] = users.get(ph.uploaded_by_id) or next(
                        (u.name or u.email for u in db.query(User).filter(User.id == ph.uploaded_by_id)), None)
            resp.photos = [{"id": ph.id, "result_id": ph.result_id, "file_name": ph.file_name, "caption": ph.caption,
                            "uploaded_by_name": photo_users.get(ph.uploaded_by_id), "created_at": ph.created_at} for ph in photos]
            fai = db.query(QualityFirstArticle).filter(QualityFirstArticle.lot_id == l.id).first()
            resp.first_article = {"id": fai.id, "fai_number": fai.fai_number, "status": fai.status, "trigger": fai.trigger} if fai else None
            if l.source_type == "work_order_operation":
                from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation
                op = db.query(ProductionWorkOrderOperation).filter(ProductionWorkOrderOperation.quality_lot_id == l.id).first()
                wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == op.work_order_id).first() if op else None
                resp.gate = {"work_order_id": wo.id, "wo_number": wo.wo_number, "operation": f"{op.sequence} {op.operation_name}"} if wo else None
        else:
            resp.results = []
        out.append(resp)
    return out


def _get_or_404(db: Session, lot_id: int, lock: bool = False) -> QualityInspectionLot:
    q = db.query(QualityInspectionLot).options(selectinload(QualityInspectionLot.results)).filter(QualityInspectionLot.id == lot_id)
    lot = (q.with_for_update() if lock else q).first()
    if not lot:
        raise HTTPException(status_code=404, detail=f"Inspection lot #{lot_id} not found")
    return lot


def _detail(db: Session, lot_id: int) -> QualityInspectionLotResponse:
    db.expire_all()
    return _to_responses(db, [_get_or_404(db, lot_id)], detail=True)[0]


def _run(db: Session, fn):
    try:
        result = fn()
    except LotError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return result


@router.get("/meta")
async def lots_meta():
    return {"statuses": list(QUALITY_LOT_STATUSES),
            "decisions": [{"value": k, "label": v} for k, v in QUALITY_LOT_DECISION_LABELS.items()]}


@router.get("", response_model=list[QualityInspectionLotResponse])
async def list_lots(
    status_filter: str | None = Query(None, alias="status"), inspection_type: str | None = None,
    mine: bool = False, open_only: bool = False, search: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(require_app_access("quality")),
):
    q = db.query(QualityInspectionLot).options(selectinload(QualityInspectionLot.results))
    if status_filter:
        q = q.filter(QualityInspectionLot.status == status_filter)
    if open_only:
        q = q.filter(QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES))
    if inspection_type:
        q = q.filter(QualityInspectionLot.inspection_type == inspection_type)
    if mine:
        # My Inspections: assigned to me, plus unassigned open lots anyone can pick up.
        q = q.filter(QualityInspectionLot.status.in_(QUALITY_LOT_OPEN_STATUSES)).filter(
            (QualityInspectionLot.assigned_to_id == user.id) | (QualityInspectionLot.assigned_to_id.is_(None)))
    if search:
        like = f"%{search}%"
        q = q.filter(QualityInspectionLot.lot_number.ilike(like) | QualityInspectionLot.item_name.ilike(like)
                     | QualityInspectionLot.source_reference.ilike(like) | QualityInspectionLot.vendor_name.ilike(like))
    return _to_responses(db, q.order_by(QualityInspectionLot.id.desc()).limit(500).all())


@router.post("", response_model=QualityInspectionLotResponse)
async def create_manual_lot(payload: QualityInspectionLotCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    if payload.inspection_type not in QUALITY_INSPECTION_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid inspection type '{payload.inspection_type}'.")
    if payload.inspection_type in ("incoming",):
        raise HTTPException(status_code=422, detail="Incoming lots are created automatically by the GRN for items flagged 'inspection on receipt' — record the GRN in Store instead.")
    if payload.inspection_type == "first_article":
        raise HTTPException(status_code=422, detail="Raise a first article from Quality → First Article — it opens the FAI record (rule 9) together with its lot.")
    item = db.query(StoreItem).filter(StoreItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{payload.item_id} isn't in the Item Master.")
    if payload.take_from_free and not payload.location_id:
        raise HTTPException(status_code=422, detail="Pick the store whose Free stock should be held for this inspection.")
    if payload.location_id and not db.query(StoreLocation.id).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail=f"Store #{payload.location_id} not found")
    lot = _run(db, lambda: lot_service.create_lot(
        db, inspection_type=payload.inspection_type, source_type="manual", item=item, quantity=payload.quantity,
        location_id=payload.location_id if payload.take_from_free else None, user_id=user.id,
        source_reference=payload.source_reference, batch_number=payload.batch_number, vendor_name=payload.vendor_name,
        assigned_to_id=payload.assigned_to_id, remarks=payload.remarks, take_from_free=payload.take_from_free,
    ))
    return _detail(db, lot.id)


@router.get("/{lot_id}", response_model=QualityInspectionLotResponse)
async def get_lot(lot_id: int, db: Session = Depends(get_db)):
    return _detail(db, lot_id)


@router.post("/{lot_id}/refresh-plan", response_model=QualityInspectionLotResponse)
async def refresh_plan(lot_id: int, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.refresh_plan(db, lot))
    return _detail(db, lot_id)


@router.post("/{lot_id}/sampling", response_model=QualityInspectionLotResponse)
async def set_sampling(lot_id: int, payload: QualityLotSeverityPayload, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.set_sampling_severity(db, lot, payload.sampling_severity))
    return _detail(db, lot_id)


@router.post("/{lot_id}/assign", response_model=QualityInspectionLotResponse)
async def assign_lot(lot_id: int, payload: QualityLotAssignPayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.assign(db, lot, payload.user_id, user))
    return _detail(db, lot_id)


@router.post("/{lot_id}/start", response_model=QualityInspectionLotResponse)
async def start_lot(lot_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.start(db, lot, user))
    return _detail(db, lot_id)


@router.post("/{lot_id}/results", response_model=QualityInspectionLotResponse)
async def record_results(lot_id: int, payload: QualityLotRecordResultsPayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.record_results(db, lot, [e.model_dump() for e in payload.entries], user))
    return _detail(db, lot_id)


@router.post("/{lot_id}/submit-results", response_model=QualityInspectionLotResponse)
async def submit_results(lot_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.submit_results(db, lot, user))
    return _detail(db, lot_id)


@router.post("/{lot_id}/test-certificate", response_model=QualityInspectionLotResponse)
async def set_certificate(lot_id: int, payload: QualityLotCertificatePayload, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.set_test_certificate(db, lot, payload.received, payload.reference))
    return _detail(db, lot_id)


@router.post("/{lot_id}/decision", response_model=QualityInspectionLotResponse)
async def usage_decision(lot_id: int, payload: QualityLotDecisionPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.decide(
        db, lot, decision=payload.decision, user=user, accepted_qty=payload.accepted_qty, rejected_qty=payload.rejected_qty,
        deviation_reference=payload.deviation_reference, remarks=payload.remarks,
    ))
    return _detail(db, lot_id)


@router.post("/{lot_id}/close", response_model=QualityInspectionLotResponse)
async def close_lot(lot_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.close(db, lot, user))
    return _detail(db, lot_id)


@router.post("/{lot_id}/cancel", response_model=QualityInspectionLotResponse)
async def cancel_lot(lot_id: int, payload: QualityLotCancelPayload, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id, lock=True)
    _run(db, lambda: lot_service.cancel(db, lot, user, payload.reason))
    return _detail(db, lot_id)


# ---------------------------------------------------------------------------
# Photos (Phase 2) — SharePoint, served back through the app
# ---------------------------------------------------------------------------

MAX_PHOTO_BYTES = 8 * 1024 * 1024


def _require_sharepoint() -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Photo storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")


@router.post("/{lot_id}/photos", response_model=QualityInspectionLotResponse)
async def upload_photos(
    lot_id: int, files: list[UploadFile] = File(...), result_id: int | None = Form(None), caption: str | None = Form(None),
    db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT),
):
    from app.utils.sharepoint import upload_file_to_sharepoint, sanitize_folder_name
    lot = _get_or_404(db, lot_id)
    if lot.status not in QUALITY_LOT_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"Lot {lot.lot_number} is {lot.status.replace('_', ' ')} — photos are part of the record "
                                                    "once the usage decision is made, so they can only be added while the lot is open.")
    if result_id is not None and result_id not in {r.id for r in lot.results}:
        raise HTTPException(status_code=422, detail=f"Result row #{result_id} doesn't belong to lot {lot.lot_number}.")
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' isn't an image — upload JPG, PNG or WEBP photos.")
        f.file.seek(0, os.SEEK_END)
        size = f.file.tell()
        f.file.seek(0)
        if size > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is {size / 1024 / 1024:.1f} MB — keep photos under 8 MB (resize and try again).")
    _require_sharepoint()
    folder = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Quality/Inspection-Lots/{sanitize_folder_name(lot.lot_number)}"
    for f in files:
        f.file.seek(0, os.SEEK_END)
        size = f.file.tell()
        f.file.seek(0)
        uploaded = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        db.add(QualityLotPhoto(lot_id=lot.id, result_id=result_id, file_name=f.filename or "photo", file_path=uploaded["path"],
                               content_type=f.content_type, file_size=size, caption=(caption or "").strip() or None,
                               uploaded_by_id=user.id))
    db.commit()
    return _detail(db, lot_id)


@router.get("/{lot_id}/photos/{photo_id}")
async def get_photo(lot_id: int, photo_id: int, db: Session = Depends(get_db)):
    from app.utils.sharepoint import download_file_content
    ph = db.query(QualityLotPhoto).filter(QualityLotPhoto.id == photo_id, QualityLotPhoto.lot_id == lot_id).first()
    if not ph:
        raise HTTPException(status_code=404, detail="Photo not found — it may have been removed. Refresh the page.")
    _require_sharepoint()
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, ph.file_path)
    return Response(content=content, media_type=ph.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{ph.file_name}"', "Cache-Control": "private, max-age=3600"})


@router.delete("/{lot_id}/photos/{photo_id}", response_model=QualityInspectionLotResponse)
async def delete_photo(lot_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    lot = _get_or_404(db, lot_id)
    ph = db.query(QualityLotPhoto).filter(QualityLotPhoto.id == photo_id, QualityLotPhoto.lot_id == lot_id).first()
    if not ph:
        raise HTTPException(status_code=404, detail="Photo not found — it may have been removed already. Refresh the page.")
    if lot.status not in QUALITY_LOT_OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"Lot {lot.lot_number} is decided — its photos are part of the record and can't be removed.")
    if ph.uploaded_by_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the person who added the photo (or an admin) can remove it.")
    db.delete(ph)
    db.commit()
    try:
        from app.utils.sharepoint import delete_file_from_sharepoint
        await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, ph.file_path)
    except HTTPException:
        pass  # record is gone; a stray file in SharePoint is harmless
    return _detail(db, lot_id)
