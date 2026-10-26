"""Milestones on an R&D requirement (a CRM Inquiry / Tender sent to R&D) — the
same plan as an R&D project: milestones on a timeline, each with one
responsible person (plus optional co-owners) and an expected achievable date;
the requirement's tasks are created inside a milestone.

A requirement has no table of its own, so milestones are addressed by
(source, record_id) like rnd_requirement_tasks.

Who does what (record rules — the role's features in core/features/rnd.py
apply on top, for R&D-side users):
  * the R&D head / admins add, edit, delete, reopen and cancel milestones;
  * the responsible people (and the head) mark a milestone achieved — only
    once every task in it is finished — and can add tasks to it;
  * delete only while no task was ever created in it, otherwise cancel.

Also serves the requirement's History tab: milestone / requirement changes
logged in audit_logs (entity_type "rnd_req_<source>") merged with task events.
"""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.audit import record_audit
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.requirement_milestone import (
    RND_MILESTONE_ICONS, RND_MILESTONE_OPEN, RND_MILESTONE_STATUS_LABELS, RndRequirementMilestone,
)
from app.modules.rnd.models.requirement_work import RndRequirementTask, RndTaskEvent
from app.modules.rnd.routes.project_milestones import TASK_VERBS
from app.modules.rnd.routes.requirement_work import _name, _notify, _record, _ref, _require_requirement_side
from app.modules.rnd.services import requirement_access as ra

RULE_KEY = "rnd:requirements.milestones"  # core/assignee_rules.PICKERS
router = APIRouter(
    prefix="/requirement-work", tags=["RnD Requirement Milestones"],
    dependencies=[Depends(_require_requirement_side)],
)

Source = Literal["inquiry", "tender"]
FINISHED = ("submitted", "closed")   # a task counts as done (rnd_requirement_tasks.status)


# ── helpers ───────────────────────────────────────────────────────────────

def _gate(db: Session, user: User, source: str, record_id: int, feature: str, action: str):
    """Requirement exists and was sent to R&D; the user may open it; R&D-side
    users also need the role's feature action (department-side users follow
    the record rules only, like the task routes). Returns (record, access)."""
    record = _record(db, source, record_id)
    access = ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", feature, action)
    return record, access


def _milestone(db: Session, source: str, record_id: int, record, milestone_id: int) -> RndRequirementMilestone:
    """Looked up by id AND requirement, so another requirement's milestone is a 404."""
    m = db.query(RndRequirementMilestone).filter(
        RndRequirementMilestone.id == milestone_id, RndRequirementMilestone.source == source,
        RndRequirementMilestone.record_id == record_id).first()
    if not m:
        raise HTTPException(status_code=404, detail=f"Milestone #{milestone_id} isn't on {_ref(source, record)} any more — refresh the page.")
    return m


def owner_ids(m: RndRequirementMilestone) -> list[int]:
    return list(dict.fromkeys([m.assignee_id, *(m.co_owner_ids or [])]))


def _audit(db: Session, source: str, record_id: int, user: User, action: str, summary: str) -> None:
    record_audit(db, entity_type=f"rnd_req_{source}", entity_id=record_id, action=action, module_key="rnd", summary=summary, user_id=user.id)


def _check_people(db: Session, user: User, source: str, record_id: int, assignee_id: int | None, co_ids: list[int] | None) -> tuple[int, list[int]]:
    if not assignee_id:
        raise HTTPException(status_code=422, detail="Pick the person responsible for the milestone.")
    working = ra.working_departments(db, source, record_id)
    clean: list[int] = []
    for uid in [assignee_id, *(co_ids or [])]:
        if uid in clean:
            continue
        u = db.query(User).filter(User.id == uid).first()
        if not u or not u.is_active:
            raise HTTPException(status_code=422, detail=f"User #{uid} doesn't exist or is deactivated — pick an active person.")
        works_here = any(
            ("rnd" in u.get_apps()) if d == ra.RND else ra.can_see_department(u, d)
            for d in working
        )
        if not works_here:
            raise HTTPException(status_code=422, detail=f"{_name(u)} doesn't work on this requirement — pick someone from R&D or a department it is shared with "
                                                        "(share it from the Milestones tab › Departments first).")
        assignee_rules.ensure_allowed(db, user, RULE_KEY, u)
        clean.append(uid)
    return clean[0], clean[1:]


def _check_dates(start: date | None, due: date | None) -> None:
    if not due:
        raise HTTPException(status_code=422, detail="Expected achievable date (End Date) is required.")
    if start and start > due:
        raise HTTPException(status_code=422, detail=f"Start date {start:%d %b %Y} is after the end date {due:%d %b %Y}.")


def _check_look(color: str | None, icon: str | None) -> None:
    if icon and icon not in RND_MILESTONE_ICONS:
        raise HTTPException(status_code=422, detail=f"Icon '{icon}' isn't one of the milestone icons — pick one from the Icons panel.")
    if color and (len(color) not in (4, 7, 9) or not color.startswith("#")):
        raise HTTPException(status_code=422, detail=f"Colour '{color}' isn't a valid colour — pick an icon, its colour is used.")


def _grant_access(db: Session, user: User, source: str, record_id: int, ids: list[int]) -> None:
    """A new R&D owner can open the requirement (View + Download), like a task assignee."""
    for u in db.query(User).filter(User.id.in_(ids)).all() if ids else []:
        if "rnd" in u.get_apps():
            ra.grant_task_access(db, source=source, record_id=record_id, user_id=u.id, granted_by=user)


def _tasks(db: Session, milestone_ids: list[int]) -> list[RndRequirementTask]:
    if not milestone_ids:
        return []
    return db.query(RndRequirementTask).filter(RndRequirementTask.milestone_id.in_(milestone_ids)).all()


def _open_names(tasks: list[RndRequirementTask]) -> str:
    return ", ".join(f"'{t.title}'" for t in tasks[:3]) + (f" and {len(tasks) - 3} more" if len(tasks) > 3 else "")


def serialize(db: Session, user: User, rows: list[RndRequirementMilestone], access: dict) -> list[dict]:
    tasks = _tasks(db, [m.id for m in rows])
    uids = {uid for m in rows for uid in owner_ids(m)} | {m.created_by_id for m in rows if m.created_by_id} | {m.completed_by_id for m in rows if m.completed_by_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    today = today_ist()
    head = bool(access.get("is_head"))
    can_view = bool(access.get("view"))
    out = []
    for m in rows:
        # Progress counts the milestone's top-level tasks (sub-tasks are part of their task).
        mine = [t for t in tasks if t.milestone_id == m.id and not t.parent_task_id and t.status != "cancelled"]
        ever = [t for t in tasks if t.milestone_id == m.id]
        owner = users.get(m.assignee_id)
        open_ = m.status in RND_MILESTONE_OPEN
        out.append({
            "id": m.id, "source": m.source, "record_id": m.record_id, "title": m.title, "description": m.description,
            "assignee_id": m.assignee_id, "assignee_name": _name(owner) if owner else None,
            "department_name": getattr(owner, "department", None) if owner else None,
            "co_owner_ids": list(m.co_owner_ids or []),
            "co_owner_names": [_name(users.get(i)) for i in (m.co_owner_ids or []) if users.get(i)],
            "start_date": m.start_date.isoformat() if m.start_date else None,
            "due_date": m.due_date.isoformat(),
            "status": m.status, "status_label": RND_MILESTONE_STATUS_LABELS.get(m.status, m.status),
            "blocker_reason": m.blocker_reason, "reopen_reason": m.reopen_reason, "cancel_reason": m.cancel_reason,
            "color": m.color, "icon": m.icon,
            "created_by_name": _name(users.get(m.created_by_id)) if m.created_by_id else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "completed_by_name": _name(users.get(m.completed_by_id)) if m.completed_by_id else None,
            "completed_at": m.completed_at.isoformat() if m.completed_at else None,
            "is_overdue": open_ and today > m.due_date,
            "tasks_total": len(mine),
            "tasks_done": sum(1 for t in mine if t.status in FINISHED),
            "tasks": [{"id": t.id, "title": t.title, "done": t.status in FINISHED} for t in sorted(mine, key=lambda t: (t.due_date, t.id))],
            "can_edit": head,
            "can_work": head or user.id in owner_ids(m),
            "can_plan": open_ and can_view,
            "can_delete": head and not ever,
        })
    return out


# ── milestones ────────────────────────────────────────────────────────────

class MilestoneIn(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    co_owner_ids: list[int] | None = None
    start_date: date | None = None
    due_date: date | None = None
    status: str | None = None          # todo | in_progress | blocked (Achieved / Cancelled use /status)
    blocker_reason: str | None = None
    color: str | None = None
    icon: str | None = None


class StatusIn(BaseModel):
    action: str                        # done | reopen | cancel
    reason: str | None = None


@router.get("/{source}/{record_id}/milestones")
async def list_milestones(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _, access = _gate(db, user, source, record_id, "milestones", "view")
    rows = db.query(RndRequirementMilestone).filter(
        RndRequirementMilestone.source == source, RndRequirementMilestone.record_id == record_id,
    ).order_by(RndRequirementMilestone.due_date, RndRequirementMilestone.id).all()
    # Cancelled milestones go last.
    rows.sort(key=lambda m: m.status == "cancelled")
    return serialize(db, user, rows, access)


@router.get("/{source}/{record_id}/milestone-people")
async def milestone_people(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who can be made responsible: R&D people and the people of the departments
    the requirement is shared with, narrowed by the role's 'Assign to' rule."""
    _gate(db, user, source, record_id, "milestones", "view")
    heads = set(ra.team_roles(db))
    seen: dict[int, dict] = {}
    for d in ra.working_departments(db, source, record_id):
        for u in ra.department_people(db, d):
            if u.id not in seen:
                seen[u.id] = {"id": u.id, "name": _name(u), "department": getattr(u, "department", None),
                              "designation": getattr(u, "designation", None), "team_role": "head" if u.id in heads else "member"}
    return assignee_rules.filter_people(db, user, RULE_KEY, list(seen.values()))


@router.post("/{source}/{record_id}/milestones")
async def create_milestone(source: Source, record_id: int, payload: MilestoneIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record, access = _gate(db, user, source, record_id, "milestones", "create")
    ra.ensure_head(db, user, "add milestones")
    ref = _ref(source, record)
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Milestone name is required.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Milestone name is {len(title)} characters — keep it under 200 and put details in Description.")
    _check_dates(payload.start_date, payload.due_date)
    assignee, co = _check_people(db, user, source, record_id, payload.assignee_id, payload.co_owner_ids)
    _check_look(payload.color, payload.icon)
    status = payload.status or "todo"
    if status not in ("todo", "in_progress", "blocked"):
        raise HTTPException(status_code=422, detail="A new milestone is Not Started, In Progress or On Hold — Achieved is set once its tasks are done.")
    blocker = (payload.blocker_reason or "").strip() or None
    if status == "blocked" and not blocker:
        raise HTTPException(status_code=422, detail="Say why the milestone is on hold.")
    m = RndRequirementMilestone(
        source=source, record_id=record_id, title=title, description=(payload.description or "").strip() or None,
        assignee_id=assignee, co_owner_ids=co, start_date=payload.start_date, due_date=payload.due_date,
        status=status, blocker_reason=blocker if status == "blocked" else None,
        color=payload.color, icon=payload.icon, created_by_id=user.id,
    )
    db.add(m)
    db.flush()
    _grant_access(db, user, source, record_id, [assignee, *co])
    _audit(db, source, record_id, user, "milestone_created",
           f"Milestone '{m.title}' added by {_name(user)} — responsible {_name(db.get(User, assignee))}, expected by {m.due_date:%d %b %Y}.")
    _notify(db, {assignee, *co} - {user.id}, source, record_id, title=f"Milestone on requirement {ref}",
            message=f"{_name(user)} made you responsible for '{m.title}', expected by {m.due_date:%d %b %Y}. Add its tasks on the requirement's Milestones tab.",
            notification_type="rnd_requirement_milestone_assigned")
    db.commit()
    db.refresh(m)
    return serialize(db, user, [m], access)[0]


@router.patch("/{source}/{record_id}/milestones/{milestone_id}")
async def edit_milestone(source: Source, record_id: int, milestone_id: int, payload: MilestoneIn,
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record, access = _gate(db, user, source, record_id, "milestones", "edit")
    ra.ensure_head(db, user, "edit milestones")
    ref = _ref(source, record)
    m = _milestone(db, source, record_id, record, milestone_id)
    data = payload.model_dump(exclude_unset=True)
    changes: list[str] = []

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Milestone name can't be empty.")
        if len(title) > 200:
            raise HTTPException(status_code=422, detail=f"Milestone name is {len(title)} characters — keep it under 200 and put details in Description.")
        if title != m.title:
            changes.append(f"name '{m.title}' → '{title}'")
            m.title = title
    if "description" in data:
        desc = (data["description"] or "").strip() or None
        if desc != m.description:
            changes.append("description updated")
            m.description = desc
    start = data["start_date"] if "start_date" in data else m.start_date
    due = data["due_date"] if "due_date" in data else m.due_date
    if start != m.start_date or due != m.due_date:
        _check_dates(start, due)
        late = [t for t in _tasks(db, [m.id]) if not t.parent_task_id and t.status == "open" and t.due_date > due]
        if late:
            names = ", ".join(f"'{t.title}' ({t.due_date:%d %b %Y})" for t in late[:3]) + (f" and {len(late) - 3} more" if len(late) > 3 else "")
            raise HTTPException(status_code=422, detail=f"Open task(s) in this milestone are due after {due:%d %b %Y}: {names}. Move those tasks earlier first, or pick a later end date.")
        if due != m.due_date:
            changes.append(f"end date {m.due_date:%d %b %Y} → {due:%d %b %Y}")
        if start != m.start_date:
            changes.append(f"start date {m.start_date:%d %b %Y} → {start:%d %b %Y}" if m.start_date and start else "start date changed")
        m.start_date, m.due_date = start, due
    old_owners = set(owner_ids(m))
    if "assignee_id" in data or "co_owner_ids" in data:
        assignee, co = _check_people(db, user, source, record_id, data.get("assignee_id", m.assignee_id),
                                     data["co_owner_ids"] if data.get("co_owner_ids") is not None else (m.co_owner_ids or []))
        if assignee != m.assignee_id:
            changes.append(f"responsible {_name(db.get(User, m.assignee_id))} → {_name(db.get(User, assignee))}")
        if co != list(m.co_owner_ids or []):
            changes.append("more responsible people changed")
        m.assignee_id, m.co_owner_ids = assignee, co
        _grant_access(db, user, source, record_id, sorted(set(owner_ids(m)) - old_owners))
    if "color" in data or "icon" in data:
        _check_look(data.get("color", m.color), data.get("icon", m.icon))
        m.color, m.icon = data.get("color", m.color), data.get("icon", m.icon)
    if data.get("status") and data["status"] != m.status:
        new = data["status"]
        if m.status not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — use Reopen on the milestone to change its status.")
        if new not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=422, detail="Achieved and Cancelled are set with the buttons on the milestone, not on the form.")
        blocker = (data.get("blocker_reason") or "").strip()
        if new == "blocked" and not blocker:
            raise HTTPException(status_code=422, detail="Say why the milestone is on hold.")
        changes.append(f"status {RND_MILESTONE_STATUS_LABELS[m.status]} → {RND_MILESTONE_STATUS_LABELS[new]}" + (f" ({blocker})" if new == "blocked" else ""))
        m.status, m.blocker_reason = new, blocker if new == "blocked" else None
    elif m.status == "blocked" and "blocker_reason" in data and (data["blocker_reason"] or "").strip() and data["blocker_reason"].strip() != m.blocker_reason:
        m.blocker_reason = data["blocker_reason"].strip()
        changes.append("on-hold reason updated")

    if changes:
        _audit(db, source, record_id, user, "milestone_updated", f"Milestone '{m.title}' edited by {_name(user)}: " + "; ".join(changes) + ".")
        added = set(owner_ids(m)) - old_owners
        _notify(db, added - {user.id}, source, record_id, title=f"Milestone on requirement {ref}",
                message=f"{_name(user)} made you responsible for '{m.title}', expected by {m.due_date:%d %b %Y}.",
                notification_type="rnd_requirement_milestone_assigned")
        _notify(db, set(owner_ids(m)) - added - {user.id}, source, record_id, title=f"Milestone changed ({ref})",
                message=f"{_name(user)} changed '{m.title}': " + "; ".join(changes) + ".",
                notification_type="rnd_requirement_milestone_edited")
    db.commit()
    db.refresh(m)
    return serialize(db, user, [m], access)[0]


@router.post("/{source}/{record_id}/milestones/{milestone_id}/status")
async def milestone_status(source: Source, record_id: int, milestone_id: int, payload: StatusIn,
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    action = payload.action
    if action not in ("done", "reopen", "cancel"):
        # Still require a readable requirement before revealing anything.
        _gate(db, user, source, record_id, "milestone_status", "view")
        raise HTTPException(status_code=422, detail="Action must be done, reopen or cancel.")
    feature_action = {"done": "approve", "reopen": "edit", "cancel": "cancel"}[action]
    record, access = _gate(db, user, source, record_id, "milestone_status", feature_action)
    ref = _ref(source, record)
    m = _milestone(db, source, record_id, record, milestone_id)
    reason = (payload.reason or "").strip()
    head = bool(access.get("is_head"))
    if action == "done":
        if not (head or user.id in owner_ids(m)):
            raise HTTPException(status_code=403, detail=f"Only the people responsible for '{m.title}' (or the R&D head) can mark it achieved.")
        if m.status not in RND_MILESTONE_OPEN:
            raise HTTPException(status_code=409, detail=f"'{m.title}' is already {RND_MILESTONE_STATUS_LABELS[m.status]}.")
        open_tasks = [t for t in _tasks(db, [m.id]) if t.status == "open"]
        if open_tasks:
            raise HTTPException(status_code=409, detail=f"{len(open_tasks)} task(s) in '{m.title}' are still open: {_open_names(open_tasks)}. Each must be completed (or cancelled) before the milestone is achieved.")
        m.status, m.completed_at, m.completed_by_id, m.blocker_reason = "done", datetime.now(timezone.utc), user.id, None
        late = (today_ist() - m.due_date).days
        _audit(db, source, record_id, user, "milestone_achieved",
               f"Milestone '{m.title}' marked achieved by {_name(user)}" + (f" — {late} day(s) after its expected date." if late > 0 else "."))
        _notify(db, {*owner_ids(m), *ra.head_ids(db)} - {user.id}, source, record_id, title=f"Milestone achieved ({ref})",
                message=f"{_name(user)} marked '{m.title}' achieved.", notification_type="rnd_requirement_milestone_achieved")
    else:
        ra.ensure_head(db, user, f"{action} milestones")
        if not reason:
            raise HTTPException(status_code=422, detail=f"Say why '{m.title}' is being {'reopened' if action == 'reopen' else 'cancelled'}.")
        if action == "reopen":
            if m.status != "done":
                raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — only an achieved milestone can be reopened.")
            m.status, m.reopen_reason, m.completed_at, m.completed_by_id = "in_progress", reason, None, None
        else:
            if m.status not in RND_MILESTONE_OPEN:
                raise HTTPException(status_code=409, detail=f"'{m.title}' is {RND_MILESTONE_STATUS_LABELS[m.status]} — only an open milestone can be cancelled.")
            open_tasks = [t for t in _tasks(db, [m.id]) if t.status == "open"]
            if open_tasks:
                raise HTTPException(status_code=409, detail=f"'{m.title}' still has {len(open_tasks)} open task(s): {_open_names(open_tasks)}. Cancel those tasks first (each keeps its own reason and history), then cancel the milestone.")
            m.status, m.cancel_reason = "cancelled", reason
        word = "reopened" if action == "reopen" else "cancelled"
        _audit(db, source, record_id, user, f"milestone_{action}", f"Milestone '{m.title}' {word} by {_name(user)}. Reason: {reason}")
        _notify(db, set(owner_ids(m)) - {user.id}, source, record_id, title=f"Milestone {word} ({ref})",
                message=f"{_name(user)} {word} '{m.title}'. Reason: {reason}", notification_type="rnd_requirement_milestone_edited")
    db.commit()
    db.refresh(m)
    return serialize(db, user, [m], access)[0]


@router.delete("/{source}/{record_id}/milestones/{milestone_id}")
async def delete_milestone(source: Source, record_id: int, milestone_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record, _ = _gate(db, user, source, record_id, "milestones", "delete")
    ra.ensure_head(db, user, "delete milestones")
    m = _milestone(db, source, record_id, record, milestone_id)
    if _tasks(db, [m.id]):
        raise HTTPException(status_code=409, detail=f"'{m.title}' already has tasks (even cancelled ones count), so it can't be deleted. Use Cancel milestone instead — its record is kept.")
    title = m.title
    _audit(db, source, record_id, user, "milestone_deleted", f"Milestone '{title}' (expected by {m.due_date:%d %b %Y}) deleted by {_name(user)}.")
    db.delete(m)
    db.commit()
    return {"message": f"Milestone '{title}' deleted."}


# ── history ───────────────────────────────────────────────────────────────

@router.get("/{source}/{record_id}/history")
async def requirement_history(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Everything that happened on the requirement's R&D side, newest first:
    milestone and requirement changes (audit log) and every task event."""
    _record(db, source, record_id)
    access = ra.ensure(db, user, source, record_id, "view")
    if not ra.is_rnd_side(user):
        raise HTTPException(status_code=403, detail="History is on R&D's requirement page. Ask the R&D head to give you access to R&D › Requirements if you need it.")
    ensure_feature_action(user, "rnd", "requirements", "history", "view")
    logs = db.query(AuditLog).filter(AuditLog.entity_type == f"rnd_req_{source}", AuditLog.entity_id == record_id).order_by(AuditLog.id.desc()).limit(500).all()
    if not access.get("is_head"):
        logs = [lg for lg in logs if not (lg.action or "").startswith("access_")]
    tasks = {t.id: t for t in db.query(RndRequirementTask).filter(RndRequirementTask.source == source, RndRequirementTask.record_id == record_id).all()}
    events = db.query(RndTaskEvent).filter(RndTaskEvent.task_id.in_(list(tasks))).order_by(RndTaskEvent.id.desc()).limit(500).all() if tasks else []
    uids = {lg.performed_by_id for lg in logs if lg.performed_by_id} | {e.user_id for e in events if e.user_id} | {t.assigned_to_id for t in tasks.values()}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    rows = [{
        "id": f"a{lg.id}", "kind": "milestone" if (lg.action or "").startswith("milestone") else "requirement",
        "action": lg.action, "summary": lg.summary or lg.action,
        "performed_by": _name(users.get(lg.performed_by_id)) if lg.performed_by_id else "System",
        "performed_at": lg.performed_at.isoformat() if lg.performed_at else None,
    } for lg in logs]
    for e in events:
        t = tasks[e.task_id]
        what = "sub-task" if t.parent_task_id else "task"
        verb = TASK_VERBS.get(e.action, e.action)
        text = f"{_name(users.get(e.user_id))} {verb} {what} '{t.title}'"
        if e.action == "created":
            text += f" to {_name(users.get(t.assigned_to_id))}"
        if e.new_due_date and e.action in ("created", "extended", "edited", "reopened"):
            text += f" — due {e.new_due_date:%d %b %Y}"
        if e.remarks:
            text += f". {e.remarks}"
        rows.append({
            "id": f"t{e.id}", "kind": "task", "action": e.action, "summary": text,
            "performed_by": _name(users.get(e.user_id)) if e.user_id else "System",
            "performed_at": e.created_at.isoformat() if e.created_at else None,
        })
    rows.sort(key=lambda r: r["performed_at"] or "", reverse=True)
    return rows
