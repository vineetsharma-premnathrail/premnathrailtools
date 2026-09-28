"""Plain-function helpers for the Store module — document number
generation, kept separate from routes so it's easy to unit test. Mirrors
app.modules.p2p.service's locking strategy."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.store.models.material_issue import StoreMaterialIssue
from app.modules.store.models.material_return import StoreMaterialReturn
from app.modules.store.models.stock_transfer import StoreStockTransfer
from app.modules.store.models.stock_adjustment import StoreStockAdjustment
from app.modules.store.models.stock_reservation import StoreStockReservation


def _lock_number_series(db: Session, prefix: str) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_material_issue_number(db: Session) -> str:
    """MI-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"MI-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreMaterialIssue.issue_number)).filter(
        StoreMaterialIssue.issue_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_stock_transfer_number(db: Session) -> str:
    """ST-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"ST-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockTransfer.transfer_number)).filter(
        StoreStockTransfer.transfer_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_stock_adjustment_number(db: Session) -> str:
    """SA-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"SA-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockAdjustment.adjustment_number)).filter(
        StoreStockAdjustment.adjustment_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_stock_reservation_number(db: Session) -> str:
    """RES-[YEAR]-[NUMBER], sequence scoped per year. (Not "SR-" — that
    prefix is already used for Service Requests in the ERP module; a
    different table means no functional collision, but a different prefix
    avoids two unrelated docs both showing as "SR-2026-0001" to a user.)"""
    year = date.today().year
    prefix = f"RES-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreStockReservation.reservation_number)).filter(
        StoreStockReservation.reservation_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_material_return_number(db: Session) -> str:
    """MR-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"MR-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreMaterialReturn.return_number)).filter(
        StoreMaterialReturn.return_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"
