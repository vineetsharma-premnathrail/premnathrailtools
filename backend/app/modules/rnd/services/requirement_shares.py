"""R&D requirement shared with an engineering department for feasibility.

The R&D head shares a requirement (CRM Inquiry / Tender sent to R&D) with
Design, Electrical and/or Hydraulic & Pneumatic, with a note on what R&D
needs from them and a due date. The department sees it under its own
Requirements tab — the requirement read-only (CRM stays the source of truth),
the TOR + documents CRM shared and R&D's own documents — works on it with R&D
(every department's tasks, documents, discussion — see requirement_access.py)
and sends one reply: feasible / feasible with changes / not feasible, remarks
and files.

Who, per department (Permission Matrix, `<department>:requirements`):
  view → sees requirements shared with the department; edit → sends the reply.
Sharing is the R&D head's (requirement_access.ensure_head).
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_perform, can_view_tab
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement_work import RND_SHARE_DEPARTMENTS, RndRequirementShare

DEPARTMENT_LABELS = {"design": "Design", "electrical": "Electrical", "hydraulic": "Hydraulic & Pneumatic"}
RESPONSE_LABELS = {"feasible": "Feasible", "feasible_with_changes": "Feasible with changes", "not_feasible": "Not feasible"}
SHARE_DOC = "rnd_dept_share"   # related_sub_module of a department's reply files (related_sub_id = share id)
TAB = "requirements"


def label(department: str) -> str:
    return DEPARTMENT_LABELS.get(department, department)


def ensure_department(department: str) -> None:
    if department not in RND_SHARE_DEPARTMENTS:
        raise HTTPException(status_code=404, detail=f"'{department}' isn't a department R&D shares requirements with "
                                                    f"(only {', '.join(DEPARTMENT_LABELS.values())}).")


def ensure_can_view(user: User, department: str) -> None:
    ensure_department(department)
    if not can_view_tab(user, department, TAB):
        raise HTTPException(
            status_code=403,
            detail=f"You don't have 'View' permission on {label(department)} › Requirements. "
                   "Ask an admin to add it to one of your roles (Organization › Role & Permissions — the Permission Matrix).",
        )


def department_users(db: Session, department: str, action: str = "view") -> list[User]:
    """Active people who can see (or reply on) the department's Requirements tab."""
    users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
    return [u for u in users if can_perform(u, department, TAB, action)]


def recipients(db: Session, department: str) -> list[User]:
    """Who hears about a new share: the people who can reply; if nobody has
    that right yet, everyone who can see the tab. Admins pass every check, so
    they count only when nobody else holds the right."""
    for action in ("edit", "view"):
        users = department_users(db, department, action)
        members = [u for u in users if u.role != "admin" and not u.is_azure_admin]
        if members or users:
            return members or users
    return []


def is_overdue(share: RndRequirementShare) -> bool:
    return share.status == "open" and share.due_date is not None and today_ist() > share.due_date


def serialize(db: Session, shares: list[RndRequirementShare]) -> list[dict]:
    if not shares:
        return []
    ids = [s.id for s in shares]
    user_ids = {s.shared_by_id for s in shares} | {s.responded_by_id for s in shares if s.responded_by_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    docs = db.query(CrmDocument).filter(
        CrmDocument.related_sub_module == SHARE_DOC, CrmDocument.related_sub_id.in_(ids), CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.asc()).all()
    files: dict[int, list] = {}
    for d in docs:
        files.setdefault(d.related_sub_id, []).append({
            "id": d.id, "name": d.file_name, "file_size": d.file_size, "uploaded_by": d.uploaded_by_name,
            "uploaded_at": d.created_at.isoformat() if d.created_at else None, "category": d.doc_category,
        })

    def name(uid: int | None) -> str | None:
        u = users.get(uid) if uid else None
        return (u.name or u.email) if u else None

    return [{
        "id": s.id, "source": s.source, "record_id": s.record_id,
        "department": s.department, "department_label": label(s.department),
        "note": s.note, "due_date": s.due_date.isoformat() if s.due_date else None,
        "status": s.status, "is_overdue": is_overdue(s),
        "shared_by": name(s.shared_by_id), "shared_at": s.created_at.isoformat() if s.created_at else None,
        "response": s.response, "response_label": RESPONSE_LABELS.get(s.response or ""),
        "response_remarks": s.response_remarks,
        "responded_by": name(s.responded_by_id), "responded_at": s.responded_at.isoformat() if s.responded_at else None,
        "replaced_at": s.replaced_at.isoformat() if s.replaced_at else None,
        "files": files.get(s.id, []),
    } for s in shares]


def open_share(db: Session, source: str, record_id: int, department: str) -> RndRequirementShare | None:
    return db.query(RndRequirementShare).filter(
        RndRequirementShare.source == source, RndRequirementShare.record_id == record_id,
        RndRequirementShare.department == department, RndRequirementShare.status == "open",
    ).first()


def validate_due_date(due: date | None) -> None:
    if due and due < today_ist():
        raise HTTPException(status_code=422, detail=f"The reply due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
