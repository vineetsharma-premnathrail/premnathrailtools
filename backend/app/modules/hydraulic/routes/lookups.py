"""Picker options for Hydraulic & Pneumatic forms. Users here pick Store
items and locations, ERP projects, plants and people but usually don't
hold those apps themselves — so these read-only lists are served under the
hydraulic permission instead of those modules' own routes (same approach
as production/routes/lookups.py)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.component import HydComponent
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.schemas.insights import HydLookupOption
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production.service import project_label
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation

router = APIRouter(
    prefix="/hydraulic/lookups", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)


@router.get("/systems", response_model=list[HydLookupOption])
async def lookup_systems(system_type: str | None = None, db: Session = Depends(get_db)):
    query = db.query(HydSystem).filter(HydSystem.is_deleted == False)  # noqa: E712
    if system_type:
        query = query.filter(HydSystem.system_type == system_type)
    return [
        HydLookupOption(id=s.id, code=s.system_number, label=f"{s.system_number} — {s.name}", extra=s.system_type)
        for s in query.order_by(HydSystem.system_number).all()
    ]


@router.get("/components", response_model=list[HydLookupOption])
async def lookup_components(system_type: str | None = None, include_obsolete: bool = False, db: Session = Depends(get_db)):
    query = db.query(HydComponent).filter(HydComponent.is_deleted == False)  # noqa: E712
    if not include_obsolete:
        query = query.filter(HydComponent.status == "active")
    if system_type:
        query = query.filter(HydComponent.system_type.in_((system_type, "both")))
    return [
        HydLookupOption(
            id=c.id, code=c.code, extra=c.category,
            label=f"{c.code} — {c.name}" + (f" · {' '.join(filter(None, [c.manufacturer, c.model_number]))}" if c.manufacturer or c.model_number else ""),
        )
        for c in query.order_by(HydComponent.code).all()
    ]


@router.get("/spare-parts", response_model=list[HydLookupOption])
async def lookup_spares(db: Session = Depends(get_db)):
    rows = db.query(HydSparePart).filter(HydSparePart.is_deleted == False, HydSparePart.status == "active").order_by(HydSparePart.part_code).all()  # noqa: E712
    return [HydLookupOption(id=s.id, code=s.part_code, label=f"{s.part_code} — {s.name}", extra=s.uom) for s in rows]


@router.get("/circuits", response_model=list[HydLookupOption])
async def lookup_circuits(system_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(HydCircuit).filter(HydCircuit.is_deleted == False, HydCircuit.status != "superseded")  # noqa: E712
    if system_id:
        query = query.filter(HydCircuit.system_id == system_id)
    return [
        HydLookupOption(id=c.id, code=c.circuit_number, label=f"{c.circuit_number} Rev {c.revision} — {c.title}", extra=c.status)
        for c in query.order_by(HydCircuit.circuit_number, HydCircuit.id).all()
    ]


@router.get("/maintenance-plans", response_model=list[HydLookupOption])
async def lookup_plans(system_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.is_deleted == False, HydMaintenancePlan.is_active == True)  # noqa: E712
    if system_id:
        query = query.filter(HydMaintenancePlan.system_id == system_id)
    return [HydLookupOption(id=p.id, code=p.plan_number, label=f"{p.plan_number} — {p.title}", extra=p.maintenance_type) for p in query.order_by(HydMaintenancePlan.plan_number).all()]


@router.get("/store-items", response_model=list[HydLookupOption])
async def lookup_store_items(search: str | None = None, limit: int = Query(5000, ge=1, le=5000), db: Session = Depends(get_db)):
    query = db.query(StoreItem).filter(StoreItem.status == "active")
    if search:
        like = f"%{search}%"
        query = query.filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like) | StoreItem.part_number.ilike(like))
    return [HydLookupOption(id=i.id, code=i.item_code, label=f"{i.item_code} — {i.item_name}", extra=i.uom) for i in query.order_by(StoreItem.item_code).limit(limit).all()]


@router.get("/store-locations", response_model=list[HydLookupOption])
async def lookup_store_locations(db: Session = Depends(get_db)):
    rows = db.query(StoreLocation).filter(StoreLocation.is_active == True).order_by(StoreLocation.code).all()  # noqa: E712
    return [HydLookupOption(id=loc.id, code=loc.code, label=f"{loc.code} — {loc.name}") for loc in rows]


@router.get("/projects", response_model=list[HydLookupOption])
async def lookup_projects(db: Session = Depends(get_db)):
    rows = db.query(Project).filter(Project.is_deleted == False).order_by(Project.created_at.desc()).limit(500).all()  # noqa: E712
    return [HydLookupOption(id=p.id, code=p.serial_number, label=project_label(p) or p.serial_number, extra=p.status) for p in rows]


@router.get("/branches", response_model=list[HydLookupOption])
async def lookup_branches(db: Session = Depends(get_db)):
    return [HydLookupOption(id=b.id, code=b.code, label=b.name) for b in db.query(Branch).order_by(Branch.name).all()]


@router.get("/users", response_model=list[HydLookupOption])
async def lookup_users(db: Session = Depends(get_db)):
    rows = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [HydLookupOption(id=u.id, label=u.name or u.email, extra=u.email) for u in rows]
