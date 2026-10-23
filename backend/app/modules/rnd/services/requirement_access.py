"""Who may do what on an R&D requirement (a CRM Inquiry / Tender sent to R&D).

* R&D head(s) — the heads of the R&D department in Organization › Department
  — and portal admins can do everything on every requirement: see it,
  open/download its documents, upload documents, respond to CRM, set access
  and hand out tasks. Until an R&D department head is set, every R&D user
  acts as head, so the module keeps working.
* R&D › Settings lists who may create Technical Offers (they open every
  requirement) and who may only see every requirement and its offers.
* Everyone else sees a requirement only when the head granted them access on
  it (rnd_requirement_access), with each right ticked separately. Assigning a
  task grants View + Download automatically, so the assignee can work on it.

* Departments the head shared the requirement with (Design / Electrical /
  Hydraulic & Pneumatic, Permission Matrix `<department>:requirements` view)
  work on it with R&D: they see it, every department's tasks, its documents
  and the discussion, and upload documents. Anyone who can open the
  requirement can give a task to a person in R&D or any shared department;
  the assignee's department head is told.

Every check raises a 403 that says what is missing and who can grant it.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_view_tab
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement_work import (
    RND_SHARE_DEPARTMENTS, RndRequirementAccess, RndRequirementShare, RndRequirementTask, RndTeamMember,
)

PERMS = ("view", "download", "upload", "respond")
RND = "rnd"
TAB = "requirements"
SIDE_LABELS = {"rnd": "R&D", "design": "Design", "electrical": "Electrical", "hydraulic": "Hydraulic & Pneumatic"}
PERM_LABELS = {
    "view": "view this requirement",
    "download": "open or download this requirement's documents",
    "upload": "upload documents to this requirement",
    "respond": "respond to CRM on this requirement",
}


_RND_DEPT_NAMES = {"r&d", "rnd", "r & d", "r and d", "research", "research & development", "research and development"}


def _is_rnd_department(name: str | None) -> bool:
    n = " ".join((name or "").lower().split())
    return n in _RND_DEPT_NAMES or n.startswith(("r&d ", "r & d ", "research "))


def org_head_ids(db: Session) -> set[int]:
    """Active heads of the R&D department(s) in Organization › Department."""
    from app.modules.organization.models.department import Department  # local: keeps rnd ↔ organization imports one-way
    ids: set[int] = set()
    for d in db.query(Department).all():
        if _is_rnd_department(d.name):
            ids |= {d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])}
    ids.discard(None)
    if not ids:
        return set()
    return {u.id for u in db.query(User).filter(User.id.in_(ids), User.is_active == True).all()}  # noqa: E712


def team_roles(db: Session) -> dict[int, str]:
    """{user_id: "head"} for the R&D heads from Organization (labels in pickers)."""
    return {uid: "head" for uid in org_head_ids(db)}


def is_head(db: Session, user: User, roles: dict[int, str] | None = None) -> bool:
    if user.role == "admin":
        return True
    roles = team_roles(db) if roles is None else roles
    if not roles:
        return "rnd" in user.get_apps()
    return roles.get(user.id) == "head"


def _flag(db: Session, user: User, column) -> bool:
    return db.query(RndTeamMember.id).filter(RndTeamMember.user_id == user.id, column == True).first() is not None  # noqa: E712


def can_create_technical_offer(db: Session, user: User) -> bool:
    """Heads always; others when picked under "Can create Technical Offers"
    in R&D › Settings."""
    return is_head(db, user) or _flag(db, user, RndTeamMember.can_create_technical_offer)


def can_view_technical_offer(db: Session, user: User) -> bool:
    """Creators, plus people picked under "Can see Technical Offers" — they
    see every requirement and its offers but can't create or change them."""
    return can_create_technical_offer(db, user) or _flag(db, user, RndTeamMember.can_view_technical_offer)


def rnd_users(db: Session) -> list[User]:
    return [u for u in db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all() if "rnd" in u.get_apps()]  # noqa: E712


def heads(db: Session) -> list[User]:
    """Who receives new requirements from CRM: the R&D department head(s).
    Admins see every module, so without a head they only count when nobody
    else has R&D."""
    ids = org_head_ids(db)
    if ids:
        return db.query(User).filter(User.id.in_(ids)).all()
    users = rnd_users(db)
    members = [u for u in users if u.role != "admin" and not u.is_azure_admin]
    return members or users


def head_ids(db: Session) -> list[int]:
    return [u.id for u in heads(db)]


def _row(db: Session, user: User, source: str, record_id: int) -> RndRequirementAccess | None:
    return db.query(RndRequirementAccess).filter(
        RndRequirementAccess.source == source, RndRequirementAccess.record_id == record_id,
        RndRequirementAccess.user_id == user.id,
    ).first()


# ── departments working on a requirement ──────────────────────────────────

def side_label(department: str) -> str:
    return SIDE_LABELS.get(department, department)


def is_rnd_side(user: User) -> bool:
    """Works in R&D › Requirements (admins count everywhere)."""
    return user.role == "admin" or (RND in user.get_apps() and can_view_tab(user, RND, TAB))


def can_see_department(user: User, department: str) -> bool:
    return can_view_tab(user, department, TAB)


def has_requirement_side(user: User) -> bool:
    return is_rnd_side(user) or any(can_see_department(user, d) for d in RND_SHARE_DEPARTMENTS)


def shared_departments(db: Session, source: str, record_id: int) -> list[str]:
    """Departments the R&D head shared this requirement with (any request, answered or not)."""
    rows = {d for (d,) in db.query(RndRequirementShare.department).filter(
        RndRequirementShare.source == source, RndRequirementShare.record_id == record_id).distinct().all()}
    return [d for d in RND_SHARE_DEPARTMENTS if d in rows]


def working_departments(db: Session, source: str, record_id: int) -> list[str]:
    """R&D plus every department the requirement is shared with."""
    return [RND, *shared_departments(db, source, record_id)]


def user_departments(db: Session, user: User, source: str, record_id: int, shared: list[str] | None = None) -> list[str]:
    """Which of the requirement's departments this person belongs to — "My department"."""
    shared = shared_departments(db, source, record_id) if shared is None else shared
    return ([RND] if is_rnd_side(user) else []) + [d for d in shared if can_see_department(user, d)]


def department_people(db: Session, department: str) -> list[User]:
    """Who can be given a task for this department. Admins pass every
    permission check, so they count only when nobody else holds the right."""
    if department == RND:
        return rnd_users(db)
    users = [u for u in db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all()  # noqa: E712
             if can_see_department(u, department)]
    return [u for u in users if u.role != "admin" and not u.is_azure_admin] or users


def check_assignee(db: Session, source: str, record_id: int, assignee_id: int, department: str) -> User:
    """The person must belong to the department the task is for, and the
    department must be working on this requirement."""
    if department not in working_departments(db, source, record_id):
        if department in RND_SHARE_DEPARTMENTS:
            raise HTTPException(status_code=422, detail=f"This requirement isn't shared with {side_label(department)}, so its people can't get tasks on it. "
                                                        f"The R&D head ({_head_names(db)}) shares it from the Tasks & Departments tab first.")
        raise HTTPException(status_code=422, detail=f"'{department}' isn't a department that works on R&D requirements — pick R&D, Design, Electrical or Hydraulic & Pneumatic.")
    assignee = db.query(User).filter(User.id == assignee_id).first()
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=400, detail="The selected person was not found or is deactivated — pick someone else.")
    name = assignee.name or assignee.email
    if department == RND and RND not in assignee.get_apps():
        raise HTTPException(status_code=400, detail=f"{name} has no access to the R&D module, so they couldn't see this task. Pick someone with R&D access, or grant it in User Management.")
    if department != RND and not can_see_department(assignee, department):
        raise HTTPException(status_code=400, detail=f"{name} can't open {side_label(department)} › Requirements, so they couldn't see this task. Pick someone from "
                                                    f"{side_label(department)}, or ask an admin to give them 'View' on {side_label(department)} › Requirements (Organization › Role & Permissions).")
    return assignee


def assignee_heads(db: Session, task: RndRequirementTask, assignee: User) -> set[int]:
    """The assignee's department head(s), from Organization › Department
    (matched on the person's department + branch). R&D work falls back to
    the R&D head(s) when the person's department has no head set."""
    from app.modules.organization.models.department import Department  # local: keeps rnd ↔ organization imports one-way
    ids: set[int] = set()
    name = (assignee.department or "").strip()
    if name:
        rows = db.query(Department).filter(Department.name.ilike(name)).all()
        for d in [d for d in rows if d.branch_id == assignee.branch_id] or rows:
            ids |= {d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])}
    ids.discard(None)
    if not ids and task.department == RND:
        ids = set(head_ids(db))
    return ids


def link_for(db: Session, user: User, source: str, record_id: int) -> tuple[str, int]:
    """Where this person opens the requirement from a notification: R&D's page,
    or their department's Requirements page (addressed by the latest share)."""
    if not is_rnd_side(user):
        for d in shared_departments(db, source, record_id):
            if can_see_department(user, d):
                share = db.query(RndRequirementShare).filter(
                    RndRequirementShare.source == source, RndRequirementShare.record_id == record_id,
                    RndRequirementShare.department == d).order_by(RndRequirementShare.id.desc()).first()
                return f"{d}_rnd_requirement", share.id
    return f"rnd_req_{source}", record_id


def access_for(db: Session, user: User, source: str, record_id: int) -> dict:
    """{view, download, upload, respond, is_head, create_technical_offer, departments}
    for this user on this requirement."""
    departments = user_departments(db, user, source, record_id)
    if is_head(db, user):
        return {**{p: True for p in PERMS}, "is_head": True, "create_technical_offer": True, "departments": departments}
    row = _row(db, user, source, record_id)
    has_task = db.query(RndRequirementTask.id).filter(
        RndRequirementTask.source == source, RndRequirementTask.record_id == record_id,
        RndRequirementTask.assigned_to_id == user.id, RndRequirementTask.status != "cancelled",
    ).first() is not None
    out = {
        "view": bool(row and row.can_view) or has_task,
        "download": bool(row and row.can_download),
        "upload": bool(row and row.can_upload),
        "respond": bool(row and row.can_respond),
        "is_head": False,
        "create_technical_offer": can_create_technical_offer(db, user),
        "departments": departments,
    }
    # A department the requirement is shared with works on it with R&D.
    if any(d != RND for d in departments):
        out.update(view=True, download=True, upload=True)
    if not out["view"]:
        out.update(download=False, upload=False, respond=False)
    # A Technical Offer creator works on any requirement's offer, so opens it
    # too; a "Can see Technical Offers" person only views and downloads.
    if out["create_technical_offer"] or can_view_technical_offer(db, user):
        out.update(view=True, download=True)
    return out


def _head_names(db: Session) -> str:
    names = [u.name or u.email for u in heads(db)]
    return ", ".join(names) if names else "the R&D head"


def ensure(db: Session, user: User, source: str, record_id: int, perm: str) -> dict:
    access = access_for(db, user, source, record_id)
    if not access[perm]:
        raise HTTPException(
            status_code=403,
            detail=f"You don't have permission to {PERM_LABELS[perm]}. Ask the R&D head ({_head_names(db)}) "
                   "to grant it in the requirement's Access tab, or to share the requirement with your department.",
        )
    return access


def ensure_head(db: Session, user: User, what: str) -> None:
    if not is_head(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only the R&D head ({_head_names(db)}) or an admin can {what}. "
                   "R&D heads are the R&D department's heads in Organization › Department.",
        )


def visible_keys(db: Session, user: User) -> set[tuple[str, int]] | None:
    """(source, record_id) pairs the user may see; None = all (head/admin)."""
    if can_view_technical_offer(db, user):
        return None
    keys = {
        (r.source, r.record_id)
        for r in db.query(RndRequirementAccess).filter(RndRequirementAccess.user_id == user.id, RndRequirementAccess.can_view == True).all()  # noqa: E712
    }
    keys |= {
        (t.source, t.record_id)
        for t in db.query(RndRequirementTask).filter(RndRequirementTask.assigned_to_id == user.id, RndRequirementTask.status != "cancelled").all()
    }
    return keys


def grant_task_access(db: Session, *, source: str, record_id: int, user_id: int, granted_by: User) -> None:
    """A task assignee can open the requirement and read its documents."""
    row = db.query(RndRequirementAccess).filter(
        RndRequirementAccess.source == source, RndRequirementAccess.record_id == record_id,
        RndRequirementAccess.user_id == user_id,
    ).first()
    if row:
        row.can_view = True
        row.can_download = True
        return
    db.add(RndRequirementAccess(
        source=source, record_id=record_id, user_id=user_id, can_view=True, can_download=True,
        granted_by_id=granted_by.id,
    ))
