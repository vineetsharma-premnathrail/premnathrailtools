"""Controlling (CO) — account assignment and cost-object reporting.

Account assignment (SAP OKB9 / field status "cost object required")
    apply_account_assignment() runs on every journal line before it can exist
    (service.post_journal_entry / create_draft_journal / post_draft_journal)
    and on purchase-invoice lines when they are recorded:
      - an internal order must exist, be Open or In progress, and the posting
        date must sit inside its start/end dates;
      - a cost centre must exist, be active, and be valid on the posting date
        (effective_from / effective_to);
      - defaults: a line with an internal order but no cost centre takes the
        order's cost centre; a line with neither takes the ledger's
        default_cost_center_id;
      - on a ledger flagged cost_object_required, manual journals, purchase
        invoices and expense payments must carry a cost centre or an order.
    Reversals skip these checks — undoing a posting must always be possible,
    even after its cost centre was deactivated or its order closed.

Reports (read-only, posted lines only — JE_LEDGER_STATUSES)
    cost_object_line_items()   KSB1 / KOB1 line items with running total
    cost_center_actuals()      cost centre x ledger actuals for P&L ledgers
    internal_order_report()    KOB1 plan / actual / commitment / available
    internal_orders_overview() S_ALR_87012993 — every order at a glance

Commitments: an issued PO that carries internal_order_id commits its pre-GST
value less what has already been invoiced and posted against it (posted
purchase invoices are actuals). Draft and cancelled POs commit nothing.
"""
from __future__ import annotations

from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import (
    JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES, JE_MANUAL_POSTING_TYPES,
)
from app.modules.organization.models.cost_center import CostCenter

# Orders that may still receive postings (SAP: released, not TECO/closed).
IO_POSTABLE_STATUSES = ("open", "in_progress")
# Allowed status moves. Reopening a closed order needs a reason and a
# Partner's approval (routes/internal_orders.py).
IO_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "open": ("in_progress",),
    "in_progress": ("completed",),
    "completed": ("in_progress", "closed"),
    "closed": ("in_progress",),
}
IO_STATUS_LABELS = {"open": "Open", "in_progress": "In progress", "completed": "Completed", "closed": "Closed"}
# PO statuses whose open value is a commitment.
COMMITTING_PO_STATUSES = ("issued", "acknowledged", "partially_fulfilled", "fulfilled")
# Postings that aren't trading results (reports.NON_PL_POSTINGS).
_NON_PL_POSTINGS = ("year_end",)


def _r(x) -> float:
    return round(float(x or 0), 2)


def _d(x: date | None) -> str:
    return x.strftime("%d-%b-%Y") if x else "—"


def _cc_label(cc: CostCenter) -> str:
    return f"'{cc.code} — {cc.name}'"


def _io_label(io: InternalOrder) -> str:
    return f"'{io.code} — {io.name}'"


def requires_cost_object(posting_type: str, voucher_type: str | None) -> bool:
    """Which postings enforce GLAccount.cost_object_required: manual
    journals, purchase invoices and expense payments — the documents where a
    person decides who bears the cost. System postings (closing stock,
    depreciation runs, GST set-off, year end) don't."""
    if posting_type in JE_MANUAL_POSTING_TYPES:
        return True
    if posting_type == "invoice" and voucher_type == "purchase":
        return True
    return posting_type == "payment" and voucher_type == "payment"


def check_internal_order_postable(io: InternalOrder, posting_date: date, where: str) -> None:
    if io.status not in IO_POSTABLE_STATUSES:
        how = ("set it back to In progress under Finance › Masters › Internal Orders" if io.status == "completed"
               else "a closed order is reopened only with a Partner's approval (Finance › Masters › Internal Orders › Reopen)")
        raise ValueError(
            f"{where}: internal order {_io_label(io)} is {IO_STATUS_LABELS.get(io.status, io.status)} — no new postings "
            f"are allowed on it. Post to another order, or {how}."
        )
    if (io.start_date and posting_date < io.start_date) or (io.end_date and posting_date > io.end_date):
        raise ValueError(
            f"{where}: internal order {_io_label(io)} runs {_d(io.start_date)} to {_d(io.end_date)}, but the posting "
            f"date is {_d(posting_date)}. Change the date, or extend the order's dates under Finance › Masters › Internal Orders."
        )


def check_cost_center_postable(cc: CostCenter, posting_date: date, where: str) -> None:
    if (cc.status or "active") != "active":
        raise ValueError(
            f"{where}: cost centre {_cc_label(cc)} is {cc.status} — postings to it are blocked. Pick an active cost "
            f"centre, or re-activate it under Organization › Plants › (plant) › Cost centres."
        )
    if (cc.effective_from and posting_date < cc.effective_from) or (cc.effective_to and posting_date > cc.effective_to):
        raise ValueError(
            f"{where}: cost centre {_cc_label(cc)} is valid {_d(cc.effective_from)} to {_d(cc.effective_to)}, but the "
            f"posting date is {_d(posting_date)}. Pick a cost centre valid on that date, or extend its validity under "
            f"Organization › Plants › (plant) › Cost centres."
        )


def apply_account_assignment(db: Session, lines: list[dict], *, posting_date: date, enforce_required: bool,
                             label: str = "Line") -> None:
    """Fills default cost centres into `lines` (mutated in place) and checks
    every cost centre / internal order on them. Raises ValueError naming the
    line, the object and how to fix it."""
    gl_ids = {l.get("gl_account_id") for l in lines if l.get("gl_account_id")}
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_ids)).all()} if gl_ids else {}
    io_ids = {l.get("internal_order_id") for l in lines if l.get("internal_order_id")}
    orders = {o.id: o for o in db.query(InternalOrder).filter(InternalOrder.id.in_(io_ids)).all()} if io_ids else {}
    cc_cache: dict[int, CostCenter | None] = {}

    def cost_center(cc_id: int) -> CostCenter | None:
        if cc_id not in cc_cache:
            cc_cache[cc_id] = db.query(CostCenter).filter(CostCenter.id == cc_id).first()
        return cc_cache[cc_id]

    for i, line in enumerate(lines, start=1):
        where = f"{label} {i}"
        account = accounts.get(line.get("gl_account_id"))
        io = None
        if line.get("internal_order_id"):
            io = orders.get(line["internal_order_id"])
            if io is None:
                raise ValueError(f"{where}: internal order #{line['internal_order_id']} doesn't exist — pick it again from the list.")
            check_internal_order_postable(io, posting_date, where)
            if not line.get("cost_center_id") and io.cost_center_id:
                line["cost_center_id"] = io.cost_center_id
        if not line.get("cost_center_id") and io is None and account is not None and account.default_cost_center_id:
            line["cost_center_id"] = account.default_cost_center_id
        if line.get("cost_center_id"):
            cc = cost_center(line["cost_center_id"])
            if cc is None:
                raise ValueError(f"{where}: cost centre #{line['cost_center_id']} doesn't exist — pick it again from the list.")
            check_cost_center_postable(cc, posting_date, where)
        if (enforce_required and account is not None and account.cost_object_required
                and not line.get("cost_center_id") and not line.get("internal_order_id")):
            raise ValueError(
                f"{where}: ledger '{account.code} — {account.name}' is an overhead ledger and needs a cost centre or an "
                f"internal order — pick the cost centre that bears this cost (or the order it is spent on). Finance can "
                f"set a default cost centre on the ledger, or untick 'Cost object required', under Finance › Masters › Ledgers."
            )


def default_cost_center_for_department(db: Session, department_name: str | None) -> int | None:
    """The one active cost centre of a department, matched by the PR's
    department name. None when there is no match or more than one."""
    if not department_name or not department_name.strip():
        return None
    from app.modules.organization.models.department import Department

    rows = (
        db.query(CostCenter.id)
        .join(Department, CostCenter.department_id == Department.id)
        .filter(func.lower(Department.name) == department_name.strip().lower(), CostCenter.status == "active")
        .all()
    )
    return rows[0][0] if len(rows) == 1 else None


def default_purchase_assignment(db: Session, lines: list[dict], po) -> None:
    """Purchase-invoice line defaults (before apply_account_assignment): the
    PO's internal order, then the PR's own cost centre (a department
    running-cost requisition), then the PR department's cost centre."""
    if po is None:
        return
    pr_dept_cc = None
    if getattr(po, "p2p_request_id", None):
        from app.modules.p2p.models.p2p_request import P2PRequest

        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
        pr_dept_cc = (getattr(pr, "cost_center_id", None) if pr else None) or             default_cost_center_for_department(db, pr.department if pr else None)
    for line in lines:
        if not line.get("internal_order_id") and getattr(po, "internal_order_id", None):
            line["internal_order_id"] = po.internal_order_id
        if not line.get("cost_center_id") and not line.get("internal_order_id") and pr_dept_cc:
            line["cost_center_id"] = pr_dept_cc


# ─────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────

def cost_center_tree_ids(db: Session, cost_center_id: int, include_children: bool) -> list[int]:
    if not include_children:
        return [cost_center_id]
    children: dict[int, list[int]] = {}
    for cid, parent in db.query(CostCenter.id, CostCenter.parent_cost_center_id).all():
        if parent:
            children.setdefault(parent, []).append(cid)
    out, stack, seen = [], [cost_center_id], set()
    while stack:
        cid = stack.pop()
        if cid in seen:
            continue
        seen.add(cid)
        out.append(cid)
        stack.extend(children.get(cid, []))
    return out


def _default_range(db: Session, from_date: date | None, to_date: date | None) -> tuple[date, date]:
    from app.modules.accounts.services import fiscal

    to_date = to_date or date.today()
    if from_date is None:
        from_date = fiscal.fiscal_year_for(db, to_date).start_date
    if from_date > to_date:
        raise ValueError("The 'from' date is after the 'to' date — swap them.")
    return from_date, to_date


def _party_names(db: Session, vendor_ids: set, customer_ids: set) -> tuple[dict, dict]:
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.crm.models.organization import Organization

    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    customers = {c.id: c.name for c in db.query(Organization).filter(Organization.id.in_(customer_ids)).all()} if customer_ids else {}
    return vendors, customers


def cost_object_line_items(db: Session, *, object_type: str, object_id: int, include_children: bool = False,
                           from_date: date | None = None, to_date: date | None = None,
                           gl_account_id: int | None = None) -> dict:
    """KSB1 (cost centre) / KOB1 (internal order) actual line items, oldest
    first, with a running debit-minus-credit total. An internal order with no
    from_date shows its whole life."""
    if object_type == "cost_center":
        obj = db.query(CostCenter).filter(CostCenter.id == object_id).first()
        if not obj:
            raise ValueError("Cost centre not found — it may have been deleted. Reload the list.")
        ids = cost_center_tree_ids(db, object_id, include_children)
        col = JournalEntryLine.cost_center_id
        from_date, to_date = _default_range(db, from_date, to_date)
    elif object_type == "internal_order":
        obj = db.query(InternalOrder).filter(InternalOrder.id == object_id).first()
        if not obj:
            raise ValueError("Internal order not found — it may have been deleted. Reload the list.")
        ids = [object_id]
        col = JournalEntryLine.internal_order_id
        to_date = to_date or date.today()
        if from_date and from_date > to_date:
            raise ValueError("The 'from' date is after the 'to' date — swap them.")
    else:
        raise ValueError("object_type must be 'cost_center' or 'internal_order'.")

    q = (
        db.query(JournalEntryLine, JournalEntry)
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(col.in_(ids), JournalEntry.status.in_(JE_LEDGER_STATUSES),
                JournalEntry.posting_type.notin_(_NON_PL_POSTINGS), JournalEntry.posting_date <= to_date)
    )
    if from_date is not None:
        q = q.filter(JournalEntry.posting_date >= from_date)
    if gl_account_id is not None:
        q = q.filter(JournalEntryLine.gl_account_id == gl_account_id)
    pairs = q.order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc(), JournalEntryLine.line_number.asc()).all()

    gl = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_({l.gl_account_id for l, _ in pairs})).all()} if pairs else {}
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_({l.cost_center_id for l, _ in pairs if l.cost_center_id})).all()} if pairs else {}
    ios = {o.id: o for o in db.query(InternalOrder).filter(InternalOrder.id.in_({l.internal_order_id for l, _ in pairs if l.internal_order_id})).all()} if pairs else {}
    vendors, customers = _party_names(db, {l.vendor_id for l, _ in pairs if l.vendor_id}, {l.customer_id for l, _ in pairs if l.customer_id})

    running = 0.0
    rows = []
    for line, entry in pairs:
        running = _r(running + line.debit_amount - line.credit_amount)
        a, cc, io = gl.get(line.gl_account_id), ccs.get(line.cost_center_id), ios.get(line.internal_order_id)
        rows.append({
            "journal_entry_line_id": line.id, "journal_entry_id": entry.id, "entry_number": entry.entry_number,
            "voucher_type": entry.voucher_type, "posting_type": entry.posting_type, "posting_date": entry.posting_date,
            "status": entry.status, "gl_account_id": line.gl_account_id,
            "gl_account_code": a.code if a else None, "gl_account_name": a.name if a else None,
            "cost_center_id": line.cost_center_id, "cost_center_code": cc.code if cc else None, "cost_center_name": cc.name if cc else None,
            "internal_order_id": line.internal_order_id, "internal_order_code": io.code if io else None,
            "party_name": vendors.get(line.vendor_id) or customers.get(line.customer_id),
            "description": line.remarks or entry.description,
            "debit_amount": _r(line.debit_amount), "credit_amount": _r(line.credit_amount), "running_total": running,
        })
    return {
        "object_type": object_type, "object_id": object_id, "code": obj.code, "name": obj.name,
        "include_children": include_children, "cost_center_ids": ids if object_type == "cost_center" else None,
        "from_date": from_date, "to_date": to_date, "gl_account_id": gl_account_id, "rows": rows,
        "total_debit": _r(sum(r["debit_amount"] for r in rows)), "total_credit": _r(sum(r["credit_amount"] for r in rows)),
        "total": running,
    }


def cost_center_actuals(db: Session, *, from_date: date | None = None, to_date: date | None = None,
                        cost_center_id: int | None = None, include_children: bool = True) -> dict:
    """Cost centre x ledger actuals (debit minus credit) for P&L ledgers over
    a period. With cost_center_id, only that centre (and its sub-centres when
    include_children) — one column per centre plus a group total. Without it,
    every centre with postings, plus an 'Unassigned' column for P&L lines
    that carry no cost centre."""
    from_date, to_date = _default_range(db, from_date, to_date)
    pl_ids = [a.id for a in db.query(GLAccount).filter(GLAccount.account_type.in_(("revenue", "expense"))).all()]
    if not pl_ids:
        return {"from_date": from_date, "to_date": to_date, "cost_centers": [], "rows": [], "column_totals": {}, "grand_total": 0.0,
                "unassigned_total": 0.0}
    q = (
        db.query(JournalEntryLine.cost_center_id, JournalEntryLine.gl_account_id,
                 func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0))
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_type.notin_(_NON_PL_POSTINGS),
                JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date,
                JournalEntryLine.gl_account_id.in_(pl_ids))
    )
    scope_ids = None
    if cost_center_id is not None:
        if not db.query(CostCenter).filter(CostCenter.id == cost_center_id).first():
            raise ValueError("Cost centre not found — it may have been deleted. Reload the list.")
        scope_ids = cost_center_tree_ids(db, cost_center_id, include_children)
        q = q.filter(JournalEntryLine.cost_center_id.in_(scope_ids))
    totals = q.group_by(JournalEntryLine.cost_center_id, JournalEntryLine.gl_account_id).all()

    cells: dict[int, dict[str, float]] = {}
    cc_ids: set[int] = set(scope_ids or [])
    for cc_id, gl_id, dr, cr in totals:
        key = str(cc_id) if cc_id else "unassigned"
        cells.setdefault(gl_id, {})[key] = _r(cells.get(gl_id, {}).get(key, 0) + float(dr) - float(cr))
        if cc_id:
            cc_ids.add(cc_id)
    ccs = db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).order_by(CostCenter.code.asc()).all() if cc_ids else []
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(list(cells))).all()} if cells else {}

    rows = []
    column_totals: dict[str, float] = {}
    for gl_id, amounts in cells.items():
        a = accounts.get(gl_id)
        assigned = _r(sum(v for k, v in amounts.items() if k != "unassigned"))
        rows.append({"gl_account_id": gl_id, "gl_account_code": a.code if a else None, "gl_account_name": a.name if a else None,
                     "account_type": a.account_type if a else None, "cost_object_required": bool(a.cost_object_required) if a else False,
                     "amounts": amounts, "total": assigned, "unassigned": amounts.get("unassigned", 0.0)})
        for k, v in amounts.items():
            column_totals[k] = _r(column_totals.get(k, 0) + v)
    # Costs first (debits), then revenue; by ledger code within each.
    rows.sort(key=lambda r: (0 if r["account_type"] == "expense" else 1, r["gl_account_code"] or ""))
    return {
        "from_date": from_date, "to_date": to_date, "cost_center_id": cost_center_id, "include_children": include_children,
        "cost_centers": [{"id": c.id, "code": c.code, "name": c.name, "parent_cost_center_id": c.parent_cost_center_id,
                          "status": c.status} for c in ccs],
        "rows": rows, "column_totals": column_totals,
        "grand_total": _r(sum(v for k, v in column_totals.items() if k != "unassigned")),
        "unassigned_total": column_totals.get("unassigned", 0.0),
    }


def _io_actuals(db: Session, io_ids: list[int], to_date: date) -> dict[int, float]:
    if not io_ids:
        return {}
    q = (
        db.query(JournalEntryLine.internal_order_id,
                 func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0))
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntryLine.internal_order_id.in_(io_ids), JournalEntry.status.in_(JE_LEDGER_STATUSES),
                JournalEntry.posting_type.notin_(_NON_PL_POSTINGS), JournalEntry.posting_date <= to_date)
        .group_by(JournalEntryLine.internal_order_id)
    )
    return {io_id: _r(float(d) - float(c)) for io_id, d, c in q.all()}


def io_commitments(db: Session, io_ids: list[int]) -> dict[int, list[dict]]:
    """{io_id: [open PO rows]} — issued POs carrying the order, valued pre-GST
    (qty x unit price), less the pre-GST value of posted purchase invoices
    against each PO."""
    if not io_ids:
        return {}
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.accounts.models.vendor_invoice import VendorInvoice
    from sqlalchemy.orm import selectinload

    pos = (
        db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items))
        .filter(P2PPurchaseOrder.internal_order_id.in_(io_ids), P2PPurchaseOrder.status.in_(COMMITTING_PO_STATUSES))
        .all()
    )
    if not pos:
        return {}
    invoiced = dict(
        db.query(VendorInvoice.purchase_order_id, func.coalesce(func.sum(VendorInvoice.invoice_amount), 0))
        .filter(VendorInvoice.purchase_order_id.in_([p.id for p in pos]), VendorInvoice.status == "posted")
        .group_by(VendorInvoice.purchase_order_id).all()
    )
    out: dict[int, list[dict]] = {}
    for po in pos:
        value = _r(sum((i.quantity or 0) * (i.unit_price or 0) for i in po.items))
        done = _r(invoiced.get(po.id, 0))
        open_value = _r(max(value - done, 0))
        if open_value <= 0:
            continue
        out.setdefault(po.internal_order_id, []).append({
            "purchase_order_id": po.id, "po_number": po.po_number, "po_date": po.po_date, "vendor_name": po.vendor_name,
            "status": po.status, "po_value": value, "invoiced_value": done, "open_value": open_value,
        })
    return out


def _io_summary(io: InternalOrder, actual: float, commit_rows: list[dict], ccs: dict) -> dict:
    budget = _r(io.budgeted_amount) if io.budgeted_amount is not None else None
    commitment = _r(sum(r["open_value"] for r in commit_rows))
    cc = ccs.get(io.cost_center_id)
    return {
        "id": io.id, "code": io.code, "name": io.name, "order_type": io.order_type, "status": io.status,
        "start_date": io.start_date, "end_date": io.end_date,
        "cost_center_id": io.cost_center_id, "cost_center_name": cc.name if cc else None,
        "budgeted_amount": budget, "actual_amount": actual, "commitment_amount": commitment,
        "available_amount": _r(budget - actual - commitment) if budget is not None else None,
        "consumed_pct": _r((actual + commitment) / budget * 100) if budget else None,
    }


def internal_orders_overview(db: Session, *, to_date: date | None = None, status: str | None = None) -> dict:
    """Plan / actual (life to date) / commitment / available for every order."""
    to_date = to_date or date.today()
    q = db.query(InternalOrder)
    if status:
        q = q.filter(InternalOrder.status == status)
    orders = q.order_by(InternalOrder.code.asc()).all()
    ids = [o.id for o in orders]
    actuals = _io_actuals(db, ids, to_date)
    commits = io_commitments(db, ids)
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_({o.cost_center_id for o in orders if o.cost_center_id})).all()}
    rows = [_io_summary(o, actuals.get(o.id, 0.0), commits.get(o.id, []), ccs) for o in orders]
    return {"to_date": to_date, "rows": rows}


def internal_order_report(db: Session, *, internal_order_id: int, from_date: date | None = None,
                          to_date: date | None = None) -> dict:
    """KOB1 for one order: summary (plan / actual life to date / commitment /
    available), per-ledger actuals, open POs, and the line items."""
    io = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).first()
    if not io:
        raise ValueError("Internal order not found — it may have been deleted. Reload the list.")
    to_date = to_date or date.today()
    actual = _io_actuals(db, [io.id], to_date).get(io.id, 0.0)
    commit_rows = io_commitments(db, [io.id]).get(io.id, [])
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id == io.cost_center_id).all()} if io.cost_center_id else {}
    items = cost_object_line_items(db, object_type="internal_order", object_id=io.id, from_date=from_date, to_date=to_date)
    by_gl: dict[int, dict] = {}
    for r in items["rows"]:
        g = by_gl.setdefault(r["gl_account_id"], {"gl_account_id": r["gl_account_id"], "gl_account_code": r["gl_account_code"],
                                                 "gl_account_name": r["gl_account_name"], "amount": 0.0})
        g["amount"] = _r(g["amount"] + r["debit_amount"] - r["credit_amount"])
    return {
        "summary": _io_summary(io, actual, commit_rows, ccs),
        "allowed_transitions": list(IO_TRANSITIONS.get(io.status, ())),
        "by_ledger": sorted(by_gl.values(), key=lambda g: g["gl_account_code"] or ""),
        "commitments": commit_rows,
        "line_items": items,
    }


def journal_line_filter(db: Session, query, *, cost_center_id: int | None = None, internal_order_id: int | None = None,
                        include_children: bool = False):
    """Restricts a JournalEntry query to entries with a line on the cost
    centre (and its sub-centres) / internal order — for the journal list."""
    if cost_center_id is not None:
        ids = cost_center_tree_ids(db, cost_center_id, include_children)
        query = query.filter(JournalEntry.id.in_(
            db.query(JournalEntryLine.journal_entry_id).filter(JournalEntryLine.cost_center_id.in_(ids))))
    if internal_order_id is not None:
        query = query.filter(JournalEntry.id.in_(
            db.query(JournalEntryLine.journal_entry_id).filter(JournalEntryLine.internal_order_id == internal_order_id)))
    return query
