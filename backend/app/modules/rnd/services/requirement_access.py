"""Who may do what on an R&D requirement (a CRM Inquiry / Tender sent to R&D).

R&D rework 2026-10-30 — need-to-know now comes from roles, not per-record ticks:

* R&D head(s) — the heads of the R&D department in Organization › Department
  — and portal admins can do everything on every requirement: see it,
  open/download its documents, upload documents, respond to CRM, accept or
  return it to BD and hand out tasks. Until an R&D department head is set,
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

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement_work import RndRequirementAccess, RndRequirementTask

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


def can_create_technical_offer(db: Session, user: User) -> bool:
    """Heads always; others with R&D › Requirements › Technical Offer team ›
    Create (Organization › Role & Permissions — a role or the user's extras)."""
    return is_head(db, user) or can_feature(user, "rnd", "requirements", "offer_team", "create")


def can_view_technical_offer(db: Session, user: User) -> bool:
    """Creators, plus Technical Offer team › View — they see every requirement
    and its offers but can't create or change them."""
    return can_create_technical_offer(db, user) or can_feature(user, "rnd", "requirements", "offer_team", "view")


def can_accept(db: Session, user: User) -> bool:
    """Accept a requirement: the R&D head, an admin, or R&D › Requirements › Review › Approve."""
    return is_head(db, user) or can_feature(user, "rnd", "requirements", "review", "approve")


def can_return(db: Session, user: User) -> bool:
    """Return a requirement to BD: the R&D head, an admin, or R&D › Requirements › Review › Reject."""
    return is_head(db, user) or can_feature(user, "rnd", "requirements", "review", "reject")


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
    out = {
        "view": False, "download": False, "upload": False, "respond": False,
        "is_head": head, "is_rnd_side": rnd_side, "can_review": can_accept(db, user) or can_return(db, user),
        "create_technical_offer": can_create_technical_offer(db, user),
    }
    if head:
        out.update({p: True for p in PERMS})
        out["can_review"] = True
        return out
    row = _row(db, user, source, record_id)
    if rnd_side:
        # R&D-side users with View on Requirements see every requirement.
        out.update(view=True, download=True, upload=True, respond=bool(row and row.can_respond))
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


def ensure_can_review(db: Session, user: User, action: str) -> None:
    """403 with who can accept / return a requirement (AC-14)."""
    ok = can_accept(db, user) if action == "accept" else can_return(db, user)
    if not ok:
        raise HTTPException(
            status_code=403,
            detail=f"Only the R&D head ({_head_names(db)}) or someone with R&D › Requirements › Review can accept a "
                   "requirement — an admin grants it in Organization › Role & Permissions.",
        )


def visible_keys(db: Session, user: User) -> set[tuple[str, int]] | None:
    """(source, record_id) pairs the user may see; None = all (R&D side, head,
    Technical Offer team, admin)."""
    if is_rnd_side(user) or is_head(db, user) or can_view_technical_offer(db, user):
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
