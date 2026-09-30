"""Plain-function helpers for the Design module: document/ECN numbers, the
workflow rules (who may do what to a document, revision or ECN in which
state), the event timeline and notifications.

Every rule lives in one `check_*` function returning a `Denied` (or None),
so the routes enforce exactly what `allowed_*_actions` advertises to the UI —
the frontend never re-derives permissions on its own. Number generation
mirrors app/modules/production/service.py."""
from datetime import date, datetime, timezone
from typing import NamedTuple
from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.design.models.document import (
    DesignDocument, DesignDocumentRevision, DESIGN_DOCUMENT_TYPES, DESIGN_OPEN_REVISION_STATUSES,
)
from app.modules.design.models.event import DesignEvent
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

DESIGN_APP = "design"
# Revisions sitting with a checker/approver longer than this are "overdue"
# on the dashboard.
OVERDUE_DAYS = 7

REVISION_STATUS_PHRASE = {
    "draft": "still a draft",
    "in_review": "in review",
    "in_approval": "awaiting approval",
    "released": "released",
    "superseded": "superseded",
}
ECN_STATUS_PHRASE = {
    "draft": "still a draft",
    "submitted": "awaiting approval",
    "approved": "approved",
    "rejected": "rejected",
    "implemented": "implemented",
    "cancelled": "cancelled",
}


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def _lock_number_series(db: Session, prefix: str) -> None:
    """Transaction-scoped Postgres advisory lock so two concurrent creates
    can't draw the same number (see quality/service.py). Skipped on SQLite
    (tests), which has no advisory locks and no concurrent writers."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def _next_number(db: Session, column, prefix: str) -> str:
    _lock_number_series(db, prefix)
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}"
    return f"{prefix}0001"


def generate_document_number(db: Session, document_type: str) -> str:
    """<TYPE>-[YEAR]-[NUMBER], e.g. DWG-2026-0001 — sequence per type per year."""
    return _next_number(db, DesignDocument.doc_number, f"{DESIGN_DOCUMENT_TYPES[document_type]}-{date.today().year}-")


def generate_ecn_number(db: Session) -> str:
    """ECN-[YEAR]-[NUMBER], sequence scoped per year."""
    return _next_number(db, DesignChangeNotice.ecn_number, f"ECN-{date.today().year}-")


def revision_label(index: int) -> str:
    return f"R{index}"


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_aware(value: datetime | None) -> datetime | None:
    """SQLite hands timestamps back naive; Postgres hands them back aware.
    Normalise so date arithmetic works on both."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def days_since(value: datetime | None) -> int:
    value = as_aware(value)
    return max(0, (utcnow() - value).days) if value else 0


def is_admin(user: User) -> bool:
    return user.role == "admin"


def user_name(user: User | None) -> str | None:
    return (user.name or user.email) if user else None


def users_by_id(db: Session, ids) -> dict[int, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()}


def ref(doc: DesignDocument, rev: DesignDocumentRevision | None = None) -> str:
    return f"{doc.doc_number} {rev.revision_label}" if rev else doc.doc_number


def live_revisions(doc: DesignDocument) -> list[DesignDocumentRevision]:
    return [r for r in doc.revisions if not r.is_deleted]


def open_revision(doc: DesignDocument) -> DesignDocumentRevision | None:
    return next((r for r in live_revisions(doc) if r.status in DESIGN_OPEN_REVISION_STATUSES), None)


def released_revision(doc: DesignDocument) -> DesignDocumentRevision | None:
    return next((r for r in live_revisions(doc) if r.status == "released"), None)


def ever_released(doc: DesignDocument) -> bool:
    return any(r.status in ("released", "superseded") for r in live_revisions(doc))


def display_status(doc: DesignDocument) -> str:
    """One status for the register: obsolete, released, revising (released
    with a newer revision in progress), or the open revision's own state."""
    if doc.status == "obsolete":
        return "obsolete"
    released = released_revision(doc)
    current = open_revision(doc)
    if released and current:
        return "revising"
    if released:
        return "released"
    return current.status if current else "draft"


def add_event(
    db: Session, action: str, actor: User | None, *, document_id: int | None = None,
    revision_id: int | None = None, ecn_id: int | None = None, comment: str | None = None,
) -> None:
    db.add(DesignEvent(
        action=action, actor_id=actor.id if actor else None, document_id=document_id,
        revision_id=revision_id, ecn_id=ecn_id, comment=(comment or "").strip() or None,
    ))


def notify(
    db: Session, user_id: int | None, actor: User, title: str, message: str,
    notification_type: str, entity_type: str, entity_id: int,
) -> None:
    """notify_user, minus the self-notification when the actor is the
    recipient (e.g. an admin approving their own team's request)."""
    if not user_id or user_id == actor.id:
        return
    notify_user(db, user_id, title, message, notification_type, entity_type=entity_type, entity_id=entity_id)


def get_workflow_user(db: Session, user_id: int, role: str) -> User:
    """Loads a person being named as checker/approver and makes sure they
    can actually act: active, and holding the Design app."""
    person = db.query(User).filter(User.id == user_id).first()
    if not person:
        raise HTTPException(status_code=400, detail=f"The {role} you picked (user #{user_id}) no longer exists — pick someone else.")
    if not person.is_active:
        raise HTTPException(status_code=400, detail=f"{user_name(person)} is deactivated, so they can't act as {role} — pick someone else.")
    if DESIGN_APP not in person.get_apps():
        raise HTTPException(
            status_code=400,
            detail=f"{user_name(person)} doesn't have access to the Design module, so they couldn't open the revision as {role}. "
                   "Pick someone else, or ask an admin to assign them the Design app in Users.",
        )
    return person


def validate_signatories(db: Session, author_id: int | None, reviewer_id: int | None, approver_id: int | None) -> None:
    """Four-eyes rule for whatever is set: checker and approver are two
    different people with Design access, and neither is the author."""
    author = db.query(User).filter(User.id == author_id).first() if author_id else None
    author_label = user_name(author) or "the author"
    if reviewer_id:
        get_workflow_user(db, reviewer_id, "checker")
        if reviewer_id == author_id:
            raise HTTPException(status_code=400, detail=f"{author_label} wrote this revision, so they can't also be its checker — pick another engineer.")
    if approver_id:
        get_workflow_user(db, approver_id, "approver")
        if approver_id == author_id:
            raise HTTPException(status_code=400, detail=f"{author_label} wrote this revision, so they can't also approve it — pick someone else as approver.")
    if reviewer_id and approver_id and reviewer_id == approver_id:
        raise HTTPException(
            status_code=400,
            detail="The checker and the approver must be two different people — that's the point of the second signature. Pick a different approver.",
        )


# ---------------------------------------------------------------------------
# Workflow rules
# ---------------------------------------------------------------------------

class Denied(NamedTuple):
    status: int
    detail: str


def ensure(denied: "Denied | None") -> None:
    if denied:
        raise HTTPException(status_code=denied.status, detail=denied.detail)


def _is_doc_manager(user: User, doc: DesignDocument) -> bool:
    return is_admin(user) or user.id in (doc.owner_id, doc.created_by_id)


def check_edit_document(user: User, doc: DesignDocument) -> Denied | None:
    if doc.status == "obsolete":
        return Denied(409, f"{doc.doc_number} is obsolete, so its details are frozen. An admin can reactivate it if it's needed again.")
    if not _is_doc_manager(user, doc):
        return Denied(403, f"Only the owner of {doc.doc_number}, the person who created it, or an admin can edit its details.")
    return None


def check_manage_draft(user: User, doc: DesignDocument, rev: DesignDocumentRevision) -> Denied | None:
    """Editing a revision's summary/signatories/files, or submitting it."""
    if doc.status == "obsolete":
        return Denied(409, f"{doc.doc_number} is obsolete — reactivate it before working on {rev.revision_label}.")
    if rev.status != "draft":
        hint = (
            " Recall it to draft first if you need to change something."
            if rev.status in ("in_review", "in_approval")
            else " Start a new revision to make changes — released files are the controlled record and can't be altered."
        )
        return Denied(409, f"{ref(doc, rev)} is {REVISION_STATUS_PHRASE.get(rev.status, rev.status)}, so it can't be changed.{hint}")
    if not (_is_doc_manager(user, doc) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {ref(doc, rev)}, the document owner, or an admin can change this draft.")
    return None


def check_recall(user: User, doc: DesignDocument, rev: DesignDocumentRevision) -> Denied | None:
    if rev.status not in ("in_review", "in_approval"):
        return Denied(409, f"{ref(doc, rev)} is {REVISION_STATUS_PHRASE.get(rev.status, rev.status)} — only a revision that's in review or awaiting approval can be recalled.")
    if not (_is_doc_manager(user, doc) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {ref(doc, rev)}, the document owner, or an admin can recall it.")
    return None


def check_review(user: User, doc: DesignDocument, rev: DesignDocumentRevision, reviewer: User | None) -> Denied | None:
    if rev.status != "in_review":
        return Denied(409, f"{ref(doc, rev)} is {REVISION_STATUS_PHRASE.get(rev.status, rev.status)}, not in review — there's nothing to check right now.")
    if user.id == rev.created_by_id:
        return Denied(403, f"You wrote {ref(doc, rev)}, so you can't check it yourself — {user_name(reviewer) or 'the named checker'} must.")
    if user.id == rev.approver_id:
        return Denied(403, f"You're the named approver of {ref(doc, rev)}, so checking it too would put both signatures under one name — {user_name(reviewer) or 'the named checker'} must check it.")
    if user.id != rev.reviewer_id and not is_admin(user):
        return Denied(403, f"{ref(doc, rev)} is with {user_name(reviewer) or 'its named checker'} for checking — only they or an admin can pass or return it.")
    return None


def check_approve(user: User, doc: DesignDocument, rev: DesignDocumentRevision, approver: User | None) -> Denied | None:
    if rev.status != "in_approval":
        return Denied(409, f"{ref(doc, rev)} is {REVISION_STATUS_PHRASE.get(rev.status, rev.status)}, not awaiting approval — there's nothing to approve right now.")
    if user.id == rev.created_by_id:
        return Denied(403, f"You wrote {ref(doc, rev)}, so you can't approve it yourself — {user_name(approver) or 'the named approver'} must.")
    if user.id == rev.reviewed_by_id:
        return Denied(403, f"You checked {ref(doc, rev)}, so the approval has to come from someone else — {user_name(approver) or 'the named approver'}.")
    if user.id != rev.approver_id and not is_admin(user):
        return Denied(403, f"{ref(doc, rev)} is waiting on {user_name(approver) or 'its named approver'} — only they or an admin can approve or return it.")
    return None


def check_new_revision(user: User, doc: DesignDocument) -> Denied | None:
    if doc.status == "obsolete":
        return Denied(409, f"{doc.doc_number} is obsolete — an admin must reactivate it before it can be revised.")
    current = open_revision(doc)
    if current:
        return Denied(409, f"{ref(doc, current)} is already open ({REVISION_STATUS_PHRASE.get(current.status, current.status)}). Finish or discard it before starting another revision.")
    if not released_revision(doc):
        return Denied(409, f"{doc.doc_number} has no released revision yet — a new revision can only be started from a released one.")
    return None


def check_discard_revision(user: User, doc: DesignDocument, rev: DesignDocumentRevision) -> Denied | None:
    if rev.status != "draft":
        return Denied(409, f"{ref(doc, rev)} is {REVISION_STATUS_PHRASE.get(rev.status, rev.status)} — only a draft revision can be discarded. Recall it first if it's in review.")
    if rev.revision_index == 0 or not ever_released(doc):
        return Denied(409, f"{ref(doc, rev)} is the document's first revision — delete the document instead of discarding it.")
    if not (_is_doc_manager(user, doc) or user.id == rev.created_by_id):
        return Denied(403, f"Only the author of {ref(doc, rev)}, the document owner, or an admin can discard it.")
    return None


def check_obsolete(user: User, doc: DesignDocument) -> Denied | None:
    if doc.status == "obsolete":
        return Denied(409, f"{doc.doc_number} is already obsolete.")
    if not ever_released(doc):
        return Denied(409, f"{doc.doc_number} was never released, so there's nothing to withdraw from use — delete it instead.")
    current = open_revision(doc)
    if current:
        return Denied(409, f"{ref(doc, current)} is still open ({REVISION_STATUS_PHRASE.get(current.status, current.status)}). Recall and discard it before marking the document obsolete.")
    if not (is_admin(user) or user.id == doc.owner_id):
        return Denied(403, f"Only the owner of {doc.doc_number} or an admin can mark it obsolete.")
    return None


def check_reactivate(user: User, doc: DesignDocument) -> Denied | None:
    if doc.status != "obsolete":
        return Denied(409, f"{doc.doc_number} isn't obsolete — there's nothing to reactivate.")
    if not is_admin(user):
        return Denied(403, f"Only an admin can reactivate an obsolete document ({doc.doc_number}).")
    return None


def check_delete_document(user: User, doc: DesignDocument) -> Denied | None:
    if ever_released(doc):
        return Denied(409, f"{doc.doc_number} has been released, so it's a controlled record and can't be deleted. Mark it obsolete instead.")
    current = open_revision(doc)
    if current and current.status != "draft":
        return Denied(409, f"{ref(doc, current)} is {REVISION_STATUS_PHRASE.get(current.status, current.status)}. Recall it to draft before deleting the document.")
    if not _is_doc_manager(user, doc):
        return Denied(403, f"Only the owner of {doc.doc_number}, the person who created it, or an admin can delete it.")
    return None


def allowed_document_actions(user: User, doc: DesignDocument) -> list[str]:
    """What the detail page may offer `user` right now. Revision-level
    actions refer to the open revision."""
    actions: list[str] = ["comment"]
    if not check_edit_document(user, doc):
        actions.append("edit")
    if not check_new_revision(user, doc):
        actions.append("new_revision")
    if not check_obsolete(user, doc):
        actions.append("obsolete")
    if not check_reactivate(user, doc):
        actions.append("reactivate")
    if not check_delete_document(user, doc):
        actions.append("delete")
    current = open_revision(doc)
    if current:
        if not check_manage_draft(user, doc, current):
            actions += ["edit_revision", "manage_files", "submit"]
        if not check_discard_revision(user, doc, current):
            actions.append("discard_revision")
        if not check_recall(user, doc, current):
            actions.append("recall")
        if current.status == "in_review" and not check_review(user, doc, current, None):
            actions.append("review")
        if current.status == "in_approval" and not check_approve(user, doc, current, None):
            actions.append("approve")
    return actions


# ---------------------------------------------------------------------------
# ECN rules
# ---------------------------------------------------------------------------

def _phrase(ecn: DesignChangeNotice) -> str:
    return ECN_STATUS_PHRASE.get(ecn.status, ecn.status)


def check_ecn_edit(user: User, ecn: DesignChangeNotice) -> Denied | None:
    if ecn.status != "draft":
        return Denied(409, f"{ecn.ecn_number} is {_phrase(ecn)}, so it can no longer be edited.")
    if not (is_admin(user) or user.id == ecn.created_by_id):
        return Denied(403, f"Only the person who raised {ecn.ecn_number} or an admin can edit it.")
    return None


def check_ecn_decide(user: User, ecn: DesignChangeNotice, approver: User | None) -> Denied | None:
    if ecn.status != "submitted":
        return Denied(409, f"{ecn.ecn_number} is {_phrase(ecn)}, not awaiting approval.")
    if user.id == ecn.created_by_id:
        return Denied(403, f"You raised {ecn.ecn_number}, so you can't approve or reject it — {user_name(approver) or 'the named approver'} must.")
    if user.id != ecn.approver_id and not is_admin(user):
        return Denied(403, f"{ecn.ecn_number} is waiting on {user_name(approver) or 'its named approver'} — only they or an admin can decide it.")
    return None


def check_ecn_implement(user: User, ecn: DesignChangeNotice) -> Denied | None:
    if ecn.status != "approved":
        return Denied(409, f"{ecn.ecn_number} is {_phrase(ecn)} — only an approved ECN can be marked implemented.")
    if not (is_admin(user) or user.id in (ecn.created_by_id, ecn.approver_id)):
        return Denied(403, f"Only the person who raised {ecn.ecn_number}, its approver, or an admin can mark it implemented.")
    return None


def check_ecn_cancel(user: User, ecn: DesignChangeNotice) -> Denied | None:
    if ecn.status not in ("draft", "submitted"):
        return Denied(409, f"{ecn.ecn_number} is {_phrase(ecn)} — only a draft or submitted ECN can be cancelled.")
    if not (is_admin(user) or user.id == ecn.created_by_id):
        return Denied(403, f"Only the person who raised {ecn.ecn_number} or an admin can cancel it.")
    return None


def check_ecn_delete(user: User, ecn: DesignChangeNotice) -> Denied | None:
    if ecn.status != "draft":
        return Denied(409, f"{ecn.ecn_number} is {_phrase(ecn)} — only a draft ECN can be deleted. Cancel it instead so the record is kept.")
    if not (is_admin(user) or user.id == ecn.created_by_id):
        return Denied(403, f"Only the person who raised {ecn.ecn_number} or an admin can delete it.")
    return None


def allowed_ecn_actions(user: User, ecn: DesignChangeNotice) -> list[str]:
    actions: list[str] = ["comment"]
    if not check_ecn_edit(user, ecn):
        actions += ["edit", "submit"]
    if not check_ecn_decide(user, ecn, None):
        actions += ["approve", "reject"]
    if not check_ecn_implement(user, ecn):
        actions.append("implement")
    if not check_ecn_cancel(user, ecn):
        actions.append("cancel")
    if not check_ecn_delete(user, ecn):
        actions.append("delete")
    return actions
