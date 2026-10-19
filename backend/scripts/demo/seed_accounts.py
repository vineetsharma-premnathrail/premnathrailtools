"""Finance & Accounting: bank ledgers + accounts, internal orders, journals, purchase & sales invoices, payments, notes, fixed assets, closing stock, bank reconciliation, period close.

Maker-checker throughout, as the app enforces: the DEMO Accountant records
(invoices, journals, notes) and the DEMO Accounts Manager (Finance Manager)
approves / posts and makes the payments. Indian standards per the finance
decisions: GST split CGST+SGST (Haryana) vs IGST (other states), FY voucher
series, periodic inventory (closing stock posted at month end and
auto-reversed next day), no TDS, e-invoice / e-way bill = captured fields
only. The chart of accounts is the app's own seeded chart (reused); only the
DEMO bank / cash ledgers are added.

Timeline (relative to today): the month before last ("closed month") is fully
posted, reconciled and CLOSED; last month is open with unpaid / part-paid
bills, an accrual and a draft closing-stock valuation; this month has the
pending / draft / rejected documents. No opening-balance voucher is posted
(it is a one-time company action) — partners' capital is brought in by a
journal instead.

Links: vendor invoices against `demo.data["purchase_orders"]` (needs an
accepted GRN; otherwise noted and skipped), sales invoices against
`demo.data["sales_orders"]` (reference_type 'sales_order'); without those
keys the direct vouchers below still give every screen a mix.

demo.data keys set here:

  bank_accounts    dict key (hdfc, icici, petty_cash) -> bank account dict.
  internal_orders  dict code -> internal order dict.
  vendor_invoices  dict label -> purchase invoice dict (paid, overdue,
                   capital_paid, part_paid, not_due, pending_approval (waits
                   for an approver — you can post it), recorded, rejected,
                   po_<n> when PO-linked).
  ar_invoices      dict label -> sales invoice dict (collected, part_collected,
                   overdue, pending_approval, draft, so_<n> when SO-linked).
  journals         dict label -> journal entry dict (capital, accrual,
                   pending_approval, draft, rejected).
  payments         dict label -> payment voucher dict.
  fixed_assets     dict asset code -> fixed asset dict.
  closed_period    "YYYY-MM" of the month closed here.
"""
from __future__ import annotations

from datetime import date, timedelta

from demo._common import LABEL


# ── Small helpers ─────────────────────────────────────────────────────────

def _maker(demo):
    return demo.data["people"]["accountant"]


def _checker(demo):
    return demo.data["people"]["accounts_manager"]


def _month_start(d: date, back: int) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        y, m = y - 1, m + 12
    return date(y, m, 1)


def _periods(demo) -> tuple[date, date, date]:
    """(closed month start, last month start, this month start)."""
    t = demo.today
    return _month_start(t, 2), _month_start(t, 1), _month_start(t, 0)


def _day(month_start: date, day: int, demo=None) -> date:
    d = month_start.replace(day=min(day, 28))
    return min(d, demo.today) if demo else d


def _gl(demo, code: str) -> int:
    from app.modules.accounts.models.gl_account import GLAccount
    row = demo.db.query(GLAccount).filter(GLAccount.code == code).first()
    if not row:
        raise SystemExit(f"accounts seeder: ledger {code} is missing from the chart of accounts — "
                         "seed the standard chart (Finance > Masters > Ledgers) first.")
    return row.id


def _item(demo, code):
    return demo.data["items"][code]


def _line(demo, code, qty, rate=None, gst=18, gl=None):
    it = _item(demo, code)
    return {"description": it["name"], "store_item_id": it["id"], "hsn_sac_code": it.get("hsn_sac_code"), "quantity": qty,
            "uom": it["unit"], "rate": rate if rate is not None else it["rate"], "gst_rate": gst, "gl_account_id": gl}


def _detail(body) -> str:
    return body.get("detail") if isinstance(body, dict) else str(body)[:300]


def _decide(demo, record: dict, user, decision: str, comment: str):
    """Decide a record's live approval through Organization › My Approvals."""
    req_id = record.get("approval_request_id")
    if not req_id:
        demo.note("accounts", f"no approval request on {record.get('invoice_number') or record.get('entry_number')} — decision skipped")
        return
    demo.call("POST", f"/approvals/requests/{req_id}/decide", user, json={"decision": decision, "comment": comment})


def _ids(value) -> list[int]:
    """Record ids out of whatever shape an upstream seeder registered."""
    if not value:
        return []
    rows = value.values() if isinstance(value, dict) else value
    out = []
    for r in rows:
        if isinstance(r, int):
            out.append(r)
        elif isinstance(r, dict) and isinstance(r.get("id"), int):
            out.append(r["id"])
        elif hasattr(r, "id"):
            out.append(r.id)
    return out


# ── Masters ───────────────────────────────────────────────────────────────

BANK_LEDGERS = {  # key: (code, ledger name, group code, kind, bank name, account no, branch, ifsc)
    "hdfc": ("DEMO-1121", f"{LABEL} HDFC Bank – Current A/c", "G-BANK", "bank", f"{LABEL} HDFC Bank", "50200099887761",
             "Sector 16, Faridabad", "HDFC0000279"),
    "icici": ("DEMO-1122", f"{LABEL} ICICI Bank – Collection A/c", "G-BANK", "bank", f"{LABEL} ICICI Bank", "629905501234",
              "Connaught Place, New Delhi", "ICIC0006299"),
    "petty_cash": ("DEMO-1111", f"{LABEL} Petty Cash – Unit 1", "G-CASH", "cash", f"{LABEL} Petty Cash – Unit 1", None, None, None),
}


def seed_bank_accounts(demo) -> None:
    """A ledger per bank / cash account (each needs its own), then the accounts."""
    from app.modules.accounts.models.account_group import AccountGroup
    from app.modules.accounts.models.bank_account import BankAccount
    from app.modules.accounts.models.gl_account import GLAccount

    fm = _checker(demo)
    out = {}
    for key, (code, ledger, group, kind, bank, acc_no, branch, ifsc) in BANK_LEDGERS.items():
        gl = demo.db.query(GLAccount).filter(GLAccount.code == code).first()
        gl_id = gl.id if gl else demo.call("POST", "/accounts/gl-accounts", fm, json={
            "code": code, "name": ledger, "account_type": "asset",
            "group_id": demo.db.query(AccountGroup).filter(AccountGroup.code == group).one().id})["id"]
        row = demo.db.query(BankAccount).filter(BankAccount.gl_account_id == gl_id).first()
        if row:
            out[key] = {"id": row.id, "bank_name": row.bank_name, "gl_account_id": gl_id}
            continue
        out[key] = demo.call("POST", "/accounts/bank-accounts", fm, json={
            "account_kind": kind, "bank_name": bank, "account_no": acc_no, "account_holder_name": f"{LABEL} Premnath Rail Tools",
            "branch_name": branch, "ifsc_code": ifsc, "gl_account_id": gl_id})
    demo.data["bank_accounts"] = out
    demo.note("accounts", f"bank & cash: {', '.join(v['bank_name'] for v in out.values())} (own ledgers under Bank Accounts / Cash-in-Hand)")


INTERNAL_ORDERS = [  # code, name, type, budget, ledger code, description
    ("DEMO-IO-CAPEX-01", f"{LABEL} CNC plasma cutting line", "capital", 2500000, "1010", "Capex: plasma cutting machine, fume extraction, foundation."),
    ("DEMO-IO-MNT-01", f"{LABEL} EOT crane gearbox overhaul", "maintenance", 350000, "5220", "Bay-2 10 t EOT crane — gearbox and brake overhaul."),
    ("DEMO-IO-IT-01", f"{LABEL} Tally → Portal finance migration", "it", 180000, "5230", "Data migration, training and parallel run."),
    ("DEMO-IO-TRG-01", f"{LABEL} Welder certification (ISO 9606)", "training", 120000, "5230", "Coded-welder certification for 8 welders."),
]


def seed_internal_orders(demo) -> None:
    """Internal orders (capex / maintenance / IT / training) to collect costs on."""
    from app.modules.accounts.models.internal_order import InternalOrder

    fm, (closed, _last, _this) = _checker(demo), _periods(demo)
    out = {}
    for code, name, otype, budget, gl, desc in INTERNAL_ORDERS:
        row = demo.db.query(InternalOrder).filter(InternalOrder.code == code).first()
        out[code] = {"id": row.id, "code": code} if row else demo.call("POST", "/accounts/internal-orders", fm, json={
            "code": code, "name": name, "order_type": otype, "budgeted_amount": budget, "gl_account_id": _gl(demo, gl),
            "start_date": closed.isoformat(), "end_date": (closed + timedelta(days=200)).isoformat(), "description": f"{LABEL} {desc}"})
    demo.data["internal_orders"] = out
    demo.note("accounts", f"{len(out)} internal orders")


# ── Journals ──────────────────────────────────────────────────────────────

def _journal(demo, posting_date, description, lines, posting_type="adjustment", auto_reverse_on=None):
    return demo.call("POST", "/accounts/journal-entries", _maker(demo), json={
        "posting_date": posting_date.isoformat(), "description": f"{LABEL} {description}", "posting_type": posting_type,
        "auto_reverse_on": auto_reverse_on.isoformat() if auto_reverse_on else None, "lines": lines})


def _dr(gl, amt, **kw):
    return {"gl_account_id": gl, "debit_amount": amt, **kw}


def _cr(gl, amt, **kw):
    return {"gl_account_id": gl, "credit_amount": amt, **kw}


def seed_capital_journal(demo) -> None:
    """Partners' capital brought into the bank and petty cash (posted, maker-checker)."""
    closed, _l, _t = _periods(demo)
    b = demo.data["bank_accounts"]
    je = _journal(demo, closed, "Partners' capital introduced for FY operations", [
        _dr(b["hdfc"]["gl_account_id"], 7500000, remarks="Capital — HDFC current"),
        _dr(b["icici"]["gl_account_id"], 1000000, remarks="Capital — ICICI collection"),
        _dr(b["petty_cash"]["gl_account_id"], 50000, remarks="Capital — petty cash float"),
        _cr(_gl(demo, "3000"), 8550000, remarks="Partners' capital"),
    ])
    demo.call("POST", f"/accounts/journal-entries/{je['id']}/submit", _maker(demo))
    demo.data.setdefault("journals", {})["capital"] = demo.call("POST", f"/accounts/journal-entries/{je['id']}/post", _checker(demo))


def seed_journals(demo) -> None:
    """Accrual with auto-reversal (posted), provision (pending approval), IO accrual (draft), write-off (rejected)."""
    _c, last, this = _periods(demo)
    out = demo.data.setdefault("journals", {})
    payable, power, admin = _gl(demo, "2070"), _gl(demo, "5210"), _gl(demo, "5230")
    month_end = this - timedelta(days=1)
    je = _journal(demo, month_end, f"Electricity accrual {last:%b-%Y} — DHBVN bill not yet received", [
        _dr(power, 192000, remarks="Unit 1 power, est. 21,300 kWh"), _cr(payable, 192000, remarks="DHBVN accrual")],
        posting_type="accrual", auto_reverse_on=this)
    out["accrual"] = demo.call("POST", f"/accounts/journal-entries/{je['id']}/post", _checker(demo))

    je = _journal(demo, _day(this, 5, demo), "Provision for statutory audit fee (half-year)", [
        _dr(admin, 150000, remarks="Goel & Associates — H1 fee"), _cr(payable, 150000)])
    out["pending_approval"] = demo.call("POST", f"/accounts/journal-entries/{je['id']}/submit", _maker(demo))

    io = (demo.data.get("internal_orders") or {}).get("DEMO-IO-MNT-01", {}).get("id")
    out["draft"] = _journal(demo, _day(this, 6, demo), "Crane gearbox overhaul — work done, bill awaited", [
        _dr(_gl(demo, "5220"), 86500, internal_order_id=io, remarks="Bay-2 crane gearbox"), _cr(payable, 86500)])

    cust = (demo.data.get("customers") or {}).get("ircon")
    if cust:
        je = _journal(demo, _day(this, 6, demo), "Write-off of short-paid freight on an old IRCON bill", [
            _dr(_gl(demo, "5600"), 4250, remarks="Short payment"), _cr(_gl(demo, "1130"), 4250, customer_id=cust["id"])])
        je = demo.call("POST", f"/accounts/journal-entries/{je['id']}/submit", _maker(demo))
        _decide(demo, je, _checker(demo), "reject", "No invoice to write off against — raise a credit note on the bill instead.")
        out["rejected"] = demo.call("GET", f"/accounts/journal-entries/{je['id']}", _checker(demo))
    demo.note("accounts", "journals: capital + accrual (auto-reversed) posted, 1 pending approval, 1 draft (on an internal order), 1 rejected")


# ── Purchase invoices ─────────────────────────────────────────────────────

def _vendor_invoice(demo, vendor_key, number, inv_date, lines, narration):
    v = demo.data["vendors"][vendor_key]
    return demo.call("POST", "/accounts/vendor-invoices", _maker(demo), json={
        "vendor_id": v["id"], "invoice_number": number, "invoice_date": inv_date.isoformat(),
        "narration": f"{LABEL} {narration}", "lines": lines})


def _post_invoice(demo, inv):
    demo.call("POST", f"/accounts/vendor-invoices/{inv['id']}/submit", _maker(demo))
    return demo.call("POST", f"/accounts/vendor-invoices/{inv['id']}/post", _checker(demo))


def seed_vendor_invoices(demo) -> None:
    """Direct bills at every stage: paid, overdue, capital (paid), part-paid, not due, pending approval, recorded, rejected."""
    closed, last, this = _periods(demo)
    out = demo.data.setdefault("vendor_invoices", {})
    out["paid"] = _post_invoice(demo, _vendor_invoice(demo, "steel", "DEMO/STL/2026/0412", _day(closed, 5), [
        _line(demo, "DEMO-RM-MS-PLATE-10", 2000), _line(demo, "DEMO-RM-ISMC-100", 1500)], "MS plate + ISMC for RRV chassis batch 3"))
    out["capital_paid"] = _post_invoice(demo, _vendor_invoice(demo, "electricals", "DEMO/REC/CAP/031", _day(closed, 8), [
        {"description": f"{LABEL} CNC plasma cutting machine 2500 x 6000 with 200 A source", "hsn_sac_code": "8456",
         "quantity": 1, "uom": "NOS", "rate": 1850000, "gst_rate": 18, "gl_account_id": _gl(demo, "1010")}], "Capex — plasma cutting line"))
    out["overdue"] = _post_invoice(demo, _vendor_invoice(demo, "bearings", "DEMO/BBD/1187", _day(closed, 20), [
        _line(demo, "DEMO-MEC-BRG-22216", 8)], "Spherical roller bearings for guide-wheel assemblies"))
    out["part_paid"] = _post_invoice(demo, _vendor_invoice(demo, "hydraulics", "DEMO/HSF/26-27/0219", _day(last, 10), [
        _line(demo, "DEMO-HYD-SEAL-KIT-63", 10), _line(demo, "DEMO-HYD-HOSE-12", 100), _line(demo, "DEMO-HYD-DCV-43", 4)],
        "Hydraulic seal kits, hose and DCVs"))
    out["not_due"] = _post_invoice(demo, _vendor_invoice(demo, "engines", "DEMO/PEI/MH/7781", _day(last, 22), [
        _line(demo, "DEMO-MEC-ENGINE-74KW", 1)], "Diesel engine 74 kW for RRV-8W unit 4 (inter-state — IGST)"))
    inv = _vendor_invoice(demo, "hydraulics", "DEMO/HSF/26-27/0247", _day(this, 3, demo), [_line(demo, "DEMO-HYD-OIL-68", 420)],
                          "Hydraulic oil ISO VG 68 — 2 barrels")
    out["pending_approval"] = demo.call("POST", f"/accounts/vendor-invoices/{inv['id']}/submit", _maker(demo))
    out["recorded"] = _vendor_invoice(demo, "electricals", "DEMO/REC/26-27/0566", _day(this, 6, demo), [
        _line(demo, "DEMO-ELE-RELAY-24V", 40), _line(demo, "DEMO-ELE-PROX-M18", 12)], "Relays and proximity sensors for panel PLC-04")
    inv = _vendor_invoice(demo, "bearings", "DEMO/BBD/1240", _day(this, 4, demo), [_line(demo, "DEMO-MEC-BRG-22216", 4, rate=6850)],
                          "Bearings — rate above the agreed price")
    inv = demo.call("POST", f"/accounts/vendor-invoices/{inv['id']}/submit", _maker(demo))
    _decide(demo, inv, _checker(demo), "reject", "Rate ₹6,850 is above the agreed ₹6,200 — ask the vendor for a revised bill.")
    out["rejected"] = demo.call("GET", f"/accounts/vendor-invoices/{inv['id']}", _checker(demo))
    demo.note("accounts", "purchase invoices: 5 posted (paid / capital / overdue / part-paid / not due, CGST+SGST and IGST), "
                          "1 pending approval, 1 recorded, 1 rejected")


def seed_po_invoices(demo) -> None:
    """Bills against the P2P seeder's purchase orders (3-way match on the accepted GRN qty)."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

    po_ids = _ids(demo.data.get("purchase_orders"))
    if not po_ids:
        demo.note("accounts", "no demo.data['purchase_orders'] (p2p seeder not run) — PO-matched invoices skipped, direct invoices only")
        return
    out = demo.data.setdefault("vendor_invoices", {})
    n = 0
    for po_id in po_ids:
        po = demo.db.get(P2PPurchaseOrder, po_id)
        grns = demo.db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id == po_id, P2PGoodsReceipt.status == "completed").all()
        accepted: dict[int, float] = {}
        for g in grns:
            for it in g.items:
                if it.po_item_id and (it.accepted_quantity or 0) > 0:
                    accepted[it.po_item_id] = accepted.get(it.po_item_id, 0) + float(it.accepted_quantity)
        if not po or not accepted:
            demo.note("accounts", f"PO {po.po_number if po else po_id}: nothing accepted on a completed GRN yet — no invoice booked")
            continue
        lines = []
        for item_id, qty in accepted.items():
            pi = demo.db.get(P2PPurchaseOrderItem, item_id)
            lines.append({"description": pi.item_name, "store_item_id": getattr(pi, "store_item_id", None), "quantity": qty,
                          "uom": pi.unit, "rate": pi.unit_price or 0, "gst_rate": pi.tax_rate if pi.tax_rate is not None else 18,
                          "po_item_id": pi.id})
        inv_date = max(g.created_at.date() if getattr(g, "created_at", None) else demo.today for g in grns)
        status, inv = demo.try_call("POST", "/accounts/vendor-invoices", _maker(demo), json={
            "purchase_order_id": po_id, "invoice_number": f"DEMO/{po.po_number}/INV", "invoice_date": min(inv_date, demo.today).isoformat(),
            "narration": f"{LABEL} Bill against {po.po_number}", "lines": lines})
        if status >= 400:
            demo.note("accounts", f"PO invoice for {po.po_number} not booked: {_detail(inv)}")
            continue
        n += 1
        # First PO bill goes all the way (posted); the rest wait for approval.
        if n == 1 and inv["matching_status"] in ("matched", "not_applicable"):
            out[f"po_{n}"] = _post_invoice(demo, inv)
        else:
            out[f"po_{n}"] = demo.call("POST", f"/accounts/vendor-invoices/{inv['id']}/submit", _maker(demo))
    demo.note("accounts", f"{n} purchase invoice(s) 3-way matched against demo POs/GRNs")


def seed_debit_note(demo) -> None:
    """Debit note to the hydraulics vendor for 2 defective seal kits (posted)."""
    inv = (demo.data.get("vendor_invoices") or {}).get("part_paid")
    if not inv:
        return
    note = demo.call("POST", "/accounts/notes", _maker(demo), json={
        "note_type": "debit_note", "note_date": (date.fromisoformat(inv["invoice_date"]) + timedelta(days=6)).isoformat(),
        "reason": "return", "vendor_invoice_id": inv["id"], "narration": f"{LABEL} 2 seal kits rejected at incoming inspection (NCR)",
        "lines": [_line(demo, "DEMO-HYD-SEAL-KIT-63", 2)]})
    demo.call("POST", f"/accounts/notes/{note['id']}/submit", _maker(demo))
    demo.data["debit_note"] = demo.call("POST", f"/accounts/notes/{note['id']}/post", _checker(demo))
    demo.note("accounts", f"debit note {demo.data['debit_note'].get('note_number')} posted against {inv['invoice_number']}")


# ── Sales invoices ────────────────────────────────────────────────────────

def _ar(demo, cust_key, inv_date, lines, narration, **extra):
    c = demo.data["customers"][cust_key]
    return demo.call("POST", "/accounts/ar-transactions", _maker(demo), json={
        "customer_id": c["id"], "invoice_date": inv_date.isoformat(), "narration": f"{LABEL} {narration}", "lines": lines, **extra})


def _post_ar(demo, inv):
    demo.call("POST", f"/accounts/ar-transactions/{inv['id']}/submit", _maker(demo))
    return demo.call("POST", f"/accounts/ar-transactions/{inv['id']}/post", _checker(demo))


def _sale(desc, hsn, qty, rate, uom="NOS", gst=18):
    return {"description": f"{LABEL} {desc}", "hsn_sac_code": hsn, "quantity": qty, "uom": uom, "rate": rate, "gst_rate": gst}


def seed_ar_invoices(demo) -> None:
    """Sales invoices: collected, part-collected (with e-invoice / e-way bill), overdue, pending approval, draft."""
    closed, last, this = _periods(demo)
    out = demo.data.setdefault("ar_invoices", {})
    out["overdue"] = _post_ar(demo, _ar(demo, "rvnl", _day(closed, 3), [
        _sale("Track Inspection Car TIC-01 — milestone 1 (design approval, 20%)", "8606", 1, 2400000)],
        "Milestone billing — design approval", customer_po_number="DEMO/RVNL/CPM/TIC/07"))
    out["collected"] = _post_ar(demo, _ar(demo, "northern_railway", _day(closed, 10), [
        _sale("Hydraulic Re-railing Equipment 150 t (HRE-150), complete set", "8425", 2, 1850000)],
        "Supply against NR Lucknow PO — 2 sets HRE-150", customer_po_number="DEMO/NR/LKO/MECH/2026/118",
        customer_po_date=(closed - timedelta(days=40)).isoformat()))
    inv = _post_ar(demo, _ar(demo, "dmrc", _day(last, 5), [
        _sale("Rail grinding stone 150 mm", "6804", 150, 5200), _sale("Return line filter element 10 micron", "8421", 40, 2350)],
        "Spares for DMRC rail grinding machine", customer_po_number="DEMO/DMRC/TRK/SP/552", vehicle_no="HR51 AB 1234"))
    out["part_collected"] = demo.call("PATCH", f"/accounts/ar-transactions/{inv['id']}/e-invoice", _maker(demo), json={
        "irn": ("d3m0" * 16), "ack_no": "112610090000417", "ack_date": _day(last, 5).isoformat(),
        "eway_bill_no": "331009876512", "eway_bill_date": _day(last, 5).isoformat(), "vehicle_no": "HR51 AB 1234"})
    inv = _ar(demo, "lt_metro", _day(this, 2, demo), [_sale("Rail Grinding Machine RGM-16 — AMC Q3 (service)", "998719", 1, 680000)],
              "Quarterly AMC — RGM-16 at Uppal depot")
    out["pending_approval"] = demo.call("POST", f"/accounts/ar-transactions/{inv['id']}/submit", _maker(demo))
    out["draft"] = _ar(demo, "ircon", _day(this, 6, demo), [_sale("Carriage Wagon CW-BOX — material wagon", "8606", 2, 1460000)],
                       "Material wagons for IRCON project — draft, awaiting dispatch")
    demo.note("accounts", "sales invoices: 3 posted (collected / part-collected with IRN + e-way bill / overdue), 1 pending approval, 1 draft")


def seed_so_invoices(demo) -> None:
    """Sales invoice for each demo sales order (lines copied from the SO)."""
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine

    so_ids = _ids(demo.data.get("sales_orders"))
    if not so_ids:
        demo.note("accounts", "no demo.data['sales_orders'] (sales seeder not run) — SO-linked invoices skipped")
        return
    out = demo.data.setdefault("ar_invoices", {})
    for n, so_id in enumerate(so_ids[:2], 1):
        so = demo.db.get(SalesOrder, so_id)
        lines = demo.db.query(SalesOrderLine).filter(SalesOrderLine.so_id == so_id).order_by(SalesOrderLine.line_number).all() if so else []
        if not lines:
            demo.note("accounts", f"sales order #{so_id} has no lines — no invoice")
            continue
        status, inv = demo.try_call("POST", "/accounts/ar-transactions", _maker(demo), json={
            "customer_id": so.customer_id, "invoice_date": demo.today.isoformat(), "reference_type": "sales_order", "reference_id": so.id,
            "customer_po_number": so.customer_po_number, "customer_po_date": so.customer_po_date.isoformat() if so.customer_po_date else None,
            "narration": f"{LABEL} Invoice against {so.so_number or f'SO #{so.id}'}",
            "lines": [{"description": l.description[:200], "hsn_sac_code": l.hsn_sac_code, "quantity": float(l.quantity), "uom": l.uom,
                       "rate": float(l.unit_price), "discount_amount": float(l.discount_amount or 0), "gst_rate": float(l.gst_rate)} for l in lines]})
        if status >= 400:
            demo.note("accounts", f"invoice for {so.so_number}: {_detail(inv)}")
            continue
        out[f"so_{n}"] = _post_ar(demo, inv) if n == 1 else demo.call("POST", f"/accounts/ar-transactions/{inv['id']}/submit", _maker(demo))
    demo.note("accounts", f"sales invoices against {min(len(so_ids), 2)} demo sales order(s)")


# ── Payments & receipts ───────────────────────────────────────────────────

def _voucher(demo, label, **payload):
    payload["payment_date"] = payload["payment_date"].isoformat()
    if payload.get("narration"):
        payload["narration"] = f"{LABEL} {payload['narration']}"
    v = demo.call("POST", "/accounts/payments", _checker(demo), json=payload)
    demo.data.setdefault("payments", {})[label] = v
    return v


def seed_payments(demo) -> None:
    """Vendor payments (full / part), customer receipts (full / part), expense, petty cash, contra, interest receipt."""
    closed, last, _this = _periods(demo)
    b, vi, ar = demo.data["bank_accounts"], demo.data["vendor_invoices"], demo.data["ar_invoices"]
    hdfc, icici, cash = b["hdfc"]["id"], b["icici"]["id"], b["petty_cash"]["id"]

    def pay(label, inv, amount, when, mode, **kw):
        return _voucher(demo, label, payment_type="vendor", bank_account_id=hdfc, amount=amount, payment_mode=mode, payment_date=when,
                        vendor_id=inv["vendor_id"], allocations=[{"target_type": "vendor_invoice", "target_id": inv["id"], "amount": amount}],
                        narration=f"Payment of {inv['invoice_number']}", **kw)

    pay("steel_full", vi["paid"], vi["paid"]["invoice_total"], _day(closed, 25), "neft", reference_no="DEMO-UTR-HDFCN26082500417")
    pay("capex_full", vi["capital_paid"], vi["capital_paid"]["invoice_total"], _day(closed, 27), "rtgs", reference_no="DEMO-UTR-HDFCR26082700093")
    pay("hydraulics_part", vi["part_paid"], 50000, _day(last, 26), "cheque", cheque_number="000457", cheque_date=_day(last, 26).isoformat())

    for label, key, amount, when in (("nr_receipt", "collected", None, _day(closed, 28)), ("dmrc_part", "part_collected", 500000, _day(last, 24))):
        inv = ar[key]
        amt = amount or inv["total_amount"]
        demo.call("POST", f"/accounts/ar-transactions/{inv['id']}/collect", _checker(demo), json={
            "bank_account_id": icici, "amount": amt, "payment_mode": "rtgs", "payment_date": when.isoformat()})
        demo.data.setdefault("payments", {})[label] = {"ar_invoice": inv.get("invoice_number"), "amount": amt}
    so_inv = ar.get("so_1")
    if so_inv and so_inv.get("status") == "posted":  # advance-style part receipt against the SO invoice
        amt = round(so_inv["total_amount"] * 0.3, 2)
        demo.call("POST", f"/accounts/ar-transactions/{so_inv['id']}/collect", _checker(demo), json={
            "bank_account_id": icici, "amount": amt, "payment_mode": "rtgs", "payment_date": demo.today.isoformat()})
        demo.data["payments"]["so_part"] = {"ar_invoice": so_inv.get("invoice_number"), "amount": amt}

    _voucher(demo, "electricity", payment_type="expense", bank_account_id=hdfc, amount=184500, payment_mode="neft", payment_date=_day(closed, 18),
             lines=[{"gl_account_id": _gl(demo, "5210"), "amount": 184500, "remarks": "DHBVN bill — Unit 1, HT connection"}],
             reference_no="DEMO-DHBVN-0826", narration="Electricity bill (DHBVN)")
    _voucher(demo, "petty_withdrawal", payment_type="contra", bank_account_id=hdfc, counter_bank_account_id=cash, amount=40000,
             payment_mode="cheque", cheque_number="000452", cheque_date=_day(closed, 12).isoformat(), payment_date=_day(closed, 12),
             narration="Self cheque — petty cash top-up")
    _voucher(demo, "petty_expense", payment_type="expense", bank_account_id=cash, amount=3850, payment_mode="cash", payment_date=_day(last, 12),
             lines=[{"gl_account_id": _gl(demo, "5230"), "amount": 3850, "remarks": "Courier (DTDC) and stationery"}],
             narration="Petty cash — courier & stationery")
    _voucher(demo, "fd_interest", payment_type="other_receipt", bank_account_id=hdfc, amount=12450, payment_mode="neft", payment_date=_day(closed, 28),
             lines=[{"gl_account_id": _gl(demo, "4110"), "amount": 12450, "remarks": "Interest on sweep FD"}], narration="FD interest credited")
    _voucher(demo, "bank_charges", payment_type="expense", bank_account_id=hdfc, amount=1180, payment_mode="neft", payment_date=_day(last, 28),
             lines=[{"gl_account_id": _gl(demo, "5500"), "amount": 1180, "remarks": "RTGS/NEFT charges incl. GST"}], narration="Bank charges")
    demo.note("accounts", f"{len(demo.data['payments'])} payment / receipt vouchers (vendor, customer, expense, contra, petty cash, interest)")


# ── Fixed assets, closing stock, reconciliation, period close ─────────────

def seed_fixed_assets(demo) -> None:
    """Asset register (one from the capex bill) and the closed month's depreciation run."""
    from app.modules.accounts.models.fixed_asset import FixedAsset

    closed, _l, _t = _periods(demo)
    fy_start = date(closed.year if closed.month >= 4 else closed.year - 1, 4, 1)
    cap = (demo.data.get("vendor_invoices") or {}).get("capital_paid")
    rows = [
        ("DEMO-FA-PM-001", f"{LABEL} CNC plasma cutting machine 2500 x 6000", "1010", cap["invoice_amount"] if cap else 1850000,
         _day(closed, 8), _day(closed, 14), "slm", 180, None, 0, cap["id"] if cap else None, "Unit 1 – fabrication bay"),
        ("DEMO-FA-PM-002", f"{LABEL} EOT crane 10 t, bay 2", "1010", 1480000, fy_start, fy_start + timedelta(days=14), "slm", 180, None, 0, None,
         "Unit 1 – assembly bay 2"),
        ("DEMO-FA-FF-001", f"{LABEL} Office furniture – admin block", "1020", 325000, fy_start - timedelta(days=365), fy_start - timedelta(days=360),
         "wdv", None, 25.89, 42000, None, "Unit 1 – admin block"),
    ]
    out = {}
    for code, name, gl, cost, bought, used, method, life, wdv, opening, inv_id, loc in rows:
        row = demo.db.query(FixedAsset).filter(FixedAsset.asset_code == code).first()
        if row:
            out[code] = {"id": row.id, "asset_code": code}
            continue
        out[code] = demo.call("POST", "/accounts/fixed-assets", _checker(demo), json={
            "asset_code": code, "name": name, "asset_gl_account_id": _gl(demo, gl), "purchase_date": bought.isoformat(),
            "put_to_use_date": used.isoformat(), "cost": cost, "residual_value": round(cost * 0.05, 2), "depreciation_method": method,
            "useful_life_months": life, "wdv_rate_pct": wdv, "opening_accumulated_depreciation": opening, "vendor_invoice_id": inv_id,
            "location": loc, "description": f"{LABEL} asset (Companies Act Schedule II life)"})
    demo.data["fixed_assets"] = out
    period = f"{closed:%Y-%m}"
    status, body = demo.try_call("POST", "/accounts/fixed-assets/depreciation/runs", _checker(demo), json={"accounting_period": period})
    demo.note("accounts", f"{len(out)} fixed assets; depreciation {period}: " + ("posted" if status < 400 else f"skipped — {_detail(body)}"))


def seed_inventory_valuation(demo) -> None:
    """Periodic inventory: closed month's closing stock posted (auto-reverses), last month's left as a draft."""
    closed, last, _t = _periods(demo)
    fm = _checker(demo)
    for period, post in ((f"{closed:%Y-%m}", True), (f"{last:%Y-%m}", False)):
        status, val = demo.try_call("POST", "/accounts/inventory/valuations", fm, json={
            "accounting_period": period, "notes": f"{LABEL} closing stock from Store on-hand x moving-average / standard cost"})
        if status >= 400:
            demo.note("accounts", f"closing stock {period} skipped: {_detail(val)}")
            continue
        if post:
            val = demo.call("POST", f"/accounts/inventory/valuations/{val['id']}/post", fm)
        demo.note("accounts", f"closing stock {period}: {val.get('total_value', 0):,.0f} ({'posted' if post else 'draft'})")


def seed_bank_reconciliation(demo) -> None:
    """HDFC reconciled to the closed month's statement (completed); ICICI for last month in progress."""
    from app.modules.accounts.models.bank_account import BankAccount
    from app.modules.accounts.service import bank_book_balance, voucher_sides

    closed, last, this = _periods(demo)
    fm, b = _checker(demo), demo.data["bank_accounts"]
    stmt = (last - timedelta(days=1))
    acct = demo.db.get(BankAccount, b["hdfc"]["id"])
    sides = voucher_sides(demo.db, acct.id, as_of=stmt)
    # The bank has cleared everything except the self cheque (presented next month).
    clear = [s for s in sides if s["payment"].cheque_number != "000452"]
    pending = [s for s in sides if s not in clear]
    book = bank_book_balance(demo.db, acct, stmt)
    statement = round(book + sum(s["payment"].amount for s in pending if s["direction"] == "out")
                      - sum(s["payment"].amount for s in pending if s["direction"] == "in"), 2)
    rec = demo.call("POST", "/accounts/bank-reconciliations", fm, json={
        "bank_account_id": acct.id, "statement_date": stmt.isoformat(), "statement_balance": statement})
    if clear:
        demo.call("POST", f"/accounts/bank-reconciliations/{rec['id']}/reconcile-payments", fm, json={
            "payment_transaction_ids": sorted({s["payment"].id for s in clear}), "cleared_date": stmt.isoformat()})
    demo.call("POST", f"/accounts/bank-reconciliations/{rec['id']}/complete", fm)

    stmt2 = this - timedelta(days=1)
    acct2 = demo.db.get(BankAccount, b["icici"]["id"])
    demo.call("POST", "/accounts/bank-reconciliations", fm, json={
        "bank_account_id": acct2.id, "statement_date": stmt2.isoformat(),
        "statement_balance": round(bank_book_balance(demo.db, acct2, stmt2) - 590, 2)})  # ₹590 bank charges not yet booked
    demo.note("accounts", f"bank reconciliation: HDFC {stmt:%d-%b} completed (1 cheque outstanding), ICICI {stmt2:%d-%b} in progress (₹590 difference)")


def seed_period_close(demo) -> None:
    """Close the month before last (everything in it is posted)."""
    closed, _l, _t = _periods(demo)
    period = f"{closed:%Y-%m}"
    status, body = demo.try_call("POST", f"/accounts/period-close/{period}/close", _checker(demo),
                                 json={"notes": f"{LABEL} {closed:%b-%Y} closed after bank reconciliation and closing stock."})
    demo.data["closed_period"] = period if status < 400 else None
    demo.note("accounts", f"period {period}: " + ("closed" if status in (200, 201) else
                                                  "waiting for approval" if status == 202 else f"not closed — {_detail(body)}"))


# ── Entry point ──────────────────────────────────────────────────────────

def seed(demo) -> None:
    from app.modules.accounts.models.vendor_invoice import VendorInvoice

    if demo.db.query(VendorInvoice).filter(VendorInvoice.invoice_number == "DEMO/STL/2026/0412").first():
        demo.note("accounts", "finance demo data already there — nothing re-posted (vouchers can't be posted twice)")
        return
    seed_bank_accounts(demo)
    seed_internal_orders(demo)
    seed_capital_journal(demo)
    seed_vendor_invoices(demo)
    seed_po_invoices(demo)
    seed_debit_note(demo)
    seed_ar_invoices(demo)
    seed_so_invoices(demo)
    seed_payments(demo)
    seed_journals(demo)
    seed_fixed_assets(demo)
    seed_inventory_valuation(demo)
    seed_bank_reconciliation(demo)
    seed_period_close(demo)
