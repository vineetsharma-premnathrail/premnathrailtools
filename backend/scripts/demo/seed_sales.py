"""Sales orders from won quotations / an awarded tender — confirmed, pending approval, returned, draft, rejected; amendments and DP extensions.

Everything goes through the real Sales API: the DEMO BD Executive raises the
order (prefilled from the CRM inquiry's accepted quotation or the tender's
LOA), attaches the customer's PO, and submits. Approval runs on the central
approval engine (Organization › Approval Workflows → "Sales order"), whose
default stages are the Sales limits: Sales Head always; + Director above
₹50 L (or non-standard terms); + Partner above ₹2 Cr (or non-standard terms).
The Sales Head is the head of the Sales / BD department (DEMO BD Head), the
Director / Partner are the DEMO Director / DEMO Partner. Confirmation issues
the SO number and closes the CRM inquiry as "Closed - Ordered".

  dmrc_rrv      DMRC 2 x RRV-8W (₹3.6 Cr) — Sales Head → Director → Partner approved: CONFIRMED, OA issued.
                Amendment 1 (spares kit 1 → 2) approved; amendment 2 (payment terms wording) PENDING Sales Head.
                DP extension for vehicle 2 GRANTED without LD (DMRC drawing approval late); one for vehicle 1 REQUESTED.
  nr_rgm        NR 1 x RGM-16 (₹1.12 Cr) — Sales Head approved, PENDING at the Director stage. Parked for you:
                as admin you can stand in (Sales › Orders › Approve, with a comment), or approve as DEMO Director.
  rvnl_tic      RVNL tender LOA, 2 x TIC-01 — submitted, RETURNED by the Sales Head for corrections (back in draft).
  crw_spares    CR Matunga rail guide wheels (direct order) — DRAFT, PO not yet attached.
  ircon_spares  IRCON hydraulic spares (direct order) — submitted, REJECTED by the Sales Head (cancelled).

demo.data keys set here:

  sales_orders  dict key -> {"id", "display_number", "so_number", "status", "grand_total", "customer" (customers key),
                "product_code", "qty", "inquiry_key" | "tender_key" | None, "lines": [line dicts], "schedules": [...]}.
                Keys: dmrc_rrv, nr_rgm, rvnl_tic, crw_spares, ircon_spares.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL


def _p(demo, key):
    return demo.data["people"][key]


def _day(demo, n: int) -> str:
    return (demo.today + timedelta(days=n)).isoformat()


def _product(demo, code):
    return demo.data.get("products", {}).get(code) or {}


def _billing(advance=20, delivery=70, commissioning=10):
    plan = [("advance", "Advance against bank guarantee", advance, 0),
            ("delivery", "On delivery at site (per vehicle)", delivery, 30),
            ("commissioning", "After commissioning & acceptance", commissioning, 30)]
    return [{"milestone_type": t, "description": f"{LABEL} {d}", "percent": p, "per_unit": t != "advance", "due_days": dd,
             **({"recovers_advance_percent": advance} if t == "delivery" else {})} for t, d, p, dd in plan if p]


def _common_terms(demo, prefill: dict | None = None) -> dict:
    pre = prefill or {}
    return {
        "price_basis": "for_destination", "freight_terms": "Freight & transit insurance included to site",
        "insurance_terms": "Transit insurance by supplier", "payment_terms_label": "20% advance / 70% delivery / 10% commissioning",
        "ld_applicable": True, "ld_rate_percent": pre.get("ld_rate_percent", 0.5), "ld_rate_period": pre.get("ld_rate_period", "week"),
        "ld_basis": pre.get("ld_basis", "delayed_value"), "ld_max_percent": pre.get("ld_max_percent", 10),
        "warranty_months_from_delivery": 30, "warranty_months_from_commissioning": 24, "warranty_rule": "earlier_of",
        "warranty_terms_text": f"{LABEL} 30 months from delivery or 24 months from commissioning, whichever is earlier.",
        "pbg_required": True, "pbg_percent": 10, "pbg_due_days": 30, "branch_id": demo.data.get("branch_id"),
        "remarks": f"{LABEL} sales order",
    }


def _attach(demo, so_id: int, doc_type: str, name: str, entity_type: str = "sales_order") -> None:
    demo.call("POST", "/sales/attachments", _p(demo, "bd"), data={"entity_type": entity_type, "entity_id": str(so_id), "doc_type": doc_type},
              files=[("files", demo.pdf(name))])


def _approve_chain(demo, so_id: int, approvers: list[str], stop_before: str | None = None) -> dict:
    """Approve stage by stage (Sales Head → Director → Partner) until confirmed, or stop before `stop_before`."""
    so = demo.call("GET", f"/sales/orders/{so_id}", _p(demo, "bd"))
    for key in approvers:
        if so["status"] != "pending_approval" or key == stop_before:
            break
        so = demo.call("POST", f"/sales/orders/{so_id}/approve", _p(demo, key),
                       json={"comment": f"{LABEL}: checked PO against quotation — approved."})
    return so


def _existing(demo, inquiry_id=None, tender_id=None, marker=None):
    from app.modules.sales.models.order import SalesOrder
    q = demo.db.query(SalesOrder).filter(SalesOrder.is_deleted == False)  # noqa: E712
    if inquiry_id:
        q = q.filter(SalesOrder.source_inquiry_id == inquiry_id)
    elif tender_id:
        q = q.filter(SalesOrder.source_tender_id == tender_id)
    else:
        q = q.filter(SalesOrder.customer_po_number == marker)
    row = q.order_by(SalesOrder.id.desc()).first()
    return demo.call("GET", f"/sales/orders/{row.id}", _p(demo, "bd")) if row else None


def _entry(so: dict, customer: str, code: str | None, qty: float, **link) -> dict:
    return {"id": so["id"], "display_number": so["display_number"], "so_number": so.get("so_number"), "status": so["status"],
            "grand_total": so["grand_total"], "customer": customer, "product_code": code, "qty": qty,
            "inquiry_key": link.get("inquiry_key"), "tender_key": link.get("tender_key"),
            "lines": so.get("lines", []), "schedules": so.get("schedules", [])}


# ── Orders from won quotations ─────────────────────────────────────────────

def order_from_inquiry(demo, inq_key: str, po_number: str, line_types: list[str], schedule: list[tuple], extra: dict) -> dict | None:
    """Sales › New order › 'From CRM inquiry' (prefill = the accepted quotation), PO attached, submitted."""
    bd = _p(demo, "bd")
    inq = demo.data.get("inquiries", {}).get(inq_key)
    if not inq:
        demo.note("sales", f"inquiry '{inq_key}' missing (crm seeder not run) — its sales order skipped")
        return None
    so = _existing(demo, inquiry_id=inq["id"])
    if so:
        return so
    pre = demo.call("GET", f"/sales/orders/prefill?inquiry={inq['id']}", bd)
    if not pre.get("source_quotation_id"):
        demo.note("sales", f"{inq_key}: no accepted quotation — {pre.get('note')}")
    code = inq.get("product_code")
    item_id = _product(demo, code).get("store_item_id")
    lines = []
    for ln, ltype in zip(pre["lines"], line_types):
        lines.append({**ln, "line_type": ltype, "product_item_id": item_id if ltype == "rrv" else None,
                      "hsn_sac_code": _product(demo, code).get("hsn_code") if ltype == "rrv" else ("9983" if ltype == "service" else "8607"),
                      "customer_line_ref": f"PO item {ln['line_number']}"})
    customer = demo.data["customers"][inq["customer"]]
    payload = {
        **_common_terms(demo, pre), **extra,
        "customer_id": pre["customer_id"], "customer_contact_id": pre.get("customer_contact_id"),
        "source_type": "inquiry", "source_inquiry_id": inq["id"], "source_quotation_id": pre.get("source_quotation_id"),
        "customer_po_number": po_number, "customer_po_date": _day(demo, -2), "customer_po_received_date": _day(demo, -1),
        "purchaser_name": customer["contacts"][-1]["name"] if customer.get("contacts") else None,
        "paying_authority": f"{LABEL} FA&CAO / Finance, {customer['name']}",
        "inspection_agency": pre.get("inspection_agency"), "third_party_inspection_required": pre.get("third_party_inspection_required", False),
        "delivery_terms_text": pre.get("delivery_terms_text"), "lines": lines,
        "schedule": [{"line_number": ln_no, "quantity": qty, "consignee_name": customer["name"], "consignee_address": customer.get("address"),
                      "contract_delivery_date": _day(demo, days)} for ln_no, qty, days in schedule],
        "billing_plan": _billing(),
    }
    so = demo.call("POST", "/sales/orders", bd, json=payload)
    _attach(demo, so["id"], "customer_po", f"DEMO-PO-{po_number.replace('/', '-')}.pdf")
    return demo.call("POST", f"/sales/orders/{so['id']}/submit", bd)


def seed_dmrc(demo) -> dict | None:
    so = order_from_inquiry(demo, "dmrc_rrv", "DEMO/DMRC/TRK/PO/2026/0457", ["rrv", "spares", "service"],
                            [(1, 1, 270), (1, 1, 300), (2, 1, 270)],
                            {"special_conditions": f"{LABEL} RITES inspection at works before dispatch; training at Mundka depot."})
    if not so:
        return None
    if so["status"] == "pending_approval":
        so = _approve_chain(demo, so["id"], ["bd_head", "director", "partner"])
        if so["status"] == "confirmed":
            so = demo.call("POST", f"/sales/orders/{so['id']}/issue-oa", _p(demo, "bd"))
            seed_amendments(demo, so)
            seed_extensions(demo, so)
            so = demo.call("GET", f"/sales/orders/{so['id']}", _p(demo, "bd"))
    return _entry(so, "dmrc", "DEMO-RRV-8W", 2, inquiry_key="dmrc_rrv")


def seed_nr(demo) -> dict | None:
    so = order_from_inquiry(demo, "nr_rgm", "DEMO/NR/LKO/ENGG/PO/2026/1189", ["rrv"], [(1, 1, 365)],
                            {"special_conditions": f"{LABEL} RDSO prototype inspection; profile library to be handed over on commissioning."})
    if not so:
        return None
    if so["status"] == "pending_approval":
        so = _approve_chain(demo, so["id"], ["bd_head", "director"], stop_before="director")
    demo.note("sales", f"{so['display_number']} waits at the Director stage — approve it yourself (admin stand-in) or as DEMO Director")
    return _entry(so, "northern_railway", "DEMO-RGM-16", 1, inquiry_key="nr_rgm")


# ── Amendments & DP extensions on the confirmed DMRC order ─────────────────

def seed_amendments(demo, so: dict) -> None:
    bd = _p(demo, "bd")
    # 1: customer letter adds a second spares kit — approved by the Sales Head.
    a = demo.call("POST", f"/sales/orders/{so['id']}/amendments", bd, json={
        "reason": f"{LABEL}: DMRC letter — second recommended spares kit for the depot",
        "customer_amendment_ref": "DEMO/DMRC/TRK/AMD/01", "customer_amendment_date": _day(demo, -1)})
    lines = [{**ln, "quantity": 2} if ln["line_type"] == "spares" else ln for ln in a["proposed"]["lines"]]
    spares_no = next(ln["line_number"] for ln in lines if ln["line_type"] == "spares")
    schedule = [{**r, "quantity": 2} if r.get("line_number") == spares_no else r for r in a["proposed"]["schedule"]]
    demo.call("PATCH", f"/sales/amendments/{a['id']}", bd, json={"lines": lines, "schedule": schedule})
    _attach(demo, a["id"], "amendment_letter", "DEMO-DMRC-amendment-01.pdf", entity_type="sales_amendment")
    demo.call("POST", f"/sales/amendments/{a['id']}/submit", bd)
    a = demo.call("POST", f"/sales/amendments/{a['id']}/approve", _p(demo, "bd_head"), json={"comment": f"{LABEL}: as per DMRC letter."})
    # 2: wording change, left pending with the Sales Head.
    b = demo.call("POST", f"/sales/orders/{so['id']}/amendments", bd, json={
        "reason": f"{LABEL}: DMRC letter — advance to be released against PBG only",
        "customer_amendment_ref": "DEMO/DMRC/TRK/AMD/02", "customer_amendment_date": demo.today.isoformat()})
    demo.call("PATCH", f"/sales/amendments/{b['id']}", bd, json={"header": {
        "payment_terms_label": "20% advance against PBG / 70% delivery / 10% commissioning",
        "special_conditions": f"{LABEL} RITES inspection at works; advance released only against a PBG of 10%."}})
    b = demo.call("POST", f"/sales/amendments/{b['id']}/submit", bd)
    demo.note("sales", f"amendments on {so['display_number']}: #{a['amendment_no']} {a['status']}, #{b['amendment_no']} {b['status']}")


def seed_extensions(demo, so: dict) -> None:
    bd = _p(demo, "bd")
    rows = sorted([r for r in so["schedules"] if r["status"] != "cancelled"], key=lambda r: (r["so_line_id"], r["sequence"]))
    v1, v2 = rows[0], rows[1]
    e1 = demo.call("POST", f"/sales/orders/{so['id']}/extensions", bd, json={
        "schedule_ids": [v2["id"]], "requested_new_date": (_date(v2) + timedelta(days=30)).isoformat(),
        "reason_category": "customer_cause", "reason": f"{LABEL}: DMRC approved the GA drawing 5 weeks late.",
        "customer_letter_ref": "DEMO/PRT/DMRC/DPX/01", "customer_letter_date": _day(demo, -3)})
    demo.call("POST", f"/sales/extensions/{e1['id']}/grant", _p(demo, "bd_head"), json={
        "granted_new_date": (_date(v2) + timedelta(days=30)).isoformat(), "with_ld": False,
        "customer_letter_ref": "DEMO/DMRC/TRK/DPX/2026/07", "customer_letter_date": _day(demo, -1),
        "remarks": f"{LABEL}: granted without LD — delay on customer's side."})
    demo.call("POST", f"/sales/orders/{so['id']}/extensions", bd, json={
        "schedule_ids": [v1["id"]], "requested_new_date": (_date(v1) + timedelta(days=21)).isoformat(),
        "reason_category": "our_cause", "reason": f"{LABEL}: Stage V engine delivery delayed by the OEM (3 weeks).",
        "customer_letter_ref": "DEMO/PRT/DMRC/DPX/02", "customer_letter_date": demo.today.isoformat()})
    demo.note("sales", f"DP extensions on {so['display_number']}: vehicle {v2['sequence']} granted (no LD), vehicle {v1['sequence']} requested")


def _date(row: dict):
    from datetime import date
    return date.fromisoformat(row.get("current_delivery_date") or row["contract_delivery_date"])


# ── Tender LOA and direct orders ──────────────────────────────────────────

def seed_rvnl(demo) -> dict | None:
    bd = _p(demo, "bd")
    t = demo.data.get("tenders", {}).get("rvnl_tic")
    if not t:
        demo.note("sales", "tender 'rvnl_tic' missing (crm seeder not run) — its sales order skipped")
        return None
    so = _existing(demo, tender_id=t["id"])
    if not so:
        pre = demo.call("GET", f"/sales/orders/prefill?tender={t['id']}", bd)
        customer = demo.data["customers"]["rvnl"]
        prod = _product(demo, "DEMO-TIC-01")
        so = demo.call("POST", "/sales/orders", bd, json={
            **_common_terms(demo, pre), "customer_id": pre["customer_id"], "customer_contact_id": pre.get("customer_contact_id"),
            "source_type": "tender", "source_tender_id": t["id"], "loa_number": pre.get("loa_number"), "loa_date": _day(demo, -5),
            "customer_po_number": pre.get("loa_number"), "customer_po_date": _day(demo, -5), "customer_po_received_date": _day(demo, -4),
            "purchaser_name": pre.get("purchaser_name"), "paying_authority": f"{LABEL} GM / Finance, {customer['name']}",
            "inspection_agency": "rites", "third_party_inspection_required": True,
            "lines": [{"line_number": 1, "line_type": "rrv", "rrv_model": prod.get("model_number"), "product_item_id": prod.get("store_item_id"),
                       "description": f"{LABEL} Track Inspection Car TIC-01 as per tender specification", "hsn_sac_code": prod.get("hsn_code"),
                       "quantity": 2, "unit_price": 16864400, "gst_rate": 18, "uom": "NOS"}],
            "schedule": [{"line_number": 1, "quantity": 1, "consignee_name": customer["name"], "contract_delivery_date": _day(demo, d)}
                         for d in (300, 330)],
            "billing_plan": _billing(advance=10, delivery=80, commissioning=10),
        })
        _attach(demo, so["id"], "loa", "DEMO-RVNL-LOA-2026-031.pdf")
        so = demo.call("POST", f"/sales/orders/{so['id']}/submit", bd)
        if so["status"] == "pending_approval":
            so = demo.call("POST", f"/sales/orders/{so['id']}/return", _p(demo, "bd_head"), json={
                "reason": f"{LABEL}: LOA asks for PBG of 5%, not 10% — correct the PBG and the advance (10%) recovery, then resubmit."})
    return _entry(so, "rvnl", "DEMO-TIC-01", 2, tender_key="rvnl_tic")


def _direct_order(demo, key: str, customer_key: str, po: str, item_code: str, qty: int, price: float, submit: bool):
    bd = _p(demo, "bd")
    so = _existing(demo, marker=po)
    if so:
        return so
    customer = demo.data.get("customers", {}).get(customer_key)
    if not customer:
        demo.note("sales", f"customer '{customer_key}' missing — {key} skipped")
        return None
    item = demo.data.get("items", {}).get(item_code, {})
    so = demo.call("POST", "/sales/orders", bd, json={
        **_common_terms(demo), "order_type": "spares", "customer_id": customer["id"], "customer_contact_id": customer["contact_ids"][0],
        "source_type": "direct", "customer_po_number": po, "customer_po_date": _day(demo, -6), "customer_po_received_date": _day(demo, -5),
        "pbg_required": False, "warranty_months_from_delivery": 12, "warranty_months_from_commissioning": 12, "warranty_rule": "from_delivery",
        "lines": [{"line_number": 1, "line_type": "spares", "product_item_id": item.get("id"),
                   "description": item.get("name") or f"{LABEL} spares", "hsn_sac_code": item.get("hsn_code"),
                   "uom": item.get("unit") or "NOS", "quantity": qty, "unit_price": price, "gst_rate": 18}],
        "schedule": [{"line_number": 1, "quantity": qty, "consignee_name": customer["name"], "contract_delivery_date": _day(demo, 45)}],
        "billing_plan": [{"milestone_type": "delivery", "description": f"{LABEL} 100% on delivery", "percent": 100, "due_days": 30}],
    })
    if submit:
        _attach(demo, so["id"], "customer_po", f"DEMO-PO-{po.replace('/', '-')}.pdf")
        so = demo.call("POST", f"/sales/orders/{so['id']}/submit", bd)
    return so


def seed_direct(demo) -> dict:
    out = {}
    crw = _direct_order(demo, "crw_spares", "central_railway_workshop", "DEMO/CR/MTN/STR/PO/2026/3321", "DEMO-MEC-WHEEL-430", 8, 52000, submit=False)
    if crw:
        out["crw_spares"] = _entry(crw, "central_railway_workshop", None, 8)
    ircon = _direct_order(demo, "ircon_spares", "ircon", "DEMO/IRCON/MECH/PO/2026/0088", "DEMO-HYD-SEAL-KIT-63", 20, 1650, submit=True)
    if ircon:
        if ircon["status"] == "pending_approval":
            ircon = demo.call("POST", f"/sales/orders/{ircon['id']}/reject", _p(demo, "bd_head"), json={
                "reason": f"{LABEL}: IRCON's PO quotes last year's price list — ask them for a fresh PO at current prices."})
        out["ircon_spares"] = _entry(ircon, "ircon", None, 20)
    return out


def seed(demo) -> None:
    orders = {}
    for key, fn in (("dmrc_rrv", seed_dmrc), ("nr_rgm", seed_nr), ("rvnl_tic", seed_rvnl)):
        so = fn(demo)
        if so:
            orders[key] = so
    orders.update(seed_direct(demo))
    demo.data["sales_orders"] = orders
    demo.note("sales", "sales orders: " + ", ".join(f"{o['display_number']} {o['status']}" for o in orders.values()))
