from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.manufacturing.models.stock_entry import StockEntry, STOCK_ENTRY_TYPES
from app.modules.manufacturing.models.material import Material
from app.modules.manufacturing.models.work_order import WorkOrder
from app.modules.manufacturing.schemas.stock_entry import StockEntryCreate, StockEntryResponse

router = APIRouter(prefix="/manufacturing/stock-entries", tags=["Manufacturing"])


def _to_response(entry: StockEntry, db: Session) -> StockEntryResponse:
    material = db.query(Material).filter(Material.id == entry.material_id).first()
    wo = db.query(WorkOrder).filter(WorkOrder.id == entry.work_order_id).first() if entry.work_order_id else None
    creator = db.query(User).filter(User.id == entry.created_by_id).first() if entry.created_by_id else None
    return StockEntryResponse.model_validate(entry).model_copy(
        update={
            "material_name": material.name if material else None,
            "material_code": material.code if material else None,
            "wo_number": wo.wo_number if wo else None,
            "created_by_name": creator.name if creator else None,
        }
    )


@router.get("", response_model=list[StockEntryResponse])
async def list_stock_entries(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    entries = db.query(StockEntry).order_by(StockEntry.id.desc()).all()
    return [_to_response(e, db) for e in entries]


@router.post("", response_model=StockEntryResponse)
async def create_stock_entry(
    payload: StockEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("manufacturing")),
):
    if payload.type not in STOCK_ENTRY_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type '{payload.type}'")
    if not db.query(Material).filter(Material.id == payload.material_id).first():
        raise HTTPException(status_code=404, detail="Material not found")
    entry = StockEntry(**payload.model_dump(), created_by_id=user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _to_response(entry, db)
