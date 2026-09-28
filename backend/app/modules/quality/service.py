"""Plain-function helpers for the Quality module — inspection plan and
inspection number generation, kept separate from routes so it's easy to
unit test. Mirrors app/modules/p2p/service.py's number-generation pattern."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.quality.models.inspection_plan import QualityInspectionPlan
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.rejection import QualityRejection
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a given prefix.

    Takes a Postgres transaction-scoped advisory lock keyed on the prefix
    (e.g. "IP-2026-") before the caller reads MAX(...) and computes the next
    number. A second concurrent request generating a number for the same
    prefix blocks here until the first request's transaction commits (or
    rolls back) — at which point the first request's row is visible (or
    absent), so the MAX query below always sees the true latest value and
    two requests can never compute the same next number. The lock is
    released automatically at the end of the current transaction, so it
    covers the request's eventual db.commit(), not just this function.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_inspection_plan_number(db: Session) -> str:
    """IP-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"IP-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityInspectionPlan.plan_number)).filter(
        QualityInspectionPlan.plan_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_ncr_number(db: Session) -> str:
    """NCR-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"NCR-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityNcr.ncr_number)).filter(
        QualityNcr.ncr_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_rejection_number(db: Session) -> str:
    """REJ-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"REJ-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityRejection.rejection_number)).filter(
        QualityRejection.rejection_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_capa_number(db: Session) -> str:
    """CAPA-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"CAPA-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityCapa.capa_number)).filter(
        QualityCapa.capa_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_complaint_number(db: Session) -> str:
    """COMP-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"COMP-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityCustomerComplaint.complaint_number)).filter(
        QualityCustomerComplaint.complaint_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_inspection_number(db: Session, type_code: str) -> str:
    """INSP-[TYPE]-[YEAR]-[NUMBER], sequence scoped per type_code+year.
    `type_code` is one of "INC" (incoming), "PROC" (in-process), "FIN" (final)."""
    year = date.today().year
    prefix = f"INSP-{type_code}-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(QualityInspection.inspection_number)).filter(
        QualityInspection.inspection_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
