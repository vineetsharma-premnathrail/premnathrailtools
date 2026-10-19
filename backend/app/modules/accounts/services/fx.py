"""Foreign currency (SAP OB08 rates, document currency, realised exchange
difference on clearing, F.05 month-end revaluation).

The books are INR. A foreign document is entered in its own currency at a
rate; its lines are converted to INR before GST and posting, and it keeps
amount_fc / amount_due_fc in the document currency.

Realised difference (AS 11 / Ind AS 21 para 28): when a foreign bill is
settled by a voucher in the same currency at a different rate, the bill is
cleared at ITS booking rate and the voucher gives up the INR at ITS rate;
the gap is an exchange gain or loss, posted on the party's control ledger:
    vendor   gain: Dr AP (vendor)  Cr fx_gain     loss: Dr fx_loss  Cr AP
    customer gain: Dr AR (cust.)   Cr fx_gain     loss: Dr fx_loss  Cr AR

Revaluation: open foreign bills (monetary items) at month end are restated
at the closing rate; the unrealised difference is posted on the last day of
the month and reversed automatically on the 1st of the next, so the next
settlement still compares against the booking rate. Advances are
non-monetary (AS 11 para 9) and are not revalued."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import date, timedelta
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.accounts.models.fx import Currency, ExchangeRate, FxRevaluation, BOOKS_CURRENCY, RATE_TYPES
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.payment_transaction import PaymentAllocation
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.ledgers import ledger_id_for

FC_TOL = 0.005  # half a cent / paisa in the document currency


def _r(x) -> float:
    return round(float(x or 0), 2)


# ── master data ────────────────────────────────────────────────────────

def normalise_currency(db: Session, currency: str | None) -> str:
    code = (currency or BOOKS_CURRENCY).strip().upper()
    if code == BOOKS_CURRENCY:
        return code
    cur = db.query(Currency).filter(Currency.code == code).first()
    if not cur:
        raise ValueError(f"Currency '{code}' isn't in the currency master — add it under Finance › Masters › Currencies & FX first.")
    if not cur.is_active:
        raise ValueError(f"Currency '{code}' is inactive — re-activate it under Finance › Masters › Currencies & FX.")
    return code


def rate_on(db: Session, currency: str, on: date, rate_type: str = "bank") -> float:
    """The rate in force on a date: the latest one dated on or before it."""
    if currency == BOOKS_CURRENCY:
        return 1.0
    row = (db.query(ExchangeRate)
           .filter(ExchangeRate.currency == currency, ExchangeRate.rate_type == rate_type, ExchangeRate.rate_date <= on)
           .order_by(ExchangeRate.rate_date.desc()).first())
    if not row:
        raise ValueError(f"No {rate_type} exchange rate for {currency} on or before {on:%d-%b-%Y} — enter the day's rate "
                         f"under Finance › Masters › Currencies & FX, or type the rate on the document.")
    return float(row.rate)


def resolve_rate(db: Session, currency: str, on: date, exchange_rate: float | None) -> float:
    if currency == BOOKS_CURRENCY:
        if exchange_rate not in (None, 0, 1, 1.0):
            raise ValueError("An INR document has exchange rate 1 — clear the rate, or pick the foreign currency.")
        return 1.0
    if exchange_rate is not None:
        rate = float(exchange_rate)
        if rate <= 0:
            raise ValueError(f"The exchange rate must be greater than zero (INR for 1 {currency}).")
        return round(rate, 6)
    return rate_on(db, currency, on)


def set_rate(db: Session, *, currency: str, rate_date: date, rate: float, rate_type: str = "bank",
             source: str | None = None, user_id: int | None = None) -> ExchangeRate:
    currency = normalise_currency(db, currency)
    if currency == BOOKS_CURRENCY:
        raise ValueError("INR is the books currency — its rate is always 1.")
    if rate_type not in RATE_TYPES:
        raise ValueError(f"Rate type must be one of: {', '.join(RATE_TYPES)}.")
    if not rate or float(rate) <= 0:
        raise ValueError("The rate must be greater than zero (INR for 1 unit of the currency).")
    row = db.query(ExchangeRate).filter(ExchangeRate.currency == currency, ExchangeRate.rate_date == rate_date,
                                        ExchangeRate.rate_type == rate_type).first()
    if row:
        row.rate, row.source = round(float(rate), 6), source
    else:
        row = ExchangeRate(currency=currency, rate_date=rate_date, rate_type=rate_type, rate=round(float(rate), 6),
                           source=source, created_by_id=user_id)
        db.add(row)
    db.flush()
    return row


# ── documents ──────────────────────────────────────────────────────────

@dataclass
class DocCurrency:
    currency: str
    rate: float
    lines: list[dict] | None
    fc_taxable: float = 0.0
    fc_tax: float = 0.0

    @property
    def foreign(self) -> bool:
        return self.currency != BOOKS_CURRENCY

    def stamp(self, doc, *, exclude_tax: bool = False) -> None:
        """Writes currency / rate / FC amounts on a VendorInvoice or ARTransaction."""
        doc.currency, doc.exchange_rate = self.currency, self.rate
        if self.foreign:
            doc.amount_fc = _r(self.fc_taxable + (0 if exclude_tax else self.fc_tax))
            doc.amount_due_fc = doc.amount_fc
        else:
            doc.amount_fc = doc.amount_due_fc = None


def document_currency(db: Session, lines: list[dict] | None, *, currency: str | None, exchange_rate: float | None,
                      on: date) -> DocCurrency:
    """For an invoice entered in a foreign currency: returns its lines with
    rate and discount converted to INR (the caller then computes GST and
    posts in INR as usual) and the totals in the document currency."""
    code = normalise_currency(db, currency)
    rate = resolve_rate(db, code, on, exchange_rate)
    if code == BOOKS_CURRENCY:
        return DocCurrency(code, 1.0, lines)
    if not lines:
        raise ValueError(f"A {code} document needs line items (quantity x rate in {code}) — the single-amount entry is INR only.")
    from app.modules.accounts.services import gst
    fc_lines = copy.deepcopy([dict(l) for l in lines])
    fc = gst.compute_lines(fc_lines, interstate=True)
    inr_lines = []
    for l in lines:
        l = dict(l)
        l["rate"] = round(float(l.get("rate") or 0) * rate, 4)
        l["discount_amount"] = round(float(l.get("discount_amount") or 0) * rate, 2)
        inr_lines.append(l)
    return DocCurrency(code, rate, inr_lines, fc_taxable=fc["taxable"], fc_tax=fc["tax"])


def voucher_currency(db: Session, *, payment_type: str, currency: str | None, exchange_rate: float | None,
                     amount_fc: float | None, amount: float, on: date) -> tuple[str, float, float | None, float]:
    """(currency, rate, amount_fc, INR amount) for a voucher. A foreign
    voucher's INR amount is amount_fc x rate."""
    code = normalise_currency(db, currency)
    rate = resolve_rate(db, code, on, exchange_rate)
    if code == BOOKS_CURRENCY:
        return code, 1.0, None, amount
    if payment_type not in ("vendor", "customer"):
        raise ValueError("Only a vendor payment or a customer receipt can be in a foreign currency — record expenses, "
                         "other receipts and contras in INR.")
    fc = _r(amount_fc if amount_fc is not None else (amount / rate if amount else 0))
    if fc <= 0:
        raise ValueError(f"Enter the amount in {code} (amount_fc) for a foreign-currency voucher.")
    return code, rate, fc, _r(fc * rate)


# ── settlement (realised exchange difference) ──────────────────────────

@dataclass
class FxSplit:
    target_inr: float   # clears the bill (its booking rate)
    source_inr: float   # leaves the voucher (its own rate)
    amount_fc: float
    difference: float   # + gain, - loss


def split_settlement(src, target, target_type: str, amount: float, amount_fc: float | None = None) -> FxSplit | None:
    """None for an INR settlement. Raises when the currencies don't match."""
    s_cur = getattr(src, "currency", None) or BOOKS_CURRENCY
    t_cur = getattr(target, "currency", None) or BOOKS_CURRENCY
    label = getattr(target, "invoice_number", "")
    if s_cur == BOOKS_CURRENCY and t_cur == BOOKS_CURRENCY:
        return None
    if s_cur != t_cur:
        raise ValueError(
            f"Invoice '{label}' is in {t_cur} but voucher '{src.payment_number}' is in {s_cur} — settle a foreign bill with "
            f"a voucher in the same currency (enter the {t_cur} amount and the bank's rate on the voucher), so the "
            f"exchange difference is worked out and booked.")
    s_rate, t_rate = float(src.exchange_rate or 1), float(target.exchange_rate or 1)
    fc = _r(amount_fc) if amount_fc else _r(amount / s_rate)
    due_fc = _r(target.amount_due_fc if target.amount_due_fc is not None else target.amount_due / t_rate)
    src_fc = _r(src.unallocated_amount / s_rate)
    if fc > due_fc + FC_TOL:
        raise ValueError(f"Invoice '{label}' has only {t_cur} {due_fc:,.2f} open; can't settle {t_cur} {fc:,.2f}.")
    if fc > src_fc + FC_TOL:
        raise ValueError(f"Voucher '{src.payment_number}' has only {s_cur} {src_fc:,.2f} left to allocate.")
    target_inr = _r(target.amount_due) if fc >= due_fc - FC_TOL else min(_r(fc * t_rate), _r(target.amount_due))
    source_inr = _r(src.unallocated_amount) if fc >= src_fc - FC_TOL else min(_r(fc * s_rate), _r(src.unallocated_amount))
    diff = _r(target_inr - source_inr) if target_type == "vendor_invoice" else _r(source_inr - target_inr)
    return FxSplit(target_inr, source_inr, fc, diff)


def reduce_open_fc(target, inr_amount: float, fc: float | None) -> None:
    """Keeps a foreign bill's open FC amount in step with its INR settlement
    (for notes / write-offs the FC part is the INR at the booking rate)."""
    if getattr(target, "amount_fc", None) is None:
        return
    if fc is None:
        fc = _r(inr_amount / float(target.exchange_rate or 1))
    target.amount_due_fc = 0.0 if target.amount_due <= 1e-9 else max(_r((target.amount_due_fc or 0) - fc), 0.0)


def restore_open_fc(target, inr_amount: float, fc: float | None) -> None:
    if getattr(target, "amount_fc", None) is None:
        return
    if fc is None:
        fc = _r(inr_amount / float(target.exchange_rate or 1))
    target.amount_due_fc = min(_r((target.amount_due_fc or 0) + fc), _r(target.amount_fc))


def post_fx_difference(db: Session, *, alloc: PaymentAllocation, src, target, target_type: str, split: FxSplit,
                       on: date, user_id: int | None) -> JournalEntry | None:
    from app.modules.accounts.service import post_journal_entry

    alloc.source_amount, alloc.amount_fc, alloc.fx_difference = split.source_inr, split.amount_fc, split.difference
    if abs(split.difference) < 0.01:
        db.flush()
        return None
    diff = abs(split.difference)
    gain = split.difference > 0
    label = getattr(target, "invoice_number", "")
    what = (f"Exchange {'gain' if gain else 'loss'} on {split.amount_fc:,.2f} {target.currency} — {label} booked @ "
            f"{float(target.exchange_rate):g}, settled by {src.payment_number} @ {float(src.exchange_rate):g}")
    if target_type == "vendor_invoice":
        from app.modules.accounts.models.vendor import Vendor
        v = db.query(Vendor).filter(Vendor.id == target.vendor_id).first()
        party = {"gl_account_id": (v.gl_reconciliation_account_id if v else None) or ledger_id_for(db, "ap_control"), "vendor_id": target.vendor_id}
        party_side = "debit" if gain else "credit"
    else:
        from app.modules.crm.models.organization import Organization
        c = db.query(Organization).filter(Organization.id == target.customer_id).first()
        party = {"gl_account_id": (c.gl_reconciliation_account_id if c else None) or ledger_id_for(db, "ar_control"), "customer_id": target.customer_id}
        party_side = "debit" if gain else "credit"
    other_side = "credit" if party_side == "debit" else "debit"
    lines = [{**party, f"{party_side}_amount": diff, "remarks": what},
             {"gl_account_id": ledger_id_for(db, "fx_gain" if gain else "fx_loss"), f"{other_side}_amount": diff, "remarks": what}]
    entry = post_journal_entry(db, posting_date=on, lines=lines, posting_type="fx_difference", voucher_type="journal",
                               description=what, reference_document_type="payment_allocation_fx",
                               reference_document_id=alloc.id, created_by_id=user_id)
    alloc.fx_journal_entry_id = entry.id
    db.flush()
    return entry


def reverse_fx_difference(db: Session, alloc: PaymentAllocation, *, reason: str | None, user_id: int | None) -> None:
    from app.modules.accounts.service import reverse_journal_entry

    if not alloc.fx_journal_entry_id:
        return
    je = db.query(JournalEntry).filter(JournalEntry.id == alloc.fx_journal_entry_id).first()
    if je is not None and je.status == "posted":
        reverse_journal_entry(db, journal_entry_id=je.id, reason=reason or "Settlement removed — exchange difference undone",
                              reversed_by_id=user_id, reversal_date=max(date.today(), je.posting_date))


# ── F.05 month-end revaluation ─────────────────────────────────────────

def _open_as_of(db: Session, doc, target_type: str, as_of: date) -> tuple[float, float]:
    """(open FC, open INR at booking value) of a foreign bill on a date."""
    total_inr = _r(doc.invoice_total if target_type == "vendor_invoice" else doc.total_amount)
    rate = float(doc.exchange_rate or 1)
    settled_inr = settled_fc = 0.0
    for a in db.query(PaymentAllocation).filter(PaymentAllocation.target_type == target_type,
                                                PaymentAllocation.target_id == doc.id,
                                                PaymentAllocation.allocation_date <= as_of).all():
        settled_inr += float(a.amount)
        settled_fc += float(a.amount_fc) if a.amount_fc is not None else float(a.amount) / rate
    open_inr = _r(total_inr - settled_inr)
    open_fc = _r(float(doc.amount_fc or 0) - settled_fc)
    if open_inr <= 0.009:
        return 0.0, 0.0
    return max(open_fc, 0.0), open_inr


def revaluation_preview(db: Session, *, accounting_period: str, rates: dict[str, float] | None = None) -> dict:
    _, end = fiscal.period_bounds(accounting_period)
    rates = {k.upper(): float(v) for k, v in (rates or {}).items() if v}
    items, used, missing = [], {}, []
    sources = (("vendor_invoice", VendorInvoice, VendorInvoice.invoice_date), ("ar_transaction", ARTransaction, ARTransaction.invoice_date))
    for target_type, model, date_col in sources:
        docs = db.query(model).filter(model.status == "posted", model.currency != BOOKS_CURRENCY, date_col <= end).all()
        for doc in docs:
            open_fc, open_inr = _open_as_of(db, doc, target_type, end)
            if open_fc <= 0:
                continue
            cur = doc.currency
            if cur not in used:
                try:
                    used[cur] = rates.get(cur) or rate_on(db, cur, end)
                except ValueError:
                    missing.append(cur)
                    used[cur] = None
            if used[cur] is None:
                continue
            revalued = _r(open_fc * used[cur])
            diff = _r(revalued - open_inr)
            # Asset (receivable) up = gain; liability (payable) up = loss.
            effect = diff if target_type == "ar_transaction" else -diff
            party_name = None
            if target_type == "vendor_invoice":
                from app.modules.accounts.models.vendor import Vendor
                v = db.query(Vendor).filter(Vendor.id == doc.vendor_id).first()
                party_name = v.name if v else None
            else:
                from app.modules.crm.models.organization import Organization
                c = db.query(Organization).filter(Organization.id == doc.customer_id).first()
                party_name = c.name if c else None
            items.append({
                "doc_type": target_type, "doc_id": doc.id, "number": doc.invoice_number, "party": party_name,
                "vendor_id": getattr(doc, "vendor_id", None), "customer_id": getattr(doc, "customer_id", None),
                "currency": cur, "booking_rate": float(doc.exchange_rate), "open_fc": open_fc, "book_inr": open_inr,
                "closing_rate": used[cur], "revalued_inr": revalued, "difference": diff, "gain_loss": effect,
            })
    if missing:
        raise ValueError(f"No closing rate for {', '.join(sorted(set(missing)))} on or before {end:%d-%b-%Y} — enter the "
                         f"month-end rate under Finance › Masters › Currencies & FX (or on the revaluation form).")
    return {"accounting_period": accounting_period, "revaluation_date": end, "rates": {k: v for k, v in used.items() if v},
            "items": items, "total_gain": _r(sum(i["gain_loss"] for i in items if i["gain_loss"] > 0)),
            "total_loss": _r(-sum(i["gain_loss"] for i in items if i["gain_loss"] < 0))}


def _party_line(db: Session, item: dict) -> dict:
    if item["doc_type"] == "vendor_invoice":
        from app.modules.accounts.models.vendor import Vendor
        v = db.query(Vendor).filter(Vendor.id == item["vendor_id"]).first()
        return {"gl_account_id": (v.gl_reconciliation_account_id if v else None) or ledger_id_for(db, "ap_control"), "vendor_id": item["vendor_id"]}
    from app.modules.crm.models.organization import Organization
    c = db.query(Organization).filter(Organization.id == item["customer_id"]).first()
    return {"gl_account_id": (c.gl_reconciliation_account_id if c else None) or ledger_id_for(db, "ar_control"), "customer_id": item["customer_id"]}


def run_revaluation(db: Session, *, accounting_period: str, rates: dict[str, float] | None, user_id: int | None) -> FxRevaluation:
    from app.modules.accounts.service import post_journal_entry

    existing = db.query(FxRevaluation).filter(FxRevaluation.accounting_period == accounting_period,
                                              FxRevaluation.status == "posted").first()
    if existing:
        raise ValueError(f"Foreign-currency revaluation for {accounting_period} is already posted — cancel it first to run it again.")
    preview = revaluation_preview(db, accounting_period=accounting_period, rates=rates)
    items = [i for i in preview["items"] if abs(i["difference"]) >= 0.01]
    if not items:
        raise ValueError(f"Nothing to revalue for {accounting_period} — no open foreign-currency bill differs from its "
                         f"booking value at the closing rate.")
    end = preview["revaluation_date"]
    run = FxRevaluation(accounting_period=accounting_period, revaluation_date=end, rates=preview["rates"],
                        lines=[{k: v for k, v in i.items()} for i in preview["items"]],
                        total_gain=preview["total_gain"], total_loss=preview["total_loss"], created_by_id=user_id)
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        raise ValueError(f"The revaluation for {accounting_period} was just posted by someone else — reload the page.") from None
    lines, gain, loss = [], 0.0, 0.0
    for i in items:
        amt = abs(i["difference"])
        what = f"FX revaluation {accounting_period} — {i['number']} {i['open_fc']:,.2f} {i['currency']} @ {i['closing_rate']:g}"
        # The control ledger moves by `difference` (debit when up for AR, credit when up for AP).
        up = i["difference"] > 0
        if i["doc_type"] == "ar_transaction":
            side = "debit" if up else "credit"
        else:
            side = "credit" if up else "debit"
        lines.append({**_party_line(db, i), f"{side}_amount": amt, "remarks": what})
        if i["gain_loss"] > 0:
            gain += amt
        else:
            loss += amt
    if gain:
        lines.append({"gl_account_id": ledger_id_for(db, "fx_unrealised_gain"), "credit_amount": _r(gain), "remarks": f"Unrealised exchange gain {accounting_period}"})
    if loss:
        lines.append({"gl_account_id": ledger_id_for(db, "fx_unrealised_loss"), "debit_amount": _r(loss), "remarks": f"Unrealised exchange loss {accounting_period}"})
    entry = post_journal_entry(db, posting_date=end, lines=lines, posting_type="fx_revaluation", voucher_type="journal",
                               description=f"Foreign-currency revaluation {accounting_period} (reverses {end + timedelta(days=1):%d-%b-%Y})",
                               reference_document_type="fx_revaluation", reference_document_id=run.id,
                               created_by_id=user_id, auto_reverse_on=end + timedelta(days=1))
    run.journal_entry_id = entry.id
    db.flush()
    return run


def cancel_revaluation(db: Session, *, revaluation_id: int, reason: str, user_id: int | None) -> FxRevaluation:
    """Undoes a revaluation that was wrong (e.g. a bad closing rate): posts
    the mirror journal on the same day with the same next-day auto-reversal,
    so both days net to zero; the month can then be revalued again."""
    from app.modules.accounts.service import post_journal_entry, lock_row

    run = lock_row(db, FxRevaluation, revaluation_id)
    if not run or run.status != "posted":
        raise ValueError("Only a posted revaluation can be cancelled.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the revaluation — it goes on the audit trail.")
    later = db.query(FxRevaluation).filter(FxRevaluation.accounting_period > run.accounting_period,
                                           FxRevaluation.status == "posted").first()
    if later:
        raise ValueError(f"Cancel the later revaluation for {later.accounting_period} first — revaluations are undone newest first.")
    original = db.query(JournalEntry).filter(JournalEntry.id == run.journal_entry_id).first()
    from app.modules.accounts.service import _lines_as_dicts
    mirror = []
    for l in _lines_as_dicts(original):
        l["debit_amount"], l["credit_amount"] = l["credit_amount"], l["debit_amount"]
        mirror.append(l)
    post_journal_entry(db, posting_date=run.revaluation_date, lines=mirror, posting_type="fx_revaluation", voucher_type="journal",
                       description=f"Cancellation of FX revaluation {run.accounting_period}: {reason}",
                       reference_document_type="fx_revaluation_cancel", reference_document_id=run.id,
                       created_by_id=user_id, auto_reverse_on=run.revaluation_date + timedelta(days=1))
    run.status = "reversed"
    run.reversal_reason = reason
    db.flush()
    return run
