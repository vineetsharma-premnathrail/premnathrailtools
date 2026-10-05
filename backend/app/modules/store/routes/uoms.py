from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.core.permissions import require_app_access
from app.modules.store.models.item import StoreItem, StoreUom, STORE_UOMS

# Open to any signed-in user: the UOM dropdown is shared by Store items and
# PR lines, and requesters usually don't hold the `store` app.
router = APIRouter(prefix="/store/uoms", tags=["Store"])


class UomIn(BaseModel):
    code: str
    label: str = ""


def uom_options(db: Session) -> list[dict]:
    """Dropdown options for every UOM picker. Seeds the default list on an
    empty table (fresh DBs built without the migration, e.g. tests)."""
    if not db.query(StoreUom.id).first():
        db.add_all([StoreUom(code=c, label=l) for c, l in STORE_UOMS.items()])
        db.commit()
    return [{"value": u.code, "label": f"{u.code} — {u.label}" if u.label else u.code}
            for u in db.query(StoreUom).order_by(StoreUom.id).all()]


def _clean(payload: UomIn) -> tuple[str, str]:
    code = payload.code.strip().upper()
    label = payload.label.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Enter the unit code (e.g. NOS, KG, MTR).")
    if len(code) > 20:
        raise HTTPException(status_code=400, detail=f"Unit code '{code}' is too long — keep it to 20 characters or fewer.")
    if len(label) > 100:
        raise HTTPException(status_code=400, detail="Unit name is too long — keep it to 100 characters or fewer.")
    return code, label


@router.get("")
async def list_uoms(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    return uom_options(db)


@router.post("")
async def create_uom(payload: UomIn, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    code, label = _clean(payload)
    if db.query(StoreUom).filter(StoreUom.code == code).first():
        raise HTTPException(status_code=409, detail=f"Unit '{code}' already exists — pick it from the list or edit it instead.")
    db.add(StoreUom(code=code, label=label))
    db.commit()
    return uom_options(db)


@router.put("/{code}")
async def update_uom(code: str, payload: UomIn, db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    uom = db.query(StoreUom).filter(StoreUom.code == code.strip().upper()).first()
    if not uom:
        raise HTTPException(status_code=404, detail=f"Unit '{code}' wasn't found — it may have been renamed. Reload the page and try again.")
    new_code, label = _clean(payload)
    if new_code != uom.code:
        if db.query(StoreUom).filter(StoreUom.code == new_code).first():
            raise HTTPException(status_code=409, detail=f"Unit '{new_code}' already exists — choose a different code.")
        # Keep existing items on the renamed unit.
        db.query(StoreItem).filter(StoreItem.uom == uom.code).update({StoreItem.uom: new_code}, synchronize_session=False)
        uom.code = new_code
    uom.label = label
    db.commit()
    return uom_options(db)


@router.delete("/{code}")
async def delete_uom(code: str, db: Session = Depends(get_db), _user: User = Depends(require_app_access("store"))):
    """Removes a unit nobody has used yet. A unit already on an item, PR,
    PO or GRN line stays — deleting it would leave those records pointing
    at a unit that no longer exists."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceiptItem
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrderItem

    uom_options(db)
    uom = db.query(StoreUom).filter(StoreUom.code == code.strip().upper()).first()
    if not uom:
        raise HTTPException(status_code=404, detail=f"Unit '{code}' wasn't found — it may already be deleted. Reload the page.")
    used = [
        (db.query(StoreItem).filter((StoreItem.uom == uom.code) | (StoreItem.secondary_uom == uom.code)).count(), "store item(s)"),
        (db.query(P2PRequestItem).filter(P2PRequestItem.unit == uom.code).count(), "PR line(s)"),
        (db.query(P2PPurchaseOrderItem).filter(P2PPurchaseOrderItem.unit == uom.code).count(), "PO line(s)"),
        (db.query(P2PGoodsReceiptItem).filter(P2PGoodsReceiptItem.unit == uom.code).count(), "GRN line(s)"),
    ]
    if in_use := [f"{n} {what}" for n, what in used if n]:
        raise HTTPException(status_code=409, detail=f"Unit '{uom.code}' can't be deleted — it's already used on {', '.join(in_use)}. Edit its name instead, or change those records to another unit first.")
    if db.query(StoreUom).count() <= 1:
        raise HTTPException(status_code=409, detail=f"'{uom.code}' is the only unit left — add another unit before deleting it.")
    db.delete(uom)
    db.commit()
    return uom_options(db)
