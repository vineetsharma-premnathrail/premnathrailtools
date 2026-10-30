"""R&D › R&D Tasks — one board over requirement tasks and Prototype / Research
project tasks: list, filters, analytics (tiles, per person, per project /
requirement) and Create Task by type.

Permissions: the tab `rnd:tasks` (view, create); the feature
`rnd:tasks.analytics:view` (all R&D tasks, not only mine — the R&D head and
admins always see all). Everyone else sees only the tasks assigned to or
created by them (rnd/services/task_board.py applies this in SQL).

Create Task keeps each record's own rules: a requirement task needs a
requirement the user can open whose latest revision is accepted; a project
task needs the user to be a lead of the project (or an admin). The assignee
rules ("Assign to") apply as on the record's own Tasks tab.
"""
from datetime import date
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.requirement import RndRequirement
from app.modules.rnd.routes import project_tasks as project_task_routes
from app.modules.rnd.routes import requirement_work as requirement_work_routes
from app.modules.rnd.scope import apply_scope
from app.modules.rnd.services import project_roles
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake
from app.modules.rnd.services import task_board

router = APIRouter(
    prefix="/tasks", tags=["RnD Tasks"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "tasks"))],
)


def _filters(
    type: str | None = None, requirement_id: int | None = None, rnd_project_id: int | None = None,
    assigned_to_id: int | None = None, department: str | None = None, status: str | None = None,
    priority: str | None = None, due_from: date | None = None, due_to: date | None = None,
    progress_band: str | None = None, q: str | None = None,
) -> dict:
    return {
        "type": type, "requirement_id": requirement_id, "rnd_project_id": rnd_project_id, "assigned_to_id": assigned_to_id,
        "department": department, "status": status, "priority": priority, "due_from": due_from, "due_to": due_to,
        "progress_band": progress_band, "q": q,
    }


@router.get("")
async def list_tasks(
    filters: dict = Depends(_filters), page: int = 1, page_size: int = 50,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Tasks the user may see, parent reference ascending then task id ascending."""
    rows = task_board.collect(db, user, filters)
    return task_board.paginate(rows, page, page_size)


@router.get("/analytics")
async def task_analytics(filters: dict = Depends(_filters), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tiles (total / pending / completed / overdue / average progress), by person and by
    project / requirement — over the same filtered, scoped set as the list."""
    rows = task_board.collect(db, user, filters)
    return {**task_board.analytics(rows), "scope": "all" if task_board.sees_all(db, user) else "mine"}


@router.get("/filter-options")
async def filter_options(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Values for the Filters popup — only from tasks the user may see."""
    rows = task_board.collect(db, user, {"status": None})
    people = {r["assignee"]["id"]: r["assignee"] for r in rows}
    parents = {(r["parent"]["kind"], r["parent"].get("id") or r["parent"].get("record_id")): r["parent"] for r in rows}
    return {
        "people": sorted(people.values(), key=lambda p: p["name"] or ""),
        "departments": sorted({p["department"] for p in people.values() if p["department"]}),
        "requirements": sorted((p for p in parents.values() if p["kind"] == "requirement" and p.get("id")), key=lambda p: p["ref"]),
        "projects": sorted((p for p in parents.values() if p["kind"] == "project"), key=lambda p: p["ref"]),
    }


@router.get("/requirement-options")
async def requirement_options(q: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Requirements the user can open whose latest revision is accepted (the Requirement picker of Create Task)."""
    visible = ra.visible_keys(db, user)
    reqs = db.query(RndRequirement).filter(RndRequirement.status.in_(intake.WORK_OPEN)).order_by(RndRequirement.rd_number.asc()).all()
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender
    out = []
    term = (q or "").strip().lower()
    for r in reqs:
        if visible is not None and (r.source, r.record_id) not in visible:
            continue
        model = Inquiry if r.source == "inquiry" else Tender
        rec = db.query(model).filter(model.id == r.record_id, model.is_deleted == False).first()  # noqa: E712
        if not rec:
            continue
        title = rec.product if r.source == "inquiry" else rec.tender_name
        label = f"{r.rd_number} · {title or rec.universal_id}"
        if term and term not in label.lower() and term not in (rec.universal_id or "").lower():
            continue
        rev = intake.latest_revision(db, r)
        out.append({"id": r.id, "source": r.source, "record_id": r.record_id, "rd_number": r.rd_number,
                    "revision_code": rev.revision_code if rev else None, "title": title, "label": label})
    return out[:50]


@router.get("/project-options")
async def project_options(q: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Prototype / Research projects the user may give tasks on (a lead of the project, or an admin)."""
    query = apply_scope(db.query(RndProject), user, RndProject).filter(RndProject.is_deleted == False, RndProject.status != "cancelled")  # noqa: E712
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(RndProject.project_number.ilike(like) | RndProject.title.ilike(like))
    projects = [p for p in query.order_by(RndProject.project_number.asc()).limit(200).all() if project_roles.can_manage(user, p)]
    return [{"id": p.id, "project_number": p.project_number, "title": p.title, "label": f"{p.project_number} · {p.title}"} for p in projects[:50]]


@router.get("/assignees")
async def assignees(
    type: Literal["requirement", "prototype"], source: Literal["inquiry", "tender"] | None = None,
    record_id: int | None = None, rnd_project_id: int | None = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Who the chosen requirement / project can give the task to (after the role's "Assign to" rule)."""
    if type == "requirement":
        if not source or not record_id:
            raise HTTPException(status_code=422, detail="Pick the requirement first — the people you can assign depend on it.")
        return await requirement_work_routes.list_assignees(source, record_id, db, user)
    if not rnd_project_id:
        raise HTTPException(status_code=422, detail="Pick the Prototype / Research project first — only its team members can get tasks.")
    return (await project_task_routes.task_access(rnd_project_id, db, user))["people"]


@router.post("")
async def create_task(
    type: str | None = Form(None), source: str | None = Form(None), record_id: int | None = Form(None),
    rnd_project_id: int | None = Form(None),
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), details: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Create Task. Type decides the form: `requirement` (source + record_id of an accepted
    requirement) or `prototype` (rnd_project_id of a Prototype / Research project).
    `remarks` is the task's details (`details` is accepted as an alias); `checklist` is a JSON string."""
    remarks = remarks if remarks is not None else details
    ensure_tab_action(user, "rnd", "tasks", "create")
    if type not in ("requirement", "prototype"):
        raise HTTPException(status_code=422, detail="Pick the task type first — Requirement or Prototype — then the requirement or project it belongs to.")
    if type == "requirement":
        if source not in ("inquiry", "tender") or not record_id:
            raise HTTPException(status_code=422, detail="Pick the requirement this task is for (it must be accepted by R&D).")
        task = await requirement_work_routes.create_requirement_task(
            db, user, source=source, record_id=record_id, title=title, assigned_to_id=assigned_to_id, due_date=due_date,
            remarks=remarks, files=files, priority=priority, start_date=start_date, work_status=work_status,
            checklist=checklist, background_tasks=background_tasks, check_feature=False,
        )
    else:
        if not rnd_project_id:
            raise HTTPException(status_code=422, detail="Pick the Prototype / Research project this task is for.")
        task = await project_task_routes.create_project_task(
            db, user, project_id=rnd_project_id, title=title, assigned_to_id=assigned_to_id, due_date=due_date,
            remarks=remarks, files=files, priority=priority, start_date=start_date, work_status=work_status,
            checklist=checklist, background_tasks=background_tasks, check_feature=False,
        )
    return {**task, "type": type}
