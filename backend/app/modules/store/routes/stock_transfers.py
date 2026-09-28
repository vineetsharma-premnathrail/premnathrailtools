from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transfer import StoreStockTransfer, StoreStockTransferItem
from app.modules.store.schemas.stock_transfer import StoreStockTransferCreate, StoreStockTransferResponse
from app.modules.store.service import generate_stock_transfer_number
from app.modules.store.services.stock_ledger import post_stock_transaction

router = APIRouter(prefix="/store/stock-transfers", tags=["Store"])


def _to_response(db: Session, transfer: StoreStockTransfer) -> StoreStockTransferResponse:
    from_loc = db.query(StoreLocation).filter(StoreLocation.id == transfer.from_location_id).first()
    to_loc = db.query(StoreLocation).filter(StoreLocation.id == transfer.to_location_id).first()
    transferrer = db.query(User).filter(User.id == transfer.transferred_by_id).first() if transfer.transferred_by_id else None
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in transfer.items])).all()} if transfer.items else {}

    resp = StoreStockTransferResponse.model_validate(transfer)
    resp.from_location_name = from_loc.name if from_loc else None
    resp.to_location_name = to_loc.name if to_loc else None
    resp.transferred_by_name = transferrer.name if transferrer else None
    for line, item_resp in zip(transfer.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
    return resp


@router.get("", response_model=list[StoreStockTransferResponse])
async def list_stock_transfers(
    from_location_id: int | None = Query(None),
    to_location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items))
    if from_location_id is not None:
        query = query.filter(StoreStockTransfer.from_location_id == from_location_id)
    if to_location_id is not None:
        query = query.filter(StoreStockTransfer.to_location_id == to_location_id)
    transfers = query.order_by(StoreStockTransfer.created_at.desc()).all()
    return [_to_response(db, t) for t in transfers]


@router.get("/{transfer_id}", response_model=StoreStockTransferResponse)
async def get_stock_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    transfer = db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items)).filter(StoreStockTransfer.id == transfer_id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Stock transfer not found")
    return _to_response(db, transfer)


@router.post("", response_model=StoreStockTransferResponse)
async def create_stock_transfer(
    payload: StoreStockTransferCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if payload.from_location_id == payload.to_location_id:
        raise HTTPException(status_code=422, detail="Source and destination warehouse must be different")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.from_location_id).first():
        raise HTTPException(status_code=404, detail="Source warehouse not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.to_location_id).first():
        raise HTTPException(status_code=404, detail="Destination warehouse not found")

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Quantity for '{items_by_id[p.item_id].item_name}' must be greater than zero")

    transfer = StoreStockTransfer(
        transfer_number=generate_stock_transfer_number(db),
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        transfer_date=payload.transfer_date or date.today(),
        reason=payload.reason,
        transferred_by_id=user.id,
        remarks=payload.remarks,
    )
    db.add(transfer)
    db.flush()

    try:
        for p in payload.items:
            db.add(StoreStockTransferItem(
                transfer_id=transfer.id, item_id=p.item_id, quantity=p.quantity,
                batch_number=p.batch_number, remarks=p.remarks,
            ))
            post_stock_transaction(
                db, item_id=p.item_id, location_id=payload.from_location_id, transaction_type="transfer_out",
                quantity=p.quantity, batch_number=p.batch_number, reference_type="stock_transfer",
                reference_number=transfer.transfer_number, transaction_date=transfer.transfer_date,
                created_by_id=user.id,
            )
            post_stock_transaction(
                db, item_id=p.item_id, location_id=payload.to_location_id, transaction_type="transfer_in",
                quantity=p.quantity, batch_number=p.batch_number, reference_type="stock_transfer",
                reference_number=transfer.transfer_number, transaction_date=transfer.transfer_date,
                created_by_id=user.id,
            )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    db.commit()
    db.refresh(transfer)
    transfer = db.query(StoreStockTransfer).options(selectinload(StoreStockTransfer.items)).filter(StoreStockTransfer.id == transfer.id).first()
    return _to_response(db, transfer)
