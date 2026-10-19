"""GRN gate entry + vendor document fields (MIGO header / gate register) and
the per-line receipt extras (blind-receipt invoice quantity, putaway bin,
serial numbers). Kept out of routes/goods_receipts.py so that file only calls
these two checks.

Rules:
  * vendor invoice no. is unique per vendor across GRNs that aren't reversed
    (the same bill can't be received twice — it would be paid twice);
  * document dates can't be in the future or after the goods arrived;
  * a gate entry number is taken from the security register when given,
    otherwise one is generated (GE-YYYY-NNNN) with the time of recording;
  * invoice quantity is what the vendor's bill / challan says — kept apart
    from the received quantity the store counted (blind receipt)."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

_HEADER_TEXT = {
    "gate_entry_number": ("Gate entry no.", 50),
    "vendor_invoice_number": ("Vendor invoice no.", 100),
    "delivery_challan_number": ("Delivery challan no.", 100),
    "eway_bill_number": ("E-way bill no.", 30),
    "vehicle_number": ("Vehicle no.", 30),
    "transporter_name": ("Transporter", 150),
    "lr_number": ("LR no.", 50),
}


def _clean(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


def generate_gate_entry_number(db: Session) -> str:
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.modules.p2p.service import _lock_number_series
    prefix = f"GE-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PGoodsReceipt.gate_entry_number)).filter(P2PGoodsReceipt.gate_entry_number.like(f"{prefix}%")).scalar()
    try:
        n = int(last.rsplit("-", 1)[-1]) + 1 if last else 1
    except ValueError:
        n = 1
    return f"{prefix}{n:04d}"


def find_duplicate_invoice(db: Session, po, invoice_number: str, exclude_grn_id: int | None = None):
    """Another live GRN of the same vendor carrying this invoice no. (case /
    spacing-insensitive), or None."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    key = "".join(invoice_number.split()).lower()
    q = db.query(P2PGoodsReceipt).join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PGoodsReceipt.purchase_order_id).filter(
        P2PGoodsReceipt.status != "reversed", P2PGoodsReceipt.vendor_invoice_number.isnot(None))
    if po.vendor_id:
        q = q.filter(P2PPurchaseOrder.vendor_id == po.vendor_id)
    elif po.vendor_name:
        q = q.filter(func.lower(P2PPurchaseOrder.vendor_name) == po.vendor_name.lower())
    else:  # vendor not on the PO yet: compare with other vendor-less POs
        q = q.filter(P2PPurchaseOrder.vendor_id.is_(None), P2PPurchaseOrder.vendor_name.is_(None))
    if exclude_grn_id:
        q = q.filter(P2PGoodsReceipt.id != exclude_grn_id)
    for g in q.all():
        if "".join((g.vendor_invoice_number or "").split()).lower() == key:
            return g
    return None


def validate_grn_documents(db: Session, po, payload) -> dict:
    """The GRN header document fields, cleaned and checked; 422 / 409 with the
    reason otherwise."""
    out: dict = {}
    for field, (label, limit) in _HEADER_TEXT.items():
        v = _clean(getattr(payload, field, None))
        if v and len(v) > limit:
            raise HTTPException(status_code=422, detail=f"{label} is too long — keep it to {limit} characters or fewer.")
        out[field] = v
    for f in ("vehicle_number", "eway_bill_number"):
        if out[f]:
            out[f] = "".join(out[f].split()).upper()
    if out["eway_bill_number"] and not (out["eway_bill_number"].isdigit() and len(out["eway_bill_number"]) == 12):
        raise HTTPException(status_code=422, detail=f"E-way bill no. '{out['eway_bill_number']}' isn't valid — an e-way bill number is 12 digits "
                                                    "(it is printed on the EWB with the vehicle). Leave it empty if the consignment didn't need one.")
    received = payload.received_date or date.today()
    for field, label in (("vendor_invoice_date", "Vendor invoice date"), ("delivery_challan_date", "Delivery challan date")):
        d = getattr(payload, field, None)
        if d and d > received:
            raise HTTPException(status_code=422, detail=f"{label} {d.isoformat()} is after the goods were received ({received.isoformat()}) — "
                                                        "the vendor raises it on or before dispatch. Check the date on the document.")
        out[field] = d
    if out["vendor_invoice_number"] and not out["vendor_invoice_date"]:
        raise HTTPException(status_code=422, detail="Enter the vendor invoice date too — it is printed next to the invoice number on the bill.")
    if out["delivery_challan_number"] and not out["delivery_challan_date"]:
        raise HTTPException(status_code=422, detail="Enter the delivery challan date too — it is printed next to the challan number.")
    if out["vendor_invoice_number"]:
        dup = find_duplicate_invoice(db, po, out["vendor_invoice_number"])
        if dup:
            raise HTTPException(status_code=409, detail=(
                f"Vendor invoice no. '{out['vendor_invoice_number']}' of {po.vendor_name or 'this vendor'} is already received on "
                f"GRN {dup.grn_number} — the same bill can't be received twice. Check the number on the bill; if the earlier GRN "
                "was entered wrongly, reverse it first."))
    gate_at = getattr(payload, "gate_entry_at", None)
    if gate_at is not None:
        gate_at = gate_at.replace(tzinfo=None) if gate_at.tzinfo else gate_at
        if gate_at.date() > date.today():
            raise HTTPException(status_code=422, detail="Gate entry time is in the future — enter when the vehicle came in at the gate.")
    out["gate_entry_at"] = gate_at or datetime.now()
    out["gate_entry_number"] = out["gate_entry_number"] or generate_gate_entry_number(db)
    return out


def validate_grn_line_extras(db: Session, store_item, item_payload, location_id: int) -> list[str]:
    """Invoice quantity, putaway bin and serial numbers of one GRN line;
    returns the cleaned serial list."""
    from app.modules.store.services.bins import BinError, validate_bin
    from app.modules.store.services.serials import SerialError, check_new_for_grn
    name = store_item.item_name if store_item else "this line"
    if item_payload.invoice_quantity is not None and item_payload.invoice_quantity < 0:
        raise HTTPException(status_code=422, detail=f"Invoice quantity for '{name}' can't be negative — enter what the vendor's bill says.")
    try:
        validate_bin(db, item_payload.bin_id, location_id, what=f"'{name}'")
        return check_new_for_grn(db, store_item, item_payload.received_quantity, item_payload.serials)
    except (BinError, SerialError) as e:
        raise HTTPException(status_code=422, detail=str(e))
