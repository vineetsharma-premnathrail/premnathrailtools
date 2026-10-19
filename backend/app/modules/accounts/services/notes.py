"""Debit notes (to vendors — purchase returns) and credit notes (to
customers — sales returns), the only way to correct a posted invoice.

Debit note:  Dr Vendor            Cr purchase ledgers (taxable)  Cr GST Input
             (reverse charge bill: Dr GST RCM Payable / Cr GST Input instead
              of touching the vendor for the tax)
Credit note: Dr sales ledgers     Dr GST Output                  Cr Customer

Numbered DN/<FY>/<NNNN> or CN/<FY>/<NNNN> on posting, then set off against
the linked invoice up to its amount due; any excess stays on the party as an
open credit to allocate later."""
from datetime import date
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.party_note import PartyNote, PartyNoteLine, PARTY_NOTE_REASONS
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.journal_entry import VOUCHER_TYPES
from app.modules.accounts.services import fiscal, gst
from app.modules.accounts.services.ledgers import ledger_id_for


def credit_note_deadline(invoice_date: date) -> date:
    """CGST Act s.34(2): GST on a credit note can be reduced only if it's
    issued by 30 November following the end of the invoice's financial year."""
    fy_end_year = invoice_date.year + 1 if invoice_date.month >= 4 else invoice_date.year
    return date(fy_end_year, 11, 30)


def _already_noted_taxable(db: Session, *, vendor_invoice_id: int | None = None, ar_transaction_id: int | None = None) -> float:
    q = db.query(PartyNote).filter(PartyNote.status != "cancelled")
    q = q.filter(PartyNote.vendor_invoice_id == vendor_invoice_id) if vendor_invoice_id else q.filter(PartyNote.ar_transaction_id == ar_transaction_id)
    return round(sum(n.taxable_amount for n in q.all()), 2)


def create_party_note(
    db: Session, *, note_type: str, note_date: date, lines: list[dict], created_by_id: int | None,
    vendor_id: int | None = None, customer_id: int | None = None, vendor_invoice_id: int | None = None,
    ar_transaction_id: int | None = None, reason: str = "return", round_off: float = 0, narration: str | None = None,
) -> PartyNote:
    if note_type not in ("debit_note", "credit_note"):
        raise ValueError("Note type must be 'debit_note' (to a vendor) or 'credit_note' (to a customer).")
    if reason not in PARTY_NOTE_REASONS:
        raise ValueError(f"Reason must be one of: {', '.join(PARTY_NOTE_REASONS)}.")
    fiscal.fiscal_year_for(db, note_date)
    company_state = gst.require_company_state(db)

    if note_type == "debit_note":
        invoice = None
        if vendor_invoice_id:
            invoice = db.query(VendorInvoice).filter(VendorInvoice.id == vendor_invoice_id).first()
            if not invoice or invoice.status != "posted":
                raise ValueError("A debit note can only be raised against a posted purchase invoice.")
            vendor_id = invoice.vendor_id
        vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first() if vendor_id else None
        if not vendor:
            raise ValueError("Pick the vendor (or the purchase invoice) the debit note is for.")
        if invoice is not None:
            interstate, pos, gstin = invoice.is_interstate, invoice.place_of_supply_state_code, invoice.vendor_gstin
            if note_date < invoice.invoice_date:
                raise ValueError("A debit note can't be dated before the invoice it corrects.")
        else:
            vstate = gst.party_state_code(vendor.gstin, vendor.state)
            if not vstate:
                raise ValueError(f"Vendor '{vendor.name}' has no GSTIN or state — complete it under Finance > Masters > Vendors.")
            pos, interstate, gstin = company_state, vstate != company_state, vendor.gstin
        default_ledger = ledger_id_for(db, "purchase_default")
        party = {"vendor_id": vendor.id}
    else:
        if not ar_transaction_id:
            raise ValueError("A credit note must reference the original sales invoice — GSTR-1 reports it against that invoice.")
        invoice = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
        if not invoice or invoice.status != "posted":
            raise ValueError("A credit note can only be raised against a posted sales invoice.")
        if note_date < invoice.invoice_date:
            raise ValueError("A credit note can't be dated before the invoice it corrects.")
        customer_id = invoice.customer_id
        interstate, pos, gstin = invoice.is_interstate, invoice.place_of_supply_state_code, invoice.customer_gstin
        default_ledger = ledger_id_for(db, "sales_default")
        party = {"customer_id": customer_id}

    lines = [dict(l) for l in lines or []]
    for l in lines:
        l["gl_account_id"] = l.get("gl_account_id") or default_ledger
        l["description"] = (l.get("description") or "").strip() or ("Purchase return" if note_type == "debit_note" else "Sales return")
    totals = gst.compute_lines(lines, interstate=interstate, allowed_rates=None)
    if totals["taxable"] <= 0:
        raise ValueError("Note value must be greater than zero.")
    round_off = gst.check_round_off(round_off)

    if invoice is not None:
        already = _already_noted_taxable(db, vendor_invoice_id=invoice.id if note_type == "debit_note" else None,
                                         ar_transaction_id=invoice.id if note_type == "credit_note" else None)
        if already + totals["taxable"] > invoice.invoice_amount + 0.01:
            raise ValueError(
                f"Notes against invoice '{invoice.invoice_number}' would total {already + totals['taxable']:,.2f} (before GST), "
                f"more than the invoice's own taxable value {invoice.invoice_amount:,.2f}."
            )
    if note_type == "credit_note" and totals["tax"] > 0 and note_date > credit_note_deadline(invoice.invoice_date):
        raise ValueError(
            f"GST on a credit note for an invoice dated {invoice.invoice_date:%d-%b-%Y} can only be reduced up to "
            f"{credit_note_deadline(invoice.invoice_date):%d-%b-%Y} (CGST Act s.34). Raise it with 0% GST (a financial credit note) instead."
        )

    rcm = note_type == "debit_note" and invoice is not None and invoice.is_reverse_charge
    total = round(totals["taxable"] + (0 if rcm else totals["tax"]) + round_off, 2)
    note = PartyNote(
        note_number=f"DRAFT-{note_type[:2].upper()}-{date.today():%y%m%d%H%M%S%f}"[:50], note_type=note_type, note_date=note_date,
        reason=reason, vendor_id=party.get("vendor_id"), customer_id=party.get("customer_id"),
        vendor_invoice_id=invoice.id if (invoice is not None and note_type == "debit_note") else None,
        ar_transaction_id=invoice.id if note_type == "credit_note" else None,
        party_gstin=gstin, place_of_supply_state_code=pos, is_interstate=interstate,
        taxable_amount=totals["taxable"], cgst_amount=totals["cgst"], sgst_amount=totals["sgst"], igst_amount=totals["igst"],
        gst_amount=totals["tax"], round_off=round_off, total_amount=total, unadjusted_amount=0,
        narration=narration, created_by_id=created_by_id,
    )
    db.add(note)
    db.flush()
    note.note_number = f"DRAFT-{note.id}"
    for i, l in enumerate(lines, start=1):
        db.add(PartyNoteLine(
            party_note_id=note.id, line_number=i, description=l["description"], store_item_id=l.get("store_item_id"),
            hsn_sac_code=l.get("hsn_sac_code"), quantity=l["quantity"], uom=l.get("uom"), rate=l["rate"],
            discount_amount=l.get("discount_amount") or 0, taxable_amount=l["taxable_amount"], gst_rate=l.get("gst_rate") or 0,
            cgst_amount=l["cgst_amount"], sgst_amount=l["sgst_amount"], igst_amount=l["igst_amount"],
            gl_account_id=l["gl_account_id"], cost_center_id=l.get("cost_center_id"),
            internal_order_id=l.get("internal_order_id"),
        ))
    db.flush()
    return note


def post_party_note(db: Session, *, party_note_id: int, posted_by_id: int) -> PartyNote:
    from app.modules.accounts.service import (
        post_journal_entry, _ensure_not_maker, _grouped_ledger_lines, tax_journal_lines, round_off_line, lock_row,
    )
    from app.modules.accounts.services.vouchers import allocate

    note = lock_row(db, PartyNote, party_note_id, selectinload(PartyNote.lines))
    if not note:
        raise ValueError("Note not found.")
    if note.status != "pending":
        raise ValueError(f"Only a pending note can be posted (current status: '{note.status}').")
    _ensure_not_maker(note.created_by_id, posted_by_id, "post", what="note")
    fiscal.assert_postable(db, note.note_date)
    prefix = VOUCHER_TYPES[note.note_type]
    note.note_number = fiscal.next_number(db, prefix, note.note_date)
    ref = f"{'Debit' if note.note_type == 'debit_note' else 'Credit'} note {note.note_number}"

    if note.note_type == "debit_note":
        vendor = db.query(Vendor).filter(Vendor.id == note.vendor_id).first()
        ap = vendor.gl_reconciliation_account_id or ledger_id_for(db, "ap_control")
        rcm = False
        if note.vendor_invoice_id:
            inv = db.query(VendorInvoice).filter(VendorInvoice.id == note.vendor_invoice_id).first()
            rcm = bool(inv and inv.is_reverse_charge)
        lines = [{"gl_account_id": ap, "debit_amount": note.total_amount, "vendor_id": vendor.id, "remarks": ref}]
        lines += _grouped_ledger_lines(note.lines, side="credit", remarks=ref)
        lines += tax_journal_lines(db, kind="input", side="credit", cgst=note.cgst_amount, sgst=note.sgst_amount,
                                   igst=note.igst_amount, remarks=ref)
        if rcm and note.gst_amount > 0:
            lines.append({"gl_account_id": ledger_id_for(db, "rcm_payable"), "debit_amount": note.gst_amount, "remarks": f"RCM — {ref}"})
        lines += round_off_line(db, note.round_off, party_side="debit", remarks=ref)
        description, target_type, target_id = f"{ref} — {vendor.name}", "vendor_invoice", note.vendor_invoice_id
    else:
        from app.modules.crm.models.organization import Organization
        customer = db.query(Organization).filter(Organization.id == note.customer_id).first()
        ar = customer.gl_reconciliation_account_id or ledger_id_for(db, "ar_control")
        lines = _grouped_ledger_lines(note.lines, side="debit", remarks=ref)
        lines += tax_journal_lines(db, kind="output", side="debit", cgst=note.cgst_amount, sgst=note.sgst_amount,
                                   igst=note.igst_amount, remarks=ref)
        lines.append({"gl_account_id": ar, "credit_amount": note.total_amount, "customer_id": customer.id, "remarks": ref})
        lines += round_off_line(db, note.round_off, party_side="credit", remarks=ref)
        description, target_type, target_id = f"{ref} — {customer.name}", "ar_transaction", note.ar_transaction_id

    entry = post_journal_entry(
        db, posting_date=note.note_date, lines=lines, posting_type=note.note_type, voucher_type=note.note_type,
        description=description, reference_document_type="party_note", reference_document_id=note.id,
        created_by_id=posted_by_id, entry_number=note.note_number,
    )
    note.journal_entry_id = entry.id
    note.status = "posted"
    note.unadjusted_amount = note.total_amount
    db.flush()

    if target_id:
        target = db.query(VendorInvoice if target_type == "vendor_invoice" else ARTransaction).filter_by(id=target_id).first()
        settle = round(min(note.total_amount, target.amount_due), 2) if target else 0
        if settle > 0:
            allocate(db, source_type="party_note", source_id=note.id, target_type=target_type, target_id=target_id,
                     amount=settle, allocation_date=note.note_date, created_by_id=posted_by_id)
    db.flush()
    if target_type == "ar_transaction" and target_id:
        from app.modules.accounts.services.billing import on_ar_changed  # a credit note reverses SO billing
        on_ar_changed(db, target_id)
    return note


def cancel_party_note(db: Session, *, party_note_id: int, reason: str) -> PartyNote:
    note = db.query(PartyNote).filter(PartyNote.id == party_note_id).first()
    if not note:
        raise ValueError("Note not found.")
    if note.status != "pending":
        raise ValueError("Only an unposted note can be cancelled — a posted note is undone with a fresh opposite document.")
    if not reason or not reason.strip():
        raise ValueError("Give a reason for cancelling the note.")
    note.status = "cancelled"
    note.narration = ((note.narration or "") + f" [Cancelled: {reason}]").strip()
    db.flush()
    return note
