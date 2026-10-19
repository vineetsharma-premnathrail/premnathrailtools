"""Store: bins, reservations, material issues (work order / project / maintenance / job work), returns, transfers, adjustments, manual stock entries, quarantine, short receipts.

Runs after p2p. Everything through the Store API as the right demo person:
store_keeper raises issues / returns / transfers / adjustments, store_manager
(manager of every DEMO store, is_store_manager) approves transfers and
adjustments and posts manual stock entries, production_manager (head of
Production) approves damaged returns and reserves stock for the build.
Approvals go through the central engine (Organization › Approval Workflows):
transfer = manager of the sending store, adjustment = the Store Manager named
on it, return = per source / condition.

demo.data keys set here:
  issues       dict key → material issue dict: work_order (MS plate + channel to
               Production for the build), project (wiring material against the
               project), maintenance (spares to plant maintenance), job_work
               (EN8 bar to an outside machining vendor, challan + return date)
  returns      dict key → material return dict: good (auto-approved, back to stock),
               damaged_approved (to quarantine, approved by the Production head),
               damaged_pending (waiting for the Production head), other_approved
               (no issue reference, approved by the store manager), job_work
               (machined bar back from the vendor → Quality job-work lot)
  transfers    dict key → stock transfer dict: received, in_transit,
               approved (to dispatch), pending (approval), rejected
  adjustments  dict key → stock adjustment dict: approved, pending (waiting for
               DEMO Store Manager), rejected. (No "draft" state exists — an
               adjustment is in approval from the moment it is raised.)
  reservations dict key → reservation dict: active, fulfilled, cancelled
  stock_entries dict key → manual stock entry dict: free_sample (Receipt),
               write_off (Damage / write-off)
  bins         dict code → bin dict (rack → shelf → bin in DEMO Main Store)

Also: a second GRN against the partly-received PO (still short — the balance
shows under GRN › pending POs: short-receipt tracking) and a quarantine
scrap of part of the damaged return. Inventory valuation runs in Finance
(accounts seeder), not here.
"""
from __future__ import annotations

import json
from datetime import timedelta

from demo._common import LABEL

JOB_WORK_VENDOR = f"{LABEL} Precision Machining Works, Ballabgarh"


def _p(demo):
    return demo.data["people"]


def _id(demo, code):
    return demo.data["items"][code]["id"]


def _loc(demo, key):
    return demo.data["locations"][key]


def _work_order_ref(demo) -> str:
    """A production work order number from the production seeder, if it ran
    before; otherwise a DEMO work order reference (free text on the issue)."""
    wos = demo.data.get("work_orders")
    if isinstance(wos, dict):
        for wo in wos.values():
            if isinstance(wo, dict):
                ref = wo.get("wo_number") or wo.get("number") or wo.get("work_order_number")
                if ref:
                    return str(ref)
    return f"{LABEL} WO-RRV8W-001 (chassis fabrication)"


def _project_ref(demo) -> str:
    prs = demo.data.get("prs") or {}
    for pr in prs.values():
        if pr.get("project_label"):
            return pr["project_label"]
    return f"{LABEL} PEW-901 — RRV-8W for Northern Railway (Lucknow)"


def _available(demo, code, loc_key) -> float:
    from app.modules.store.models.stock_balance import StoreStockBalance
    demo.db.expire_all()
    b = demo.db.query(StoreStockBalance).filter(StoreStockBalance.item_id == _id(demo, code),
                                                StoreStockBalance.location_id == _loc(demo, loc_key)).first()
    return ((b.on_hand_qty or 0) - (b.reserved_qty or 0)) if b else 0.0


def _decide(demo, entity_type, entity_id, user, decision, comment):
    """Decide the live engine request of a Store document (transfers have no
    module approve route — the ApprovalPanel uses /approvals)."""
    st = demo.call("GET", f"/approvals/entity/{entity_type}/{entity_id}", user)
    cur = st.get("current") if isinstance(st, dict) else None
    if not cur or cur.get("status") != "pending":
        demo.note("store", f"{entity_type} #{entity_id}: no pending approval to {decision}")
        return
    demo.call("POST", f"/approvals/requests/{cur['id']}/decide", user, json={"decision": decision, "comment": comment})


# ── Bins ──────────────────────────────────────────────────────────────────

def seed_bins(demo):
    """Rack → shelf → bin in DEMO Main Store (Store › Warehouses)."""
    from app.modules.store.models.bin import StoreBin
    mgr, loc = _p(demo)["store_manager"], _loc(demo, "main_store")
    out = {}
    plan = [("DEMO-R-A", "rack", None, "Rack A — hydraulics"), ("DEMO-R-A-S1", "shelf", "DEMO-R-A", "Rack A shelf 1 — valves & pumps"),
            ("DEMO-R-A-S1-B01", "bin", "DEMO-R-A-S1", "Bin 01 — DCV CETOP-5"), ("DEMO-R-A-S1-B02", "bin", "DEMO-R-A-S1", "Bin 02 — gear pumps"),
            ("DEMO-R-B", "rack", None, "Rack B — electricals"), ("DEMO-R-B-S1", "shelf", "DEMO-R-B", "Rack B shelf 1 — sensors & relays")]
    for code, btype, parent, name in plan:
        row = demo.db.query(StoreBin).filter(StoreBin.location_id == loc, StoreBin.code == code).first()
        if row:
            out[code] = {"id": row.id, "code": row.code, "name": row.name, "bin_type": row.bin_type}
            continue
        out[code] = demo.call("POST", "/store/bins", mgr, json={
            "location_id": loc, "bin_type": btype, "code": code, "name": f"{LABEL} {name}",
            "parent_id": out[parent]["id"] if parent else None})
    demo.data["bins"] = out
    demo.note("store", f"{len(out)} bins (rack → shelf → bin) in DEMO Main Store")


# ── Reservations ──────────────────────────────────────────────────────────

def reserve(demo, code, loc_key, qty, *, remarks, days=10):
    pm = _p(demo)["production_manager"]
    return demo.call("POST", "/store/stock-reservations", pm, json={
        "item_id": _id(demo, code), "location_id": _loc(demo, loc_key), "quantity": qty,
        "project": _project_ref(demo), "production_order": _work_order_ref(demo),
        "required_date": str(demo.today + timedelta(days=days)), "remarks": f"{LABEL} {remarks}"})


def seed_reservations(demo):
    """Stock earmarked for the RRV build: one active, one fulfilled, one cancelled."""
    pm = _p(demo)["production_manager"]
    out = {"active": reserve(demo, "DEMO-MEC-ENGINE-74KW", "main_store", 1, remarks="Engine for RRV-8W unit 1 — hold for engine mounting stage.")}
    r = reserve(demo, "DEMO-MEC-TYRE-1000R20", "main_store", 4, remarks="Road tyres for RRV-8W unit 1.", days=2)
    out["fulfilled"] = demo.call("POST", f"/store/stock-reservations/{r['id']}/fulfill", pm)
    r = reserve(demo, "DEMO-ELE-BATT-12V100", "main_store", 2, remarks="Batteries — build re-sequenced, hold released.")
    out["cancelled"] = demo.call("POST", f"/store/stock-reservations/{r['id']}/cancel", pm)
    demo.data["reservations"] = out
    demo.note("store", "reservations: " + ", ".join(f"{v['reservation_number']}={v['status']}" for v in out.values()))


# ── Material issues ───────────────────────────────────────────────────────

def issue(demo, key, loc_key, lines, *, issue_type, requested_by, department, ref, remarks, **extra):
    """One material issue by the store keeper (posts the stock out at once)."""
    keeper = _p(demo)["store_keeper"]
    body = {"location_id": _loc(demo, loc_key), "requested_by_id": requested_by.id,
            "department_id": demo.data["departments"].get(department), "project_or_work_order": ref,
            "issue_type": issue_type, "issue_date": str(demo.today), "remarks": f"{LABEL} {remarks}",
            "items": [{"item_id": _id(demo, c), "quantity": q, "batch_number": b} for c, q, b in lines], **extra}
    row = demo.call("POST", "/store/material-issues", keeper, json=body)
    demo.data["issues"][key] = row
    demo.note("store", f"issue {row['issue_number']} ({key}) — {len(lines)} line(s) from {row['location_name']}")
    return row


def seed_issues(demo):
    p = _p(demo)
    issue(demo, "work_order", "main_store",
          [("DEMO-RM-MS-PLATE-10", 400, "DEMO-OPEN-01"), ("DEMO-RM-ISMC-100", 300, "DEMO-OPEN-01")],
          issue_type="production", requested_by=p["production_supervisor"], department="Production", ref=_work_order_ref(demo),
          remarks="Chassis long members and cross members — cutting list CL-RRV8W-01.")
    issue(demo, "project", "main_store",
          [("DEMO-ELE-CABLE-4C25", 60, None), ("DEMO-ELE-RELAY-24V", 12, None)],
          issue_type="production", requested_by=p["electrical_head"], department="Electrical", ref=_project_ref(demo),
          remarks="Control panel wiring for the project machine.")
    issue(demo, "maintenance", "spares_store",
          [("DEMO-SP-FILTER-RET10", 2, None), ("DEMO-SP-GRIND-STONE-150", 4, None)],
          issue_type="maintenance", requested_by=p["maintenance_engineer"], department="Maintenance",
          ref=f"{LABEL} PM — in-house rail grinding test rig", remarks="Quarterly PM of the grinding test rig.")
    issue(demo, "job_work", "main_store", [("DEMO-RM-EN8-RD-60", 60, "DEMO-OPEN-01")],
          issue_type="machining", requested_by=p["production_supervisor"], department="Production", ref=_work_order_ref(demo),
          remarks="EN8 bar sent for turning of guide-wheel axles (drawing RG-AX-07).",
          challan_number=f"{LABEL}-JW-{demo.today:%y%m%d}-01", vendor_name=JOB_WORK_VENDOR,
          expected_return_date=str(demo.today + timedelta(days=7)))


# ── Material returns ──────────────────────────────────────────────────────

def material_return(demo, key, loc_key, lines, *, source="issue", issue_key=None, department=None, reason, by=None):
    """Raise a return (by the store keeper unless `by`); the engine routes it.
    `lines` = [(item code, qty, condition, batch)]."""
    who = by or _p(demo)["store_keeper"]
    body = {"location_id": _loc(demo, loc_key), "source_type": source, "reason": f"{LABEL} {reason}",
            "return_date": str(demo.today), "department_id": demo.data["departments"].get(department) if department else None,
            "items": [{"item_id": _id(demo, c), "quantity": q, "condition": cond, "batch_number": b} for c, q, cond, b in lines]}
    if issue_key:
        body["source_issue_id"] = demo.data["issues"][issue_key]["id"]
    else:
        body["source_description"] = f"{LABEL} Unused material found at the assembly bay after shift clean-up"
    row = demo.call("POST", "/store/material-returns", who, json=body)
    demo.data["returns"][key] = row
    return row


def approve_return(demo, key, approver, comment):
    row = demo.data["returns"][key]
    status, body = demo.try_call("POST", f"/store/material-returns/{row['id']}/approve", approver, json={"comment": comment})
    if status >= 400:
        demo.note("store", f"return {row['return_number']} ({key}) left pending — {approver.name} can't approve it: "
                           f"{body.get('detail') if isinstance(body, dict) else body}")
        return row
    demo.data["returns"][key] = body
    return body


def seed_returns(demo):
    p = _p(demo)
    material_return(demo, "good", "main_store", [("DEMO-RM-MS-PLATE-10", 40, "good", "DEMO-OPEN-01")], issue_key="work_order",
                    reason="Off-cut plate left after nesting — usable.")
    material_return(demo, "damaged_approved", "main_store", [("DEMO-RM-ISMC-100", 25, "damaged", "DEMO-OPEN-01")], issue_key="work_order",
                    department="Production", reason="Channel bent during handling — to quarantine for scrap decision.")
    approve_return(demo, "damaged_approved", p["production_manager"], f"{LABEL} Verified at the shop floor — handling damage, not a supplier defect.")
    material_return(demo, "damaged_pending", "main_store", [("DEMO-ELE-RELAY-24V", 2, "damaged", None)], issue_key="project",
                    department="Electrical", reason="Two relays with broken coil terminals after panel rework.")
    material_return(demo, "other_approved", "main_store", [("DEMO-HWF-BOLT-M16X60", 120, "good", None)], source="other",
                    reason="Loose bolts collected from the assembly bay — counted and bagged.")
    approve_return(demo, "other_approved", p["store_manager"], f"{LABEL} Counted 120 nos, Gr 8.8 marking checked — back to stock.")
    material_return(demo, "job_work", "main_store", [("DEMO-RM-EN8-RD-60", 58, "good", "DEMO-OPEN-01")], issue_key="job_work",
                    reason="Machined axle blanks back from the job-work vendor (2 kg turning loss).")
    demo.note("store", "returns: " + ", ".join(f"{k}={v['status']}" for k, v in demo.data["returns"].items()))


def seed_quarantine(demo):
    """Scrap part of the damaged channel sitting in quarantine (Stock › Quarantine)."""
    if demo.data["returns"].get("damaged_approved", {}).get("status") != "approved":
        demo.note("store", "damaged return not approved — quarantine scrap skipped")
        return
    demo.call("POST", "/store/stock/quarantine/clear", _p(demo)["store_manager"], json={
        "item_id": _id(demo, "DEMO-RM-ISMC-100"), "location_id": _loc(demo, "main_store"), "quantity": 15,
        "disposition": "scrap", "remarks": f"{LABEL} 15 kg beyond straightening — sold as scrap; 10 kg kept for re-inspection."})
    demo.note("store", "quarantine: 15 kg ISMC scrapped, 10 kg left in quarantine")


# ── Transfers ─────────────────────────────────────────────────────────────

def transfer(demo, key, frm, to, lines, reason):
    keeper = _p(demo)["store_keeper"]
    row = demo.call("POST", "/store/stock-transfers", keeper, json={
        "from_location_id": _loc(demo, frm), "to_location_id": _loc(demo, to), "transfer_date": str(demo.today),
        "reason": f"{LABEL} {reason}", "items": [{"item_id": _id(demo, c), "quantity": q} for c, q in lines]})
    demo.data["transfers"][key] = row
    return row


def seed_transfers(demo):
    p = _p(demo)
    mgr, keeper = p["store_manager"], p["store_keeper"]
    ok = f"{LABEL} Stock checked at the sending store — approved."

    t = transfer(demo, "received", "main_store", "production_floor", [("DEMO-HYD-HOSE-12", 40), ("DEMO-HYD-OIL-68", 60)],
                 "Hose and oil to the line for RRV-8W hydraulic piping.")
    _decide(demo, "stock_transfer", t["id"], mgr, "approve", ok)
    demo.call("POST", f"/store/stock-transfers/{t['id']}/dispatch", keeper, json={"transporter_name": f"{LABEL} in-house trolley"})
    demo.call("POST", f"/store/stock-transfers/{t['id']}/receive", keeper, json={"remarks": f"{LABEL} Received complete at line 2."})

    t = transfer(demo, "in_transit", "main_store", "spares_store", [("DEMO-MEC-BRG-22216", 4)],
                 "Bearings to the service spares store for AMC kits.")
    _decide(demo, "stock_transfer", t["id"], mgr, "approve", ok)
    demo.data["transfers"]["in_transit"] = demo.call("POST", f"/store/stock-transfers/{t['id']}/dispatch", keeper, json={
        "vehicle_number": "HR51 AB 4321", "transporter_name": f"{LABEL} City Tempo Service", "driver_name": "Ramesh", "driver_phone": "+91 98100 22334"})

    t = transfer(demo, "approved", "main_store", "rdc_store", [("DEMO-ELE-PROX-M18", 3)], "Sensors for the RDC prototype rig.")
    _decide(demo, "stock_transfer", t["id"], mgr, "approve", ok)

    transfer(demo, "pending", "main_store", "rdc_store", [("DEMO-ELE-RELAY-24V", 10)], "Relays for the RDC prototype control box.")

    t = transfer(demo, "rejected", "main_store", "production_floor", [("DEMO-PNT-PU-RAL1003", 20)], "Paint to the paint booth.")
    _decide(demo, "stock_transfer", t["id"], mgr, "reject",
            f"{LABEL} Paint booth already holds 2 open tins — issue against the paint schedule instead of moving stock.")

    for k, v in list(demo.data["transfers"].items()):
        demo.data["transfers"][k] = demo.call("GET", f"/store/stock-transfers/{v['id']}", mgr)
    demo.note("store", "transfers: " + ", ".join(f"{k}={v['status']}" for k, v in demo.data["transfers"].items()))


# ── Adjustments ───────────────────────────────────────────────────────────

def adjustment(demo, key, loc_key, counts, reason):
    """Physical count by the store keeper; approval by DEMO Store Manager.
    `counts` = [(item code, delta vs current on hand, remark)]."""
    from app.modules.store.models.stock_balance import StoreStockBalance
    p = _p(demo)
    lines = []
    for code, delta, remark in counts:
        demo.db.expire_all()
        b = demo.db.query(StoreStockBalance).filter(StoreStockBalance.item_id == _id(demo, code),
                                                    StoreStockBalance.location_id == _loc(demo, loc_key)).first()
        lines.append({"item_id": _id(demo, code), "actual_quantity": max((b.on_hand_qty if b else 0) + delta, 0),
                      "remarks": f"{LABEL} {remark}"})
    row = demo.call("POST", "/store/stock-adjustments", p["store_keeper"], json={
        "location_id": _loc(demo, loc_key), "approved_by_id": p["store_manager"].id, "adjustment_date": str(demo.today),
        "reason": f"{LABEL} {reason}", "items": lines})
    demo.data["adjustments"][key] = row
    return row


def seed_adjustments(demo):
    mgr = _p(demo)["store_manager"]
    a = adjustment(demo, "approved", "production_floor", [("DEMO-CN-GRIND-DISC-4", -6, "6 discs found cracked/used in the drawer")],
                   "Monthly cycle count — Production Floor consumables.")
    demo.data["adjustments"]["approved"] = demo.call("POST", f"/store/stock-adjustments/{a['id']}/approve", mgr)
    adjustment(demo, "pending", "main_store", [("DEMO-HWF-BOLT-M16X60", -15, "bin count short by 15"),
                                               ("DEMO-HYD-SEAL-KIT-63", 1, "one kit found in the returns rack")],
               "Quarterly cycle count — Rack C fasteners and hydraulics.")
    a = adjustment(demo, "rejected", "main_store", [("DEMO-MEC-TYRE-1000R20", -1, "one tyre not found")], "Spot check — road tyres.")
    demo.data["adjustments"]["rejected"] = demo.call("POST", f"/store/stock-adjustments/{a['id']}/reject", mgr, json={
        "reason": f"{LABEL} The 4th tyre is on reservation for RRV-8W unit 1 and sits at the assembly bay — recount including the bay."})
    demo.note("store", "adjustments: " + ", ".join(f"{k}={v['status']}" for k, v in demo.data["adjustments"].items())
              + " (no draft state in the app — raised = pending approval)")


# ── Manual stock entries (non-purchase) ───────────────────────────────────

def stock_entry(demo, key, label, loc_key, lines, *, remarks, vendor=None, invoice=None):
    mgr = _p(demo)["store_manager"]
    _s, types = demo.try_call("GET", "/store/doc-types/stock_entry", mgr)
    t = next((t for t in types if t["label"].lower() == label.lower()), None)
    if not t:
        demo.note("store", f"stock entry type '{label}' not configured — {key} skipped")
        return None
    payload = {"entry_type": t["value"], "location_id": _loc(demo, loc_key), "entry_date": str(demo.today),
               "vendor_name": vendor, "invoice_number": invoice, "remarks": f"{LABEL} {remarks}",
               "lines": [{"item_id": _id(demo, c), "quantity": q, "unit_cost": cost} for c, q, cost in lines]}
    row = demo.call("POST", "/store/stock/entries", mgr, data={"payload": json.dumps(payload)},
                    files=[("files", demo.pdf(f"{LABEL}-{key}.pdf"))])
    demo.data["stock_entries"][key] = row
    demo.note("store", f"stock entry {row['entry_number']} ({label}) at {row['location_name']}")
    return row


def seed_stock_entries(demo):
    stock_entry(demo, "free_sample", "Receipt", "rdc_store", [("DEMO-ELE-PROX-M18", 2, 0)],
                remarks="Free-of-cost evaluation samples from the vendor for the RDC sensor trial.",
                vendor=demo.data["vendors"]["electricals"]["name"], invoice=f"{LABEL}-DC-SAMPLE-07")
    stock_entry(demo, "write_off", "Damage / write-off", "spares_store", [("DEMO-SP-GRIND-STONE-150", 2, None)],
                remarks="Two grinding stones cracked in a rack fall — written off (photo attached).")


# ── Short receipt follow-up ───────────────────────────────────────────────

def seed_short_receipt(demo):
    """Second, still-short GRN against the partly received PO; the balance
    stays visible under Store › GRN (pending POs)."""
    po = (demo.data.get("purchase_orders") or {}).get("partly_received")
    if not po:
        demo.note("store", "no partly_received PO from the p2p seeder — short-receipt follow-up skipped")
        return
    p = _p(demo)
    cable = demo.data["items"]["DEMO-ELE-CABLE-4C25"]["name"]
    line = next((i for i in po["items"] if i["item_name"] == cable), None)
    if not line:
        return
    grn = demo.call("POST", "/p2p/goods-receipts", p["store_keeper"], json={
        "purchase_order_id": po["id"], "store_location_id": _loc(demo, "main_store"), "received_date": str(demo.today),
        "remarks": f"{LABEL} Second lot of cable — vendor still short by 100 m (promised next Monday).",
        "items": [{"po_item_id": line["id"], "received_quantity": 100}]})
    grn = demo.call("POST", f"/p2p/goods-receipts/{grn['id']}/inspect", p["purchase_manager"], json={"items": [
        {"item_id": it["id"], "accepted_quantity": it["received_quantity"], "rejected_quantity": 0, "quality_status": "passed",
         "remarks": f"{LABEL} length and print checked"} for it in grn["items"] if it["quality_status"] == "pending"]})
    demo.data.setdefault("grns", {})["short_followup"] = grn
    pending = demo.call("GET", "/p2p/goods-receipts/pending-purchase-orders", p["store_keeper"])
    mine = next((r for r in pending if r["id"] == po["id"]), None)
    short = [f"{i['item_name']} {i['pending_quantity']:g} {i['unit'] or ''}" for i in (mine or {}).get("items", []) if i["pending_quantity"] > 0]
    demo.note("store", f"GRN {grn['grn_number']} (2nd lot); still pending on {po['po_number']}: {', '.join(short) or 'nothing'}")


def seed(demo) -> None:
    for key in ("issues", "returns", "transfers", "adjustments", "reservations", "stock_entries"):
        demo.data.setdefault(key, {})
    seed_bins(demo)
    seed_reservations(demo)
    seed_issues(demo)
    seed_returns(demo)
    seed_quarantine(demo)
    seed_transfers(demo)
    seed_adjustments(demo)
    seed_stock_entries(demo)
    seed_short_receipt(demo)
