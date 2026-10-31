from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.priority import PRIORITIES, parse_priority
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.organization.models.department import Department
from app.modules.projects.models.project import PmProject, PM_PROJECT_STATUSES
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.task import PmProjectTask, PM_TASK_OPEN_STATUSES
from app.modules.projects.schemas.project import (
    PmProjectCreate, PmProjectUpdate, PmProjectTransitionPayload, PmStagePayload, PmProjectResponse, PmClosureResponse,
    PmProjectWithMachineCreate, _clean_ref,
)
from app.modules.erp.models.project import Project as MachineProject
from app.modules.projects.schemas.task import PmCommItem, PmProjectTaskResponse
from app.modules.projects import views, workflow as wf
from app.modules.projects import access as pm_access
from app.modules.projects import closure
from app.modules.projects import lifecycle
from app.modules.projects.events import pm_event
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.pew_numbers import next_pew_number, pew_number_taken
from app.modules.accounts.services import project_budget

router = APIRouter(
    prefix="/projects", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)

_LIVE_STATUSES = ("planning", "active", "on_hold", "technically_complete")


def _get_or_404(db: Session, project_id: int, user: User | None = None) -> PmProject:
    project = db.get(PmProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted. Go back to All Projects.")
    if user is not None:
        ensure_in_scope(db, user, project)
    return project


def _check_code(db: Session, code: str, exclude_id: int | None = None) -> str:
    code = (code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Project number is required — leave it blank for the next PEW number.")
    # One PEW series with the Order Projects (core/pew_numbers.py): clash with either.
    other = pew_number_taken(db, code, exclude_pm_id=exclude_id)
    if other:
        raise HTTPException(status_code=409, detail=f"{code} is already used by {other} - type another number (e.g. {code}A for a repeat) or leave it blank for the next free number {next_pew_number(db)}.")
    return code


def _next_code(db: Session) -> str:
    """Next PEW-<N> (shared with Order Projects and past machines), used when the number is left blank."""
    return next_pew_number(db)


def _check_user(db: Session, user_id: int, label: str) -> User:
    u = db.get(User, user_id)
    if not u or not u.is_active:
        raise HTTPException(status_code=422, detail=f"The selected {label} doesn't exist or is deactivated. Pick an active user.")
    return u


@router.get("/meta")
async def get_project_meta(user: User = Depends(require_app_access("projects"))):
    return {
        "statuses": PM_PROJECT_STATUSES, "priorities": PRIORITIES,
        "lifecycle_stages": lifecycle.stage_options(),
        # All Projects › Create is itself the management grant (an authority
        # grant); Partners and Directors hold that authority by flag.
        "can_create": wf.is_management(user),
    }


# Lookups for the milestone form (Milestones tab) and the milestone team
# picker (MilestoneWorkspace). Kept on the router-level app gate only: they
# list names, not project data, and are needed wherever a team is picked.
@router.get("/lookups/departments")
async def lookup_departments(db: Session = Depends(get_db)):
    """Departments a WBS can be given to, with their heads (who keep
    lead rights on every WBS of their department)."""
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        head_ids = wf.department_head_ids(d)
        heads = [wf.user_label(u) for u in db.query(User).filter(User.id.in_(head_ids)).all()] if head_ids else []
        out.append({"id": d.id, "name": d.name, "heads": heads, "has_head": bool(heads)})
    return out


@router.get("/lookups/departments/{department_id}/people")
async def lookup_department_people(department_id: int, db: Session = Depends(get_db)):
    """People in a department — offered first when picking a WBS's
    lead and assistants (heads listed first)."""
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail=f"Department #{department_id} not found")
    heads = wf.department_head_ids(dept)
    ids = wf.department_member_ids(db, dept)
    users = db.query(User).filter(User.id.in_(ids), User.is_active.is_(True)).all() if ids else []
    users.sort(key=lambda u: (u.id not in heads, (u.name or u.email or "").lower()))
    return [{"id": u.id, "name": wf.user_label(u), "email": u.email, "designation": u.designation, "is_head": u.id in heads} for u in users]


@router.get("", response_model=list[PmProjectResponse])
async def list_projects(
    status_filter: str | None = Query(None, alias="status"),
    stage: str | None = Query(None, description="Lifecycle stage key, e.g. manufacturing"),
    priority: str | None = None,
    health: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    query = apply_scope(db.query(PmProject), user, PmProject)
    if status_filter:
        query = query.filter(PmProject.status == status_filter)
    if stage:
        query = query.filter(PmProject.lifecycle_stage == lifecycle.validate_stage(stage))
    if priority:
        query = query.filter(PmProject.priority == parse_priority(priority))
    if search:
        like = f"%{search}%"
        query = query.filter(
            (PmProject.name.ilike(like)) | (PmProject.project_code.ilike(like)) | (PmProject.client_name.ilike(like))
            | (PmProject.customer_po_ref.ilike(like)) | (PmProject.sales_order_ref.ilike(like))
        )
    cache = views.names(db)
    projects = query.order_by(PmProject.created_at.desc()).all()
    cache.preload_machines(p.id for p in projects)
    rows = [views.project_response(db, p, user, cache) for p in projects]
    if health:
        rows = [r for r in rows if r.health == health]
    return rows


@router.get("/dashboard")
async def projects_dashboard(db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "dashboard"))):
    """Management view: health of every live project, overdue WBS elements by
    department, WBS elements waiting for acceptance, and blocked tasks."""
    cache = views.names(db)
    today = date.today()
    projects = apply_scope(db.query(PmProject).filter(PmProject.status.in_(_LIVE_STATUSES)), user, PmProject).order_by(PmProject.target_handover_date).all()
    cache.preload_machines(p.id for p in projects)
    summaries = [views.project_response(db, p, user, cache) for p in projects]
    counts = {s: 0 for s in ("planning", "active", "on_hold", "technically_complete", "on_track", "at_risk", "delayed")}
    for s in summaries:
        counts[s.status] = counts.get(s.status, 0) + 1
        if s.health:
            counts[s.health] += 1

    active_ids = [p.id for p in projects if p.status in ("active", "on_hold")]
    milestones = db.query(PmProjectMilestone).filter(
        PmProjectMilestone.project_id.in_(active_ids), PmProjectMilestone.status.notin_(("achieved", "cancelled"))
    ).order_by(PmProjectMilestone.target_date).all() if active_ids else []
    overdue_by_dept: dict[str, list[dict]] = {}
    awaiting = []
    for m in milestones:
        p = cache.project(m.project_id)
        if m.status == "submitted":
            awaiting.append(views.milestone_response(db, m, cache))
        if m.target_date < today:
            overdue_by_dept.setdefault(cache.dept(m.department_id) or "No department", []).append({
                "id": m.id, "title": m.title, "project_id": p.id, "project_code": p.project_code,
                "target_date": m.target_date, "days_overdue": (today - m.target_date).days, "status": m.status,
            })

    blocked = db.query(PmProjectTask).filter(
        PmProjectTask.project_id.in_(active_ids), PmProjectTask.status == "blocked"
    ).all() if active_ids else []
    return {
        "counts": counts,
        "projects": summaries,
        "overdue_by_department": [
            {"department": d, "count": len(rows), "milestones": rows}
            for d, rows in sorted(overdue_by_dept.items(), key=lambda kv: -len(kv[1]))
        ],
        "awaiting_acceptance": awaiting,
        "blocked_tasks": views.task_list(db, blocked, user, cache),
    }


@router.get("/board")
async def department_board(db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "department_board"))):
    """Projects × departments grid: each cell lists that department's
    WBS elements on the project with their status."""
    cache = views.names(db)
    projects = apply_scope(db.query(PmProject).filter(PmProject.status.in_(_LIVE_STATUSES)), user, PmProject).order_by(PmProject.project_code).all()
    pids = [p.id for p in projects]
    milestones = db.query(PmProjectMilestone).filter(
        PmProjectMilestone.project_id.in_(pids), PmProjectMilestone.status != "cancelled"
    ).order_by(PmProjectMilestone.target_date).all() if pids else []
    tasks_by_ms: dict[int, list[PmProjectTask]] = {}
    if milestones:
        for t in db.query(PmProjectTask).filter(PmProjectTask.milestone_id.in_([m.id for m in milestones])).all():
            tasks_by_ms.setdefault(t.milestone_id, []).append(t)
    dept_ids = sorted({m.department_id for m in milestones if m.department_id}, key=lambda d: cache.dept(d) or "")
    cells: dict[int, dict[int, list[dict]]] = {}
    for m in milestones:
        flags = wf.milestone_flags(m, tasks_by_ms.get(m.id, []))
        cells.setdefault(m.project_id, {}).setdefault(m.department_id or 0, []).append({
            "id": m.id, "title": m.title, "status": m.status, "target_date": m.target_date,
            "progress_percent": wf.milestone_progress(m, tasks_by_ms.get(m.id, [])), **flags,
        })
    return {
        "departments": [{"id": d, "name": cache.dept(d)} for d in dept_ids],
        "rows": [
            {
                "project": {"id": p.id, "project_code": p.project_code, "name": p.name, "status": p.status,
                            "target_handover_date": p.target_handover_date},
                "cells": {str(k): v for k, v in cells.get(p.id, {}).items()},
            }
            for p in projects
        ],
    }


@router.get("/budget-options")
async def budget_options(
    project_id: int | None = Query(None, description="The project being edited — its current budget stays listed"),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    """Finance budgets a project can link to: Open / In progress, not held by another project."""
    keep = None
    if project_id is not None:
        project = _get_or_404(db, project_id, user)
        wf.require_manage(project, user, "link a Finance budget")
        wf.require_management(user, "link or change a project's Finance budget")
        keep = project.internal_order_id
    else:
        wf.require_management(user, "link a Finance budget to a new project")
    return project_budget.budget_options(db, keep_id=keep)


def _linkable_budget(db: Session, internal_order_id: int, keep_id: int | None = None):
    try:
        return project_budget.check_linkable(db, internal_order_id, keep_id=keep_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("", response_model=PmProjectResponse)
async def create_project(
    payload: PmProjectCreate,
    db: Session = Depends(get_db),
    # All Projects › View, plus management authority checked below — All
    # Projects › Create is the MANAGE_GRANT itself, and Partners/Directors
    # hold that authority by flag (they are not given the grant).
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    wf.require_management(user, "create projects")
    project = _add_project(db, user, payload)
    db.commit()
    db.refresh(project)
    return views.project_response(db, project, user)


BUDGET_ON_CREATE_MSG = ("Finance budgets aren't linked when a project is created — create the project first, "
                        "then link a budget later from the project's Overview, if needed.")


def _check_crm_source(db: Session, kind: str | None, source_id: int | None) -> tuple[str | None, int | None, str | None]:
    """The optional CRM source of a new project: ('inquiry' | 'tender', id) that must exist.
    Returns (kind, id, its CRM number) or (None, None, None) when none was given."""
    kind = (kind or "").strip().lower() or None
    if kind is None and source_id is None:
        return None, None, None
    if kind not in ("inquiry", "tender"):
        raise HTTPException(status_code=422, detail="CRM source must be an inquiry or a tender. Pick one from the CRM source list, or leave it blank.")
    if source_id is None:
        raise HTTPException(status_code=422, detail=f"Pick which {kind} is the CRM source, or clear the CRM source field.")
    rec = db.get(Inquiry if kind == "inquiry" else Tender, source_id)
    if rec is None or rec.is_deleted:
        raise HTTPException(status_code=422, detail=f"The CRM {kind} #{source_id} doesn't exist or was deleted. Refresh the list and pick another one, or leave the CRM source blank.")
    return kind, source_id, rec.universal_id


def _add_project(db: Session, user: User, payload) -> PmProject:
    """Validates and adds a Planning project (flushed, NOT committed) — shared by
    create_project and create_project_with_machine so the rules live once.
    `payload` has the PmProjectCreate fields."""
    code = _check_code(db, payload.project_code) if (payload.project_code or "").strip() else _next_code(db)
    for field, label in (("name", "Project name"), ("client_name", "Customer")):
        if not (getattr(payload, field) or "").strip():
            raise HTTPException(status_code=422, detail=f"{label} is required.")
    priority = parse_priority(payload.priority)
    if getattr(payload, "internal_order_id", None) is not None:
        raise HTTPException(status_code=422, detail=BUDGET_ON_CREATE_MSG)
    if payload.start_date and payload.target_handover_date and payload.target_handover_date < payload.start_date:
        raise HTTPException(status_code=422, detail=f"Target handover date {payload.target_handover_date:%d-%m-%Y} is before the start date {payload.start_date:%d-%m-%Y}. Fix one of the dates.")
    pm_id = payload.project_manager_id or user.id
    _check_user(db, pm_id, "project manager")
    source_kind, source_id, source_number = _check_crm_source(db, getattr(payload, "source_kind", None), getattr(payload, "source_id", None))

    project = PmProject(
        project_code=code, name=payload.name.strip(), client_name=payload.client_name.strip(),
        customer_po_ref=payload.customer_po_ref, sales_order_ref=payload.sales_order_ref,
        description=payload.description,
        project_manager_id=pm_id, start_date=payload.start_date,
        target_handover_date=payload.target_handover_date, priority=priority,
        status="planning", created_by_id=user.id, source_kind=source_kind, source_id=source_id,
    )
    db.add(project)
    db.flush()
    wf.audit(db, project.id, user, "created", f"Project {project.project_code} ({project.name}) created by {wf.user_label(user)}.", subtab_key="overview")
    if source_kind:
        wf.audit(db, project.id, user, "updated", f"CRM source {source_kind} {source_number} linked.", subtab_key="overview")
    wf.notify_many(db, [project.project_manager_id], user, "You are project manager",
                   f"{wf.user_label(user)} made you project manager of {project.project_code} {project.name}.",
                   "pm_project_manager", "pm_project", project.id)
    # No existing machine can carry this number: _check_code refuses a number held by a machine
    # serial (PEW-34 or PEW-34-A1), and a blank number is highest-used + 1. Machines created later
    # join by number from the machine side (link_machine_by_number).
    return project


@router.post("/with-machine", response_model=PmProjectResponse)
async def create_project_with_machine(
    payload: PmProjectWithMachineCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    # Same authority as create_project; the machine is part of the project, so the
    # separate ERP 'create machines' grant is not needed here.
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    """'Add New Project': registers the machine AND the Project Management
    project in one transaction — any error saves nothing."""
    wf.require_management(user, "create projects")
    m = payload.machine
    client = (payload.client_name or m.client_company or "").strip()
    if not client:
        raise HTTPException(status_code=422, detail="Client company is required — enter it on the Client & Site tab.")
    try:
        po = _clean_ref(payload.customer_po_ref or m.po_number, "Customer PO number is required — enter it on the Timeline & Warranty tab (PO number).")
        # SO number is not asked on the Add New Project form; optional, added later on Overview.
        so = (payload.sales_order_ref or "").strip()[:100] or None
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    pm_payload = PmProjectCreate.model_construct(
        project_code=payload.project_code, name=payload.name, client_name=client, customer_po_ref=po,
        sales_order_ref=so, description=payload.description, project_manager_id=payload.project_manager_id,
        start_date=payload.start_date, target_handover_date=payload.target_handover_date, priority=payload.priority,
        internal_order_id=payload.internal_order_id, source_kind=payload.source_kind, source_id=payload.source_id,
    )
    try:
        project = _add_project(db, user, pm_payload)
        values = m.model_dump()
        values["serial_number"] = m.serial_number or project.project_code
        if not values.get("client_company"):
            values["client_company"] = client
        if not values.get("po_number"):
            values["po_number"] = po
        values["pm_project_id"] = project.id
        from app.modules.erp.routes.projects import register_machine
        machine = register_machine(db, background_tasks, values, user)
        wf.audit(db, project.id, user, "updated", f"Machine {machine.serial_number} registered with the project.", subtab_key="overview")
        db.commit()
    except Exception:
        db.rollback()  # nothing is saved: neither the project nor the machine
        raise
    db.refresh(project)
    return views.project_response(db, project, user)


@router.get("/{project_id}", response_model=PmProjectResponse)
async def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "all_projects"))):
    return views.project_response(db, _get_or_404(db, project_id, user), user)


@router.patch("/{project_id}", response_model=PmProjectResponse)
async def update_project(
    project_id: int,
    payload: PmProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("projects", "overview", "edit")),  # edited on the workspace Overview tab
):
    project = _get_or_404(db, project_id, user)
    wf.require_manage(project, user, "edit the project")
    updates = payload.model_dump(exclude_unset=True)

    if project.status in ("closed", "cancelled"):
        locked = sorted(set(updates) - {"closure_note", "lessons_learned"})
        if locked:
            raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]}; only the closure note and lessons learned can still be edited.")
    if "project_code" in updates:
        if project.status != "planning" and (updates["project_code"] or "").strip().upper() != project.project_code:
            raise HTTPException(status_code=409, detail=f"The project code can only change while the project is in Planning — departments already know it as {project.project_code}.")
        updates["project_code"] = _check_code(db, updates["project_code"], exclude_id=project.id)
        if updates["project_code"] != project.project_code:
            # The machine registered with the project carries the project number as its
            # serial: it follows the new number (409 if an RRV build froze the serial).
            linked = db.query(MachineProject).filter(
                MachineProject.pm_project_id == project.id, MachineProject.is_deleted == False,  # noqa: E712
            ).order_by(MachineProject.id).first()
            if linked and (linked.serial_number or "").strip().upper() == project.project_code:
                from app.modules.erp.routes.projects import rename_machine_serial
                rename_machine_serial(db, linked, updates["project_code"], user)
                wf.audit(db, project.id, user, "updated", f"Machine serial changed from {project.project_code} to {updates['project_code']} with the project number.", subtab_key="overview")
    for field, label in (("name", "Project name"), ("client_name", "Customer")):
        if field in updates and not (updates[field] or "").strip():
            raise HTTPException(status_code=422, detail=f"{label} can't be empty.")
    if "priority" in updates:
        updates["priority"] = parse_priority(updates["priority"])
    if "project_manager_id" in updates:
        if not updates["project_manager_id"]:
            raise HTTPException(status_code=422, detail="A project must have a project manager.")
        _check_user(db, updates["project_manager_id"], "project manager")
    start = updates.get("start_date", project.start_date)
    end = updates.get("target_handover_date", project.target_handover_date)
    if ("start_date" in updates and not start) or ("target_handover_date" in updates and not end):
        raise HTTPException(status_code=422, detail="Start date and target handover date are required.")
    if start and end and end < start:
        raise HTTPException(status_code=422, detail=f"Target handover date {end:%d-%m-%Y} is before the start date {start:%d-%m-%Y}. Fix one of the dates.")
    if "target_handover_date" in updates and end:
        late = db.query(PmProjectMilestone).filter(
            PmProjectMilestone.project_id == project_id, PmProjectMilestone.target_date > end, PmProjectMilestone.status != "cancelled"
        ).order_by(PmProjectMilestone.target_date.desc()).first()
        if late:
            raise HTTPException(status_code=422, detail=f"WBS '{late.title}' is due {late.target_date:%d-%m-%Y}, after the new handover date {end:%d-%m-%Y}. Move that WBS first, or pick a later handover date.")

    # Linked separately (validated + its own audit line), never through the loop below.
    new_io_id = updates.pop("internal_order_id", project.internal_order_id)
    if new_io_id != project.internal_order_id:
        wf.require_management(user, "link or change a project's Finance budget")
        new_io = _linkable_budget(db, new_io_id, keep_id=project.internal_order_id) if new_io_id else None
        from app.modules.accounts.models.internal_order import InternalOrder
        old_io = db.get(InternalOrder, project.internal_order_id) if project.internal_order_id else None
        if old_io is not None:
            try:
                project_budget.check_unlinkable(db, old_io)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))
        text =(f"Finance budget changed from {old_io.code} to {new_io.code} ({new_io.name})" if old_io and new_io
                else f"Finance budget {new_io.code} ({new_io.name}) linked" if new_io
                else f"Finance budget {old_io.code if old_io else ''} unlinked")
        wf.audit(db, project.id, user, "updated", f"{text} by {wf.user_label(user)}.", subtab_key="overview", field_name="internal_order_id",
                 old_value=old_io.code if old_io else None, new_value=new_io.code if new_io else None)
        project.internal_order_id = new_io.id if new_io else None

    old_pm = project.project_manager_id
    for field, val in updates.items():
        old_val = getattr(project, field)
        if old_val != val:
            wf.audit(db, project.id, user, "updated", f"{field.replace('_', ' ').capitalize()} changed by {wf.user_label(user)}.",
                     subtab_key="overview", field_name=field,
                     old_value=str(old_val) if old_val is not None else None, new_value=str(val) if val is not None else None)
        setattr(project, field, val)
    if project.project_manager_id != old_pm:
        wf.notify_many(db, [project.project_manager_id], user, "You are project manager",
                       f"{wf.user_label(user)} made you project manager of {project.project_code} {project.name}.",
                       "pm_project_manager", "pm_project", project.id)
    db.commit()
    db.refresh(project)
    return views.project_response(db, project, user)


def _open_work_people(db: Session, project_id: int) -> tuple[list[PmProjectMilestone], list[int]]:
    milestones = db.query(PmProjectMilestone).filter(
        PmProjectMilestone.project_id == project_id, PmProjectMilestone.status.notin_(("achieved", "cancelled"))
    ).all()
    assignees = [t.assignee_id for t in db.query(PmProjectTask).filter(
        PmProjectTask.project_id == project_id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES),
    ).all() if t.assignee_id]
    return milestones, assignees


@router.post("/{project_id}/stage", response_model=PmProjectResponse)
async def move_project_stage(
    project_id: int,
    payload: PmStagePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("projects", "overview", "edit")),
):
    """Moves the project's lifecycle stage (Planned to Closed / Delivered). Forward by any number of
    steps: the project manager or management. Backwards: admin or Partner, with a reason."""
    project = _get_or_404(db, project_id, user)
    wf.require_manage(project, user, "move the project stage")
    if project.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]} — its stage can't change. Reopen it first if work continues.")
    if (lifecycle.stage_index(lifecycle.validate_stage(payload.stage)) >= lifecycle.stage_index("dispatched")
            and not wf.is_management(user)):
        from app.modules.projects.models.element import PmProjectElement
        waiting = [el.element_no for el in db.query(PmProjectElement).filter(
            PmProjectElement.project_id == project.id, PmProjectElement.status.notin_(("cancelled", "dispatched", "delivered"))).all()]
        if waiting:
            raise HTTPException(status_code=403, detail=f"Units {', '.join(waiting[:5])}{' …' if len(waiting) > 5 else ''} of {project.project_code} are not dispatched yet — "
                                                        f"the stage moves to Dispatched by itself when they ship. Only management can set it earlier.")
    if lifecycle.set_stage(db, project, payload.stage, user, payload.reason):
        db.commit()
        db.refresh(project)
    return views.project_response(db, project, user)


@router.post("/{project_id}/transition", response_model=PmProjectResponse)
async def transition_project(
    project_id: int,
    payload: PmProjectTransitionPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    # Lifecycle buttons sit in the workspace header above Overview — editing the project.
    user: User = Depends(require_tab_action("projects", "overview", "edit")),
):
    """Moves the project through its lifecycle — one endpoint, one rule
    table, so every allowed move and its checks are in one place."""
    project = _get_or_404(db, project_id, user)
    action = payload.action
    reason = (payload.reason or "").strip() or None
    status = project.status
    label = wf.PROJECT_STATUS_LABELS.get(status, status)
    actor = wf.user_label(user)
    wf.require_manage(project, user, f"{action} the project")

    def wrong_state(allowed: str):
        raise HTTPException(status_code=409, detail=f"Can't {action} project {project.project_code}: it is {label}, and this needs it to be {allowed}.")

    milestones = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id, PmProjectMilestone.status != "cancelled").all()
    # Collected before any cascade below — it filters on open statuses.
    open_ms, assignees = _open_work_people(db, project_id) if action in ("hold", "resume", "cancel") else ([], [])
    if action == "activate":
        if status != "planning":
            wrong_state("Planning")
        if not milestones:
            raise HTTPException(status_code=422, detail="Add at least one department WBS before releasing the project — releasing is what sends WBS elements to the departments.")
        leadless = [m.title for m in milestones if not m.lead_user_id]
        if leadless:
            raise HTTPException(status_code=422, detail=f"No lead is set for: {', '.join(leadless)}. Edit each WBS and pick the person who represents the department — otherwise nobody would plan it.")
        project.status = "active"
        project.released_by_id = user.id
        project.released_at = wf.now()
        for m in sorted(milestones, key=lambda x: (x.sequence, x.id)):
            first = wf.blocking_milestone(db, m) is None
            tail = "Create and assign its tasks." if first else "Plan its tasks now; work starts once the earlier steps are achieved."
            wf.notify_department_heads(
                db, m, user, "New WBS for your department",
                f"{project.project_code} {project.name}: step {m.sequence} '{m.title}' is due {m.target_date:%d-%m-%Y}. You are on it. {tail}",
                "pm_milestone_assigned",
            )
            wf.notify_many(db, wf.assistant_ids(m), user, "You are on a project WBS",
                           f"{project.project_code} {project.name}: you are an assistant on '{m.title}' (due {m.target_date:%d-%m-%Y}). "
                           f"Your lead will give you tasks; you can also add your own.", "pm_milestone_assigned", "pm_milestone", m.id)
    elif action == "hold":
        if status != "active":
            wrong_state("Active")
        if not reason:
            raise HTTPException(status_code=422, detail="Give a reason for putting the project on hold — every department will see it.")
        project.status, project.hold_reason = "on_hold", reason
    elif action == "resume":
        if status != "on_hold":
            wrong_state("On hold")
        project.status, project.hold_reason = "active", None
    elif action == "complete":
        if status != "active":
            wrong_state("Active")
        if not milestones:
            raise HTTPException(status_code=409, detail="This project has no WBS elements to achieve.")
        pending = [m.title for m in milestones if m.status != "achieved"]
        if pending:
            raise HTTPException(status_code=409, detail=f"{len(pending)} WBS element(s) are not accepted yet: {', '.join(pending[:5])}. Accept them first (the last one is normally the machine handover).")
        project.status = "technically_complete"
        project.technically_completed_on = date.today()
    elif action == "close":
        # WBS is no longer used in the UI, so an open project closes straight
        # from the closure panel once its checklist is clear.
        if status not in ("planning", "active", "technically_complete"):
            wrong_state("open (Planning, Active or Technically complete)")
        closure.require_closable(db, project)
        note = (payload.closure_note or "").strip()
        if not note:
            raise HTTPException(status_code=422, detail="Add a closure note: final billing, retention released, warranty start and anything still owed to the customer.")
        if not payload.documents_archived:
            raise HTTPException(status_code=422, detail="Confirm that every project document (drawings, reports, certificates) is filed in the Documents tab before closing.")
        project.status = "closed"
        project.closure_date = date.today()
        project.closed_by_id = user.id
        project.closure_note = note
        project.lessons_learned = (payload.lessons_learned or "").strip() or None
        project.documents_archived_at, project.documents_archived_by_id = wf.now(), user.id
    elif action == "cancel":
        if status not in ("planning", "active", "on_hold"):
            wrong_state("Planning, Active or On hold")
        if not reason:
            raise HTTPException(status_code=422, detail="Give a reason for cancelling the project.")
        project.status, project.cancel_reason = "cancelled", reason
        project.closure_date, project.closed_by_id = date.today(), user.id
        # Close out open work so milestones and tasks record why they stopped.
        closing_note = f"Project cancelled: {reason}"
        for m in open_ms:
            m.status, m.cancel_reason = "cancelled", closing_note
            wf.audit(db, project_id, user, "milestone_cancelled", f"WBS '{m.title}' cancelled with the project by {actor}. Reason: {reason}")
        for t in db.query(PmProjectTask).filter(
            PmProjectTask.project_id == project_id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES),
        ).all():
            t.cancel_reason = closing_note
            wf.set_task_status(db, t, user, "cancelled", closing_note)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{action}'. Use one of: activate, hold, resume, complete, close, cancel.")

    if action in ("hold", "resume", "cancel") and status != "planning":
        verb = {"hold": "put ON HOLD", "resume": "RESUMED", "cancel": "CANCELLED"}[action]
        tail = {"hold": f" All open tasks are frozen. Reason: {reason}", "resume": " Work can continue.", "cancel": f" Stop work on its tasks. Reason: {reason}"}[action]
        msg = f"{project.project_code} {project.name} was {verb} by {actor}.{tail}"
        for m in open_ms:
            wf.notify_department_heads(db, m, user, f"Project {verb.lower()}", msg, f"pm_project_{action}")
        wf.notify_many(db, assignees, user, f"Project {verb.lower()}", msg, f"pm_project_{action}", "pm_project", project.id)

    # Role subscribers (core/events/projects.py); the people on the open work were told above.
    event = {"hold": "project_on_hold", "resume": "project_resumed", "cancel": "project_cancelled", "close": "project_closed"}.get(action)
    if event:
        told = set(assignees) | {i for m in open_ms for i in wf.owner_ids(db, m)} if action in ("hold", "resume", "cancel") and status != "planning" else set()
        what = {"hold": f"put on hold. Reason: {reason}", "resume": "resumed — work can continue",
                "cancel": f"cancelled. Reason: {reason}", "close": "closed"}[action]
        pm_event(db, background_tasks, event, project,
                 title=f"Project {project.project_code} {wf.PROJECT_STATUS_LABELS.get(project.status, project.status).lower()}",
                 message=f"{project.project_code} {project.name} was {what} (by {actor}).",
                 entity_type="pm_project", entity_id=project.id, actor=user, skip=told)
    wf.audit(db, project.id, user, "status_changed",
             f"Project {project.project_code}: {label} → {wf.PROJECT_STATUS_LABELS[project.status]} by {actor}." + (f" Reason: {reason}" if reason else ""),
             subtab_key="overview", field_name="status", old_value=status, new_value=project.status)
    db.commit()
    db.refresh(project)
    return views.project_response(db, project, user)


@router.get("/{project_id}/budget")
async def project_budget_spend(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "overview"))):
    """The linked Finance budget: budget, committed (open POs), actual (posted vouchers), available."""
    project = _get_or_404(db, project_id, user)
    return project_budget.budget_spend(db, project.internal_order_id, ledger_detail=project_budget.can_see_ledger(user))


@router.get("/{project_id}/closure", response_model=PmClosureResponse)
async def project_closure(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "overview"))):
    """Closure checklist: what still stands between this project and Closed."""
    project = _get_or_404(db, project_id, user)
    checks = closure.checklist(db, project)
    ready = project.status in ("planning", "active", "technically_complete") and all(
        c["ok"] for c in checks if c.get("required", True) and c["key"] != "documents_archived")
    return {"status": project.status, "can_close": ready, "checks": checks}


@router.delete("/{project_id}")
async def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "all_projects"))):
    project = _get_or_404(db, project_id, user)
    ensure_can_delete(user, project, "projects", "all_projects", what="project")
    wf.require_manage(project, user, "delete the project")
    if project.status != "planning":
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS.get(project.status, project.status)}. Only projects still in Planning can be deleted; cancel it instead so its history is kept.")
    machine = db.query(MachineProject.serial_number).filter(
        MachineProject.pm_project_id == project_id, MachineProject.is_deleted == False,  # noqa: E712
    ).order_by(MachineProject.id).first()
    if machine:
        raise HTTPException(status_code=409, detail=f"Machine {machine[0]} belongs to this project. Cancel the project instead (its history is kept), or open the machine from the project Overview (Open machine record) and delete it first.")
    if db.query(PmProjectMilestone.id).filter(PmProjectMilestone.project_id == project_id, PmProjectMilestone.status != "cancelled").first():
        raise HTTPException(status_code=409, detail="This project has WBS elements. Delete its WBS elements first, or cancel the project instead.")
    if db.query(PmProjectMilestone.id).filter(PmProjectMilestone.project_id == project_id).first():
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} has cancelled WBS elements, which are kept for history and can't be deleted. Use Cancel project instead.")
    # Department tasks and documents point at the project (no cascade), and
    # they are its work history — a project that has any is cancelled, not deleted.
    n_tasks = db.query(func.count(PmProjectTask.id)).filter(PmProjectTask.project_id == project_id).scalar() or 0
    from app.modules.projects.models.document import PmProjectDocument
    # Deleted files are tombstones (their SharePoint file is already gone) —
    # they don't block deleting a Planning project and go with it.
    n_docs = db.query(func.count(PmProjectDocument.id)).filter(
        PmProjectDocument.project_id == project_id, PmProjectDocument.is_deleted == False,  # noqa: E712
    ).scalar() or 0
    if n_tasks or n_docs:
        parts = ([f"{n_tasks} task(s)"] if n_tasks else []) + ([f"{n_docs} document(s)"] if n_docs else [])
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} already has {' and '.join(parts)}, which are kept as its history. "
                                                    "Use Cancel project (with a reason) instead of deleting it.")
    wf.audit(db, project.id, user, "deleted", f"Project {project.project_code} ({project.name}) deleted by {wf.user_label(user)}.", subtab_key="overview")
    db.query(PmProjectDocument).filter(PmProjectDocument.project_id == project_id, PmProjectDocument.is_deleted == True).delete(synchronize_session=False)  # noqa: E712
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


@router.get("/{project_id}/tasks", response_model=list[PmProjectTaskResponse])
async def list_project_tasks(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "milestones"))):
    _get_or_404(db, project_id, user)
    tasks = db.query(PmProjectTask).filter(PmProjectTask.project_id == project_id).order_by(PmProjectTask.due_date, PmProjectTask.id).all()
    return views.task_list(db, tasks, user)


@router.get("/{project_id}/breakdown")
async def project_breakdown(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "milestones"))):
    # Work Breakdown tab has no registry tab of its own — it is the
    # milestones' task tree, so it follows Milestones › View.
    """Project → WBS elements → people → tasks → sub-tasks, files, comments,
    mentions, reasons, history and time, plus each WBS's chat."""
    project = _get_or_404(db, project_id, user)
    milestones = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id).all()
    return views.breakdown(db, project, milestones, user)


@router.get("/{project_id}/communications", response_model=list[PmCommItem])
async def project_communications(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("projects", "milestones"))):
    # Same access as the Work Breakdown: it is the WBS elements' chat,
    # comments and files, gathered for the project manager.
    """Every department's discussion and every file they sent, newest first."""
    project = _get_or_404(db, project_id, user)
    return views.communications(db, project)


@router.get("/{project_id}/audit")
async def get_project_audit(project_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("projects", "project_history"))):
    _get_or_404(db, project_id, _user)
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "pm_project", AuditLog.entity_id == project_id).order_by(AuditLog.performed_at.desc()).all()
    user_map: dict[int, str] = {}
    ids = {log.performed_by_id for log in logs if log.performed_by_id}
    if ids:
        for u in db.query(User).filter(User.id.in_(ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"
    return [
        {
            "id": log.id, "action": log.action, "field_name": log.field_name, "old_value": log.old_value,
            "new_value": log.new_value, "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]
