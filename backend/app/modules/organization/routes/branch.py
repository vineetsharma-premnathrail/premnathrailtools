from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import func, or_, inspect as sa_inspect
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.modules.main.models.user import User
from app.core.permissions import ensure_can_delete, require_feature_action, require_tab_action
from app.core.permission_registry import can_feature, can_view_tab
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_address import BranchAddress
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.organization.models.branch_document import BranchDocument
from app.modules.organization.models.department import Department
from app.modules.organization.models.company import Company
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.schemas.branch import (
    BranchCreate, BranchUpdate, BranchResponse, PLANT_STATUSES,
    BranchAddressCreate, BranchAddressUpdate, BranchAddressResponse,
    BranchUserAssignmentCreate, BranchUserAssignmentUpdate, BranchUserAssignmentResponse,
    BranchDocumentResponse,
)
from app.utils.sharepoint import (
    upload_file_to_sharepoint, sanitize_folder_name, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/organization/branches", tags=["Organization"])


def _validate_status(status: str | None) -> None:
    if status is not None and status not in PLANT_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {', '.join(PLANT_STATUSES)}")


def _to_response(branch: Branch, db: Session) -> BranchResponse:
    company = db.query(Company).filter(Company.id == branch.company_id).first() if branch.company_id else None
    head = db.query(User).filter(User.id == branch.head_user_id).first() if branch.head_user_id else None
    manager = db.query(User).filter(User.id == branch.manager_user_id).first() if branch.manager_user_id else None
    warehouse_name = None
    if branch.default_warehouse_id:
        from app.modules.store.models.location import StoreLocation  # local import avoids a cross-module cycle at startup
        wh = db.query(StoreLocation).filter(StoreLocation.id == branch.default_warehouse_id).first()
        warehouse_name = wh.name if wh else None
    cost_center_name = None
    if branch.default_cost_center_id:
        cc = db.query(CostCenter).filter(CostCenter.id == branch.default_cost_center_id).first()
        cost_center_name = cc.name if cc else None
    return BranchResponse.model_validate(branch).model_copy(
        update={
            "company_name": company.name if company else None,
            "head_user_name": head.name if head else None,
            "manager_user_name": manager.name if manager else None,
            "default_warehouse_name": warehouse_name,
            "default_cost_center_name": cost_center_name,
        }
    )


def _get_branch_or_404(branch_id: int, db: Session) -> Branch:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Plant not found")
    return branch


def _branch_reader(user: User = Depends(get_current_user)) -> User:
    """Reading the branch list: anyone with Organization › Branches 'View'
    (admins included), plus Store users — a warehouse is created under a
    branch, so the Warehouses form needs the list as a picker."""
    # Users viewers need it too: a user's plant assignments pick a plant.
    if (can_view_tab(user, "organization", "branches") or can_view_tab(user, "organization", "users")
            or "store" in user.get_apps()):
        return user
    raise HTTPException(
        status_code=403,
        detail="You don't have 'View' permission on Organization › Branches (and no Store access, which also "
               "shows the plant list). Ask an admin to add it to one of your roles in Organization › Role & Permissions.",
    )


def _assignment_access(action: str):
    """Plant user assignments are maintained from two screens — the Plant
    pages (Branches › Plant › Users) and a user's Assignments tab (Users ›
    User › Assignments) — so either feature opens them (admins always;
    roles not customised for the tab follow its view / edit)."""

    def _dependency(user: User = Depends(get_current_user)) -> User:
        if (can_feature(user, "organization", "branches", "user_assignments", action)
                or can_feature(user, "organization", "users", "assignments", action)):
            return user
        raise HTTPException(
            status_code=403,
            detail=f"You need '{action.capitalize()}' on Organization › Branches › Plant › Users "
                   f"(organization:branches.user_assignments:{action}) or on Organization › Users › User › Assignments "
                   f"(organization:users.assignments:{action}) to {'see' if action == 'view' else 'change'} plant user assignments. "
                   "Ask an admin to add it to one of your roles in Organization › Role & Permissions.",
        )

    return _dependency


@router.get("", response_model=list[BranchResponse])
async def list_branches(
    db: Session = Depends(get_db),
    _user: User = Depends(_branch_reader),
):
    branches = db.query(Branch).order_by(Branch.name.asc()).all()
    return [_to_response(b, db) for b in branches]


@router.post("", response_model=BranchResponse, status_code=201)
async def create_branch(
    payload: BranchCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "branches", "create")),
):
    _validate_status(payload.status)
    if db.query(Branch).filter(Branch.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Plant code '{payload.code}' already exists")
    branch = Branch(**payload.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.get("/{branch_id}", response_model=BranchResponse)
async def get_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "branches", "view")),
):
    branch = _get_branch_or_404(branch_id, db)
    return _to_response(branch, db)


@router.patch("/{branch_id}", response_model=BranchResponse)
async def update_branch(
    branch_id: int,
    payload: BranchUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "branches", "edit")),
):
    _validate_status(payload.status)
    branch = _get_branch_or_404(branch_id, db)
    if payload.code and payload.code != branch.code:
        if db.query(Branch).filter(Branch.code == payload.code, Branch.id != branch_id).first():
            raise HTTPException(status_code=409, detail=f"Plant code '{payload.code}' already exists")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(branch, field, val)
    db.commit()
    db.refresh(branch)
    return _to_response(branch, db)


@router.delete("/{branch_id}", status_code=204)
async def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Hard-deletes a plant only while nothing uses it.

    ERP standard: master data that has been used on transactions is never
    hard-deleted — it is deactivated (status Inactive), so posted documents
    keep a valid reference and the audit trail stays intact. The DB-level FK
    error (translated to a 409 by the error handler) can't say WHICH records
    use the plant, and SQLite (tests) doesn't enforce FKs at all, so every
    table referencing branches.id is counted explicitly here (plus a
    metadata walk that catches any FK to branches.id not listed)."""
    # Imported lazily: these modules import organization models themselves.
    from app.modules.electrical.models.job import ElectricalJob
    from app.modules.hr.models.asset import HrAsset
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    from app.modules.hr.models.holiday import HrHoliday
    from app.modules.hr.models.lifecycle import HrLifecycleEvent
    from app.modules.hr.models.masters import HrShift
    from app.modules.hr.models.visitor import HrVisitor
    from app.modules.hydraulic.models.system import HydSystem
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.production.models.workstation import ProductionWorkstation
    from app.modules.store.models.location import StoreLocation

    # Sales orders: guarded, the Sales module may not be present on every build.
    try:
        from app.modules.sales.models.order import SalesOrder
    except ImportError:
        SalesOrder = None

    branch = _get_branch_or_404(branch_id, db)
    ensure_can_delete(_user, branch, "organization", "branches", what="plant")
    # Each use is (label, FK columns pointing at branches.id). Soft-deleted rows
    # are counted too: they still hold the FK to this plant.
    uses: list[tuple[str, list]] = [
        ("user(s)", [User.branch_id]),
        ("department(s)", [Department.branch_id]),
        ("company default-plant setting(s)", [Company.default_plant_id]),
        ("cost center(s)", [CostCenter.branch_id]),
        ("store location(s)", [StoreLocation.branch_id]),
        ("maintenance asset(s)", [MaintenanceAsset.branch_id]),
        ("production workstation(s)", [ProductionWorkstation.branch_id]),
        ("production work order(s)", [ProductionWorkOrder.branch_id]),
        ("RRV build(s)", [ProductionRrvBuild.branch_id]),
        ("employee profile(s)", [HrEmployeeProfile.branch_id]),
        ("holiday(s)", [HrHoliday.branch_id]),
        ("HR shift(s)", [HrShift.branch_id]),
        ("HR asset(s)", [HrAsset.branch_id]),
        ("visitor record(s)", [HrVisitor.branch_id]),
        ("employee transfer/lifecycle event(s)", [HrLifecycleEvent.from_branch_id, HrLifecycleEvent.to_branch_id]),
        ("electrical job(s)", [ElectricalJob.branch_id]),
        ("hydraulic system(s)", [HydSystem.branch_id]),
    ]
    if SalesOrder is not None:
        uses.append(("sales order(s)", [SalesOrder.branch_id]))
    # Normalise ORM attributes to their Column objects.
    uses = [(label, [a.property.columns[0] if hasattr(a, "property") else a for a in cols]) for label, cols in uses]
    covered = {(c.table.name, c.name) for _, cols in uses for c in cols}

    # Safety net: any other table with an FK to branches.id (e.g. a module added
    # later that isn't listed above) still blocks the delete, labelled by table.
    plant_owned_tables = {
        BranchAddress.__tablename__, BranchUserAssignment.__tablename__,
        BranchDocument.__tablename__, "module_settings",
    }
    existing_tables = set(sa_inspect(db.get_bind()).get_table_names())
    for table in Base.metadata.tables.values():
        if table.name in plant_owned_tables or table.name not in existing_tables:
            continue
        for fk in table.foreign_keys:
            if fk.target_fullname == "branches.id" and (table.name, fk.parent.name) not in covered:
                uses.append((f"{table.name.replace('_', ' ')} record(s)", [fk.parent]))
                covered.add((table.name, fk.parent.name))

    usage = []
    for label, cols in uses:
        table = cols[0].table
        if table.name not in existing_tables:
            continue
        n = db.query(func.count()).select_from(table).filter(or_(*[c == branch_id for c in cols])).scalar()
        usage.append((n, label))
    if in_use := [f"{n} {what}" for n, what in usage if n]:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Can't delete plant '{branch.name}' — it is used by {', '.join(in_use)}. "
                "Set the plant to Inactive instead (Organization → Plants → Status)."
            ),
        )
    # Rows that belong to the plant itself (addresses, documents, user
    # assignments) go with it. Document files are removed from SharePoint the
    # same way the single-document delete does.
    for document in db.query(BranchDocument).filter(BranchDocument.branch_id == branch_id).all():
        if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
            try:
                await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
            except HTTPException:
                pass
        db.delete(document)
    plant_owned: list = [BranchAddress, BranchUserAssignment]
    # Per-plant setting overrides (settings framework) belong to the plant too.
    # (Guarded: the model/table may not exist yet on every DB.)
    try:
        from app.modules.main.models.module_setting import ModuleSetting
    except ImportError:
        ModuleSetting = None
    if ModuleSetting is not None and sa_inspect(db.get_bind()).has_table(ModuleSetting.__tablename__):
        plant_owned.append(ModuleSetting)
    for model in plant_owned:
        db.query(model).filter(model.branch_id == branch_id).delete(synchronize_session=False)
    db.delete(branch)
    db.commit()


# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

@router.get("/{branch_id}/addresses", response_model=list[BranchAddressResponse])
async def list_branch_addresses(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "branches", "view"))):
    _get_branch_or_404(branch_id, db)
    return db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id).order_by(BranchAddress.id).all()


@router.post("/{branch_id}/addresses", response_model=BranchAddressResponse)
async def create_branch_address(branch_id: int, payload: BranchAddressCreate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "branches", "edit"))):
    _get_branch_or_404(branch_id, db)
    if payload.is_primary:
        db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id).update({"is_primary": False})
    address = BranchAddress(branch_id=branch_id, **payload.model_dump())
    db.add(address)
    db.commit()
    db.refresh(address)
    return address


@router.patch("/{branch_id}/addresses/{address_id}", response_model=BranchAddressResponse)
async def update_branch_address(branch_id: int, address_id: int, payload: BranchAddressUpdate, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "branches", "edit"))):
    address = db.query(BranchAddress).filter(BranchAddress.id == address_id, BranchAddress.branch_id == branch_id).first()
    if not address:
        raise HTTPException(status_code=404, detail=f"Address #{address_id} does not belong to plant #{branch_id} (or was deleted). Refresh the plant's Addresses tab.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(BranchAddress).filter(BranchAddress.branch_id == branch_id, BranchAddress.id != address_id).update({"is_primary": False})
    for field, value in data.items():
        setattr(address, field, value)
    db.commit()
    db.refresh(address)
    return address


@router.delete("/{branch_id}/addresses/{address_id}")
async def delete_branch_address(branch_id: int, address_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_action("organization", "branches", "edit"))):
    address = db.query(BranchAddress).filter(BranchAddress.id == address_id, BranchAddress.branch_id == branch_id).first()
    if not address:
        raise HTTPException(status_code=404, detail=f"Address #{address_id} does not belong to plant #{branch_id} (or was deleted). Refresh the plant's Addresses tab.")
    db.delete(address)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# User Assignments
# ---------------------------------------------------------------------------

def _assignment_to_response(a: BranchUserAssignment, db: Session) -> BranchUserAssignmentResponse:
    user = db.query(User).filter(User.id == a.user_id).first()
    dept = db.query(Department).filter(Department.id == a.department_id).first() if a.department_id else None
    return BranchUserAssignmentResponse.model_validate(a).model_copy(
        update={"user_name": user.name if user else None, "department_name": dept.name if dept else None}
    )


@router.get("/{branch_id}/user-assignments", response_model=list[BranchUserAssignmentResponse])
async def list_branch_user_assignments(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(_assignment_access("view"))):
    _get_branch_or_404(branch_id, db)
    assignments = db.query(BranchUserAssignment).filter(BranchUserAssignment.branch_id == branch_id).order_by(BranchUserAssignment.id).all()
    return [_assignment_to_response(a, db) for a in assignments]


@router.post("/{branch_id}/user-assignments", response_model=BranchUserAssignmentResponse)
async def create_branch_user_assignment(branch_id: int, payload: BranchUserAssignmentCreate, db: Session = Depends(get_db), _user: User = Depends(_assignment_access("edit"))):
    _get_branch_or_404(branch_id, db)
    if payload.is_primary_branch:
        db.query(BranchUserAssignment).filter(
            BranchUserAssignment.user_id == payload.user_id, BranchUserAssignment.is_primary_branch == True  # noqa: E712
        ).update({"is_primary_branch": False})
    assignment = BranchUserAssignment(branch_id=branch_id, **payload.model_dump())
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _assignment_to_response(assignment, db)


@router.patch("/{branch_id}/user-assignments/{assignment_id}", response_model=BranchUserAssignmentResponse)
async def update_branch_user_assignment(branch_id: int, assignment_id: int, payload: BranchUserAssignmentUpdate, db: Session = Depends(get_db), _user: User = Depends(_assignment_access("edit"))):
    assignment = db.query(BranchUserAssignment).filter(BranchUserAssignment.id == assignment_id, BranchUserAssignment.branch_id == branch_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail=f"User assignment #{assignment_id} does not belong to plant #{branch_id} (or was removed). Refresh the plant's User Assignments tab.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary_branch"):
        db.query(BranchUserAssignment).filter(
            BranchUserAssignment.user_id == (data.get("user_id") or assignment.user_id),
            BranchUserAssignment.id != assignment_id,
            BranchUserAssignment.is_primary_branch == True,  # noqa: E712
        ).update({"is_primary_branch": False})
    for field, value in data.items():
        setattr(assignment, field, value)
    db.commit()
    db.refresh(assignment)
    return _assignment_to_response(assignment, db)


@router.delete("/{branch_id}/user-assignments/{assignment_id}")
async def delete_branch_user_assignment(branch_id: int, assignment_id: int, db: Session = Depends(get_db), _user: User = Depends(_assignment_access("edit"))):
    assignment = db.query(BranchUserAssignment).filter(BranchUserAssignment.id == assignment_id, BranchUserAssignment.branch_id == branch_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail=f"User assignment #{assignment_id} does not belong to plant #{branch_id} (or was removed). Refresh the plant's User Assignments tab.")
    db.delete(assignment)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get("/{branch_id}/documents", response_model=list[BranchDocumentResponse])
async def list_branch_documents(branch_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "branches", "documents", "view"))):
    _get_branch_or_404(branch_id, db)
    return db.query(BranchDocument).filter(BranchDocument.branch_id == branch_id).order_by(BranchDocument.id.desc()).all()


@router.post("/{branch_id}/documents", response_model=BranchDocumentResponse)
async def upload_branch_document(
    branch_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    version: str | None = Form(None),
    status: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("organization", "branches", "documents", "create")),
):
    branch = _get_branch_or_404(branch_id, db)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/branch-documents/{sanitize_folder_name(branch.name)}"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = BranchDocument(
        branch_id=branch_id,
        document_type=document_type,
        document_name=document_name,
        document_number=document_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=issuing_authority,
        version=version,
        status=status,
        filename=result["name"],
        content_type=file.content_type,
        size=result["size"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        confidentiality=confidentiality,
        tags=tag_list,
        remarks=remarks,
        created_by_id=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/{branch_id}/documents/{document_id}/content")
async def get_branch_document_content(branch_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "branches", "documents", "export"))):
    document = db.query(BranchDocument).filter(BranchDocument.id == document_id, BranchDocument.branch_id == branch_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} does not belong to plant #{branch_id} (or was deleted). Refresh the plant's Documents tab.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path or "")
    return Response(
        content=content,
        media_type=document.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{document.filename}"'},
    )


@router.delete("/{branch_id}/documents/{document_id}")
async def delete_branch_document(branch_id: int, document_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("organization", "branches", "documents", "delete"))):
    document = db.query(BranchDocument).filter(BranchDocument.id == document_id, BranchDocument.branch_id == branch_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} does not belong to plant #{branch_id} (or was deleted). Refresh the plant's Documents tab.")
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass
    db.delete(document)
    db.commit()
    return {"ok": True}
