"""Read-only financial statements. Nothing here writes to the database.

Every figure is summed straight from posted journal lines (services/
balances.account_totals) for the exact dates asked — never from the monthly
GLBalance cache — and rolled up through the ledger's account group to its
Schedule III head (Companies Act 2013, Division I).

Sign convention: stored balances are debit-minus-credit. Asset and expense
figures are shown as is; liability, equity and income figures are flipped so
their normal balance reads positive."""
from datetime import date, timedelta
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.account_group import AccountGroup, SCHEDULE_III_BS_HEADS, SCHEDULE_III_PL_HEADS
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.balances import account_totals
from app.modules.accounts.services.outstanding import party_outstanding, open_documents
from app.modules.organization.models.cost_center import CostCenter

CREDIT_NATURES = ("liability", "equity", "revenue")
# Movements that aren't trading results: the year-end transfer would wipe
# the year's P&L, and the opening voucher is the starting point, not a flow.
NON_PL_POSTINGS = ("year_end",)

BS_SECTIONS = [
    ("equity_and_liabilities", "Equity and Liabilities", [
        ("Shareholders' Funds", ["share_capital", "reserves_surplus"]),
        ("Non-current Liabilities", ["long_term_borrowings", "long_term_provisions"]),
        ("Current Liabilities", ["short_term_borrowings", "trade_payables", "other_current_liabilities", "short_term_provisions"]),
    ]),
    ("assets", "Assets", [
        ("Non-current Assets", ["ppe", "non_current_investments", "long_term_loans_advances"]),
        ("Current Assets", ["current_investments", "inventories", "trade_receivables", "cash_equivalents", "short_term_loans_advances", "other_current_assets"]),
    ]),
]
LIABILITY_HEADS = {h for _, _, groups in BS_SECTIONS[:1] for _, heads in groups for h in heads}
INCOME_HEADS = ("revenue_from_operations", "other_income")
EXPENSE_HEADS = ("cost_of_materials_consumed", "changes_in_inventories", "employee_benefits", "finance_costs", "depreciation", "other_expenses")


def _r(x) -> float:
    return round(float(x or 0), 2)


def _natural(nature: str, dr_minus_cr: float) -> float:
    return _r(-dr_minus_cr if nature in CREDIT_NATURES else dr_minus_cr)


def _chart(db: Session) -> tuple[dict, dict]:
    groups = {g.id: g for g in db.query(AccountGroup).all()}
    accounts = {a.id: a for a in db.query(GLAccount).order_by(GLAccount.code.asc()).all()}
    return groups, accounts


def _head_of(account: GLAccount, groups: dict) -> str:
    g = groups.get(account.group_id)
    if g:
        return g.schedule_iii_head
    return {"asset": "other_current_assets", "liability": "other_current_liabilities", "equity": "reserves_surplus",
            "revenue": "other_income", "expense": "other_expenses"}[account.account_type]


def _primary_group(group: AccountGroup | None, groups: dict) -> AccountGroup | None:
    while group and group.parent_id and group.parent_id in groups:
        group = groups[group.parent_id]
    return group


def _default_range(from_date: date | None, to_date: date | None, db: Session) -> tuple[date, date]:
    to_date = to_date or date.today()
    if from_date is None:
        from_date = fiscal.fiscal_year_for(db, to_date).start_date
    if from_date > to_date:
        raise ValueError("The 'from' date is after the 'to' date.")
    return from_date, to_date


# ─────────────────────────────────────────────────────────────────────────
# Trial balance / ledger / day book
# ─────────────────────────────────────────────────────────────────────────

def get_trial_balance(db: Session, *, from_date: date | None = None, to_date: date | None = None, period: str | None = None) -> dict:
    if period:
        from_date, to_date = fiscal.period_bounds(period)
    from_date, to_date = _default_range(from_date, to_date, db)
    groups, accounts = _chart(db)
    opening = account_totals(db, to_date=from_date - timedelta(days=1))
    movement = account_totals(db, from_date=from_date, to_date=to_date)

    rows = []
    tot = {"opening_debit": 0.0, "opening_credit": 0.0, "debit": 0.0, "credit": 0.0, "closing_debit": 0.0, "closing_credit": 0.0}
    for a in accounts.values():
        od, oc = opening.get(a.id, (0.0, 0.0))
        md, mc = movement.get(a.id, (0.0, 0.0))
        ob = _r(od - oc)
        cb = _r(ob + md - mc)
        if not (ob or md or mc):
            continue
        g = groups.get(a.group_id)
        pg = _primary_group(g, groups)
        row = {"gl_account_id": a.id, "code": a.code, "name": a.name, "account_type": a.account_type,
               "group_name": g.name if g else None, "primary_group": pg.name if pg else None,
               "opening_debit": max(ob, 0), "opening_credit": max(-ob, 0), "debit": _r(md), "credit": _r(mc),
               "closing_debit": max(cb, 0), "closing_credit": max(-cb, 0)}
        rows.append(row)
        for k in tot:
            tot[k] = _r(tot[k] + row[k])
    rows.sort(key=lambda r: ((r["primary_group"] or "~"), r["code"]))
    return {"from_date": from_date, "to_date": to_date, "rows": rows, "totals": tot,
            "is_balanced": abs(tot["closing_debit"] - tot["closing_credit"]) < 0.01 and abs(tot["debit"] - tot["credit"]) < 0.01}


def get_gl_ledger(db: Session, *, gl_account_id: int, from_date: date | None = None, to_date: date | None = None) -> dict:
    account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not account:
        raise ValueError("GL account not found.")
    from_date, to_date = _default_range(from_date, to_date, db)
    od, oc = account_totals(db, to_date=from_date - timedelta(days=1), account_ids=[gl_account_id]).get(gl_account_id, (0.0, 0.0))
    running = _r(od - oc)
    opening = running
    lines = (
        db.query(JournalEntryLine, JournalEntry)
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntryLine.gl_account_id == gl_account_id, JournalEntry.status.in_(JE_LEDGER_STATUSES),
                JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date)
        .order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc(), JournalEntryLine.line_number.asc())
        .all()
    )
    rows = []
    for line, entry in lines:
        running = _r(running + line.debit_amount - line.credit_amount)
        rows.append({"journal_entry_id": entry.id, "entry_number": entry.entry_number, "voucher_type": entry.voucher_type,
                     "posting_date": entry.posting_date, "description": line.remarks or entry.description,
                     "debit_amount": line.debit_amount, "credit_amount": line.credit_amount, "running_balance": running})
    return {"gl_account_id": account.id, "gl_account_code": account.code, "gl_account_name": account.name, "account_type": account.account_type,
            "from_date": from_date, "to_date": to_date, "opening_balance": opening, "closing_balance": running,
            "total_debit": _r(sum(r["debit_amount"] for r in rows)), "total_credit": _r(sum(r["credit_amount"] for r in rows)), "rows": rows}


def get_day_book(db: Session, *, from_date: date, to_date: date, voucher_type: str | None = None, user=None) -> dict:
    """A voucher listing, so the viewer's data scope applies (`user`); its
    total is the total of the vouchers listed."""
    q = db.query(JournalEntry).options(selectinload(JournalEntry.lines)).filter(
        JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_date >= from_date, JournalEntry.posting_date <= to_date)
    if user is not None:
        from app.core.data_scope import apply_scope
        import app.modules.accounts.access  # noqa: F401 — registers JournalEntry's scope

        q = apply_scope(q, user, JournalEntry)
    if voucher_type:
        q = q.filter(JournalEntry.voucher_type == voucher_type)
    entries = q.order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc()).all()
    ids = {l.gl_account_id for e in entries for l in e.lines}
    names = {a.id: (a.code, a.name) for a in db.query(GLAccount).filter(GLAccount.id.in_(ids)).all()} if ids else {}
    out = []
    for e in entries:
        out.append({"journal_entry_id": e.id, "entry_number": e.entry_number, "voucher_type": e.voucher_type, "posting_type": e.posting_type,
                    "posting_date": e.posting_date, "description": e.description, "status": e.status, "amount": e.total_debit,
                    "lines": [{"gl_account_code": names.get(l.gl_account_id, ("?", "?"))[0], "gl_account_name": names.get(l.gl_account_id, ("?", "?"))[1],
                               "debit_amount": l.debit_amount, "credit_amount": l.credit_amount, "remarks": l.remarks}
                              for l in sorted(e.lines, key=lambda x: x.line_number)]})
    return {"from_date": from_date, "to_date": to_date, "entries": out, "total": _r(sum(e["amount"] for e in out))}


# ─────────────────────────────────────────────────────────────────────────
# Statement of Profit & Loss / Balance Sheet (Schedule III)
# ─────────────────────────────────────────────────────────────────────────

def _head_rows(db: Session, totals: dict, head_filter) -> dict[str, list[dict]]:
    groups, accounts = _chart(db)
    by_head: dict[str, list[dict]] = {}
    for aid, (d, c) in totals.items():
        a = accounts.get(aid)
        if not a:
            continue
        head = _head_of(a, groups)
        if not head_filter(head):
            continue
        by_head.setdefault(head, []).append({"gl_account_id": a.id, "code": a.code, "name": a.name, "raw": _r(d - c)})
    return by_head


def get_profit_and_loss(db: Session, *, from_date: date | None = None, to_date: date | None = None, period: str | None = None) -> dict:
    if period:
        from_date, to_date = fiscal.period_bounds(period)
    from_date, to_date = _default_range(from_date, to_date, db)
    totals = account_totals(db, from_date=from_date, to_date=to_date, exclude_posting_types=NON_PL_POSTINGS)
    by_head = _head_rows(db, totals, lambda h: h in SCHEDULE_III_PL_HEADS)
    groups, accounts = _chart(db)

    def section(heads, income: bool):
        out = []
        for h in heads:
            ledgers = [{**l, "amount": _r(-l["raw"] if income else l["raw"])} for l in by_head.get(h, []) if l["raw"]]
            out.append({"head": h, "label": SCHEDULE_III_PL_HEADS[h], "amount": _r(sum(l["amount"] for l in ledgers)),
                        "ledgers": sorted(ledgers, key=lambda x: x["code"])})
        return out

    income = section(INCOME_HEADS, True)
    expenses = section(EXPENSE_HEADS, False)
    total_income = _r(sum(s["amount"] for s in income))
    total_expenses = _r(sum(s["amount"] for s in expenses))
    pbt = _r(total_income - total_expenses)
    tax = section(("tax_expense",), False)[0]
    pat = _r(pbt - tax["amount"])

    gp_income = gp_expense = 0.0
    for aid, (d, c) in totals.items():
        a = accounts.get(aid)
        g = groups.get(a.group_id) if a else None
        if g and g.affects_gross_profit:
            if a.account_type == "revenue":
                gp_income += c - d
            else:
                gp_expense += d - c
    return {
        "from_date": from_date, "to_date": to_date, "income": income, "expenses": expenses,
        "total_income": total_income, "total_expenses": total_expenses, "profit_before_tax": pbt,
        "tax_expense": tax, "profit_for_period": pat, "gross_profit": _r(gp_income - gp_expense),
        # Back-compat fields used by the monthly pack.
        "total_revenue": total_income, "total_expense": _r(total_expenses + tax["amount"]), "net_profit": pat,
    }


def get_balance_sheet(db: Session, *, as_of: date | None = None, period: str | None = None) -> dict:
    """Cumulative balances to `as_of`. Income/expense ledgers not yet closed
    to Retained Earnings by a year-end close are shown as 'Surplus in the
    Statement of Profit & Loss' inside Reserves and Surplus."""
    if period:
        as_of = fiscal.period_bounds(period)[1]
    as_of = as_of or date.today()
    totals = account_totals(db, to_date=as_of)
    by_head = _head_rows(db, totals, lambda h: h in SCHEDULE_III_BS_HEADS)
    pl_surplus = _r(sum(-l["raw"] for lst in _head_rows(db, totals, lambda h: h in SCHEDULE_III_PL_HEADS).values() for l in lst))

    sections = []
    section_totals = {}
    for key, label, subsections in BS_SECTIONS:
        subs = []
        for sub_label, heads in subsections:
            head_rows = []
            for h in heads:
                liability = h in LIABILITY_HEADS
                ledgers = [{**l, "amount": _r(-l["raw"] if liability else l["raw"])} for l in by_head.get(h, []) if l["raw"]]
                if h == "reserves_surplus" and pl_surplus:
                    ledgers.append({"gl_account_id": None, "code": "", "name": "Surplus in the Statement of Profit & Loss (not yet closed)", "amount": pl_surplus})
                head_rows.append({"head": h, "label": SCHEDULE_III_BS_HEADS[h], "amount": _r(sum(l["amount"] for l in ledgers)),
                                  "ledgers": sorted(ledgers, key=lambda x: x["code"])})
            subs.append({"label": sub_label, "heads": head_rows, "amount": _r(sum(h["amount"] for h in head_rows))})
        total = _r(sum(s["amount"] for s in subs))
        section_totals[key] = total
        sections.append({"key": key, "label": label, "subsections": subs, "amount": total})

    diff = _r(section_totals["assets"] - section_totals["equity_and_liabilities"])
    return {"as_of": as_of, "sections": sections, "total_assets": section_totals["assets"],
            "total_equity_and_liabilities": section_totals["equity_and_liabilities"], "profit_and_loss_surplus": pl_surplus,
            "difference": diff, "is_balanced": abs(diff) < 0.01}


# ─────────────────────────────────────────────────────────────────────────
# Cash flow statement — indirect method (AS-3)
# ─────────────────────────────────────────────────────────────────────────

def get_cash_flow(db: Session, *, from_date: date | None = None, to_date: date | None = None) -> dict:
    """Derived entirely from movements in Balance Sheet heads, so it always
    reconciles to the change in cash: profit + changes in every non-cash
    head = change in cash and cash equivalents."""
    from_date, to_date = _default_range(from_date, to_date, db)
    skip = NON_PL_POSTINGS + ("opening",)
    movement = account_totals(db, from_date=from_date, to_date=to_date, exclude_posting_types=skip)
    bs = _head_rows(db, movement, lambda h: h in SCHEDULE_III_BS_HEADS)
    pl = get_profit_and_loss(db, from_date=from_date, to_date=to_date)

    def delta(head: str) -> float:
        """Increase in the head over the range, in its natural sign."""
        raw = sum(l["raw"] for l in bs.get(head, []))
        return _r(-raw if head in LIABILITY_HEADS else raw)

    depreciation = next((s["amount"] for s in pl["expenses"] if s["head"] == "depreciation"), 0.0)
    finance = next((s["amount"] for s in pl["expenses"] if s["head"] == "finance_costs"), 0.0)
    operating = [
        {"label": "Net profit before tax", "amount": pl["profit_before_tax"]},
        {"label": "Add: Depreciation (non-cash)", "amount": _r(depreciation)},
        {"label": "Add: Finance costs (shown under financing)", "amount": _r(finance)},
        {"label": "(Increase)/decrease in inventories", "amount": _r(-delta("inventories"))},
        {"label": "(Increase)/decrease in trade receivables", "amount": _r(-delta("trade_receivables"))},
        {"label": "(Increase)/decrease in short-term loans & advances", "amount": _r(-delta("short_term_loans_advances"))},
        {"label": "(Increase)/decrease in other current assets", "amount": _r(-delta("other_current_assets"))},
        {"label": "Increase/(decrease) in trade payables", "amount": _r(delta("trade_payables"))},
        {"label": "Increase/(decrease) in other current liabilities", "amount": _r(delta("other_current_liabilities"))},
        {"label": "Increase/(decrease) in provisions", "amount": _r(delta("short_term_provisions") + delta("long_term_provisions"))},
        {"label": "Less: Tax expense", "amount": _r(-pl["tax_expense"]["amount"])},
    ]
    investing = [
        {"label": "Purchase of fixed assets (net of disposals)", "amount": _r(-(delta("ppe") + depreciation))},
        {"label": "(Increase)/decrease in investments", "amount": _r(-(delta("non_current_investments") + delta("current_investments")))},
        {"label": "(Increase)/decrease in long-term loans & advances", "amount": _r(-delta("long_term_loans_advances"))},
    ]
    financing = [
        {"label": "Proceeds from share capital", "amount": _r(delta("share_capital"))},
        {"label": "Movement in reserves (other than profit)", "amount": _r(delta("reserves_surplus"))},
        {"label": "Net borrowings (long-term)", "amount": _r(delta("long_term_borrowings"))},
        {"label": "Net borrowings (short-term)", "amount": _r(delta("short_term_borrowings"))},
        {"label": "Finance costs paid", "amount": _r(-finance)},
    ]
    net_op, net_inv, net_fin = (_r(sum(x["amount"] for x in s)) for s in (operating, investing, financing))
    net_change = _r(net_op + net_inv + net_fin)

    groups, accounts = _chart(db)
    cash_ids = [a.id for a in accounts.values() if _head_of(a, groups) == "cash_equivalents"]
    before = account_totals(db, to_date=from_date - timedelta(days=1), account_ids=cash_ids)
    # An opening-balance voucher inside the range is a starting position, not
    # a cash flow — count its cash effect in opening cash.
    ob_effect = 0.0
    if cash_ids:
        all_in_range = account_totals(db, from_date=from_date, to_date=to_date, account_ids=cash_ids)
        non_opening = account_totals(db, from_date=from_date, to_date=to_date, account_ids=cash_ids, exclude_posting_types=skip)
        ob_effect = sum(d - c for d, c in all_in_range.values()) - sum(d - c for d, c in non_opening.values())
    opening_cash = _r(sum(d - c for d, c in before.values()) + ob_effect)
    closing_cash = _r(sum(d - c for d, c in account_totals(db, to_date=to_date, account_ids=cash_ids).values()))
    return {
        "from_date": from_date, "to_date": to_date, "operating": operating, "investing": investing, "financing": financing,
        "net_operating": net_op, "net_investing": net_inv, "net_financing": net_fin, "net_change": net_change,
        "opening_cash": opening_cash, "closing_cash": closing_cash,
        "difference": _r(closing_cash - opening_cash - net_change),
    }


# ─────────────────────────────────────────────────────────────────────────
# Outstanding, variance, monthly pack
# ─────────────────────────────────────────────────────────────────────────

def get_ap_aging(db: Session, as_of: date | None = None) -> dict:
    return _aging(db, "vendor", as_of)


def get_ar_aging(db: Session, as_of: date | None = None) -> dict:
    return _aging(db, "customer", as_of)


def _aging(db: Session, party_type: str, as_of: date | None = None) -> dict:
    """Aging on a key date (S_ALR_87012078/87012168): with a past as_of the
    bills and amounts are those open on that date, not today's."""
    docs = open_documents(db, party_type=party_type, as_of=as_of)
    summary = party_outstanding(db, party_type=party_type, as_of=as_of)
    names = {r["party_id"]: r["party_name"] for r in summary["rows"]}
    rows = [{"invoice_number": d["doc_number"], "party_name": names.get(d["party_id"], "—"), "due_date": d["due_date"],
             "amount_due": d["amount_due"], "disputed": d.get("disputed", 0.0), "bucket": d["bucket"],
             "days_overdue": d["days_overdue"]} for d in docs]
    return {"as_of": as_of or date.today(), "rows": rows, "total_due": _r(sum(r["amount_due"] for r in rows)),
            "parties": summary["rows"], "totals": summary["totals"]}


def get_variance_analysis(db: Session, *, from_date: date | None = None, to_date: date | None = None) -> dict:
    """Budget vs actual. A cost centre's annual budget is pro-rated to the
    months in the range (12 months = full budget); an internal order's
    budget is for its whole life, so it's compared with actuals to date."""
    from_date, to_date = _default_range(from_date, to_date, db)
    months = (to_date.year - from_date.year) * 12 + to_date.month - from_date.month + 1
    rows = []

    def actual(col, key, life_to_date: bool = False):
        lines = db.query(JournalEntryLine).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id).filter(
            col == key, JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_type.notin_(NON_PL_POSTINGS),
            JournalEntry.posting_date <= to_date)
        if not life_to_date:
            lines = lines.filter(JournalEntry.posting_date >= from_date)
        return _r(sum(l.debit_amount - l.credit_amount for l in lines.all()))

    from app.modules.accounts.services.controlling import io_commitments
    budgeted_ios = db.query(InternalOrder).filter(InternalOrder.budgeted_amount.isnot(None)).all()
    commitments = io_commitments(db, [io.id for io in budgeted_ios])
    for io in budgeted_ios:
        # An order's budget is for its whole life: actuals are life to date.
        act = actual(JournalEntryLine.internal_order_id, io.id, life_to_date=True)
        budget = _r(io.budgeted_amount)
        variance = _r(act - budget)
        rows.append({"type": "internal_order", "id": io.id, "code": io.code, "name": io.name, "budgeted_amount": budget, "actual_amount": act,
                     "commitment_amount": _r(sum(r["open_value"] for r in commitments.get(io.id, []))),
                     "variance": variance, "variance_pct": _r(variance / budget * 100) if budget else None})
    for cc in db.query(CostCenter).filter(CostCenter.annual_budget.isnot(None)).all():
        act = actual(JournalEntryLine.cost_center_id, cc.id)
        budget = _r(float(cc.annual_budget) * months / 12)
        variance = _r(act - budget)
        rows.append({"type": "cost_center", "id": cc.id, "code": cc.code, "name": cc.name, "budgeted_amount": budget, "actual_amount": act,
                     "variance": variance, "variance_pct": _r(variance / budget * 100) if budget else None})
    return {
        "from_date": from_date, "to_date": to_date, "rows": rows,
        "note": None if rows else "No Internal Orders or Cost Centers have a budget set yet — Variance Analysis has nothing to compare against until one does (see Finance > Masters).",
    }


def get_monthly_report_pack(db: Session, *, period: str) -> dict:
    start, end = fiscal.period_bounds(period)
    return {
        "period": period,
        "trial_balance": get_trial_balance(db, from_date=start, to_date=end),
        "profit_and_loss": get_profit_and_loss(db, from_date=start, to_date=end),
        "balance_sheet": get_balance_sheet(db, as_of=end),
        "ap_aging": get_ap_aging(db, as_of=end),
        "ar_aging": get_ar_aging(db, as_of=end),
        "aging_note": f"AP/AR aging is as of the period end ({end:%d-%m-%Y}): only bills posted by then, less settlements made by then.",
    }
