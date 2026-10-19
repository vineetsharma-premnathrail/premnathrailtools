"""Plant maintenance: Premnath's own assets, PM plans (due / overdue), breakdown requests, work orders with Store spares at every stage.

This is maintenance of the factory's OWN equipment (CNC, plasma, EOT crane,
compressor, DG set, test bench, forklift …) — not the customers' machines
(those are Service / ERP).

What it makes (all "DEMO", through the real API as the right person):

* A Maintenance Head (planner) — "DEMO Maintenance Head" role with the
  whole Maintenance module (incl. Work Orders › Approve = close-out
  verification), posted to Unit 1 / Maintenance. The foundation's
  Maintenance Engineer is the technician.
* Assets — 10 plant assets with criticality A/B/C, supplier / AMC vendor
  (one AMC expiring this month), meters, and bills of spares from the Store
  item master.
* PM plans — overdue with its job assigned, overdue not yet generated, due
  in two days, scheduled, and one rolled forward after its job was closed.
* Breakdown requests — raised by the Production Supervisor: open,
  acknowledged, rejected, and converted into work orders.
* Work orders — draft, assigned, in progress (spares issued from Store,
  labour logged), on hold (waiting for a part), completed, closed (requester
  confirmed, verified by the Maintenance Head), cancelled. Every spare
  movement is a real Store ledger posting (issue / return).
* Final approval for you (`demo.me`): the forklift PM job is Completed and
  its close-out verification (Organization › Approval Workflows ›
  Maintenance work order close-out) waits for you.

demo.data keys set here:

  maintenance_assets       dict asset code -> asset dict from the API.
  maintenance_pm_plans     dict asset code -> PM plan dict.
  maintenance_requests     dict key -> request dict (keys: plasma_torch,
                           eot_brake, forklift_hose, weld_feeder,
                           paint_fan, cnc_coolant).
  maintenance_work_orders  dict WO number -> work order dict (+ "key").
  people["maintenance_head"]  the demo Maintenance Head (User).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from demo._common import LABEL


def _ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


# ── People ────────────────────────────────────────────────────────────────

def seed_maintenance_head(demo) -> None:
    """The planner who verifies and closes jobs (Work Orders › Approve)."""
    from app.modules.main.models.user import User

    P = demo.perms
    role = demo.role("Maintenance Head", "maintenance:*:*", P("store", "issues", "returns", actions=["view", "create"]),
                     "store:items:view", "store:stock:view",
                     P("p2p", "purchase_requisitions", actions=["view", "create", "edit", "submit", "cancel"]),
                     description=f"{LABEL} Head – Plant Maintenance: assets, PM schedule, work orders incl. close-out verification.")
    u = demo.user("maintenance.head", "Maintenance Head", [], designation="Head – Plant Maintenance", department="Maintenance")
    u.branch_id = demo.data["branch_id"]
    demo.db.commit()
    dept = demo.data.get("departments", {}).get("Maintenance")
    if dept and (u.department or "").lower() != "maintenance":
        demo.call("POST", f"/organization/departments/{dept}/members", json={"user_id": u.id})
    u = demo.assign(u, role, "Employee self-service")
    pm = demo.data["people"].get("production_manager")
    row = demo.db.get(User, u.id)
    if pm and row.reporting_manager_id != pm.id:
        row.reporting_manager_id = pm.id
    eng = demo.db.get(User, demo.data["people"]["maintenance_engineer"].id)
    if eng.reporting_manager_id != u.id:
        eng.reporting_manager_id = u.id  # the technician reports to the maintenance head
    demo.db.commit()
    demo.db.expire_all()
    demo.data["people"]["maintenance_head"] = demo.db.get(User, u.id)
    demo.data["people"]["maintenance_engineer"] = demo.db.get(User, eng.id)


# ── Assets ────────────────────────────────────────────────────────────────
# code: (name, category, criticality, department, location, make, model, serial, year,
#        supplier key, purchase days ago, cost, warranty days left, amc vendor key, amc days left, meter unit, meter)
ASSETS = {
    "DEMO-CNC-01": ("DEMO CNC Vertical Machining Centre", "production_machine", "A", "Production", "Machine shop – Bay 1",
                    "DEMO BFW", "BMV 60 T20", "DEMO-BMV-22871", 2021, "electricals", 1500, 4850000, None, None, None, "hours", 11240),
    "DEMO-PLASMA-01": ("DEMO CNC Plasma Cutting Machine 3 x 12 m", "production_machine", "A", "Production", "Fabrication – Cutting bay",
                       "DEMO Hypertherm-equivalent", "PCM-312", "DEMO-PCM-3120-07", 2022, "electricals", 1100, 3200000, None, None, None, "hours", 8450),
    "DEMO-WELD-03": ("DEMO MIG Welding Machine 400 A", "production_machine", "C", "Production", "Fabrication – Welding line",
                     "DEMO ESAB-equivalent", "MIG-400i", "DEMO-MIG-40-3301", 2023, "electricals", 700, 145000, None, None, None, None, None),
    "DEMO-EOT-10T": ("DEMO EOT Crane 10 T – Assembly Bay", "material_handling", "A", "Production", "Assembly bay – span 2",
                     "DEMO Indef-equivalent", "DG-EOT-10", "DEMO-EOT-10-118", 2019, "steel", 2400, 1850000, None, None, None, None, None),
    "DEMO-COMP-01": ("DEMO Screw Air Compressor 37 kW", "utility", "B", "Production", "Utility room",
                     "DEMO Elgi-equivalent", "EG-37", "DEMO-EG37-5521", 2020, "hydraulics", 2000, 980000, None, "hydraulics", 160, "hours", 21870),
    "DEMO-DG-250": ("DEMO DG Set 250 kVA", "utility", "B", "Production", "DG yard",
                    "DEMO Cummins-equivalent", "C250 D5", "DEMO-C250-77610", 2018, "engines", 2900, 2650000, None, "engines", 12, "hours", 6310),
    "DEMO-HTB-350": ("DEMO Hydraulic Test Bench 350 bar (RRV circuits)", "instrument", "B", "Production", "Testing bay",
                     "DEMO in-house", "HTB-350", "DEMO-HTB-350-01", 2022, "hydraulics", 1000, 760000, None, None, None, None, None),
    "DEMO-PAINT-01": ("DEMO Paint Booth with Baking Oven", "facility", "B", "Production", "Paint shop",
                      "DEMO Spraytech-equivalent", "PB-12x5", "DEMO-PB-125-09", 2021, "steel", 1400, 2200000, None, None, None, None, None),
    "DEMO-FORK-3T": ("DEMO Diesel Forklift 3 T", "vehicle", "C", "Store & Dispatch", "Store yard",
                     "DEMO Godrej-equivalent", "GX-300D", "DEMO-GX300-4410", 2023, "engines", 500, 1150000, 230, None, None, "hours", 2140),
    "DEMO-TQW-01": ("DEMO Torque Wrench 100–500 Nm (bogie bolting)", "instrument", "C", "Quality", "Assembly bay – tool crib",
                    "DEMO Norbar-equivalent", "TTi-500", "DEMO-TTI-500-883", 2024, "bearings", 300, 68000, None, None, None, None, None),
}

# Bill of spares: asset code -> [(item code, qty per replacement, critical?)]
BILL_OF_SPARES = {
    "DEMO-CNC-01": [("DEMO-ELE-PROX-M18", 2, True), ("DEMO-ELE-RELAY-24V", 4, False), ("DEMO-HYD-OIL-68", 20, False)],
    "DEMO-PLASMA-01": [("DEMO-ELE-PROX-M18", 1, True), ("DEMO-ELE-RELAY-24V", 2, False), ("DEMO-ELE-CABLE-4C25", 10, False)],
    "DEMO-EOT-10T": [("DEMO-MEC-BRG-22216", 2, True), ("DEMO-ELE-RELAY-24V", 6, False)],
    "DEMO-COMP-01": [("DEMO-SP-FILTER-RET10", 1, True), ("DEMO-HYD-OIL-68", 15, False)],
    "DEMO-HTB-350": [("DEMO-HYD-HOSE-12", 5, False), ("DEMO-HYD-SEAL-KIT-63", 1, False), ("DEMO-HYD-OIL-68", 40, False)],
    "DEMO-FORK-3T": [("DEMO-HYD-HOSE-12", 3, True), ("DEMO-HYD-OIL-68", 10, False), ("DEMO-ELE-BATT-12V100", 1, False)],
}


def seed_assets(demo) -> None:
    """Plant equipment register (+ bill of spares), by the Maintenance Head."""
    from app.modules.maintenance.models.asset import MaintenanceAsset

    head = demo.data["people"]["maintenance_head"]
    depts = demo.data.get("departments", {})
    vendors = demo.data.get("vendors", {})
    t = demo.today
    out = {}
    for code, (name, cat, crit, dept, loc, make, model, serial, year, sup, bought, cost, w_left, amc, amc_left, unit, meter) in ASSETS.items():
        row = demo.db.query(MaintenanceAsset).filter(MaintenanceAsset.asset_code == code).first()
        if row and not row.is_deleted:
            out[code] = demo.call("GET", f"/maintenance/assets/{row.id}", head)
            continue
        if row:
            demo.note("maintenance", f"asset {code} is deleted — not re-created (asset code is unique)")
            continue
        payload = {
            "asset_code": code, "name": name, "category": cat, "criticality": crit, "branch_id": demo.data["branch_id"],
            "department_id": depts.get(dept), "location_text": f"{LABEL} Unit 1 – {loc}", "make": make, "model": model,
            "serial_number": serial, "year_of_manufacture": year, "supplier_vendor_id": (vendors.get(sup) or {}).get("id"),
            "purchase_date": str(t - timedelta(days=bought)), "purchase_cost": cost, "commissioned_on": str(t - timedelta(days=bought - 20)),
            "warranty_expiry": str(t + timedelta(days=w_left)) if w_left else None,
            "amc_vendor_id": (vendors.get(amc) or {}).get("id") if amc else None,
            "amc_expiry": str(t + timedelta(days=amc_left)) if amc else None,
            "meter_unit": unit, "current_meter_reading": meter,
            "description": f"{LABEL} plant asset — {name}.",
            "remarks": "AMC renewal due — get the revised offer." if amc and amc_left < 30 else None,
        }
        out[code] = demo.call("POST", "/maintenance/assets", head, json={k: v for k, v in payload.items() if v is not None})

    items = demo.data["items"]
    for code, lines in BILL_OF_SPARES.items():
        if code not in out:
            continue
        demo.call("PUT", f"/maintenance/assets/{out[code]['id']}/spares", head, json={"lines": [
            {"store_item_id": items[i]["id"], "qty_per_replacement": q, "is_critical": c} for i, q, c in lines if i in items]})
    demo.data["maintenance_assets"] = out
    demo.note("maintenance", f"{len(out)} DEMO plant assets with bills of spares on {len(BILL_OF_SPARES)}")


# ── PM plans ──────────────────────────────────────────────────────────────
# asset: (title, wo type, unit, every, next due (days from today), hours, shutdown, tasks, spares [(item, qty)], generate?)
PM_PLANS = {
    "DEMO-CNC-01": ("Monthly lubrication, way-oil & spindle check", "preventive", "month", 1, -5, 3, True,
                    [("Clean chips, check way-oil level", "Level between marks"), ("Check spindle run-out", "≤ 0.005 mm"),
                     ("Check coolant concentration", "6–8 %"), ("Check axis limit / prox switches", None)],
                    [("DEMO-HYD-OIL-68", 5)], "assigned"),
    "DEMO-EOT-10T": ("Quarterly crane inspection (Factories Act)", "inspection", "month", 3, 2, 4, True,
                     [("Wire rope & hook inspection", "No broken wires"), ("Brake test with rated load", "Holds 10 T"),
                      ("Limit switches (hoist / LT / CT)", None), ("Pendant & emergency stop", None)], [], None),
    "DEMO-COMP-01": ("Monthly filter & oil check (2000 h)", "preventive", "month", 1, -20, 2, False,
                     [("Replace return-line filter element", None), ("Check oil level / top up", None),
                      ("Drain receiver condensate", None), ("Record discharge pressure", "7.0–7.5 bar")],
                     [("DEMO-SP-FILTER-RET10", 1)], "closed"),
    "DEMO-DG-250": ("Weekly DG test run on load", "preventive", "week", 1, 5, 1, False,
                    [("Run 30 min on 50 % load", None), ("Check battery voltage", "≥ 24 V"), ("Check coolant & fuel level", None)], [], None),
    "DEMO-TQW-01": ("Annual calibration (NABL lab)", "calibration", "year", 1, -3, 1, False,
                    [("Send to NABL lab, get certificate", None), ("Verify ±4 % at 100/300/500 Nm", "±4 %")], [], None),
    "DEMO-FORK-3T": ("Monthly forklift service", "preventive", "month", 1, -1, 2, False,
                     [("Check mast hoses & fittings", None), ("Check hydraulic oil level", None), ("Check brakes & horn", None)],
                     [("DEMO-HYD-OIL-68", 2)], "completed"),
}


def seed_pm_plans(demo) -> None:
    """PM schedule: overdue (with and without its job), due soon, scheduled,
    rolled forward after close — by the Maintenance Head."""
    from app.modules.maintenance.models.pm_plan import MaintenancePmPlan

    head = demo.data["people"]["maintenance_head"]
    tech = demo.data["people"]["maintenance_engineer"]
    assets, items = demo.data["maintenance_assets"], demo.data["items"]
    plans, generated = {}, {}
    for code, (title, wo_type, unit, every, due, hrs, shutdown, tasks, spares, gen) in PM_PLANS.items():
        a = assets.get(code)
        if not a:
            continue
        row = demo.db.query(MaintenancePmPlan).filter(MaintenancePmPlan.asset_id == a["id"], MaintenancePmPlan.title == f"{LABEL} {title}",
                                                      MaintenancePmPlan.is_deleted == False).first()  # noqa: E712
        if row:
            plans[code] = demo.call("GET", f"/maintenance/pm-plans/{row.id}", head)
            continue
        plan = demo.call("POST", "/maintenance/pm-plans", head, json={
            "asset_id": a["id"], "title": f"{LABEL} {title}", "wo_type": wo_type, "frequency_unit": unit, "frequency_value": every,
            "schedule_basis": "fixed", "next_due_date": str(demo.today + timedelta(days=due)), "estimated_hours": hrs,
            "default_assignee_id": tech.id, "requires_shutdown": shutdown, "lead_days": 3,
            "tasks": [{"description": d, "expected_value": e} for d, e in tasks],
            "spares": [{"store_item_id": items[i]["id"], "qty": q} for i, q in spares if i in items],
        })
        if gen:
            plan = demo.call("POST", f"/maintenance/pm-plans/{plan['id']}/generate-now", head)
            generated[code] = (plan["open_work_order_id"], gen)
        plans[code] = plan
    demo.data["maintenance_pm_plans"] = plans
    demo.data["_pm_jobs"] = generated
    demo.note("maintenance", f"{len(plans)} PM plans ({sum(1 for p in plans.values() if p.get('due_state') == 'overdue')} overdue), "
                             f"{len(generated)} PM work order(s) generated")


# ── Work order helpers ────────────────────────────────────────────────────

def _wo(demo, wo_id, user):
    return demo.call("GET", f"/maintenance/work-orders/{wo_id}", user)


def _tick_tasks(demo, wo, user, measured=None):
    for task in wo["tasks"]:
        if not task.get("result"):
            demo.call("PATCH", f"/maintenance/work-orders/{wo['id']}/tasks/{task['id']}", user,
                      json={"result": "ok", "measured_value": (measured or {}).get(task["description"]), "remarks": "DEMO: checked"})
    return _wo(demo, wo["id"], user)


def _available(demo, item_id: int, loc_id: int) -> float:
    from app.modules.maintenance.routes.work_orders import _available as available
    return available(demo.db, item_id, loc_id)


def _issue(demo, wo, user, code, qty, loc_key, remarks=None):
    """Issue a spare from Store — from the preferred store, else any DEMO
    store that has it free (earlier seeders may have used or reserved the
    stock). With none free the line is planned instead and the run says so."""
    item = demo.data["items"][code]
    locs = [demo.data["locations"][loc_key], *(v for k, v in demo.data["locations"].items() if k != loc_key)]
    loc = next((l for l in locs if _available(demo, item["id"], l) >= qty), None)
    if loc is None:
        demo.note("maintenance", f"{wo['wo_number']}: no free stock of {code} for {qty:g} — planned on the job instead of issued")
        return demo.call("POST", f"/maintenance/work-orders/{wo['id']}/spares", user, json={
            "store_item_id": item["id"], "location_id": locs[0], "qty_planned": qty, "remarks": remarks})
    return demo.call("POST", f"/maintenance/work-orders/{wo['id']}/spares/issue", user, json={
        "store_item_id": item["id"], "location_id": loc, "quantity": qty, "remarks": remarks})


def _labour(demo, wo, user, tech, hours_ago, hours, rate=450, remarks=None):
    return demo.call("POST", f"/maintenance/work-orders/{wo['id']}/labour", user, json={
        "technician_id": tech.id, "start_time": _ago(hours_ago), "end_time": _ago(hours_ago - hours), "hourly_rate": rate, "remarks": remarks})


def _issue_pm_spares(demo, wo, user):
    """Issue each planned spare line of a PM job from its planned store."""
    for s in wo["spares"]:
        need = s["qty_planned"] - s["qty_issued"]
        if need > 0 and _available(demo, s["store_item_id"], s["location_id"]) >= need:
            wo = demo.call("POST", f"/maintenance/work-orders/{wo['id']}/spares/issue", user,
                           json={"spare_id": s["id"], "quantity": need, "remarks": "PM kit"})
    return wo


# ── PM work orders ────────────────────────────────────────────────────────

def seed_pm_work_orders(demo) -> None:
    """Generated PM jobs: CNC left assigned (overdue), compressor done and
    closed by the Maintenance Head (plan rolls forward), forklift completed —
    close-out waiting for you."""
    head, tech = demo.data["people"]["maintenance_head"], demo.data["people"]["maintenance_engineer"]
    wos = demo.data.setdefault("maintenance_work_orders", {})
    for code, (wo_id, target) in demo.data.get("_pm_jobs", {}).items():
        if not wo_id:
            continue
        wo = _wo(demo, wo_id, tech)
        if target in ("completed", "closed"):
            wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/start", tech)
            wo = _issue_pm_spares(demo, wo, tech)
            wo = _labour(demo, wo, tech, tech, 6, 2, remarks="PM carried out")
            wo = _tick_tasks(demo, wo, tech, {"Record discharge pressure": "7.2 bar"})
            wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/complete", tech, json={"action_taken": "PM checklist done, all OK."})
            if target == "closed":
                wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/close", head)
            else:
                demo.note("maintenance", f"{wo['wo_number']} ({code} PM) is Completed — close-out verification waits for YOU")
        wos[wo["wo_number"]] = {**wo, "key": f"pm_{code}"}
    demo.data.pop("_pm_jobs", None)


# ── Breakdown requests → work orders ─────────────────────────────────────
# key: (asset, type, machine down, reported hours ago, problem, final)
REQUESTS = {
    "plasma_torch": ("DEMO-PLASMA-01", "breakdown", True, 7,
                     "Torch height control not responding — torch crashes into plate, cutting of RRV chassis plates stopped.", "in_progress"),
    "eot_brake": ("DEMO-EOT-10T", "breakdown", False, 30,
                  "Long-travel brake noisy and hook creeping down ~50 mm under load during engine lowering.", "on_hold"),
    "forklift_hose": ("DEMO-FORK-3T", "breakdown", True, 76,
                      "Mast lift hose burst at the fitting while unloading steel; oil on floor, forklift stopped.", "closed"),
    "weld_feeder": ("DEMO-WELD-03", "breakdown", False, 2,
                    "Wire feeder motor stops intermittently mid-weld on bogie frame joints.", "open"),
    "paint_fan": ("DEMO-PAINT-01", "abnormality", False, 20,
                  "Exhaust fan vibration and humming noise when oven is at 80 °C.", "acknowledged"),
    "cnc_coolant": ("DEMO-CNC-01", "abnormality", False, 50,
                    "Coolant pump leaking at the gland.", "rejected"),
}


def seed_requests_and_work_orders(demo) -> None:
    """Breakdown requests raised by the Production Supervisor, triaged by the
    Maintenance Head, worked by the Maintenance Engineer."""
    from app.modules.maintenance.models.request import MaintenanceRequest

    sup = demo.data["people"]["production_supervisor"]
    head, tech = demo.data["people"]["maintenance_head"], demo.data["people"]["maintenance_engineer"]
    assets = demo.data["maintenance_assets"]
    wos = demo.data.setdefault("maintenance_work_orders", {})
    reqs = {}
    for key, (code, rtype, down, hrs, problem, final) in REQUESTS.items():
        a = assets.get(code)
        if not a:
            continue
        text = f"{LABEL} {problem}"
        row = demo.db.query(MaintenanceRequest).filter(MaintenanceRequest.asset_id == a["id"], MaintenanceRequest.problem_description == text).first()
        if row:
            reqs[key] = demo.call("GET", f"/maintenance/requests/{row.id}", head)
            continue
        req = demo.call("POST", "/maintenance/requests", sup, json={
            "asset_id": a["id"], "request_type": rtype, "machine_down": down, "reported_at": _ago(hrs), "problem_description": text})
        if final == "acknowledged":
            req = demo.call("POST", f"/maintenance/requests/{req['id']}/acknowledge", head)
        elif final == "rejected":
            req = demo.call("POST", f"/maintenance/requests/{req['id']}/reject", head, json={
                "status": "duplicate", "reason": "Same leak is already on the CNC monthly PM job — the gland packing is replaced there."})
        elif final != "open":
            req = demo.call("POST", f"/maintenance/requests/{req['id']}/acknowledge", head)
            req = demo.call("POST", f"/maintenance/requests/{req['id']}/convert", head, json={
                "assigned_to_id": tech.id, "planned_start": str(demo.today - timedelta(days=hrs // 24))})
            wo = _work_breakdown(demo, key, req["work_order"]["id"], final, sup, head, tech)
            wos[wo["wo_number"]] = {**wo, "key": key}
            req = demo.call("GET", f"/maintenance/requests/{req['id']}", head)
        reqs[key] = req
    demo.data["maintenance_requests"] = reqs


def _work_breakdown(demo, key, wo_id, final, sup, head, tech):
    wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/start", tech)
    if key == "plasma_torch":
        wo = _issue(demo, wo, tech, "DEMO-ELE-PROX-M18", 1, "main_store", "Torch height sensor")
        wo = _issue(demo, wo, tech, "DEMO-ELE-RELAY-24V", 2, "main_store", "THC relay board")
        wo = _labour(demo, wo, tech, tech, 5, 3, remarks="Fault finding on THC — sensor dead, relay contacts burnt")
        wo = demo.call("PATCH", f"/maintenance/work-orders/{wo_id}", tech, json={
            "failure_category": "electronic_control", "root_cause": "Torch height sensor failed after spatter damage; relay contacts welded."})
    elif key == "eot_brake":
        wo = _labour(demo, wo, tech, tech, 26, 2, remarks="Inspected LT brake — liners worn below limit")
        wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/spares", tech, json={
            "store_item_id": demo.data["items"]["DEMO-MEC-BRG-22216"]["id"], "location_id": demo.data["locations"]["main_store"],
            "qty_planned": 2, "remarks": "Replace wheel bearings with the brake overhaul"})
        wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/hold", tech, json={
            "reason": "Waiting for brake liner set from the crane OEM (quoted 5 days); crane derated to 5 T meanwhile."})
    elif key == "forklift_hose":
        wo = _issue(demo, wo, tech, "DEMO-HYD-HOSE-12", 3, "main_store", "Mast lift hose")
        wo = _issue(demo, wo, tech, "DEMO-HYD-OIL-68", 15, "main_store", "Top-up after hose burst")
        spare = next((s for s in wo["spares"] if s["item_code"] == "DEMO-HYD-HOSE-12" and s["qty_issued"] > 0), None)
        if spare:
            wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/spares/return", tech, json={
                "spare_id": spare["id"], "quantity": 1, "remarks": "1 m unused — back to store"})
        wo = _labour(demo, wo, tech, tech, 74, 3, remarks="Hose replaced, system bled")
        wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/complete", tech, json={
            "failure_category": "hydraulic", "root_cause": "Hose chafing on mast channel — no protective sleeve.",
            "action_taken": "Replaced hose with spiral guard, re-routed clamp, oil topped up, load-tested 3 T.",
            "handed_back_at": _ago(70)})
        req_id = wo["request_id"]
        demo.call("POST", f"/maintenance/requests/{req_id}/confirm", sup, json={"ok": True, "comment": "Forklift working fine on load."})
        wo = demo.call("POST", f"/maintenance/work-orders/{wo_id}/close", head)
    return wo


def seed_direct_work_orders(demo) -> None:
    """Work orders raised directly by the planner: a draft (not yet assigned)
    and a cancelled improvement job."""
    from app.modules.maintenance.models.work_order import MaintenanceWorkOrder

    head, tech = demo.data["people"]["maintenance_head"], demo.data["people"]["maintenance_engineer"]
    assets = demo.data["maintenance_assets"]
    wos = demo.data.setdefault("maintenance_work_orders", {})
    jobs = [
        ("paint_filters", "DEMO-PAINT-01", "corrective", "normal", "Replace paint booth exhaust filters (pressure drop high)", None, None),
        ("htb_hoses", "DEMO-HTB-350", "corrective", "high", "Replace test-bench hoses before RRV hydraulic testing", tech, None),
        ("led_lighting", "DEMO-EOT-10T", "improvement", "low", "LED high-bay lighting on crane girder", tech,
         "Moved to the plant capex project — electrical contractor will do it with the bay lighting."),
    ]
    for key, code, wtype, prio, title, assignee, cancel in jobs:
        a = assets.get(code)
        if not a:
            continue
        if demo.db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.title == f"{LABEL} {title}").first():
            continue
        wo = demo.call("POST", "/maintenance/work-orders", head, json={
            "asset_id": a["id"], "wo_type": wtype, "priority": prio, "title": f"{LABEL} {title}",
            "assigned_to_id": assignee.id if assignee else None, "planned_start": str(demo.today + timedelta(days=2)),
            "planned_end": str(demo.today + timedelta(days=3)), "estimated_hours": 4,
            "tasks": [{"description": "Isolate & lock out (LOTO)"}, {"description": "Carry out the job"}, {"description": "Trial & hand back"}]})
        if key == "htb_hoses":
            wo = demo.call("POST", f"/maintenance/work-orders/{wo['id']}/spares", head, json={
                "store_item_id": demo.data["items"]["DEMO-HYD-HOSE-12"]["id"], "location_id": demo.data["locations"]["main_store"],
                "qty_planned": 5, "remarks": "Kit to be drawn on the day"})
        if cancel:
            wo = demo.call("POST", f"/maintenance/work-orders/{wo['id']}/cancel", head, json={"reason": cancel})
        wos[wo["wo_number"]] = {**wo, "key": key}


def _summary(demo) -> None:
    wos = demo.data.get("maintenance_work_orders", {})
    by: dict[str, int] = {}
    for w in wos.values():
        by[w["status"]] = by.get(w["status"], 0) + 1
    reqs = demo.data.get("maintenance_requests", {})
    rby: dict[str, int] = {}
    for r in reqs.values():
        rby[r["status"]] = rby.get(r["status"], 0) + 1
    demo.note("maintenance", f"{len(reqs)} requests ({', '.join(f'{n} {k}' for k, n in sorted(rby.items()))}); "
                             f"{len(wos)} work orders ({', '.join(f'{n} {k}' for k, n in sorted(by.items()))})")


def seed(demo) -> None:
    seed_maintenance_head(demo)
    seed_assets(demo)
    seed_pm_plans(demo)
    seed_pm_work_orders(demo)
    seed_requests_and_work_orders(demo)
    seed_direct_work_orders(demo)
    _summary(demo)
