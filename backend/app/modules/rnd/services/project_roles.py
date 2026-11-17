"""Who is who on an R&D project: leads (lead_ids, falling back to the old
single lead_id) and team members (team_member_ids). Leads hand out tasks and
are the only ones — with admins — who may delete a project's files."""
from __future__ import annotations

from app.core.permission_registry import is_admin_user
from app.modules.rnd.models.project import RndProject


def lead_ids(project: RndProject) -> list[int]:
    ids = list(project.lead_ids or [])
    return ids or ([project.lead_id] if project.lead_id else [])


def member_ids(project: RndProject) -> list[int]:
    return list(project.team_member_ids or [])


def is_lead(user, project: RndProject) -> bool:
    return user.id in lead_ids(project)


def can_manage(user, project: RndProject) -> bool:
    """Leads and admins manage tasks and files on the project."""
    return is_admin_user(user) or is_lead(user, project)


def ticks_task_create(user) -> bool:
    """The role tick that lets a person give tasks: Prototype / Research ›
    Project tasks › Create, or R&D Tasks › Create (the board's Create Task)."""
    from app.core.permission_registry import can_feature, can_perform

    return can_feature(user, "rnd", "projects", "tasks", "create") or can_perform(user, "rnd", "tasks", "create")


def can_give_tasks(db, user, project: RndProject) -> bool:
    """Who may hand out top-level tasks on a Prototype / Research project
    (owner decision 2026-11-14, "the tick decides"): its leads and admins as
    before, PLUS anyone whose role ticks a task Create AND who has the project
    inside their R&D Edit scope (Role › Data access › Edit; default own +
    assigned = creator, lead, team member)."""
    if can_manage(user, project):
        return True
    if not ticks_task_create(user):
        return False
    from app.core.data_scope import can_change

    return can_change(db, user, project)
