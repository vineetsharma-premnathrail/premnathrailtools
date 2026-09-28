from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation
from app.modules.store.schemas.location import StoreLocationCreate, StoreLocationUpdate, StoreLocationResponse

router = APIRouter(prefix="/store/locations", tags=["Store"])


def _to_response(location: StoreLocation, db: Session) -> StoreLocationResponse:
    branch_name = None
    if location.branch_id:
        from app.modules.organization.models.branch import Branch  # local import avoids a cross-module cycle at startup
        branch = db.query(Branch).filter(Branch.id == location.branch_id).first()
        branch_name = branch.name if branch else None
    manager = db.query(User).filter(User.id == location.manager_user_id).first() if location.manager_user_id else None
    return StoreLocationResponse.model_validate(location).model_copy(
        update={"branch_name": branch_name, "manager_user_name": manager.name if manager else None}
    )


@router.get("", response_model=list[StoreLocationResponse])
async def list_locations(
    branch_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreLocation)
    if branch_id is not None:
        query = query.filter(StoreLocation.branch_id == branch_id)
    locations = query.order_by(StoreLocation.name.asc()).all()
    return [_to_response(loc, db) for loc in locations]


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
    return _to_response(location, db)


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
    return _to_response(location, db)


@router.delete("/{location_id}")
async def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    from app.modules.organization.models.branch import Branch  # local import avoids a cross-module cycle at startup
    if db.query(Branch).filter(Branch.default_warehouse_id == location_id).first():
        raise HTTPException(status_code=409, detail="Cannot delete — this warehouse is set as a branch's default warehouse.")
    db.delete(location)
    db.commit()
    return {"ok": True}
