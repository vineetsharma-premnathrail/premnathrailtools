"""Management side of WBS elements: set them per department, move dates (with
a reason — the original date is kept), accept or reject what departments
submit, and cancel WBS elements no longer needed."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import ensure_can_delete, ensure_tab_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.milestone import PM_START_RULES, PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PM_TASK_OPEN_STATUSES
from app.modules.projects.schemas.milestone import (
    PmMilestoneAcceptPayload, PmMilestoneCreate, PmMilestoneMovePayload, PmMilestoneUpdate, PmProjectMilestoneResponse,
    PmReasonPayload,
)
from app.modules.projects import views, workflow as wf
from app.modules.projects import access as pm_access
from app.modules.organization.services import approval_engine as engine
from app.core.data_scope import apply_scope, ensure_in_scope

router = APIRouter(
    prefix="/projects/{project_id}/milestones", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _project_or_404(db: Session, project_id: int, user: User | None = None) -> PmProject:
    project = db.get(PmProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    if user is not None:
        ensure_in_scope(db, user, project)
    return project


def _ensure_milestone_action(project: PmProject, user: User, action: str) -> None:
    """Adding / editing / deleting WBS needs the Milestones grant in the
    Permission Matrix — the project's own manager too (decided 2026-10-16:
    being the manager is not a permission)."""
    ensure_tab_action(user, "projects", "milestones", action)


def _milestone_or_404(db: Session, project_id: int, milestone_id: int) -> PmProjectMilestone:
    m = db.get(PmProjectMilestone, milestone_id)
    if not m or m.project_id != project_id:
        raise HTTPException(status_code=404, detail=f"WBS #{milestone_id} not found on this project — refresh the page.")
    return m


def _require_editable_project(project: PmProject) -> None:
    if project.status not in ("planning", "active", "on_hold"):
        raise HTTPException(status_code=409, detail=f"Project {project.project_code} is {wf.PROJECT_STATUS_LABELS[project.status]}; its WBS elements can no longer change.")


def _check_department(db: Session, department_id: int) -> Department:
    dept = db.get(Department, department_id)
    if not dept:
        raise HTTPException(status_code=404, detail=f"Department #{department_id} not found")
    return dept


def _check_team(db: Session, lead_id: int | None, assistant_ids: list[int] | None) -> tuple[int, list[int]]:
    """Lead is required; assistants are de-duplicated and never include the lead."""
    if not lead_id:
        raise HTTPException(status_code=422, detail="Pick the WBS lead — the person who represents the department on this WBS and plans its tasks.")
    clean: list[int] = []
    for uid in [lead_id, *(assistant_ids or [])]:
        if uid in clean:
            continue
        u = db.get(User, uid)
        if not u or not u.is_active:
            raise HTTPException(status_code=422, detail=f"User #{uid} doesn't exist or is deactivated. Pick an active person for the WBS team.")
        clean.append(uid)
    return clean[0], clean[1:]


def _people_with_open_tasks(db: Session, m: PmProjectMilestone, removed: set[int]) -> list[str]:
    if not removed:
        return []
    rows = db.query(PmProjectTask).filter(
        PmProjectTask.milestone_id == m.id, PmProjectTask.assignee_id.in_(removed), PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES),
    ).all()
    return sorted({wf.name_of(db, t.assignee_id) or "?" for t in rows})


def _check_date(project: PmProject, target: date) -> None:
    if project.start_date and target < project.start_date:
        raise HTTPException(status_code=422, detail=f"Target date {target:%d-%m-%Y} is before the project start {project.start_date:%d-%m-%Y}.")
    if project.target_handover_date and target > project.target_handover_date:
        raise HTTPException(status_code=422, detail=f"Target date {target:%d-%m-%Y} is after the project's handover date {project.target_handover_date:%d-%m-%Y}. Pick an earlier date, or move the handover date first.")


def _check_start_rule(rule: str | None, depends_on_id: int | None) -> str:
    rule = rule or "after_previous"
    if rule not in PM_START_RULES:
        raise HTTPException(status_code=422, detail=f"Start rule '{rule}' isn't valid — use one of: {', '.join(PM_START_RULES.values())}.")
    if rule in ("after_step_done", "after_step_started") and not depends_on_id:
        raise HTTPException(status_code=422, detail=f"'{PM_START_RULES[rule]}' needs the step it waits for — pick that step.")
    return rule


def _check_dependency(db: Session, project_id: int, milestone_id: int | None, depends_on_id: int | None) -> None:
    if not depends_on_id:
        return
    if depends_on_id == milestone_id:
        raise HTTPException(status_code=422, detail="A WBS can't depend on itself.")
    seen = set()
    cur = db.get(PmProjectMilestone, depends_on_id)
    if not cur or cur.project_id != project_id:
        raise HTTPException(status_code=422, detail="The WBS it depends on must be on the same project.")
    while cur and cur.id not in seen:
        if milestone_id and cur.id == milestone_id:
            raise HTTPException(status_code=422, detail="That dependency would make a loop (A waits for B which waits for A). Pick a different WBS.")
        seen.add(cur.id)
        cur = db.get(PmProjectMilestone, cur.depends_on_milestone_id) if cur.depends_on_milestone_id else None



DELIVERABLE_MIN_CHARS = 10


def _check_deliverable(text: str | None) -> None:
    """A one-word deliverable ("ok") can't be checked at acceptance."""
    if len((text or "").strip()) < DELIVERABLE_MIN_CHARS:
        raise HTTPException(status_code=422, detail=f"Describe the deliverable in at least {DELIVERABLE_MIN_CHARS} characters — what is handed over and how it is judged done (e.g. 'Signed GA drawing + BOM').")

@router.get("", response_model=list[PmProjectMilestoneResponse])
async def list_milestones(project_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("projects", "milestones"))):
    _project_or_404(db, project_id, _user)
    cache = views.names(db)
    rows = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id).order_by(PmProjectMilestone.sequence, PmProjectMilestone.id).all()
    return [views.milestone_response(db, m, cache) for m in rows]


@router.post("", response_model=PmProjectMilestoneResponse)
async def create_milestone(project_id: int, payload: PmMilestoneCreate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "create")
    wf.require_manage(project, user, "add WBS elements")
    _require_editable_project(project)
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="WBS name is required.")
    if not (payload.deliverable or "").strip():
        raise HTTPException(status_code=422, detail="Deliverable / completion criteria is required — it's how everyone agrees the WBS is done.")
    _check_deliverable(payload.deliverable)
    dept = _check_department(db, payload.department_id)
    lead_id, assistants = _check_team(db, payload.lead_user_id, payload.assistant_user_ids)
    _check_date(project, payload.target_date)
    start_rule = _check_start_rule(payload.start_rule, payload.depends_on_milestone_id)
    depends_on = payload.depends_on_milestone_id if start_rule in ("after_step_done", "after_step_started") else None
    _check_dependency(db, project_id, None, depends_on)
    last = db.query(func.max(PmProjectMilestone.sequence)).filter(PmProjectMilestone.project_id == project_id).scalar() or 0
    m = PmProjectMilestone(
        project_id=project_id, department_id=dept.id, title=payload.title.strip(), deliverable=payload.deliverable.strip(),
        target_date=payload.target_date, depends_on_milestone_id=depends_on, start_rule=start_rule, status="not_started",
        sequence=last + 1, lead_user_id=lead_id, assistant_user_ids=assistants,
    )
    db.add(m)
    db.flush()
    wf.audit(db, project_id, user, "milestone_created",
             f"Step {m.sequence} '{m.title}' for {dept.name} (lead {wf.name_of(db, lead_id)}), due {m.target_date:%d-%m-%Y}, added by {wf.user_label(user)}.")
    if project.status == "planning":
        # No Release button: the first WBS releases the project, and every
        # WBS goes to its department the moment it is added.
        project.status, project.released_by_id, project.released_at = "active", user.id, wf.now()
        wf.audit(db, project_id, user, "status_changed",
                 f"Project released automatically when its first WBS '{m.title}' was added by {wf.user_label(user)}.",
                 subtab_key="overview", field_name="status", old_value="planning", new_value="active")
    if project.status == "active":
        wf.notify_department_heads(db, m, user, "New WBS for your department",
                                   f"{project.project_code} {project.name}: step {m.sequence} '{m.title}' is due {m.target_date:%d-%m-%Y}. You are on it — plan its tasks.",
                                   "pm_milestone_assigned")
        wf.notify_many(db, assistants, user, "You are on a project WBS",
                       f"{project.project_code} {project.name}: you are an assistant on '{m.title}' (due {m.target_date:%d-%m-%Y}).",
                       "pm_milestone_assigned", "pm_milestone", m.id)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.patch("/{milestone_id}", response_model=PmProjectMilestoneResponse)
async def update_milestone(project_id: int, milestone_id: int, payload: PmMilestoneUpdate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "edit")
    m = _milestone_or_404(db, project_id, milestone_id)
    wf.require_manage(project, user, "edit WBS elements")
    _require_editable_project(project)
    if m.status in ("achieved", "cancelled"):
        raise HTTPException(status_code=409, detail=f"'{m.title}' is {wf.MILESTONE_STATUS_LABELS[m.status]} and can't be edited.")
    updates = payload.model_dump(exclude_unset=True)
    reason = (updates.pop("date_change_reason", None) or "").strip() or None
    tasks = wf.milestone_tasks(db, m.id)

    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=422, detail="WBS name can't be empty.")
    if "deliverable" in updates and not (updates["deliverable"] or "").strip():
        raise HTTPException(status_code=422, detail="Deliverable / completion criteria can't be empty.")
    if "deliverable" in updates:
        _check_deliverable(updates["deliverable"])
    if "department_id" in updates and updates["department_id"] != m.department_id:
        if wf.live_tasks(tasks):
            raise HTTPException(status_code=409, detail="This WBS already has tasks in its department. Cancel it and add a new WBS for the other department instead.")
        _check_department(db, updates["department_id"])
    if "start_rule" in updates or "depends_on_milestone_id" in updates:
        rule = _check_start_rule(updates.get("start_rule", m.start_rule), updates.get("depends_on_milestone_id", m.depends_on_milestone_id))
        if m.status != "not_started" and rule != m.start_rule:
            raise HTTPException(status_code=409, detail=f"'{m.title}' has already started, so its start rule no longer matters and can't be changed.")
        updates["start_rule"] = rule
        updates["depends_on_milestone_id"] = updates.get("depends_on_milestone_id", m.depends_on_milestone_id) if rule in ("after_step_done", "after_step_started") else None
        _check_dependency(db, project_id, m.id, updates["depends_on_milestone_id"])
    old_team = set(wf.team_ids(m))
    if "lead_user_id" in updates or "assistant_user_ids" in updates:
        lead_id, assistants = _check_team(
            db, updates.get("lead_user_id", m.lead_user_id),
            updates["assistant_user_ids"] if updates.get("assistant_user_ids") is not None else wf.assistant_ids(m),
        )
        stuck = _people_with_open_tasks(db, m, old_team - {lead_id, *assistants})
        if stuck:
            raise HTTPException(status_code=409, detail=f"{', '.join(stuck)} still have open tasks on '{m.title}'. Reassign or cancel those tasks before taking them off the team.")
        updates["lead_user_id"], updates["assistant_user_ids"] = lead_id, assistants

    new_target = updates.get("target_date")
    date_moved = new_target is not None and new_target != m.target_date
    if date_moved:
        _check_date(project, new_target)
        if project.status != "planning" and not reason:
            raise HTTPException(status_code=422, detail="Give a reason for moving the target date — the department committed to the old date, and the reason is kept in History.")
        late = [t.title for t in tasks if t.status in PM_TASK_OPEN_STATUSES and t.due_date and t.due_date > new_target]
        if late:
            raise HTTPException(status_code=422, detail=f"These tasks are due after {new_target:%d-%m-%Y}: {', '.join(late[:5])}. Ask the department head to move them first.")

    old_target = m.target_date
    added = {updates.get("lead_user_id", m.lead_user_id), *updates.get("assistant_user_ids", wf.assistant_ids(m))} - old_team - {None}
    for field, val in updates.items():
        old_val = getattr(m, field)
        if old_val != val and field != "target_date":
            wf.audit(db, project_id, user, "milestone_updated", f"WBS '{m.title}': {field.replace('_', ' ')} changed by {wf.user_label(user)}.",
                     field_name=field, old_value=str(old_val) if old_val is not None else None, new_value=str(val) if val is not None else None)
        setattr(m, field, val)
    if date_moved:
        if project.status != "planning" and m.original_target_date is None:
            m.original_target_date = old_target
        wf.audit(db, project_id, user, "milestone_date_changed",
                 f"WBS '{m.title}' moved {old_target:%d-%m-%Y} → {new_target:%d-%m-%Y} by {wf.user_label(user)}." + (f" Reason: {reason}" if reason else ""),
                 field_name="target_date", old_value=str(old_target), new_value=str(new_target))
        if project.status in ("active", "on_hold"):
            wf.notify_department_heads(db, m, user, "WBS date changed",
                                       f"{project.project_code}: '{m.title}' is now due {new_target:%d-%m-%Y} (was {old_target:%d-%m-%Y}). Reason: {reason}",
                                       "pm_milestone_date_changed")
    if added and project.status in ("active", "on_hold"):
        wf.notify_many(db, added, user, "You are on a project WBS",
                       f"{project.project_code} {project.name}: {wf.user_label(user)} added you to '{m.title}' (due {m.target_date:%d-%m-%Y}).",
                       "pm_milestone_assigned", "pm_milestone", m.id)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.delete("/{milestone_id}")
async def delete_milestone(project_id: int, milestone_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):
    project = _project_or_404(db, project_id, user)
    m = _milestone_or_404(db, project_id, milestone_id)
    # Milestones have no creator column, so this checks Milestones › Delete
    # (the project's own manager is exempt); require_manage below still
    # limits it to management / the PM.
    if project.project_manager_id != user.id:
        ensure_can_delete(user, m, "projects", "milestones", what="milestone")
    wf.require_manage(project, user, "delete WBS elements")
    if m.status != "not_started" or db.query(PmProjectTask.id).filter(PmProjectTask.milestone_id == m.id).first():
        raise HTTPException(status_code=409, detail=f"'{m.title}' already has work recorded against it. Cancel it with a reason instead, so its history is kept.")
    # Like deleting a linked task in MS Project: WBS elements that waited for
    # this one fall back to the default rule (after all steps above). Safe —
    # a deletable WBS has no work, so nothing that waited for it had started.
    waiting = db.query(PmProjectMilestone).filter(PmProjectMilestone.depends_on_milestone_id == m.id).all()
    for w in waiting:
        w.start_rule, w.depends_on_milestone_id = "after_previous", None
        wf.audit(db, project_id, user, "milestone_updated",
                 f"WBS '{w.title}' waited for '{m.title}', which was deleted — it now starts after all steps above are achieved.")
    wf.audit(db, project_id, user, "milestone_deleted", f"WBS '{m.title}' deleted by {wf.user_label(user)}.")
    db.delete(m)
    db.commit()
    if waiting:
        names = ", ".join(f"'{w.title}'" for w in waiting)
        return {"message": f"WBS deleted. {names} waited for it and now start{'s' if len(waiting) == 1 else ''} after all steps above are achieved — change that on the WBS tab if needed."}
    return {"message": "WBS deleted"}


@router.post("/{milestone_id}/move", response_model=list[PmProjectMilestoneResponse])
async def move_milestone(project_id: int, milestone_id: int, payload: PmMilestoneMovePayload, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_access("projects", "milestones"))):
    """Swap a step with its neighbour in the chain. Only steps nobody has
    started can move — the order of finished work is history."""
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "edit")
    m = _milestone_or_404(db, project_id, milestone_id)
    wf.require_manage(project, user, "reorder WBS elements")
    _require_editable_project(project)
    if payload.direction not in ("up", "down"):
        raise HTTPException(status_code=422, detail="Direction must be 'up' or 'down'.")
    rows = db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id).order_by(PmProjectMilestone.sequence, PmProjectMilestone.id).all()
    # Normalise to 1..n first so swaps are always clean.
    for i, r in enumerate(rows, start=1):
        r.sequence = i
    idx = rows.index(m)
    j = idx - 1 if payload.direction == "up" else idx + 1
    if j < 0 or j >= len(rows):
        raise HTTPException(status_code=409, detail=f"'{m.title}' is already the {'first' if j < 0 else 'last'} step.")
    other = rows[j]
    for x in (m, other):
        if x.status != "not_started" or db.query(PmProjectTask.id).filter(PmProjectTask.milestone_id == x.id, PmProjectTask.started_at.isnot(None)).first():
            raise HTTPException(status_code=409, detail=f"'{x.title}' is {wf.MILESTONE_STATUS_LABELS[x.status]} or has started tasks, so the order around it can't change.")
    m.sequence, other.sequence = other.sequence, m.sequence
    wf.audit(db, project_id, user, "milestone_reordered", f"'{m.title}' moved {payload.direction} to step {m.sequence} by {wf.user_label(user)}.")
    db.commit()
    cache = views.names(db)
    rows.sort(key=lambda r: r.sequence)
    return [views.milestone_response(db, r, cache) for r in rows]


@router.post("/{milestone_id}/accept", response_model=PmProjectMilestoneResponse)
async def accept_milestone(project_id: int, milestone_id: int, payload: PmMilestoneAcceptPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):  # registry has no approve on Milestones
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "edit")
    m = _milestone_or_404(db, project_id, milestone_id)
    _require_editable_project(project)
    if m.status != "submitted":
        raise HTTPException(status_code=409, detail=f"'{m.title}' is {wf.MILESTONE_STATUS_LABELS[m.status]}. Only a WBS the department has submitted can be accepted.")
    actual = payload.actual_date or date.today()
    if actual > date.today():
        raise HTTPException(status_code=422, detail="The actual date can't be in the future.")
    req = engine.latest_request(db, pm_access.MILESTONE_ENTITY, m.id)
    if req is not None:
        # Central approval engine (Organization › Approval Workflows ›
        # Milestone acceptance) decides who may accept; on_decided sets Achieved.
        if req.status != "pending":
            raise HTTPException(status_code=409, detail=f"The acceptance of '{m.title}' is already {req.status} — refresh the page.")
        m._accept_actual_date = actual
        engine.decide(db, req.id, user, "approve", f"Accepted — actual date {actual:%d-%m-%Y}.")
        db.commit()
        db.refresh(m)
        return views.milestone_response(db, m)
    # In-flight milestone submitted before the engine: the old management check.
    wf.require_manage(project, user, "accept WBS elements")
    m.status, m.actual_date, m.achieved_by_id, m.achieved_at, m.return_reason = "achieved", actual, user.id, wf.now(), None
    late = (actual - m.target_date).days
    wf.audit(db, project_id, user, "milestone_achieved",
             f"WBS '{m.title}' accepted by {wf.user_label(user)}; actual date {actual:%d-%m-%Y}" + (f" ({late} day(s) late)." if late > 0 else "."))
    wf.notify_department_heads(db, m, user, "WBS accepted",
                               f"{project.project_code}: '{m.title}' was accepted by {wf.user_label(user)}.", "pm_milestone_achieved")
    db.flush()
    if project.status == "active":
        wf.notify_unlocked_successors(db, project, user)
        wf.auto_complete(db, project, user)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.post("/{milestone_id}/reject", response_model=PmProjectMilestoneResponse)
async def reject_milestone(project_id: int, milestone_id: int, payload: PmReasonPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):  # registry has no reject on Milestones
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "edit")
    m = _milestone_or_404(db, project_id, milestone_id)
    _require_editable_project(project)
    if m.status != "submitted":
        raise HTTPException(status_code=409, detail=f"'{m.title}' is {wf.MILESTONE_STATUS_LABELS[m.status]}; only a submitted WBS can be rejected.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what is missing or wrong, so the department knows what to fix.")
    req = engine.latest_request(db, pm_access.MILESTONE_ENTITY, m.id)
    if req is not None:
        if req.status != "pending":
            raise HTTPException(status_code=409, detail=f"The acceptance of '{m.title}' is already {req.status} — refresh the page.")
        engine.decide(db, req.id, user, "reject", reason)
        db.commit()
        db.refresh(m)
        return views.milestone_response(db, m)
    wf.require_manage(project, user, "reject WBS elements")
    m.status, m.return_reason = "in_progress", reason
    wf.audit(db, project_id, user, "milestone_rejected", f"WBS '{m.title}' rejected by {wf.user_label(user)}. Reason: {reason}")
    wf.notify_department_heads(db, m, user, "WBS rejected",
                               f"{project.project_code}: '{m.title}' was sent back by {wf.user_label(user)}. Reason: {reason}", "pm_milestone_rejected")
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)


@router.post("/{milestone_id}/cancel", response_model=PmProjectMilestoneResponse)
async def cancel_milestone(project_id: int, milestone_id: int, payload: PmReasonPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_access("projects", "milestones"))):
    project = _project_or_404(db, project_id, user)
    _ensure_milestone_action(project, user, "edit")
    m = _milestone_or_404(db, project_id, milestone_id)
    wf.require_manage(project, user, "cancel WBS elements")
    _require_editable_project(project)
    if m.status in ("achieved", "cancelled"):
        raise HTTPException(status_code=409, detail=f"'{m.title}' is already {wf.MILESTONE_STATUS_LABELS[m.status]}.")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Give a reason for cancelling the WBS.")
    waiting = db.query(PmProjectMilestone).filter(PmProjectMilestone.depends_on_milestone_id == m.id, PmProjectMilestone.status != "cancelled").all()
    if waiting:
        names = ", ".join(f"'{w.title}'" for w in waiting)
        raise HTTPException(status_code=409, detail=(
            f"{names} {'waits' if len(waiting) == 1 else 'wait'} for '{m.title}', so it can't be cancelled yet. "
            f"On the WBS tab, Edit {'that WBS' if len(waiting) == 1 else 'each of them'} and change 'Starts' to another step "
            "(or 'After all steps above'), then cancel this one."))
    m.status, m.cancel_reason = "cancelled", reason
    pm_access.cancel_live(db, m.id, user, f"WBS cancelled: {reason}")
    assignees = []
    for t in wf.milestone_tasks(db, m.id):
        if t.status in PM_TASK_OPEN_STATUSES:
            t.cancel_reason = f"WBS cancelled: {reason}"
            wf.set_task_status(db, t, user, "cancelled", t.cancel_reason)
            assignees.append(t.assignee_id)
    wf.audit(db, project_id, user, "milestone_cancelled", f"WBS '{m.title}' cancelled by {wf.user_label(user)}. Reason: {reason}")
    msg = f"{project.project_code}: WBS '{m.title}' was cancelled by {wf.user_label(user)}. Reason: {reason}"
    wf.notify_department_heads(db, m, user, "WBS cancelled", msg, "pm_milestone_cancelled")
    wf.notify_many(db, assignees, user, "Task cancelled", msg, "pm_task_cancelled", "pm_milestone", m.id)
    db.flush()
    if project.status == "active":
        wf.notify_unlocked_successors(db, project, user)
        wf.auto_complete(db, project, user)
    db.commit()
    db.refresh(m)
    return views.milestone_response(db, m)
