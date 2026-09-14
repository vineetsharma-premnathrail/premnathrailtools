"""Plain-function helpers for the standalone P2P module —
PR number generation, kept separate from routes so it's easy to unit test."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a given prefix.

    Takes a Postgres transaction-scoped advisory lock keyed on the prefix
    (e.g. "PO-2026-") before the caller reads MAX(...) and computes the next
    number. A second concurrent request generating a number for the same
    prefix blocks here until the first request's transaction commits (or
    rolls back) — at which point the first request's row is visible (or
    absent), so the MAX query below always sees the true latest value and
    two requests can never compute the same next number. The lock is
    released automatically at the end of the current transaction, so it
    covers the request's eventual db.commit(), not just this function.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_p2p_number(db: Session, category_code: str) -> str:
    """P2P-[CATEGORY]-[YEAR]-[NUMBER], sequence scoped per category+year."""
    year = date.today().year
    prefix = f"P2P-{category_code}-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PRequest.p2p_number)).filter(
        P2PRequest.p2p_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_po_number(db: Session) -> str:
    """PO-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"PO-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PPurchaseOrder.po_number)).filter(
        P2PPurchaseOrder.po_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_rfq_number(db: Session) -> str:
    """RFQ-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"RFQ-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(RFQ.rfq_number)).filter(
        RFQ.rfq_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def generate_grn_number(db: Session) -> str:
    """GRN-[YEAR]-[NUMBER], sequence scoped per year."""
    year = date.today().year
    prefix = f"GRN-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PGoodsReceipt.grn_number)).filter(
        P2PGoodsReceipt.grn_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def compute_line_total(quantity: float, unit_price: float | None, tax_rate: float | None) -> float | None:
    if unit_price is None:
        return None
    subtotal = quantity * unit_price
    if tax_rate:
        subtotal += subtotal * (tax_rate / 100)
    return round(subtotal, 2)
