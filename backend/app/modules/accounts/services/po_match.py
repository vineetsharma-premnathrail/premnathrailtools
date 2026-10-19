"""Line-level 3-way match (SAP MIRO per item: PO line / GR / invoice line).

Each vendor-invoice line names its PO line (po_item_id). Per PO line:

  received     = accepted quantity still with us (GRN lines decided, net of
                 Return to Vendor) — or, for a service line, the quantity on
                 accepted service entries;
  open         = received - already invoiced on earlier bills;
  quantity     : invoiced more than `open` by over the quantity tolerance
                 → variance (invoicing less than received is normal —
                 the rest is billed later);
  price        : invoice rate (after discount) vs the PO line's rate, outside
                 the % tolerance OR above the absolute ₹ cap → variance.

Quantities are compared in the PO line's unit only — a line billed in a
different unit is refused, never converted or summed with other units.
Tolerances are Procurement › Settings › Invoice match tolerances (OMR6)."""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

_EPS = 1e-9


def tolerances(db: Session) -> dict[str, float]:
    from app.modules.p2p.settings import get_setting
    return {
        "qty_tol_pct": float(get_setting(db, "invoice_qty_tolerance_pct") or 0),
        "price_tol_pct": float(get_setting(db, "invoice_price_tolerance_pct") or 0),
        "price_tol_abs": float(get_setting(db, "invoice_price_tolerance_abs") or 0),
    }


def received_by_po_item(db: Session, po) -> dict[int, float]:
    """Accepted-and-kept quantity per PO line (stock / asset lines from the
    GRNs, service lines from accepted service entries)."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
    from app.modules.p2p.service import accepted_service_qty_by_po_item

    out: dict[int, float] = {}
    grns = (db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id == po.id, P2PGoodsReceipt.status != "reversed")
            .options(selectinload(P2PGoodsReceipt.items)).all())
    for g in grns:
        for it in g.items:
            if it.quality_status not in ("passed", "failed", "partial"):
                continue
            kept = max((it.accepted_quantity or 0) - (it.returned_quantity or 0), 0.0)
            out[it.po_item_id] = out.get(it.po_item_id, 0.0) + kept
    for pid, qty in accepted_service_qty_by_po_item(db, po.id).items():
        out[pid] = out.get(pid, 0.0) + qty
    return out


def invoiced_by_po_item(db: Session, po_item_ids: set[int], exclude_invoice_id: int | None = None) -> dict[int, float]:
    from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine

    if not po_item_ids:
        return {}
    q = (db.query(VendorInvoiceLine.po_item_id, func.coalesce(func.sum(VendorInvoiceLine.quantity), 0))
         .join(VendorInvoice, VendorInvoiceLine.vendor_invoice_id == VendorInvoice.id)
         .filter(VendorInvoiceLine.po_item_id.in_(po_item_ids), VendorInvoice.status != "cancelled"))
    if exclude_invoice_id:
        q = q.filter(VendorInvoice.id != exclude_invoice_id)
    return {pid: float(q_) for pid, q_ in q.group_by(VendorInvoiceLine.po_item_id).all()}


def _same_unit(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def assign_po_lines(po, lines: list[dict]) -> None:
    """Every line of a PO invoice must name its PO line. On a single-line PO
    the line is unambiguous and filled in; otherwise a missing one is refused."""
    items = list(po.items)
    for i, l in enumerate(lines, start=1):
        if l.get("po_item_id"):
            continue
        if len(items) == 1:
            l["po_item_id"] = items[0].id
            continue
        raise ValueError(
            f"Line {i}: pick which line of PO '{po.po_number}' this invoice line is for — each bill line is matched to its own "
            f"PO line and its goods receipt (use 'Load PO lines' to start from the PO)."
        )


def match_lines(db: Session, po, lines: list[dict], *, exclude_invoice_id: int | None = None) -> dict:
    """Per-PO-line match of invoice `lines` (dicts with po_item_id, quantity,
    rate, discount_amount?, uom?). Raises ValueError for a line on another PO
    or billed in a different unit. Returns {"lines": [per PO line result],
    "line_results": [per invoice line {match_status, qty_variance,
    price_variance}], "reasons": [...], "tolerances": {...}}."""
    tol = tolerances(db)
    po_items = {i.id: i for i in po.items}
    groups: dict[int, dict] = {}
    for i, l in enumerate(lines, start=1):
        pid = l.get("po_item_id")
        item = po_items.get(pid)
        if item is None:
            raise ValueError(f"Line {i}: PO line #{pid} is not on PO '{po.po_number}' — pick the line from this invoice's own PO.")
        if l.get("uom") and item.unit and not _same_unit(l["uom"], item.unit):
            raise ValueError(
                f"Line {i}: billed in '{l['uom']}' but PO line '{item.item_name}' is ordered in '{item.unit}'. Enter the quantity in "
                f"the PO unit ({item.unit}) — quantities in different units are never compared or added together."
            )
        qty = float(l.get("quantity") or 0)
        value = qty * float(l.get("rate") or 0) - float(l.get("discount_amount") or 0)
        g = groups.setdefault(pid, {"qty": 0.0, "value": 0.0, "line_idx": []})
        g["qty"] += qty
        g["value"] += value
        g["line_idx"].append(i - 1)

    received = received_by_po_item(db, po)
    invoiced = invoiced_by_po_item(db, set(groups), exclude_invoice_id)
    results, reasons = [], []
    line_results: list[dict] = [{} for _ in lines]
    for pid, g in groups.items():
        item = po_items[pid]
        rec, before = received.get(pid, 0.0), invoiced.get(pid, 0.0)
        open_qty = rec - before
        inv_qty = g["qty"]
        inv_rate = g["value"] / inv_qty if inv_qty > _EPS else 0.0
        po_rate = float(item.unit_price) if item.unit_price is not None else None
        line_reasons: list[str] = []
        qty_var = inv_qty - open_qty
        if open_qty <= _EPS:
            qty_var_pct = 100.0
            line_reasons.append(f"'{item.item_name}': nothing received and not yet invoiced ({rec:g} received, {before:g} already invoiced)")
        else:
            qty_var_pct = qty_var / open_qty * 100
            if qty_var_pct > tol["qty_tol_pct"] + _EPS:
                line_reasons.append(f"'{item.item_name}': invoiced {inv_qty:g} {item.unit or ''} vs {open_qty:g} received and not yet invoiced".replace("  ", " "))
        if po_rate is None:
            price_var = None
            price_var_pct = None
            line_reasons.append(f"'{item.item_name}': the PO line has no unit price, so there is no agreed rate to match against")
        else:
            price_var = round((inv_rate - po_rate) * inv_qty, 2)
            price_var_pct = (inv_rate - po_rate) / po_rate * 100 if po_rate else (0.0 if abs(inv_rate) < _EPS else 100.0)
            over_pct = abs(price_var_pct) > tol["price_tol_pct"] + _EPS
            over_abs = tol["price_tol_abs"] > 0 and abs(price_var) > tol["price_tol_abs"] + _EPS
            if over_pct or over_abs:
                why = f"{price_var_pct:+.2f}%" + (f", {price_var:+,.2f} on the line" if over_abs else "")
                line_reasons.append(f"'{item.item_name}': invoice rate {inv_rate:,.2f} vs PO rate {po_rate:,.2f} ({why})")
        status = "variance" if line_reasons else "matched"
        reasons.extend(line_reasons)
        results.append({
            "po_item_id": pid, "item_name": item.item_name, "unit": item.unit, "category": item.category,
            "ordered_qty": item.quantity, "received_qty": round(rec, 4), "already_invoiced_qty": round(before, 4),
            "invoice_qty": round(inv_qty, 4), "open_qty": round(open_qty, 4), "qty_variance": round(qty_var, 4),
            "qty_variance_pct": round(qty_var_pct, 2), "po_rate": po_rate, "invoice_rate": round(inv_rate, 4),
            "price_variance": price_var, "price_variance_pct": round(price_var_pct, 2) if price_var_pct is not None else None,
            "match_status": status, "reasons": line_reasons,
        })
        for n, idx in enumerate(g["line_idx"]):
            l = lines[idx]
            lq = float(l.get("quantity") or 0)
            lv = lq * float(l.get("rate") or 0) - float(l.get("discount_amount") or 0)
            line_results[idx] = {
                "match_status": status,
                # The quantity difference belongs to the PO line — carried on its first invoice line only.
                "qty_variance": round(qty_var, 4) if n == 0 else 0.0,
                "price_variance": round(lv - lq * po_rate, 2) if po_rate is not None else None,
            }
    return {"lines": results, "line_results": line_results, "reasons": reasons, "tolerances": tol}
