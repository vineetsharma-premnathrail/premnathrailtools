"""Picker options and coded lists for Electrical forms. Electrical users
pick ERP machines, plants, people and Store items, but usually don't hold
the ERP / Organization / Store app themselves — so these read-only lists are
served under the electrical permission instead of those modules' own
routes (same approach as production/routes/lookups.py)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.electrical.models.bom import ELECTRICAL_COMPONENT_CATEGORIES
from app.modules.electrical.models.document import ELECTRICAL_DOCUMENT_CATEGORIES
from app.modules.electrical.models.drawing import ELECTRICAL_DRAWING_TYPES
from app.modules.electrical.models.job import ELECTRICAL_STAGES, ELECTRICAL_PHASES
from app.modules.electrical.models.panel import ELECTRICAL_PANEL_TYPES
from app.modules.electrical.models.test_record import ELECTRICAL_TEST_TYPES
from app.modules.electrical.schemas.insights import ElectricalLookupOption, ElectricalMetaResponse, ElectricalStageMeta
from app.modules.electrical.service import ELECTRICAL_APP, MANDATORY_STAGES, project_label
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.store.models.item import StoreItem

router = APIRouter(
    prefix="/electrical/lookups", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)


@router.get("/meta", response_model=ElectricalMetaResponse)
async def get_meta():
    return ElectricalMetaResponse(
        stages=[
            ElectricalStageMeta(key=k, label=label, phase=phase, sequence=i, is_mandatory=k in MANDATORY_STAGES)
            for i, (k, label, phase) in enumerate(ELECTRICAL_STAGES, start=1)
        ],
        phases=ELECTRICAL_PHASES,
        component_categories=ELECTRICAL_COMPONENT_CATEGORIES,
        panel_types=ELECTRICAL_PANEL_TYPES,
        drawing_types=ELECTRICAL_DRAWING_TYPES,
        test_types=ELECTRICAL_TEST_TYPES,
        document_categories=ELECTRICAL_DOCUMENT_CATEGORIES,
    )


@router.get("/projects", response_model=list[ElectricalLookupOption])
async def lookup_projects(search: str | None = None, db: Session = Depends(get_db)):
    query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter((Project.serial_number.ilike(like)) | (Project.model_name.ilike(like)) | (Project.client_company.ilike(like)))
    return [
        ElectricalLookupOption(id=p.id, code=p.serial_number, label=project_label(p) or p.serial_number, extra=p.client_company)
        for p in query.order_by(Project.created_at.desc()).limit(200).all()
    ]


@router.get("/branches", response_model=list[ElectricalLookupOption])
async def lookup_branches(db: Session = Depends(get_db)):
    return [ElectricalLookupOption(id=b.id, code=b.code, label=b.name) for b in db.query(Branch).order_by(Branch.name).all()]


@router.get("/users", response_model=list[ElectricalLookupOption])
async def lookup_users(db: Session = Depends(get_db)):
    rows = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [ElectricalLookupOption(id=u.id, label=u.name or u.email, extra=u.email) for u in rows]


@router.get("/items", response_model=list[ElectricalLookupOption])
async def lookup_items(
    search: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(StoreItem).filter(StoreItem.status == "active")
    if search:
        like = f"%{search}%"
        query = query.filter((StoreItem.item_code.ilike(like)) | (StoreItem.item_name.ilike(like)) | (StoreItem.part_number.ilike(like)))
    return [
        ElectricalLookupOption(id=i.id, code=i.item_code, label=f"{i.item_code} — {i.item_name}", extra=i.uom)
        for i in query.order_by(StoreItem.item_code).limit(limit).all()
    ]


@router.get("/purchase-requisitions", response_model=list[ElectricalLookupOption])
async def lookup_purchase_requisitions(search: str | None = None, db: Session = Depends(get_db)):
    """Live PRs to link BOM lines to, newest first — Electrical category first."""
    query = db.query(P2PRequest).filter(P2PRequest.status.notin_(("rejected", "cancelled")))
    if search:
        query = query.filter(P2PRequest.p2p_number.ilike(f"%{search}%") | P2PRequest.project_label.ilike(f"%{search}%"))
    rows = query.order_by(P2PRequest.id.desc()).limit(100).all()
    rows.sort(key=lambda p: p.category_code != "ELE")
    return [
        ElectricalLookupOption(id=p.id, code=p.p2p_number, label=f"{p.p2p_number}" + (f" — {p.project_label}" if p.project_label else ""), extra=p.status)
        for p in rows
    ]
