"""Plain-function helpers for the standalone P2P module —
PR number generation, kept separate from routes so it's easy to unit test."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
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


def resolve_pr_approvers(db: Session, requester: "User", project_type: str, approver_ids: dict) -> dict[str, "User"]:
    """Validates the PR approvers under the manager-role matrix and returns
    them keyed by role. The role set comes from project_type ('existing' or
    'new' — see PR_APPROVAL_ROLE_SETS); every role slot is mandatory, and the
    requester picks ANY active user for each slot (per the 2026-09-30
    requirement change, neither the is_*_manager flags nor module access
    restrict PR approver pickers — being named on a PR itself grants access
    to that PR, see _requester_or_purchase in routes/p2p_requests.py). Per
    the 2026-09-30 "user self select kar sake" requirement, the requester MAY
    pick themselves for a slot and later sign it — the business accepted
    that this waives the PR-level four-eyes control (PO approval keeps its
    own SoD: the requester and the PO's creator can never approve the PO).
    Shared by every PR creation path (P2P New PR form and ERP "Raise PR").
    Raises ValueError with a user-facing reason."""
    from app.modules.p2p.models.p2p_request import PR_APPROVAL_ROLE_SETS, P2P_ROLE_LABELS

    if project_type not in PR_APPROVAL_ROLE_SETS:
        raise ValueError("Choose whether this requisition is for an existing project or a new project.")

    approvers: dict[str, User] = {}
    for role in PR_APPROVAL_ROLE_SETS[project_type]:
        label = P2P_ROLE_LABELS[role]
        approver_id = (approver_ids or {}).get(role)
        if approver_id is None:
            raise ValueError(f"{label} is required — pick who must approve this requisition.")
        approver = db.query(User).filter(User.id == approver_id, User.is_active == True).first()  # noqa: E712
        if not approver:
            raise ValueError(f"The selected {label} was not found or is no longer active — pick another user.")
        approvers[role] = approver
    return approvers
