"""Picker options for Design forms. Design engineers link documents to
projects, machines and Store items but usually don't hold those modules'
apps, so these read-only lists are served under the design permission
(same approach as production/routes/lookups.py)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.design.access import is_team
from app.modules.design.bom_service import released_bom_revision
from app.modules.design.models.bom import DesignBom
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.library import DesignStandard
from app.modules.design.service import released_revision
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.ncr import QualityNcr
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


@router.get("/customers", response_model=list[DesignLookupOption])
async def lookup_customers(search: str | None = None, db: Session = Depends(get_db)):
    """CRM organizations — the customers drawings and submissions are for."""
    query = db.query(Organization).filter(Organization.is_deleted == False)  # noqa: E712
    if search:
        query = query.filter(Organization.name.ilike(f"%{search}%") | Organization.org_code.ilike(f"%{search}%"))
    return [DesignLookupOption(id=o.id, code=o.org_code, label=o.name, extra=o.railway_zone) for o in query.order_by(Organization.name).limit(500).all()]


@router.get("/crm-records", response_model=list[DesignLookupOption])
async def lookup_crm_records(source: str = "inquiry", search: str | None = None, db: Session = Depends(get_db)):
    """BD inquiries/tenders a design request can reference."""
    if source == "tender":
        query = db.query(Tender).filter(Tender.is_deleted == False)  # noqa: E712
        if search:
            like = f"%{search}%"
            query = query.filter(Tender.tender_number.ilike(like) | Tender.tender_name.ilike(like) | Tender.universal_id.ilike(like))
        return [
            DesignLookupOption(id=t.id, code=t.tender_number or t.universal_id, label=f"{t.tender_number or t.universal_id}" + (f" — {t.tender_name}" if t.tender_name else ""), extra=str(t.org_id))
            for t in query.order_by(Tender.id.desc()).limit(300).all()
        ]
    query = db.query(Inquiry).filter(Inquiry.is_deleted == False)  # noqa: E712
    if search:
        query = query.filter(Inquiry.universal_id.ilike(f"%{search}%"))
    return [DesignLookupOption(id=i.id, code=i.universal_id, label=f"Inquiry {i.universal_id}", extra=str(i.org_id)) for i in query.order_by(Inquiry.id.desc()).limit(300).all()]


@router.get("/standards", response_model=list[DesignLookupOption])
async def lookup_standards(db: Session = Depends(get_db)):
    rows = db.query(DesignStandard).filter(DesignStandard.is_deleted == False).order_by(DesignStandard.is_current.desc(), DesignStandard.code).all()  # noqa: E712
    return [
        DesignLookupOption(id=s.id, code=s.code, label=f"{s.code}" + (f" ({s.version})" if s.version else "") + f" — {s.title}", extra=None if s.is_current else "not current")
        for s in rows
    ]


@router.get("/quality-records", response_model=list[DesignLookupOption])
async def lookup_quality_records(kind: str = "ncr", search: str | None = None, db: Session = Depends(get_db)):
    """NCRs / CAPAs an ECR can come from."""
    model, number = (QualityCapa, QualityCapa.capa_number) if kind == "capa" else (QualityNcr, QualityNcr.ncr_number)
    query = db.query(model).filter(model.is_deleted == False)  # noqa: E712
    if search:
        query = query.filter(number.ilike(f"%{search}%"))
    out = []
    for r in query.order_by(model.id.desc()).limit(300).all():
        code = getattr(r, "capa_number", None) or getattr(r, "ncr_number", None)
        title = getattr(r, "title", None) or getattr(r, "description", None) or ""
        out.append(DesignLookupOption(id=r.id, code=code, label=f"{code} — {str(title)[:80]}" if title else code, extra=getattr(r, "status", None)))
    return out


@router.get("/boms", response_model=list[DesignLookupOption])
async def lookup_boms(search: str | None = None, released_only: bool = False, db: Session = Depends(get_db)):
    query = db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(DesignBom.is_deleted == False, DesignBom.status == "active")  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(DesignBom.bom_number.ilike(like) | DesignBom.title.ilike(like))
    out = []
    for b in query.order_by(DesignBom.bom_number).limit(500).all():
        rel = released_bom_revision(b)
        if released_only and not rel:
            continue
        out.append(DesignLookupOption(id=b.id, code=b.bom_number, label=f"{b.bom_number} — {b.title}", extra=rel.revision_label if rel else "not released"))
    return out


@router.get("/released-documents", response_model=list[DesignLookupOption])
async def lookup_released_documents(search: str | None = None, db: Session = Depends(get_db)):
    """Drawings with a released revision — what an ECR can be raised against."""
    query = db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.is_deleted == False, DesignDocument.status == "active")  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(DesignDocument.doc_number.ilike(like) | DesignDocument.title.ilike(like))
    out = []
    for d in query.order_by(DesignDocument.doc_number).limit(1000).all():
        rel = released_revision(d)
        if rel:
            out.append(DesignLookupOption(id=d.id, code=d.doc_number, label=f"{d.doc_number} {rel.revision_label} — {d.title}", extra=rel.revision_label))
    return out


@router.get("/awaiting-customer", response_model=list[DesignLookupOption])
async def lookup_awaiting_customer(
    customer_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_access(DESIGN_APP)),
):
    """Revisions approved internally and waiting for the customer — the
    candidates for a customer submission. `id` is the revision id, `extra`
    the document id. Design team only (viewers see released revisions only)."""
    if not is_team(db, user):
        return []
    query = db.query(DesignDocumentRevision, DesignDocument).join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id).filter(
        DesignDocumentRevision.status == "approved", DesignDocumentRevision.is_deleted == False, DesignDocument.is_deleted == False,  # noqa: E712
    )
    if customer_id:
        query = query.filter(DesignDocument.customer_id == customer_id)
    return [
        DesignLookupOption(id=r.id, code=f"{d.doc_number} {r.revision_label}", label=f"{d.doc_number} {r.revision_label} — {d.title}", extra=str(d.id))
        for r, d in query.order_by(DesignDocument.doc_number).all()
    ]


@router.get("/milestones", response_model=list[DesignLookupOption])
async def lookup_milestones(pm_project_id: int, db: Session = Depends(get_db)):
    rows = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == pm_project_id).order_by(PmProjectMilestone.target_date).all()
    return [DesignLookupOption(id=m.id, label=m.title, code=m.target_date.isoformat() if m.target_date else None, extra=m.status) for m in rows]
