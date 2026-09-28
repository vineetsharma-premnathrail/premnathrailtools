from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_reservation import STORE_RESERVATION_STATUSES, StoreStockReservation
from app.modules.store.schemas.stock_reservation import StoreStockReservationCreate, StoreStockReservationResponse
from app.modules.store.service import generate_stock_reservation_number
from app.modules.store.services.stock_ledger import adjust_reserved_qty

router = APIRouter(prefix="/store/stock-reservations", tags=["Store"])


def _to_response(db: Session, reservation: StoreStockReservation) -> StoreStockReservationResponse:
    item = db.query(StoreItem).filter(StoreItem.id == reservation.item_id).first()
    location = db.query(StoreLocation).filter(StoreLocation.id == reservation.location_id).first()
    reserver = db.query(User).filter(User.id == reservation.reserved_by_id).first() if reservation.reserved_by_id else None
    return StoreStockReservationResponse.model_validate(reservation).model_copy(update={
        "item_code": item.item_code if item else None,
        "item_name": item.item_name if item else None,
        "uom": item.uom if item else None,
        "location_name": location.name if location else None,
        "reserved_by_name": reserver.name if reserver else None,
    })


@router.get("", response_model=list[StoreStockReservationResponse])
async def list_stock_reservations(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockReservation)
    if item_id is not None:
        query = query.filter(StoreStockReservation.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockReservation.location_id == location_id)
    if status is not None:
        query = query.filter(StoreStockReservation.status == status)
    reservations = query.order_by(StoreStockReservation.created_at.desc()).all()
    return [_to_response(db, r) for r in reservations]


@router.get("/{reservation_id}", response_model=StoreStockReservationResponse)
async def get_stock_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    return _to_response(db, reservation)


@router.post("", response_model=StoreStockReservationResponse)
async def create_stock_reservation(
    payload: StoreStockReservationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero")
    if not db.query(StoreItem).filter(StoreItem.id == payload.item_id).first():
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Warehouse not found")

    try:
        adjust_reserved_qty(db, item_id=payload.item_id, location_id=payload.location_id, delta=payload.quantity)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    reservation = StoreStockReservation(
        reservation_number=generate_stock_reservation_number(db),
        item_id=payload.item_id,
        location_id=payload.location_id,
        quantity=payload.quantity,
        project=payload.project,
        production_order=payload.production_order,
        reserved_by_id=user.id,
        required_date=payload.required_date,
        status="active",
        remarks=payload.remarks,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)
    return _to_response(db, reservation)


def _release_reservation(db: Session, reservation: StoreStockReservation, new_status: str, user: User) -> StoreStockReservationResponse:
    if reservation.status != "active":
        raise HTTPException(status_code=409, detail=f"This reservation is already '{reservation.status}'")
    try:
        adjust_reserved_qty(db, item_id=reservation.item_id, location_id=reservation.location_id, delta=-reservation.quantity)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))
    reservation.status = new_status
    db.commit()
    db.refresh(reservation)
    return _to_response(db, reservation)


@router.post("/{reservation_id}/cancel", response_model=StoreStockReservationResponse)
async def cancel_stock_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    return _release_reservation(db, reservation, "cancelled", user)


@router.post("/{reservation_id}/fulfill", response_model=StoreStockReservationResponse)
async def fulfill_stock_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    """Marks the reservation as consumed and releases its earmark. Does NOT
    itself reduce on-hand stock — issue the material through a Material
    Issue as normal; this only stops the reservation from blocking
    available stock once that's been done."""
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    return _release_reservation(db, reservation, "fulfilled", user)


@router.get("/meta/statuses")
async def list_statuses(_user: User = Depends(require_app_access("store"))):
    return {"statuses": STORE_RESERVATION_STATUSES}
