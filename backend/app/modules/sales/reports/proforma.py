"""Proforma invoice — the managed Word document of record `sales_proforma`
("Save & Edit in Word" primary; the PDF renders the Word document once one
exists). Same generic spec renderer as the order acknowledgement
(app/modules/quality/reports/render.py)."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_perform
from app.core.permission_words import action_word
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.sales import service as svc
from app.modules.sales.models.order import SalesOrder
from app.modules.sales.models.proforma import SalesProformaInvoice

PI_ENTITY = "sales_proforma"


def _d(v) -> str:
    return v.strftime("%d-%m-%Y") if v else "—"


def _num(v) -> str:
    return f"{float(v or 0):,.2f}"


def pi_spec(db: Session, pi: SalesProformaInvoice, so: SalesOrder) -> dict:
    from app.modules.accounts.services.gst import GST_STATE_CODES, company_gst_profile
    b = next((x for x in so.billing_lines if x.id == pi.billing_line_id), None)
    pct = f"{float(b.percent):g}%" if b else ""
    our_gstin, _ = company_gst_profile(db)
    pos = pi.place_of_supply_state_code or ""
    tax_cols = ["IGST"] if pi.interstate else ["CGST", "SGST"]
    rows = []
    for ln in pi.lines or []:
        taxes = [_num(ln["igst"])] if pi.interstate else [_num(ln["cgst"]), _num(ln["sgst"])]
        rows.append([str(ln["line_number"]), ln["description"], ln.get("hsn_sac_code") or "", f"{ln['gst_rate']:g}",
                     _num(ln["taxable"]), *taxes, _num(ln["total"])])
    totals = [("Taxable value", f"INR {_num(pi.taxable_amount)}")]
    if pi.interstate:
        totals.append(("IGST", f"INR {_num(pi.igst_amount)}"))
    else:
        totals += [("CGST", f"INR {_num(pi.cgst_amount)}"), ("SGST", f"INR {_num(pi.sgst_amount)}")]
    totals.append(("Amount payable (advance)", f"INR {_num(pi.total_amount)}"))
    widths = [0.3, 2.4, 0.7, 0.5, 1.0] + ([0.9] if pi.interstate else [0.8, 0.8]) + [1.0]
    return {
        "title": "PROFORMA INVOICE" + (" — CANCELLED" if pi.status == "cancelled" else ""),
        "number": pi.pi_number,
        "intro": (f"Request for the {pct} advance payment against your order {svc.po_number(so) or '—'} dated "
                  f"{_d(svc.po_date(so))} (our sales order {so.so_number}). This is not a tax invoice: the tax invoice "
                  f"for the advance / supply will be issued on receipt of payment as per GST rules."),
        "facts": [
            ("PI date", _d(pi.pi_date)), ("Valid until", _d(pi.valid_until)),
            ("Customer", so.customer_name), ("Customer GSTIN", so.customer_gstin),
            ("Billing address", so.billing_address), ("Our GSTIN", our_gstin),
            ("Place of supply", f"{pos} — {GST_STATE_CODES.get(pos, '')}" if pos else None),
            ("Sales order", so.so_number), ("Customer PO", svc.po_number(so)),
            ("Paying authority", so.paying_authority), ("Milestone", f"{pct} advance" + (f" — {b.description}" if b and b.description else "")),
            ("Order value (incl. GST)", f"INR {_num(so.grand_total)}"),
        ],
        "sections": [
            {"heading": "Advance requested", "columns": ["#", "Description", "HSN/SAC", "GST %", "Taxable", *tax_cols, "Total"],
             "widths": widths, "rows": rows},
            {"heading": "Amount", "columns": ["", "INR"], "widths": [4.6, 2.0], "rows": [[a, v] for a, v in totals]},
        ],
        "statement": "Please remit the amount payable to our bank account below, quoting the PI number. "
                     "Bank details as per our letterhead / company records.",
        "remarks": pi.remarks or (f"Cancelled: {pi.cancel_reason}" if pi.status == "cancelled" else None),
        "signatures": [("For Premnath Rail", svc.user_names(db, [pi.created_by_id]).get(pi.created_by_id, ""))],
    }


def pi_document_target(db: Session, pi_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
    from app.modules.quality.reports.render import render_docx
    from app.modules.sales.access import ensure_order
    from app.modules.sales.views import get_order
    pi = db.get(SalesProformaInvoice, pi_id)
    if not pi:
        raise HTTPException(status_code=404, detail="Proforma invoice not found — it may have been removed. Refresh the order.")
    so = get_order(db, pi.so_id)
    ensure_order(db, user, so)
    action = "edit" if modify else "print"
    if not can_perform(user, "sales", "orders", action):
        raise HTTPException(status_code=403, detail=f"You don't have '{action_word(action)}' permission on Sales › Orders. Ask an admin to grant it in Users › Permission Matrix.")
    if modify and pi.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"Proforma invoice {pi.pi_number} is cancelled — its document can't be changed.")
    return managed_documents.DocumentTarget(
        entity_id=pi.id, revision=0, title=f"Proforma invoice {pi.pi_number}",
        folder=managed_documents.sharepoint_folder("Sales-Orders", so.so_number.replace("/", "-")),
        filename_stem=managed_documents.safe_filename(pi.pi_number.replace("/", "-")),
        build_docx=lambda: render_docx(pi_spec(db, pi, so)),
    )
