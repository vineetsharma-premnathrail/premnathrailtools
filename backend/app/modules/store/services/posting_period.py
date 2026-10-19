"""MM posting period (SAP MMPV / OMSY) for goods movements.

A goods movement (GRN, issue, return, transfer, adjustment, physical count,
quality move, vendor return ...) changes the stock — and so the closing
stock Finance values and posts for its period. Once Finance has closed a
period (Finance › Period Close) or a financial year is closed / locked
(Company Info › Financial Years), no movement may be dated inside it, or the
closing stock already in the books would silently change.

Every movement passes through post_stock_transaction(), which calls
assert_stock_postable(); documents that check their own dates up front
(GRN, Return to Vendor) call it too, so the user gets the reason before
anything is saved."""
from datetime import date

from sqlalchemy.orm import Session


def _period_label(d: date) -> str:
    return d.strftime("%b-%Y")


def stock_posting_block_reason(db: Session, d: date) -> str | None:
    """Why a goods movement can't be dated `d`, or None if it can."""
    from app.modules.accounts.models.period_close import PeriodClose
    from app.modules.accounts.services import fiscal

    try:
        fiscal.assert_postable(db, d)
    except ValueError as e:
        return (f"Stock can't be moved on {d:%d-%b-%Y}: {e} Post the movement with today's date instead.")
    period = fiscal.period_of(d)
    closed = db.query(PeriodClose.id).filter(PeriodClose.accounting_period == period, PeriodClose.status == "closed").first()
    if closed:
        return (f"Period {_period_label(d)} is closed in Finance › Period Close, so stock can't be moved on {d:%d-%b-%Y} — "
                f"post with today's date, or ask Finance to reopen {_period_label(d)} if the movement really belongs there.")
    return None


def assert_stock_postable(db: Session, d: date | None) -> None:
    """Raises ValueError (real reason + fix) if `d` is in a closed period /
    closed or locked financial year."""
    reason = stock_posting_block_reason(db, d or date.today())
    if reason:
        raise ValueError(reason)
