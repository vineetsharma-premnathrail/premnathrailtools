"""Electronic bank statement (SAP FF67 / FEBAN) on top of the bank
reconciliation (BRS).

Flow: an in-progress reconciliation -> upload the bank's statement file
(CSV / XLSX, read through a coded bank template) -> auto-match -> manual
match / book what's left -> complete the reconciliation (which now also
requires every statement line to be matched or booked).

Matching never changes a voucher's amount or ledger: it only marks the
voucher side as cleared by the bank (mark_payments_reconciled, bank date =
the line's value date), exactly what ticking it on the BRS screen does. A
line the books don't explain yet — bank charges, interest, a direct credit —
is "booked": an expense / other-receipt voucher is posted from it and
cleared at once.

Auto-match passes (each needs the same amount and direction, and a voucher
dated on or before the line's value date):
  1. UTR       voucher UTR / reference = the line's reference, or appears
               in the narration (banks print the UTR inside it)
  2. cheque    voucher cheque number = the line's cheque / reference number
  3. amount + date  the only voucher with that amount within 10 days before
               the value date, and no other line claims that voucher
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.models.bank_statement import BankStatement, BankStatementLine
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.services.bank_statement_formats import norm_cheque, norm_ref, parse_statement

AMOUNT_DATE_WINDOW_DAYS = 10
# What "Book" can create from an unmatched line -> (ledger role for a debit
# line, ledger role for a credit line). None = the user must pick the ledger.
BOOK_KINDS: dict[str, tuple[str, tuple[str | None, str | None]]] = {
    "bank_charges": ("Bank charges / fees", ("bank_charges", None)),
    "interest": ("Interest (paid on a debit line, received on a credit line)", (None, "bank_interest_income")),
    "other": ("Other — pick the ledger", (None, None)),
}


def _recon(db: Session, recon_id: int, *, for_update: bool = False) -> BankReconciliation:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == recon_id).first()
    if not recon:
        raise ValueError(f"Bank reconciliation #{recon_id} doesn't exist — refresh the Reconciliation list.")
    if for_update and recon.status != "in_progress":
        raise ValueError(f"The reconciliation for {recon.statement_date:%d-%b-%Y} is already completed — statement lines "
                         f"can only be imported or matched while it is in progress. Start a new reconciliation for the next statement.")
    return recon


def _line(db: Session, line_id: int) -> BankStatementLine:
    line = db.query(BankStatementLine).filter(BankStatementLine.id == line_id).first()
    if not line:
        raise ValueError(f"Statement line #{line_id} doesn't exist — it may have been removed with its statement. Reload the reconciliation.")
    return line


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Import ───────────────────────────────────────────────────────────────

def last_format_for(db: Session, bank_account_id: int) -> str | None:
    s = (db.query(BankStatement).filter(BankStatement.bank_account_id == bank_account_id)
         .order_by(BankStatement.id.desc()).first())
    return s.statement_format if s else None


def import_statement(db: Session, *, bank_reconciliation_id: int, content: bytes, file_name: str, format_key: str,
                     uploaded_by_id: int | None) -> tuple[BankStatement, list[str]]:
    recon = _recon(db, bank_reconciliation_id, for_update=True)
    bank = db.query(BankAccount).filter(BankAccount.id == recon.bank_account_id).first()
    parsed = parse_statement(content, file_name, format_key)

    late = [p for p in parsed if p.value_date > recon.statement_date]
    if late:
        first = min(p.value_date for p in late)
        raise ValueError(
            f"{len(late)} line(s) are dated after this reconciliation's statement date ({recon.statement_date:%d-%b-%Y}), "
            f"the first on {first:%d-%b-%Y}. Download the statement only up to {recon.statement_date:%d-%b-%Y}, or start the "
            f"reconciliation with the statement's own closing date.")

    keys = [p.dedup_key(recon.bank_account_id) for p in parsed]
    existing = {k for (k,) in db.query(BankStatementLine.dedup_key).filter(
        BankStatementLine.bank_account_id == recon.bank_account_id, BankStatementLine.dedup_key.in_(keys)).all()}
    fresh = [(p, k) for p, k in zip(parsed, keys) if k not in existing]
    skipped = len(parsed) - len(fresh)
    if not fresh:
        raise ValueError(f"Every line in '{file_name}' ({len(parsed)}) was already imported for {bank.bank_name if bank else 'this account'} — nothing new to add.")

    with_bal = [p for p in parsed if p.balance is not None]
    stmt = BankStatement(
        bank_account_id=recon.bank_account_id, bank_reconciliation_id=recon.id, statement_format=format_key,
        file_name=(file_name or "")[:255] or None, from_date=min(p.value_date for p in parsed),
        to_date=max(p.value_date for p in parsed), opening_balance=with_bal[0].balance if with_bal else None,
        closing_balance=with_bal[-1].balance if with_bal else None, line_count=len(fresh), skipped_duplicates=skipped,
        uploaded_by_id=uploaded_by_id,
    )
    db.add(stmt)
    db.flush()
    for i, (p, k) in enumerate(fresh, start=1):
        db.add(BankStatementLine(
            statement_id=stmt.id, bank_account_id=recon.bank_account_id, bank_reconciliation_id=recon.id, line_number=i,
            txn_date=p.txn_date, value_date=p.value_date, description=p.description, reference=p.reference,
            cheque_number=p.cheque_number, debit=p.debit, credit=p.credit, balance=p.balance, dedup_key=k,
        ))
    db.flush()

    warnings: list[str] = []
    if skipped:
        warnings.append(f"{skipped} line(s) were already imported from an earlier file and were skipped.")
    if stmt.closing_balance is not None and stmt.to_date == recon.statement_date \
            and abs(stmt.closing_balance - recon.statement_balance) >= 0.01:
        warnings.append(
            f"The file's closing balance ({stmt.closing_balance:,.2f} on {stmt.to_date:%d-%b-%Y}) differs from the statement "
            f"balance entered on this reconciliation ({recon.statement_balance:,.2f}). Check the figure you entered.")
    return stmt, warnings


def delete_statement(db: Session, *, statement_id: int) -> BankStatement:
    stmt = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not stmt:
        raise ValueError(f"Statement #{statement_id} doesn't exist — reload the reconciliation.")
    _recon(db, stmt.bank_reconciliation_id, for_update=True)
    used = [l for l in stmt.lines if l.match_status != "unmatched"]
    if used:
        raise ValueError(f"{len(used)} line(s) of '{stmt.file_name or 'this statement'}' are already matched or booked — "
                         f"unmatch them first, then remove the statement.")
    db.delete(stmt)
    db.flush()
    return stmt


# ── Matching ─────────────────────────────────────────────────────────────

def _sides_for(db: Session, recon: BankReconciliation) -> list[dict]:
    from app.modules.accounts.service import voucher_sides
    return voucher_sides(db, recon.bank_account_id, as_of=recon.statement_date)


def _fits(line: BankStatementLine, side: dict) -> bool:
    p = side["payment"]
    return (side["direction"] == line.direction and abs(float(p.amount) - line.amount) < 0.005
            and p.payment_date <= line.value_date)


def _clear(db: Session, recon: BankReconciliation, line: BankStatementLine, payments: list[PaymentTransaction],
           method: str, user_id: int | None) -> None:
    from app.modules.accounts.service import mark_payments_reconciled
    mark_payments_reconciled(db, bank_reconciliation_id=recon.id, payment_transaction_ids=[p.id for p in payments],
                             cleared_date=line.value_date)
    line.match_status = "booked" if method == "booked" else "matched"
    line.match_method = method
    line.matched_payments = [{"payment_id": p.id, "side": "counter" if p.counter_bank_account_id == recon.bank_account_id else "main"}
                             for p in payments]
    line.matched_by_id = user_id
    line.matched_at = _now()
    db.flush()


def auto_match(db: Session, *, bank_reconciliation_id: int, user_id: int | None) -> dict:
    recon = _recon(db, bank_reconciliation_id, for_update=True)
    lines = (db.query(BankStatementLine)
             .filter(BankStatementLine.bank_reconciliation_id == recon.id, BankStatementLine.match_status == "unmatched")
             .order_by(BankStatementLine.value_date, BankStatementLine.id).all())
    stats = {"utr": 0, "cheque": 0, "amount_date": 0, "ambiguous": 0, "unmatched": 0}
    if not lines:
        return stats
    sides = _sides_for(db, recon)
    taken: set[int] = set()

    def free(line):
        return [s for s in sides if s["payment"].id not in taken and _fits(line, s)]

    def take(line, side, method):
        _clear(db, recon, line, [side["payment"]], method, user_id)
        taken.add(side["payment"].id)
        stats[method] += 1

    # 1. UTR / bank reference
    for line in lines:
        ref, desc = norm_ref(line.reference), norm_ref(line.description)
        if not ref and not desc:
            continue
        hits = []
        for s in free(line):
            v = norm_ref(s["payment"].reference_no)
            if len(v) >= 6 and (v == ref or (ref and len(ref) >= 6 and v in ref) or v in desc):
                hits.append(s)
        if len(hits) == 1:
            take(line, hits[0], "utr")
    # 2. Cheque number
    for line in [l for l in lines if l.match_status == "unmatched"]:
        chqs = {c for c in (norm_cheque(line.cheque_number), norm_cheque(line.reference)) if c}
        if not chqs:
            continue
        hits = [s for s in free(line) if norm_cheque(s["payment"].cheque_number) in chqs]
        if len(hits) == 1:
            take(line, hits[0], "cheque")
    # 3. Amount + date window, unique both ways
    rest = [l for l in lines if l.match_status == "unmatched"]
    cands: dict[int, list[dict]] = {}
    for line in rest:
        lo = line.value_date - timedelta(days=AMOUNT_DATE_WINDOW_DAYS)
        cands[line.id] = [s for s in free(line) if s["payment"].payment_date >= lo]
    claims: dict[int, int] = {}
    for c in cands.values():
        for s in c:
            claims[s["payment"].id] = claims.get(s["payment"].id, 0) + 1
    for line in rest:
        c = cands[line.id]
        if len(c) == 1 and claims[c[0]["payment"].id] == 1:
            take(line, c[0], "amount_date")
        elif c:
            stats["ambiguous"] += 1
        else:
            stats["unmatched"] += 1
    return stats


def candidates(db: Session, *, line_id: int) -> list[dict]:
    """Uncleared vouchers in the line's direction dated on/before its value
    date, closest amount first — for the manual-match picker."""
    line = _line(db, line_id)
    recon = _recon(db, line.bank_reconciliation_id)
    out = []
    for s in _sides_for(db, recon):
        p = s["payment"]
        if s["direction"] != line.direction or p.payment_date > line.value_date:
            continue
        out.append({"side": s, "exact": abs(float(p.amount) - line.amount) < 0.005})
    out.sort(key=lambda x: (not x["exact"], abs(float(x["side"]["payment"].amount) - line.amount), -x["side"]["payment"].payment_date.toordinal()))
    return [x["side"] for x in out]


def match_line(db: Session, *, line_id: int, payment_ids: list[int], user_id: int | None) -> BankStatementLine:
    line = _line(db, line_id)
    recon = _recon(db, line.bank_reconciliation_id, for_update=True)
    if line.match_status != "unmatched":
        raise ValueError(f"Statement line {line.line_number} is already {line.match_status} — unmatch it first to change what it clears.")
    ids = list(dict.fromkeys(payment_ids or []))
    if not ids:
        raise ValueError("Pick the voucher(s) this statement line clears.")
    sides = {s["payment"].id: s for s in _sides_for(db, recon)}
    payments = []
    for pid in ids:
        s = sides.get(pid)
        if s is None:
            p = db.query(PaymentTransaction).filter(PaymentTransaction.id == pid).first()
            name = p.payment_number if p else f"#{pid}"
            raise ValueError(f"Voucher {name} isn't an uncleared voucher of this bank account dated on or before "
                             f"{recon.statement_date:%d-%b-%Y} — it may already be cleared, cancelled or on another account.")
        if s["direction"] != line.direction:
            want = "payment / withdrawal" if line.direction == "out" else "receipt / deposit"
            raise ValueError(f"Voucher {s['payment'].payment_number} moves money the other way — this line is a {want}.")
        if s["payment"].payment_date > line.value_date:
            raise ValueError(f"Voucher {s['payment'].payment_number} is dated {s['payment'].payment_date:%d-%b-%Y}, after the line's "
                             f"value date {line.value_date:%d-%b-%Y} — the bank can't have cleared it yet.")
        payments.append(s["payment"])
    total = round(sum(float(p.amount) for p in payments), 2)
    if abs(total - line.amount) >= 0.005:
        raise ValueError(f"The picked voucher(s) add up to {total:,.2f} but the statement line is {line.amount:,.2f}. "
                         f"Pick vouchers that add up exactly, or book the difference (e.g. bank charges) as its own voucher first.")
    _clear(db, recon, line, payments, "manual", user_id)
    return line


def _unreconcile(db: Session, recon: BankReconciliation, payment_id: int, side: str) -> None:
    p = db.query(PaymentTransaction).filter(PaymentTransaction.id == payment_id).first()
    if p is None:
        return
    if side == "counter" and p.counter_bank_reconciliation_id == recon.id:
        p.counter_reconciliation_status, p.counter_bank_reconciliation_id, p.counter_cleared_date = "pending", None, None
    elif side == "main" and p.bank_reconciliation_id == recon.id:
        p.reconciliation_status, p.bank_reconciliation_id, p.cleared_date = "pending", None, None


def unmatch_line(db: Session, *, line_id: int) -> BankStatementLine:
    """Undo a match. A booked line's voucher stays posted (it is real money
    the bank moved) but is uncleared again — cancel it under Finance >
    Payments if it was booked by mistake."""
    line = _line(db, line_id)
    recon = _recon(db, line.bank_reconciliation_id, for_update=True)
    if line.match_status == "unmatched":
        raise ValueError(f"Statement line {line.line_number} isn't matched.")
    for m in line.matched_payments or []:
        _unreconcile(db, recon, m.get("payment_id"), m.get("side") or "main")
    line.match_status, line.match_method, line.matched_payments = "unmatched", None, None
    line.matched_by_id, line.matched_at, line.booked_payment_id = None, None, None
    db.flush()
    return line


def book_line(db: Session, *, line_id: int, kind: str, gl_account_id: int | None, cost_center_id: int | None,
              narration: str | None, user_id: int | None) -> PaymentTransaction:
    """Posts the voucher the statement line implies (Dr expense / Cr bank for
    a debit line, Dr bank / Cr income for a credit line) and clears it.
    Posted straight away, no approval: the bank has already moved the money,
    the voucher only records it."""
    from app.modules.accounts.services.ledgers import ledger_id_for
    from app.modules.accounts.services.vouchers import create_voucher

    line = _line(db, line_id)
    recon = _recon(db, line.bank_reconciliation_id, for_update=True)
    if line.match_status != "unmatched":
        raise ValueError(f"Statement line {line.line_number} is already {line.match_status}.")
    if kind not in BOOK_KINDS:
        raise ValueError(f"Unknown booking type '{kind}' — use one of: {', '.join(BOOK_KINDS)}.")
    role = BOOK_KINDS[kind][1][0 if line.direction == "out" else 1]
    gl_id = gl_account_id or (ledger_id_for(db, role) if role else None)
    if not gl_id:
        what = "interest paid" if kind == "interest" else "this line"
        raise ValueError(f"Pick the ledger to book {what} to.")
    text = (narration or "").strip() or f"{BOOK_KINDS[kind][0].split(' (')[0]} per bank statement: {(line.description or '').strip()[:150]}".strip()
    voucher = create_voucher(
        db, payment_type="expense" if line.direction == "out" else "other_receipt", bank_account_id=recon.bank_account_id,
        amount=line.amount, payment_mode="neft", payment_date=line.value_date, created_by_id=user_id,
        lines=[{"gl_account_id": gl_id, "cost_center_id": cost_center_id, "amount": line.amount, "remarks": text[:300]}],
        reference_no=line.reference or line.cheque_number, narration=text,
    )
    _clear(db, recon, line, [voucher], "booked", user_id)
    line.booked_payment_id = voucher.id
    db.flush()
    return voucher


def open_line_count(db: Session, bank_reconciliation_id: int) -> int:
    return db.query(BankStatementLine).filter(BankStatementLine.bank_reconciliation_id == bank_reconciliation_id,
                                              BankStatementLine.match_status == "unmatched").count()
