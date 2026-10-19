from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.access import require_store_lookup
from app.modules.store.models.bin import STORE_BIN_TYPES, StoreBin
from app.modules.store.models.bin_move import StoreBinMove
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.bin import StoreBinCreate, StoreBinUpdate, StoreBinResponse
from app.modules.store.services.plant_access import ensure_location_allowed

router = APIRouter(prefix="/store/bins", tags=["Store"])

# Bins are kept by the store team itself (Store › Inventory › Bins, tab
# 'bins'), not a Settings master. Listing is a cross-module lookup.

# Which level may sit under which: a rack is top-level, a shelf sits in a
# rack, a bin sits on a shelf, in a rack, or directly in a small store.
_ALLOWED_PARENT = {"rack": (None,), "shelf": ("rack",), "bin": (None, "rack", "shelf")}
_LEVEL = {"rack": "Rack", "shelf": "Shelf", "bin": "Bin"}


def _check_type(bin_type: str) -> str:
    bin_type = (bin_type or "").strip().lower()
    if bin_type not in STORE_BIN_TYPES:
        raise HTTPException(status_code=422, detail=f"Type '{bin_type}' is not valid — pick Rack, Shelf or Bin.")
    return bin_type


def _check_parent(db: Session, bin_type: str, parent_id: int | None, location_id: int, bin_id: int | None = None) -> None:
    """The parent must be a bin of the SAME store, of a level that may hold this one."""
    parent = None
    if parent_id is not None:
        if bin_id is not None and parent_id == bin_id:
            raise HTTPException(status_code=422, detail="A bin can't be its own parent — pick a different parent or leave it empty.")
        parent = db.query(StoreBin).filter(StoreBin.id == parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail=f"Parent #{parent_id} not found — it may have been deleted. Reload the page and pick again.")
        if parent.location_id != location_id:
            raise HTTPException(status_code=422, detail=f"Parent '{parent.code}' belongs to another store — pick a parent from this store.")
    parent_type = parent.bin_type if parent else None
    if parent_type not in _ALLOWED_PARENT[bin_type]:
        if bin_type == "rack":
            raise HTTPException(status_code=422, detail="A rack is the top level — leave Parent empty.")
        if bin_type == "shelf":
            raise HTTPException(status_code=422, detail="A shelf must sit in a rack — pick the rack as Parent (create the rack first if it isn't there).")
        raise HTTPException(status_code=422, detail=f"A bin can't sit under a {_LEVEL[parent_type].lower()} — pick a rack or shelf as Parent, or leave it empty.")
    # Moving a bin under one of its own children would make a loop.
    p = parent
    while p is not None and bin_id is not None:
        if p.id == bin_id:
            raise HTTPException(status_code=422, detail="That parent sits inside this bin — pick a parent outside it.")
        p = db.get(StoreBin, p.parent_id) if p.parent_id else None


def _check_code_free(db: Session, location_id: int, code: str, bin_id: int | None = None) -> None:
    q = db.query(StoreBin).filter(StoreBin.location_id == location_id, StoreBin.code == code)
    if bin_id is not None:
        q = q.filter(StoreBin.id != bin_id)
    if q.first():
        loc = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar()
        raise HTTPException(status_code=409, detail=f"Code '{code}' is already used in {loc or 'this store'} — pick another code (the same code may be reused in a different store).")


def _held_qty(db: Session, bin_: StoreBin) -> float:
    from app.modules.store.services.bins import bin_quantities
    return sum(v for v in bin_quantities(db, location_id=bin_.location_id, bin_id=bin_.id).values() if v > 1e-9)


@router.get("", response_model=list[StoreBinResponse])
async def list_bins(
    location_id: int | None = Query(None),
    parent_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_store_lookup()),
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
    _user: User = Depends(require_tab_action("store", "bins", "create")),
):
    location = db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail=f"Store #{payload.location_id} not found — reload the page and pick the store again.")
    ensure_location_allowed(db, _user, payload.location_id)
    bin_type = _check_type(payload.bin_type)
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Code is required — e.g. R1 for a rack, R1-S2 for a shelf, R1-S2-B3 for a bin.")
    _check_parent(db, bin_type, payload.parent_id, payload.location_id)
    _check_code_free(db, payload.location_id, code)
    bin_ = StoreBin(location_id=payload.location_id, parent_id=payload.parent_id, bin_type=bin_type, code=code,
                    name=(payload.name or "").strip() or None)
    db.add(bin_)
    db.commit()
    db.refresh(bin_)
    return bin_


@router.patch("/{bin_id}", response_model=StoreBinResponse)
async def update_bin(
    bin_id: int,
    payload: StoreBinUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("store", "bins", "edit")),
):
    bin_ = db.query(StoreBin).filter(StoreBin.id == bin_id).first()
    if not bin_:
        raise HTTPException(status_code=404, detail=f"Bin #{bin_id} not found — it may have been deleted. Reload the page.")
    ensure_location_allowed(db, _user, bin_.location_id)
    changes = payload.model_dump(exclude_unset=True)
    if "code" in changes:
        changes["code"] = (changes["code"] or "").strip().upper()
        if not changes["code"]:
            raise HTTPException(status_code=422, detail="Code can't be empty.")
        _check_code_free(db, bin_.location_id, changes["code"], bin_id=bin_.id)
    if "name" in changes:
        changes["name"] = (changes["name"] or "").strip() or None
    if "bin_type" in changes or "parent_id" in changes:
        new_type = _check_type(changes.get("bin_type", bin_.bin_type))
        changes["bin_type"] = new_type
        _check_parent(db, new_type, changes.get("parent_id", bin_.parent_id), bin_.location_id, bin_id=bin_.id)
        if new_type != bin_.bin_type:
            kids = db.query(StoreBin).filter(StoreBin.parent_id == bin_.id).all()
            if any(new_type not in _ALLOWED_PARENT[k.bin_type] for k in kids):
                raise HTTPException(status_code=422, detail=f"'{bin_.code}' has shelves/bins under it that can't sit under a {new_type} — move them first.")
    if changes.get("is_active") is False and bin_.is_active:
        held = _held_qty(db, bin_)
        if held > 0:
            raise HTTPException(status_code=409, detail=f"'{bin_.code}' still holds {held:g} unit(s) of stock — move it out first (Store › Inventory › Bin Stock › Move), then deactivate.")
        if db.query(StoreBin).filter(StoreBin.parent_id == bin_.id, StoreBin.is_active.is_(True)).first():
            raise HTTPException(status_code=409, detail=f"'{bin_.code}' has active shelves/bins under it — deactivate those first.")
    for field, val in changes.items():
        setattr(bin_, field, val)
    db.commit()
    db.refresh(bin_)
    return bin_


@router.delete("/{bin_id}")
async def delete_bin(
    bin_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("store", "bins", "delete")),
):
    bin_ = db.query(StoreBin).filter(StoreBin.id == bin_id).first()
    if not bin_:
        raise HTTPException(status_code=404, detail=f"Bin #{bin_id} not found — it may already be deleted. Reload the page.")
    ensure_location_allowed(db, _user, bin_.location_id)
    if db.query(StoreBin).filter(StoreBin.parent_id == bin_id).first():
        raise HTTPException(status_code=409, detail=f"'{bin_.code}' can't be deleted — it has shelves/bins under it. Delete or move those first.")
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    moves = db.query(StoreStockTransaction.id).filter(StoreStockTransaction.bin_id == bin_id).count()
    moves += db.query(StoreBinMove.id).filter((StoreBinMove.from_bin_id == bin_id) | (StoreBinMove.to_bin_id == bin_id)).count()
    if moves:
        raise HTTPException(status_code=409, detail=f"'{bin_.code}' can't be deleted — {moves} stock movement(s) were posted to it and still point at it. Deactivate it instead (empty it first).")
    db.delete(bin_)
    db.commit()
    return {"ok": True}
