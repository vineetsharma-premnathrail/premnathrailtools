"""Plain-function helpers for the standalone P2P module —
PR number generation, kept separate from routes so it's easy to unit test."""
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ


def generate_p2p_number(db: Session, category_code: str) -> str:
    """P2P-[CATEGORY]-[YEAR]-[NUMBER], sequence scoped per category+year."""
    year = date.today().year
    prefix = f"P2P-{category_code}-{year}-"
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
    last = db.query(func.max(RFQ.rfq_number)).filter(
        RFQ.rfq_number.like(f"{prefix}%")
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
