"""Plain-function helpers for the standalone P2P module —
PR number generation, kept separate from routes so it's easy to unit test."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import LINE_CATEGORY, P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.main.models.user import User


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
    if db.get_bind().dialect.name == "postgresql":  # SQLite (tests) has no advisory locks
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def generate_p2p_number(db: Session, category_code: str | None = None) -> str:
    """P2P-[YEAR]-[NUMBER] for a requisition whose lines decide what is bought
    (no category, or LINE_CATEGORY — 2026-10-27); P2P-[CATEGORY]-[YEAR]-[NUMBER]
    for the category-based ones still raised from Service Requests and
    Maintenance. Each series runs per year."""
    year = date.today().year
    prefix = f"P2P-{year}-" if not category_code or category_code == LINE_CATEGORY else f"P2P-{category_code}-{year}-"
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


def generate_rtv_number(db: Session) -> str:
    """RTV-[YEAR]-[NUMBER] (Return to Vendor), sequence scoped per year."""
    from app.modules.p2p.models.vendor_return import P2PVendorReturn

    year = date.today().year
    prefix = f"RTV-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PVendorReturn.rtv_number)).filter(P2PVendorReturn.rtv_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


def compute_line_total(quantity: float, unit_price: float | None, tax_rate: float | None) -> float | None:
    if unit_price is None:
        return None
    subtotal = quantity * unit_price
    if tax_rate:
        subtotal += subtotal * (tax_rate / 100)
    return round(subtotal, 2)


# ---------------------------------------------------------------- Legacy approval (in-flight items)

# Who approves is the central approval engine now (app/modules/p2p/approvals.py,
# Organization › Approval Workflows). Only the Partner lookup is still needed, by
# the old Settings-scheme PO approval path that finishes POs already in flight.

def active_partners(db: Session) -> list[User]:
    """The company's Partners (Company Info → Partners) — any one gives the final PO approval."""
    return db.query(User).filter(User.is_active == True, User.is_partner == True).order_by(User.name).all()  # noqa: E712


def generate_ses_number(db: Session) -> str:
    """SES-[YEAR]-[NUMBER] — service entry sheets, sequence scoped per year."""
    from app.modules.p2p.models.service_entry import P2PServiceEntry

    year = date.today().year
    prefix = f"SES-{year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PServiceEntry.ses_number)).filter(P2PServiceEntry.ses_number.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}"
    return f"{prefix}0001"


def accepted_service_qty_by_po_item(db: Session, po_id: int) -> dict[int, float]:
    """Accepted service-entry quantity per PO line — what counts as
    "received" for a service line (it never goes through a GRN)."""
    from app.modules.p2p.models.service_entry import P2PServiceEntry

    rows = (db.query(P2PServiceEntry.po_item_id, func.coalesce(func.sum(P2PServiceEntry.quantity), 0))
            .filter(P2PServiceEntry.purchase_order_id == po_id, P2PServiceEntry.status == "accepted")
            .group_by(P2PServiceEntry.po_item_id).all())
    return {pid: float(q) for pid, q in rows}
