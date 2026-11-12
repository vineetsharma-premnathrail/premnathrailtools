"""Who may do what on an R&D requirement (a CRM Inquiry / Tender sent to R&D).

R&D rework 2026-10-30 — need-to-know now comes from roles, not per-record ticks:

* R&D head(s) — the heads of the R&D department in Organization › Department
  — and portal admins can do everything on every requirement: see it,
  open/download its documents, upload documents, respond to CRM and hand out
  tasks. DECISIONS (accept / return to BD, review a task, release a Technical
  Offer) are for the head or a Review-right holder only: an admin does not
  decide just because they are admin (owner, 2026-11-04). Until an R&D department head is set,
  every R&D user acts as head, so the module keeps working.
* Everyone on the R&D side (R&D app + View on R&D › Requirements) sees every
  requirement, downloads its files and uploads documents. The role's features
  (core/features/rnd.py) decide which blocks and actions they get on top.
* Responding to CRM stays with the head (or a legacy per-requirement Respond
  tick that an earlier release gave to someone).
* People outside R&D (Design, Electrical, Hydraulic & Pneumatic …) see only the
  requirements where they hold a task — View and Download, nothing else.
  Assigning a task grants this automatically. Legacy `rnd_requirement_access`
  rows (View / Download only) are still honoured; there is no screen to
  change them any more.

Every check raises a 403 that says what is missing and who can grant it.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement_work import RndRequirementAccess, RndRequirementTask

logger = logging.getLogger(__name__)

PERMS = ("view", "download", "upload", "respond")
RND = "rnd"
TAB = "requirements"
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


def is_head_for_decision(db: Session, user: User, roles: dict[int, str] | None = None) -> bool:
    """Head for DECISIONS (accept / return a requirement, review a task, release or
    return a Technical Offer). A portal admin is not an approver just because they are
    admin (owner decision 2026-11-04): an admin decides only when they are a named R&D
    head in Organization › Department. With no head set, the R&D people (not admins) act
    as head so the module keeps working. Management actions keep using is_head."""
    roles = team_roles(db) if roles is None else roles
    if user.role == "admin":
        return roles.get(user.id) == "head"
    return is_head(db, user, roles)


def can_create_technical_offer(db: Session, user: User) -> bool:
    """Heads always; others with R&D › Requirements › Technical Offer team ›
    Create (Organization › Role & Permissions — a role or the user's extras)."""
    return is_head(db, user) or can_feature(user, "rnd", "requirements", "offer_team", "create")


def can_view_technical_offer(db: Session, user: User) -> bool:
    """Creators, plus Technical Offer team › View — they see every requirement
    and its offers but can't create or change them."""
    return can_create_technical_offer(db, user) or can_feature(user, "rnd", "requirements", "offer_team", "view")


def can_accept(db: Session, user: User) -> bool:
    """Accept a requirement: the R&D head, or R&D › Requirements › Review › Approve. Not an
    admin just because they are admin (an admin who is a named head still can)."""
    return is_head_for_decision(db, user) or can_feature(user, "rnd", "requirements", "review", "approve")


def can_return(db: Session, user: User) -> bool:
    """Return a requirement to BD: the R&D head, or R&D › Requirements › Review › Reject. Not an
    admin just because they are admin (an admin who is a named head still can)."""
    return is_head_for_decision(db, user) or can_feature(user, "rnd", "requirements", "review", "reject")


def rnd_users(db: Session) -> list[User]:
    return [u for u in db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all() if "rnd" in u.get_apps()]  # noqa: E712


_warned_no_head = False


def heads(db: Session) -> list[User]:
    """Who receives new requirements from CRM and every "R&D head" notice: the
    R&D department head(s) from Organization › Department. With no head set,
    the admins only (never the whole department)."""
    ids = org_head_ids(db)
    if ids:
        return db.query(User).filter(User.id.in_(ids)).all()
    # No R&D head in Organization › Department: tell the admins only. Falling
    # back to every R&D user sent each "head" notice (new requirement, task
    # given, approval asked) to the whole department (owner, 2026-11-03).
    global _warned_no_head
    if not _warned_no_head:
        _warned_no_head = True
        logger.warning("No R&D department head is set in Organization › Department — R&D head notices go to admins only.")
    return [u for u in rnd_users(db) if u.role == "admin"]


def head_ids(db: Session) -> list[int]:
    return [u.id for u in heads(db)]


def _row(db: Session, user: User, source: str, record_id: int) -> RndRequirementAccess | None:
    return db.query(RndRequirementAccess).filter(
        RndRequirementAccess.source == source, RndRequirementAccess.record_id == record_id,
        RndRequirementAccess.user_id == user.id,
    ).first()


# ── sides ─────────────────────────────────────────────────────────────────

def is_rnd_side(user: User) -> bool:
    """Works in R&D › Requirements (admins count everywhere)."""
    return user.role == "admin" or (RND in user.get_apps() and can_view_tab(user, RND, TAB))


def has_task(db: Session, user: User, source: str, record_id: int) -> bool:
    return db.query(RndRequirementTask.id).filter(
        RndRequirementTask.source == source, RndRequirementTask.record_id == record_id,
        RndRequirementTask.assigned_to_id == user.id, RndRequirementTask.status != "cancelled",
    ).first() is not None


def has_any_task(db: Session, user: User) -> bool:
    return db.query(RndRequirementTask.id).filter(
        RndRequirementTask.assigned_to_id == user.id, RndRequirementTask.status != "cancelled",
    ).first() is not None


_WIDE_SCOPES = ("department", "plant", "multi_plant", "organization")


def rnd_scope(user: User) -> str:
    """The user's R&D data scope (Organization › Role & Permissions › Data access)."""
    from app.core.data_scope import user_scope  # local: data_scope imports models lazily
    return user_scope(user, RND)


def _scope_label(level: str) -> str:
    from app.core.data_scope import SCOPE_LABELS
    return SCOPE_LABELS.get(level, level)


def sees_every_requirement(db: Session, user: User) -> bool:
    """Every requirement and every task on it: admins, the R&D head(s), the
    Technical Offer team, and R&D-side people whose R&D data scope is
    Department or wider. With "Own records" / "Own + assigned" an R&D person
    sees only the requirements they hold (or gave) a task on, and only those
    tasks — the data scope wins over "R&D sees everything" (owner, 2026-11-12)."""
    if user.role == "admin" or is_head(db, user) or can_view_technical_offer(db, user):
        return True
    return is_rnd_side(user) and rnd_scope(user) in _WIDE_SCOPES


def _task_keys(db: Session, user: User, *, include_given: bool) -> set[tuple[str, int]]:
    """(source, record_id) of requirements where the user holds a task — and,
    with `include_given` (Own + assigned scope), where they gave one."""
    from sqlalchemy import or_
    cond = RndRequirementTask.assigned_to_id == user.id
    if include_given:
        cond = or_(cond, RndRequirementTask.created_by_id == user.id)
    rows = db.query(RndRequirementTask.source, RndRequirementTask.record_id).filter(
        cond, RndRequirementTask.status != "cancelled",
    ).distinct().all()
    return {(s, r) for s, r in rows}


def has_requirement_side(db: Session, user: User) -> bool:
    """May reach the requirement routes at all: the R&D side, or someone who
    holds a task on a requirement (what they may open is checked per record)."""
    return is_rnd_side(user) or has_any_task(db, user)


def side_label(department: str | None) -> str:
    return {"rnd": "R&D", "design": "Design", "electrical": "Electrical", "hydraulic": "Hydraulic & Pneumatic"}.get(department or "", department or "—")


def check_assignee(db: Session, assignee_id: int) -> User:
    """The person a requirement task goes to: any active user. R&D people and
    the Design / Electrical / Hydraulic & Pneumatic engineers who give input
    through tasks all qualify; the role's "Assign to" rule narrows the list."""
    assignee = db.query(User).filter(User.id == assignee_id).first()
    if not assignee or not assignee.is_active:
        raise HTTPException(status_code=400, detail="The selected person was not found or is deactivated — pick someone else.")
    return assignee


def assignee_heads(db: Session, assignee: User) -> set[int]:
    """The assignee's department head(s), from Organization › Department
    (matched on the person's department + branch). Falls back to the R&D
    head(s) when the person's department has no head set."""
    from app.modules.organization.models.department import Department  # local: keeps rnd ↔ organization imports one-way
    ids: set[int] = set()
    name = (assignee.department or "").strip()
    if name:
        rows = db.query(Department).filter(Department.name.ilike(name)).all()
        for d in [d for d in rows if d.branch_id == assignee.branch_id] or rows:
            ids |= {d.head_user_id, d.secondary_head_user_id, *(d.additional_head_user_ids or [])}
    ids.discard(None)
    if not ids:
        ids = set(head_ids(db))
    return ids


def link_for(db: Session, user: User, source: str, record_id: int) -> tuple[str, int]:
    """Where a notification opens the requirement: R&D's requirement page."""
    return f"rnd_req_{source}", record_id


def access_for(db: Session, user: User, source: str, record_id: int) -> dict:
    """{view, download, upload, respond, is_head, is_rnd_side, can_review,
    create_technical_offer} for this user on this requirement."""
    head = is_head(db, user)
    rnd_side = is_rnd_side(user)
    sees_all = sees_every_requirement(db, user)
    out = {
        "view": False, "download": False, "upload": False, "respond": False,
        "is_head": head, "is_rnd_side": rnd_side, "can_review": can_accept(db, user) or can_return(db, user),
        "create_technical_offer": can_create_technical_offer(db, user),
        # False = the Tasks tab lists only the user's own tasks (held / given) and their sub-tasks.
        "sees_all": sees_all,
    }
    if head:
        out.update({p: True for p in PERMS})
        return out
    row = _row(db, user, source, record_id)
    if rnd_side and (sees_all or (source, record_id) in _task_keys(db, user, include_given=True)):
        # R&D side: every requirement with a Department+ R&D data scope; with
        # Own / Own + assigned only the ones they hold or gave a task on.
        out.update(view=True, download=True, upload=True, respond=bool(row and row.can_respond))
    elif rnd_side:
        out["view"] = out["download"] = bool(row and row.can_view)
    else:
        task = has_task(db, user, source, record_id)
        out["view"] = task or bool(row and row.can_view)
        out["download"] = task or bool(row and row.can_download)
    # A Technical Offer creator works on any requirement's offer, so opens it
    # too; a "Can see Technical Offers" person only views and downloads.
    if out["create_technical_offer"] or can_view_technical_offer(db, user):
        out.update(view=True, download=True)
    if not out["view"]:
        out.update(download=False, upload=False, respond=False)
    return out


def _head_names(db: Session) -> str:
    names = [u.name or u.email for u in heads(db)]
    return ", ".join(names) if names else "the R&D head"


def ensure(db: Session, user: User, source: str, record_id: int, perm: str) -> dict:
    access = access_for(db, user, source, record_id)
    if not access[perm]:
        if not access["view"] and access["is_rnd_side"]:
            raise HTTPException(
                status_code=403,
                detail=f"Your R&D data access is '{_scope_label(rnd_scope(user))}', so you see only the requirements you hold or gave a task on. "
                       f"Ask the R&D head ({_head_names(db)}) for a task on it, or an admin to set R&D data access to Department "
                       "or wider in Organization › Role & Permissions.",
            )
        if not access["view"]:
            raise HTTPException(
                status_code=403,
                detail=f"You don't have access to this requirement — ask the R&D head ({_head_names(db)}) to give you a task on it.",
            )
        if perm == "respond":
            raise HTTPException(
                status_code=403,
                detail=f"Only the R&D head ({_head_names(db)}) can {PERM_LABELS[perm]}. Ask them to send "
                       "R&D's response to BD.",
            )
        raise HTTPException(
            status_code=403,
            detail=f"You don't have permission to {PERM_LABELS[perm]}. People outside R&D can only view and download the "
                   f"requirements they hold a task on. Ask the R&D head ({_head_names(db)}) if you need more.",
        )
    return access


def ensure_head(db: Session, user: User, what: str) -> None:
    if not is_head(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only the R&D head ({_head_names(db)}) or an admin can {what}. "
                   "R&D heads are the R&D department's heads in Organization › Department.",
        )


def ensure_head_for_decision(db: Session, user: User, what: str) -> None:
    """Like ensure_head, but an admin passes only as a named R&D head."""
    if not is_head_for_decision(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only the R&D head ({_head_names(db)}) can {what}. A portal admin does not decide for them — "
                   "R&D heads are the R&D department's heads in Organization › Department; an admin can name or change them there.",
        )


def ensure_can_review(db: Session, user: User, action: str) -> None:
    """403 with who can accept / return a requirement (AC-14)."""
    ok = can_accept(db, user) if action == "accept" else can_return(db, user)
    if not ok:
        raise HTTPException(
            status_code=403,
            detail=f"Only the R&D head ({_head_names(db)}) or someone with R&D › Requirements › Review can {action} a "
                   "requirement — an admin does not decide just because they are admin; an admin can grant the Review right "
                   "in Organization › Role & Permissions.",
        )


def visible_keys(db: Session, user: User) -> set[tuple[str, int]] | None:
    """(source, record_id) pairs the user may see; None = all (head, Technical
    Offer team, admin, R&D side with a Department+ R&D data scope)."""
    if sees_every_requirement(db, user):
        return None
    keys = {
        (r.source, r.record_id)
        for r in db.query(RndRequirementAccess).filter(RndRequirementAccess.user_id == user.id, RndRequirementAccess.can_view == True).all()  # noqa: E712
    }
    keys |= _task_keys(db, user, include_given=is_rnd_side(user))
    return keys
