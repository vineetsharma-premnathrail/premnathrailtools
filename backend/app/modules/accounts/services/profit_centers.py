"""Profit centre accounting (SAP EC-PCA: KE51-KE53 master, KE5Z line items,
plant / business-line P&L).

Derivation (called from accounts.service._add_lines for every journal line):
  1. explicit `profit_center_id` on the line — must be active and valid on
     the posting date, else a real error;
  2. the line's cost centre → CostCenter.profit_center_id (else the cost
     centre's plant → Branch.default_profit_center_id);
  3. the line's internal order → its cost centre's profit centre;
  4. the document behind the journal: a sales invoice raised from a sales
     order (plant = SO branch, business line from the order type) or from a
     service request (business line 'service');
  5. the company default profit centre (is_default).
A derived profit centre that is inactive or outside its validity is skipped
(the next rule applies) — derivation never blocks a posting. No profit
centres set up = nothing derived (NULL), exactly as before.

Reports read posted lines only (JE_LEDGER_STATUSES), so profit-centre
totals always agree with the P&L."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES
from app.modules.organization.models.cost_center import CostCenter
from app.modules.organization.models.profit_center import (
    PROFIT_CENTER_SEGMENT_LABELS, PROFIT_CENTER_SEGMENTS, PROFIT_CENTER_STATUSES, ProfitCenter,
)

# Sales order type → business line.
SO_TYPE_SEGMENT = {"road_rail_vehicle": "machines", "rail_bound_vehicle": "machines", "accessories": "spares", "other": None,
                   # legacy values, kept until every old row is migrated
                   "rrv_supply": "machines", "spares": "spares", "service": "service"}
UNASSIGNED = "unassigned"


def _r(x) -> float:
    return round(float(x or 0), 2)


def label(pc: ProfitCenter | None) -> str | None:
    return f"{pc.code} — {pc.name}" if pc else None


def is_valid_on(pc: ProfitCenter, on: date) -> bool:
    if pc.status != "active":
        return False
    if pc.valid_from and on < pc.valid_from:
        return False
    if pc.valid_to and on > pc.valid_to:
        return False
    return True


def check_postable(pc: ProfitCenter | None, on: date, where: str, pc_id: int | None = None) -> None:
    if pc is None:
        raise ValueError(f"{where}: profit centre #{pc_id} doesn't exist — pick it again from the list.")
    if pc.status != "active":
        raise ValueError(f"{where}: profit centre {pc.code} — {pc.name} is inactive. Pick an active profit centre, or "
                         f"reactivate it under Finance › Controlling › Profit Centres.")
    if not is_valid_on(pc, on):
        frm = pc.valid_from.strftime("%d-%b-%Y") if pc.valid_from else "the start"
        to = pc.valid_to.strftime("%d-%b-%Y") if pc.valid_to else "open-ended"
        raise ValueError(f"{where}: profit centre {pc.code} is valid {frm} to {to}, not on {on:%d-%b-%Y}. Pick another "
                         f"profit centre or extend its validity under Finance › Controlling › Profit Centres.")


class _Deriver:
    """Caches the master data one posting needs."""

    def __init__(self, db: Session):
        self.db = db
        self.pcs = {p.id: p for p in db.query(ProfitCenter).all()}
        self._cc: dict[int, CostCenter | None] = {}
        self._io: dict[int, int | None] = {}

    @property
    def empty(self) -> bool:
        return not self.pcs

    def valid(self, pc_id: int | None, on: date) -> int | None:
        pc = self.pcs.get(pc_id) if pc_id else None
        return pc.id if pc is not None and is_valid_on(pc, on) else None

    def cost_center(self, cc_id: int) -> CostCenter | None:
        if cc_id not in self._cc:
            self._cc[cc_id] = self.db.get(CostCenter, cc_id)
        return self._cc[cc_id]

    def io_cost_center(self, io_id: int) -> int | None:
        if io_id not in self._io:
            from app.modules.accounts.models.internal_order import InternalOrder
            io = self.db.get(InternalOrder, io_id)
            self._io[io_id] = io.cost_center_id if io else None
        return self._io[io_id]

    def for_branch_segment(self, branch_id: int | None, segment: str | None, on: date) -> int | None:
        """Best profit centre for (plant, business line): exact match, then the
        business line company-wide, then the plant's default."""
        cands = [p for p in self.pcs.values() if is_valid_on(p, on)]
        if segment:
            for p in sorted(cands, key=lambda x: x.code):
                if p.segment == segment and branch_id and p.branch_id == branch_id:
                    return p.id
            for p in sorted(cands, key=lambda x: x.code):
                if p.segment == segment and p.branch_id is None:
                    return p.id
        if branch_id:
            from app.modules.organization.models.branch import Branch
            br = self.db.get(Branch, branch_id)
            if br is not None and self.valid(br.default_profit_center_id, on):
                return br.default_profit_center_id
        return None

    def default(self, on: date) -> int | None:
        for p in self.pcs.values():
            if p.is_default and is_valid_on(p, on):
                return p.id
        return None

    def document(self, entry: JournalEntry, on: date) -> int | None:
        rtype, rid = entry.reference_document_type, entry.reference_document_id
        if not rtype or not rid:
            return None
        if rtype == "ar_transaction":
            from app.modules.accounts.models.ar_transaction import ARTransaction
            ar = self.db.get(ARTransaction, rid)
            if ar is None:
                return None
            if ar.reference_type == "sales_order" and ar.reference_id:
                from app.modules.sales.models.order import SalesOrder
                so = self.db.get(SalesOrder, ar.reference_id)
                if so is not None:
                    return self.for_branch_segment(so.branch_id, SO_TYPE_SEGMENT.get(so.order_type), on)
            if ar.reference_type == "service_request":
                return self.for_branch_segment(None, "service", on)
        return None


def derive_for_lines(db: Session, entry: JournalEntry, lines: list[dict]) -> list[int | None]:
    """Profit centre per line, in order. Explicit ids are validated (ValueError
    with the fix); derived ones silently fall through to the next rule."""
    d = _Deriver(db)
    on = entry.posting_date or date.today()
    out: list[int | None] = []
    doc_pc: list = []  # lazily computed once

    def from_document():
        if not doc_pc:
            doc_pc.append(d.document(entry, on))
        return doc_pc[0]

    for i, line in enumerate(lines, start=1):
        explicit = line.get("profit_center_id")
        if explicit:
            check_postable(d.pcs.get(explicit), on, f"Line {i}", explicit)
            out.append(explicit)
            continue
        if d.empty:
            out.append(None)
            continue
        pc = None
        if line.get("cost_center_id"):
            cc = d.cost_center(line["cost_center_id"])
            pc = d.valid(cc.profit_center_id, on) if cc else None
            if pc is None and cc is not None and cc.branch_id:
                pc = d.for_branch_segment(cc.branch_id, None, on)
        if pc is None and line.get("internal_order_id"):
            cc_id = d.io_cost_center(line["internal_order_id"])
            cc = d.cost_center(cc_id) if cc_id else None
            pc = d.valid(cc.profit_center_id, on) if cc else None
        if pc is None:
            pc = from_document()
        if pc is None:
            pc = d.default(on)
        out.append(pc)
    return out


# ─────────────────────────────────────────────────────────────────────────
# Master data
# ─────────────────────────────────────────────────────────────────────────

def validate_master(db: Session, data: dict, existing: ProfitCenter | None = None) -> None:
    code = (data.get("code") or (existing.code if existing else "") or "").strip()
    if not code:
        raise ValueError("Give the profit centre a code (e.g. PC-P1-MAC).")
    dup = db.query(ProfitCenter).filter(func.lower(ProfitCenter.code) == code.lower())
    if existing is not None:
        dup = dup.filter(ProfitCenter.id != existing.id)
    if dup.first():
        raise ValueError(f"Profit centre code '{code}' is already used — codes must be unique.")
    segment = data.get("segment", existing.segment if existing else "corporate")
    if segment not in PROFIT_CENTER_SEGMENTS:
        raise ValueError(f"Business line '{segment}' isn't known — pick one of: "
                         f"{', '.join(PROFIT_CENTER_SEGMENT_LABELS[s] for s in PROFIT_CENTER_SEGMENTS)}.")
    status = data.get("status", existing.status if existing else "active")
    if status not in PROFIT_CENTER_STATUSES:
        raise ValueError(f"Status '{status}' isn't valid — use active or inactive.")
    vf = data.get("valid_from", existing.valid_from if existing else None)
    vt = data.get("valid_to", existing.valid_to if existing else None)
    if vf and vt and vt < vf:
        raise ValueError("'Valid to' is before 'Valid from' — fix the validity period.")
    parent_id = data.get("parent_id", existing.parent_id if existing else None)
    if parent_id:
        seen = {existing.id} if existing else set()
        cur = db.get(ProfitCenter, parent_id)
        if cur is None:
            raise ValueError(f"Parent profit centre #{parent_id} doesn't exist.")
        while cur is not None:
            if cur.id in seen:
                raise ValueError("That parent would make the profit centre its own parent (a loop in the hierarchy). Pick another parent.")
            seen.add(cur.id)
            cur = db.get(ProfitCenter, cur.parent_id) if cur.parent_id else None


def set_default(db: Session, pc: ProfitCenter) -> None:
    """Only one company default."""
    if pc.is_default:
        db.query(ProfitCenter).filter(ProfitCenter.id != pc.id, ProfitCenter.is_default == True).update(  # noqa: E712
            {ProfitCenter.is_default: False}, synchronize_session=False)


def usage_count(db: Session, pc_id: int) -> int:
    from app.modules.organization.models.branch import Branch
    return (db.query(func.count(JournalEntryLine.id)).filter(JournalEntryLine.profit_center_id == pc_id).scalar() or 0) + \
        (db.query(func.count(CostCenter.id)).filter(CostCenter.profit_center_id == pc_id).scalar() or 0) + \
        (db.query(func.count(Branch.id)).filter(Branch.default_profit_center_id == pc_id).scalar() or 0) + \
        (db.query(func.count(ProfitCenter.id)).filter(ProfitCenter.parent_id == pc_id).scalar() or 0)


def rederive(db: Session, *, from_date: date | None = None, to_date: date | None = None) -> dict:
    """Fills the profit centre on posted lines that have none (lines posted
    before the master was set up). Only blanks are touched — a profit centre
    already on a line is never changed. Balances are unaffected."""
    q = db.query(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id).filter(
        JournalEntryLine.profit_center_id.is_(None), JournalEntry.status.in_(JE_LEDGER_STATUSES))
    if from_date:
        q = q.filter(JournalEntry.posting_date >= from_date)
    if to_date:
        q = q.filter(JournalEntry.posting_date <= to_date)
    by_entry: dict[int, tuple[JournalEntry, list[JournalEntryLine]]] = {}
    for line, entry in q.all():
        by_entry.setdefault(entry.id, (entry, []))[1].append(line)
    updated = 0
    for entry, lines in by_entry.values():
        dicts = [{"cost_center_id": l.cost_center_id, "internal_order_id": l.internal_order_id} for l in lines]
        for line, pc in zip(lines, derive_for_lines(db, entry, dicts)):
            if pc:
                line.profit_center_id = pc
                updated += 1
    db.flush()
    remaining = sum(len(ls) for _, ls in by_entry.values()) - updated
    return {"lines_updated": updated, "lines_still_unassigned": remaining}


# ─────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────

def _range(db: Session, from_date: date | None, to_date: date | None) -> tuple[date, date]:
    from app.modules.accounts.reports import _default_range
    return _default_range(from_date, to_date, db)


def profit_center_pl(db: Session, *, from_date: date | None = None, to_date: date | None = None,
                     group_by: str = "profit_center") -> dict:
    """P&L by profit centre, by plant or by business line. Columns are the
    grouping values plus 'Unassigned' (lines with no profit centre); rows are
    Schedule III P&L heads with their ledgers. Column totals reconcile to
    the company P&L for the same dates."""
    from app.modules.accounts.models.account_group import SCHEDULE_III_PL_HEADS
    from app.modules.accounts.reports import EXPENSE_HEADS, INCOME_HEADS, NON_PL_POSTINGS, _chart, _head_of
    from app.modules.organization.models.branch import Branch

    if group_by not in ("profit_center", "plant", "segment"):
        raise ValueError("Group by must be profit_center, plant or segment.")
    from_date, to_date = _range(db, from_date, to_date)
    pcs = {p.id: p for p in db.query(ProfitCenter).all()}
    branches = {b.id: b for b in db.query(Branch).all()}

    def col_key(pc_id):
        pc = pcs.get(pc_id) if pc_id else None
        if pc is None:
            return UNASSIGNED
        if group_by == "profit_center":
            return str(pc.id)
        if group_by == "plant":
            return f"b{pc.branch_id}" if pc.branch_id else "company"
        return pc.segment

    def col_label(key):
        if key == UNASSIGNED:
            return "Unassigned"
        if group_by == "profit_center":
            return label(pcs[int(key)])
        if group_by == "plant":
            if key == "company":
                return "Company-wide"
            b = branches.get(int(key[1:]))
            return f"{b.code} — {b.name}" if b else key
        return PROFIT_CENTER_SEGMENT_LABELS.get(key, key)

    rows = db.query(
        JournalEntryLine.profit_center_id, JournalEntryLine.gl_account_id,
        func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0),
    ).join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id).filter(
        JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_type.notin_(NON_PL_POSTINGS),
        JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date,
    ).group_by(JournalEntryLine.profit_center_id, JournalEntryLine.gl_account_id).all()

    groups, accounts = _chart(db)
    heads: dict[str, dict] = {}
    cols: set[str] = set()
    for pc_id, gl_id, dr, cr in rows:
        a = accounts.get(gl_id)
        if a is None:
            continue
        head = _head_of(a, groups)
        if head not in SCHEDULE_III_PL_HEADS:
            continue
        income = head in INCOME_HEADS
        amount = _r((float(cr) - float(dr)) if income else (float(dr) - float(cr)))
        if not amount:
            continue
        key = col_key(pc_id)
        cols.add(key)
        h = heads.setdefault(head, {"head": head, "label": SCHEDULE_III_PL_HEADS[head], "income": income, "amounts": {}, "ledgers": {}})
        h["amounts"][key] = _r(h["amounts"].get(key, 0) + amount)
        led = h["ledgers"].setdefault(gl_id, {"gl_account_id": gl_id, "code": a.code, "name": a.name, "amounts": {}})
        led["amounts"][key] = _r(led["amounts"].get(key, 0) + amount)

    def sort_key(k):
        return (k == UNASSIGNED, col_label(k) or "")
    ordered = sorted(cols, key=sort_key)
    order = list(INCOME_HEADS) + list(EXPENSE_HEADS) + ["tax_expense"]
    out_rows = []
    for h in order:
        if h in heads:
            r = heads[h]
            r["total"] = _r(sum(r["amounts"].values()))
            r["ledgers"] = sorted(({**l, "total": _r(sum(l["amounts"].values()))} for l in r["ledgers"].values()), key=lambda x: x["code"])
            out_rows.append(r)
    income_tot = {k: _r(sum(r["amounts"].get(k, 0) for r in out_rows if r["income"])) for k in ordered}
    expense_tot = {k: _r(sum(r["amounts"].get(k, 0) for r in out_rows if not r["income"])) for k in ordered}
    profit = {k: _r(income_tot[k] - expense_tot[k]) for k in ordered}
    return {
        "from_date": from_date, "to_date": to_date, "group_by": group_by,
        "columns": [{"key": k, "label": col_label(k)} for k in ordered],
        "rows": out_rows, "total_income": income_tot, "total_expenses": expense_tot, "profit": profit,
        "grand_total_income": _r(sum(income_tot.values())), "grand_total_expenses": _r(sum(expense_tot.values())),
        "grand_profit": _r(sum(profit.values())),
        "unassigned_lines": UNASSIGNED in cols,
    }


def profit_center_line_items(db: Session, *, profit_center_id: int | None, from_date: date | None = None,
                             to_date: date | None = None, gl_account_id: int | None = None, limit: int = 2000) -> dict:
    """KE5Z: posted lines of one profit centre (None = unassigned)."""
    from app.modules.accounts.models.gl_account import GLAccount
    from_date, to_date = _range(db, from_date, to_date)
    q = db.query(JournalEntryLine, JournalEntry).join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id).filter(
        JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date)
    q = q.filter(JournalEntryLine.profit_center_id == profit_center_id) if profit_center_id else q.filter(JournalEntryLine.profit_center_id.is_(None))
    if gl_account_id:
        q = q.filter(JournalEntryLine.gl_account_id == gl_account_id)
    rows = q.order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc(), JournalEntryLine.line_number.asc()).limit(limit).all()
    gls = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_({l.gl_account_id for l, _ in rows})).all()} if rows else {}
    ccs = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_({l.cost_center_id for l, _ in rows if l.cost_center_id})).all()} if rows else {}
    out = []
    for l, e in rows:
        g, cc = gls.get(l.gl_account_id), ccs.get(l.cost_center_id)
        out.append({
            "journal_entry_line_id": l.id, "journal_entry_id": e.id, "entry_number": e.entry_number, "voucher_type": e.voucher_type,
            "posting_date": e.posting_date, "gl_account_code": g.code if g else None, "gl_account_name": g.name if g else None,
            "cost_center_code": cc.code if cc else None, "description": l.remarks or e.description,
            "debit_amount": _r(l.debit_amount), "credit_amount": _r(l.credit_amount),
        })
    pc = db.get(ProfitCenter, profit_center_id) if profit_center_id else None
    return {"profit_center_id": profit_center_id, "label": label(pc) or "Unassigned", "from_date": from_date, "to_date": to_date,
            "rows": out, "total_debit": _r(sum(r["debit_amount"] for r in out)),
            "total_credit": _r(sum(r["credit_amount"] for r in out)), "truncated": len(rows) >= limit}
