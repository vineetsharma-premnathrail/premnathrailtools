from datetime import date
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.store.services.plant_access import ensure_location_allowed
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_reservation import STORE_RESERVATION_STATUSES, StoreStockReservation
from app.modules.store.schemas.stock_reservation import (
    StoreStockReservationBulkCreate, StoreStockReservationCreate, StoreStockReservationResponse,
)
from app.modules.store.service import generate_stock_reservation_number
from app.modules.store.services.stock_ledger import adjust_reserved_qty
from app.modules.store.services.project_stock import element_info
# Registers the project hooks / 360 provider at startup (this module is
# always imported by main.py).
from app.modules.store import order_project_links  # noqa: F401

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
        **element_info(db, reservation.order_project_element_id, reservation.order_project_id),
    })


@router.get("", response_model=list[StoreStockReservationResponse])
async def list_stock_reservations(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    status: str | None = Query(None),
    order_project_id: int | None = Query(None),
    order_project_element_id: int | None = Query(None),
    project_stock: bool | None = Query(None, description="true = only holds for a project (or its unit); false = only others"),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "reservations")),
):
    query = apply_scope(db.query(StoreStockReservation), user, StoreStockReservation)
    if order_project_id is not None:
        query = query.filter(StoreStockReservation.order_project_id == order_project_id)
    if order_project_element_id is not None:
        query = query.filter(StoreStockReservation.order_project_element_id == order_project_element_id)
    if project_stock is True:
        query = query.filter(StoreStockReservation.order_project_id.isnot(None))
    elif project_stock is False:
        query = query.filter(StoreStockReservation.order_project_id.is_(None))
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
    user: User = Depends(require_tab_access("store", "reservations")),
):
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    ensure_in_scope(db, user, reservation)
    return _to_response(db, reservation)


@router.post("", response_model=StoreStockReservationResponse)
async def create_stock_reservation(
    payload: StoreStockReservationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "reservations", "create")),
):
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero")
    if not db.query(StoreItem).filter(StoreItem.id == payload.item_id).first():
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Store not found")
    ensure_location_allowed(db, user, payload.location_id)
    project_id = element_id = None
    if payload.order_project_element_id or payload.order_project_id:
        # A project without units is reserved for as a whole; a historic sales-order project (units)
        # needs its vehicle / lot (so_projects.resolve_link).
        from app.modules.projects.so_projects import resolve_link
        project, element = resolve_link(db, payload.order_project_id, payload.order_project_element_id, what="stock reservation")
        project_id, element_id = project.id, element.id if element is not None else None

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
        order_project_id=project_id,
        order_project_element_id=element_id,
        source_type="manual",
        original_qty=payload.quantity,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)
    return _to_response(db, reservation)


@router.post("/bulk", response_model=list[StoreStockReservationResponse])
async def create_stock_reservations_bulk(
    payload: StoreStockReservationBulkCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "reservations", "create")),
):
    """Reserve several items in one go from the same store for the same
    purpose. All or nothing: if any line can't be held (e.g. not enough
    available stock) nothing is reserved and the error names the line."""
    lines = [ln for ln in payload.lines if ln.item_id]
    if not lines:
        raise HTTPException(status_code=422, detail="Add at least one item line with a quantity.")
    if len(lines) > 1000:
        raise HTTPException(status_code=422, detail=f"{len(lines)} lines — one reservation can hold at most 1000; split it.")
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Store not found — pick the store again from the list.")
    ensure_location_allowed(db, user, payload.location_id)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({ln.item_id for ln in lines})).all()}
    problems = []
    for n, ln in enumerate(lines, start=1):
        if ln.item_id not in items:
            problems.append(f"Line {n}: item not found in the Item Master — pick it again.")
        elif ln.quantity <= 0:
            problems.append(f"Line {n} ({items[ln.item_id].item_code}): quantity must be greater than zero.")
    if problems:
        raise HTTPException(status_code=422, detail=" ".join(problems))
    project_id = element_id = None
    if payload.order_project_element_id or payload.order_project_id:
        from app.modules.projects.so_projects import resolve_link
        project, element = resolve_link(db, payload.order_project_id, payload.order_project_element_id, what="stock reservation")
        project_id, element_id = project.id, element.id if element is not None else None

    created = []
    # Lock balance rows in item order (as GRN posting does) so two overlapping
    # bulk saves can't deadlock; n stays the line number the user typed.
    for n, ln in sorted(enumerate(lines, start=1), key=lambda p: p[1].item_id):
        item = items[ln.item_id]
        try:
            adjust_reserved_qty(db, item_id=item.id, location_id=payload.location_id, delta=ln.quantity)
        except ValueError as e:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=f"Line {n} ({item.item_code} — {item.item_name}) can't be reserved in {location.name}: {e}. "
                       "Nothing was reserved — lower that quantity or remove the line, then save again.",
            )
        reservation = StoreStockReservation(
            reservation_number=generate_stock_reservation_number(db),
            item_id=item.id, location_id=payload.location_id, quantity=ln.quantity,
            project=payload.project, production_order=payload.production_order, reserved_by_id=user.id,
            required_date=payload.required_date, status="active",
            remarks=(ln.remarks or "").strip() or payload.remarks,
            order_project_id=project_id, order_project_element_id=element_id,
            source_type="manual", original_qty=ln.quantity,
        )
        db.add(reservation)
        db.flush()  # the next number in the series sees this one
        created.append(reservation)
    db.commit()
    return [_to_response(db, r) for r in created]


RESERVATION_LINE_COLUMNS = ["item_code", "quantity", "remarks"]


@router.get("/import-lines/template")
async def reservation_lines_template(_user: User = Depends(require_tab_action("store", "reservations", "create"))):
    """Excel template for loading a reservation's item lines."""
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Reservation lines"
    ws.append(RESERVATION_LINE_COLUMNS)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="FDF1E6")
    ws.append(["01", 5, "Example line — replace with your items"])
    for col, w in zip("ABC", (20, 12, 40)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="stock_reservation_lines_template.xlsx"'})


@router.post("/import-lines")
async def import_reservation_lines(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "reservations", "create")),
):
    """Reads item lines (item_code, quantity, remarks) from Excel / CSV into
    the New Reservation form — nothing is reserved yet. Same reader as the
    material-issue line import; unknown codes / bad quantities come back per row."""
    from app.modules.store.routes.material_issues import import_issue_lines
    return await import_issue_lines(file=file, db=db, _user=user)


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


# Cancelling releases the hold but keeps the record (status change), so it
# is an edit, not a delete.
@router.post("/{reservation_id}/cancel", response_model=StoreStockReservationResponse)
async def cancel_stock_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "reservations", "edit")),
):
    # Locked so a double-click can't release the same hold twice (the second
    # release would eat into another reservation's reserved quantity).
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).with_for_update().first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    ensure_in_scope(db, user, reservation)
    return _release_reservation(db, reservation, "cancelled", user)


@router.post("/{reservation_id}/fulfill", response_model=StoreStockReservationResponse)
async def fulfill_stock_reservation(
    reservation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "reservations", "edit")),
):
    """Marks the reservation as consumed and releases its earmark. Does NOT
    itself reduce on-hand stock — issue the material through a Material
    Issue as normal; this only stops the reservation from blocking
    available stock once that's been done."""
    # Locked so a double-click can't release the same hold twice (the second
    # release would eat into another reservation's reserved quantity).
    reservation = db.query(StoreStockReservation).filter(StoreStockReservation.id == reservation_id).with_for_update().first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Stock reservation not found")
    ensure_in_scope(db, user, reservation)
    return _release_reservation(db, reservation, "fulfilled", user)


@router.get("/meta/statuses")
async def list_statuses(_user: User = Depends(require_app_access("store"))):
    return {"statuses": STORE_RESERVATION_STATUSES}
