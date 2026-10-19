"""PEW-<YYYY>-<NNNN>: ONE number series for every project of the company —
the Order Project created when a Sales Order is confirmed (sales.order_projects)
and the internal Project Management project (projects) — so a number is never
used twice across the two (user decision 2026-10-19; it replaced OP-… and PRJ-…).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

PREFIX = "PEW"


def pew_prefix(year: int) -> str:
    return f"{PREFIX}-{year}-"


def _tail(number: str | None) -> int:
    t = (number or "").rsplit("-", 1)[-1]
    return int(t) if t.isdigit() else 0


def next_pew_number(db: Session, on: date | None = None) -> str:
    """The next free PEW number of the year, across Order Projects and PM projects.
    An advisory lock (Postgres) keeps two simultaneous creations from sharing one."""
    from app.modules.projects.models.project import PmProject
    from app.modules.sales.models.order_project import OrderProject

    prefix = pew_prefix((on or date.today()).year)
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": prefix})
    used = [n for (n,) in db.query(OrderProject.op_number).filter(OrderProject.op_number.like(f"{prefix}%")).all()]
    used += [n for (n,) in db.query(PmProject.project_code).filter(PmProject.project_code.like(f"{prefix}%")).all()]
    return f"{prefix}{max((_tail(n) for n in used), default=0) + 1:04d}"


def pew_number_taken(db: Session, number: str, *, exclude_pm_id: int | None = None) -> str | None:
    """Who already holds `number` (either series), for a clear refusal; None = free."""
    from app.modules.projects.models.project import PmProject
    from app.modules.sales.models.order_project import OrderProject

    op = db.query(OrderProject).filter(OrderProject.op_number == number).first()
    if op:
        return f"Order Project '{op.title}'"
    q = db.query(PmProject).filter(PmProject.project_code == number)
    if exclude_pm_id:
        q = q.filter(PmProject.id != exclude_pm_id)
    pm = q.first()
    return f"project '{pm.name}'" if pm else None
