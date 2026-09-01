from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_any_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.vendor.models.vendor import Vendor, VENDOR_CATEGORIES, VENDOR_STATUSES, VENDOR_QUALIFICATION_STATUSES, SUPPLIER_GROUPS
from app.modules.vendor.schemas.vendor import VendorCreate, VendorUpdate, VendorResponse

router = APIRouter(prefix="/vendors", tags=["Vendors"])


@router.get("/meta")
async def get_vendor_meta(_user: User = Depends(require_any_app_access("purchase", "p2p"))):
    return {
        "categories": list(VENDOR_CATEGORIES),
        "statuses": list(VENDOR_STATUSES),
        "qualification_statuses": list(VENDOR_QUALIFICATION_STATUSES),
        "supplier_groups": list(SUPPLIER_GROUPS),
    }


@router.get("", response_model=list[VendorResponse])
async def list_vendors(
    search: str | None = None,
    status: str | None = None,
    qualification_status: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "p2p")),
):
    query = db.query(Vendor)
    if search:
        query = query.filter(Vendor.name.ilike(f"%{search}%"))
    if status:
        query = query.filter(Vendor.status == status)
    if qualification_status:
        query = query.filter(Vendor.qualification_status == qualification_status)
    return query.order_by(Vendor.name.asc()).offset(skip).limit(limit).all()


@router.post("", response_model=VendorResponse)
async def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "p2p")),
):
    if payload.category not in VENDOR_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category '{payload.category}'")
    if payload.supplier_group and payload.supplier_group not in SUPPLIER_GROUPS:
        raise HTTPException(status_code=400, detail=f"Invalid supplier_group '{payload.supplier_group}'")

    data = payload.model_dump()
    contact_name = " ".join(filter(None, [data.get("contact_first_name"), data.get("contact_last_name")]))
    if not data.get("contact_person") and contact_name:
        data["contact_person"] = contact_name
    if not data.get("email") and data.get("contact_email"):
        data["email"] = data["contact_email"]
    if not data.get("phone") and data.get("contact_mobile"):
        data["phone"] = data["contact_mobile"]
    if not data.get("address"):
        address_line = ", ".join(filter(None, [
            data.get("address_line1"), data.get("address_line2"), data.get("city"),
            data.get("state"), data.get("postal_code"), data.get("country"),
        ]))
        if address_line:
            data["address"] = address_line

    vendor = Vendor(**data)
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.get("/{vendor_id}", response_model=VendorResponse)
async def get_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access("purchase", "p2p")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    updates = payload.model_dump(exclude_unset=True)
    if "category" in updates and updates["category"] not in VENDOR_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category '{updates['category']}'")
    if "status" in updates and updates["status"] not in VENDOR_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{updates['status']}'")
    if "qualification_status" in updates and updates["qualification_status"] not in VENDOR_QUALIFICATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid qualification_status '{updates['qualification_status']}'")
    if updates.get("supplier_group") and updates["supplier_group"] not in SUPPLIER_GROUPS:
        raise HTTPException(status_code=400, detail=f"Invalid supplier_group '{updates['supplier_group']}'")

    for field, val in updates.items():
        setattr(vendor, field, val)

    db.commit()
    db.refresh(vendor)
    return vendor
