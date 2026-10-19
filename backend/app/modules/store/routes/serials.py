"""Serial numbers (SAP IQ01/IQ03 + serial history) — read side and the one
manual action: naming which unit of a partly-accepted Quality lot passed or
failed. Every other status change happens on the document that moves the unit
(GRN, inspection, issue, return, transfer, return to vendor) — see
services/serials.py."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.permissions import require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import require_store_lookup
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.serial_number import STORE_SERIAL_STATUS_LABELS, STORE_SERIAL_STATUSES, StoreSerialNumber
from app.modules.store.services import serials as serial_svc
from app.modules.store.services.plant_access import ensure_location_allowed, visible_location_ids

router = APIRouter(prefix="/store/serials", tags=["Store"])


class StoreSerialQualityResultPayload(BaseModel):
    status: str  # in_stock | blocked
    reason: str


def _scoped(db: Session, user: User, q):
    allowed = visible_location_ids(db, user)
    if allowed is not None:
        # Units out of the store (issued / with the vendor) have no location —
        # still visible: their history is how a warranty is traced.
        q = q.filter(or_(StoreSerialNumber.location_id.in_(allowed or {-1}), StoreSerialNumber.location_id.is_(None)))
    return q


def _dicts(db: Session, rows: list[StoreSerialNumber]) -> list[dict]:
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.item_id for r in rows})).all()} if rows else {}
    locs = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_({r.location_id for r in rows} - {None})).all()} if rows else {}
    bins = {b.id: b for b in db.query(StoreBin).filter(StoreBin.id.in_({r.bin_id for r in rows} - {None})).all()} if rows else {}
    return [serial_svc.serial_dict(db, r, items=items, locs=locs, bins=bins) for r in rows]


@router.get("/statuses")
async def serial_statuses(_user: User = Depends(require_store_lookup())):
    return [{"value": s, "label": STORE_SERIAL_STATUS_LABELS[s]} for s in STORE_SERIAL_STATUSES]


@router.get("")
async def list_serials(
    response: Response,
    item_id: int | None = Query(None),
    status: str | None = Query(None),
    location_id: int | None = Query(None),
    q: str | None = Query(None, description="Serial number, item code / name, GRN or issue reference"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "stock")),
):
    query = _scoped(db, user, db.query(StoreSerialNumber))
    if item_id is not None:
        query = query.filter(StoreSerialNumber.item_id == item_id)
    if status:
        if status not in STORE_SERIAL_STATUSES:
            raise HTTPException(status_code=422, detail=f"Unknown serial status '{status}' — use one of: {', '.join(STORE_SERIAL_STATUSES)}.")
        query = query.filter(StoreSerialNumber.status == status)
    if location_id is not None:
        query = query.filter(StoreSerialNumber.location_id == location_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.join(StoreItem, StoreItem.id == StoreSerialNumber.item_id).filter(or_(
            StoreSerialNumber.serial_no.ilike(like), StoreItem.item_code.ilike(like), StoreItem.item_name.ilike(like),
            StoreSerialNumber.issued_to.ilike(like), StoreSerialNumber.vendor_name.ilike(like)))
    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    rows = query.order_by(StoreSerialNumber.id.desc()).offset(skip).limit(limit).all()
    return _dicts(db, rows)


@router.get("/available")
async def available_serials(
    item_id: int = Query(...),
    location_id: int = Query(...),
    bin_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_store_lookup()),
):
    """Units that can be picked for an issue / transfer at this store (In
    stock, not booked on a transfer) — feeds the serial picker."""
    ensure_location_allowed(db, user, location_id)
    q = db.query(StoreSerialNumber).filter(
        StoreSerialNumber.item_id == item_id, StoreSerialNumber.location_id == location_id,
        StoreSerialNumber.status == "in_stock", StoreSerialNumber.transfer_item_id.is_(None))
    if bin_id is not None:
        q = q.filter(or_(StoreSerialNumber.bin_id == bin_id, StoreSerialNumber.bin_id.is_(None)))
    return [{"id": u.id, "serial_no": u.serial_no, "bin_id": u.bin_id, "received_date": u.received_date,
             "vendor_warranty_until": u.vendor_warranty_until} for u in q.order_by(StoreSerialNumber.received_date, StoreSerialNumber.id).all()]


@router.get("/issued")
async def issued_serials(
    item_id: int = Query(...),
    issue_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_store_lookup()),
):
    """Units out on issue — feeds the serial picker of a material return."""
    q = db.query(StoreSerialNumber).filter(StoreSerialNumber.item_id == item_id, StoreSerialNumber.status == "issued")
    if issue_id is not None:
        q = q.filter(StoreSerialNumber.issue_id == issue_id)
    return [{"id": u.id, "serial_no": u.serial_no, "issued_to": u.issued_to} for u in q.order_by(StoreSerialNumber.id).all()]


@router.get("/{serial_id}")
async def get_serial(serial_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("store", "stock"))):
    unit = _scoped(db, user, db.query(StoreSerialNumber).filter(StoreSerialNumber.id == serial_id)).first()
    if not unit:
        raise HTTPException(status_code=404, detail=f"Serial record #{serial_id} not found, or it is at a store outside your plant access.")
    out = serial_svc.serial_dict(db, unit)
    out["history"] = serial_svc.history(db, unit)
    return out


@router.post("/{serial_id}/quality-result")
async def set_quality_result(
    serial_id: int,
    payload: StoreSerialQualityResultPayload,
    db: Session = Depends(get_db),
    # Same people who decide a GRN inspection.
    user: User = Depends(require_feature_action("store", "grn", "inspection", "approve")),
):
    unit = db.query(StoreSerialNumber).filter(StoreSerialNumber.id == serial_id).with_for_update().first()
    if not unit:
        raise HTTPException(status_code=404, detail=f"Serial record #{serial_id} not found — reload the page.")
    ensure_location_allowed(db, user, unit.location_id)
    try:
        serial_svc.set_quality_result(db, unit, payload.status, user.id, payload.reason)
    except serial_svc.SerialError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    out = serial_svc.serial_dict(db, unit)
    out["history"] = serial_svc.history(db, unit)
    return out
