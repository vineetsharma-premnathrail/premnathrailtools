import re
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.db.session import get_db
from app.core.permissions import (
    ensure_can_delete, ensure_feature_action, ensure_tab_action, has_erp_permission, require_app_access,
    require_feature_action, require_tab_access, require_tab_action,
)
from app.core.permission_registry import can_view_tab
from app.modules.main.routes.auth import get_current_user
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.project_attachment import ProjectAttachment, ProjectAttachmentShare
from app.modules.erp.models.project_letter import ProjectLetter
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.schemas.project import (
    PROJECT_STATUSES, ProjectCreate, ProjectUpdate, ProjectResponse, ProjectAttachmentResponse, ProjectAttachmentPermissionUpdate,
    ProjectLetterCreate, ProjectLetterUpdate, ProjectLetterResponse, ProjectApprovalPayload,
)
from app.modules.erp.settings import get_setting as get_erp_setting
from app.modules.erp.notify import broadcast_except, fire_event, role_event
from app.modules.erp import access as erp_access
from app.core.data_scope import apply_scope, ensure_in_scope
from app.modules.organization.services import approval_engine as engine
from app.modules.erp.reports.letter import build_letter_pdf, build_letter_docx
from app.modules.organization.models.company import Company
from app.modules.main.services import managed_documents
from fastapi.responses import Response
from app.utils.sharepoint import (
    upload_file_to_sharepoint, build_sharepoint_folder_path, delete_file_from_sharepoint,
    get_preview_url, download_file_content,
)
from app.utils.notifications import broadcast_notification, notify_user

router = APIRouter(prefix="/erp/projects", tags=["ERP - Projects"])

LETTER_ENTITY = "erp_project_letter"

_NATURAL_SORT_SPLIT = re.compile(r"(\d+)")


def _natural_sort_key(value: str | None) -> list:
    """Split a serial number like 'PEW-53-A-9' into ['pew-', 9, '-a-', ''] so that
    digit groups sort numerically (9 before 10) instead of lexicographically."""
    parts = _NATURAL_SORT_SPLIT.split(value or "")
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="project", entity_id=project_id, action=action, performed_by_id=user.id, summary=summary))


_SHAREPOINT_MISSING = (
    "File storage (SharePoint) is not configured on the server — ask an admin to set "
    "SHAREPOINT_SITE_ID in the backend .env."
)
_MACHINE_NOT_FOUND = "Machine not found — it may have been deleted or moved to the Recycle Bin. Refresh the Machines list."


def _require_machine_or_sr_tab(user: User = Depends(get_current_user)) -> User:
    """Machine detail is read by the Machines pages AND the Service Request
    detail page (to show the SR's machine), so either Permission Matrix view
    is enough here."""
    if not (can_view_tab(user, "erp", "projects") or can_view_tab(user, "erp", "service_requests")):
        raise HTTPException(
            status_code=403,
            detail="You don't have view access to Machines or Service Requests in the Permission Matrix — "
                   "ask an admin to grant 'ERP → Machines' view.",
        )
    return user


def _machine_details(project: Project, user: User) -> list[tuple[str, str]]:
    """Rows for the notification email."""
    return [
        ("Serial number", project.serial_number),
        ("Model", project.model_name or ""),
        ("Client", project.client_company or ""),
        ("Site", ", ".join(x for x in (project.site_name, project.site_location) if x)),
        ("Dispatch date", project.delivery_date.strftime("%d-%m-%Y") if project.delivery_date else ""),
        ("Status", (project.status or "").replace("_", " ").title()),
        ("Done by", user.name or user.email),
    ]


def _ask_machine_approval(db: Session, project: Project, user: User) -> None:
    """Send the machine to the central approval engine (Organization ›
    Approval Workflows › New machine). The engine notifies the approvers; if
    no stage applies the machine is approved at once."""
    erp_access.submit_machine(db, project, user)


def _serial_clash_detail(clash: Project) -> str:
    where = " (it is in the Recycle Bin — restore it or use a different serial)" if clash.is_deleted else ""
    what = f" {clash.model_name}" if clash.model_name else ""
    who = f" for {clash.client_company}" if clash.client_company else ""
    return (
        f"Serial number {clash.serial_number} is already used by machine #{clash.id}{what}{who}{where}. "
        "Serial numbers must be unique — check the serial or open that machine instead."
    )


def _find_serial_clash(db: Session, serial: str, exclude_id: int | None = None) -> Project | None:
    """Serial is the installed-base key (one physical machine = one record), so
    'PRT-001' and 'prt-001 ' are the same machine — same rule as the Excel
    import's norm_key. Recycle-bin rows count too (the DB column is unique)."""
    q = db.query(Project).filter(func.lower(func.trim(Project.serial_number)) == (serial or "").strip().lower())
    if exclude_id is not None:
        q = q.filter(Project.id != exclude_id)
    return q.first()


def _check_warranty_dates(values: dict) -> None:
    """Warranty dates must run forward: start ≤ end ≤ extended end."""
    start, end, ext = values.get("warranty_start_date"), values.get("warranty_end_date"), values.get("extended_warranty_end")
    if start and end and end < start:
        raise HTTPException(status_code=422, detail=f"Warranty end date {end:%d-%m-%Y} is before the warranty start date {start:%d-%m-%Y} — "
                                                    "correct one of the two dates.")
    if values.get("extended_warranty") and ext and end and ext < end:
        raise HTTPException(status_code=422, detail=f"Extended warranty end {ext:%d-%m-%Y} is before the standard warranty end {end:%d-%m-%Y} — "
                                                    "an extension must end after the standard warranty.")


def _apply_installed_base_links(db: Session, values: dict, project: Project | None = None) -> None:
    """Checks the customer / product picked for a machine and, for a newly
    linked customer, fills the blank client_* display fields from the CRM
    organization (the text already on the machine is never overwritten)."""
    from app.modules.crm.models.organization import Organization
    from app.modules.products.models.product import FinishedProduct
    if values.get("customer_id") is not None:
        org = db.query(Organization).filter(Organization.id == values["customer_id"], Organization.is_deleted == False).first()  # noqa: E712
        if org is None:
            raise HTTPException(status_code=422, detail=f"Customer #{values['customer_id']} wasn't found in CRM › Organizations "
                                                        "(it may have been deleted) — pick the customer again.")
        for field, src in (("client_company", org.name), ("client_gst", org.gst_number), ("client_address", org.address)):
            current = values.get(field) if field in values else (getattr(project, field, None) if project else None)
            if not (current or "").strip() and src:
                values[field] = src
    if values.get("product_id") is not None and db.get(FinishedProduct, values["product_id"]) is None:
        raise HTTPException(status_code=422, detail=f"Product #{values['product_id']} wasn't found in Sales › Products — pick the product again.")


def _live_rrv_builds(db: Session, project_id: int) -> list:
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    return db.query(ProductionRrvBuild).filter(
        ProductionRrvBuild.erp_project_id == project_id,
        ProductionRrvBuild.is_deleted == False,  # noqa: E712
        ProductionRrvBuild.status != "cancelled",
    ).all()


def _machine_store_issues(db: Session, project_id: int) -> list[str]:
    """Posted Store material issues against this machine. They are permanent
    stock records (no cancel/unlink), so they block a delete for good."""
    from app.modules.store.models.material_issue import StoreMaterialIssue
    return [n for (n,) in db.query(StoreMaterialIssue.issue_number).filter(StoreMaterialIssue.erp_project_id == project_id).all()]


def _machine_links(db: Session, project_id: int) -> list[str]:
    """Live, cancellable records in other modules that point at this machine —
    deleting it would leave them pointing at a machine in the Recycle Bin.
    Read-only queries; models imported locally so Service doesn't
    hard-depend on them. Store issues are checked separately
    (_machine_store_issues) because they can't be cancelled."""
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule

    links: list[str] = []
    builds = [b.build_number for b in _live_rrv_builds(db, project_id)]
    if builds:
        links.append(f"RRV build {', '.join(builds)}")
    wos = [w for (w,) in db.query(ProductionWorkOrder.wo_number).filter(
        ProductionWorkOrder.erp_project_id == project_id,
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status != "cancelled",
    ).all()]
    if wos:
        links.append(f"work order {', '.join(wos)}")
    sos = sorted({(n or f"#{i}") for (i, n) in db.query(SalesOrder.id, SalesOrder.so_number).join(
        SalesOrderSchedule, SalesOrderSchedule.so_id == SalesOrder.id
    ).filter(
        SalesOrderSchedule.erp_project_id == project_id,
        SalesOrderSchedule.status != "cancelled",
        SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status != "cancelled",
    ).all()})
    if sos:
        links.append(f"sales order {', '.join(sos)}")
    # Deleting the machine also deletes its SRs, so an SR material that is on
    # a live purchase requisition would leave that PR pointing at a deleted job.
    from app.modules.erp.models.service_material import ServiceMaterial
    from app.modules.p2p.models.p2p_request import P2PRequest
    prs = sorted({n for (n,) in db.query(P2PRequest.p2p_number).join(
        ServiceMaterial, ServiceMaterial.pr_id == P2PRequest.id
    ).join(
        ServiceRequest, ServiceRequest.id == ServiceMaterial.service_request_id
    ).filter(
        ServiceRequest.project_id == project_id,
        ServiceRequest.is_deleted == False,  # noqa: E712
        ServiceMaterial.is_deleted == False,  # noqa: E712
        P2PRequest.status.notin_(("rejected", "cancelled")),
    ).all() if n})
    if prs:
        links.append(f"purchase requisition {', '.join(prs)} (raised from its service requests)")
    return links


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    search: str | None = None,
    status: str | None = None,
    application_type: str | None = None,
    client_company: str | None = None,
    customer_id: int | None = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    """List active (non-deleted) machines/vehicles, optionally filtered by a text search
    across serial number, model, and client company, plus exact-match filters."""
    query = apply_scope(db.query(Project).filter(Project.is_deleted == False), _user, Project)  # noqa: E712
    if status:
        query = query.filter(Project.status == status)
    if application_type:
        query = query.filter(Project.application_type == application_type)
    if client_company:
        query = query.filter(Project.client_company == client_company)
    if customer_id:
        query = query.filter(Project.customer_id == customer_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Project.serial_number.ilike(like))
            | (Project.model_name.ilike(like))
            | (Project.client_company.ilike(like))
        )
    projects = query.all()
    projects.sort(key=lambda p: _natural_sort_key(p.serial_number))
    return projects[skip:skip + limit]


@router.get("/filter-options")
async def get_project_filter_options(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    """Distinct values for the registry's filter dropdowns, so the UI only ever
    offers values that actually exist in the data."""
    base = apply_scope(db.query(Project).filter(Project.is_deleted == False), _user, Project)  # noqa: E712
    statuses = [r[0] for r in base.with_entities(Project.status).distinct() if r[0]]
    application_types = [r[0] for r in base.with_entities(Project.application_type).distinct() if r[0]]
    client_companies = [r[0] for r in base.with_entities(Project.client_company).distinct() if r[0]]
    return {
        "statuses": sorted(statuses),
        "application_types": sorted(application_types),
        "client_companies": sorted(client_companies),
    }


@router.get("/link-options")
async def get_installed_base_link_options(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    """Customer (CRM organizations) and product (Product master) pick-lists
    for the machine form — served here because Service users usually don't
    hold the CRM / Products apps."""
    from app.modules.crm.models.organization import Organization
    from app.modules.products.models.product import FinishedProduct
    orgs = db.query(Organization).filter(Organization.is_deleted == False).order_by(Organization.name).all()  # noqa: E712
    products = db.query(FinishedProduct).filter(FinishedProduct.status != "inactive").order_by(FinishedProduct.name).all()
    return {
        "customers": [{"id": o.id, "label": o.name + (f" ({o.gst_number})" if o.gst_number else ""), "name": o.name,
                       "gst_number": o.gst_number, "state": o.state} for o in orgs],
        "products": [{"id": p.id, "label": f"{p.name}" + (f" — {p.model_number}" if p.model_number else ""),
                      "warranty_months": p.warranty_months} for p in products],
    }


@router.get("/installed-base")
async def get_installed_base(
    customer_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    """Customer-wise installed base (SAP IB51/IH01): per customer, its
    machines with today's warranty cover and open service requests. Machines
    not yet linked to a CRM customer are grouped under customer_id null so
    they can be found and linked. customer_id narrows it to one customer."""
    from datetime import date as _date
    from app.modules.crm.models.organization import Organization
    from app.modules.erp.warranty import warranty_status_on, warranty_window
    q = apply_scope(db.query(Project).filter(Project.is_deleted == False), _user, Project)  # noqa: E712
    if customer_id:
        q = q.filter(Project.customer_id == customer_id)
    machines = q.all()
    machines.sort(key=lambda p: _natural_sort_key(p.serial_number))
    ids = [m.id for m in machines]
    open_srs: dict[int, int] = {}
    if ids:
        for pid, n in db.query(ServiceRequest.project_id, func.count(ServiceRequest.id)).filter(
            ServiceRequest.project_id.in_(ids), ServiceRequest.is_deleted == False,  # noqa: E712
            ServiceRequest.status.notin_(("closed", "cancelled")),
        ).group_by(ServiceRequest.project_id).all():
            open_srs[pid] = n
    orgs = {o.id: o for o in db.query(Organization).filter(Organization.id.in_({m.customer_id for m in machines if m.customer_id})).all()} if machines else {}
    today = _date.today()
    groups: dict[int | None, dict] = {}
    for m in machines:
        org = orgs.get(m.customer_id) if m.customer_id else None
        g = groups.setdefault(m.customer_id, {
            "customer_id": m.customer_id, "customer_name": org.name if org else None,
            "gst_number": org.gst_number if org else None, "state": org.state if org else None,
            "machine_count": 0, "in_warranty": 0, "open_service_requests": 0, "machines": [],
        })
        status = warranty_status_on(db, m, today)
        start, end = warranty_window(db, m)
        g["machine_count"] += 1
        g["in_warranty"] += 1 if status in ("in_warranty", "extended_warranty", "amc") else 0
        g["open_service_requests"] += open_srs.get(m.id, 0)
        g["machines"].append({
            "id": m.id, "serial_number": m.serial_number, "model_name": m.model_name, "product_name": m.product_name,
            "status": m.status, "client_company": m.client_company, "site_name": m.site_name, "site_state": m.site_state,
            "commissioning_date": m.commissioning_date, "warranty_start": start, "warranty_end": end,
            "warranty_status": status, "open_service_requests": open_srs.get(m.id, 0),
        })
    out = sorted(groups.values(), key=lambda g: (g["customer_id"] is None, (g["customer_name"] or "").lower()))
    return out


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    payload: ProjectCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_create"):
        raise HTTPException(status_code=403, detail="You need the 'Create machines' ERP permission to register a machine. Ask an admin to grant it in Users & Roles.")
    existing = _find_serial_clash(db, payload.serial_number)
    if existing:
        raise HTTPException(status_code=409, detail=_serial_clash_detail(existing))
    _check_warranty_dates(payload.model_dump())
    values = payload.model_dump()
    _apply_installed_base_links(db, values)

    needs_approval = bool(get_erp_setting(db, "project_approval_required"))
    project = Project(**values, created_by_id=user.id,
                      approval_status="pending" if needs_approval else "approved")
    db.add(project)
    db.flush()
    _write_audit(db, project.id, "created", user, summary=f"Machine {project.serial_number} registered by {user.name or user.email}."
                 + (" Sent for approval." if needs_approval else ""))
    if needs_approval:
        _ask_machine_approval(db, project, user)
        needs_approval = project.approval_status == "pending"  # no approver stage applied → approved at once
    fire_event(db, background_tasks, "project_create", "New Machine Registered",
               f"Machine '{project.serial_number}' was registered by {user.name or user.email}"
               + (" and is awaiting approval." if needs_approval else "."),
               "project", project.id, user, _machine_details(project, user))
    if project.delivery_date:
        fire_event(db, background_tasks, "dispatch", "Machine Dispatched",
                   f"Machine '{project.serial_number}' was dispatched on {project.delivery_date.strftime('%d-%m-%Y')}.",
                   "project", project.id, user, _machine_details(project, user))
    reached = role_event(
        db, background_tasks, "machine_registered",
        title=f"New machine {project.serial_number}" + (" — waiting for approval" if needs_approval else ""),
        message=f"{user.name or user.email} registered machine {project.serial_number}"
                + (f" ({project.model_name})" if project.model_name else "")
                + (f" for {project.client_company}" if project.client_company else "")
                + (". It is waiting for approval — service requests can't be raised on it until it is approved." if needs_approval else "."),
        entity_type="project", entity_id=project.id, actor=user, record=project, details=_machine_details(project, user),
    )
    broadcast_except(
        db, reached | {user.id},
        title="New Machine Registered",
        message=f"Machine '{project.serial_number}' was registered by {user.name or user.email}.",
        notification_type="project_created",
        entity_type="project",
        entity_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(_require_machine_or_sr_tab),
):
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=_MACHINE_NOT_FOUND)
    ensure_in_scope(db, _user, project)
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You need the 'Edit machines' ERP permission to edit a machine. Ask an admin to grant it in Users & Roles.")
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=_MACHINE_NOT_FOUND)
    ensure_in_scope(db, user, project)

    updates = payload.model_dump(exclude_unset=True)
    # An unchanged legacy status (saved before the list was fixed) mustn't
    # block editing other fields; any new value must come from the fixed list.
    if "status" in updates and updates["status"] != project.status and updates["status"] not in PROJECT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid machine status '{updates['status']}' — choose one of: {', '.join(PROJECT_STATUSES)}.",
        )
    serial_note = ""
    serial_builds: list = []
    if "serial_number" in updates and updates["serial_number"] != project.serial_number:
        # The machine's serial is what the RRV handover certificate prints, so
        # it's corrected HERE (a linked build's own vehicle serial isn't copied
        # back onto the machine). While the build is still open it can change
        # freely; once RRV Completion is signed off the vehicle's identity is
        # frozen until that stage is reopened, and after handover only an
        # admin can correct it (audited).
        serial_builds = _live_rrv_builds(db, project.id)
        completed = [b.build_number for b in serial_builds if b.status == "completed"]
        handed = [b.build_number for b in serial_builds if b.status == "handed_over"]
        if completed:
            raise HTTPException(
                status_code=409,
                detail=f"Serial {project.serial_number} is frozen because RRV build {', '.join(completed)} has RRV Completion signed off. "
                       "In Production, reopen the RRV Completion stage on that build, correct the serial here, then sign the stage off again.",
            )
        if handed and user.role != "admin":
            raise HTTPException(
                status_code=409,
                detail=f"Serial {project.serial_number} is locked because RRV build {', '.join(handed)} has been handed over to the customer "
                       "(its handover certificate carries this serial). Ask an admin to correct it — the change is recorded in the machine's audit log.",
            )
        clash = _find_serial_clash(db, updates["serial_number"], exclude_id=project.id)
        if clash:
            raise HTTPException(status_code=409, detail=_serial_clash_detail(clash))
        if handed:
            serial_note = f" Admin override: serial changed from {project.serial_number} to {updates['serial_number']} after handover of {', '.join(handed)}."
        elif serial_builds:
            serial_note = f" Serial changed from {project.serial_number} to {updates['serial_number']} (RRV build {', '.join(b.build_number for b in serial_builds)} kept in step)."

    if {"warranty_start_date", "warranty_end_date", "extended_warranty", "extended_warranty_end"} & updates.keys():
        _check_warranty_dates({k: updates.get(k, getattr(project, k)) for k in
                               ("warranty_start_date", "warranty_end_date", "extended_warranty", "extended_warranty_end")})
    if {"customer_id", "product_id"} & updates.keys():
        _apply_installed_base_links(db, updates, project)
    changed_fields = [field for field, value in updates.items() if str(getattr(project, field, None)) != str(value)]
    for field, value in updates.items():
        setattr(project, field, value)
    # Keep an open linked build's vehicle serial in step so Production shows
    # the corrected serial too (closed builds' records stay as they are).
    for b in serial_builds:
        if b.status in ("planned", "in_progress", "on_hold"):
            b.vehicle_serial_number = project.serial_number

    if changed_fields:
        _write_audit(db, project.id, "updated", user, summary=f"{user.name or user.email} updated: {', '.join(changed_fields[:5])}.{serial_note}")
        # A rejected machine that is corrected goes back to the approvers.
        if project.approval_status == "rejected" and get_erp_setting(db, "project_approval_required"):
            _write_audit(db, project.id, "approval_resubmitted", user, summary="Machine corrected and re-sent for approval.")
            _ask_machine_approval(db, project, user)
        fire_event(db, background_tasks, "project_update", "Machine Updated",
                   f"Machine '{project.serial_number}' was updated by {user.name or user.email}: {', '.join(changed_fields[:5])}"
                   + (f" (+{len(changed_fields) - 5} more)" if len(changed_fields) > 5 else "") + ".",
                   "project", project.id, user, _machine_details(project, user))
        if "delivery_date" in changed_fields and project.delivery_date:
            fire_event(db, background_tasks, "dispatch", "Machine Dispatched",
                       f"Machine '{project.serial_number}' was dispatched on {project.delivery_date.strftime('%d-%m-%Y')}.",
                       "project", project.id, user, _machine_details(project, user))

    db.commit()
    db.refresh(project)
    return project


def _approval_target(db: Session, project_id: int, user: User) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=_MACHINE_NOT_FOUND)
    # Approvers of the live request are in scope (data_scope's approver rule).
    ensure_in_scope(db, user, project)
    if project.approval_status != "pending":
        raise HTTPException(status_code=409, detail=f"Machine {project.serial_number} is already {project.approval_status} — "
                                                    "there is nothing waiting for approval. Refresh the page.")
    return project


def _legacy_approval_check(db: Session, project: Project, user: User) -> None:
    """In-flight machine sent for approval before the central engine: the old
    Service → Settings approver list still decides it."""
    if not erp_access.legacy_is_approver(db, user, erp_access.MACHINE_KEY):
        raise HTTPException(
            status_code=403,
            detail=f"Machine {project.serial_number} was sent for approval before approvals moved to Organization › "
                   f"Approval Workflows, so its original approvers decide it: "
                   f"{erp_access.legacy_approver_names(db, erp_access.MACHINE_KEY)}.",
        )


def _decide_machine(db: Session, project: Project, user: User, decision: str, remarks: str | None) -> bool:
    """Route a decision to the central engine. False = in-flight legacy item
    (no engine request) — the caller runs the old path."""
    req = engine.latest_request(db, erp_access.MACHINE_ENTITY, project.id)
    if req is None:
        return False
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"The approval of machine {project.serial_number} is already {req.status} — refresh the page.")
    engine.decide(db, req.id, user, decision, remarks)
    return True


@router.post("/{project_id}/approve", response_model=ProjectResponse)
async def approve_project(
    project_id: int,
    payload: ProjectApprovalPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    # Compatibility route: the decision goes through the central approval
    # engine (Organization › Approval Workflows › New machine); the page uses
    # the shared ApprovalPanel.
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    project = _approval_target(db, project_id, user)
    remarks = (payload.remarks or "").strip() or None
    if _decide_machine(db, project, user, "approve", remarks):
        db.commit()
        db.refresh(project)
        return project
    _legacy_approval_check(db, project, user)
    project.approval_status = "approved"
    project.approved_by_id = user.id
    project.approved_at = datetime.now(timezone.utc)
    project.approval_remarks = remarks
    _write_audit(db, project.id, "approved", user,
                 summary=f"Machine {project.serial_number} approved by {user.name or user.email}." + (f" Remarks: {remarks}" if remarks else ""))
    if project.created_by_id and project.created_by_id != user.id:
        notify_user(db, project.created_by_id, "Machine Approved",
                    f"Machine '{project.serial_number}' was approved by {user.name or user.email} — service requests can now be raised on it.",
                    notification_type="project_approved", entity_type="project", entity_id=project.id)
    db.commit()
    db.refresh(project)
    return project


@router.post("/{project_id}/reject", response_model=ProjectResponse)
async def reject_project(
    project_id: int,
    payload: ProjectApprovalPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "projects")),
):
    remarks = (payload.remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Enter the reason for rejecting, so the person who registered the machine knows what to correct.")
    project = _approval_target(db, project_id, user)
    if _decide_machine(db, project, user, "reject", remarks):
        db.commit()
        db.refresh(project)
        return project
    _legacy_approval_check(db, project, user)
    project.approval_status = "rejected"
    project.approved_by_id = user.id
    project.approved_at = datetime.now(timezone.utc)
    project.approval_remarks = remarks
    _write_audit(db, project.id, "rejected", user,
                 summary=f"Machine {project.serial_number} rejected by {user.name or user.email}. Reason: {remarks}")
    if project.created_by_id and project.created_by_id != user.id:
        notify_user(db, project.created_by_id, "Machine Rejected",
                    f"Machine '{project.serial_number}' was rejected by {user.name or user.email}: {remarks}. "
                    "Correct it and save — it goes back for approval automatically.",
                    notification_type="project_rejected", entity_type="project", entity_id=project.id)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    """Soft delete a machine, and cascade the soft-delete to all of its Service Requests
    (setting `is_deleted` doesn't trigger the ORM's `delete-orphan` cascade — that only
    fires on real deletes — so the SRs have to be soft-deleted explicitly here)."""
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=_MACHINE_NOT_FOUND)
    ensure_in_scope(db, user, project)
    ensure_can_delete(user, project, "erp", "projects", what="machine")
    links = _machine_links(db, project.id)
    if links:
        raise HTTPException(
            status_code=409,
            detail=f"Machine {project.serial_number} is linked to {'; '.join(links)}. "
                   "Cancel those (or unlink this machine from them) in Production / Sales / Purchase first, then delete the machine.",
        )
    issues = _machine_store_issues(db, project.id)
    if issues:
        raise HTTPException(
            status_code=409,
            detail=f"Machine {project.serial_number} has Store material issue history ({', '.join(issues)}). Posted material issues are "
                   "permanent stock records, so a machine with issue history can't be deleted. Set its status to Decommissioned or "
                   "Inactive instead to take it out of use.",
        )
    now = datetime.now(timezone.utc)
    project.is_deleted = True
    project.deleted_at = now
    erp_access.cancel_live(db, erp_access.MACHINE_ENTITY, project.id, user, "machine deleted")
    for sr in db.query(ServiceRequest).filter(ServiceRequest.project_id == project.id, ServiceRequest.is_deleted == False).all():  # noqa: E712
        erp_access.cancel_live(db, erp_access.SR_ENTITY, sr.id, user, "machine deleted")
        sr.is_deleted = True
        sr.deleted_at = now
    _write_audit(db, project.id, "deleted", user, summary=f"Machine {project.serial_number} moved to recycle bin by {user.name or user.email}.")
    broadcast_notification(
        db,
        title="Machine Deleted",
        message=f"Machine '{project.serial_number}' was deleted by {user.name or user.email}.",
        notification_type="project_deleted",
        entity_type="project",
        entity_id=project.id,
        exclude_user_id=user.id,
    )
    notify_user(
        db,
        user_id=user.id,
        title="Machine Deleted",
        message=f"You deleted machine '{project.serial_number}'. It can be restored from the recycle bin for 10 days.",
        notification_type="project_deleted",
        entity_type="project",
        entity_id=project.id,
    )
    db.commit()


@router.post("/{project_id}/restore", response_model=ProjectResponse)
async def restore_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    ensure_tab_action(user, "erp", "recycle_bin", "edit")  # restoring = Recycle Bin › Edit
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == True).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="That machine is not in the Recycle Bin — it may already be restored or permanently removed. Refresh the Recycle Bin.")
    ensure_in_scope(db, user, project)
    # Only bring back the SRs that the machine delete cascaded (they share the
    # machine's deleted_at). SRs someone deleted on their own earlier stay in
    # the Recycle Bin and are restored separately.
    cascade_at = project.deleted_at
    project.is_deleted = False
    project.deleted_at = None
    sr_q = db.query(ServiceRequest).filter(ServiceRequest.project_id == project.id, ServiceRequest.is_deleted == True)  # noqa: E712
    if cascade_at is not None:
        sr_q = sr_q.filter(ServiceRequest.deleted_at == cascade_at)
    for sr in sr_q.all():
        sr.is_deleted = False
        sr.deleted_at = None
    _write_audit(db, project.id, "restored", user, summary=f"Machine {project.serial_number} restored from recycle bin.")
    db.commit()
    db.refresh(project)
    return project


@router.get("/recycle-bin/list")
async def list_deleted_projects(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_tab_access("erp", "recycle_bin")),
):
    projects = apply_scope(db.query(Project).filter(Project.is_deleted == True), _user, Project).all()  # noqa: E712
    return [
        {
            "id": p.id,
            "serial_number": p.serial_number,
            "model_name": p.model_name,
            "client_company": p.client_company,
            "deleted_at": p.deleted_at.isoformat() if p.deleted_at else None,
        }
        for p in projects
    ]


@router.get("/{project_id}/audit")
async def get_project_audit(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "audit_trail", "view")),
):
    if not db.query(Project.id).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail=f"No machine with id {project_id} — check the link or open it from the Machines list.")
    _scope_machine(db, project_id, _user)
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "project", AuditLog.entity_id == project_id
    ).order_by(AuditLog.performed_at.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


# ── Documents / Attachments (SharePoint) ────────────────────────────────────

def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(",") if v.strip()]


def _split_csv_ints(value: str | None) -> list[int]:
    return [int(v) for v in _split_csv(value) if v.isdigit()]


def _build_share_rows(user_ids: list[int], departments: list[str], designations: list[str]) -> list[ProjectAttachmentShare]:
    return (
        [ProjectAttachmentShare(user_id=uid) for uid in dict.fromkeys(user_ids)]
        + [ProjectAttachmentShare(department=d) for d in dict.fromkeys(departments)]
        + [ProjectAttachmentShare(designation=d) for d in dict.fromkeys(designations)]
    )


def _can_view_attachment(user: User, attachment: ProjectAttachment) -> bool:
    if user.role == "admin" or not attachment.is_private or attachment.created_by_id == user.id:
        return True
    if user.id in attachment.shared_with_user_ids:
        return True
    if user.department and user.department in attachment.shared_departments:
        return True
    if user.designation and user.designation in attachment.shared_designations:
        return True
    return False


@router.get("/{project_id}/attachments", response_model=list[ProjectAttachmentResponse])
async def list_project_attachments(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "documents", "view")),
):
    _get_live_project(db, project_id, user)
    attachments = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.project_id == project_id
    ).all()
    return [a for a in attachments if _can_view_attachment(user, a)]


@router.get("/{project_id}/attachments/{attachment_id}/preview")
async def preview_project_attachment(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "documents", "view")),
):
    _get_live_project(db, project_id, user)  # 404 when the machine is in the Recycle Bin, 403 when out of scope
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Document not found on this machine — it may have been deleted. Refresh the Documents tab.")
    if not _can_view_attachment(user, attachment):
        raise HTTPException(status_code=403, detail="This is a private document — only its uploader, people it is shared with, or an admin can open it. Ask the uploader to share it with you.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    get_url = await get_preview_url(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return {"getUrl": get_url}


@router.get("/{project_id}/attachments/{attachment_id}/content")
async def get_project_attachment_content(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "documents", "view")),
):
    """Raw file bytes for in-app preview (img/pdf/video tags on our own
    origin) — for formats the browser can render natively. Office documents
    (docx/xlsx/pptx) still need the /preview Microsoft-viewer link since a
    browser can't render those on its own."""
    _get_live_project(db, project_id, user)
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Document not found on this machine — it may have been deleted. Refresh the Documents tab.")
    if not _can_view_attachment(user, attachment):
        raise HTTPException(status_code=403, detail="This is a private document — only its uploader, people it is shared with, or an admin can open it. Ask the uploader to share it with you.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


@router.post("/{project_id}/attachments", response_model=list[ProjectAttachmentResponse])
async def upload_project_attachments(
    project_id: int,
    files: list[UploadFile] = File(...),
    is_private: bool = Form(False),
    shared_with_user_ids: str | None = Form(None),
    shared_departments: str | None = Form(None),
    shared_designations: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You need the 'Edit machines' ERP permission to upload documents. Ask an admin to grant it in Users & Roles.")
    ensure_feature_action(user, "erp", "projects", "documents", "create")
    project = db.query(Project).options(selectinload(Project.attachments)).filter(
        Project.id == project_id, Project.is_deleted == False  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail=_MACHINE_NOT_FOUND)
    ensure_in_scope(db, user, project)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_SHAREPOINT_MISSING)

    share_rows: list[ProjectAttachmentShare] = []
    if is_private:
        share_rows = _build_share_rows(
            _split_csv_ints(shared_with_user_ids), _split_csv(shared_departments), _split_csv(shared_designations)
        )

    project_name = project.serial_number or project.model_name or str(project.id)
    folder_path = build_sharepoint_folder_path(user.name or user.email or "", project_name, "documents")

    attachments = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        attachment = ProjectAttachment(
            project_id=project.id,
            filename=result["name"],
            content_type=f.content_type,
            size=result["size"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            created_by_id=user.id,
            is_private=is_private,
        )
        if is_private:
            # Each attachment gets its own fresh Share rows — sharing one
            # ProjectAttachmentShare instance across attachments would try to
            # insert the same primary key twice.
            attachment.shares = [
                ProjectAttachmentShare(user_id=s.user_id, department=s.department, designation=s.designation)
                for s in share_rows
            ]
        db.add(attachment)
        attachments.append(attachment)

    if attachments:
        db.flush()
        for a in attachments:
            db.refresh(a)
        filenames = ", ".join(a.filename for a in attachments)
        _write_audit(db, project.id, "attachment_uploaded", user, summary=f"{user.name or user.email} uploaded {len(attachments)} file(s): {filenames}")

    db.commit()
    return attachments


@router.patch("/{project_id}/attachments/{attachment_id}/permissions", response_model=ProjectAttachmentResponse)
async def update_project_attachment_permissions(
    project_id: int,
    attachment_id: int,
    payload: ProjectAttachmentPermissionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "documents", "edit")),
):
    _get_live_project(db, project_id, user)
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Document not found on this machine — it may have been deleted. Refresh the Documents tab.")
    if user.role != "admin" and attachment.created_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the uploader or an admin can change this document's access.")

    attachment.is_private = payload.is_private
    attachment.shares = (
        _build_share_rows(payload.shared_with_user_ids, payload.shared_departments, payload.shared_designations)
        if payload.is_private else []
    )
    _write_audit(
        db, project_id, "attachment_permissions_updated", user,
        summary=f"{user.name or user.email} updated access for '{attachment.filename}'",
    )
    db.commit()
    db.refresh(attachment)
    return attachment


@router.delete("/{project_id}/attachments/{attachment_id}")
async def delete_project_attachment(
    project_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    ensure_tab_action(user, "erp", "projects", "delete")  # before the lookup, so a missing grant is never a 404
    ensure_feature_action(user, "erp", "projects", "documents", "delete")
    _get_live_project(db, project_id, user)
    attachment = db.query(ProjectAttachment).options(selectinload(ProjectAttachment.shares)).filter(
        ProjectAttachment.id == attachment_id, ProjectAttachment.project_id == project_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Document not found on this machine — it may have been deleted already. Refresh the Documents tab.")
    if not _can_view_attachment(user, attachment):
        raise HTTPException(
            status_code=403,
            detail="This is a private document shared with others — only its uploader, people it is shared with, or an admin can delete it.",
        )
    ensure_can_delete(user, attachment, "erp", "projects", what="machine document")

    if settings.SHAREPOINT_SITE_ID and attachment.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path)
        except Exception:
            pass  # DB removal proceeds even if SharePoint delete fails

    filename = attachment.filename
    db.delete(attachment)
    _write_audit(db, project_id, "attachment_deleted", user, summary=f"{user.name or user.email} deleted document '{filename}'.")
    db.commit()
    return {"message": "Attachment deleted"}


# ── Created documents: letters on company letterhead ────────────────────────

def _get_live_project(db: Session, project_id: int, user: User | None = None) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="Machine not found — it may have been deleted or moved to the recycle bin.")
    if user is not None:
        ensure_in_scope(db, user, project)
    return project


def _scope_machine(db: Session, project_id: int, user: User) -> None:
    """Child routes (documents, letters, audit) follow the machine's data scope."""
    project = db.get(Project, project_id)
    if project is not None:
        ensure_in_scope(db, user, project)


def _get_letter(db: Session, project_id: int, letter_id: int, user: User | None = None) -> ProjectLetter:
    if user is not None:
        _get_live_project(db, project_id, user)
    letter = db.query(ProjectLetter).filter(
        ProjectLetter.id == letter_id, ProjectLetter.project_id == project_id, ProjectLetter.is_deleted == False  # noqa: E712
    ).first()
    if not letter:
        raise HTTPException(status_code=404, detail="Letter not found on this machine — it may have been deleted. Refresh the Documents tab.")
    return letter


def _letter_response(db: Session, letter: ProjectLetter) -> ProjectLetterResponse:
    out = ProjectLetterResponse.model_validate(letter)
    if letter.created_by_id:
        creator = db.get(User, letter.created_by_id)
        out.created_by_name = (creator.name or creator.email) if creator else None
    return out


@router.get("/{project_id}/letter-defaults")
async def project_letter_defaults(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "letters", "view")),
):
    """Default signatory for a new document: a company Partner (Organization →
    Company Info → Partners) — the logged-in user if they are one, else the
    first partner by name; failing that, whoever signed the most recent letter.
    Null fields mean "no default" — the dialog then uses the logged-in user."""
    _get_live_project(db, project_id, _user)
    partners = db.query(User).filter(User.is_partner.is_(True), User.is_active.is_(True)).order_by(User.name).all()
    options = [{"name": p.name or p.email, "designation": "Partner"} for p in partners]
    if partners:
        chosen = next((p for p in partners if p.id == _user.id), partners[0])
        return {"signatory_name": chosen.name or chosen.email, "signatory_designation": "Partner", "source": "partner", "partners": options}
    last = db.query(ProjectLetter).filter(
        ProjectLetter.is_deleted == False, ProjectLetter.signatory_name.isnot(None), ProjectLetter.signatory_name != ""  # noqa: E712
    ).order_by(ProjectLetter.id.desc()).first()
    if last:
        return {"signatory_name": last.signatory_name, "signatory_designation": last.signatory_designation, "source": "last_letter", "partners": []}
    return {"signatory_name": None, "signatory_designation": None, "source": None, "partners": []}


@router.get("/{project_id}/letters", response_model=list[ProjectLetterResponse])
async def list_project_letters(
    project_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "letters", "view")),
):
    _get_live_project(db, project_id, _user)
    letters = db.query(ProjectLetter).filter(
        ProjectLetter.project_id == project_id, ProjectLetter.is_deleted == False  # noqa: E712
    ).order_by(ProjectLetter.seq.desc()).all()
    return [_letter_response(db, l) for l in letters]


@router.post("/{project_id}/letters", response_model=ProjectLetterResponse, status_code=201)
async def create_project_letter(
    project_id: int,
    payload: ProjectLetterCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You need the 'Edit projects' ERP permission to create letters. Ask an admin to grant it.")
    ensure_feature_action(user, "erp", "projects", "letters", "create")
    # Only the fixed delivery documents are created now; existing general letters stay viewable/editable.
    if payload.letter_type == "general":
        raise HTTPException(status_code=422, detail="General letters are no longer created here — pick Delivery Cover Letter, Delivery Confirmation or Guarantee Certificate.")
    project = _get_live_project(db, project_id, user)
    # Max over deleted letters too, so a deleted letter's number is never reissued.
    last_seq = db.query(func.max(ProjectLetter.seq)).filter(ProjectLetter.project_id == project_id).scalar() or 0
    seq = last_seq + 1
    letter = ProjectLetter(
        project_id=project_id, seq=seq,
        letter_no=f"{project.serial_number}/LTR/{seq:03d}",
        created_by_id=user.id, **payload.model_dump(),
    )
    db.add(letter)
    db.flush()
    _write_audit(db, project_id, "letter_created", user, summary=f"{user.name or user.email} created letter {letter.letter_no}: {letter.subject}")
    db.commit()
    db.refresh(letter)
    return _letter_response(db, letter)


@router.patch("/{project_id}/letters/{letter_id}", response_model=ProjectLetterResponse)
async def update_project_letter(
    project_id: int,
    letter_id: int,
    payload: ProjectLetterUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    if not has_erp_permission(user, "project_edit"):
        raise HTTPException(status_code=403, detail="You need the 'Edit projects' ERP permission to edit letters. Ask an admin to grant it.")
    ensure_feature_action(user, "erp", "projects", "letters", "edit")
    letter = _get_letter(db, project_id, letter_id, user)
    if payload.letter_type != letter.letter_type:
        raise HTTPException(status_code=422, detail=f"{letter.letter_no} is a {letter.subject or 'letter'} — its type can't be changed. Create a new document of the other type instead.")
    changed = False
    for field, value in payload.model_dump().items():
        if getattr(letter, field) != value:
            setattr(letter, field, value)
            changed = True
    if changed:
        letter.revision += 1
    _write_audit(db, project_id, "letter_updated", user, summary=f"{user.name or user.email} edited letter {letter.letter_no}.")
    db.commit()
    db.refresh(letter)
    return _letter_response(db, letter)


@router.delete("/{project_id}/letters/{letter_id}")
async def delete_project_letter(
    project_id: int,
    letter_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("erp")),
):
    letter = _get_letter(db, project_id, letter_id, user)
    ensure_can_delete(user, letter, "erp", "projects", what="letter")
    ensure_feature_action(user, "erp", "projects", "letters", "delete")
    _write_audit(db, project_id, "letter_deleted", user, summary=f"{user.name or user.email} deleted letter {letter.letter_no}: {letter.subject}")
    letter.is_deleted = True
    letter.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Letter deleted"}


@router.get("/{project_id}/letters/{letter_id}/file")
async def download_project_letter(
    project_id: int,
    letter_id: int,
    format: str = "pdf",
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
    _tab: User = Depends(require_feature_action("erp", "projects", "letters", "print")),
):
    if format not in ("pdf", "docx"):
        raise HTTPException(status_code=422, detail=f"Unknown letter format '{format}' — use 'pdf' or 'docx'.")
    letter = _get_letter(db, project_id, letter_id, _user)
    ctx = _letter_context(db, letter)
    base_name = re.sub(r"[^A-Za-z0-9._-]+", "-", letter.letter_no)
    # Once a Word document exists for this version of the letter, it (with any
    # edits made in Word) is the letter of record — not a fresh render.
    if format == "docx":
        content = await managed_documents.docx_of_record(
            db, LETTER_ENTITY, letter.id, letter.revision, render=lambda: build_letter_docx(ctx).getvalue())
        media_type = managed_documents.DOCX_TYPE
    else:
        content = await managed_documents.pdf_of_record(
            db, LETTER_ENTITY, letter.id, letter.revision, render=lambda: build_letter_pdf(ctx).getvalue())
        media_type = "application/pdf"
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{base_name}.{format}"'},
    )


def _letter_context(db: Session, letter: ProjectLetter) -> dict:
    company = db.query(Company).first()
    project = db.get(Project, letter.project_id)
    return {
        "letter_type": letter.letter_type or "general",
        "data": letter.data or {},
        "serial_number": project.serial_number if project else "",
        "letter_no": letter.letter_no,
        "letter_date": letter.letter_date.strftime("%d-%m-%Y"),
        "recipient": letter.recipient,
        "subject": letter.subject,
        "body": letter.body,
        "signatory_name": letter.signatory_name,
        "signatory_designation": letter.signatory_designation,
        "company_name": (company.legal_name or company.name) if company else None,
    }


def _letter_document_target(db: Session, letter_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
    letter = db.query(ProjectLetter).filter(ProjectLetter.id == letter_id, ProjectLetter.is_deleted == False).first()  # noqa: E712
    project = _get_live_project(db, letter.project_id, user) if letter else None
    if not letter or not project:
        raise HTTPException(status_code=404, detail="Letter not found — it may have been deleted. Refresh the Documents tab.")
    # Reading the Word document's state = Machines › View; creating / editing /
    # uploading it = Machines › Edit and Print (it is the printable letter).
    ensure_tab_action(user, "erp", "projects", "view")
    ensure_feature_action(user, "erp", "projects", "letters", "view")
    if modify:
        ensure_tab_action(user, "erp", "projects", "edit")
        ensure_tab_action(user, "erp", "projects", "print")
        ensure_feature_action(user, "erp", "projects", "letters", "edit")
        ensure_feature_action(user, "erp", "projects", "letters", "print")
    return managed_documents.DocumentTarget(
        entity_id=letter.id, revision=letter.revision, title=f"Letter {letter.letter_no}",
        folder=managed_documents.sharepoint_folder("ERP-Letters", project.serial_number),
        filename_stem=managed_documents.safe_filename(letter.letter_no),
        build_docx=lambda: build_letter_docx(_letter_context(db, letter)).getvalue(),
    )


managed_documents.register(managed_documents.DocumentAdapter(
    entity_type=LETTER_ENTITY, app="erp", load=_letter_document_target,
    view_grant="erp:projects.letters:view", edit_grant="erp:projects.letters:edit"))
