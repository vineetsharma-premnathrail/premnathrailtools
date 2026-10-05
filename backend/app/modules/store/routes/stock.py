from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.bin import StoreBin
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import STORE_STOCK_TXN_TYPES, StoreStockTransaction
from app.modules.store.schemas.stock import (
    StoreQuarantineClear,
    StoreStockBalanceResponse,
    StoreStockTransactionCreate,
    StoreStockTransactionResponse,
)
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.routes.doc_types import doc_type_labels, get_doc_type

router = APIRouter(prefix="/store/stock", tags=["Store"])

# Manual entries are typed by a Stock Entry Type from Store → Settings
# (StoreDocType kind "stock_entry"). The three seeded types post their own
# ledger type; any custom type posts manual_in / manual_out by its
# stock_effect and keeps its value in entry_type for the history label.
# adjustment_in/out are NOT allowed (2026-10-01): adjustments must go
# through Store → Adjustments so they get an approval and a number.
_MANUAL_ALLOWED_TYPES = ("receipt", "issue", "damage")

QUARANTINE_DISPOSITIONS = {
    "scrap": "Scrapped",
    "vendor_return": "Returned to vendor",
    "release": "Released to usable stock",
}


def _txn_to_response(db: Session, txn: StoreStockTransaction, entry_labels: dict[str, str] | None = None) -> StoreStockTransactionResponse:
    item = db.query(StoreItem).filter(StoreItem.id == txn.item_id).first()
    location = db.query(StoreLocation).filter(StoreLocation.id == txn.location_id).first()
    bin_ = db.query(StoreBin).filter(StoreBin.id == txn.bin_id).first() if txn.bin_id else None
    creator = db.query(User).filter(User.id == txn.created_by_id).first() if txn.created_by_id else None
    return StoreStockTransactionResponse.model_validate(txn).model_copy(update={
        "item_code": item.item_code if item else None,
        "item_name": item.item_name if item else None,
        "location_name": location.name if location else None,
        "bin_code": bin_.code if bin_ else None,
        "created_by_name": creator.name if creator else None,
        "entry_type_label": (entry_labels if entry_labels is not None else doc_type_labels(db, "stock_entry")).get(txn.entry_type) if txn.entry_type else None,
    })


@router.get("/balances", response_model=list[StoreStockBalanceResponse])
async def list_balances(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockBalance)
    if item_id is not None:
        query = query.filter(StoreStockBalance.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockBalance.location_id == location_id)
    balances = query.all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({b.item_id for b in balances})).all()} if balances else {}
    locations = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_({b.location_id for b in balances})).all()} if balances else {}
    result = []
    for b in balances:
        item = items.get(b.item_id)
        location = locations.get(b.location_id)
        result.append(StoreStockBalanceResponse.model_validate(b).model_copy(update={
            "item_code": item.item_code if item else None,
            "item_name": item.item_name if item else None,
            "uom": item.uom if item else None,
            "location_name": location.name if location else None,
            "available_qty": b.on_hand_qty - b.reserved_qty,
            "quarantine_qty": b.quarantine_qty or 0,
        }))
    result.sort(key=lambda r: (r.item_name or "", r.location_name or ""))
    return result


@router.get("/transactions", response_model=list[StoreStockTransactionResponse])
async def list_transactions(
    item_id: int | None = Query(None),
    location_id: int | None = Query(None),
    transaction_type: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreStockTransaction)
    if item_id is not None:
        query = query.filter(StoreStockTransaction.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockTransaction.location_id == location_id)
    if transaction_type is not None:
        query = query.filter(StoreStockTransaction.transaction_type == transaction_type)
    txns = query.order_by(StoreStockTransaction.transaction_date.desc(), StoreStockTransaction.id.desc()).limit(500).all()
    labels = doc_type_labels(db, "stock_entry")
    return [_txn_to_response(db, t, labels) for t in txns]


@router.post("/transactions", response_model=StoreStockTransactionResponse)
async def create_transaction(
    payload: StoreStockTransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if payload.transaction_type in ("adjustment_in", "adjustment_out"):
        raise HTTPException(
            status_code=422,
            detail="Stock adjustments can't be recorded here — use Store → Adjustments → New, so the adjustment gets an approver and shows in the Adjustments list.",
        )
    entry = get_doc_type(db, "stock_entry", payload.entry_type or payload.transaction_type, field="stock entry type")
    if entry.value in _MANUAL_ALLOWED_TYPES:
        txn_type = entry.value
    else:
        txn_type = "manual_in" if entry.stock_effect == "in" else "manual_out"
    if not db.query(StoreItem).filter(StoreItem.id == payload.item_id).first():
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Store not found")
    try:
        txn = post_stock_transaction(
            db,
            item_id=payload.item_id,
            location_id=payload.location_id,
            bin_id=payload.bin_id,
            transaction_type=txn_type,
            entry_type=entry.value,
            quantity=payload.quantity,
            batch_number=payload.batch_number,
            reference_type=payload.reference_type or "manual",
            reference_number=payload.reference_number,
            transaction_date=payload.transaction_date,
            remarks=payload.remarks,
            vendor_name=(payload.vendor_name or "").strip() or None,
            created_by_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    db.commit()
    db.refresh(txn)
    return _txn_to_response(db, txn)


@router.get("/vendor-options")
async def vendor_options(db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Vendor names for the stock-entry Vendor field: the Accounts vendor
    master plus names already typed on earlier entries (store users can't
    open the Accounts vendor list itself)."""
    from app.modules.accounts.models.vendor import Vendor
    names = {n for (n,) in db.query(Vendor.name).filter(Vendor.status == "active").all() if n}
    names |= {n for (n,) in db.query(StoreStockTransaction.vendor_name).filter(StoreStockTransaction.vendor_name.isnot(None)).distinct().all()}
    return sorted(names, key=str.lower)


@router.get("/transaction-types")
async def list_transaction_types(_user: User = Depends(require_app_access("store"))):
    return {"all": STORE_STOCK_TXN_TYPES, "manual": _MANUAL_ALLOWED_TYPES}


@router.post("/quarantine/clear", response_model=list[StoreStockTransactionResponse])
async def clear_quarantine(
    payload: StoreQuarantineClear,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    """Takes damaged/rejected material out of a warehouse's quarantine
    bucket: scrapped, sent back to the vendor, or released to usable stock
    (e.g. QC re-inspected and passed it)."""
    if payload.disposition not in QUARANTINE_DISPOSITIONS:
        raise HTTPException(status_code=422, detail=f"Choose what happened to the material: {', '.join(QUARANTINE_DISPOSITIONS.values())}.")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero.")
    item = db.query(StoreItem).filter(StoreItem.id == payload.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Store not found")
    remarks = f"{QUARANTINE_DISPOSITIONS[payload.disposition]}" + (f" — {payload.remarks.strip()}" if payload.remarks and payload.remarks.strip() else "")
    common = dict(item_id=payload.item_id, location_id=payload.location_id, quantity=payload.quantity,
                  reference_type="quarantine", reference_number=payload.disposition, remarks=remarks, created_by_id=user.id)
    try:
        txns = [post_stock_transaction(db, transaction_type="quarantine_out", **common)]
        if payload.disposition == "release":
            txns.append(post_stock_transaction(db, transaction_type="return_in", **common))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Can't clear quarantine for '{item.item_name}': {e}. Check the Quarantine column on the Stock page.")
    db.commit()
    return [_txn_to_response(db, t) for t in txns]
