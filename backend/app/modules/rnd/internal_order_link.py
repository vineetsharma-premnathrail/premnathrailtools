"""The Finance internal order behind an R&D project (2026-10-26).

New-development purchases are charged to an R&D project (Prototype / Research).
Finance still needs a cost object to book against, so the first time something
is charged to a project the system opens ONE internal order for it
(type 'development', code IO-<project number>) and remembers it on the project.
Requesters never see or pick it; everything downstream that follows
`pr.internal_order_id` (PO draft, Finance Controlling, journal lines) keeps
working unchanged. Not a route: callers hold the permission and scope checks."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.rnd.models.project import RndProject

# Stages / statuses after which nothing more can be charged to the project.
CLOSED_STAGES = ("handover", "closed")
CLOSED_STATUSES = ("cancelled",)


def project_label(project: RndProject) -> str:
    return f"{project.project_number} — {project.title}"[:255]


def closed_reason(project: RndProject) -> str | None:
    """Why nothing can be charged to the project any more (None = open)."""
    if getattr(project, "is_deleted", False):
        return "deleted"
    if project.status in CLOSED_STATUSES:
        return project.status
    if project.stage == "closed":
        return "closed"
    if project.stage == "handover" or project.handed_over_at is not None:
        return "handed over"
    return None


def _io_code(db: Session, project: RndProject) -> str:
    base = f"IO-{project.project_number}"[:30]
    code, n = base, 1
    while db.query(InternalOrder.id).filter(InternalOrder.code == code).first() is not None:
        n += 1
        suffix = f"-{n}"
        code = base[:30 - len(suffix)] + suffix
    return code


def ensure_internal_order_for_rnd_project(db: Session, project: RndProject) -> int:
    """The project's internal order id; opens it on first use (idempotent).
    Flushes, never commits - the caller's transaction owns it."""
    if project.internal_order_id:
        return project.internal_order_id
    io = InternalOrder(
        code=_io_code(db, project),
        name=project_label(project)[:200],
        description=f"{AUTO_DESCRIPTION} {project.project_number}.",
        order_type="development",
        start_date=project.start_date,
        end_date=project.target_end_date,
        budgeted_amount=project.budget_amount,
        status="open",
    )
    db.add(io)
    db.flush()
    project.internal_order_id = io.id
    db.flush()
    return io.id


AUTO_DESCRIPTION = "Opened automatically for R&D project"


def is_auto_order(io: InternalOrder | None) -> bool:
    """True for the order the system opened for the project; False for a budget
    Finance created and the project linked (Finance owns that one)."""
    return io is not None and (io.description or "").startswith(AUTO_DESCRIPTION)


def sync_internal_order(db: Session, project: RndProject) -> None:
    """Keep the project's internal order budget / dates / name in step with the
    project (no-op until the order exists, and for a budget Finance created).
    Call after the project is changed."""
    if not project.internal_order_id:
        return
    io = db.get(InternalOrder, project.internal_order_id)
    if not is_auto_order(io):
        return
    io.budgeted_amount = project.budget_amount
    io.start_date = project.start_date
    io.end_date = project.target_end_date
    io.name = project_label(project)[:200]
    db.flush()


__all__ = ["AUTO_DESCRIPTION", "is_auto_order", "CLOSED_STAGES", "CLOSED_STATUSES", "closed_reason", "ensure_internal_order_for_rnd_project",
           "project_label", "sync_internal_order"]
