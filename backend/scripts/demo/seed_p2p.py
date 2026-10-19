"""Procurement (P2P): purchase requisitions at every stage, RFQs with vendor quotations and evaluation, POs, GRNs.

Everything goes through the real Procurement / Store › GRN API as the right
demo person, so PR / RFQ / PO / GRN numbers, the central approval engine
(Organization › Approval Workflows: "Purchase requisition" = any holder of
p2p:purchase_requisitions:approve; "Purchase order" = PO approvers, then any
one Partner), stock posting and Quality inspection lots are all real.

Who does what:
  requesters   design / hydraulic / electrical / production / maintenance people (pr_raise)
  PR approval  store_manager, design_head, production_manager, project_manager (permission holders)
  buyer        assigned on the PR, runs the RFQ, records quotations, drafts and submits the PO
  purchase_manager  technical / commercial evaluation (rfq approve/reject), GRN inspection
  partner      final PO approval (any one Partner)
  store_keeper records the GRN into DEMO Main Store
  demo.me      one PO is left waiting at the Partner stage — as admin you can stand in
               from My Approvals (with a comment) or approve it from the PR page.

Requisitions (demo.data["prs"] key → PR dict from the API, re-read at the end):
  awaiting_approval  submitted, waiting for a PR approver (orbital motor — zero stock item)
  returned           returned for changes by the approver (engine "return")
  rejected           rejected by the Store Manager (batteries are in stock)
  approved_for_rfq   approved, buyer assigned, lines sent to procurement — RFQ not started
  technical_eval     RFQ locked, 3 vendor quotations, technical evaluation half done
  vendor_selected    commercial evaluation done, L1 vendor selected — PO not drafted yet
  po_for_me          PO raised, waiting for the final Partner approval (left for demo.me) — PLC CPU (zero stock)
  po_approved        PO approved, nothing received, expected delivery already past (overdue)
  partly_received    PO approved, GRN for part of the quantity, inspected → partially_received
  fully_received     PO approved, GRN for the full quantity, inspected → received
  in_quality         PO approved, GRN of inspection-controlled items → QUALITY stock + one
                     incoming inspection lot per line (decided later by the quality seeder)
  issue_from_stock   approved, every line issued from store stock → closed (no purchase)
  design_bom         only when an upstream design seeder left `design_boms`: the BOM lines
                     that match DEMO items, submitted for approval

Other keys:
  purchase_orders  dict PR key → PO dict (po_for_me, po_approved, partly_received,
                   fully_received, in_quality)
  grns             dict key → GRN dict: partial (partly_received), full (fully_received),
                   in_quality (lines in Quality stock, lots open)
  rfqs             dict PR key → RFQ dict

Known gap (noted at run time): the PR workflow is "any one approver", so a PR
can't sit with "some approvals done, some pending" unless an admin changes the
workflow to "all must approve" — not done here (it is real configuration).
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL

TAG = "[DEMO-SEED p2p:{key}]"
SHIP_TO = f"{LABEL} Main Store"


# ── small helpers ─────────────────────────────────────────────────────────

def _people(demo):
    return demo.data["people"]


def _item(demo, code):
    return demo.data["items"][code]


def _line(demo, code, qty, use="Project"):
    it = _item(demo, code)
    return {"item_name": it["name"], "unit": it["unit"], "quantity": qty, "project_inhouse": use,
            "make": it.get("make"), "ship_to": SHIP_TO, "category": it.get("category")}


def _project_label(demo) -> str:
    """The project a PR is raised against: a Service-module machine/project
    if the erp seeder made one, else a named DEMO project."""
    for key in ("pm_projects", "projects", "rnd_projects"):
        rows = demo.data.get(key)
        if isinstance(rows, dict) and rows:
            first = next(iter(rows.values()))
            if isinstance(first, dict):
                label = first.get("label") or first.get("name") or first.get("title") or first.get("project_code")
                if label:
                    return str(label)
    return f"{LABEL} PEW-901 — RRV-8W for Northern Railway (Lucknow)"


def _existing(demo, key):
    from app.modules.p2p.models.p2p_request import P2PRequest
    row = demo.db.query(P2PRequest).filter(P2PRequest.remarks.like(f"%{TAG.format(key=key)}%")).first()
    return demo.call("GET", f"/p2p/requests/{row.id}", demo.me) if row else None


def create_pr(demo, key, requester, category, lines, *, purpose, priority="medium", days=21,
              requirement_type="Material", project=None):
    """One purchase requisition (POST /p2p/requests) — goes straight into the
    approval engine. Re-run safe: an existing PR with the same seed tag is reused."""
    found = _existing(demo, key)
    if found:
        demo.data.setdefault("_reused_prs", set()).add(key)
        return found
    pr = demo.call("POST", "/p2p/requests", requester, json={
        "project_label": project or _project_label(demo), "project_type": "existing", "category_code": category,
        "requirement_type": requirement_type, "priority": priority,
        "required_date": str(demo.today + timedelta(days=days)),
        "remarks": f"{LABEL} {purpose} {TAG.format(key=key)}", "items": lines,
    })
    demo.note("p2p", f"PR {pr['p2p_number']} raised by {requester.name} ({key})")
    return pr


def _reused(demo, key) -> bool:
    return key in demo.data.get("_reused_prs", set())


def approve_pr(demo, pr, approver, comment):
    """PR approval through the engine (compat endpoint /approve; comment mandatory)."""
    return demo.call("POST", f"/p2p/requests/{pr['id']}/approve", approver, json={"comment": comment})


def reject_pr(demo, pr, approver, reason):
    return demo.call("POST", f"/p2p/requests/{pr['id']}/reject", approver, json={"reason": reason})


def return_pr(demo, pr, approver, comment):
    """Return for changes — only the central /approvals endpoint has 'return'."""
    req_id = (pr.get("engine_approval") or {}).get("request_id")
    if not req_id:
        demo.note("p2p", f"{pr['p2p_number']}: no engine approval request found — can't return it for changes")
        return pr
    demo.call("POST", f"/approvals/requests/{req_id}/decide", approver, json={"decision": "return", "comment": comment})
    return demo.call("GET", f"/p2p/requests/{pr['id']}", approver)


def assign_buyer(demo, pr):
    """The purchase manager hands the approved PR to the DEMO buyer and every
    still-undecided line goes to procurement (they're all short in store)."""
    p = _people(demo)
    pr = demo.call("POST", f"/p2p/requests/{pr['id']}/assign-buyer", p["purchase_manager"],
                   json={"assigned_buyer_id": p["buyer"].id})
    for line in pr["items"]:
        if line["fulfillment_status"] == "pending":
            pr = demo.call("POST", f"/p2p/requests/{pr['id']}/items/{line['id']}/send-to-procurement", p["buyer"])
    return pr


def create_rfq(demo, pr, quotes, *, technical=False):
    """RFQ for the PR: one vendor quotation file per tier (L1 lowest) from the
    shared vendor master, commercial terms, lock, then the quotations
    recorded for comparison. `quotes` = [(vendor key, price, delivery)]."""
    buyer = _people(demo)["buyer"]
    vendors = demo.data["vendors"]
    rfq = demo.call("POST", "/p2p/rfqs", buyer, json={"p2p_request_id": pr["id"], "requires_technical_evaluation": technical})
    for i, (vkey, _price, _dt) in enumerate(quotes, 1):
        v = vendors[vkey]
        demo.call("POST", f"/p2p/rfqs/{rfq['id']}/attachments", buyer,
                  data={"vendor_tier": f"L{i}", "vendor_id": str(v["id"])},
                  files=[("files", demo.pdf(f"{LABEL}-{rfq['rfq_number']}-L{i}-{v['code']}.pdf"))])
    demo.call("PATCH", f"/p2p/rfqs/{rfq['id']}", buyer, json={
        "payment_terms": "45 days from receipt of material and invoice", "delivery_lead_time": "3–4 weeks ex-works",
        "late_delivery_clause": "0.5% of order value per week of delay, max 5%",
        "comments": f"{LABEL} {len(quotes)} quotations compared on price, delivery and past supply record.",
    })
    rfq = demo.call("POST", f"/p2p/rfqs/{rfq['id']}/submit", buyer)
    for vkey, price, dt in quotes:
        v = vendors[vkey]
        demo.call("POST", f"/p2p/rfqs/{rfq['id']}/vendor-quotations", buyer, json={
            "vendor_name": v["name"], "vendor_id": v["id"], "quoted_price": price, "delivery_time": dt,
            "payment_terms": "45 days", "remarks": f"{LABEL} quotation incl. freight to Faridabad, GST extra.",
        })
    rfq = demo.call("GET", f"/p2p/rfqs/{rfq['id']}", buyer)
    demo.note("p2p", f"RFQ {rfq['rfq_number']} locked with {len(quotes)} vendor quotations ({pr['p2p_number']})")
    return rfq


def evaluate(demo, rfq, technical=None, commercial=None):
    """Technical (qualified / disqualified) and commercial (approved /
    rejected) evaluation by the purchase manager. Lists align with
    rfq['vendor_quotations']; None in a list = leave that one pending."""
    pm, buyer = _people(demo)["purchase_manager"], _people(demo)["buyer"]
    vqs = rfq["vendor_quotations"]
    if technical is not None:
        demo.call("POST", f"/p2p/rfqs/{rfq['id']}/start-technical-evaluation", buyer)
        for vq, status in zip(vqs, technical):
            if status:
                demo.call("POST", f"/p2p/rfqs/{rfq['id']}/vendor-quotations/{vq['id']}/technical-evaluation", pm, json={
                    "status": status, "remarks": f"{LABEL} " + ("meets data sheet and test certificate requirements" if status == "qualified"
                                                                 else "make not on approved list / no test certificate")})
    if commercial is not None:
        demo.call("POST", f"/p2p/rfqs/{rfq['id']}/start-commercial-evaluation", buyer)
        for vq, status in zip(vqs, commercial):
            if status:
                demo.call("POST", f"/p2p/rfqs/{rfq['id']}/vendor-quotations/{vq['id']}/commercial-evaluation", pm, json={
                    "status": status, "remarks": f"{LABEL} " + ("lowest landed cost, acceptable delivery" if status == "approved"
                                                                 else "price above budget")})
    return demo.call("GET", f"/p2p/rfqs/{rfq['id']}", buyer)


def select_vendor(demo, rfq, index=0):
    vq = rfq["vendor_quotations"][index]
    return demo.call("POST", f"/p2p/rfqs/{rfq['id']}/select-vendor-quotation", _people(demo)["buyer"],
                     json={"vendor_quotation_id": vq["id"]})


def draft_and_submit_po(demo, pr, rfq, *, expected_in_days=21, price_factor=1.0):
    """PO draft from the RFQ (L1 vendor), every line priced at about the
    item's standard cost + 18% GST, then sent into PO approval by the buyer."""
    buyer = _people(demo)["buyer"]
    po = demo.call("POST", f"/p2p/rfqs/{rfq['id']}/po-draft", buyer, json={
        "p2p_request_id": pr["id"], "po_date": str(demo.today), "vendor_tier": "L1",
        "expected_delivery": str(demo.today + timedelta(days=expected_in_days)),
        "delivery_terms": "Door delivery to DEMO Main Store, Faridabad — freight included",
    })
    by_name = {it["name"].lower(): it for it in demo.data["items"].values()}
    prices = []
    for line in po["items"]:
        it = by_name.get(line["item_name"].lower())
        rate = round((it["rate"] if it else 1000) * price_factor, 2)
        prices.append({"id": line["id"], "unit_price": rate, "tax_rate": 18})
    demo.call("PATCH", f"/p2p/rfqs/{rfq['id']}/po-draft/{po['id']}", buyer, json={"items": prices})
    po = demo.call("POST", f"/p2p/rfqs/{rfq['id']}/po-draft/{po['id']}/submit", buyer)
    demo.note("p2p", f"PO {po['po_number']} to {po['vendor_name']} ({po['total_value']:,.0f}) sent for approval")
    return po


def approve_po(demo, pr, approver, comment):
    return demo.call("POST", f"/p2p/requests/{pr['id']}/approve-po", approver, json={"comment": comment})


def record_grn(demo, po, quantities, *, remarks, days_ago=0):
    """GRN by the store keeper into DEMO Main Store. `quantities` = {item
    name → received qty} (missing = not received on this GRN). Inspection-
    controlled items go to Quality stock and get an inspection lot."""
    keeper = _people(demo)["store_keeper"]
    lines = [{"po_item_id": it["id"], "received_quantity": quantities[it["item_name"]]}
             for it in po["items"] if quantities.get(it["item_name"])]
    grn = demo.call("POST", "/p2p/goods-receipts", keeper, json={
        "purchase_order_id": po["id"], "store_location_id": demo.data["locations"]["main_store"],
        "received_date": str(demo.today - timedelta(days=days_ago)), "remarks": f"{LABEL} {remarks}", "items": lines,
    })
    demo.note("p2p", f"GRN {grn['grn_number']} against {po['po_number']}: {len(lines)} line(s) received")
    return grn


def inspect_grn(demo, grn, splits=None):
    """GRN inspection by the purchase manager for lines NOT under a Quality
    lot. `splits` = {item name → (accepted, rejected, reason)}; default all accepted."""
    splits = splits or {}
    rows = []
    for it in grn["items"]:
        if it["quality_status"] != "pending":
            continue
        acc, rej, reason = splits.get(it["item_name"], (it["received_quantity"], 0, None))
        status = "passed" if not rej else ("failed" if not acc else "partial")
        rows.append({"item_id": it["id"], "accepted_quantity": acc, "rejected_quantity": rej, "quality_status": status,
                     "rejection_reason": reason, "remarks": f"{LABEL} visual + quantity check at receipt"})
    if not rows:
        return grn
    return demo.call("POST", f"/p2p/goods-receipts/{grn['id']}/inspect", _people(demo)["purchase_manager"], json={"items": rows})


def _to_po_approved(demo, key, requester, category, lines, quotes, purpose, *, expected_in_days=21, approver="store_manager"):
    """PR → approval → buyer → RFQ → commercial eval → L1 selected → PO → Partner approval."""
    p = _people(demo)
    pr = create_pr(demo, key, requester, category, lines, purpose=purpose)
    demo.data["prs"][key] = pr
    if _reused(demo, key):
        if pr.get("purchase_order"):
            demo.data["purchase_orders"][key] = pr["purchase_order"]
        return pr, None
    pr = approve_pr(demo, pr, p[approver], f"{LABEL} Required for the build, not available in store — approved.")
    pr = assign_buyer(demo, pr)
    rfq = create_rfq(demo, pr, quotes)
    rfq = evaluate(demo, rfq, commercial=["approved"] + ["rejected"] * (len(quotes) - 1))
    select_vendor(demo, rfq)
    po = draft_and_submit_po(demo, pr, rfq, expected_in_days=expected_in_days)
    demo.data["rfqs"][key] = rfq
    return pr, po


# ── one function per requisition story ────────────────────────────────────

def pr_awaiting_approval(demo):
    """Submitted by the design engineer, waiting for a PR approver."""
    p = _people(demo)
    demo.data["prs"]["awaiting_approval"] = create_pr(
        demo, "awaiting_approval", p["design_engineer"], "PNH",
        [_line(demo, "DEMO-HYD-MOTOR-ORB200", 2), _line(demo, "DEMO-HYD-DCV-43", 4)],
        purpose="Travel drive motors + control valves for RRV-8W rail axle drive (none in store).", priority="high")


def pr_returned(demo):
    """Returned for changes: the approver wants the quantity justified."""
    p = _people(demo)
    pr = create_pr(demo, "returned", p["production_supervisor"], "HWC",
                   [_line(demo, "DEMO-PNT-PU-RAL1003", 150, "Inhouse")],
                   purpose="PU paint for the next three RRV bodies.")
    if not _reused(demo, "returned"):
        pr = return_pr(demo, pr, p["production_manager"],
                       f"{LABEL} 150 L is ~2x the BOM requirement and the paint has a 12-month shelf life — reduce to 80 L or attach the paint schedule.")
    demo.data["prs"]["returned"] = pr


def pr_rejected(demo):
    """Rejected by the Store Manager — batteries are already in store."""
    p = _people(demo)
    pr = create_pr(demo, "rejected", p["electrical_head"], "ELE", [_line(demo, "DEMO-ELE-BATT-12V100", 4)],
                   purpose="Spare batteries for the electrical test bench.", priority="low")
    if not _reused(demo, "rejected"):
        pr = reject_pr(demo, pr, p["store_manager"],
                       f"{LABEL} 6 batteries are in DEMO Main Store — raise a material issue instead of buying.")
    demo.data["prs"]["rejected"] = pr


def pr_approved_for_rfq(demo):
    """Approved, buyer assigned, lines sent to procurement — RFQ not started."""
    p = _people(demo)
    pr = create_pr(demo, "approved_for_rfq", p["production_supervisor"], "HWC",
                   [_line(demo, "DEMO-HWF-BOLT-M16X60", 3000), _line(demo, "DEMO-CN-GRIND-DISC-4", 400, "Inhouse")],
                   purpose="Fasteners and consumables for the bogie frame batch.")
    if not _reused(demo, "approved_for_rfq"):
        pr = approve_pr(demo, pr, p["production_manager"], f"{LABEL} Batch quantity checked against the frame BOM.")
        pr = assign_buyer(demo, pr)
    demo.data["prs"]["approved_for_rfq"] = pr


def pr_technical_eval(demo):
    """RFQ needing technical evaluation: one qualified, one disqualified, one pending."""
    p = _people(demo)
    key = "technical_eval"
    pr = create_pr(demo, key, p["hydraulic_head"], "PNH", [_line(demo, "DEMO-HYD-PUMP-GP28", 4)],
                   purpose="Gear pumps for two RGM-16 grinding power packs.", priority="high")
    if not _reused(demo, key):
        pr = approve_pr(demo, pr, p["design_head"], f"{LABEL} Matches the hydraulic circuit HC-RGM-16 rev B.")
        pr = assign_buyer(demo, pr)
        rfq = create_rfq(demo, pr, [("hydraulics", 72400, "4 weeks"), ("engines", 69800, "6 weeks"), ("bearings", 77900, "3 weeks")],
                         technical=True)
        rfq = evaluate(demo, rfq, technical=["qualified", "disqualified", None])
        demo.data["rfqs"][key] = rfq
    demo.data["prs"][key] = pr


def pr_vendor_selected(demo):
    """Commercial evaluation done, L1 vendor selected — PO draft next."""
    p = _people(demo)
    key = "vendor_selected"
    pr = create_pr(demo, key, p["design_engineer"], "RAW", [_line(demo, "DEMO-RM-MS-PLATE-10", 3000)],
                   purpose="MS plate for RRV-8W chassis long members (nesting NS-0412).")
    if not _reused(demo, key):
        pr = approve_pr(demo, pr, p["store_manager"], f"{LABEL} Current stock is committed to the RGM-16 frames.")
        pr = assign_buyer(demo, pr)
        rfq = create_rfq(demo, pr, [("steel", 204000, "1 week"), ("bearings", 219000, "2 weeks")])
        rfq = evaluate(demo, rfq, commercial=["approved", "rejected"])
        select_vendor(demo, rfq)
        demo.data["rfqs"][key] = rfq
    demo.data["prs"][key] = pr


def pr_po_for_me(demo):
    """PO raised and waiting for the final Partner approval — left for demo.me."""
    p = _people(demo)
    key = "po_for_me"
    pr, po = _to_po_approved(demo, key, p["electrical_head"], "ELE",
                             [_line(demo, "DEMO-ELE-PLC-CPU", 2), _line(demo, "DEMO-ELE-PROX-M18", 10)],
                             [("electricals", 104500, "5 weeks"), ("engines", 112000, "6 weeks")],
                             "PLC CPUs (none in store) and proximity sensors for the RRV-8W control panel.")
    if po:
        demo.data["purchase_orders"][key] = po
        demo.note("p2p", f"PO {po['po_number']} waits for the Partner stage — {demo.me.email}: approve it as admin "
                         "stand-in (My Approvals, with a comment) or let DEMO Partner do it")


def pr_po_approved(demo):
    """PO approved by the Partner; nothing delivered and the date is past (overdue)."""
    p = _people(demo)
    key = "po_approved"
    pr, po = _to_po_approved(demo, key, p["design_engineer"], "MKT", [_line(demo, "DEMO-MEC-WHEEL-430", 4)],
                             [("bearings", 194000, "6 weeks"), ("steel", 205000, "8 weeks")],
                             "Rail guide wheels for RRV-8W rail gear assembly.", expected_in_days=-6)
    if po:
        approve_po(demo, pr, p["partner"], f"{LABEL} Approved — vendor supplied the last two batches on time.")
        demo.data["purchase_orders"][key] = po


def pr_partly_received(demo):
    """GRN for part of the PO; inspected → PR partially received, PO partially fulfilled."""
    p = _people(demo)
    key = "partly_received"
    pr, po = _to_po_approved(demo, key, p["electrical_head"], "ELE",
                             [_line(demo, "DEMO-ELE-CABLE-4C25", 500), _line(demo, "DEMO-ELE-RELAY-24V", 100)],
                             [("electricals", 114500, "2 weeks"), ("engines", 121000, "3 weeks")],
                             "Panel wiring cable and relays for two RRV-8W control panels.", expected_in_days=4)
    if po:
        approve_po(demo, pr, p["partner"], f"{LABEL} Approved, within the electrical budget.")
        cable, relay = _item(demo, "DEMO-ELE-CABLE-4C25")["name"], _item(demo, "DEMO-ELE-RELAY-24V")["name"]
        grn = record_grn(demo, po, {cable: 300, relay: 100}, remarks="First lot — vendor short-shipped 200 m of cable (balance next week).",
                         days_ago=2)
        grn = inspect_grn(demo, grn, {relay: (96, 4, "4 relays with cracked bases")})
        demo.data["purchase_orders"][key] = po
        demo.data["grns"]["partial"] = grn


def pr_fully_received(demo):
    """GRN for the full quantity; inspected → PR received, PO fulfilled."""
    p = _people(demo)
    key = "fully_received"
    pr, po = _to_po_approved(demo, key, p["hydraulic_head"], "PNH",
                             [_line(demo, "DEMO-HYD-SEAL-KIT-63", 10), _line(demo, "DEMO-HYD-OIL-68", 210)],
                             [("hydraulics", 49200, "1 week"), ("engines", 53800, "2 weeks")],
                             "Seal kits and hydraulic oil for re-railing equipment overhaul.", expected_in_days=-2)
    if po:
        approve_po(demo, pr, p["partner"], f"{LABEL} Approved — regular consumables.")
        seal, oil = _item(demo, "DEMO-HYD-SEAL-KIT-63")["name"], _item(demo, "DEMO-HYD-OIL-68")["name"]
        grn = record_grn(demo, po, {seal: 10, oil: 210}, remarks="Full delivery, 1 barrel of 210 L + 10 kits.", days_ago=5)
        grn = inspect_grn(demo, grn)
        demo.data["purchase_orders"][key] = po
        demo.data["grns"]["full"] = grn


def pr_in_quality(demo):
    """GRN of inspection-controlled items → Quality stock + incoming inspection lots."""
    p = _people(demo)
    key = "in_quality"
    codes = {"DEMO-HYD-MOTOR-ORB200": 4, "DEMO-ELE-PROX-M18": 20, "DEMO-MEC-BRG-22216": 8, "DEMO-RM-EN8-RD-60": 600}
    pr, po = _to_po_approved(demo, key, p["design_engineer"], "MKT",
                             [_line(demo, c, q) for c, q in codes.items()],
                             [("hydraulics", 258000, "4 weeks"), ("bearings", 271500, "5 weeks"), ("steel", 289000, "5 weeks")],
                             "Drive motors, sensors, axle bearings and EN8 bar for RRV-8W rail gear (critical parts — incoming inspection).",
                             expected_in_days=1)
    if po:
        approve_po(demo, pr, p["partner"], f"{LABEL} Approved — critical rail-gear parts, incoming inspection mandatory.")
        grn = record_grn(demo, po, {_item(demo, c)["name"]: q for c, q in codes.items()},
                         remarks="Received with test certificates; held in Quality stock pending incoming inspection.", days_ago=1)
        lots = [it["remarks"] for it in grn["items"] if it["quality_status"] == "in_quality"]
        demo.note("p2p", f"GRN {grn['grn_number']}: {len(lots)} line(s) in Quality stock ({'; '.join(lots)})")
        demo.data["purchase_orders"][key] = po
        demo.data["grns"]["in_quality"] = grn


def pr_issue_from_stock(demo):
    """Approved PR whose lines are in store: the Store Manager issues them → PR closes."""
    p = _people(demo)
    key = "issue_from_stock"
    pr = create_pr(demo, key, p["maintenance_engineer"], "HWC",
                   [_line(demo, "DEMO-CN-GRIND-DISC-4", 40, "Inhouse"), _line(demo, "DEMO-CN-ELECTRODE-7018", 15, "Inhouse")],
                   purpose="Consumables for the welding bay preventive maintenance.", days=3)
    if not _reused(demo, key):
        pr = approve_pr(demo, pr, p["store_manager"], f"{LABEL} Both in Production Floor stock — will issue, no purchase.")
        loc = demo.data["locations"]["production_floor"]
        gap_noted = False
        for line in pr["items"]:
            if line["fulfillment_status"] != "pending":
                continue
            body = {"location_id": loc, "comment": f"{LABEL} Handed over to {p['maintenance_engineer'].name} at the welding bay."}
            status, resp = demo.try_call("POST", f"/p2p/requests/{pr['id']}/items/{line['id']}/issue-from-stock", p["store_manager"], json=body)
            if status == 403:
                if not gap_noted:
                    gap_noted = True
                    demo.note("p2p", f"APP GAP: issue-from-stock refused for the Store Manager ({resp.get('detail') if isinstance(resp, dict) else resp}) "
                                     "— engine PRs have no 'store manager picked on the PR', so only an admin can issue; done as admin")
                resp = demo.call("POST", f"/p2p/requests/{pr['id']}/items/{line['id']}/issue-from-stock", demo.me, json=body)
            elif status >= 400:
                raise SystemExit(f"issue-from-stock failed ({status}): {resp}")
            pr = resp
        demo.note("p2p", f"{pr['p2p_number']} issued from stock → {pr['status']}")
    demo.data["prs"][key] = pr


def pr_design_bom(demo):
    """PR for the design BOM lines that match DEMO items (skipped without `design_boms`)."""
    boms = demo.data.get("design_boms")
    if not boms:
        demo.note("p2p", "no design_boms from the design seeder — BOM-driven PR skipped")
        return
    by_code = demo.data["items"]
    by_name = {it["name"].lower(): it for it in by_code.values()}
    picked: dict[str, float] = {}
    for bom in (boms.values() if isinstance(boms, dict) else boms):
        rows = (bom.get("lines") or bom.get("items") or []) if isinstance(bom, dict) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            code = row.get("item_code") or row.get("part_number") or row.get("part_no") or row.get("code")
            it = by_code.get(code) or by_name.get(str(row.get("description") or row.get("item_name") or "").lower())
            if it and it["code"] not in picked:
                picked[it["code"]] = float(row.get("quantity") or row.get("qty") or 1)
    if not picked:
        demo.note("p2p", "design_boms present but no BOM line matches a DEMO store item — BOM-driven PR skipped")
        return
    demo.data["prs"]["design_bom"] = create_pr(
        demo, "design_bom", _people(demo)["design_head"], "MKT", [_line(demo, c, q) for c, q in list(picked.items())[:8]],
        purpose="Material requirement from the released design BOM (shortages after store stock check).")


def _refresh(demo):
    """Re-read every PR / PO / GRN so the registry holds the final state."""
    me = demo.me
    for k, pr in list(demo.data["prs"].items()):
        demo.data["prs"][k] = demo.call("GET", f"/p2p/requests/{pr['id']}", me)
    for k, po in list(demo.data["purchase_orders"].items()):
        demo.data["purchase_orders"][k] = demo.call("GET", f"/p2p/purchase-orders/{po['id']}", me)
    for k, grn in list(demo.data["grns"].items()):
        demo.data["grns"][k] = demo.call("GET", f"/p2p/goods-receipts/{grn['id']}", me)


def seed(demo) -> None:
    for key in ("prs", "purchase_orders", "grns", "rfqs"):
        demo.data.setdefault(key, {})
    demo.note("p2p", "PR workflow is 'any one approver' — no PR can show partial approvals without changing the workflow (left as configured)")
    pr_awaiting_approval(demo)
    pr_returned(demo)
    pr_rejected(demo)
    pr_approved_for_rfq(demo)
    pr_technical_eval(demo)
    pr_vendor_selected(demo)
    pr_po_for_me(demo)
    pr_po_approved(demo)
    pr_partly_received(demo)
    pr_fully_received(demo)
    pr_in_quality(demo)
    pr_issue_from_stock(demo)
    pr_design_bom(demo)
    _refresh(demo)
    summary = ", ".join(f"{k}={v['status']}" for k, v in demo.data["prs"].items())
    demo.note("p2p", f"{len(demo.data['prs'])} PRs: {summary}")
