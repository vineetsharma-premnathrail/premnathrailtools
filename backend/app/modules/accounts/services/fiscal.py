"""Financial years, accounting periods and voucher number series.

Indian books run on the financial year 1-Apr to 31-Mar. FYs themselves are
maintained in Company Info > Financial Years (organization module); this file
only reads them. If none has been set up yet, the statutory April-March year
is derived so the ledger still works — but once any FY exists, every posting
must fall inside one."""
from dataclasses import dataclass
from datetime import date, timedelta
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.accounts.models.settings import NumberSeries


@dataclass(frozen=True)
class FiscalYear:
    code: str            # "2026-27"
    start_date: date
    end_date: date
    status: str          # "open" | "closed"
    lock_date: date | None
    record_id: int | None  # CompanyFinancialYear.id, None when derived


def fy_code(start: date, end: date) -> str:
    return f"{start.year}-{str(end.year)[2:]}" if end.year != start.year else str(start.year)


def derived_fiscal_year(d: date) -> FiscalYear:
    start_year = d.year if d.month >= 4 else d.year - 1
    start, end = date(start_year, 4, 1), date(start_year + 1, 3, 31)
    return FiscalYear(fy_code(start, end), start, end, "open", None, None)


def _defined_years(db: Session):
    from app.modules.organization.models.company_financial_year import CompanyFinancialYear
    return db.query(CompanyFinancialYear).order_by(CompanyFinancialYear.start_date.asc()).all()


def fiscal_year_for(db: Session, d: date) -> FiscalYear:
    """The FY a date falls in. Raises ValueError (with the fix) if FYs are
    defined but none covers the date."""
    years = _defined_years(db)
    if not years:
        return derived_fiscal_year(d)
    for fy in years:
        if fy.start_date <= d <= fy.end_date:
            return FiscalYear(fy_code(fy.start_date, fy.end_date), fy.start_date, fy.end_date,
                              (fy.status or "open").lower(), fy.lock_date, fy.id)
    raise ValueError(
        f"No financial year covers {d:%d-%b-%Y}. Ask an admin to add it under Company Info > Financial Years "
        f"before posting on that date."
    )


def assert_postable(db: Session, d: date) -> FiscalYear:
    """Every posting date passes through here: inside a defined FY, that FY
    still open, and after its lock date (books up to the lock date are
    finalised — typically after audit)."""
    fy = fiscal_year_for(db, d)
    if fy.status == "closed":
        raise ValueError(
            f"Financial year {fy.code} is closed — nothing can be posted on {d:%d-%b-%Y}. "
            f"An admin must reopen it under Company Info > Financial Years if a correction is genuinely needed."
        )
    if fy.lock_date and d <= fy.lock_date:
        raise ValueError(
            f"Books for {fy.code} are locked up to {fy.lock_date:%d-%b-%Y} — post on a later date, "
            f"or ask an admin to move the lock date under Company Info > Financial Years."
        )
    return fy


def period_of(d: date) -> str:
    return d.strftime("%Y-%m")


def period_bounds(period: str) -> tuple[date, date]:
    """'2026-10' -> (2026-10-01, 2026-10-31)."""
    try:
        year, month = (int(p) for p in period.split("-"))
        start = date(year, month, 1)
    except (ValueError, TypeError):
        raise ValueError(f"'{period}' is not a valid period — use YYYY-MM, e.g. 2026-10.")
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, nxt - timedelta(days=1)


def _lock_series(db: Session, key: str) -> None:
    if db.get_bind().dialect.name == "postgresql":  # SQLite (tests) has no advisory locks
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})


def next_number(db: Session, prefix: str, d: date, *, width: int = 4) -> str:
    """<PREFIX>/<FY>/<NNNN> — e.g. JV/2026-27/0001. Sequence per prefix per
    FY, kept in accounts_number_series under a lock so two users posting at
    the same moment never get the same number."""
    fy = fiscal_year_for(db, d)
    key = f"{prefix}/{fy.code}"
    _lock_series(db, key)
    series = db.query(NumberSeries).filter(NumberSeries.series_key == key).with_for_update().first()
    if not series:
        series = NumberSeries(series_key=key, last_number=0)
        db.add(series)
        db.flush()
    series.last_number += 1
    db.flush()
    return f"{key}/{series.last_number:0{width}d}"
