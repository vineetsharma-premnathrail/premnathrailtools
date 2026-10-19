"""WM bin stock (SAP LS24 per material / LS26 per bin) and bin-to-bin moves
(LT10) inside one store — services/bins.py."""
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permissions import require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.bin_move import StoreBinMove
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.bins import BinError, move_between_bins, stock_by_bin
from app.modules.store.services.plant_access import ensure_location_allowed, visible_location_ids

router = APIRouter(prefix="/store/bin-stock", tags=["Store"])


class StoreBinMoveCreate(BaseModel):
    item_id: int
    location_id: int
    from_bin_id: int | None = None
    to_bin_id: int | None = None
    quantity: float
    batch_number: str | None = None
    remarks: str | None = None


def _rows(db: Session, user: User, location_id, item_id, bin_id, include_unassigned=True) -> list[dict]:
    if location_id is not None:
        ensure_location_allowed(db, user, location_id)
    return stock_by_bin(db, location_ids=visible_location_ids(db, user), location_id=location_id, item_id=item_id,
                        bin_id=bin_id, include_unassigned=include_unassigned)


@router.get("")
async def bin_stock(
    location_id: int | None = Query(None),
    item_id: int | None = Query(None),
    bin_id: int | None = Query(None),
    include_unassigned: bool = Query(True),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "stock")),
):
    """Stock per item × store × bin; the row with bin_id null is what is in
    the store but not in any bin ('Unassigned')."""
    return _rows(db, user, location_id, item_id, bin_id, include_unassigned)


@router.get("/export")
async def export_bin_stock(
    location_id: int | None = Query(None),
    item_id: int | None = Query(None),
    bin_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("store", "stock", "export")),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    rows = _rows(db, user, location_id, item_id, bin_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "Stock by bin"
    ws.append(["Item code", "Item", "UoM", "Store", "Bin", "Bin name", "Quantity"])
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="FDF1E6")
    for r in rows:
        ws.append([r["item_code"], r["item_name"], r["uom"], r["location_name"], r["bin_code"] or "Unassigned", r["bin_name"], r["quantity"]])
    for col, w in zip("ABCDEFG", (16, 36, 8, 22, 14, 24, 12)):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="stock_by_bin.xlsx"'})


def _move_dict(db: Session, m: StoreBinMove) -> dict:
    item = db.get(StoreItem, m.item_id)
    loc = db.get(StoreLocation, m.location_id)
    codes = {b.id: b.code for b in db.query(StoreBin).filter(StoreBin.id.in_({m.from_bin_id, m.to_bin_id} - {None})).all()}
    user = db.get(User, m.created_by_id) if m.created_by_id else None
    return {"id": m.id, "move_number": m.move_number, "item_id": m.item_id, "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None, "uom": item.uom if item else None, "location_id": m.location_id,
            "location_name": loc.name if loc else None, "from_bin_id": m.from_bin_id, "from_bin_code": codes.get(m.from_bin_id),
            "to_bin_id": m.to_bin_id, "to_bin_code": codes.get(m.to_bin_id), "quantity": m.quantity, "batch_number": m.batch_number,
            "move_date": m.move_date, "remarks": m.remarks, "created_by_name": (user.name or user.email) if user else None}


@router.get("/moves")
async def list_bin_moves(
    location_id: int | None = Query(None),
    item_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("store", "stock")),
):
    q = db.query(StoreBinMove)
    allowed = visible_location_ids(db, user)
    if allowed is not None:
        q = q.filter(StoreBinMove.location_id.in_(allowed or {-1}))
    if location_id is not None:
        q = q.filter(StoreBinMove.location_id == location_id)
    if item_id is not None:
        q = q.filter(StoreBinMove.item_id == item_id)
    return [_move_dict(db, m) for m in q.order_by(StoreBinMove.id.desc()).limit(300).all()]


@router.post("/moves", status_code=201)
async def create_bin_move(
    payload: StoreBinMoveCreate,
    db: Session = Depends(get_db),
    # Moving stock is a Store Transfers action (here: inside one store).
    user: User = Depends(require_feature_action("store", "transfers", "bin_moves", "create")),
):
    item = db.get(StoreItem, payload.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in the Item Master — reload the page and pick it again.")
    if not db.get(StoreLocation, payload.location_id):
        raise HTTPException(status_code=404, detail="Store not found — pick one from the list.")
    ensure_location_allowed(db, user, payload.location_id)
    try:
        move = move_between_bins(db, item=item, location_id=payload.location_id, from_bin_id=payload.from_bin_id,
                                 to_bin_id=payload.to_bin_id, qty=payload.quantity,
                                 batch_number=(payload.batch_number or "").strip() or None, user_id=user.id,
                                 remarks=(payload.remarks or "").strip() or None)
    except BinError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    return _move_dict(db, move)
