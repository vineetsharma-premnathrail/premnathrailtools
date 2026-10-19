"""Ledger balances.

Two views of the same truth:
- GLBalance rows: a per-(ledger, month) cache kept current at posting time.
  Each month's opening = the previous month's closing, so a balance carries
  forward across months and years. A back-dated posting is rolled forward
  into every later month already cached.
- account_totals(): date-precise sums straight from posted journal lines,
  used by every financial statement. Reports never read the cache, so a
  cache bug can't misstate a Balance Sheet.

All balances are stored debit-minus-credit; credit-nature accounts flip the
sign at display time."""
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine, JE_LEDGER_STATUSES
from app.modules.accounts.models.period_close import PeriodClose


def apply_to_gl_balances(db: Session, gl_account_id: int, period: str, debit: float, credit: float) -> None:
    net = round(debit - credit, 2)
    balance = db.query(GLBalance).filter(
        GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period == period,
    ).with_for_update().first()
    if not balance:
        prior = db.query(GLBalance).filter(
            GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period < period,
        ).order_by(GLBalance.accounting_period.desc()).first()
        opening = prior.closing_balance if prior else 0.0
        balance = GLBalance(gl_account_id=gl_account_id, accounting_period=period, opening_balance=opening,
                            total_debits=0, total_credits=0, closing_balance=opening)
        db.add(balance)
        db.flush()
    balance.total_debits = round((balance.total_debits or 0) + debit, 2)
    balance.total_credits = round((balance.total_credits or 0) + credit, 2)
    balance.closing_balance = round((balance.opening_balance or 0) + balance.total_debits - balance.total_credits, 2)

    if net:
        for later in db.query(GLBalance).filter(
            GLBalance.gl_account_id == gl_account_id, GLBalance.accounting_period > period,
        ).with_for_update().all():
            later.opening_balance = round(later.opening_balance + net, 2)
            later.closing_balance = round(later.closing_balance + net, 2)


def rebuild_gl_balances(db: Session) -> int:
    """Recompute every GLBalance row from posted journal lines. Safe to run
    any time; lock flags are restored from PeriodClose. Returns rows written."""
    rows = (
        db.query(
            JournalEntryLine.gl_account_id, JournalEntry.accounting_period,
            func.coalesce(func.sum(JournalEntryLine.debit_amount), 0), func.coalesce(func.sum(JournalEntryLine.credit_amount), 0),
        )
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntry.status.in_(JE_LEDGER_STATUSES))
        .group_by(JournalEntryLine.gl_account_id, JournalEntry.accounting_period)
        .order_by(JournalEntryLine.gl_account_id, JournalEntry.accounting_period)
        .all()
    )
    closed = {p.accounting_period for p in db.query(PeriodClose).filter(PeriodClose.status == "closed").all()}
    db.query(GLBalance).delete(synchronize_session="fetch")
    running: dict[int, float] = {}
    count = 0
    for account_id, period, debits, credits in rows:
        opening = running.get(account_id, 0.0)
        closing = round(opening + float(debits) - float(credits), 2)
        db.add(GLBalance(gl_account_id=account_id, accounting_period=period, opening_balance=round(opening, 2),
                         total_debits=round(float(debits), 2), total_credits=round(float(credits), 2),
                         closing_balance=closing, is_locked=period in closed))
        running[account_id] = closing
        count += 1
    db.flush()
    return count


def account_totals(
    db: Session, *, to_date: date, from_date: date | None = None, account_ids: list[int] | None = None,
    exclude_posting_types: tuple[str, ...] = (),
) -> dict[int, tuple[float, float]]:
    """{gl_account_id: (total_debit, total_credit)} over posted lines dated
    from_date..to_date inclusive (from the beginning of the books when
    from_date is None)."""
    q = (
        db.query(JournalEntryLine.gl_account_id,
                 func.coalesce(func.sum(JournalEntryLine.debit_amount), 0),
                 func.coalesce(func.sum(JournalEntryLine.credit_amount), 0))
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_date <= to_date)
    )
    if from_date is not None:
        q = q.filter(JournalEntry.posting_date >= from_date)
    if account_ids is not None:
        if not account_ids:
            return {}
        q = q.filter(JournalEntryLine.gl_account_id.in_(account_ids))
    if exclude_posting_types:
        q = q.filter(JournalEntry.posting_type.notin_(exclude_posting_types))
    return {aid: (round(float(d), 2), round(float(c), 2)) for aid, d, c in q.group_by(JournalEntryLine.gl_account_id).all()}


def account_balance(db: Session, gl_account_id: int, as_of: date) -> float:
    """Debit-minus-credit balance of one ledger as of a date (inclusive)."""
    d, c = account_totals(db, to_date=as_of, account_ids=[gl_account_id]).get(gl_account_id, (0.0, 0.0))
    return round(d - c, 2)


def party_balance(db: Session, *, as_of: date, vendor_id: int | None = None, customer_id: int | None = None) -> float:
    """Debit-minus-credit of a party across every journal line tagged with it
    (control-account lines). Vendors normally come out negative (we owe)."""
    q = (
        db.query(func.coalesce(func.sum(JournalEntryLine.debit_amount - JournalEntryLine.credit_amount), 0))
        .join(JournalEntry, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(JournalEntry.status.in_(JE_LEDGER_STATUSES), JournalEntry.posting_date <= as_of)
    )
    if vendor_id is not None:
        q = q.filter(JournalEntryLine.vendor_id == vendor_id)
    if customer_id is not None:
        q = q.filter(JournalEntryLine.customer_id == customer_id)
    return round(float(q.scalar() or 0), 2)

