from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.location import StoreLocationCreate, StoreLocationUpdate, StoreLocationResponse

router = APIRouter(prefix="/store/locations", tags=["Store"])


@router.get("", response_model=list[StoreLocationResponse])
async def list_locations(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    return db.query(StoreLocation).order_by(StoreLocation.name.asc()).all()


@router.post("", response_model=StoreLocationResponse)
async def create_location(
    payload: StoreLocationCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    if db.query(StoreLocation).filter(StoreLocation.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Location code '{payload.code}' already exists")
    location = StoreLocation(**payload.model_dump())
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.patch("/{location_id}", response_model=StoreLocationResponse)
async def update_location(
    location_id: int,
    payload: StoreLocationUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(location, field, val)
    db.commit()
    db.refresh(location)
    return location
