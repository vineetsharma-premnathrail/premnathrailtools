from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.bin import StoreBin
from app.modules.store.schemas.bin import StoreBinCreate, StoreBinUpdate, StoreBinResponse

router = APIRouter(prefix="/store/bins", tags=["Store"])


@router.get("", response_model=list[StoreBinResponse])
async def list_bins(
    location_id: int | None = Query(None),
    parent_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreBin)
    if location_id is not None:
        query = query.filter(StoreBin.location_id == location_id)
    if parent_id is not None:
        query = query.filter(StoreBin.parent_id == parent_id)
    bins = query.order_by(StoreBin.code.asc()).all()
    return bins


@router.post("", response_model=StoreBinResponse)
async def create_bin(
    payload: StoreBinCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    if db.query(StoreBin).filter(StoreBin.location_id == payload.location_id, StoreBin.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Bin code '{payload.code}' already exists in this store")
    bin_ = StoreBin(**payload.model_dump())
    db.add(bin_)
    db.commit()
    db.refresh(bin_)
    return bin_


@router.patch("/{bin_id}", response_model=StoreBinResponse)
async def update_bin(
    bin_id: int,
    payload: StoreBinUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    bin_ = db.query(StoreBin).filter(StoreBin.id == bin_id).first()
    if not bin_:
        raise HTTPException(status_code=404, detail="Bin not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(bin_, field, val)
    db.commit()
    db.refresh(bin_)
    return bin_


@router.delete("/{bin_id}")
async def delete_bin(
    bin_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    bin_ = db.query(StoreBin).filter(StoreBin.id == bin_id).first()
    if not bin_:
        raise HTTPException(status_code=404, detail="Bin not found")
    if db.query(StoreBin).filter(StoreBin.parent_id == bin_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — this bin has child bins under it.")
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    moves = db.query(StoreStockTransaction.id).filter(StoreStockTransaction.bin_id == bin_id).count()
    if moves:
        raise HTTPException(status_code=409, detail=f"Bin '{bin_.name or bin_.code}' can't be deleted — {moves} stock movement(s) were posted to it and still point at it.")
    db.delete(bin_)
    db.commit()
    return {"ok": True}
