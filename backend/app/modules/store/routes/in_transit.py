"""GET /store/in-transit-stock — stock dispatched between stores / plants and
not yet received (SAP MB5T): still ours, valued at the cost it left with, on
neither store's balance."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.services.transfer_gst import in_transit_rows

router = APIRouter(prefix="/store/in-transit-stock", tags=["Store"])


@router.get("")
async def in_transit_stock(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("store", "transfers"))):
    rows = in_transit_rows(db)
    return {"rows": rows, "total_value": round(sum(r["value"] or 0 for r in rows), 2), "lines": len(rows)}
