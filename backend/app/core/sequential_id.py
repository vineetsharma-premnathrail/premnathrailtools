from sqlalchemy import func, text
from sqlalchemy.orm import Session


def next_sequential_id(db: Session, *, prefix: str, column) -> str:
    """Generate the next `{prefix}{NNNN}` id without ever colliding.

    Two requests creating a record in the same module at the same instant
    used to both read the same "last number" before either had committed,
    then both tried to insert the same next number — a database
    unique-constraint collision that failed outright after a handful of
    blind retries (see git history for CRM's inquiries/tenders routes).

    Fix (same pattern already proven in app/modules/p2p/service.py's
    `_lock_number_series`): take a Postgres transaction-scoped advisory
    lock keyed on `prefix` before reading MAX(column). A second concurrent
    caller for the same prefix blocks here until the first request's
    transaction commits (or rolls back) — at which point the first
    request's row is visible (or absent), so the MAX query always sees
    the true latest value and two requests can never compute the same
    next number. They simply proceed one after another, never crash. The
    lock releases automatically at the end of the current transaction.
    """
    if db.get_bind().dialect.name == "postgresql":  # SQLite (tests) has no advisory locks
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
