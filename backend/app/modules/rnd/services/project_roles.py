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
