"""Plain-function helpers for the Project Management module — project
number generation, kept separate from routes so it's easy to unit test.
Mirrors app/modules/quality/service.py's number-generation pattern."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.projects.models.project import PmProject


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a given prefix.

    Takes a Postgres transaction-scoped advisory lock keyed on the prefix
    (e.g. "PRJ-2026-") before the caller reads MAX(...) and computes the next
    number. A second concurrent request generating a number for the same
    prefix blocks here until the first request's transaction commits (or
    rolls back) — at which point the first request's row is visible (or
    absent), so the MAX query below always sees the true latest value and
    two requests can never compute the same next number. The lock is
    released automatically at the end of the current transaction, so it
    covers the request's eventual db.commit(), not just this function.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_project_code(db: Session) -> str:
    """PRJ-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"PRJ-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(PmProject.project_code)).filter(
        PmProject.project_code.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
