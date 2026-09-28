from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.schemas.vendor import VendorCreate, VendorUpdate, VendorResponse

router = APIRouter(prefix="/accounts/vendors", tags=["Accounts"])


def _to_response(v: Vendor, db: Session) -> VendorResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == v.gl_reconciliation_account_id).first() if v.gl_reconciliation_account_id else None
    return VendorResponse.model_validate(v).model_copy(update={"gl_reconciliation_account_code": gl.code if gl else None})


@router.get("", response_model=list[VendorResponse])
async def list_vendors(
    status: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(Vendor)
    if status is not None:
        query = query.filter(Vendor.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter((Vendor.code.ilike(like)) | (Vendor.name.ilike(like)))
    vendors = query.order_by(Vendor.name.asc()).all()
    return [_to_response(v, db) for v in vendors]


@router.post("", response_model=VendorResponse, status_code=201)
async def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    if db.query(Vendor).filter(Vendor.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Vendor code '{payload.code}' already exists")
    vendor = Vendor(**payload.model_dump())
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return _to_response(vendor, db)


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if payload.code and payload.code != vendor.code:
        if db.query(Vendor).filter(Vendor.code == payload.code, Vendor.id != vendor_id).first():
            raise HTTPException(status_code=409, detail=f"Vendor code '{payload.code}' already exists")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(vendor, field, value)
    db.commit()
    db.refresh(vendor)
    return _to_response(vendor, db)


@router.delete("/{vendor_id}")
async def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db.delete(vendor)
    db.commit()
    return {"ok": True}
