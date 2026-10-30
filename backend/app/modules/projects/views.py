"""Response builders shared by the management-side and department-side
routes — names resolved, progress and overdue/at-risk flags computed."""
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.erp.models.project import Project as MachineProject
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmMilestoneMessage, PmProjectTask, PmTaskSubtask, PmTaskTimeLog, PmTaskUpdate
from app.modules.projects.schemas.document import PmProjectDocumentResponse
from app.modules.projects.schemas.milestone import PmPerson, PmProjectMilestoneResponse
from app.modules.projects.schemas.project import PmProjectResponse
from app.modules.projects.schemas.task import (
    PmCommItem,
    PmMessageResponse, PmMilestoneWorkspaceResponse, PmProjectTaskResponse, PmSubtaskResponse, PmTaskDetailResponse,
    PmTaskUpdateResponse, PmTimeLogResponse,
)
from app.modules.projects import workflow as wf


class _Names:
    """Per-request cache so list endpoints don't re-query the same
    user/department/project/milestone for every row."""

    def __init__(self, db: Session):
        self.db = db
        self._users: dict[int, str | None] = {}
        self._depts: dict[int, str | None] = {}
        self._projects: dict[int, PmProject | None] = {}
        self._milestones: dict[int, PmProjectMilestone | None] = {}
        self._machines: dict[int, tuple[int, str] | None] = {}

    def user(self, uid: int | None) -> str | None:
        if not uid:
            return None
        if uid not in self._users:
            u = self.db.get(User, uid)
            self._users[uid] = wf.user_label(u) if u else None
        return self._users[uid]

    def dept(self, did: int | None) -> str | None:
        if not did:
            return None
        if did not in self._depts:
            d = self.db.get(Department, did)
            self._depts[did] = d.name if d else None
        return self._depts[did]

    def project(self, pid: int) -> PmProject | None:
        if pid not in self._projects:
            self._projects[pid] = self.db.get(PmProject, pid)
        return self._projects[pid]

    def milestone(self, mid: int | None) -> PmProjectMilestone | None:
        if not mid:
            return None
        if mid not in self._milestones:
            self._milestones[mid] = self.db.get(PmProjectMilestone, mid)
        return self._milestones[mid]

    def preload_machines(self, project_ids) -> None:
        """One query for the machines of many projects (lists)."""
        ids = [i for i in set(project_ids) if i not in self._machines]
        if not ids:
            return
        found: dict[int, tuple[int, str]] = {}
        for mid, pid, serial in self.db.query(MachineProject.id, MachineProject.pm_project_id, MachineProject.serial_number).filter(
            MachineProject.pm_project_id.in_(ids), MachineProject.is_deleted == False,  # noqa: E712
        ).order_by(MachineProject.id).all():
            found.setdefault(pid, (mid, serial))  # lowest id wins
        for i in ids:
            self._machines[i] = found.get(i)

    def machine(self, project_id: int) -> tuple[int, str] | None:
        if project_id not in self._machines:
            self.preload_machines([project_id])
        return self._machines[project_id]


def names(db: Session) -> _Names:
    return _Names(db)


def people(cache: _Names, ids) -> list[PmPerson]:
    return [PmPerson(id=i, name=cache.user(i) or f"User #{i}") for i in (ids or []) if i]


def project_response(db: Session, project: PmProject, user: User | None = None, cache: _Names | None = None) -> PmProjectResponse:
    cache = cache or names(db)
    resp = PmProjectResponse.model_validate(project)
    resp.project_manager_name = cache.user(project.project_manager_id)
    resp.created_by_name = cache.user(project.created_by_id)
    resp.released_by_name = cache.user(project.released_by_id)
    resp.closed_by_name = cache.user(project.closed_by_id)
    resp.documents_archived_by_name = cache.user(project.documents_archived_by_id)
    for key, value in wf.project_rollup(db, project).items():
        setattr(resp, key, value)
    machine = cache.machine(project.id)
    if machine:
        resp.machine_id, resp.machine_serial = machine
    if project.internal_order_id:
        from app.modules.accounts.models.internal_order import InternalOrder
        io = db.get(InternalOrder, project.internal_order_id)
        if io:
            resp.internal_order_code, resp.internal_order_name = io.code, io.name
    from app.modules.projects import lifecycle
    resp.lifecycle_stage = project.lifecycle_stage or "planned"
    resp.lifecycle_stage_label = lifecycle.stage_label(resp.lifecycle_stage)
    if project.sales_order_id:
        # Historic sales-order project (Sales Orders were retired 2026-10-30): the order number is display only.
        from app.modules.sales.models.order import SalesOrder
        so = db.get(SalesOrder, project.sales_order_id)
        if so:
            resp.so_number = so.so_number or f"Draft #{so.id}"
        from app.modules.projects.models.element import PmProjectElement
        resp.units_total = db.query(func.count(PmProjectElement.id)).filter(
            PmProjectElement.project_id == project.id, PmProjectElement.status != "cancelled").scalar() or 0
    if user is not None:
        resp.can_manage = wf.can_manage(project, user)
    return resp


def milestone_response(db: Session, m: PmProjectMilestone, cache: _Names | None = None,
                       tasks: list[PmProjectTask] | None = None) -> PmProjectMilestoneResponse:
    cache = cache or names(db)
    tasks = tasks if tasks is not None else wf.milestone_tasks(db, m.id)
    resp = PmProjectMilestoneResponse.model_validate(m)
    project = cache.project(m.project_id)
    if project:
        resp.project_code, resp.project_name, resp.project_status = project.project_code, project.name, project.status
    resp.department_name = cache.dept(m.department_id)
    resp.lead_name = cache.user(m.lead_user_id)
    resp.assistant_user_ids = wf.assistant_ids(m)
    resp.assistants = people(cache, resp.assistant_user_ids)
    if m.status == "not_started":
        prev = wf.blocking_milestone(db, m)
        if prev:
            resp.is_locked, resp.waiting_for_title, resp.waiting_for_sequence = True, prev.title, prev.sequence
            resp.waiting_reason = wf.blocking_reason(db, m)
    dep = cache.milestone(m.depends_on_milestone_id)
    if dep:
        resp.depends_on_title, resp.depends_on_status, resp.depends_on_sequence = dep.title, dep.status, dep.sequence
    resp.submitted_by_name = cache.user(m.submitted_by_id)
    resp.achieved_by_name = cache.user(m.achieved_by_id)
    live = wf.live_tasks(tasks)
    resp.progress_percent = wf.milestone_progress(m, tasks)
    resp.forecast_date = wf.milestone_forecast(m, tasks)
    flags = wf.milestone_flags(m, tasks)
    resp.is_overdue, resp.is_at_risk = flags["is_overdue"], flags["is_at_risk"]
    resp.task_count = len(live)
    resp.tasks_done = sum(1 for t in live if t.status == "done")
    resp.tasks_blocked = sum(1 for t in live if t.status == "blocked")
    resp.evidence_count = db.query(PmProjectDocument).filter(
        PmProjectDocument.milestone_id == m.id, PmProjectDocument.is_deleted == False  # noqa: E712
    ).count()
    return resp


def logged_hours(db: Session, task_ids: list[int]) -> dict[int, float]:
    if not task_ids:
        return {}
    rows = db.query(PmTaskTimeLog.task_id, func.sum(PmTaskTimeLog.hours)).filter(PmTaskTimeLog.task_id.in_(task_ids)).group_by(PmTaskTimeLog.task_id).all()
    return {tid: float(h or 0) for tid, h in rows}


def task_response(db: Session, t: PmProjectTask, viewer: User | None = None, cache: _Names | None = None,
                  counts: dict[int, tuple[int, int]] | None = None, hours: dict[int, float] | None = None) -> PmProjectTaskResponse:
    cache = cache or names(db)
    counts = counts if counts is not None else wf.subtask_counts(db, [t.id])
    hours = hours if hours is not None else logged_hours(db, [t.id])
    resp = PmProjectTaskResponse.model_validate(t)
    resp.assignee_name = cache.user(t.assignee_id)
    project = cache.project(t.project_id)
    if project:
        resp.project_code, resp.project_name, resp.project_status = project.project_code, project.name, project.status
    milestone = cache.milestone(t.milestone_id)
    if milestone:
        resp.milestone_title = milestone.title
        resp.milestone_target_date = milestone.target_date
        resp.milestone_status = milestone.status
        resp.department_id = milestone.department_id
        resp.department_name = cache.dept(milestone.department_id)
    total, done = counts.get(t.id, (0, 0))
    resp.subtasks_total, resp.subtasks_done = total, done
    resp.progress_percent = wf.task_progress(t, (total, done))
    resp.is_overdue = wf.task_is_overdue(t, date.today())
    resp.logged_hours = round(hours.get(t.id, 0.0), 2)
    resp.is_self_created = bool(t.created_by_id) and t.created_by_id == t.assignee_id
    if viewer is not None:
        resp.is_assignee = t.assignee_id == viewer.id
        resp.is_head = bool(milestone) and wf.is_milestone_lead(db, viewer, milestone)
    return resp


def task_list(db: Session, tasks: list[PmProjectTask], viewer: User | None = None, cache: _Names | None = None) -> list[PmProjectTaskResponse]:
    cache = cache or names(db)
    ids = [t.id for t in tasks]
    counts = wf.subtask_counts(db, ids)
    hours = logged_hours(db, ids)
    return [task_response(db, t, viewer, cache, counts, hours) for t in tasks]


def document_response(doc: PmProjectDocument, cache: _Names) -> PmProjectDocumentResponse:
    resp = PmProjectDocumentResponse.model_validate(doc)
    resp.uploaded_by_name = resp.uploaded_by_name or cache.user(doc.uploaded_by_id)
    milestone_id = doc.milestone_id
    if doc.task_id:
        t = cache.db.get(PmProjectTask, doc.task_id)
        resp.task_title = t.title if t else None
        st = cache.db.get(PmTaskSubtask, doc.subtask_id) if doc.subtask_id else None
        if st and resp.task_title:
            resp.task_title = f"{resp.task_title} › {st.title}"
        milestone_id = milestone_id or (t.milestone_id if t else None)
        if t and t.department_id:
            resp.department_name = cache.dept(t.department_id)
        resp.source = "task"
        if t and t.milestone_id is None:
            # A Project Plan milestone (stored as a task without a WBS): the file is on it, or on one of its tasks.
            resp.plan_milestone_id, resp.plan_milestone_title = t.id, t.title
            if st:
                parent = cache.db.get(PmTaskSubtask, st.parent_id) if st.parent_id else None
                resp.subtask_id = st.id
                resp.plan_task_title = f"{parent.title} › {st.title}" if parent else st.title
    elif doc.message_id:
        msg = cache.db.get(PmMilestoneMessage, doc.message_id)
        milestone_id = milestone_id or (msg.milestone_id if msg else None)
        resp.source = "chat"
    elif doc.milestone_id:
        resp.source = "evidence"
    m = cache.milestone(milestone_id)
    if m:
        resp.milestone_title = m.title
        resp.milestone_sequence = m.sequence
        resp.department_name = resp.department_name or cache.dept(m.department_id)
    return resp


def documents_for(db: Session, cache: _Names, **filters) -> list[PmProjectDocumentResponse]:
    q = db.query(PmProjectDocument).filter(PmProjectDocument.is_deleted == False)  # noqa: E712
    for col, val in filters.items():
        q = q.filter(getattr(PmProjectDocument, col) == val)
    return [document_response(d, cache) for d in q.order_by(PmProjectDocument.id.desc()).all()]


def task_detail(db: Session, t: PmProjectTask, viewer: User) -> PmTaskDetailResponse:
    cache = names(db)
    subtasks = db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id == t.id).order_by(PmTaskSubtask.id).all()
    updates = db.query(PmTaskUpdate).filter(PmTaskUpdate.task_id == t.id).order_by(PmTaskUpdate.id.desc()).all()
    upd = []
    for u in updates:
        r = PmTaskUpdateResponse.model_validate(u)
        r.user_name = cache.user(u.user_id)
        r.mentions = people(cache, u.mention_user_ids)
        upd.append(r)
    logs = []
    for lg in db.query(PmTaskTimeLog).filter(PmTaskTimeLog.task_id == t.id).order_by(PmTaskTimeLog.work_date.desc(), PmTaskTimeLog.id.desc()).all():
        r = PmTimeLogResponse.model_validate(lg)
        r.user_name = cache.user(lg.user_id)
        logs.append(r)
    return PmTaskDetailResponse(
        task=task_response(db, t, viewer, cache),
        subtasks=[PmSubtaskResponse.model_validate(s) for s in subtasks],
        updates=upd,
        files=documents_for(db, cache, task_id=t.id),
        time_logs=logs,
    )


def workspace_response(db: Session, m: PmProjectMilestone, viewer: User, role: str) -> PmMilestoneWorkspaceResponse:
    """role: manage / lead see everything; a member sees the WBS name
    and dates plus only their own tasks (no progress); a guest (tagged in the
    chat) sees just the header and the chat."""
    cache = names(db)
    tasks = wf.milestone_tasks(db, m.id)
    project = cache.project(m.project_id)
    ms = milestone_response(db, m, cache, tasks)
    ms.my_role = role
    full = role in ("manage", "lead")
    if not full:
        ms.progress_percent, ms.task_count, ms.tasks_done, ms.tasks_blocked, ms.evidence_count = 0, 0, 0, 0, 0
        ms.is_at_risk, ms.forecast_date = False, None
    shown = tasks if full else [t for t in tasks if role == "member" and t.assignee_id == viewer.id]
    return PmMilestoneWorkspaceResponse(
        milestone=ms,
        tasks=task_list(db, shown, viewer, cache),
        evidence=documents_for(db, cache, milestone_id=m.id) if full else [],
        can_manage=bool(project) and wf.can_manage(project, viewer),
        can_plan=wf.is_milestone_lead(db, viewer, m),
        role=role,
    )


def message_list(db: Session, messages: list[PmMilestoneMessage]) -> list[PmMessageResponse]:
    cache = names(db)
    files: dict[int, list[PmProjectDocumentResponse]] = {}
    ids = [x.id for x in messages]
    if ids:
        docs = db.query(PmProjectDocument).filter(
            PmProjectDocument.message_id.in_(ids), PmProjectDocument.is_deleted == False  # noqa: E712
        ).order_by(PmProjectDocument.id).all()
        for d in docs:
            files.setdefault(d.message_id, []).append(document_response(d, cache))
    return [
        PmMessageResponse(
            id=x.id, milestone_id=x.milestone_id, user_id=x.user_id, user_name=cache.user(x.user_id), body=x.body,
            mentions=people(cache, x.mention_user_ids), files=files.get(x.id, []), created_at=x.created_at,
        )
        for x in messages
    ]


def communications(db: Session, project: PmProject) -> list[PmCommItem]:
    """The project's correspondence log, newest first: every WBS chat
    message (with its files), every task comment, and every file a
    department attached as evidence or to a task — so the project manager
    sees who discussed and sent what, without opening each WBS."""
    cache = names(db)
    milestones = {m.id: m for m in db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project.id).all()}
    tasks = {t.id: t for t in db.query(PmProjectTask).filter(PmProjectTask.project_id == project.id).all()}

    def where(milestone_id: int | None, task_id: int | None = None) -> dict:
        m = milestones.get(milestone_id) if milestone_id else None
        t = tasks.get(task_id) if task_id else None
        return dict(milestone_id=m.id if m else None, milestone_title=m.title if m else None,
                    milestone_sequence=m.sequence if m else None, department_name=cache.dept(m.department_id) if m else None,
                    task_id=t.id if t else None, task_title=t.title if t else None)

    out: list[PmCommItem] = []
    if milestones:
        msgs = db.query(PmMilestoneMessage).filter(PmMilestoneMessage.milestone_id.in_(list(milestones))).all()
        for r in message_list(db, msgs):
            out.append(PmCommItem(key=f"m{r.id}", kind="message", user_id=r.user_id, user_name=r.user_name, body=r.body,
                                  mentions=r.mentions, files=r.files, created_at=r.created_at, **where(r.milestone_id)))
    if tasks:
        comments = db.query(PmTaskUpdate).filter(PmTaskUpdate.task_id.in_(list(tasks)), PmTaskUpdate.kind == "comment").all()
        for c in comments:
            t = tasks[c.task_id]
            out.append(PmCommItem(key=f"c{c.id}", kind="comment", user_id=c.user_id, user_name=cache.user(c.user_id), body=c.comment,
                                  mentions=people(cache, c.mention_user_ids), created_at=c.created_at, **where(t.milestone_id, t.id)))
    docs = db.query(PmProjectDocument).filter(
        PmProjectDocument.project_id == project.id, PmProjectDocument.is_deleted == False,  # noqa: E712
        PmProjectDocument.message_id.is_(None),
        (PmProjectDocument.milestone_id.isnot(None)) | (PmProjectDocument.task_id.isnot(None)),
    ).all()
    for d in docs:
        resp = document_response(d, cache)
        out.append(PmCommItem(key=f"f{d.id}", kind="file", user_id=d.uploaded_by_id, user_name=resp.uploaded_by_name,
                              files=[resp], created_at=d.created_at,
                              **where(d.milestone_id or (tasks[d.task_id].milestone_id if d.task_id in tasks else None), d.task_id)))
    out.sort(key=lambda x: (x.created_at is not None, x.created_at), reverse=True)
    return out


def breakdown(db: Session, project: PmProject, milestones: list[PmProjectMilestone], viewer: User) -> dict:
    """The whole hierarchy in one read: project → WBS elements (in step order)
    → who got how many tasks → each task with its sub-tasks, files, comments
    (with @mentions), reasons, status history and time; plus each
    WBS's evidence and team chat. Nothing here is editable — it is the
    audit view of who did what, when."""
    cache = names(db)
    today = date.today()
    ms_out, project_people = [], {}
    for m in sorted(milestones, key=lambda x: (x.sequence, x.id)):
        tasks = wf.milestone_tasks(db, m.id)
        ids = [t.id for t in tasks]
        subs: dict[int, list] = {}
        upds: dict[int, list] = {}
        logs: dict[int, list] = {}
        docs: dict[int, list] = {}
        if ids:
            for s in db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id.in_(ids)).order_by(PmTaskSubtask.id).all():
                subs.setdefault(s.task_id, []).append(PmSubtaskResponse.model_validate(s))
            for u in db.query(PmTaskUpdate).filter(PmTaskUpdate.task_id.in_(ids)).order_by(PmTaskUpdate.id).all():
                r = PmTaskUpdateResponse.model_validate(u)
                r.user_name = cache.user(u.user_id)
                r.mentions = people(cache, u.mention_user_ids)
                upds.setdefault(u.task_id, []).append(r)
            for lg in db.query(PmTaskTimeLog).filter(PmTaskTimeLog.task_id.in_(ids)).order_by(PmTaskTimeLog.work_date).all():
                r = PmTimeLogResponse.model_validate(lg)
                r.user_name = cache.user(lg.user_id)
                logs.setdefault(lg.task_id, []).append(r)
            for d in db.query(PmProjectDocument).filter(PmProjectDocument.task_id.in_(ids), PmProjectDocument.is_deleted == False).order_by(PmProjectDocument.id).all():  # noqa: E712
                docs.setdefault(d.task_id, []).append(document_response(d, cache))

        task_rows, ms_people, mentioned = [], {}, {}
        for t, resp in zip(tasks, task_list(db, tasks, viewer, cache)):
            updates = upds.get(t.id, [])
            for u in updates:
                for p in u.mentions:
                    mentioned[p.id] = p.name
            task_rows.append({
                **resp.model_dump(), "created_by_name": cache.user(t.created_by_id),
                "subtasks": subs.get(t.id, []), "files": docs.get(t.id, []), "time_logs": logs.get(t.id, []),
                "comments": [u for u in updates if u.kind == "comment"],
                "history": [u for u in updates if u.kind == "status"],
            })
            for bucket in (ms_people, project_people):
                row = bucket.setdefault(t.assignee_id or 0, {
                    "user_id": t.assignee_id, "name": cache.user(t.assignee_id) or "Unassigned", "given": 0, "self_added": 0,
                    "done": 0, "open": 0, "overdue": 0, "cancelled": 0, "estimated_hours": 0.0, "logged_hours": 0.0, "last_completed_at": None,
                })
                row["self_added" if resp.is_self_created else "given"] += 1
                row["done"] += t.status == "done"
                row["cancelled"] += t.status == "cancelled"
                row["open"] += t.status in ("todo", "in_progress", "blocked")
                row["overdue"] += wf.task_is_overdue(t, today)
                row["estimated_hours"] += t.estimated_hours or 0
                row["logged_hours"] += resp.logged_hours
                if t.completed_at and (row["last_completed_at"] is None or t.completed_at > row["last_completed_at"]):
                    row["last_completed_at"] = t.completed_at

        messages = message_list(db, db.query(PmMilestoneMessage).filter(PmMilestoneMessage.milestone_id == m.id).order_by(PmMilestoneMessage.id).all())
        for msg in messages:
            for p in msg.mentions:
                mentioned[p.id] = p.name
        ms_out.append({
            "milestone": milestone_response(db, m, cache, tasks),
            "people": sorted(ms_people.values(), key=lambda r: -(r["given"] + r["self_added"])),
            "tasks": task_rows,
            "evidence": documents_for(db, cache, milestone_id=m.id),
            "messages": messages,
            "mentioned": [{"id": i, "name": n} for i, n in mentioned.items()],
        })
    return {
        "project": {"id": project.id, "project_code": project.project_code, "name": project.name, "client_name": project.client_name,
                    "status": project.status, "start_date": project.start_date, "target_handover_date": project.target_handover_date},
        "milestones": ms_out,
        "people": sorted(project_people.values(), key=lambda r: -(r["given"] + r["self_added"])),
    }
