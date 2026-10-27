"""Finance budgets linked to projects (2026-10-27).

Finance creates the budget (an internal order, Finance › Masters). A Project
Management project or an R&D project links to one; everything charged to that
budget is then the project's spend:
    committed  issued purchase orders not yet invoiced (pre-GST)
    actual     posted vouchers carrying the budget (purchase invoices, expenses,
               journals)
    available  budget - actual - committed
One budget belongs to at most one project so nothing is counted twice.
Not a route: callers hold the permission and scope checks."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.services import controlling

LINKABLE_STATUSES = controlling.IO_POSTABLE_STATUSES
# Most recent posted lines shown on the project's budget card.
RECENT_LINES = 25


def _holders(db: Session) -> dict[int, str]:
    """{internal_order_id: 'the project holding it'} for every linked budget."""
    from app.modules.projects.models.project import PmProject
    from app.modules.rnd.models.project import RndProject

    out: dict[int, str] = {}
    for io_id, code, name in db.query(PmProject.internal_order_id, PmProject.project_code, PmProject.name).filter(
            PmProject.internal_order_id.isnot(None)).all():
        out[io_id] = f"project {code}"
    for io_id, number, title in db.query(RndProject.internal_order_id, RndProject.project_number, RndProject.title).filter(
            RndProject.internal_order_id.isnot(None), RndProject.is_deleted == False).all():  # noqa: E712
        out[io_id] = f"R&D project {number}"
    return out


def budget_options(db: Session, *, keep_id: int | None = None) -> list[dict]:
    """Open Finance budgets no other project holds (plus `keep_id`, the
    project's current one), sorted by code, with what is still available."""
    held = _holders(db)
    q = db.query(InternalOrder).filter(InternalOrder.status.in_(LINKABLE_STATUSES))
    orders = [o for o in q.order_by(InternalOrder.code.asc()).all() if o.id not in held or o.id == keep_id]
    if keep_id and all(o.id != keep_id for o in orders):
        current = db.get(InternalOrder, keep_id)
        if current:
            orders.append(current)
    ids = [o.id for o in orders]
    actuals = controlling._io_actuals(db, ids, date.today())
    commits = controlling.io_commitments(db, ids)
    rows = []
    for o in orders:
        s = controlling._io_summary(o, actuals.get(o.id, 0.0), commits.get(o.id, []), {})
        rows.append({"id": o.id, "code": o.code, "name": o.name, "order_type": o.order_type, "status": o.status,
                     "end_date": o.end_date, "budgeted_amount": s["budgeted_amount"], "available_amount": s["available_amount"]})
    return rows


def check_linkable(db: Session, internal_order_id: int, *, keep_id: int | None = None) -> InternalOrder:
    """The budget to link, or ValueError with the reason and the fix."""
    io = db.get(InternalOrder, internal_order_id)
    if io is None:
        raise ValueError(f"Finance budget #{internal_order_id} doesn't exist — it may have been deleted. Pick the budget again from the list.")
    if io.id == keep_id:
        return io
    if io.status not in LINKABLE_STATUSES:
        label = controlling.IO_STATUS_LABELS.get(io.status, io.status)
        raise ValueError(f"Budget {io.code} is {label} in Finance — only Open or In progress budgets can be linked. Ask Finance to reopen it, or pick another budget.")
    holder = _holders(db).get(io.id)
    if holder:
        raise ValueError(f"Budget {io.code} is already linked to {holder}. One budget belongs to one project so spend is not counted twice — ask Finance to create a separate budget for this project.")
    return io


def can_see_ledger(user) -> bool:
    """Ledger accounts and voucher lines behind a budget are Finance data: shown only to users
    who may open Finance › Internal Orders or Financial Reports."""
    from app.core.permission_registry import can_perform
    return can_perform(user, "accounts", "internal_orders", "view") or can_perform(user, "accounts", "financial_reports", "view")


def check_unlinkable(db: Session, io: InternalOrder) -> None:
    """ValueError when spend is already booked on the budget — moving the
    project away would leave that spend behind, so it must stay."""
    actual = controlling._io_actuals(db, [io.id], date.today()).get(io.id, 0.0)
    committed = sum(r["open_value"] for r in controlling.io_commitments(db, [io.id]).get(io.id, []))
    if actual or committed:
        raise ValueError(f"Budget {io.code} already has spend booked (posted vouchers or open purchase orders), "
                         "so the project can't move to another budget. Ask Finance to change the amount on that budget instead.")


def budget_spend(db: Session, internal_order_id: int | None, *, ledger_detail: bool = True) -> dict:
    """Budget / committed / actual / available for the project's budget, its
    open purchase orders and the most recent posted lines. `linked` is False
    when the project has no budget yet."""
    if not internal_order_id or db.get(InternalOrder, internal_order_id) is None:
        return {"linked": False, "summary": None, "commitments": [], "recent_lines": [], "line_count": 0}
    rep = controlling.internal_order_report(db, internal_order_id=internal_order_id)
    rows = rep["line_items"]["rows"]
    recent = [{k: r[k] for k in ("journal_entry_id", "entry_number", "voucher_type", "posting_date", "gl_account_code",
                                 "gl_account_name", "party_name", "description", "debit_amount", "credit_amount")}
              for r in reversed(rows[-RECENT_LINES:])]
    if not ledger_detail:
        # Totals and open POs only — ledger accounts and voucher lines are Finance's (accounts module).
        return {"linked": True, "summary": rep["summary"], "by_ledger": [], "commitments": rep["commitments"],
                "recent_lines": [], "line_count": len(rows), "ledger_hidden": True}
    return {"linked": True, "summary": rep["summary"], "by_ledger": rep["by_ledger"], "commitments": rep["commitments"],
            "recent_lines": recent, "line_count": len(rows)}


__all__ = ["LINKABLE_STATUSES", "budget_options", "budget_spend", "can_see_ledger", "check_linkable", "check_unlinkable"]
