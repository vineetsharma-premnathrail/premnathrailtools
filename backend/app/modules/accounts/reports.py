"""Read-only reporting/aggregation queries — Phase 7. Deliberately separate
from service.py, which is reserved for state-mutating post_*()/create_*()/
close_*() functions (see service.py's own module docstring). Nothing here
ever writes to the database. See
old_docs/product/ACCOUNTS_MODULE_ROADMAP.md Phase 7."""
from datetime import date, timedelta
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.organization.models.cost_center import CostCenter


def get_trial_balance(db: Session, *, period: str) -> dict:
    accounts = db.query(GLAccount).order_by(GLAccount.account_type.asc(), GLAccount.code.asc()).all()
    balances = {b.gl_account_id: b for b in db.query(GLBalance).filter(GLBalance.accounting_period == period).all()}

    rows = []
    total_debits = 0.0
    total_credits = 0.0
    for account in accounts:
        bal = balances.get(account.id)
        opening = bal.opening_balance if bal else 0.0
        debits = bal.total_debits if bal else 0.0
        credits = bal.total_credits if bal else 0.0
        closing = bal.closing_balance if bal else 0.0
        rows.append({
            "gl_account_id": account.id, "code": account.code, "name": account.name, "account_type": account.account_type,
            "opening_balance": opening, "total_debits": debits, "total_credits": credits, "closing_balance": closing,
        })
        total_debits += debits
        total_credits += credits

    return {"period": period, "rows": rows, "total_debits": round(total_debits, 2), "total_credits": round(total_credits, 2)}


def get_gl_ledger(db: Session, *, gl_account_id: int, from_period: str, to_period: str) -> dict:
    account = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
    if not account:
        raise ValueError("GL account not found.")

    opening_balance = db.query(GLBalance).filter(
        GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period < from_period,
    ).order_by(GLBalance.accounting_period.desc()).first()
    running = opening_balance.closing_balance if opening_balance else 0.0

    lines = (
        db.query(JournalEntryLine, JournalEntry)
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(
            JournalEntryLine.gl_account_id == gl_account_id,
            JournalEntry.accounting_period >= from_period, JournalEntry.accounting_period <= to_period,
            JournalEntry.status == "posted",
        )
        .order_by(JournalEntry.posting_date.asc(), JournalEntry.id.asc())
        .all()
    )

    rows = []
    for line, entry in lines:
        running = round(running + line.debit_amount - line.credit_amount, 2)
        rows.append({
            "entry_number": entry.entry_number, "posting_date": entry.posting_date, "description": entry.description,
            "debit_amount": line.debit_amount, "credit_amount": line.credit_amount, "running_balance": running,
        })

    return {
        "gl_account_code": account.code, "gl_account_name": account.name,
        "opening_balance": round(opening_balance.closing_balance if opening_balance else 0.0, 2),
        "closing_balance": running, "rows": rows,
    }


def _aging_bucket(days: int) -> str:
    if days <= 0:
        return "current"
    if days <= 30:
        return "1_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "over_90"


def get_ap_aging(db: Session) -> dict:
    invoices = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.amount_due > 0).all()
    vendor_ids = {i.vendor_id for i in invoices}
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    today = date.today()

    rows = []
    total_due = 0.0
    for inv in invoices:
        vendor = vendors.get(inv.vendor_id)
        due_date = inv.invoice_date + timedelta(days=(vendor.payment_days or 0) if vendor else 0)
        days = (today - due_date).days
        rows.append({
            "invoice_number": inv.invoice_number, "party_name": vendor.name if vendor else "—",
            "due_date": due_date, "amount_due": inv.amount_due, "bucket": _aging_bucket(days),
        })
        total_due += inv.amount_due

    return {"rows": rows, "total_due": round(total_due, 2)}


def get_ar_aging(db: Session) -> dict:
    from app.modules.crm.models.organization import Organization

    transactions = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0).all()
    customer_ids = {t.customer_id for t in transactions}
    customers = {c.id: c for c in db.query(Organization).filter(Organization.id.in_(customer_ids)).all()} if customer_ids else {}

    rows = []
    total_due = 0.0
    for txn in transactions:
        customer = customers.get(txn.customer_id)
        days_overdue = (date.today() - txn.due_date).days
        rows.append({
            "invoice_number": txn.invoice_number, "party_name": customer.name if customer else "—",
            "due_date": txn.due_date, "amount_due": txn.amount_due, "bucket": _aging_bucket(days_overdue),
        })
        total_due += txn.amount_due

    return {"rows": rows, "total_due": round(total_due, 2)}


def get_profit_and_loss(db: Session, *, period: str) -> dict:
    balances = db.query(GLBalance).filter(GLBalance.accounting_period == period).all()
    account_ids = {b.gl_account_id for b in balances}
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(account_ids)).all()} if account_ids else {}

    revenue_rows = []
    expense_rows = []
    total_revenue = 0.0
    total_expense = 0.0
    for b in balances:
        account = accounts.get(b.gl_account_id)
        if not account:
            continue
        if account.account_type == "revenue":
            net = round(b.total_credits - b.total_debits, 2)
            revenue_rows.append({"code": account.code, "name": account.name, "amount": net})
            total_revenue += net
        elif account.account_type == "expense":
            net = round(b.total_debits - b.total_credits, 2)
            expense_rows.append({"code": account.code, "name": account.name, "amount": net})
            total_expense += net

    return {
        "period": period, "revenue_rows": revenue_rows, "expense_rows": expense_rows,
        "total_revenue": round(total_revenue, 2), "total_expense": round(total_expense, 2),
        "net_profit": round(total_revenue - total_expense, 2),
    }


def get_balance_sheet(db: Session, *, period: str) -> dict:
    """GLBalance.closing_balance is always stored as debits-minus-credits,
    regardless of account type (see service.py's post_journal_entry). Asset
    accounts are debit-normal, so that raw figure is already the right sign.
    Liability/equity accounts are credit-normal, so their normal-balance
    amount is the negation of the stored figure — same flip get_profit_and_loss
    already applies to revenue accounts.

    Revenue/expense accounts don't appear on a balance sheet directly, but
    since this ledger never runs a year-end closing entry into Retained
    Earnings, their cumulative net (as of `period`) is folded into Equity as
    "Current Period Earnings" — without it, Assets would not equal
    Liabilities + Equity, because the cash/AR movement from revenue and
    expense postings would have no equity-side counterpart."""
    accounts = db.query(GLAccount).filter(
        GLAccount.account_type.in_(["asset", "liability", "equity", "revenue", "expense"])
    ).order_by(GLAccount.account_type.asc(), GLAccount.code.asc()).all()
    balances = {b.gl_account_id: b for b in db.query(GLBalance).filter(GLBalance.accounting_period == period).all()}

    asset_rows, liability_rows, equity_rows = [], [], []
    total_assets = total_liabilities = total_equity = 0.0
    total_revenue = total_expense = 0.0
    for account in accounts:
        bal = balances.get(account.id)
        raw = bal.closing_balance if bal else 0.0
        row = {"gl_account_id": account.id, "code": account.code, "name": account.name}

        if account.account_type == "asset":
            row["amount"] = round(raw, 2)
            asset_rows.append(row)
            total_assets += row["amount"]
        elif account.account_type == "liability":
            row["amount"] = round(-raw, 2)
            liability_rows.append(row)
            total_liabilities += row["amount"]
        elif account.account_type == "equity":
            row["amount"] = round(-raw, 2)
            equity_rows.append(row)
            total_equity += row["amount"]
        elif account.account_type == "revenue":
            total_revenue += -raw
        elif account.account_type == "expense":
            total_expense += raw

    current_period_earnings = round(total_revenue - total_expense, 2)
    total_equity_and_earnings = round(total_equity + current_period_earnings, 2)
    total_liabilities_and_equity = round(total_liabilities + total_equity_and_earnings, 2)

    return {
        "period": period,
        "asset_rows": asset_rows, "liability_rows": liability_rows, "equity_rows": equity_rows,
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "total_equity": round(total_equity, 2),
        "current_period_earnings": current_period_earnings,
        "total_equity_and_earnings": total_equity_and_earnings,
        "total_liabilities_and_equity": total_liabilities_and_equity,
        "is_balanced": abs(round(total_assets, 2) - total_liabilities_and_equity) < 0.01,
    }


def get_variance_analysis(db: Session, *, from_period: str, to_period: str) -> dict:
    rows = []

    internal_orders = db.query(InternalOrder).filter(InternalOrder.budgeted_amount.isnot(None)).all()
    for io in internal_orders:
        actual = db.query(JournalEntryLine).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id).filter(
            JournalEntryLine.internal_order_id == io.id,
            JournalEntry.accounting_period >= from_period, JournalEntry.accounting_period <= to_period,
            JournalEntry.status == "posted",
        ).all()
        actual_amount = round(sum(l.debit_amount - l.credit_amount for l in actual), 2)
        variance = round(actual_amount - io.budgeted_amount, 2)
        rows.append({
            "type": "internal_order", "code": io.code, "name": io.name, "budgeted_amount": io.budgeted_amount,
            "actual_amount": actual_amount, "variance": variance,
            "variance_pct": round(variance / io.budgeted_amount * 100, 2) if io.budgeted_amount else None,
        })

    cost_centers = db.query(CostCenter).filter(CostCenter.annual_budget.isnot(None)).all()
    for cc in cost_centers:
        actual = db.query(JournalEntryLine).join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id).filter(
            JournalEntryLine.cost_center_id == cc.id,
            JournalEntry.accounting_period >= from_period, JournalEntry.accounting_period <= to_period,
            JournalEntry.status == "posted",
        ).all()
        actual_amount = round(sum(l.debit_amount - l.credit_amount for l in actual), 2)
        variance = round(actual_amount - cc.annual_budget, 2)
        rows.append({
            "type": "cost_center", "code": cc.code, "name": cc.name, "budgeted_amount": cc.annual_budget,
            "actual_amount": actual_amount, "variance": variance,
            "variance_pct": round(variance / cc.annual_budget * 100, 2) if cc.annual_budget else None,
        })

    return {
        "from_period": from_period, "to_period": to_period, "rows": rows,
        "note": None if rows else "No Internal Orders or Cost Centers have a budget set yet — Variance Analysis has nothing to compare against until one does (see Finance > Masters).",
    }


def get_monthly_report_pack(db: Session, *, period: str) -> dict:
    return {
        "period": period,
        "trial_balance": get_trial_balance(db, period=period),
        "profit_and_loss": get_profit_and_loss(db, period=period),
        "balance_sheet": get_balance_sheet(db, period=period),
        "ap_aging": get_ap_aging(db),
        "ar_aging": get_ar_aging(db),
        "aging_note": "AP/AR aging reflect outstanding balances as of today, not the selected period — aging is inherently a point-in-time view, not a historical one.",
    }
