"""Picker options for Production forms. Production users pick Store items,
Store locations, ERP machines, plants and people, but usually don't hold the
Store / ERP / Organization app themselves — so these read-only lists are
served under the production permission instead of those modules' own
routes."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.insights import ProductionLookupOption
from app.modules.production.service import project_label
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation

router = APIRouter(
    prefix="/production/lookups", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_LIMIT = 50


@router.get("/items", response_model=list[ProductionLookupOption])
async def lookup_items(
    search: str | None = None,
    item_type: str | None = None,
    limit: int = Query(_LIMIT, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(StoreItem).filter(StoreItem.status == "active")
    if item_type:
        query = query.filter(StoreItem.item_type.in_(item_type.split(",")))
    if search:
        like = f"%{search}%"
        query = query.filter((StoreItem.item_code.ilike(like)) | (StoreItem.item_name.ilike(like)) | (StoreItem.part_number.ilike(like)))
    return [
        ProductionLookupOption(id=i.id, code=i.item_code, label=f"{i.item_code} — {i.item_name}", extra=i.uom)
        for i in query.order_by(StoreItem.item_code).limit(limit).all()
    ]


@router.get("/locations", response_model=list[ProductionLookupOption])
async def lookup_locations(db: Session = Depends(get_db)):
    rows = db.query(StoreLocation).filter(StoreLocation.is_active == True).order_by(StoreLocation.code).all()  # noqa: E712
    return [ProductionLookupOption(id=loc.id, code=loc.code, label=f"{loc.code} — {loc.name}", extra=loc.warehouse_type) for loc in rows]


@router.get("/projects", response_model=list[ProductionLookupOption])
async def lookup_projects(search: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter((Project.serial_number.ilike(like)) | (Project.model_name.ilike(like)) | (Project.client_company.ilike(like)))
    return [
        ProductionLookupOption(id=p.id, code=p.serial_number, label=project_label(p) or p.serial_number, extra=p.status)
        for p in query.order_by(Project.created_at.desc()).limit(200).all()
    ]


@router.get("/branches", response_model=list[ProductionLookupOption])
async def lookup_branches(db: Session = Depends(get_db)):
    return [ProductionLookupOption(id=b.id, code=b.code, label=b.name) for b in db.query(Branch).order_by(Branch.name).all()]


@router.get("/departments", response_model=list[ProductionLookupOption])
async def lookup_departments(db: Session = Depends(get_db)):
    return [ProductionLookupOption(id=d.id, code=d.code, label=d.name) for d in db.query(Department).order_by(Department.name).all()]


@router.get("/users", response_model=list[ProductionLookupOption])
async def lookup_users(db: Session = Depends(get_db)):
    rows = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [ProductionLookupOption(id=u.id, label=u.name or u.email, extra=u.email) for u in rows]


@router.get("/workstations", response_model=list[ProductionLookupOption])
async def lookup_workstations(db: Session = Depends(get_db)):
    rows = db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False).order_by(ProductionWorkstation.code).all()  # noqa: E712
    return [ProductionLookupOption(id=w.id, code=w.code, label=f"{w.code} — {w.name}", extra=w.status) for w in rows]


@router.get("/active-boms", response_model=list[ProductionLookupOption])
async def lookup_active_boms(db: Session = Depends(get_db)):
    boms = db.query(ProductionBom).filter(ProductionBom.is_deleted == False, ProductionBom.status == "active").all()  # noqa: E712
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({b.product_item_id for b in boms})).all()} if boms else {}
    return sorted((
        ProductionLookupOption(
            id=b.id, code=b.bom_number,
            label=f"{items[b.product_item_id].item_code} — {items[b.product_item_id].item_name} (v{b.version})" if b.product_item_id in items else b.bom_number,
            extra=items[b.product_item_id].uom if b.product_item_id in items else None,
        )
        for b in boms
    ), key=lambda o: o.label)
