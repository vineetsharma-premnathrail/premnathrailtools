"""Collections & dunning (SAP F150 dunning run + FSCM Collections Management).

Worklist
    One row per customer with undisputed overdue sales invoices, ranked by a
    priority score: overdue rupees weighted by age (1–30 d ×1, 31–60 ×2,
    61–90 ×3, >90 ×4) plus a weight for broken promises. Shows the last
    contact, the open promise to pay, the next follow-up and the highest
    reminder level reached. Disputed amounts are left out everywhere here.

Dunning run
    For every overdue invoice, the level it should be at is the highest
    Finance › Settings level (default 7 / 30 / 60 days overdue) it has passed.
    An invoice whose level would go up is proposed; the run issues one
    reminder letter per customer (level = highest level on the letter),
    raises each invoice's ARTransaction.dunning_level, and logs a
    'reminder_sent' collection note. Letters are managed Word documents.

Promises to pay
    A promise (date + amount) is 'open' until its date passes; then it is
    'kept' if receipts / settlements on the invoice (or, without an invoice,
    receipts from the customer) between the promise and the promised date
    reach the amount, else 'broken'. Checked lazily on every read and by the
    daily job, which also reminds collectors of today's follow-ups (Teams —
    reminders are allowed there).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.collections import (
    AccountsCollectionNote, AccountsDunningLetter, COLLECTION_NOTE_TYPES,
)
from app.modules.accounts.models.payment_transaction import PaymentAllocation, PaymentTransaction

AGE_WEIGHTS = ((30, 1), (60, 2), (90, 3))


def _weight(days: int) -> int:
    for limit, w in AGE_WEIGHTS:
        if days <= limit:
            return w
    return 4


def level_thresholds(db: Session) -> list[int]:
    from app.modules.accounts.settings import get_setting
    t = [int(get_setting(db, f"dunning_level{n}_days") or d) for n, d in ((1, 7), (2, 30), (3, 60))]
    # Keep them increasing even if Settings were entered out of order.
    for i in range(1, 3):
        t[i] = max(t[i], t[i - 1] + 1)
    return t


def level_for(days_overdue: int, thresholds: list[int]) -> int:
    lvl = 0
    for i, t in enumerate(thresholds, start=1):
        if days_overdue >= t:
            lvl = i
    return lvl


def overdue_items(db: Session, *, as_of: date | None = None, customer_id: int | None = None) -> list[dict]:
    """Overdue posted sales invoices with their undisputed amount (> 0 only)."""
    from app.modules.accounts.services.disputes import disputed_by_invoice
    today = as_of or date.today()
    q = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0.005,
                                       ARTransaction.due_date < today)
    if customer_id:
        q = q.filter(ARTransaction.customer_id == customer_id)
    invs = q.all()
    disputed = disputed_by_invoice(db, [i.id for i in invs])
    out = []
    for i in invs:
        d = min(disputed.get(i.id, 0.0), float(i.amount_due or 0))
        undisputed = round(float(i.amount_due or 0) - d, 2)
        if undisputed <= 0.005:
            continue
        out.append({"ar_transaction_id": i.id, "customer_id": i.customer_id, "invoice_number": i.invoice_number,
                    "invoice_date": i.invoice_date, "due_date": i.due_date, "days_overdue": (today - i.due_date).days,
                    "total": float(i.total_amount or 0), "amount_due": float(i.amount_due or 0), "disputed": round(d, 2),
                    "undisputed_due": undisputed, "dunning_level": int(i.dunning_level or 0)})
    out.sort(key=lambda r: (r["due_date"], r["invoice_number"]))
    return out


# ── Promises ─────────────────────────────────────────────────────────────

def _received_between(db: Session, note: AccountsCollectionNote, until: date) -> float:
    if note.ar_transaction_id:
        rows = db.query(PaymentAllocation.amount).filter(PaymentAllocation.target_type == "ar_transaction",
                                                         PaymentAllocation.target_id == note.ar_transaction_id,
                                                         PaymentAllocation.allocation_date >= note.note_date,
                                                         PaymentAllocation.allocation_date <= until).all()
    else:
        rows = db.query(PaymentTransaction.amount).filter(PaymentTransaction.payment_type == "customer",
                                                          PaymentTransaction.customer_id == note.customer_id,
                                                          PaymentTransaction.status == "posted",
                                                          PaymentTransaction.payment_date >= note.note_date,
                                                          PaymentTransaction.payment_date <= until).all()
    return round(sum(float(a or 0) for (a,) in rows), 2)


def refresh_promises(db: Session, *, customer_id: int | None = None, today: date | None = None) -> list[AccountsCollectionNote]:
    """Settle open promises whose date has passed. Returns the newly broken ones."""
    today = today or date.today()
    q = db.query(AccountsCollectionNote).filter(AccountsCollectionNote.note_type == "promise_to_pay",
                                                AccountsCollectionNote.promise_status == "open")
    if customer_id:
        q = q.filter(AccountsCollectionNote.customer_id == customer_id)
    broken = []
    for n in q.all():
        received = _received_between(db, n, min(n.promised_date, today))
        n.promise_received = received
        if received + 0.005 >= float(n.promised_amount or 0):
            n.promise_status = "kept"
        elif n.promised_date < today:
            n.promise_status = "broken"
            broken.append(n)
    db.flush()
    return broken


# ── Notes ────────────────────────────────────────────────────────────────

def add_note(db: Session, *, customer_id: int, note_type: str, remarks: str, created_by_id: int | None,
             note_date: date | None = None, ar_transaction_id: int | None = None, contact_person: str | None = None,
             promised_date: date | None = None, promised_amount: float | None = None,
             follow_up_date: date | None = None) -> AccountsCollectionNote:
    from app.modules.crm.models.organization import Organization

    if note_type not in COLLECTION_NOTE_TYPES or note_type == "reminder_sent":
        raise ValueError("Note type must be one of: " + ", ".join(k for k in COLLECTION_NOTE_TYPES if k != "reminder_sent")
                         + " (reminder letters are logged by the dunning run).")
    if not db.query(Organization.id).filter(Organization.id == customer_id).first():
        raise ValueError(f"Customer #{customer_id} not found — pick the customer again.")
    if not (remarks or "").strip():
        raise ValueError("Write what was discussed (who you spoke to and what they said).")
    note_date = note_date or date.today()
    if note_date > date.today():
        raise ValueError("The contact date can't be in the future.")
    if ar_transaction_id:
        inv = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
        if not inv or inv.customer_id != customer_id:
            raise ValueError("That invoice isn't this customer's — pick one of the customer's open invoices.")
    status = None
    if note_type == "promise_to_pay":
        if not promised_date or not promised_amount or float(promised_amount) <= 0:
            raise ValueError("A promise to pay needs the promised date and the amount promised.")
        if promised_date < note_date:
            raise ValueError("The promised date can't be before the date of the promise.")
        status = "open"
        follow_up_date = follow_up_date or promised_date
    elif promised_date or promised_amount:
        raise ValueError("A promised date / amount belongs on a 'Promise to pay' note — change the note type.")
    if follow_up_date and follow_up_date < note_date:
        raise ValueError("The follow-up date can't be before the contact date.")
    n = AccountsCollectionNote(customer_id=customer_id, ar_transaction_id=ar_transaction_id, note_type=note_type,
                               note_date=note_date, contact_person=(contact_person or "").strip() or None,
                               remarks=remarks.strip(), promised_date=promised_date,
                               promised_amount=round(float(promised_amount), 2) if promised_amount else None,
                               promise_status=status, follow_up_date=follow_up_date, created_by_id=created_by_id)
    db.add(n)
    db.flush()
    return n


def cancel_promise(db: Session, note: AccountsCollectionNote) -> AccountsCollectionNote:
    if note.note_type != "promise_to_pay" or note.promise_status != "open":
        raise ValueError("Only an open promise to pay can be cancelled.")
    note.promise_status = "cancelled"
    db.flush()
    return note


# ── Worklist ─────────────────────────────────────────────────────────────

def worklist(db: Session, *, as_of: date | None = None) -> list[dict]:
    from app.modules.accounts.services.outstanding import _parties

    today = as_of or date.today()
    refresh_promises(db, today=today)
    items = overdue_items(db, as_of=today)
    by_cust: dict[int, dict] = {}
    for it in items:
        c = by_cust.setdefault(it["customer_id"], {"customer_id": it["customer_id"], "overdue_amount": 0.0, "invoices": 0,
                                                    "max_days_overdue": 0, "max_dunning_level": 0, "score": 0.0})
        c["overdue_amount"] = round(c["overdue_amount"] + it["undisputed_due"], 2)
        c["invoices"] += 1
        c["max_days_overdue"] = max(c["max_days_overdue"], it["days_overdue"])
        c["max_dunning_level"] = max(c["max_dunning_level"], it["dunning_level"])
        c["score"] += it["undisputed_due"] * _weight(it["days_overdue"])
    if not by_cust:
        return []
    ids = list(by_cust)
    from app.modules.accounts.services.disputes import disputed_by_invoice
    disputed_total: dict[int, float] = {}
    open_invs = db.query(ARTransaction.id, ARTransaction.customer_id).filter(ARTransaction.customer_id.in_(ids),
                                                                            ARTransaction.status == "posted",
                                                                            ARTransaction.amount_due > 0.005).all()
    dmap = disputed_by_invoice(db, [i for i, _ in open_invs])
    for inv_id, cid in open_invs:
        disputed_total[cid] = round(disputed_total.get(cid, 0.0) + dmap.get(inv_id, 0.0), 2)
    notes = db.query(AccountsCollectionNote).filter(AccountsCollectionNote.customer_id.in_(ids)) \
        .order_by(AccountsCollectionNote.note_date.desc(), AccountsCollectionNote.id.desc()).all()
    parties = _parties(db, "customer", set(ids))
    rows = []
    for cid, c in by_cust.items():
        mine = [n for n in notes if n.customer_id == cid]
        last = mine[0] if mine else None
        promise = next((n for n in mine if n.note_type == "promise_to_pay" and n.promise_status == "open"), None)
        broken = sum(1 for n in mine if n.promise_status == "broken")
        follow = sorted(n.follow_up_date for n in mine if n.follow_up_date and n.follow_up_date >= today)
        score = c["score"] * (1 + 0.5 * broken)
        priority = "high" if (c["max_days_overdue"] > 90 or broken or c["overdue_amount"] >= 1_000_000) else \
            "medium" if c["max_days_overdue"] > 30 else "low"
        p = parties.get(cid)
        rows.append({**c, "customer_name": p.name if p else "—", "score": round(score, 2), "priority": priority,
                     "disputed": disputed_total.get(cid, 0.0), "broken_promises": broken,
                     "last_contact_date": last.note_date if last else None,
                     "last_contact_type": last.note_type if last else None,
                     "last_contact_remarks": last.remarks if last else None,
                     "open_promise_date": promise.promised_date if promise else None,
                     "open_promise_amount": promise.promised_amount if promise else None,
                     "next_follow_up": follow[0] if follow else None})
    rows.sort(key=lambda r: -r["score"])
    return rows


# ── Dunning ──────────────────────────────────────────────────────────────

def dunning_proposal(db: Session, *, as_of: date | None = None, customer_ids: list[int] | None = None) -> list[dict]:
    """Per customer, the invoices whose reminder level goes up today."""
    from app.modules.accounts.services.outstanding import _parties
    from app.modules.accounts.settings import get_setting

    today = as_of or date.today()
    th = level_thresholds(db)
    min_amount = float(get_setting(db, "dunning_min_amount") or 0)
    by_cust: dict[int, list[dict]] = {}
    for it in overdue_items(db, as_of=today):
        if customer_ids and it["customer_id"] not in customer_ids:
            continue
        lvl = level_for(it["days_overdue"], th)
        by_cust.setdefault(it["customer_id"], []).append({**it, "level": max(lvl, it["dunning_level"]),
                                                          "previous_level": it["dunning_level"], "raise": lvl > it["dunning_level"]})
    parties = _parties(db, "customer", set(by_cust))
    out = []
    for cid, its in by_cust.items():
        if not any(i["raise"] for i in its):
            continue
        total = round(sum(i["undisputed_due"] for i in its), 2)
        if total + 0.005 < min_amount:
            continue
        p = parties.get(cid)
        out.append({"customer_id": cid, "customer_name": p.name if p else "—", "level": max(i["level"] for i in its),
                    "total_overdue": total, "items": its})
    out.sort(key=lambda r: (-r["level"], -r["total_overdue"]))
    return out


def _letter_number(db: Session, on: date) -> str:
    prefix = f"DUN-{on.year}-"
    last = db.query(AccountsDunningLetter.letter_number).filter(AccountsDunningLetter.letter_number.like(f"{prefix}%")) \
        .order_by(AccountsDunningLetter.letter_number.desc()).first()
    seq = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def run_dunning(db: Session, *, user_id: int | None, as_of: date | None = None,
                customer_ids: list[int] | None = None) -> list[AccountsDunningLetter]:
    today = as_of or date.today()
    letters = []
    for prop in dunning_proposal(db, as_of=today, customer_ids=customer_ids):
        items = [{"ar_transaction_id": i["ar_transaction_id"], "invoice_number": i["invoice_number"],
                  "invoice_date": i["invoice_date"].isoformat(), "due_date": i["due_date"].isoformat(),
                  "days_overdue": i["days_overdue"], "amount_due": i["amount_due"], "disputed": i["disputed"],
                  "undisputed_due": i["undisputed_due"], "level": i["level"], "previous_level": i["previous_level"]}
                 for i in prop["items"]]
        letter = AccountsDunningLetter(letter_number=_letter_number(db, today), customer_id=prop["customer_id"],
                                       letter_date=date.today(), as_of=today, dunning_level=prop["level"],
                                       total_overdue=prop["total_overdue"], items=items, status="issued",
                                       created_by_id=user_id)
        db.add(letter)
        db.flush()
        for i in prop["items"]:
            if i["raise"]:
                inv = db.get(ARTransaction, i["ar_transaction_id"])
                inv.dunning_level = i["level"]
        db.add(AccountsCollectionNote(customer_id=prop["customer_id"], note_type="reminder_sent", note_date=date.today(),
                                      remarks=f"Reminder letter {letter.letter_number} (level {prop['level']}) for "
                                              f"₹{prop['total_overdue']:,.2f} overdue on {len(items)} invoice(s).",
                                      dunning_letter_id=letter.id, created_by_id=user_id))
        letters.append(letter)
    db.flush()
    return letters


def cancel_letter(db: Session, letter: AccountsDunningLetter, reason: str) -> AccountsDunningLetter:
    """Withdraw a letter that was not sent: each invoice goes back to the
    level it had before this letter (unless a later letter raised it again)."""
    if letter.status != "issued":
        raise ValueError(f"Letter {letter.letter_number} is already cancelled.")
    if not (reason or "").strip():
        raise ValueError("Give a reason for cancelling the reminder letter.")
    for it in letter.items or []:
        inv = db.get(ARTransaction, it["ar_transaction_id"])
        if inv is not None and int(inv.dunning_level or 0) == int(it["level"]):
            inv.dunning_level = int(it.get("previous_level") or 0)
    letter.status = "cancelled"
    letter.cancelled_reason = reason.strip()
    db.flush()
    return letter


LEVEL_TITLES = {1: "PAYMENT REMINDER", 2: "SECOND REMINDER", 3: "FINAL NOTICE"}


def letter_spec(db: Session, letter: AccountsDunningLetter) -> dict:
    """The reminder letter as a spec for the letterhead renderer
    (quality/reports/render.py: render_docx / render_pdf)."""
    from app.modules.crm.models.organization import Organization
    from app.modules.organization.models.company import Company

    org = db.query(Organization).filter(Organization.id == letter.customer_id).first()
    company = db.query(Company).first()
    lvl = int(letter.dunning_level or 1)
    addr = ", ".join(p for p in (getattr(org, "address", None), getattr(org, "city", None), getattr(org, "state", None),
                                 getattr(org, "pin_code", None)) if p) if org else ""
    rows = [[it["invoice_number"], _dmy(it["invoice_date"]), _dmy(it["due_date"]), str(it["days_overdue"]),
             f"{float(it['undisputed_due']):,.2f}"] for it in letter.items or []]
    rows.append(["Total overdue", "", "", "", f"{float(letter.total_overdue or 0):,.2f}"])
    intro = {
        1: "This is a friendly reminder that the invoices listed below are past their due date. If you have already "
           "arranged payment, please accept our thanks and ignore this letter.",
        2: "Despite our earlier reminder, the invoices listed below remain unpaid. We request you to release the "
           "payment at the earliest and share the payment details (UTR) with us.",
        3: "This is our final notice. The invoices listed below are seriously overdue. Unless payment is received "
           "within 7 days of this letter, we may have to hold further supplies, dispatches and services under the "
           "contract until the account is regularised.",
    }[min(max(lvl, 1), 3)]
    disputed = sum(float(it.get("disputed") or 0) for it in letter.items or [])
    remarks = (f"Amounts under dispute (₹{disputed:,.2f}) are not included above and are being resolved separately."
               if disputed > 0.005 else None)
    return {
        "title": LEVEL_TITLES.get(lvl, "PAYMENT REMINDER"), "number": letter.letter_number,
        "intro": f"To,\n{org.name if org else ''}\n{addr}\n\nDear Sir / Madam,\n\n{intro}",
        "facts": [("Date", _dmy(letter.letter_date.isoformat())), ("Outstanding as of", _dmy(letter.as_of.isoformat())),
                  ("Customer", org.name if org else "—"), ("GSTIN", getattr(org, "gst_number", None) or "—"),
                  ("Reminder level", str(lvl)), ("Amount overdue (₹)", f"{float(letter.total_overdue or 0):,.2f}")],
        "sections": [{"heading": "Overdue invoices", "columns": ["Invoice no.", "Invoice date", "Due date", "Days overdue", "Amount due (₹)"],
                      "rows": rows, "widths": [1.7, 1.15, 1.15, 1.0, 1.5]}],
        "statement": "Kindly remit the amount to our bank account mentioned on the invoices and send the payment advice "
                     "to our accounts department. Please ignore this letter if payment has already been made.",
        "remarks": remarks,
        "signatures": [(f"For {company.name if company else 'Premnath Rail Tools'}", "Authorised signatory (Accounts)")],
    }


def _dmy(iso: str | None) -> str:
    if not iso:
        return "—"
    y, m, d = str(iso)[:10].split("-")
    return f"{d}-{m}-{y}"


# ── Daily reminders ──────────────────────────────────────────────────────

def send_collection_reminders(db: Session, today: date | None = None) -> int:
    """Daily job: settle promises; remind the collector (bell + Teams — a
    reminder) of broken promises and of today's follow-ups."""
    from app.utils.notifications import notify_user
    from app.modules.accounts.services.outstanding import _parties

    today = today or date.today()
    sent = 0
    broken = refresh_promises(db, today=today)
    names = _parties(db, "customer", {n.customer_id for n in broken})
    for n in broken:
        if n.created_by_id:
            c = names.get(n.customer_id)
            notify_user(db, n.created_by_id, f"Promise to pay broken — {c.name if c else 'customer'}",
                        f"₹{float(n.promised_amount or 0):,.2f} was promised by {n.promised_date:%d-%m-%Y}; "
                        f"₹{float(n.promise_received or 0):,.2f} received. Follow up in Finance › Outstanding › Collections.",
                        "collections_promise_broken", "accounts_collection_note", n.id, teams=True)
            sent += 1
        # Role event (core/events/accounts_b.py); the collector was told above. No email from a job.
        from app.modules.accounts import role_events_b
        c = names.get(n.customer_id)
        role_events_b.fire(
            db, "promise_broken", title=f"Promise to pay broken — {c.name if c else 'customer'}",
            message=(f"₹{float(n.promised_amount or 0):,.2f} was promised by {n.promised_date:%d-%m-%Y}; "
                     f"₹{float(n.promise_received or 0):,.2f} received. Follow up in Finance › Outstanding › Collections."),
            entity_type="accounts_collection_note", entity_id=n.id, skip={n.created_by_id})
    due = db.query(AccountsCollectionNote).filter(AccountsCollectionNote.follow_up_date == today,
                                                  AccountsCollectionNote.follow_up_reminded_on.is_(None)).all()
    names = _parties(db, "customer", {n.customer_id for n in due})
    for n in due:
        n.follow_up_reminded_on = today
        if n.created_by_id:
            c = names.get(n.customer_id)
            notify_user(db, n.created_by_id, f"Collection follow-up today — {c.name if c else 'customer'}",
                        f"Your note of {n.note_date:%d-%m-%Y}: {n.remarks[:160]}", "collections_follow_up",
                        "accounts_collection_note", n.id, teams=True)
            sent += 1
    db.commit()
    return sent


def run_collection_reminders_job() -> None:
    """APScheduler entry point (main.py)."""
    import logging
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        send_collection_reminders(db)
    except Exception:  # noqa: BLE001
        logging.getLogger("accounts").exception("Collection reminders failed")
        db.rollback()
    finally:
        db.close()
