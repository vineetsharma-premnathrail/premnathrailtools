from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.manufacturing.models.bom import BOM, BOMItem
from app.modules.manufacturing.models.material import Material
from app.modules.manufacturing.schemas.bom import BOMCreate, BOMUpdate, BOMResponse, BOMItemResponse

router = APIRouter(prefix="/manufacturing/boms", tags=["Manufacturing"])


def _to_response(bom: BOM, db: Session) -> BOMResponse:
    output_material = db.query(Material).filter(Material.id == bom.output_material_id).first()
    items = db.query(BOMItem).filter(BOMItem.bom_id == bom.id).all()
    item_responses = []
    for item in items:
        material = db.query(Material).filter(Material.id == item.material_id).first()
        item_responses.append(
            BOMItemResponse.model_validate(item).model_copy(
                update={"material_name": material.name if material else None, "material_code": material.code if material else None}
            )
        )
    return BOMResponse.model_validate(bom).model_copy(
        update={"output_material_name": output_material.name if output_material else None, "items": item_responses}
    )


@router.get("", response_model=list[BOMResponse])
async def list_boms(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    boms = db.query(BOM).order_by(BOM.name.asc()).all()
    return [_to_response(b, db) for b in boms]


@router.post("", response_model=BOMResponse)
async def create_bom(
    payload: BOMCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    if db.query(BOM).filter(BOM.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"BOM code '{payload.code}' already exists")
    if not db.query(Material).filter(Material.id == payload.output_material_id).first():
        raise HTTPException(status_code=404, detail="Output material not found")
    bom = BOM(code=payload.code, name=payload.name, output_material_id=payload.output_material_id, output_quantity=payload.output_quantity)
    db.add(bom)
    db.flush()
    for item in payload.items:
        db.add(BOMItem(bom_id=bom.id, material_id=item.material_id, quantity=item.quantity))
    db.commit()
    db.refresh(bom)
    return _to_response(bom, db)


@router.patch("/{bom_id}", response_model=BOMResponse)
async def update_bom(
    bom_id: int,
    payload: BOMUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    bom = db.query(BOM).filter(BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    data = payload.model_dump(exclude_unset=True, exclude={"items"})
    for field, val in data.items():
        setattr(bom, field, val)
    if payload.items is not None:
        db.query(BOMItem).filter(BOMItem.bom_id == bom.id).delete()
        for item in payload.items:
            db.add(BOMItem(bom_id=bom.id, material_id=item.material_id, quantity=item.quantity))
    db.commit()
    db.refresh(bom)
    return _to_response(bom, db)
