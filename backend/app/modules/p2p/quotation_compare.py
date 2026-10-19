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
line (a partial quote can't be the overall L1)."""
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


def comparison(db: Session, rfq: RFQ, pr: P2PRequest) -> dict:
    from app.modules.p2p.info_records import last_po_price
    from app.modules.p2p.po_split import buy_qty_by_pr_item

    buy = buy_qty_by_pr_item(pr)
    lines = [i for i in pr.items if i.id in buy]
    quotes = [vq for vq in rfq.vendor_quotations if vq.items]
    today = date.today()

    cells: dict[tuple[int, int], dict] = {}
    vendor_cols = []
    for vq in quotes:
        by_line = {qi.pr_item_id: qi for qi in vq.items}
        net_value = sum(_net_unit(qi) * (qi.quantity or buy.get(qi.pr_item_id, 0)) for qi in vq.items)
        charges = (vq.freight_total or 0) + (vq.packing_total or 0)
        why_not = quote_ineligible_reason(vq, rfq, today)
        landed_total = 0.0
        gross_total = 0.0
        for line in lines:
            qi = by_line.get(line.id)
            if qi is None:
                continue
            qty = buy[line.id]
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
        rows.append({
            "pr_item_id": line.id, "store_item_id": line.store_item_id, "item_code": line.item_code, "item_name": line.item_name,
            "unit": line.unit, "quantity": buy[line.id],
            "l1_vendor_quotation_id": l1["vendor_quotation_id"] if l1 else None,
            "l1_vendor_quotation_item_id": l1["vendor_quotation_item_id"] if l1 else None,
            "awarded_vendor_quotation_id": next((c["vendor_quotation_id"] for (lid, _), c in cells.items() if lid == line.id and c["is_awarded"]), None),
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
