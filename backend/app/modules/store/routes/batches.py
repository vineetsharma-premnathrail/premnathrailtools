"""Batch management — batch list / stock by batch, batch pick for issues,
mill TC document, block / release, traceability (store/services/batches.py)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import require_app_access, require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.store.access import ensure_any_store_action
from app.modules.store.models.batch import STORE_BATCH_STATUSES, StoreBatch
from app.modules.store.models.item import StoreItem
from app.modules.store.schemas.job_work import StoreBatchStatusPayload
from app.modules.store.services import batches as batch_service
from app.modules.store.services.plant_access import ensure_location_allowed, visible_location_ids

router = APIRouter(prefix="/store/batches", tags=["Store"])

_TC_TYPES = ("application/pdf", "image/jpeg", "image/png", "image/webp")
_TC_MAX_BYTES = 15 * 1024 * 1024


def _get_or_404(db: Session, batch_id: int) -> StoreBatch:
    b = db.get(StoreBatch, batch_id)
    if not b:
        raise HTTPException(status_code=404, detail="Batch not found — it may belong to a GRN that was removed. Reload the page.")
    return b


def _scoped(db: Session, user: User, data: dict) -> dict:
    allowed = visible_location_ids(db, user)
    if allowed is not None:
        data["stock"] = [s for s in data["stock"] if s["location_id"] in allowed]
        data["total"] = {k: round(sum(s[k] for s in data["stock"]), 4) for k in batch_service.BUCKETS}
    return data


@router.get("")
async def list_batches(
    item_id: int | None = Query(None),
    q: str | None = Query(None),
    location_id: int | None = Query(None),
    in_stock: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "stock")),
):
    """Batches with their stock per store and stock type (from the ledger)."""
    query = db.query(StoreBatch)
    if item_id is not None:
        query = query.filter(StoreBatch.item_id == item_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        item_ids = [i for (i,) in db.query(StoreItem.id).filter(or_(StoreItem.item_name.ilike(like), StoreItem.item_code.ilike(like))).all()]
        query = query.filter(or_(StoreBatch.batch_number.ilike(like), StoreBatch.heat_number.ilike(like), StoreBatch.vendor_name.ilike(like),
                                 StoreBatch.tc_number.ilike(like), StoreBatch.item_id.in_(item_ids or [-1])))
    rows = query.order_by(StoreBatch.id.desc()).limit(500).all()
    allowed = visible_location_ids(db, user)
    stock = batch_service.batch_stock(db, item_id=item_id, location_id=location_id, location_ids=allowed,
                                      batch_numbers=[r.batch_number for r in rows])
    out = []
    for r in rows:
        d = _scoped(db, user, batch_service.batch_dict(db, r, stock))
        if location_id is not None:
            d["stock"] = [s for s in d["stock"] if s["location_id"] == location_id]
        if in_stock and not d["stock"]:
            continue
        out.append(d)
    return out


@router.get("/available")
async def available_for_issue(
    item_id: int = Query(...),
    location_id: int = Query(...),
    quantity: float | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    """Batch pick for an issue line: batches with Free stock at the store in
    FIFO (FEFO for expiry-controlled items) order, plus the suggested split
    for `quantity`."""
    ensure_any_store_action(user, ("issues", "create"), ("stock", "view"))
    ensure_location_allowed(db, user, location_id)
    item = db.get(StoreItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    rows = batch_service.available_batches(db, item, location_id)
    suggestion = []
    if quantity and quantity > 0 and batch_service.is_batch_managed(item):
        try:
            suggestion = [{"batch_number": b, "quantity": q} for b, q in
                          batch_service.allocate_issue(db, item, location_id, quantity, None)]
        except HTTPException as e:
            return {"batch_managed": True, "expiry_controlled": bool(item.expiry_controlled), "batches": rows,
                    "suggestion": [], "shortfall": e.detail}
    return {"batch_managed": batch_service.is_batch_managed(item), "expiry_controlled": bool(item.expiry_controlled),
            "batches": rows, "suggestion": suggestion, "shortfall": None}


@router.get("/{batch_id}")
async def get_batch_trace(batch_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("store", "stock"))):
    """Traceability: batch → GRN / vendor / mill TC → movements → issues
    (work order, machine / project, job-work vendor) → inspection lots / NCRs,
    plus the processed batches it went into through job work."""
    b = _get_or_404(db, batch_id)
    data = _scoped(db, user, batch_service.trace(db, b))
    from app.modules.store.models.job_work import StoreJobWorkReceipt, StoreJobWorkReceiptComponent
    # Job work genealogy: processed batches made from this batch, and the
    # component batches this batch was made from.
    made_into = db.query(StoreJobWorkReceipt).join(StoreJobWorkReceiptComponent, StoreJobWorkReceiptComponent.receipt_id == StoreJobWorkReceipt.id).filter(
        StoreJobWorkReceiptComponent.item_id == b.item_id, StoreJobWorkReceiptComponent.batch_number == b.batch_number).all()
    made_from = db.query(StoreJobWorkReceipt).filter(StoreJobWorkReceipt.output_item_id == b.item_id,
                                                     StoreJobWorkReceipt.output_batch_number == b.batch_number).all()

    def _batch_ref(item_id, number):
        row = db.query(StoreBatch).filter(StoreBatch.item_id == item_id, StoreBatch.batch_number == number).first() if number else None
        item = db.get(StoreItem, item_id)
        return {"batch_id": row.id if row else None, "batch_number": number, "heat_number": row.heat_number if row else None,
                "item_code": item.item_code if item else None, "item_name": item.item_name if item else None}

    data["made_into"] = [{"receipt_number": r.receipt_number, "receipt_date": r.receipt_date, "vendor_name": r.vendor_name,
                          **_batch_ref(r.output_item_id, r.output_batch_number)} for r in made_into]
    data["made_from"] = [{"receipt_number": r.receipt_number, "receipt_date": r.receipt_date, "vendor_name": r.vendor_name,
                          **_batch_ref(c.item_id, c.batch_number)} for r in made_from for c in r.components]
    return data


@router.post("/{batch_id}/status")
async def set_batch_status(batch_id: int, payload: StoreBatchStatusPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_feature_action("store", "adjustments", "batch_status", "edit"))):
    """Block a batch (e.g. its TC doesn't match the spec) so issues refuse
    it, or release it again. Stock stays where it is."""
    b = _get_or_404(db, batch_id)
    if payload.status not in STORE_BATCH_STATUSES:
        raise HTTPException(status_code=422, detail="Status must be 'active' (released) or 'blocked'.")
    reason = (payload.reason or "").strip()
    if payload.status == "blocked" and not reason:
        raise HTTPException(status_code=422, detail="Say why the batch is blocked (e.g. 'TC chemistry out of spec') — it is shown to anyone who tries to issue it.")
    if b.status == payload.status:
        raise HTTPException(status_code=409, detail=f"Batch {b.batch_number} is already {payload.status}.")
    b.status = payload.status
    if reason:
        b.remarks = f"{'Blocked' if payload.status == 'blocked' else 'Released'}: {reason}"
    db.add(AuditLog(entity_type="store_batch", entity_id=b.id, action=f"batch_{payload.status}", performed_by_id=user.id,
                    summary=f"{user.name or user.email} set batch {b.batch_number} (heat {b.heat_number or '—'}) to {payload.status}"
                            + (f": {reason}" if reason else "") + "."))
    db.commit()
    return _scoped(db, user, batch_service.batch_dict(db, b))


@router.post("/{batch_id}/tc")
async def upload_tc(batch_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                    user: User = Depends(require_feature_action("store", "grn", "mill_tc", "create"))):
    """Attach (or replace) the mill test certificate scan of a batch."""
    from app.utils.sharepoint import upload_file_to_sharepoint, sanitize_folder_name
    b = _get_or_404(db, batch_id)
    if (file.content_type or "") not in _TC_TYPES:
        raise HTTPException(status_code=400, detail=f"'{file.filename}' isn't a PDF or image — upload the mill TC as PDF, JPG or PNG.")
    data = await file.read()
    if len(data) > _TC_MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"'{file.filename}' is {len(data) / 1024 / 1024:.1f} MB — keep the TC scan under 15 MB.")
    await file.seek(0)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Document storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")
    folder = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Store/Batches/{sanitize_folder_name(b.batch_number)}"
    uploaded = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, file)
    b.tc_file_name = file.filename or "mill-tc"
    b.tc_file_path = uploaded["path"]
    b.tc_content_type = file.content_type
    b.tc_uploaded_by_id = user.id
    b.tc_uploaded_at = datetime.now(timezone.utc)
    db.add(AuditLog(entity_type="store_batch", entity_id=b.id, action="batch_tc_uploaded", performed_by_id=user.id,
                    summary=f"{user.name or user.email} attached mill TC '{b.tc_file_name}' to batch {b.batch_number}."))
    db.commit()
    return _scoped(db, user, batch_service.batch_dict(db, b))


@router.get("/{batch_id}/tc")
async def download_tc(batch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("store", "stock"))):
    from app.utils.sharepoint import download_file_content
    b = _get_or_404(db, batch_id)
    if not b.tc_file_path:
        raise HTTPException(status_code=404, detail=f"No mill TC is attached to batch {b.batch_number} yet — upload it from the batch page.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Document storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, b.tc_file_path)
    return Response(content=content, media_type=b.tc_content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{b.tc_file_name}"'})
