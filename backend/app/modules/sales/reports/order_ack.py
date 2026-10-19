"""Order Acknowledgement (plan §6.3) — the managed Word document of record
`sales_order_ack` (Save & Edit in Word is primary; the PDF renders the Word
document once one exists). Content goes through the shared quality renderer
(app/modules/quality/reports/render.py), which takes a generic spec."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_perform
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.sales import service as svc
from app.modules.sales.models.order import SalesOrder

OA_ENTITY = "sales_order_ack"

_PRICE_BASIS = {"ex_works": "Ex-works", "for_destination": "FOR destination", "for_dispatch": "FOR dispatch station"}
_RULE = {"from_delivery": "from delivery", "from_commissioning": "from commissioning",
         "earlier_of": "whichever is earlier", "later_of": "whichever is later"}
_MILESTONE = {"advance": "Advance", "drawing_approval": "On drawing approval", "inspection": "On inspection clearance",
              "dispatch": "On dispatch", "delivery": "On delivery (POD)", "commissioning": "On commissioning",
              "retention_release": "Retention release", "other": "Other"}


def _d(v) -> str:
    return v.strftime("%d-%m-%Y") if v else "—"


def _num(v) -> str:
    return f"{float(v or 0):,.2f}"


def oa_spec(db: Session, so: SalesOrder) -> dict:
    lines = {ln.id: ln for ln in so.lines}
    ld = "Not applicable"
    if so.ld_applicable:
        cap = f", capped at {float(so.ld_max_percent):g}% of the {'delayed value' if so.ld_basis == 'delayed_value' else 'contract value'}" \
            if so.ld_max_percent is not None else " (no cap)"
        ld = f"{float(so.ld_rate_percent or 0):g}% per {so.ld_rate_period or 'week'}{' or part thereof' if so.ld_rate_period == 'week' else ''}{cap}"
    warranty = "—"
    if so.warranty_rule:
        parts = []
        if so.warranty_months_from_delivery and so.warranty_rule != "from_commissioning":
            parts.append(f"{so.warranty_months_from_delivery} months from delivery")
        if so.warranty_months_from_commissioning and so.warranty_rule != "from_delivery":
            parts.append(f"{so.warranty_months_from_commissioning} months from commissioning")
        warranty = " / ".join(parts) + (f", {_RULE[so.warranty_rule]}" if len(parts) > 1 else "")
    title = "ORDER ACKNOWLEDGEMENT" + (f" — AMENDMENT {so.amendment_no}" if so.amendment_no else "")
    po = f"{so.customer_po_number or '—'} dated {_d(so.customer_po_date)}"
    statement_bits = [f"Liquidated damages: {ld}.", f"Warranty: {warranty}."]
    if so.inspection_agency:
        statement_bits.append(f"Inspection: {so.inspection_agency.upper()}{' (third-party inspection required)' if so.third_party_inspection_required else ''}.")
    remarks = "\n".join(p for p in (
        f"Delivery terms: {so.delivery_terms_text}" if so.delivery_terms_text else None,
        f"Our understanding of the special conditions: {so.special_conditions}" if so.special_conditions else None,
        f"Warranty terms: {so.warranty_terms_text}" if so.warranty_terms_text else None,
    ) if p)
    return {
        "title": title,
        "number": so.so_number or so.display_number,
        "intro": (f"We thank you for your purchase order {po}. We acknowledge and accept it on the terms set out below, "
                  f"as we have understood them. Please let us know within 7 days if anything differs from your order."),
        "facts": [
            ("Customer", so.customer_name), ("Customer PO", po),
            ("GSTIN", so.customer_gstin), ("LOA", f"{so.loa_number} dated {_d(so.loa_date)}" if so.loa_number else None),
            ("Billing address", so.billing_address), ("Contract ref.", so.contract_reference),
            ("Purchaser", so.purchaser_name), ("Paying authority", so.paying_authority),
            ("Price basis", _PRICE_BASIS.get(so.price_basis, so.price_basis)), ("Freight / insurance",
                                                                                 " / ".join(p for p in (so.freight_terms, so.insurance_terms) if p) or None),
            ("Order value (incl. GST)", f"INR {_num(so.grand_total)}"), ("Taxable value", f"INR {_num(so.taxable_total)}"),
        ],
        "sections": [
            {"heading": "Items", "columns": ["#", "Description", "Customer ref.", "HSN", "Qty", "Unit price", "GST %", "Total"],
             "widths": [0.3, 2.3, 1.0, 0.6, 0.5, 0.9, 0.5, 1.0],
             "rows": [[str(ln.line_number), ln.description + (f" ({ln.rrv_model})" if ln.rrv_model else ""), ln.customer_line_ref or "",
                       ln.hsn_sac_code or "", f"{float(ln.quantity):g} {ln.uom}", _num(ln.unit_price), f"{float(ln.gst_rate):g}",
                       _num(ln.line_total)] for ln in so.lines]},
            {"heading": "Delivery schedule", "columns": ["Line", "Lot", "Qty", "Consignee", "Delivery by"],
             "widths": [0.5, 0.5, 0.5, 4.0, 1.6],
             "rows": [[str(lines[r.so_line_id].line_number) if r.so_line_id in lines else "", str(r.sequence), f"{float(r.quantity):g}",
                       r.consignee_name or so.customer_name or "", _d(r.current_delivery_date)]
                      for r in so.schedules if r.status != "cancelled"]},
            {"heading": "Billing / payment milestones", "columns": ["#", "Milestone", "%", "Amount (INR)", "Due"],
             "widths": [0.3, 3.2, 0.7, 1.5, 1.4],
             "rows": [[str(b.sequence), _MILESTONE.get(b.milestone_type, b.milestone_type) + (f" — {b.description}" if b.description else ""),
                       f"{float(b.percent):g}", _num(b.amount), f"{b.due_days} days" if b.due_days else "—"]
                      for b in so.billing_lines if b.status != "cancelled"]},
        ],
        "statement": " ".join(statement_bits),
        "remarks": remarks or None,
        "signatures": [("For Premnath Rail", svc.user_names(db, [so.confirmed_by_id]).get(so.confirmed_by_id, "")),
                       ("Acknowledged by customer", "")],
    }


def oa_document_target(db: Session, so_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
    from app.modules.quality.reports.render import render_docx
    so = db.query(SalesOrder).filter(SalesOrder.id == so_id, SalesOrder.is_deleted == False).first()  # noqa: E712
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found — it may have been deleted. Refresh the page.")
    from app.modules.sales.access import ensure_order
    ensure_order(db, user, so)
    if not so.so_number:
        raise HTTPException(status_code=409, detail=f"{so.display_number} isn't confirmed yet — the acknowledgement needs the SO number.")
    action = "edit" if modify else "print"
    if not can_perform(user, "sales", "orders", action):
        raise HTTPException(status_code=403, detail=f"You don't have '{action}' permission on Sales › Orders. Ask an admin to grant it in Users › Permission Matrix.")
    stem = f"OA-{so.so_number}" + (f"-A{so.amendment_no}" if so.amendment_no else "")
    return managed_documents.DocumentTarget(
        entity_id=so.id, revision=so.amendment_no or 0,
        title=f"Order acknowledgement {so.so_number}" + (f" (amendment {so.amendment_no})" if so.amendment_no else ""),
        folder=managed_documents.sharepoint_folder("Sales-Orders", so.so_number.replace("/", "-")),
        filename_stem=managed_documents.safe_filename(stem),
        build_docx=lambda: render_docx(oa_spec(db, so)),
    )
