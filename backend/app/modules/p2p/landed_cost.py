"""Landed cost: delivery costs loaded into stock value (SAP ME21N delivery
cost conditions + MIRO unplanned delivery costs / landed-cost voucher).

What is loaded — and what is not:
  * freight, packing & forwarding, transit insurance, clearing, basic customs
    duty + social welfare surcharge: NOT recoverable, so they are part of the
    cost of the material (Ind AS 2 para 11 / AS 2) — loaded.
  * GST on those services and IGST paid on import: input tax credit, so it is
    never part of cost — `amount` is always taken BEFORE GST.

Two routes into stock value:
  1. Planned on the PO (P2PPOCharge): each GRN is valued at
     PO rate x exchange rate + the charge apportioned to the line (by line
     value or quantity) per ordered unit — landed_rate().
  2. Billed later / not planned (P2PLandedCostVoucher): apportioned over what
     has been received on the PO; the part whose stock is still on hand is a
     value-only revaluation of the item's moving average; the part already
     issued is reported as consumption cost (it can't be put back into stock
     that has left)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session, object_session

from app.modules.p2p.models.landed_cost import (
    P2P_CHARGE_BASES, P2P_CHARGE_TYPES, P2PLandedCostAllocation, P2PLandedCostVoucher, P2PPOCharge,
)

_EPS = 1e-9


class LandedCostError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def _stock_lines(po) -> list:
    """PO lines that go into store stock — delivery costs are spread over them only."""
    return [l for l in po.items if l.category == "stock" and (l.quantity or 0) > _EPS]


def _fx(po) -> float:
    rate = getattr(po, "exchange_rate", None)
    try:
        return float(rate) if rate else 1.0
    except (TypeError, ValueError):
        return 1.0


def apportion(amount: float, weights: dict[int, float]) -> dict[int, float]:
    """Splits `amount` over keys in proportion to weights, to the paisa; the
    last key takes the rounding remainder so the parts add up exactly."""
    total = sum(w for w in weights.values() if w > 0)
    if total <= _EPS or not weights:
        return {}
    keys = [k for k, w in weights.items() if w > 0]
    out, run = {}, 0.0
    for k in keys[:-1]:
        part = round(amount * weights[k] / total, 2)
        out[k] = part
        run += part
    out[keys[-1]] = round(amount - run, 2)
    return out


def _weights(lines, basis: str, fx: float, qty_of=None) -> dict[int, float]:
    if basis == "quantity":
        return {l.id: float(qty_of(l) if qty_of else l.quantity) for l in lines}
    return {l.id: float(qty_of(l) if qty_of else l.quantity) * float(l.unit_price or 0) * fx for l in lines}


def planned_allocation(db: Session, po) -> dict[int, float]:
    """Planned delivery cost per PO line (₹, whole ordered quantity)."""
    charges = db.query(P2PPOCharge).filter(P2PPOCharge.purchase_order_id == po.id).all()
    if not charges:
        return {}
    lines = _stock_lines(po)
    fx = _fx(po)
    out: dict[int, float] = {}
    for c in charges:
        for k, v in apportion(float(c.amount or 0), _weights(lines, c.basis, fx)).items():
            out[k] = out.get(k, 0.0) + v
    return out


def landed_uplift(po_item) -> float:
    """Planned delivery cost per ordered unit of a PO line."""
    db = object_session(po_item)
    po = po_item.purchase_order
    if db is None or po is None or (po_item.quantity or 0) <= _EPS:
        return 0.0
    if not db.query(P2PPOCharge.id).filter(P2PPOCharge.purchase_order_id == po.id).first():
        return 0.0
    return planned_allocation(db, po).get(po_item.id, 0.0) / float(po_item.quantity)


def landed_rate(po_item) -> float | None:
    """GRN valuation rate of a PO line: PO rate (excl. GST) in rupees plus the
    planned delivery cost per unit. None when the line has no price."""
    if po_item is None or not po_item.unit_price:
        return None
    po = po_item.purchase_order
    base = float(po_item.unit_price) * (_fx(po) if po is not None else 1.0)
    if po_item.category != "stock":
        return base
    return round(base + landed_uplift(po_item), 4)


# ── PO charges ──────────────────────────────────────────────────────────────

def _has_receipts(db: Session, po_id: int) -> bool:
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    return db.query(P2PGoodsReceipt.id).filter(P2PGoodsReceipt.purchase_order_id == po_id,
                                               P2PGoodsReceipt.status != "reversed").first() is not None


def clean_charge(data: dict) -> dict:
    ctype = (data.get("charge_type") or "").strip()
    if ctype not in P2P_CHARGE_TYPES:
        raise LandedCostError(f"Charge type must be one of: {', '.join(P2P_CHARGE_TYPES.values())}.")
    basis = (data.get("basis") or "value").strip()
    if basis not in P2P_CHARGE_BASES:
        raise LandedCostError("Apportion the charge 'value' (by line value) or 'quantity' (by quantity).")
    amount = data.get("amount")
    if amount is None or float(amount) <= 0:
        raise LandedCostError(f"Enter the {P2P_CHARGE_TYPES[ctype].lower()} amount before GST — it must be more than zero.")
    gst = data.get("gst_rate")
    if gst is not None and not (0 <= float(gst) <= 28):
        raise LandedCostError("GST rate on the charge must be between 0 and 28 %. It is recorded for reference only — GST is input credit and is never loaded into stock value.")
    return {"charge_type": ctype, "basis": basis, "amount": round(float(amount), 2),
            "gst_rate": float(gst) if gst is not None else None,
            "description": (data.get("description") or "").strip() or None, "vendor_id": data.get("vendor_id") or None}


def ensure_charges_editable(db: Session, po) -> None:
    if po.status in ("cancelled", "fulfilled"):
        raise LandedCostError(f"PO {po.po_number} is {po.status} — its delivery costs can't be changed.", 409)
    if _has_receipts(db, po.id):
        raise LandedCostError(
            f"Goods have already been received on PO {po.po_number} at the current landed rate, so its planned delivery "
            "costs are frozen. Post a landed-cost voucher for any extra or changed cost instead.", 409)
    if not _stock_lines(po):
        raise LandedCostError(f"PO {po.po_number} has no stock lines — delivery costs are loaded only into store stock "
                              "(service and asset lines are costed by their own documents).")


def charges_view(db: Session, po) -> dict:
    alloc = planned_allocation(db, po)
    charges = db.query(P2PPOCharge).filter(P2PPOCharge.purchase_order_id == po.id).order_by(P2PPOCharge.id).all()
    fx = _fx(po)
    lines = []
    for l in po.items:
        base = float(l.unit_price or 0) * fx
        up = alloc.get(l.id, 0.0) / float(l.quantity) if l.category == "stock" and (l.quantity or 0) > _EPS else 0.0
        lines.append({"po_item_id": l.id, "item_name": l.item_name, "item_code": l.item_code, "quantity": l.quantity, "unit": l.unit,
                      "category": l.category, "po_rate": round(base, 4), "allocated": round(alloc.get(l.id, 0.0), 2),
                      "landed_rate": round(base + up, 4) if l.unit_price else None})
    vouchers = db.query(P2PLandedCostVoucher).filter(P2PLandedCostVoucher.purchase_order_id == po.id).order_by(P2PLandedCostVoucher.id).all()
    return {
        "purchase_order_id": po.id, "po_number": po.po_number, "editable": not _has_receipts(db, po.id) and po.status not in ("cancelled", "fulfilled"),
        "charges": [{"id": c.id, "charge_type": c.charge_type, "charge_label": P2P_CHARGE_TYPES.get(c.charge_type, c.charge_type),
                     "description": c.description, "basis": c.basis, "amount": c.amount, "gst_rate": c.gst_rate, "vendor_id": c.vendor_id}
                    for c in charges],
        "total_planned": round(sum(c.amount for c in charges), 2),
        "lines": lines,
        "vouchers": [voucher_row(v) for v in vouchers],
        "meta": {"charge_types": [{"value": k, "label": v} for k, v in P2P_CHARGE_TYPES.items()],
                 "bases": [{"value": k, "label": v} for k, v in P2P_CHARGE_BASES.items()]},
    }


def voucher_row(v: P2PLandedCostVoucher) -> dict:
    return {"id": v.id, "voucher_number": v.voucher_number, "voucher_date": v.voucher_date.isoformat(), "charge_type": v.charge_type,
            "charge_label": P2P_CHARGE_TYPES.get(v.charge_type, v.charge_type), "description": v.description, "basis": v.basis,
            "amount": v.amount, "gst_rate": v.gst_rate, "vendor_id": v.vendor_id, "bill_reference": v.bill_reference,
            "value_to_stock": v.value_to_stock, "value_to_consumption": v.value_to_consumption, "status": v.status,
            "allocations": [{"po_item_id": a.po_item_id, "store_item_id": a.store_item_id, "basis_qty": a.basis_qty,
                             "basis_value": a.basis_value, "allocated_amount": a.allocated_amount, "to_stock": a.to_stock,
                             "to_consumption": a.to_consumption} for a in v.allocations]}


# ── Landed-cost voucher ─────────────────────────────────────────────────────

def received_qty_by_line(db: Session, po) -> dict[int, float]:
    """Quantity received and still with us per PO line (GRNs not reversed;
    inspected lines net of rejections and returns)."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
    out: dict[int, float] = {}
    for gi in (db.query(P2PGoodsReceiptItem).join(P2PGoodsReceipt, P2PGoodsReceipt.id == P2PGoodsReceiptItem.goods_receipt_id)
               .filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status != "reversed").all()):
        if gi.receipt_posting == "none":
            continue
        decided = gi.quality_status in ("passed", "failed", "partial")
        q = max((gi.accepted_quantity or 0) - (gi.returned_quantity or 0), 0) if decided else (gi.received_quantity or 0)
        out[gi.po_item_id] = out.get(gi.po_item_id, 0.0) + float(q)
    return out


def _next_voucher_number(db: Session) -> str:
    from app.modules.p2p.service import _lock_number_series
    prefix = f"LCV-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(P2PLandedCostVoucher.voucher_number)).filter(P2PLandedCostVoucher.voucher_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


def post_voucher(db: Session, po, data: dict, user_id: int) -> P2PLandedCostVoucher:
    """Apportions a delivery cost billed after receipt and loads it into the
    moving-average value of the stock still on hand. Flushes; caller commits."""
    from app.modules.store.models.valuation import StoreValuationEvent
    from app.modules.store.services import valuation
    from app.modules.store.services.posting_period import assert_stock_postable

    c = clean_charge(data)
    if po.status == "cancelled":
        raise LandedCostError(f"PO {po.po_number} is cancelled — there is no receipt to load a delivery cost onto.", 409)
    if not valuation.valuation_enabled(db):
        raise LandedCostError("Stock valuation is switched off in Store › Settings, so a landed cost can't be loaded into stock value. "
                              "Switch valuation on (or book the charge as an expense in Finance).", 409)
    vdate = data.get("voucher_date") or date.today()
    if vdate > date.today():
        raise LandedCostError("The landed-cost voucher date can't be in the future.")
    try:
        assert_stock_postable(db, vdate)
    except ValueError as e:
        raise LandedCostError(str(e), 409)
    got = received_qty_by_line(db, po)
    lines = [l for l in _stock_lines(po) if got.get(l.id, 0) > _EPS and l.store_item_id]
    if not lines:
        raise LandedCostError(f"Nothing has been received into stock on PO {po.po_number} yet — receive the goods first. "
                              "A cost known before receipt belongs in the PO's planned delivery costs.", 409)
    fx = _fx(po)
    alloc = apportion(c["amount"], _weights(lines, c["basis"], fx, qty_of=lambda l: got[l.id]))
    v = P2PLandedCostVoucher(voucher_number=_next_voucher_number(db), purchase_order_id=po.id, voucher_date=vdate,
                             bill_reference=(data.get("bill_reference") or "").strip() or None,
                             remarks=(data.get("remarks") or "").strip() or None, created_by_id=user_id, **c)
    db.add(v)
    db.flush()
    by_item: dict[int, list] = {}
    for l in lines:
        by_item.setdefault(l.store_item_id, []).append(l)
    to_stock_total = to_cons_total = 0.0
    for item_id in sorted(by_item):  # global lock order
        val = valuation.lock_valuation(db, item_id)
        recv = sum(got[l.id] for l in by_item[item_id])
        on_hand_valued = max(float(val.qty or 0) - float(val.unvalued_qty or 0), 0.0)
        frac = min(1.0, on_hand_valued / recv) if recv > _EPS else 0.0
        item_stock = 0.0
        for l in by_item[item_id]:
            a = alloc.get(l.id, 0.0)
            ts = round(a * frac, 2)
            db.add(P2PLandedCostAllocation(voucher_id=v.id, po_item_id=l.id, store_item_id=item_id, basis_qty=got[l.id],
                                           basis_value=round(got[l.id] * float(l.unit_price or 0) * fx, 2), allocated_amount=a,
                                           to_stock=ts, to_consumption=round(a - ts, 2)))
            item_stock += ts
            to_stock_total += ts
            to_cons_total += round(a - ts, 2)
        if item_stock > 0:
            before = float(val.avg_rate) if val.avg_rate is not None else None
            val.value = round(float(val.value or 0) + item_stock, 2)
            after = round(val.value / on_hand_valued, 4) if on_hand_valued > _EPS else before
            val.avg_rate = after
            db.add(StoreValuationEvent(
                item_id=item_id, event_type="landed_cost", value_delta=item_stock, qty_basis=on_hand_valued,
                rate_before=before, rate_after=after, reference_type="landed_cost", reference_number=v.voucher_number,
                reason=(f"{P2P_CHARGE_TYPES[c['charge_type']]} ₹{c['amount']:,.2f} on PO {po.po_number} (voucher {v.voucher_number}) "
                        f"loaded into stock on hand"), created_by_id=user_id, event_date=vdate))
            if after is not None:
                valuation.mirror_average(db, item_id, after)
    v.value_to_stock = round(to_stock_total, 2)
    v.value_to_consumption = round(to_cons_total, 2)
    db.flush()
    return v
