"""Payment, receipt and contra vouchers, and bill-wise allocation.

    vendor        Dr Sundry Creditors (vendor)        Cr Bank/Cash
    customer      Dr Bank/Cash                        Cr Sundry Debtors (customer)
    expense       Dr expense ledgers                  Cr Bank/Cash
    other_receipt Dr Bank/Cash                        Cr income/other ledgers
    contra        Dr receiving bank/cash              Cr paying bank/cash

A party voucher may settle several invoices at once (allocations); whatever
isn't allocated stays on the party as an advance and can be allocated later.
Vouchers are never edited — a wrong one is cancelled, which reverses its
journal and releases its allocations."""
from datetime import date
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_transaction import (
    PaymentTransaction, PaymentLine, PaymentAllocation, PAYMENT_TYPES, PAYMENT_MODES,
)
from app.modules.accounts.models.journal_entry import (
    VOUCHER_TYPES, JournalEntry, JournalEntryLine, JE_MANUAL_POSTING_TYPES,
)
from app.modules.accounts.models.settlement_adjustment import SettlementAdjustment, ADJUSTMENT_REASONS
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.balances import account_balance
from app.modules.accounts.services.ledgers import ledger_id_for

_VOUCHER_FOR_TYPE = {"vendor": "payment", "expense": "payment", "employee": "payment",
                     "customer": "receipt", "other_receipt": "receipt", "contra": "contra"}
_POSTING_FOR_TYPE = {"vendor": "payment", "expense": "payment", "employee": "payment",
                     "customer": "receipt", "other_receipt": "receipt", "contra": "contra"}


def _bank(db: Session, bank_account_id: int | None, role: str) -> BankAccount:
    if not bank_account_id:
        raise ValueError(f"Pick the {role} bank/cash account.")
    ba = db.query(BankAccount).filter(BankAccount.id == bank_account_id).first()
    if not ba:
        raise ValueError(f"The {role} bank/cash account was not found.")
    if ba.status != "active":
        raise ValueError(f"'{ba.bank_name}' is {ba.status} — only an active bank/cash account can be used.")
    if not ba.gl_account_id:
        raise ValueError(f"'{ba.bank_name}' has no GL ledger linked — set one under Finance > Masters > Bank & Cash Accounts first.")
    return ba


def _label(ba: BankAccount) -> str:
    return f"{ba.bank_name} — {ba.account_no}" if ba.account_no else ba.bank_name


def _check_cash_available(db: Session, ba: BankAccount, amount: float, on: date) -> None:
    """Cash can't go below zero — a negative cash book means a receipt is
    missing or a payment is wrong. Banks may run an overdraft, so they aren't checked."""
    if ba.account_kind != "cash":
        return
    available = account_balance(db, ba.gl_account_id, on)
    if amount > available + 1e-9:
        raise ValueError(
            f"'{ba.bank_name}' has only {available:,.2f} on {on:%d-%b-%Y}; paying {amount:,.2f} would make cash negative. "
            f"Record the cash withdrawal/receipt first (a contra or receipt voucher)."
        )


def _validate_split_lines(db: Session, lines: list[dict] | None, amount: float, purpose: str) -> list[dict]:
    if not lines:
        raise ValueError(f"Add at least one {purpose} ledger line.")
    out = []
    for i, l in enumerate(lines, start=1):
        amt = round(float(l.get("amount") or 0), 2)
        if amt <= 0:
            raise ValueError(f"Line {i}: amount must be greater than zero.")
        gl = db.query(GLAccount).filter(GLAccount.id == l.get("gl_account_id")).first()
        if not gl:
            raise ValueError(f"Line {i}: pick a ledger.")
        if gl.status != "active" or not gl.is_posting_account:
            raise ValueError(f"Line {i}: '{gl.code} — {gl.name}' is inactive or a group account.")
        if gl.is_control_account:
            raise ValueError(f"Line {i}: '{gl.code} — {gl.name}' is a party control account — use a vendor payment or customer receipt for party money.")
        if db.query(BankAccount).filter(BankAccount.gl_account_id == gl.id).first():
            raise ValueError(f"Line {i}: '{gl.code} — {gl.name}' is a bank/cash ledger — use a contra voucher to move money between accounts.")
        out.append({**l, "amount": amt})
    total = round(sum(l["amount"] for l in out), 2)
    if total != round(amount, 2):
        raise ValueError(f"The {purpose} lines add up to {total:,.2f} but the voucher amount is {amount:,.2f} — they must match.")
    return out


# Deduction reason -> ledger role, per side. None = the user must pick the
# ledger (gl_account_id) on the line.
_DEDUCTION_ROLE = {
    "customer": {"ld_deduction": "ld_recovered_by_customer", "penalty": "penalty_by_customer", "bank_charges": "bank_charges",
                 "short_payment": "write_off_small_differences", "rounding": "round_off", "cash_discount": "discount_allowed",
                 "other": None},
    "vendor": {"ld_deduction": "ld_recovered_from_vendor", "penalty": "ld_recovered_from_vendor", "bank_charges": "bank_charges",
               "short_payment": "write_off_small_differences", "rounding": "round_off", "cash_discount": "discount_received",
               "other": None},
}
# Reasons that are really a change in the supply's value — GST must move too,
# so they go through a credit/debit note, never a receipt deduction.
_NOTE_ONLY_REASONS = {"rate_difference", "price_difference", "sales_return", "purchase_return", "quantity_difference"}


def _deduction_ledger(db: Session, side: str, reason: str, gl_account_id: int | None, n: int) -> int:
    if reason in _NOTE_ONLY_REASONS:
        raise ValueError(
            f"Deduction {n}: a {reason.replace('_', ' ')} changes the taxable value, so GST must be reversed too — raise a "
            f"{'credit' if side == 'customer' else 'debit'} note against the invoice (Finance > "
            f"{'Sales' if side == 'customer' else 'Purchase'} > Notes) instead of a deduction on the voucher."
        )
    if reason not in ADJUSTMENT_REASONS:
        raise ValueError(f"Deduction {n}: unknown reason '{reason}' — use one of: {', '.join(ADJUSTMENT_REASONS)}.")
    if gl_account_id:
        gl = db.query(GLAccount).filter(GLAccount.id == gl_account_id).first()
        if not gl:
            raise ValueError(f"Deduction {n}: the ledger picked was not found — pick it again.")
        if gl.status != "active" or not gl.is_posting_account:
            raise ValueError(f"Deduction {n}: '{gl.code} — {gl.name}' is inactive or a group account — pick a posting ledger.")
        if gl.is_control_account:
            raise ValueError(f"Deduction {n}: '{gl.code} — {gl.name}' is a party control ledger — a deduction goes to an income/expense ledger.")
        if db.query(BankAccount).filter(BankAccount.gl_account_id == gl.id).first():
            raise ValueError(f"Deduction {n}: '{gl.code} — {gl.name}' is a bank/cash ledger — money that reached the bank is the voucher amount, not a deduction.")
        return gl.id
    role = _DEDUCTION_ROLE[side].get(reason)
    if role is None:
        raise ValueError(f"Deduction {n}: for '{ADJUSTMENT_REASONS[reason]}' pick the ledger the difference goes to.")
    return ledger_id_for(db, role)


def _validate_deductions(db: Session, side: str, party_id: int, deductions: list[dict] | None,
                         allocations: list[dict] | None) -> list[dict]:
    """Each deduction settles part of one of this party's posted invoices;
    cash + deductions per invoice may not exceed what is due on it."""
    out = []
    want_type = "ar_transaction" if side == "customer" else "vendor_invoice"
    for n, d in enumerate(deductions or [], start=1):
        amt = round(float(d.get("amount") or 0), 2)
        if amt <= 0:
            raise ValueError(f"Deduction {n}: amount must be greater than zero.")
        if not d.get("target_id"):
            raise ValueError(f"Deduction {n}: pick the invoice the deduction was made against — a deduction always belongs to a bill.")
        ttype = d.get("target_type") or want_type
        if ttype != want_type:
            raise ValueError(f"Deduction {n}: a {'receipt' if side == 'customer' else 'payment'} can only deduct against "
                             f"{'sales' if side == 'customer' else 'purchase'} invoices.")
        target = _target(db, ttype, d["target_id"])
        if (target.customer_id if side == "customer" else target.vendor_id) != party_id:
            raise ValueError(f"Deduction {n}: invoice '{target.invoice_number}' belongs to another party.")
        if target.status != "posted":
            raise ValueError(f"Deduction {n}: invoice '{target.invoice_number}' isn't posted — only a posted bill can be settled.")
        gl_id = _deduction_ledger(db, side, d.get("reason") or "", d.get("gl_account_id"), n)
        out.append({"target_type": ttype, "target_id": target.id, "reason": d["reason"], "gl_account_id": gl_id,
                    "cost_center_id": d.get("cost_center_id"), "amount": amt, "remarks": d.get("remarks"),
                    "_number": target.invoice_number, "_due": target.amount_due})
    per_target: dict[tuple, float] = {}
    for a in allocations or []:
        k = (a["target_type"], a["target_id"])
        per_target[k] = per_target.get(k, 0) + round(float(a.get("amount") or 0), 2)
    for d in out:
        k = (d["target_type"], d["target_id"])
        per_target[k] = per_target.get(k, 0) + d["amount"]
    for d in out:
        total = round(per_target[(d["target_type"], d["target_id"])], 2)
        if total > d["_due"] + 1e-9:
            raise ValueError(f"Invoice '{d['_number']}' has {d['_due']:,.2f} due, but cash settled plus deductions come to "
                             f"{total:,.2f} — reduce the deduction or the settled amount.")
    return out


def _resolve_advance_link(db: Session, side: str, party, *, sales_order_id: int | None, billing_line_id: int | None,
                          purchase_order_id: int | None, advance_reason: str | None) -> None:
    if side == "customer":
        if purchase_order_id:
            raise ValueError("A customer advance is linked to a sales order, not a purchase order.")
        if sales_order_id:
            from app.modules.sales.models.order import SalesOrder
            so = db.query(SalesOrder).filter(SalesOrder.id == sales_order_id).first()
            if not so:
                raise ValueError("The sales order picked for this advance was not found — pick it again.")
            if so.customer_id != party.id:
                raise ValueError(f"Sales order {so.so_number or so.id} is for another customer — pick one of {party.name}'s orders.")
            if so.status in ("cancelled", "rejected"):
                raise ValueError(f"Sales order {so.so_number or so.id} is {so.status} — an advance can't be taken against it.")
        if billing_line_id and not sales_order_id:
            raise ValueError("Pick the sales order the advance milestone belongs to.")
    else:
        if sales_order_id or billing_line_id:
            raise ValueError("A supplier advance is linked to a purchase order, not a sales order.")
        if purchase_order_id:
            from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
            po = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == purchase_order_id).first()
            if not po:
                raise ValueError("The purchase order picked for this advance was not found — pick it again.")
            if po.vendor_id and po.vendor_id != party.id:
                raise ValueError(f"PO {po.po_number} is with another vendor — pick one of {party.name}'s purchase orders.")
            if po.status in ("cancelled", "rejected", "draft"):
                raise ValueError(f"PO {po.po_number} is {po.status} — an advance can only be paid against an approved PO.")
    if not (sales_order_id or purchase_order_id) and not (advance_reason or "").strip():
        raise ValueError(f"Link the advance to the {'sales order' if side == 'customer' else 'purchase order'} it is for, "
                         f"or give the reason it is 'on account' (e.g. 'tender EMD', 'against verbal order').")


def create_voucher(
    db: Session, *, payment_type: str, bank_account_id: int, amount: float, payment_mode: str, payment_date: date,
    created_by_id: int | None, vendor_id: int | None = None, customer_id: int | None = None,
    counter_bank_account_id: int | None = None, lines: list[dict] | None = None, allocations: list[dict] | None = None,
    cheque_number: str | None = None, cheque_date: date | None = None, reference_no: str | None = None,
    narration: str | None = None, deductions: list[dict] | None = None, is_advance: bool = False,
    sales_order_id: int | None = None, billing_line_id: int | None = None, purchase_order_id: int | None = None,
    advance_reason: str | None = None, hold_for_approval: bool = False, payment_proposal_id: int | None = None,
    currency: str | None = None, exchange_rate: float | None = None, amount_fc: float | None = None,
) -> PaymentTransaction:
    """Records a voucher. Posted at once, or — hold_for_approval — kept as
    'pending_approval' (validated, no journal / number / allocations) until
    post_held_voucher() runs on final approval.

    deductions (party vouchers): [{target_type, target_id, reason, amount,
    gl_account_id?, cost_center_id?, remarks?}] — the part of a bill settled
    without cash (F-28 payment difference). is_advance: a down payment held on
    the customer/supplier advance ledger, linked to an SO / PO."""
    from app.modules.accounts.service import _draft_number

    if payment_type not in PAYMENT_TYPES or payment_type == "employee":
        raise ValueError(f"Unknown voucher type '{payment_type}'.")
    if payment_mode not in PAYMENT_MODES:
        raise ValueError(f"Unknown payment mode '{payment_mode}' — use one of: {', '.join(PAYMENT_MODES)}.")
    amount = round(float(amount or 0), 2)
    # Foreign-currency voucher: INR amount = amount_fc x the day's rate.
    from app.modules.accounts.services import fx as _fx
    fx_cur, fx_rate, fx_amount, amount = _fx.voucher_currency(db, payment_type=payment_type, currency=currency,
                                                               exchange_rate=exchange_rate, amount_fc=amount_fc,
                                                               amount=amount, on=payment_date)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero.")
    if payment_mode == "cheque" and not cheque_number:
        raise ValueError("Enter the cheque number for a cheque payment.")

    bank = _bank(db, bank_account_id, "paying" if payment_type in ("vendor", "expense", "contra") else "receiving")
    if bank.account_kind == "cash" and payment_mode != "cash":
        raise ValueError(f"'{bank.bank_name}' is a cash account — the mode must be 'cash'.")
    if payment_mode == "cash" and bank.account_kind != "cash":
        raise ValueError("Cash mode needs a cash account — pick the cash box the money moves through (bank deposits/withdrawals are contra vouchers).")

    party = None
    clean_deductions: list[dict] = []
    allocations = [dict(a) for a in (allocations or [])]
    if payment_type in ("vendor", "customer"):
        if payment_type == "vendor":
            party = db.query(Vendor).filter(Vendor.id == vendor_id).first() if vendor_id else None
            if not party:
                raise ValueError("Pick the vendor being paid.")
            if party.status == "blocked":
                raise ValueError(f"Vendor '{party.name}' is blocked — payments to it are stopped. Unblock it under Finance > Masters > Vendors first.")
        else:
            from app.modules.crm.models.organization import Organization
            party = db.query(Organization).filter(Organization.id == customer_id).first() if customer_id else None
            if not party:
                raise ValueError("Pick the customer the money is received from.")
        if is_advance:
            if allocations or deductions:
                raise ValueError("An advance doesn't settle bills when it is received/paid — record it on its own, then "
                                 "adjust it against the invoice later (Allocate on the voucher).")
            _resolve_advance_link(db, payment_type, party, sales_order_id=sales_order_id, billing_line_id=billing_line_id,
                                  purchase_order_id=purchase_order_id, advance_reason=advance_reason)
        else:
            clean_deductions = _validate_deductions(db, payment_type, party.id, deductions, allocations)
            cash_alloc = round(sum(float(a.get("amount") or 0) for a in allocations), 2)
            if cash_alloc > amount + 1e-9:
                raise ValueError(f"The bills settled in cash add up to {cash_alloc:,.2f} but the voucher amount is only {amount:,.2f} — "
                                 f"reduce the settled amounts, or enter the shortfall as a deduction.")
            if payment_type == "vendor":
                for a in allocations:
                    inv = db.query(VendorInvoice).filter(VendorInvoice.id == a.get("target_id")).first() \
                        if a.get("target_type") == "vendor_invoice" else None
                    if inv is not None and inv.payment_block:
                        raise ValueError(f"Invoice '{inv.invoice_number}' is blocked for payment"
                                         f"{f' ({inv.payment_block_reason})' if inv.payment_block_reason else ''} — release the block "
                                         f"on the invoice (Finance > Purchase) before paying it.")
    else:
        if deductions or is_advance:
            raise ValueError("Deductions and advances apply only to vendor payments and customer receipts.")
        allocations = []
        if payment_type in ("expense", "other_receipt"):
            lines = _validate_split_lines(db, lines, amount, "expense" if payment_type == "expense" else "income/other")
        else:
            counter = _bank(db, counter_bank_account_id, "receiving")
            if counter.id == bank.id:
                raise ValueError("A contra moves money between two different accounts — pick a different receiving account.")

    if payment_type in ("vendor", "expense", "contra") and not hold_for_approval:
        _check_cash_available(db, bank, amount, payment_date)
    fiscal.assert_postable(db, payment_date)

    payment = PaymentTransaction(
        payment_number=_draft_number(), payment_type=payment_type, payment_mode=payment_mode, payment_date=payment_date,
        amount=amount, bank_account_id=bank.id,
        counter_bank_account_id=counter_bank_account_id if payment_type == "contra" else None,
        vendor_id=party.id if payment_type == "vendor" else None,
        customer_id=party.id if payment_type == "customer" else None,
        cheque_number=cheque_number, cheque_date=cheque_date, reference_no=reference_no, narration=narration,
        unallocated_amount=0, status="pending_approval", created_by_id=created_by_id,
        is_advance=bool(is_advance), sales_order_id=sales_order_id if is_advance else None,
        billing_line_id=billing_line_id if is_advance else None, purchase_order_id=purchase_order_id if is_advance else None,
        advance_reason=((advance_reason or "").strip() or None) if is_advance else None,
        pending_allocations=[{"target_type": a["target_type"], "target_id": a["target_id"], "amount": round(float(a["amount"]), 2)}
                             for a in allocations if float(a.get("amount") or 0) > 0],
        payment_proposal_id=payment_proposal_id,
        currency=fx_cur, exchange_rate=fx_rate, amount_fc=fx_amount,
    )
    db.add(payment)
    db.flush()
    if payment_type in ("expense", "other_receipt"):
        for i, l in enumerate(lines, start=1):
            db.add(PaymentLine(payment_transaction_id=payment.id, line_number=i, gl_account_id=l["gl_account_id"],
                               cost_center_id=l.get("cost_center_id"), internal_order_id=l.get("internal_order_id"),
                               amount=l["amount"], remarks=l.get("remarks")))
    for d in clean_deductions:
        db.add(SettlementAdjustment(
            payment_transaction_id=payment.id, target_type=d["target_type"], target_id=d["target_id"], reason=d["reason"],
            gl_account_id=d["gl_account_id"], cost_center_id=d.get("cost_center_id"), amount=d["amount"],
            adjustment_date=payment_date, remarks=d.get("remarks"), status="pending", created_by_id=created_by_id,
        ))
    db.flush()
    if not hold_for_approval:
        post_held_voucher(db, payment_id=payment.id, posted_by_id=created_by_id)
    return payment


def voucher_deductions(db: Session, payment_id: int) -> list[SettlementAdjustment]:
    return (db.query(SettlementAdjustment).filter(SettlementAdjustment.payment_transaction_id == payment_id)
            .order_by(SettlementAdjustment.id.asc()).all())


def deduction_total(db: Session, payment_id: int, *, exclude_reasons: tuple[str, ...] = ()) -> float:
    return round(sum(d.amount for d in voucher_deductions(db, payment_id) if d.reason not in exclude_reasons), 2)


def post_held_voucher(db: Session, *, payment_id: int, posted_by_id: int | None,
                      approved_by_id: int | None = None) -> PaymentTransaction:
    """Posts a recorded voucher: builds its journal from the stored row
    (party, deductions, ledger lines), gives it its PV/RV/CV number, then
    settles the bills it names. Re-checks everything that may have changed
    while it waited (bill still due, period open, cash available)."""
    from app.modules.accounts.service import post_journal_entry, lock_row

    p = lock_row(db, PaymentTransaction, payment_id)
    if not p:
        raise ValueError("Voucher not found.")
    if p.status != "pending_approval":
        raise ValueError(f"Voucher '{p.payment_number}' is already {p.status.replace('_', ' ')}.")
    bank = _bank(db, p.bank_account_id, "paying" if p.payment_type in ("vendor", "expense", "contra") else "receiving")
    amount = p.amount
    deds = [d for d in voucher_deductions(db, p.id) if d.status == "pending"]
    ded_total = round(sum(d.amount for d in deds), 2)

    if p.payment_type == "vendor":
        vendor = db.query(Vendor).filter(Vendor.id == p.vendor_id).first()
        if vendor.status == "blocked":
            raise ValueError(f"Vendor '{vendor.name}' was blocked after this payment was recorded — unblock it under Finance > Masters > Vendors, or reject the payment.")
        label = f"{'Advance to' if p.is_advance else 'Payment to'} {vendor.name}"
        if p.is_advance:
            journal = [{"gl_account_id": ledger_id_for(db, "supplier_advance"), "debit_amount": amount, "vendor_id": vendor.id, "remarks": label},
                       {"gl_account_id": bank.gl_account_id, "credit_amount": amount, "remarks": label}]
        else:
            ap = vendor.gl_reconciliation_account_id or ledger_id_for(db, "ap_control")
            journal = [{"gl_account_id": ap, "debit_amount": round(amount + ded_total, 2), "vendor_id": vendor.id, "remarks": label},
                       {"gl_account_id": bank.gl_account_id, "credit_amount": amount, "remarks": label}]
            journal += [{"gl_account_id": d.gl_account_id, "cost_center_id": d.cost_center_id, "credit_amount": d.amount,
                         "remarks": f"{ADJUSTMENT_REASONS.get(d.reason, d.reason)} — {vendor.name}" + (f": {d.remarks}" if d.remarks else "")}
                        for d in deds]
        description = label
    elif p.payment_type == "customer":
        from app.modules.crm.models.organization import Organization
        customer = db.query(Organization).filter(Organization.id == p.customer_id).first()
        label = f"{'Advance from' if p.is_advance else 'Receipt from'} {customer.name}"
        if p.is_advance:
            journal = [{"gl_account_id": bank.gl_account_id, "debit_amount": amount, "remarks": label},
                       {"gl_account_id": ledger_id_for(db, "customer_advance"), "credit_amount": amount, "customer_id": customer.id, "remarks": label}]
        else:
            ar = customer.gl_reconciliation_account_id or ledger_id_for(db, "ar_control")
            journal = [{"gl_account_id": bank.gl_account_id, "debit_amount": amount, "remarks": label}]
            journal += [{"gl_account_id": d.gl_account_id, "cost_center_id": d.cost_center_id, "debit_amount": d.amount,
                         "remarks": f"{ADJUSTMENT_REASONS.get(d.reason, d.reason)} — {customer.name}" + (f": {d.remarks}" if d.remarks else "")}
                        for d in deds]
            journal.append({"gl_account_id": ar, "credit_amount": round(amount + ded_total, 2), "customer_id": customer.id, "remarks": label})
        description = label
    elif p.payment_type in ("expense", "other_receipt"):
        ref = p.narration or ""
        purpose = "expense" if p.payment_type == "expense" else "income/other"
        side, bank_side = ("debit", "credit") if p.payment_type == "expense" else ("credit", "debit")
        journal = [{"gl_account_id": l.gl_account_id, "cost_center_id": l.cost_center_id,
                    "internal_order_id": l.internal_order_id,
                    f"{side}_amount": l.amount, "remarks": l.remarks or ref} for l in p.lines]
        journal.append({"gl_account_id": bank.gl_account_id, f"{bank_side}_amount": amount, "remarks": ref or purpose})
        description = ("Expense payment" if p.payment_type == "expense" else "Other receipt") + (f" — {ref}" if ref else "")
    else:
        counter = _bank(db, p.counter_bank_account_id, "receiving")
        journal = [{"gl_account_id": counter.gl_account_id, "debit_amount": amount, "remarks": f"Transfer from {_label(bank)}"},
                   {"gl_account_id": bank.gl_account_id, "credit_amount": amount, "remarks": f"Transfer to {_label(counter)}"}]
        description = f"Contra: {_label(bank)} -> {_label(counter)}"

    if p.payment_type in ("vendor", "expense", "contra"):
        _check_cash_available(db, bank, amount, p.payment_date)
    fiscal.assert_postable(db, p.payment_date)
    number = fiscal.next_number(db, VOUCHER_TYPES[_VOUCHER_FOR_TYPE[p.payment_type]], p.payment_date)
    entry = post_journal_entry(
        db, posting_date=p.payment_date, lines=journal, posting_type=_POSTING_FOR_TYPE[p.payment_type],
        voucher_type=_VOUCHER_FOR_TYPE[p.payment_type], description=description,
        reference_document_type="payment_transaction", reference_document_id=p.id, created_by_id=posted_by_id,
        entry_number=number,
    )
    p.payment_number = number
    p.journal_entry_id = entry.id
    p.status = "posted"
    p.approved_by_id = approved_by_id
    p.unallocated_amount = amount if p.payment_type in ("vendor", "customer") else 0
    pending = list(p.pending_allocations or [])
    p.pending_allocations = None
    db.flush()

    for a in pending:
        allocate(db, source_type="payment", source_id=p.id, target_type=a["target_type"], target_id=a["target_id"],
                 amount=a["amount"], allocation_date=p.payment_date, created_by_id=posted_by_id)
    for d in deds:
        d.status = "posted"
        d.journal_entry_id = entry.id
        db.flush()
        allocate(db, source_type="adjustment", source_id=d.id, target_type=d.target_type, target_id=d.target_id,
                 amount=d.amount, allocation_date=p.payment_date, created_by_id=posted_by_id)
    db.flush()
    return p


def reject_held_voucher(db: Session, *, payment_id: int, reason: str, user_id: int) -> PaymentTransaction | None:
    from app.modules.accounts.service import lock_row

    p = lock_row(db, PaymentTransaction, payment_id)
    if not p or p.status != "pending_approval":
        return p
    p.status = "rejected"
    p.rejection_reason = reason
    p.pending_allocations = None
    for d in voucher_deductions(db, p.id):
        d.status = "cancelled"
    db.flush()
    return p


def write_off(db: Session, *, target_type: str, target_id: int, amount: float, reason: str, write_off_date: date,
              created_by_id: int | None, gl_account_id: int | None = None, cost_center_id: int | None = None,
              remarks: str | None = None) -> SettlementAdjustment:
    """Standalone write-off of what is left on one invoice (no cash) — the
    paise left after a receipt, or an approved LD/short-payment write-off.
    Customer: Dr deduction ledger / Cr AR. Vendor: Dr AP / Cr deduction ledger."""
    from app.modules.accounts.service import post_journal_entry

    side = "customer" if target_type == "ar_transaction" else "vendor" if target_type == "vendor_invoice" else None
    if side is None:
        raise ValueError(f"Can't write off a '{target_type}' — pick a sales or purchase invoice.")
    target = _target(db, target_type, target_id)
    if target.status != "posted":
        raise ValueError(f"Invoice '{target.invoice_number}' isn't posted — only a posted bill can be written off.")
    amount = round(float(amount or 0), 2)
    if amount <= 0:
        raise ValueError("Write-off amount must be greater than zero.")
    if amount > target.amount_due + 1e-9:
        raise ValueError(f"Invoice '{target.invoice_number}' has only {target.amount_due:,.2f} due — can't write off {amount:,.2f}.")
    gl_id = _deduction_ledger(db, side, reason, gl_account_id, 1)
    fiscal.assert_postable(db, write_off_date)
    adj = SettlementAdjustment(target_type=target_type, target_id=target.id, reason=reason, gl_account_id=gl_id,
                               cost_center_id=cost_center_id, amount=amount, adjustment_date=write_off_date,
                               remarks=remarks, status="posted", created_by_id=created_by_id)
    db.add(adj)
    db.flush()
    what = f"{ADJUSTMENT_REASONS[reason]} written off on {target.invoice_number}" + (f": {remarks}" if remarks else "")
    if side == "customer":
        from app.modules.crm.models.organization import Organization
        cust = db.query(Organization).filter(Organization.id == target.customer_id).first()
        ar = (cust.gl_reconciliation_account_id if cust else None) or ledger_id_for(db, "ar_control")
        lines = [{"gl_account_id": gl_id, "cost_center_id": cost_center_id, "debit_amount": amount, "remarks": what},
                 {"gl_account_id": ar, "credit_amount": amount, "customer_id": target.customer_id, "remarks": what}]
    else:
        vendor = db.query(Vendor).filter(Vendor.id == target.vendor_id).first()
        ap = (vendor.gl_reconciliation_account_id if vendor else None) or ledger_id_for(db, "ap_control")
        lines = [{"gl_account_id": ap, "debit_amount": amount, "vendor_id": target.vendor_id, "remarks": what},
                 {"gl_account_id": gl_id, "cost_center_id": cost_center_id, "credit_amount": amount, "remarks": what}]
    entry = post_journal_entry(db, posting_date=write_off_date, lines=lines, posting_type="adjustment", voucher_type="journal",
                               description=what, reference_document_type="settlement_adjustment",
                               reference_document_id=adj.id, created_by_id=created_by_id)
    adj.journal_entry_id = entry.id
    allocate(db, source_type="adjustment", source_id=adj.id, target_type=target_type, target_id=target.id, amount=amount,
             allocation_date=write_off_date, created_by_id=created_by_id)
    return adj


def cancel_write_off(db: Session, *, adjustment_id: int, reason: str, user_id: int) -> SettlementAdjustment:
    from app.modules.accounts.service import reverse_journal_entry

    adj = db.query(SettlementAdjustment).filter(SettlementAdjustment.id == adjustment_id).first()
    if not adj or adj.status != "posted":
        raise ValueError("Write-off not found or already cancelled.")
    if adj.payment_transaction_id:
        raise ValueError("This deduction is part of a receipt/payment voucher — cancel the voucher instead.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the write-off.")
    for alloc in db.query(PaymentAllocation).filter(PaymentAllocation.source_type == "adjustment",
                                                    PaymentAllocation.source_id == adj.id).all():
        _release(db, alloc)
    if adj.journal_entry_id:
        reverse_journal_entry(db, journal_entry_id=adj.journal_entry_id, reason=f"Write-off cancelled: {reason}",
                              reversed_by_id=user_id, reversal_date=max(date.today(), adj.adjustment_date))
    adj.status = "cancelled"
    db.flush()
    return adj


def _target(db: Session, target_type: str, target_id: int):
    if target_type == "vendor_invoice":
        t = db.query(VendorInvoice).filter(VendorInvoice.id == target_id).with_for_update().first()
    elif target_type == "ar_transaction":
        t = db.query(ARTransaction).filter(ARTransaction.id == target_id).with_for_update().first()
    else:
        raise ValueError(f"Can't allocate against '{target_type}'.")
    if not t:
        raise ValueError("The invoice being settled was not found.")
    return t


def _set_target_settled(target, target_type: str, delta: float) -> None:
    if target_type == "vendor_invoice":
        target.amount_paid = round(target.amount_paid + delta, 2)
        target.amount_due = round(target.amount_due - delta, 2)
        target.payment_status = "paid" if target.amount_due <= 1e-9 else ("partial" if target.amount_paid > 1e-9 else "pending")
    else:
        target.amount_received = round(target.amount_received + delta, 2)
        target.amount_due = round(target.amount_due - delta, 2)
        target.collection_status = "collected" if target.amount_due <= 1e-9 else ("partial" if target.amount_received > 1e-9 else "pending")


def journal_line_available(db: Session, line_id: int) -> tuple[JournalEntryLine | None, float, str | None]:
    """A manual JV line that can clear a party's bill: (line, amount still
    unallocated, why it can't be used). Customer lines clear by their credit
    (e.g. a JV transferring an advance or a settlement), vendor lines by
    their debit."""
    line = db.query(JournalEntryLine).filter(JournalEntryLine.id == line_id).first()
    if not line:
        return None, 0.0, "The journal line was not found."
    entry = db.query(JournalEntry).filter(JournalEntry.id == line.journal_entry_id).first()
    if entry is None or entry.status != "posted" or entry.reverses_journal_entry_id:
        return line, 0.0, f"Journal {entry.entry_number if entry else ''} isn't a live posted journal (it is reversed or a draft)."
    if entry.reference_document_type or entry.posting_type not in JE_MANUAL_POSTING_TYPES:
        return line, 0.0, (f"{entry.entry_number} was posted by a document — settle bills with that document "
                           f"(voucher / note), not its journal.")
    amount = line.credit_amount if line.customer_id else line.debit_amount if line.vendor_id else 0
    if amount <= 0:
        return line, 0.0, (f"{entry.entry_number}: only a line that reduces what the party owes / is owed "
                           f"(customer credit, vendor debit) can settle a bill.")
    used = sum(a.amount for a in db.query(PaymentAllocation).filter(PaymentAllocation.source_type == "journal",
                                                                     PaymentAllocation.source_id == line.id).all())
    return line, round(amount - used, 2), None


def allocate(db: Session, *, source_type: str, source_id: int, target_type: str, target_id: int, amount: float,
             allocation_date: date, created_by_id: int | None, amount_fc: float | None = None) -> PaymentAllocation:
    """amount is INR. For a foreign bill settled by a voucher in the same
    currency, amount is what the voucher gives up (or pass amount_fc); the
    bill is cleared at its booking rate and the exchange difference posted
    (services/fx.py)."""
    from app.modules.accounts.services import fx as _fx

    amount = round(float(amount or 0), 2)
    if amount <= 0 and not amount_fc:
        raise ValueError("Allocation amount must be greater than zero.")
    target = _target(db, target_type, target_id)
    fx_split = None
    if source_type in ("payment", "advance"):
        _src = db.query(PaymentTransaction).filter(PaymentTransaction.id == source_id).first()
        if _src is not None and _src.status == "posted":
            fx_split = _fx.split_settlement(_src, target, target_type, amount, amount_fc)
    src_amount = amount
    if fx_split is not None:
        amount, src_amount = fx_split.target_inr, fx_split.source_inr
    target_label = getattr(target, "invoice_number", "")
    if target.status != "posted":
        raise ValueError(f"Invoice '{target_label}' isn't posted yet — only a posted invoice can be settled.")
    if amount > target.amount_due + 1e-9:
        raise ValueError(f"Invoice '{target_label}' has only {target.amount_due:,.2f} due; can't allocate {amount:,.2f}.")
    if target_type == "vendor_invoice" and source_type in ("payment", "advance") and getattr(target, "payment_block", False):
        raise ValueError(f"Invoice '{target_label}' is blocked for payment"
                         f"{f' ({target.payment_block_reason})' if target.payment_block_reason else ''} — release the block first.")
    party_kw = {"vendor_id": target.vendor_id} if target_type == "vendor_invoice" else {"customer_id": target.customer_id}

    src = None
    if source_type in ("payment", "advance"):
        src = db.query(PaymentTransaction).filter(PaymentTransaction.id == source_id).with_for_update().first()
        if not src or src.status != "posted":
            raise ValueError("The voucher being allocated was not found, is cancelled or is still waiting for approval.")
        if target_type == "vendor_invoice" and (src.payment_type != "vendor" or src.vendor_id != target.vendor_id):
            raise ValueError(f"Voucher '{src.payment_number}' isn't a payment to this invoice's vendor.")
        if target_type == "ar_transaction" and (src.payment_type != "customer" or src.customer_id != target.customer_id):
            raise ValueError(f"Voucher '{src.payment_number}' isn't a receipt from this invoice's customer.")
        if src.is_advance and source_type == "payment":
            source_type = "advance"
        if source_type == "advance" and not src.is_advance:
            raise ValueError(f"Voucher '{src.payment_number}' isn't an advance — allocate it as a payment.")
        if source_type == "advance" and target_type == "ar_transaction" and src.sales_order_id \
                and (inv_sos := _invoice_so_ids(db, target.id)) and src.sales_order_id not in inv_sos:
            raise ValueError(f"Advance '{src.payment_number}' was received against another sales order — it can only be "
                             f"adjusted against that order's invoices.")
        if src_amount > src.unallocated_amount + 1e-9:
            raise ValueError(f"Voucher '{src.payment_number}' has only {src.unallocated_amount:,.2f} left to allocate.")
        src.unallocated_amount = round(src.unallocated_amount - src_amount, 2)
        if source_type == "payment":
            if target_type == "vendor_invoice" and src.vendor_invoice_id is None and src.amount == amount:
                src.vendor_invoice_id = target.id
            if target_type == "ar_transaction" and src.ar_transaction_id is None and src.amount == amount:
                src.ar_transaction_id = target.id
    elif source_type == "party_note":
        note = db.query(PartyNote).filter(PartyNote.id == source_id).with_for_update().first()
        if not note or note.status != "posted":
            raise ValueError("The note being adjusted was not found or isn't posted.")
        if target_type == "vendor_invoice" and (note.note_type != "debit_note" or note.vendor_id != target.vendor_id):
            raise ValueError(f"Note '{note.note_number}' isn't a debit note on this invoice's vendor.")
        if target_type == "ar_transaction" and (note.note_type != "credit_note" or note.customer_id != target.customer_id):
            raise ValueError(f"Note '{note.note_number}' isn't a credit note to this invoice's customer.")
        if amount > note.unadjusted_amount + 1e-9:
            raise ValueError(f"Note '{note.note_number}' has only {note.unadjusted_amount:,.2f} left to adjust.")
        note.unadjusted_amount = round(note.unadjusted_amount - amount, 2)
    elif source_type == "adjustment":
        adj = db.query(SettlementAdjustment).filter(SettlementAdjustment.id == source_id).first()
        if not adj or adj.status != "posted":
            raise ValueError("The deduction being applied was not found or isn't posted.")
        if (adj.target_type, adj.target_id) != (target_type, target.id):
            raise ValueError("A deduction settles only the invoice it was made against.")
        if db.query(PaymentAllocation.id).filter(PaymentAllocation.source_type == "adjustment",
                                                 PaymentAllocation.source_id == adj.id).first():
            raise ValueError("This deduction has already been applied to its invoice.")
        if amount != round(adj.amount, 2):
            raise ValueError("A deduction is applied in full to its invoice.")
    elif source_type == "journal":
        line, available, why = journal_line_available(db, source_id)
        if why:
            raise ValueError(why)
        if (line.vendor_id if target_type == "vendor_invoice" else line.customer_id) != \
                (target.vendor_id if target_type == "vendor_invoice" else target.customer_id):
            raise ValueError(f"That journal line isn't tagged to this invoice's {'vendor' if target_type == 'vendor_invoice' else 'customer'}.")
        if amount > available + 1e-9:
            raise ValueError(f"That journal line has only {available:,.2f} left to allocate.")
    else:
        raise ValueError(f"Can't allocate from '{source_type}'.")

    _set_target_settled(target, target_type, amount)
    _fx.reduce_open_fc(target, amount, fx_split.amount_fc if fx_split else None)
    alloc = PaymentAllocation(source_type=source_type, source_id=source_id, target_type=target_type, target_id=target_id,
                              amount=amount, allocation_date=allocation_date, created_by_id=created_by_id)
    db.add(alloc)
    db.flush()

    if source_type == "advance":
        # F-39 / F-54: move the cleared part off the advance ledger onto the
        # party's AR/AP control, where the invoice sits.
        from app.modules.accounts.service import post_journal_entry

        what = f"Advance {src.payment_number} adjusted against {target_label}"
        if target_type == "ar_transaction":
            from app.modules.crm.models.organization import Organization
            cust = db.query(Organization).filter(Organization.id == target.customer_id).first()
            ar = (cust.gl_reconciliation_account_id if cust else None) or ledger_id_for(db, "ar_control")
            lines = [{"gl_account_id": ledger_id_for(db, "customer_advance"), "debit_amount": src_amount, **party_kw, "remarks": what},
                     {"gl_account_id": ar, "credit_amount": src_amount, **party_kw, "remarks": what}]
        else:
            vendor = db.query(Vendor).filter(Vendor.id == target.vendor_id).first()
            ap = (vendor.gl_reconciliation_account_id if vendor else None) or ledger_id_for(db, "ap_control")
            lines = [{"gl_account_id": ap, "debit_amount": src_amount, **party_kw, "remarks": what},
                     {"gl_account_id": ledger_id_for(db, "supplier_advance"), "credit_amount": src_amount, **party_kw, "remarks": what}]
        entry = post_journal_entry(db, posting_date=max(allocation_date, src.payment_date), lines=lines, posting_type="adjustment",
                                   voucher_type="journal", description=what, reference_document_type="payment_allocation",
                                   reference_document_id=alloc.id, created_by_id=created_by_id)
        alloc.journal_entry_id = entry.id
        db.flush()
    if fx_split is not None:
        _fx.post_fx_difference(db, alloc=alloc, src=src, target=target, target_type=target_type, split=fx_split,
                               on=max(allocation_date, src.payment_date, target.invoice_date), user_id=created_by_id)
    if target_type == "ar_transaction":
        _refresh_so_billing(db, target.id)
    return alloc


def _invoice_so_ids(db: Session, ar_transaction_id: int) -> set[int]:
    """Sales orders a sales invoice was billed from (sales_invoice_links)."""
    try:
        from app.modules.sales.models.delivery import SalesInvoiceLink
    except ImportError:  # pragma: no cover
        return set()
    return {r[0] for r in db.query(SalesInvoiceLink.so_id).filter(SalesInvoiceLink.ar_transaction_id == ar_transaction_id).distinct().all()}


def _refresh_so_billing(db: Session, ar_transaction_id: int) -> None:
    """A receipt / advance / note settled (or released) an SO invoice — let
    Sales re-derive the milestone (invoiced -> settled once fully collected)."""
    from app.modules.accounts.services.billing import on_ar_changed
    on_ar_changed(db, ar_transaction_id)


def apply_so_advance_recovery(db: Session, *, ar_transaction_id: int, user_id: int | None = None) -> float:
    """F-39 down-payment clearing proposed by the SO: when a posted invoice
    bills a milestone with recovers_advance_percent, that share of the
    invoice is adjusted against the customer's open advances taken on the
    same sales order (oldest first). Runs once per invoice (skips when an
    advance is already adjusted against it). Returns the amount adjusted."""
    inv = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if inv is None or inv.status != "posted" or inv.amount_due <= 0.005:
        return 0.0
    if db.query(PaymentAllocation.id).filter(PaymentAllocation.source_type == "advance", PaymentAllocation.target_type == "ar_transaction",
                                             PaymentAllocation.target_id == inv.id).first():
        return 0.0
    try:
        from app.modules.sales.models.delivery import SalesInvoiceLink
        from app.modules.sales.models.order import SalesBillingPlanLine
    except ImportError:  # pragma: no cover
        return 0.0
    links = db.query(SalesInvoiceLink).filter(SalesInvoiceLink.ar_transaction_id == inv.id).all()
    so_ids = {l.so_id for l in links}
    bl_ids = {l.billing_plan_line_id for l in links if l.billing_plan_line_id}
    if not so_ids or not bl_ids:
        return 0.0
    pct = max((float(b.recovers_advance_percent or 0) for b in db.query(SalesBillingPlanLine)
               .filter(SalesBillingPlanLine.id.in_(bl_ids)).all()), default=0.0)
    if pct <= 0:
        return 0.0
    want = round(min(inv.total_amount * pct / 100, inv.amount_due), 2)
    advances = (db.query(PaymentTransaction)
                .filter(PaymentTransaction.status == "posted", PaymentTransaction.is_advance.is_(True),
                        PaymentTransaction.payment_type == "customer", PaymentTransaction.customer_id == inv.customer_id,
                        PaymentTransaction.sales_order_id.in_(so_ids), PaymentTransaction.unallocated_amount > 0.005)
                .order_by(PaymentTransaction.payment_date.asc(), PaymentTransaction.id.asc()).all())
    done = 0.0
    for adv in advances:
        take = round(min(adv.unallocated_amount, want - done), 2)
        if take <= 0.005:
            break
        allocate(db, source_type="advance", source_id=adv.id, target_type="ar_transaction", target_id=inv.id, amount=take,
                 allocation_date=max(inv.invoice_date, adv.payment_date), created_by_id=user_id)
        done = round(done + take, 2)
    return done


def _release(db: Session, alloc: PaymentAllocation, *, reason: str | None = None, user_id: int | None = None) -> None:
    """Undo one allocation's bill-wise effect (and an advance clearing's JV)."""
    from app.modules.accounts.service import reverse_journal_entry

    from app.modules.accounts.services import fx as _fx

    target = _target(db, alloc.target_type, alloc.target_id)
    _set_target_settled(target, alloc.target_type, -alloc.amount)
    _fx.restore_open_fc(target, alloc.amount, alloc.amount_fc)
    _fx.reverse_fx_difference(db, alloc, reason=reason, user_id=user_id)
    if alloc.source_type in ("payment", "advance"):
        src = db.query(PaymentTransaction).filter(PaymentTransaction.id == alloc.source_id).first()
        if src:
            src.unallocated_amount = round(src.unallocated_amount + (alloc.source_amount if alloc.source_amount is not None else alloc.amount), 2)
    elif alloc.source_type == "party_note":
        src = db.query(PartyNote).filter(PartyNote.id == alloc.source_id).first()
        if src:
            src.unadjusted_amount = round(src.unadjusted_amount + alloc.amount, 2)
    je_id = alloc.journal_entry_id
    released_ar = alloc.target_id if alloc.target_type == "ar_transaction" else None
    db.delete(alloc)
    db.flush()
    if released_ar:
        _refresh_so_billing(db, released_ar)
    if je_id:
        je = db.query(JournalEntry).filter(JournalEntry.id == je_id).first()
        if je is not None and je.status == "posted":
            reverse_journal_entry(db, journal_entry_id=je.id, reason=reason or "Advance adjustment removed",
                                  reversed_by_id=user_id, reversal_date=max(date.today(), je.posting_date))


def remove_allocation(db: Session, *, allocation_id: int, user_id: int | None = None) -> None:
    alloc = db.query(PaymentAllocation).filter(PaymentAllocation.id == allocation_id).first()
    if not alloc:
        raise ValueError("Allocation not found.")
    if alloc.source_type == "adjustment":
        raise ValueError("A deduction / write-off can't be un-allocated on its own — cancel the voucher it belongs to, "
                         "or cancel the write-off.")
    _release(db, alloc, user_id=user_id)


def cancel_voucher(db: Session, *, payment_id: int, reason: str, user_id: int, cancel_date: date | None = None) -> PaymentTransaction:
    from app.modules.accounts.service import reverse_journal_entry, lock_row

    p = lock_row(db, PaymentTransaction, payment_id)
    if not p:
        raise ValueError("Voucher not found.")
    if p.status == "pending_approval":
        raise ValueError(f"Voucher '{p.payment_number}' hasn't been posted — it is waiting for approval. Withdraw it from the "
                         f"Approval panel (or ask the approver to reject it) instead of cancelling.")
    if p.status != "posted":
        raise ValueError(f"Voucher '{p.payment_number}' is already {p.status}.")
    if p.reconciliation_status != "pending" or p.counter_reconciliation_status != "pending":
        raise ValueError(f"Voucher '{p.payment_number}' has been reconciled with the bank statement — it actually went through the bank, so record a fresh reverse voucher instead of cancelling.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the voucher.")
    for alloc in db.query(PaymentAllocation).filter(PaymentAllocation.source_type.in_(("payment", "advance")),
                                                    PaymentAllocation.source_id == p.id).all():
        _release(db, alloc, reason=f"Voucher {p.payment_number} cancelled: {reason}", user_id=user_id)
    deds = voucher_deductions(db, p.id)
    if deds:
        for alloc in db.query(PaymentAllocation).filter(PaymentAllocation.source_type == "adjustment",
                                                        PaymentAllocation.source_id.in_([d.id for d in deds])).all():
            _release(db, alloc)
        for d in deds:
            d.status = "cancelled"
    if p.journal_entry_id:
        reverse_journal_entry(db, journal_entry_id=p.journal_entry_id, reason=f"Voucher {p.payment_number} cancelled: {reason}",
                              reversed_by_id=user_id, reversal_date=max(cancel_date or date.today(), p.payment_date))
    p.status = "cancelled"
    p.unallocated_amount = 0
    p.narration = ((p.narration or "") + f" [Cancelled: {reason}]").strip()
    db.flush()
    return p


def allocations_for(db: Session, *, source_type: str | None = None, source_id: int | None = None,
                    target_type: str | None = None, target_id: int | None = None) -> list[PaymentAllocation]:
    q = db.query(PaymentAllocation)
    if source_type:
        q = q.filter(PaymentAllocation.source_type == source_type)
    if source_id is not None:
        q = q.filter(PaymentAllocation.source_id == source_id)
    if target_type:
        q = q.filter(PaymentAllocation.target_type == target_type)
    if target_id is not None:
        q = q.filter(PaymentAllocation.target_id == target_id)
    return q.order_by(PaymentAllocation.allocation_date.asc(), PaymentAllocation.id.asc()).all()


def load_voucher(db: Session, payment_id: int) -> PaymentTransaction | None:
    return db.query(PaymentTransaction).options(selectinload(PaymentTransaction.lines)).filter(PaymentTransaction.id == payment_id).first()
