"""Task approval requests, shared by requirement tasks and project tasks.

The routers own who may do what (assignee asks; the task's reviewer decides)
and the notifications; this module owns the request rows and their rules.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.rnd.models.task_approval import RndTaskApproval


def pending(db: Session, kind: str, task_id: int) -> RndTaskApproval | None:
    return db.query(RndTaskApproval).filter(
        RndTaskApproval.task_kind == kind, RndTaskApproval.task_id == task_id, RndTaskApproval.status == "pending",
    ).first()


def get(db: Session, kind: str, approval_id: int) -> RndTaskApproval:
    row = db.query(RndTaskApproval).filter(RndTaskApproval.id == approval_id, RndTaskApproval.task_kind == kind).first()
    if not row:
        raise HTTPException(status_code=404, detail="This approval request no longer exists — refresh the page.")
    return row


def create(db: Session, kind: str, task_id: int, user: User, request: str) -> RndTaskApproval:
    request = (request or "").strip()
    if not request:
        raise HTTPException(status_code=422, detail="Write what you need approved — e.g. the drawing, material or deviation and why.")
    if pending(db, kind, task_id):
        raise HTTPException(status_code=409, detail="This task already has an approval request waiting for a decision. Wait for it, or withdraw it and ask again.")
    row = RndTaskApproval(task_kind=kind, task_id=task_id, request=request, document_ids=[], status="pending",
                          requested_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(row)
    db.flush()
    return row


def decide(row: RndTaskApproval, user: User, decision: str, remarks: str | None) -> None:
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"This approval request was already {row.status}.")
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="Decision must be approve or reject.")
    remarks = (remarks or "").strip() or None
    if decision == "reject" and not remarks:
        raise HTTPException(status_code=422, detail="Enter why you reject it — the assignee needs to know what to change.")
    row.status = "approved" if decision == "approve" else "rejected"
    row.decided_by_id = user.id
    row.decided_at = datetime.now(timezone.utc)
    row.decision_remarks = remarks


def withdraw(row: RndTaskApproval, user: User) -> None:
    if row.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the person who asked for this approval can withdraw it.")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"This approval request was already {row.status}.")
    row.status = "withdrawn"
    row.decided_at = datetime.now(timezone.utc)


def ensure_task_open(task, what: str = "decide this approval request") -> None:
    """Approval requests belong to an open task — once the task is completed
    or cancelled a pending request can't be decided any more."""
    if task.status != "open":
        raise HTTPException(
            status_code=409,
            detail=f"The task \"{task.title}\" is {task.status}, so you can't {what}. Reopen the task first if the request still matters.",
        )


def withdraw_pending(db: Session, kind: str, task_ids: list[int]) -> None:
    """A task was cancelled: its pending approval requests are withdrawn so
    they stop waiting in the reviewer's queue."""
    if not task_ids:
        return
    now = datetime.now(timezone.utc)
    for row in db.query(RndTaskApproval).filter(
        RndTaskApproval.task_kind == kind, RndTaskApproval.task_id.in_(task_ids), RndTaskApproval.status == "pending",
    ).all():
        row.status = "withdrawn"
        row.decided_at = now
        row.decision_remarks = row.decision_remarks or "Withdrawn automatically — the task was cancelled."


def ensure_none_pending(db: Session, kind: str, task_id: int) -> None:
    if pending(db, kind, task_id):
        raise HTTPException(status_code=409, detail="An approval request on this task is still waiting for a decision. Wait for it, or withdraw it, before completing the task.")


def serialize(db: Session, kind: str, task_ids: list[int], docs_by_id: dict[int, dict]) -> dict[int, list[dict]]:
    """task id -> its approval requests (newest last). docs_by_id: document id -> serialized document."""
    if not task_ids:
        return {}
    rows = db.query(RndTaskApproval).filter(RndTaskApproval.task_kind == kind, RndTaskApproval.task_id.in_(task_ids)).order_by(RndTaskApproval.id.asc()).all()
    uids = {r.requested_by_id for r in rows} | {r.decided_by_id for r in rows if r.decided_by_id}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}

    def name(uid):
        u = users.get(uid)
        return (u.name or u.email) if u else None

    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r.task_id, []).append({
            "id": r.id, "request": r.request, "status": r.status,
            "requested_by_id": r.requested_by_id, "requested_by": name(r.requested_by_id),
            "requested_at": r.created_at.isoformat() if r.created_at else None,
            "decided_by": name(r.decided_by_id), "decided_at": r.decided_at.isoformat() if r.decided_at else None,
            "decision_remarks": r.decision_remarks,
            "documents": [docs_by_id[i] for i in (r.document_ids or []) if i in docs_by_id],
        })
    return out
