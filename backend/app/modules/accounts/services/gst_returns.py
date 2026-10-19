"""GST registers, GSTR-1 / GSTR-3B working figures and the monthly ITC set-off.

These are working reports to prepare the returns on the GST portal — not
the filing itself. GSTR-3B input credit shown here is what our books claim;
before filing it must be checked against GSTR-2B (what suppliers actually
uploaded), because only that much ITC is allowed (CGST s.16(2)(aa))."""
from datetime import date
from sqlalchemy.orm import Session, selectinload

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.services import fiscal
from app.modules.accounts.services.balances import account_totals
from app.modules.accounts.services.gst import GST_STATE_CODES
from app.modules.accounts.services.ledgers import ledger_id_for

B2CL_THRESHOLD = 100000.0  # inter-state B2C invoice value above which it's reported invoice-wise (from Aug-2024)


def _r(x: float) -> float:
    return round(float(x or 0), 2)


def _rate_breakup(lines) -> list[dict]:
    by_rate: dict[float, dict] = {}
    for l in lines:
        r = by_rate.setdefault(float(l.gst_rate or 0), {"rate": float(l.gst_rate or 0), "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0})
        r["taxable"] += float(l.taxable_amount or 0)
        r["cgst"] += float(l.cgst_amount or 0)
        r["sgst"] += float(l.sgst_amount or 0)
        r["igst"] += float(l.igst_amount or 0)
    return [{k: (_r(v) if k != "rate" else v) for k, v in r.items()} for r in sorted(by_rate.values(), key=lambda x: x["rate"])]


def _pos_label(code: str | None) -> str:
    return f"{code}-{GST_STATE_CODES.get(code, '?')}" if code else "—"


def gst_register(db: Session, *, kind: str, from_date: date, to_date: date) -> dict:
    """kind: 'sales' (invoices + credit notes) or 'purchase' (bills + debit notes)."""
    rows = []
    if kind == "sales":
        from app.modules.crm.models.organization import Organization
        docs = db.query(ARTransaction).filter(ARTransaction.status == "posted", ARTransaction.reference_type.is_(None) | (ARTransaction.reference_type != "opening"),
                                              ARTransaction.invoice_date >= from_date, ARTransaction.invoice_date <= to_date).all()
        notes = db.query(PartyNote).filter(PartyNote.note_type == "credit_note", PartyNote.status == "posted",
                                           PartyNote.note_date >= from_date, PartyNote.note_date <= to_date).all()
        ids = {d.customer_id for d in docs} | {n.customer_id for n in notes}
        names = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(ids)).all()} if ids else {}
        for d in docs:
            rows.append({"doc_type": "invoice", "doc_number": d.invoice_number, "doc_date": d.invoice_date, "party_name": names.get(d.customer_id),
                         "gstin": d.customer_gstin, "place_of_supply": _pos_label(d.place_of_supply_state_code), "reverse_charge": False,
                         "taxable": _r(d.invoice_amount), "cgst": _r(d.cgst_amount), "sgst": _r(d.sgst_amount), "igst": _r(d.igst_amount),
                         "total": _r(d.total_amount)})
        sign = -1
    else:
        from app.modules.accounts.models.vendor import Vendor
        docs = db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.invoice_type != "opening",
                                              VendorInvoice.invoice_date >= from_date, VendorInvoice.invoice_date <= to_date).all()
        notes = db.query(PartyNote).filter(PartyNote.note_type == "debit_note", PartyNote.status == "posted",
                                           PartyNote.note_date >= from_date, PartyNote.note_date <= to_date).all()
        ids = {d.vendor_id for d in docs} | {n.vendor_id for n in notes}
        names = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(ids)).all()} if ids else {}
        for d in docs:
            rows.append({"doc_type": "invoice", "doc_number": d.invoice_number, "doc_date": d.invoice_date, "party_name": names.get(d.vendor_id),
                         "gstin": d.vendor_gstin, "place_of_supply": _pos_label(d.place_of_supply_state_code), "reverse_charge": d.is_reverse_charge,
                         "taxable": _r(d.invoice_amount), "cgst": _r(d.cgst_amount), "sgst": _r(d.sgst_amount), "igst": _r(d.igst_amount),
                         "total": _r(d.invoice_amount + d.invoice_gst + d.round_off)})
        sign = -1
    for n in notes:
        rows.append({"doc_type": n.note_type, "doc_number": n.note_number, "doc_date": n.note_date,
                     "party_name": names.get(n.customer_id if kind == "sales" else n.vendor_id),
                     "gstin": n.party_gstin, "place_of_supply": _pos_label(n.place_of_supply_state_code), "reverse_charge": False,
                     "taxable": _r(sign * n.taxable_amount), "cgst": _r(sign * n.cgst_amount), "sgst": _r(sign * n.sgst_amount),
                     "igst": _r(sign * n.igst_amount), "total": _r(sign * n.total_amount)})
    rows.sort(key=lambda r: (r["doc_date"], r["doc_number"]))
    totals = {k: _r(sum(r[k] for r in rows)) for k in ("taxable", "cgst", "sgst", "igst", "total")}
    return {"kind": kind, "from_date": from_date, "to_date": to_date, "rows": rows, "totals": totals}


def gstr1(db: Session, *, period: str) -> dict:
    start, end = fiscal.period_bounds(period)
    invoices = db.query(ARTransaction).options(selectinload(ARTransaction.lines)).filter(
        ARTransaction.status == "posted", ARTransaction.invoice_date >= start, ARTransaction.invoice_date <= end,
        ARTransaction.reference_type.is_(None) | (ARTransaction.reference_type != "opening"),
    ).order_by(ARTransaction.invoice_date, ARTransaction.invoice_number).all()
    notes = db.query(PartyNote).options(selectinload(PartyNote.lines)).filter(
        PartyNote.note_type == "credit_note", PartyNote.status == "posted", PartyNote.note_date >= start, PartyNote.note_date <= end,
    ).all()
    from app.modules.crm.models.organization import Organization
    names = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_({i.customer_id for i in invoices} | {n.customer_id for n in notes})).all()} if (invoices or notes) else {}

    b2b, b2cl = [], []
    b2cs: dict[tuple, dict] = {}
    for inv in invoices:
        row = {"gstin": inv.customer_gstin, "party_name": names.get(inv.customer_id), "invoice_number": inv.invoice_number,
               "invoice_date": inv.invoice_date, "invoice_value": _r(inv.total_amount),
               "place_of_supply": _pos_label(inv.place_of_supply_state_code), "reverse_charge": "N",
               "rates": _rate_breakup(inv.lines)}
        if inv.customer_gstin:
            b2b.append(row)
        elif inv.is_interstate and inv.total_amount > B2CL_THRESHOLD:
            b2cl.append(row)
        else:
            for r in row["rates"]:
                k = (inv.place_of_supply_state_code, r["rate"])
                agg = b2cs.setdefault(k, {"place_of_supply": _pos_label(inv.place_of_supply_state_code), "type": "INTER" if inv.is_interstate else "INTRA",
                                          "rate": r["rate"], "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0})
                for f in ("taxable", "cgst", "sgst", "igst"):
                    agg[f] = _r(agg[f] + r[f])

    inv_by_id = {i.id: i for i in db.query(ARTransaction).filter(ARTransaction.id.in_({n.ar_transaction_id for n in notes})).all()} if notes else {}
    cdnr, cdnur = [], []
    for n in notes:
        orig = inv_by_id.get(n.ar_transaction_id)
        row = {"gstin": n.party_gstin, "party_name": names.get(n.customer_id), "note_number": n.note_number, "note_date": n.note_date,
               "note_type": "C", "original_invoice_number": orig.invoice_number if orig else None,
               "original_invoice_date": orig.invoice_date if orig else None, "note_value": _r(n.total_amount),
               "place_of_supply": _pos_label(n.place_of_supply_state_code), "rates": _rate_breakup(n.lines)}
        (cdnr if n.party_gstin else cdnur).append(row)

    hsn: dict[tuple, dict] = {}
    for doc_lines, sign in ([(i.lines, 1) for i in invoices] + [(n.lines, -1) for n in notes]):
        for l in doc_lines:
            k = ((l.hsn_sac_code or "").strip() or "—", (l.uom or "").upper() or "OTH", float(l.gst_rate or 0))
            h = hsn.setdefault(k, {"hsn_sac": k[0], "uqc": k[1], "rate": k[2], "quantity": 0.0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0})
            h["quantity"] = round(h["quantity"] + sign * float(l.quantity or 0), 4)
            for f, attr in (("taxable", "taxable_amount"), ("cgst", "cgst_amount"), ("sgst", "sgst_amount"), ("igst", "igst_amount")):
                h[f] = _r(h[f] + sign * float(getattr(l, attr) or 0))

    cancelled = db.query(ARTransaction).filter(ARTransaction.status == "cancelled", ARTransaction.invoice_date >= start,
                                               ARTransaction.invoice_date <= end, ~ARTransaction.invoice_number.like("DRAFT-%")).count()
    numbers = [i.invoice_number for i in invoices if i.invoice_number.startswith("SI/")]
    docs = {"invoices_from": min(numbers) if numbers else None, "invoices_to": max(numbers) if numbers else None,
            "total_issued": len(numbers), "cancelled": cancelled}
    missing_hsn = sum(1 for k in hsn if k[0] == "—")
    return {
        "period": period, "b2b": b2b, "b2cl": b2cl, "b2cs": sorted(b2cs.values(), key=lambda x: (x["place_of_supply"], x["rate"])),
        "cdnr": cdnr, "cdnur": cdnur, "hsn_summary": sorted(hsn.values(), key=lambda x: (x["hsn_sac"], x["rate"])), "documents": docs,
        "warnings": ([f"{missing_hsn} HSN summary row(s) have no HSN/SAC code — HSN is mandatory in GSTR-1 Table 12; add it on the invoice lines' items."] if missing_hsn else []),
    }


def gstr3b(db: Session, *, period: str) -> dict:
    start, end = fiscal.period_bounds(period)

    def zero():
        return {"taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0}

    def add(bucket, taxable, igst, cgst, sgst, sign=1):
        bucket["taxable"] = _r(bucket["taxable"] + sign * taxable)
        bucket["igst"] = _r(bucket["igst"] + sign * igst)
        bucket["cgst"] = _r(bucket["cgst"] + sign * cgst)
        bucket["sgst"] = _r(bucket["sgst"] + sign * sgst)

    outward_taxable, outward_nil, inward_rcm = zero(), zero(), zero()
    for inv in db.query(ARTransaction).options(selectinload(ARTransaction.lines)).filter(
            ARTransaction.status == "posted", ARTransaction.invoice_date >= start, ARTransaction.invoice_date <= end,
            ARTransaction.reference_type.is_(None) | (ARTransaction.reference_type != "opening")).all():
        for l in inv.lines:
            add(outward_taxable if float(l.gst_rate or 0) > 0 else outward_nil, l.taxable_amount, l.igst_amount, l.cgst_amount, l.sgst_amount)
    for n in db.query(PartyNote).options(selectinload(PartyNote.lines)).filter(
            PartyNote.note_type == "credit_note", PartyNote.status == "posted", PartyNote.note_date >= start, PartyNote.note_date <= end).all():
        for l in n.lines:
            add(outward_taxable if float(l.gst_rate or 0) > 0 else outward_nil, l.taxable_amount, l.igst_amount, l.cgst_amount, l.sgst_amount, -1)

    itc_rcm, itc_other, itc_reversed = zero(), zero(), zero()
    for b in db.query(VendorInvoice).filter(VendorInvoice.status == "posted", VendorInvoice.invoice_type != "opening",
                                            VendorInvoice.invoice_date >= start, VendorInvoice.invoice_date <= end).all():
        if b.is_reverse_charge:
            add(inward_rcm, b.invoice_amount, b.igst_amount, b.cgst_amount, b.sgst_amount)
            add(itc_rcm, 0, b.igst_amount, b.cgst_amount, b.sgst_amount)
        else:
            add(itc_other, 0, b.igst_amount, b.cgst_amount, b.sgst_amount)
    for n in db.query(PartyNote).filter(PartyNote.note_type == "debit_note", PartyNote.status == "posted",
                                        PartyNote.note_date >= start, PartyNote.note_date <= end).all():
        add(itc_reversed, 0, n.igst_amount, n.cgst_amount, n.sgst_amount)
    net_itc = zero()
    add(net_itc, 0, itc_rcm["igst"] + itc_other["igst"] - itc_reversed["igst"], itc_rcm["cgst"] + itc_other["cgst"] - itc_reversed["cgst"],
        itc_rcm["sgst"] + itc_other["sgst"] - itc_reversed["sgst"])
    return {
        "period": period,
        "outward_taxable_3_1_a": outward_taxable, "outward_nil_rated_3_1_c": outward_nil, "inward_reverse_charge_3_1_d": inward_rcm,
        "itc_reverse_charge_4_a_3": itc_rcm, "itc_all_other_4_a_5": itc_other, "itc_reversed_4_b": itc_reversed, "net_itc_4_c": net_itc,
        "note": "Input credit here is what the books claim. Match it with GSTR-2B on the portal before filing — only ITC appearing in 2B can be claimed.",
    }


def _ledger_balances(db: Session, as_of: date) -> dict:
    roles = ["cgst_input", "sgst_input", "igst_input", "cgst_output", "sgst_output", "igst_output", "rcm_payable"]
    ids = {r: ledger_id_for(db, r) for r in roles}
    totals = account_totals(db, to_date=as_of, account_ids=list(ids.values()))
    bal = {}
    for role, gl_id in ids.items():
        d, c = totals.get(gl_id, (0.0, 0.0))
        bal[role] = _r(d - c) if role.endswith("_input") else _r(c - d)
    return {"ids": ids, "balances": bal}


def compute_setoff(db: Session, *, period: str) -> dict:
    """Utilises input credit against output tax as at period end, in the
    order CGST Rule 88A requires:
      1. IGST credit -> IGST liability, then CGST, then SGST liability
      2. CGST credit -> CGST liability, then IGST liability
      3. SGST credit -> SGST liability, then IGST liability
    CGST credit never pays SGST and vice versa. Reverse-charge tax is paid in
    cash only — input credit can't pay it."""
    _, end = fiscal.period_bounds(period)
    info = _ledger_balances(db, end)
    b = info["balances"]
    credit = {"igst": max(b["igst_input"], 0), "cgst": max(b["cgst_input"], 0), "sgst": max(b["sgst_input"], 0)}
    liability = {"igst": max(b["igst_output"], 0), "cgst": max(b["cgst_output"], 0), "sgst": max(b["sgst_output"], 0)}
    steps = []

    def use(src, dst):
        amt = _r(min(credit[src], liability[dst]))
        if amt > 0:
            credit[src] = _r(credit[src] - amt)
            liability[dst] = _r(liability[dst] - amt)
            steps.append({"credit_of": src.upper(), "paid_against": dst.upper(), "amount": amt})

    for dst in ("igst", "cgst", "sgst"):
        use("igst", dst)
    for dst in ("cgst", "igst"):
        use("cgst", dst)
    for dst in ("sgst", "igst"):
        use("sgst", dst)
    return {
        "period": period, "as_of": end, "ledger_balances": b, "utilisation": steps,
        "cash_payable": {"igst": liability["igst"], "cgst": liability["cgst"], "sgst": liability["sgst"], "rcm": max(b["rcm_payable"], 0)},
        "credit_carried_forward": credit, "ledger_ids": info["ids"],
        "already_posted": _existing_setoff(db, period) is not None,
    }


def _existing_setoff(db: Session, period: str):
    return db.query(JournalEntry).filter(JournalEntry.posting_type == "gst_setoff", JournalEntry.accounting_period == period,
                                         JournalEntry.status == "posted",
                                         # its reversal keeps posting_type 'gst_setoff' but isn't a set-off
                                         JournalEntry.reverses_journal_entry_id.is_(None)).first()


def post_setoff(db: Session, *, period: str, user_id: int) -> JournalEntry:
    from app.modules.accounts.service import post_journal_entry

    existing = _existing_setoff(db, period)
    if existing:
        raise ValueError(f"The GST set-off for {period} is already posted ({existing.entry_number}). Reverse it first to redo it.")
    calc = compute_setoff(db, period=period)
    if not calc["utilisation"]:
        raise ValueError(f"Nothing to set off for {period} — there's no input credit and output tax to adjust against each other.")
    ids = calc["ledger_ids"]
    debit_out: dict[str, float] = {}
    credit_in: dict[str, float] = {}
    for s in calc["utilisation"]:
        debit_out[s["paid_against"].lower()] = debit_out.get(s["paid_against"].lower(), 0) + s["amount"]
        credit_in[s["credit_of"].lower()] = credit_in.get(s["credit_of"].lower(), 0) + s["amount"]
    lines = [{"gl_account_id": ids[f"{t}_output"], "debit_amount": _r(a), "remarks": f"{t.upper()} output set off {period}"} for t, a in debit_out.items()]
    lines += [{"gl_account_id": ids[f"{t}_input"], "credit_amount": _r(a), "remarks": f"{t.upper()} credit utilised {period}"} for t, a in credit_in.items()]
    return post_journal_entry(db, posting_date=calc["as_of"], lines=lines, posting_type="gst_setoff",
                              description=f"GST input credit set off against output tax — {period}", created_by_id=user_id)
