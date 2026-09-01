from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.manufacturing.models.material import Material
from app.modules.manufacturing.schemas.material import MaterialCreate, MaterialUpdate, MaterialResponse

router = APIRouter(prefix="/manufacturing/materials", tags=["Manufacturing"])


@router.get("", response_model=list[MaterialResponse])
async def list_materials(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    return db.query(Material).order_by(Material.name.asc()).all()


@router.post("", response_model=MaterialResponse)
async def create_material(
    payload: MaterialCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    if db.query(Material).filter(Material.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Material code '{payload.code}' already exists")
    material = Material(**payload.model_dump())
    db.add(material)
    db.commit()
    db.refresh(material)
    return material


@router.patch("/{material_id}", response_model=MaterialResponse)
async def update_material(
    material_id: int,
    payload: MaterialUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("manufacturing")),
):
    material = db.query(Material).filter(Material.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(material, field, val)
    db.commit()
    db.refresh(material)
    return material
