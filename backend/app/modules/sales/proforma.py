"""Proforma invoice (SAP VA01 PF / F-37 down-payment request) — business rules.
Model and lifecycle: sales/models/proforma.py. No ledger posting here."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales.models.order import SalesOrder, SalesBillingPlanLine
from app.modules.sales.models.proforma import SalesProformaInvoice

PI_ORDER_STATUSES = ("confirmed", "in_execution", "partially_delivered")
PI_MILESTONES = ("advance",)
STATUS_LABEL = {"issued": "Issued", "cancelled": "Cancelled", "converted": "Converted to invoice"}


def _milestone(so: SalesOrder, billing_line_id: int) -> SalesBillingPlanLine:
    b = next((x for x in so.billing_lines if x.id == billing_line_id), None)
    if b is None:
        raise svc.SalesError(404, f"Billing milestone #{billing_line_id} isn't on {so.display_number} — reload the order and pick it again.")
    return b


def received_amount(db: Session, billing_line_id: int) -> float:
    """Customer advances Finance recorded against the milestone (posted receipts)."""
    from app.modules.accounts.models.payment_transaction import PaymentTransaction
    rows = db.query(PaymentTransaction.amount).filter(
        PaymentTransaction.billing_line_id == billing_line_id, PaymentTransaction.payment_type == "customer",
        PaymentTransaction.status == "posted").all()
    return round(sum(float(a or 0) for (a,) in rows), 2)


def sync_status(db: Session, so: SalesOrder) -> None:
    """issued → converted once the milestone has been invoiced (billing)."""
    lines = {b.id: b for b in so.billing_lines}
    for pi in db.query(SalesProformaInvoice).filter(SalesProformaInvoice.so_id == so.id, SalesProformaInvoice.status == "issued").all():
        b = lines.get(pi.billing_line_id)
        if b is not None and b.status in ("invoiced", "settled"):
            pi.status = "converted"


def create(db: Session, so: SalesOrder, user: User, billing_line_id: int, pi_date: date | None,
           valid_until: date | None, remarks: str | None) -> SalesProformaInvoice:
    from app.modules.accounts.services import gst
    from app.modules.accounts.services.fiscal import next_number
    if not so.so_number or so.status not in PI_ORDER_STATUSES:
        raise svc.SalesError(409, f"{so.display_number} is {svc.STATUS_LABEL.get(so.status, so.status)} — a proforma invoice is raised only "
                                  f"on a confirmed order that is not on hold, cancelled or closed.")
    b = _milestone(so, billing_line_id)
    if b.milestone_type not in PI_MILESTONES:
        raise svc.SalesError(422, f"Milestone {b.sequence} is '{b.description or b.milestone_type}' — a proforma invoice is only for an "
                                  f"advance milestone. Other milestones are billed with a tax invoice when they fall due (Billing).")
    if b.status in ("cancelled", "invoiced", "settled"):
        raise svc.SalesError(409, f"Milestone {b.sequence} ({float(b.percent):g}% advance) is {b.status.replace('_', ' ')} — no proforma invoice is needed.")
    live = db.query(SalesProformaInvoice).filter(SalesProformaInvoice.billing_line_id == b.id,
                                                 SalesProformaInvoice.status == "issued").first()
    if live:
        raise svc.SalesError(409, f"Proforma invoice {live.pi_number} is already issued for milestone {b.sequence}. "
                                  f"Cancel it (with a reason) before issuing a new one.")
    pi_date = pi_date or svc.today_ist()
    if valid_until and valid_until < pi_date:
        raise svc.SalesError(422, f"Valid until ({valid_until:%d-%m-%Y}) is before the PI date ({pi_date:%d-%m-%Y}).")
    try:
        company = gst.require_company_state(db)
    except ValueError as e:
        raise svc.SalesError(409, f"Can't work out the GST on the proforma invoice: {e}")
    pos = (so.place_of_supply_state_code or "").strip()
    if not pos:
        from app.modules.crm.models.organization import Organization
        org = db.get(Organization, so.customer_id)
        pos = (getattr(org, "gst_state_code", None) or gst.party_state_code(so.customer_gstin, so.customer_state) or "") if org else ""
    if not pos:
        raise svc.SalesError(422, f"{so.display_number} has no place of supply (GST state). Enter the customer's GSTIN or GST state code "
                                  f"in CRM › Organization, or the place of supply on the order (amendment), then raise the PI.")
    pos = pos.zfill(2)
    interstate = pos != company
    pct = float(b.percent or 0) / 100
    lines, tax, cg, sg, ig = [], 0.0, 0.0, 0.0, 0.0
    for ln in so.lines:
        taxable = round(float(ln.taxable_amount or 0) * pct, 2)
        if taxable <= 0:
            continue
        c, s, i = gst.split_tax(taxable, float(ln.gst_rate or 0), interstate)
        lines.append({"line_number": ln.line_number, "description": ln.description, "hsn_sac_code": ln.hsn_sac_code,
                      "gst_rate": float(ln.gst_rate or 0), "taxable": taxable, "cgst": c, "sgst": s, "igst": i,
                      "total": round(taxable + c + s + i, 2)})
        tax, cg, sg, ig = tax + taxable, cg + c, sg + s, ig + i
    if not lines:
        raise svc.SalesError(422, f"{so.display_number} has no priced line — there is nothing to put on the proforma invoice.")
    try:
        number = next_number(db, "PI", pi_date)
    except ValueError as e:
        raise svc.SalesError(409, f"Can't issue a proforma invoice number: {e}")
    pi = SalesProformaInvoice(
        pi_number=number, so_id=so.id, billing_line_id=b.id, pi_date=pi_date, valid_until=valid_until,
        place_of_supply_state_code=pos, interstate=interstate, taxable_amount=round(tax, 2), cgst_amount=round(cg, 2),
        sgst_amount=round(sg, 2), igst_amount=round(ig, 2), total_amount=round(tax + cg + sg + ig, 2), lines=lines,
        remarks=(remarks or "").strip() or None, status="issued", created_by_id=user.id,
    )
    db.add(pi)
    db.flush()
    svc.notify_bell(db, [so.sales_owner_id, so.created_by_id], f"Proforma invoice {number} issued",
                    f"{so.so_number}: {float(b.percent):g}% advance, {svc.inr(pi.total_amount)} incl. GST.",
                    "sales_proforma_issued", "sales_order", so.id, exclude_user_id=user.id)
    return pi


def cancel(db: Session, pi: SalesProformaInvoice, user: User, reason: str | None) -> None:
    if pi.status != "issued":
        raise svc.SalesError(409, f"Proforma invoice {pi.pi_number} is {STATUS_LABEL.get(pi.status, pi.status).lower()} — only an issued PI can be cancelled.")
    reason = (reason or "").strip()
    if not reason:
        raise svc.SalesError(422, f"Give a reason for cancelling {pi.pi_number} — it's kept on the record and the customer may already hold it.")
    if received_amount(db, pi.billing_line_id) > 0:
        raise svc.SalesError(409, f"Finance has already recorded an advance against this milestone — {pi.pi_number} can't be cancelled. "
                                  f"Ask Finance to reverse the receipt first if the PI really is wrong.")
    pi.status, pi.cancel_reason = "cancelled", reason
    pi.cancelled_at, pi.cancelled_by_id = svc.now_utc(), user.id


def view(db: Session, pi: SalesProformaInvoice, so: SalesOrder | None = None) -> dict:
    b = db.get(SalesBillingPlanLine, pi.billing_line_id)
    received = received_amount(db, pi.billing_line_id)
    names = svc.user_names(db, [pi.created_by_id, pi.cancelled_by_id])
    return {
        "id": pi.id, "pi_number": pi.pi_number, "so_id": pi.so_id, "so_number": so.so_number if so else None,
        "billing_line_id": pi.billing_line_id,
        "milestone": (f"{b.sequence}. {float(b.percent):g}% advance" + (f" — {b.description}" if b.description else "")) if b else None,
        "pi_date": pi.pi_date.isoformat(), "valid_until": pi.valid_until.isoformat() if pi.valid_until else None,
        "place_of_supply_state_code": pi.place_of_supply_state_code, "interstate": pi.interstate,
        "taxable_amount": float(pi.taxable_amount), "cgst_amount": float(pi.cgst_amount), "sgst_amount": float(pi.sgst_amount),
        "igst_amount": float(pi.igst_amount), "total_amount": float(pi.total_amount), "lines": pi.lines or [],
        "remarks": pi.remarks, "status": pi.status, "status_label": STATUS_LABEL.get(pi.status, pi.status),
        "cancel_reason": pi.cancel_reason, "received_amount": received,
        "balance_amount": round(max(float(pi.total_amount) - received, 0.0), 2),
        "created_by": names.get(pi.created_by_id), "created_at": pi.created_at.isoformat() if pi.created_at else None,
        "cancelled_by": names.get(pi.cancelled_by_id), "cancelled_at": pi.cancelled_at.isoformat() if pi.cancelled_at else None,
    }
