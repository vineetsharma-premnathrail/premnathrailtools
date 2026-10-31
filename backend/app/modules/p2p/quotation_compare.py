"""ME49 price comparison over the ME47 line-level quotations of one RFQ.

Ranking basis (per PR line): the landed unit cost excluding GST —
    net unit      = unit price x (1 - discount %)
    charge share  = (quote freight + packing) x line net value / quote net value
    landed unit   = net unit + charge share / quantity
GST is shown but not ranked: it is input tax credit, so it does not change
what the item costs the company. A quote is out of the ranking when it is
technically disqualified, commercially rejected, or past its validity date.

L1 per line = lowest landed unit among eligible quotes for that line.
Overall L1 = lowest landed total among eligible vendors that quoted EVERY
line (a partial quote can't be the overall L1).

An RFQ belongs to ONE buyer and carries an explicit set of requisition lines
(rfq.items, active = not withdrawn): the comparison covers only those lines,
never the whole requisition. A line can be split by quantity across vendors
(awarded_qty per quote line); each row lists its awards, the quantity awarded
in total and what is still open to order."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.vendor_quotation import VendorQuotation


def _net_unit(qi) -> float:
    return round((qi.unit_price or 0) * (1 - (qi.discount_pct or 0) / 100), 4)


def quote_ineligible_reason(vq: VendorQuotation, rfq: RFQ, today: date | None = None) -> str | None:
    today = today or date.today()
    if rfq.requires_technical_evaluation and vq.technical_status == "disqualified":
        return "technically disqualified"
    if vq.commercial_status == "rejected":
        return "commercially rejected"
    if vq.valid_until and vq.valid_until < today:
        return f"quote expired on {vq.valid_until.strftime('%d-%m-%Y')}"
    return None


def awarded_qty_of(qi) -> float:
    """Quantity awarded on a quote line. An award from before split awards (is_awarded, no
    quantity) means the whole quoted quantity."""
    if qi.awarded_qty is not None:
        return qi.awarded_qty or 0.0
    return (qi.quantity or 0.0) if qi.is_awarded else 0.0


def rfq_line_ids(rfq: RFQ) -> set[int]:
    """The requisition lines this RFQ currently asks quotes for (not withdrawn)."""
    return {i.pr_item_id for i in rfq.items if i.withdrawn_at is None}


def comparison(db: Session, rfq: RFQ, pr: P2PRequest) -> dict:
    from app.modules.p2p.info_records import last_po_price
    from app.modules.p2p.line_progress import line_progress
    from app.modules.p2p.po_split import buy_qty_by_pr_item

    buy = buy_qty_by_pr_item(pr)
    on_rfq = {i.pr_item_id: i for i in rfq.items if i.withdrawn_at is None}
    lines = [i for i in pr.items if i.id in buy and i.id in on_rfq]
    progress = line_progress(db, pr)
    # Quantity the RFQ asks for per line: what it was raised for, never more than is still to buy.
    ask = {l.id: min(on_rfq[l.id].quantity or buy[l.id], buy[l.id]) for l in lines}
    line_ids = {l.id for l in lines}
    # A quote that only prices lines which have left this RFQ has nothing to compare.
    quotes = [vq for vq in rfq.vendor_quotations if any(qi.pr_item_id in line_ids for qi in vq.items)]
    today = date.today()

    cells: dict[tuple[int, int], dict] = {}
    vendor_cols = []
    for vq in quotes:
        by_line = {qi.pr_item_id: qi for qi in vq.items}
        net_value = sum(_net_unit(qi) * (qi.quantity or ask.get(qi.pr_item_id, 0)) for qi in vq.items if qi.pr_item_id in line_ids)
        charges = (vq.freight_total or 0) + (vq.packing_total or 0)
        why_not = quote_ineligible_reason(vq, rfq, today)
        landed_total = 0.0
        gross_total = 0.0
        for line in lines:
            qi = by_line.get(line.id)
            if qi is None:
                continue
            qty = ask[line.id]
            net = _net_unit(qi)
            share = charges * (net * qty) / net_value if net_value else 0
            landed_unit = round(net + (share / qty if qty else 0), 4)
            landed = round(landed_unit * qty, 2)
            gst = round(landed * (qi.gst_rate or 0) / 100, 2)
            landed_total += landed
            gross_total += landed + gst
            cells[(line.id, vq.id)] = {
                "vendor_quotation_id": vq.id, "vendor_quotation_item_id": qi.id, "unit_price": qi.unit_price,
                "discount_pct": qi.discount_pct, "net_unit": net, "charge_share": round(share, 2), "landed_unit": landed_unit,
                "landed_value": landed, "gst_rate": qi.gst_rate, "gst_amount": gst, "value_incl_gst": round(landed + gst, 2),
                "delivery_days": qi.delivery_days, "make_offered": qi.make_offered, "remarks": qi.remarks,
                "is_awarded": qi.is_awarded, "award_reason": qi.award_reason, "eligible": why_not is None, "rank": None,
                "quote_quantity": qi.quantity if qi.quantity is not None else ask[line.id], "awarded_qty": awarded_qty_of(qi),
            }
        vendor_cols.append({
            "vendor_quotation_id": vq.id, "vendor_id": vq.vendor_id, "vendor_name": vq.vendor_name, "quote_ref": vq.quote_ref,
            "valid_until": vq.valid_until, "freight_total": vq.freight_total, "packing_total": vq.packing_total,
            "payment_terms": vq.payment_terms, "technical_status": vq.technical_status, "commercial_status": vq.commercial_status,
            "eligible": why_not is None, "ineligible_reason": why_not, "lines_quoted": sum(1 for l in lines if l.id in by_line),
            "landed_total": round(landed_total, 2), "total_incl_gst": round(gross_total, 2), "complete": all(l.id in by_line for l in lines),
            "overall_rank": None,
        })

    rows = []
    best_of_lines = 0.0
    for line in lines:
        ranked = sorted((c for (lid, _), c in cells.items() if lid == line.id and c["eligible"]), key=lambda c: c["landed_unit"])
        for n, c in enumerate(ranked, start=1):
            c["rank"] = f"L{n}"
        l1 = ranked[0] if ranked else None
        if l1:
            best_of_lines += l1["landed_value"]
        last = last_po_price(db, line.store_item_id)
        awards = [{"vendor_quotation_id": c["vendor_quotation_id"], "vendor_quotation_item_id": c["vendor_quotation_item_id"],
                   "quantity": c["awarded_qty"]} for (lid, _), c in cells.items() if lid == line.id and c["awarded_qty"] > 0]
        lp = progress.get(line.id)
        rows.append({
            "pr_item_id": line.id, "store_item_id": line.store_item_id, "item_code": line.item_code, "item_name": line.item_name,
            "unit": line.unit, "quantity": ask[line.id],
            "awards": awards, "awarded_total": round(sum(a["quantity"] for a in awards), 6),
            "open_qty": lp.open_to_order if lp is not None else ask[line.id],
            "l1_vendor_quotation_id": l1["vendor_quotation_id"] if l1 else None,
            "l1_vendor_quotation_item_id": l1["vendor_quotation_item_id"] if l1 else None,
            "awarded_vendor_quotation_id": next((c["vendor_quotation_id"] for (lid, _), c in cells.items() if lid == line.id and c["awarded_qty"] > 0), None),
            "last_po": last,
            "quotes": [cells[(line.id, vq.id)] if (line.id, vq.id) in cells else None for vq in quotes],
        })

    overall = sorted((v for v in vendor_cols if v["eligible"] and v["complete"]), key=lambda v: v["landed_total"])
    for n, v in enumerate(overall, start=1):
        v["overall_rank"] = f"L{n}"
    return {
        "rfq_id": rfq.id, "rfq_number": rfq.rfq_number, "p2p_request_id": pr.id, "p2p_number": pr.p2p_number,
        "vendors": vendor_cols, "lines": rows,
        "overall_l1_vendor_quotation_id": overall[0]["vendor_quotation_id"] if overall else None,
        "best_of_lines_total": round(best_of_lines, 2),
        "basis": "Landed unit cost excl. GST: price after discount plus the line's share of the quote's freight and packing.",
    }


def line_l1(db: Session, rfq: RFQ, pr: P2PRequest, pr_item_id: int) -> int | None:
    """vendor_quotation_item_id of the L1 quote for one PR line."""
    data = comparison(db, rfq, pr)
    row = next((r for r in data["lines"] if r["pr_item_id"] == pr_item_id), None)
    return row["l1_vendor_quotation_item_id"] if row else None
