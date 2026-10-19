"""Year-end close.

On the last day of the FY every income and expense ledger is brought to
zero and the net — the year's profit or loss — is transferred to Retained
Earnings (Reserves & Surplus). Next year's P&L then starts from nothing,
while the Balance Sheet carries the accumulated profit. The FY is then marked
closed, so nothing more can be posted into it."""
from sqlalchemy.orm import Session

from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.balances import account_totals
from app.modules.accounts.services.ledgers import ledger_id_for


def _fy_from_code(db: Session, fy_code: str) -> fiscal.FiscalYear:
    try:
        start_year = int(fy_code.split("-")[0])
    except (ValueError, AttributeError):
        raise ValueError(f"'{fy_code}' isn't a financial year code — use e.g. 2026-27.")
    from datetime import date
    probe = date(start_year, 4, 1)
    fy = fiscal.fiscal_year_for(db, probe)
    if fy.code != fy_code:
        raise ValueError(f"Financial year {fy_code} isn't set up — check Company Info > Financial Years.")
    return fy


def year_end_preview(db: Session, *, fy_code: str) -> dict:
    fy = _fy_from_code(db, fy_code)
    pl_ids = [a.id for a in db.query(GLAccount).filter(GLAccount.account_type.in_(("revenue", "expense"))).all()]
    totals = account_totals(db, from_date=fy.start_date, to_date=fy.end_date, account_ids=pl_ids, exclude_posting_types=("year_end",))
    income = round(sum(c - d for d, c in totals.values()), 2)
    existing = _existing_close(db, fy.code)
    return {"fy_code": fy.code, "end_date": fy.end_date, "net_profit": income, "status": fy.status,
            "closing_entry": existing.entry_number if existing else None}


def _existing_close(db: Session, fy_code: str):
    return db.query(JournalEntry).filter(JournalEntry.posting_type == "year_end", JournalEntry.financial_year == fy_code,
                                         JournalEntry.status == "posted",
                                         # its reversal (a reopen) keeps posting_type 'year_end' but isn't a close
                                         JournalEntry.reverses_journal_entry_id.is_(None)).first()


def close_financial_year(db: Session, *, fy_code: str, user_id: int) -> JournalEntry:
    from app.modules.accounts.service import post_journal_entry

    fy = _fy_from_code(db, fy_code)
    if _existing_close(db, fy.code):
        raise ValueError(f"Financial year {fy.code} has already been closed.")
    for model, date_col, label in ((VendorInvoice, VendorInvoice.invoice_date, "purchase invoice"),
                                   (ARTransaction, ARTransaction.invoice_date, "sales invoice"),
                                   (PartyNote, PartyNote.note_date, "debit/credit note")):
        pending = db.query(model).filter(model.status == "pending", date_col >= fy.start_date, date_col <= fy.end_date).count()
        if pending:
            raise ValueError(f"{pending} {label}(s) dated in {fy.code} are still unposted — post or cancel them before closing the year.")
    drafts = db.query(JournalEntry).filter(JournalEntry.status == "draft", JournalEntry.posting_date >= fy.start_date,
                                           JournalEntry.posting_date <= fy.end_date).count()
    if drafts:
        raise ValueError(f"{drafts} draft journal(s) dated in {fy.code} are still waiting — post or discard them first.")

    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.account_type.in_(("revenue", "expense"))).all()}
    totals = account_totals(db, to_date=fy.end_date, account_ids=list(accounts))
    lines, net_profit = [], 0.0
    for aid, (d, c) in totals.items():
        bal = round(d - c, 2)
        if not bal:
            continue
        net_profit += -bal
        side = "credit" if bal > 0 else "debit"
        lines.append({"gl_account_id": aid, f"{side}_amount": abs(bal), "remarks": f"Year-end close {fy.code}"})
    if not lines:
        raise ValueError(f"No income or expense balances in {fy.code} — nothing to close.")
    net_profit = round(net_profit, 2)
    if net_profit:
        side = "credit" if net_profit > 0 else "debit"
        lines.append({"gl_account_id": ledger_id_for(db, "retained_earnings"), f"{side}_amount": abs(net_profit),
                      "remarks": f"{'Profit' if net_profit > 0 else 'Loss'} for {fy.code} transferred"})
    entry = post_journal_entry(db, posting_date=fy.end_date, lines=lines, posting_type="year_end",
                               description=f"Year-end close {fy.code} — net {'profit' if net_profit >= 0 else 'loss'} {abs(net_profit):,.2f} to Retained Earnings",
                               created_by_id=user_id)
    if fy.record_id:
        from app.modules.organization.models.company_financial_year import CompanyFinancialYear
        rec = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy.record_id).first()
        rec.status = "closed"
    db.flush()
    return entry


def reopen_financial_year(db: Session, *, fy_code: str, reason: str, user_id: int) -> JournalEntry:
    from app.modules.accounts.service import reverse_journal_entry

    fy = _fy_from_code(db, fy_code)
    entry = _existing_close(db, fy.code)
    if not entry:
        raise ValueError(f"Financial year {fy.code} hasn't been closed.")
    if fy.record_id:
        from app.modules.organization.models.company_financial_year import CompanyFinancialYear
        rec = db.query(CompanyFinancialYear).filter(CompanyFinancialYear.id == fy.record_id).first()
        rec.status = "open"
        db.flush()
    reversal = reverse_journal_entry(db, journal_entry_id=entry.id, reason=reason, reversed_by_id=user_id, reversal_date=fy.end_date)
    return reversal
