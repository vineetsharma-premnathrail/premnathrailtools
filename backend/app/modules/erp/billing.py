"""Service billing (SAP CS resource-related billing → SD invoice).

A chargeable service request is billed with a real AR (sales) invoice built
through accounts.service.create_ar_transaction — the same function Finance
uses — so GST is split CGST+SGST / IGST by place of supply, every line
carries its HSN/SAC, and posting (SI/<FY>/NNNN number, receivable, revenue,
output GST) happens in Finance through the sales-invoice approval, which
calls post_customer_invoice. The SR mirrors the invoice's number and
payment state; they are never typed by hand any more.

Lines:
  labour / service charge   SR.service_cost        SAC (Service setting)
  visit / stay charges      SR.accommodation_cost  SAC
  transport charges         SR.transport_cost      SAC
  other charges             SR.miscellaneous_cost  SAC
  spares                    one line per Item Master spare actually consumed
                            (issued − returned), not warranty-covered, at
                            its unit price; HSN + GST rate from the item
Customer = the machine's CRM customer; place of supply = the machine's site
state, else the customer's GSTIN/state."""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.erp.models.project import Project
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.erp.models.service_request import ServiceRequest

# Service billing (SR → Finance sales invoice) is built but not live yet
# ("Upcoming", 2026-10-14): raising an SR invoice is refused and the SR page
# hides the billing parts. Flip to True (here and in frontend/src/lib/features.ts).
SERVICE_BILLING_ENABLED = False


def ensure_billing_enabled() -> None:
    if not SERVICE_BILLING_ENABLED:
        raise HTTPException(status_code=409, detail="Service billing (invoice from the SR) is an upcoming feature and not open yet — "
                            "raise the invoice in Finance › Sales invoices until it goes live.")

BILLABLE_SR_STATUSES = ("work_completed", "review", "closed")
_LIVE_INVOICE = ("pending", "posted")


def _setting(db: Session, key: str, fallback):
    from app.modules.erp.settings import get_setting
    try:
        v = get_setting(db, key)
    except Exception:  # noqa: BLE001
        v = None
    return fallback if v in (None, "") else v


def linked_invoice(db: Session, sr: ServiceRequest):
    from app.modules.accounts.models.ar_transaction import ARTransaction
    return db.get(ARTransaction, sr.ar_transaction_id) if sr.ar_transaction_id else None


def sync_invoice(db: Session, sr: ServiceRequest) -> None:
    """Refresh the SR's invoice number / payment status / billing status
    from its AR invoice. A cancelled draft releases the SR to be billed
    again. Leaves legacy (typed) values alone on SRs never billed here."""
    txn = linked_invoice(db, sr)
    if txn is None:
        if sr.ar_transaction_id:  # row gone
            sr.ar_transaction_id = None
        if sr.is_chargeable is not None:
            sr.billing_status = "to_bill" if sr.is_chargeable else "not_billable"
        return
    if txn.status == "cancelled":
        sr.ar_transaction_id = None
        sr.invoice_number = None
        sr.payment_status = "pending" if sr.is_chargeable else "not_billable"
        sr.billing_status = "to_bill" if sr.is_chargeable else "not_billable"
        return
    sr.invoice_number = txn.invoice_number
    if txn.status == "posted" and (txn.collection_status == "collected" or (txn.amount_due or 0) <= 0.005):
        sr.payment_status, sr.billing_status = "paid", "paid"
    else:
        sr.payment_status, sr.billing_status = "invoiced", "invoiced"


def invoice_summary(db: Session, sr: ServiceRequest) -> dict | None:
    txn = linked_invoice(db, sr)
    if txn is None:
        return None
    return {
        "id": txn.id, "invoice_number": txn.invoice_number, "status": txn.status, "invoice_date": txn.invoice_date,
        "taxable_amount": float(txn.invoice_amount or 0), "cgst_amount": float(txn.cgst_amount or 0),
        "sgst_amount": float(txn.sgst_amount or 0), "igst_amount": float(txn.igst_amount or 0),
        "total_amount": float(txn.total_amount or 0), "amount_due": float(txn.amount_due or 0),
        "collection_status": txn.collection_status, "is_interstate": bool(txn.is_interstate),
        "place_of_supply_state_code": txn.place_of_supply_state_code,
    }


def reported_day_of(sr: ServiceRequest) -> date:
    from app.modules.erp.warranty import reported_day
    return reported_day(sr)


def build_invoice_lines(db: Session, sr: ServiceRequest) -> list[dict]:
    from app.modules.store.models.item import StoreItem
    sac = str(_setting(db, "service_sac_code", "998717")).strip()
    rate = float(_setting(db, "service_gst_rate", 18.0))
    lines: list[dict] = []
    # Service contract (erp/contracts.py): what the AMC / CMC covers is not billed.
    from app.modules.erp.models.service_contract import ServiceContract
    from app.modules.products import pricing
    contract = db.get(ServiceContract, sr.service_contract_id) if sr.service_contract_id else None
    labour_free = bool(contract and contract.labour_covered)
    spares_free = bool(contract and contract.spares_covered)
    project = db.get(Project, sr.project_id)
    customer_id = project.customer_id if project is not None else None
    on = sr.actual_completion_date or reported_day_of(sr)
    for amount, text, covered in (
        (sr.service_cost, "Service / labour charges", labour_free),
        (sr.accommodation_cost, "Visit / stay charges", labour_free),
        (sr.transport_cost, "Transport charges", labour_free),
        (sr.miscellaneous_cost, "Other service charges", False),
    ):
        if (amount or 0) > 0 and not covered:
            lines.append({"description": f"{text} — {sr.request_number}", "hsn_sac_code": sac, "quantity": 1,
                          "uom": "Job", "rate": round(float(amount), 2), "gst_rate": rate})
    # No labour amount typed: default from the service rates (pricing conditions,
    # Sales › Pricing) — labour hours × hourly rate, plus the visit charge.
    if not labour_free and not (sr.service_cost or 0) > 0:
        hours = float(sr.actual_service_duration_hours or 0)
        lab = pricing.resolve(db, service_code="labour_hour", customer_id=customer_id, on=on)
        if hours > 0 and lab["price"]:
            lines.append({"description": f"Service engineer labour {hours:g} h @ ₹{lab['price']:,.2f} — {sr.request_number} (rate list)",
                          "hsn_sac_code": sac, "quantity": round(hours, 2), "uom": "Hr", "rate": round(lab["price"], 2),
                          "discount_amount": round(hours * lab["price"] * lab["discount_percent"] / 100, 2), "gst_rate": rate})
        visit = pricing.resolve(db, service_code="visit", customer_id=customer_id, on=on)
        if visit["price"]:
            lines.append({"description": f"Visit charge — {sr.request_number} (rate list)", "hsn_sac_code": sac, "quantity": 1,
                          "uom": "Visit", "rate": round(visit["price"], 2),
                          "discount_amount": round(visit["price"] * visit["discount_percent"] / 100, 2), "gst_rate": rate})
    mats = db.query(ServiceMaterial).filter(
        ServiceMaterial.service_request_id == sr.id, ServiceMaterial.is_deleted == False,  # noqa: E712
    ).order_by(ServiceMaterial.id).all()
    problems: list[str] = []
    for m in mats:
        if m.is_warranty_covered or spares_free:
            continue
        if not m.store_item_id:
            if (m.estimated_budget or 0) > 0:
                problems.append(f"'{m.material_name}' is a free-text line with no Item Master link, so it has no HSN — "
                                "add the spare again from the Item Master (and issue it from Store), or mark it warranty-covered")
            continue
        qty = m.net_issued
        if qty <= 1e-9:
            continue
        item = db.get(StoreItem, m.store_item_id)
        unit_price = m.unit_price
        if unit_price is None:  # default from the spares price list (customer price, else list)
            unit_price = pricing.resolve(db, store_item_id=m.store_item_id, customer_id=customer_id, on=on)["price"]
        if unit_price is None:
            problems.append(f"'{m.material_name}' has no selling price and no spares price list rate — enter its unit price on the "
                            "Materials tab, or add the spare to Sales › Pricing")
            continue
        if not item or not (item.hsn_sac_code or "").strip():
            problems.append(f"'{m.material_name}' has no HSN code in the Item Master — Store must add it (Store › Items)")
            continue
        if item.gst_rate is None:
            problems.append(f"'{m.material_name}' has no GST rate in the Item Master — Store must add it (Store › Items)")
            continue
        line = {"description": f"{item.item_name} ({item.item_code})", "hsn_sac_code": item.hsn_sac_code.strip(),
                "quantity": round(qty, 4), "uom": item.uom or m.unit, "rate": round(float(unit_price), 2),
                "gst_rate": float(item.gst_rate), "store_item_id": item.id}
        if getattr(item, "sales_gl_account_id", None):
            line["gl_account_id"] = item.sales_gl_account_id
        lines.append(line)
    if problems:
        raise HTTPException(status_code=422, detail="Can't build the invoice yet: " + "; ".join(problems) + ".")
    if not lines:
        raise HTTPException(
            status_code=422,
            detail=f"{sr.request_number} has nothing to bill — enter the service / visit / transport charges on the Billing "
                   "section, or issue the chargeable spares from Store first.",
        )
    return lines


def create_sr_invoice(db: Session, sr: ServiceRequest, user, *, invoice_date: date | None = None,
                      customer_po_number: str | None = None, narration: str | None = None):
    from app.modules.accounts.service import create_ar_transaction
    from app.modules.accounts.services import gst

    if (sr.status or "").lower() not in BILLABLE_SR_STATUSES:
        raise HTTPException(status_code=409, detail=f"{sr.request_number} is {(sr.status or '').replace('_', ' ')} — an SR is invoiced "
                                                    "once its work is done (Work Completed, Review or Closed).")
    if not sr.is_chargeable:
        raise HTTPException(status_code=409, detail=f"{sr.request_number} is free of charge ({(sr.warranty_status or 'warranty').replace('_', ' ')}). "
                                                    "If the customer must pay, mark it chargeable with a reason first.")
    current = linked_invoice(db, sr)
    if current is not None and current.status in _LIVE_INVOICE:
        raise HTTPException(status_code=409, detail=f"{sr.request_number} already has invoice {current.invoice_number} ({current.status}). "
                                                    "Cancel that draft in Finance › Sales first if it must be raised again.")
    project = db.get(Project, sr.project_id)
    if project is None or not project.customer_id:
        raise HTTPException(
            status_code=422,
            detail=f"Machine {project.serial_number if project else ''} isn't linked to a CRM customer, so the invoice has no debtor, "
                   "GSTIN or place of supply. Edit the machine and pick its Customer first.".replace("  ", " "),
        )
    lines = build_invoice_lines(db, sr)
    pos = gst.state_code_for_name(project.site_state) if project.site_state else None
    try:
        txn = create_ar_transaction(
            db, customer_id=project.customer_id, invoice_date=invoice_date or date.today(), created_by_id=user.id,
            lines=lines, place_of_supply_state_code=pos,
            shipping_address=", ".join(x for x in (project.site_name, project.site_location, project.site_state, project.site_pincode) if x) or None,
            customer_po_number=customer_po_number,
            narration=narration or f"Service request {sr.request_number} — machine {project.serial_number}",
            reference_type="service_request", reference_id=sr.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Finance couldn't draft the invoice: {e}")
    sr.ar_transaction_id = txn.id
    sync_invoice(db, sr)
    return txn
