"""Picker options for Design forms. Design engineers link documents to
projects, machines and Store items but usually don't hold those modules'
apps, so these read-only lists are served under the design permission
(same approach as production/routes/lookups.py)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.design.models.document import DesignDocument
from app.modules.design.routes.documents import machine_label
from app.modules.design.schemas.dashboard import DesignLookupOption
from app.modules.design.service import DESIGN_APP
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/design/lookups", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)


@router.get("/users", response_model=list[DesignLookupOption])
async def lookup_users(db: Session = Depends(get_db)):
    """Only people who can actually open a revision — checker/approver
    pickers must not offer someone who'd hit a 403."""
    rows = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [
        DesignLookupOption(id=u.id, label=u.name or u.email, extra=u.email, code=u.designation)
        for u in rows if DESIGN_APP in u.get_apps()
    ]


@router.get("/projects", response_model=list[DesignLookupOption])
async def lookup_projects(search: str | None = None, db: Session = Depends(get_db)):
    query = db.query(PmProject)
    if search:
        like = f"%{search}%"
        query = query.filter(PmProject.project_code.ilike(like) | PmProject.name.ilike(like))
    return [
        DesignLookupOption(id=p.id, code=p.project_code, label=f"{p.project_code} — {p.name}", extra=p.status)
        for p in query.order_by(PmProject.created_at.desc()).limit(300).all()
    ]


@router.get("/machines", response_model=list[DesignLookupOption])
async def lookup_machines(search: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(Project.serial_number.ilike(like) | Project.model_name.ilike(like) | Project.client_company.ilike(like))
    return [
        DesignLookupOption(id=p.id, code=p.serial_number, label=machine_label(p) or p.serial_number, extra=p.status)
        for p in query.order_by(Project.created_at.desc()).limit(300).all()
    ]


@router.get("/items", response_model=list[DesignLookupOption])
async def lookup_items(
    search: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(StoreItem).filter(StoreItem.status == "active")
    if search:
        like = f"%{search}%"
        query = query.filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like) | StoreItem.part_number.ilike(like))
    return [
        DesignLookupOption(id=i.id, code=i.item_code, label=f"{i.item_code} — {i.item_name}", extra=i.part_number)
        for i in query.order_by(StoreItem.item_code).limit(limit).all()
    ]


@router.get("/departments", response_model=list[DesignLookupOption])
async def lookup_departments(db: Session = Depends(get_db)):
    return [DesignLookupOption(id=d.id, code=d.code, label=d.name) for d in db.query(Department).order_by(Department.name).all()]


@router.get("/documents", response_model=list[DesignLookupOption])
async def lookup_documents(
    search: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Active documents for the ECN "affected documents" picker."""
    query = db.query(DesignDocument).filter(DesignDocument.is_deleted == False, DesignDocument.status == "active")  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(DesignDocument.doc_number.ilike(like) | DesignDocument.title.ilike(like))
    return [
        DesignLookupOption(id=d.id, code=d.doc_number, label=f"{d.doc_number} — {d.title}", extra=d.document_type)
        for d in query.order_by(DesignDocument.doc_number).limit(limit).all()
    ]
