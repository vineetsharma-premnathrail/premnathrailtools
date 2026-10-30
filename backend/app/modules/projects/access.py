"""Project Management on the central authorization framework.

Data scope (app/core/data_scope.py, module key "projects"):
  - Projects: own = I am the project manager or created it; assigned = I lead,
    assist on or head the department of one of its WBS elements, or a task of it
    is assigned to me. No plant column — plant scope uses the PM's / creator's
    plant.
  - WBS: own = I lead or submitted it; assigned = I assist on it, head
    its department, have a task in it, or manage its project.
  - Tasks: own = assigned to me / created by me; assigned = tasks of WBS elements
    I lead / head / manage.
  Documents, sub-tasks, time logs, chat are children — routes check the parent.
  The department "Ongoing Projects" tabs (routes/work.py) use the same scope.

Approvals (central engine, Organization › Approval Workflows):
  - projects.milestone_acceptance — a submitted WBS is accepted
    (Achieved) or rejected (back to In progress). Before the engine,
    "management" decided it: Partners, Directors, holders of Project
    Management › All Projects › Create, the project's own project manager (and
    admins). The engine can't put "partner ∪ director ∪ permission ∪ record
    person" in one stage, so the submit computes that set into the context
    field `acceptor_ids` and the default stage is `record_field` on it
    (admins act through the engine's admin stand-in, with a comment).
  In-flight WBS elements (status submitted, no engine request) are still decided
  by the old accept / reject routes with the old management check.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, object_session

from app.core.data_scope import register_scoped
from app.core.permission_registry import holds_deliberately, is_admin_user
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask

MILESTONE_KEY = "projects.milestone_acceptance"
MILESTONE_ENTITY = "pm_milestone"


# ── Data scope ───────────────────────────────────────────────────────────

def _headed_department_ids(db: Session, user) -> list[int]:
    out = []
    for d in db.query(Department).all():
        if user.id in (d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])):
            out.append(d.id)
    return out


def _team_milestone_ids(db: Session, user) -> list[int]:
    """WBS the user leads, assists on or heads the department of."""
    heads = set(_headed_department_ids(db, user))
    ids = []
    for mid, lead, assistants, dept in db.query(
        PmProjectMilestone.id, PmProjectMilestone.lead_user_id, PmProjectMilestone.assistant_user_ids,
        PmProjectMilestone.department_id,
    ).all():
        if lead == user.id or dept in heads or user.id in [int(i) for i in (assistants or []) if i]:
            ids.append(mid)
    return ids


def _projects_i_work_on(user):
    db = object_session(user)
    milestone_ids = _team_milestone_ids(db, user) if db is not None else []
    from_milestones = select(PmProjectMilestone.project_id).where(PmProjectMilestone.id.in_(milestone_ids or [-1]))
    from_tasks = select(PmProjectTask.project_id).where(PmProjectTask.assignee_id == user.id)
    return or_(PmProject.id.in_(from_milestones), PmProject.id.in_(from_tasks))


def _milestones_i_work_on(user):
    db = object_session(user)
    milestone_ids = _team_milestone_ids(db, user) if db is not None else []
    managed = select(PmProject.id).where(or_(PmProject.project_manager_id == user.id, PmProject.created_by_id == user.id))
    with_my_tasks = select(PmProjectTask.milestone_id).where(PmProjectTask.assignee_id == user.id)
    return or_(PmProjectMilestone.id.in_(milestone_ids or [-1]), PmProjectMilestone.project_id.in_(managed),
               PmProjectMilestone.id.in_(with_my_tasks))


def _tasks_i_oversee(user):
    db = object_session(user)
    milestone_ids = _team_milestone_ids(db, user) if db is not None else []
    managed = select(PmProject.id).where(or_(PmProject.project_manager_id == user.id, PmProject.created_by_id == user.id))
    return or_(PmProjectTask.milestone_id.in_(milestone_ids or [-1]), PmProjectTask.project_id.in_(managed))


register_scoped(PmProject, "projects", owner=("project_manager_id", "created_by_id"),
                assigned=(_projects_i_work_on,), label="project")
register_scoped(PmProjectMilestone, "projects", entity_type=MILESTONE_ENTITY, owner=("lead_user_id", "submitted_by_id"),
                assigned=(_milestones_i_work_on,), label="milestone")
register_scoped(PmProjectTask, "projects", owner=("assignee_id", "created_by_id"),
                assigned=(_tasks_i_oversee,), label="task")


# ── Milestone acceptance ─────────────────────────────────────────────────

def acceptor_ids(db: Session, project: PmProject) -> list[int]:
    """Who accepted WBS elements before the engine (workflow.is_management +
    the project manager), minus admins (they use the admin stand-in)."""
    from app.modules.projects import workflow as wf

    out: list[int] = []
    if project.project_manager_id:
        pm = db.get(User, project.project_manager_id)
        if pm is not None and pm.is_active and not is_admin_user(pm):
            out.append(pm.id)
    for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all():
        if u.id in out or is_admin_user(u):
            continue
        if u.is_partner or u.is_director or holds_deliberately(u, wf.MANAGE_GRANT):
            out.append(u.id)
    return out


def submit_milestone(db: Session, project: PmProject, m: PmProjectMilestone, user: User) -> None:
    ids = acceptor_ids(db, project)
    if not ids:
        raise HTTPException(
            status_code=422,
            detail=f"Nobody can accept '{m.title}': {project.project_code} has no active project manager and no active user is a "
                   "Partner, a Director or holds Project Management › All Projects › Create. Set the project manager on the "
                   "project (or mark a Partner/Director in Organization) and submit again.",
        )
    engine.submit(
        db, MILESTONE_KEY, entity_id=m.id, requester=user,
        title=f"{project.project_code}: WBS '{m.title}'", reference=f"{project.project_code} · {m.title}"[:100],
        context={"acceptor_ids": ids, "project_manager_id": project.project_manager_id,
                 "department_id": m.department_id, "project_priority": project.priority},
    )


def _milestone_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.projects import workflow as wf

    m = db.get(PmProjectMilestone, req.entity_id)
    if m is None or m.status != "submitted":
        return
    project = db.get(PmProject, m.project_id)
    if project is not None and project.status not in ("planning", "active", "on_hold"):
        raise HTTPException(status_code=409, detail=f"{project.project_code} is {wf.PROJECT_STATUS_LABELS.get(project.status, project.status)} "
                                                    "— WBS elements can't be accepted or rejected any more.")
    steps = [s for s in req.steps if s.decided_by_id == actor.id and s.status in ("approved", "rejected", "returned")]
    comment = (max(steps, key=lambda s: s.id).comment or "").strip() if steps else ""
    who = wf.user_label(actor)
    code = project.project_code if project else ""
    if outcome == "approved":
        # The accept route may pass the actual date; otherwise the day the
        # department submitted (when the work was reported done).
        actual = getattr(m, "_accept_actual_date", None) or (m.submitted_at.date() if m.submitted_at else date.today())
        m.status, m.actual_date, m.achieved_by_id, m.achieved_at, m.return_reason = "achieved", actual, actor.id, wf.now(), None
        late = (actual - m.target_date).days
        wf.audit(db, m.project_id, actor, "milestone_achieved",
                 f"WBS '{m.title}' accepted by {who}; actual date {actual:%d-%m-%Y}" + (f" ({late} day(s) late)." if late > 0 else "."))
        wf.notify_department_heads(db, m, actor, "WBS accepted", f"{code}: '{m.title}' was accepted by {who}.", "pm_milestone_achieved")
        db.flush()
        if project is not None and project.status == "active":
            wf.notify_unlocked_successors(db, project, actor)
            wf.auto_complete(db, project, actor)
        return
    if outcome in ("rejected", "returned"):
        m.status, m.return_reason = "in_progress", comment or "Sent back without a reason."
        wf.audit(db, m.project_id, actor, "milestone_rejected", f"WBS '{m.title}' rejected by {who}. Reason: {m.return_reason}")
        wf.notify_department_heads(db, m, actor, "WBS rejected",
                                   f"{code}: '{m.title}' was sent back by {who}. Reason: {m.return_reason}", "pm_milestone_rejected")
        return
    # cancelled — the submitter withdrew it
    m.status = "in_progress"
    wf.audit(db, m.project_id, actor, "milestone_submission_withdrawn", f"Submission of WBS '{m.title}' withdrawn by {who}.")


def cancel_live(db: Session, milestone_id: int, user: User, reason: str) -> None:
    """Withdraw a WBS's open acceptance request when the WBS is
    cancelled / deleted. Left for the approvers if this user may not cancel it."""
    try:
        engine.cancel_for_entity(db, MILESTONE_ENTITY, milestone_id, user, reason)
    except HTTPException:
        pass


register_transaction(TransactionType(
    key=MILESTONE_KEY, module_key="projects", subtab_key="milestones", label="WBS acceptance",
    entity_type=MILESTONE_ENTITY, url="/dashboard/projects/milestones/{id}",
    description="A WBS the department submitted as done. Approved = Achieved (the next step in the chain unlocks); "
                "rejected / returned = back to In progress with the reason.",
    context_fields={
        "acceptor_ids": {"label": "Management (project manager, Partners, Directors, All Projects › Create holders)", "type": "user"},
        "project_manager_id": {"label": "Project manager", "type": "user"},
        "department_id": {"label": "Department id", "type": "number"},
        "project_priority": {"label": "Project priority", "type": "choice", "choices": ["standard", "urgent"],
                             "choice_labels": {"standard": "Standard", "urgent": "Urgent"}},
    },
    default_stages=[StageDef("Management acceptance", "record_field", {"field": "acceptor_ids"})],
    # The Milestones tab has no 'approve' action; the stage names the people.
    require_permission=False,
    # Before the engine a project manager / Director who also led the
    # milestone accepted their own submission; keep that possible.
    allow_self_approval=True,
    on_decided=_milestone_decided,
))
