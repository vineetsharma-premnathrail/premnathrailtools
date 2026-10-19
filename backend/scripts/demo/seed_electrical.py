"""Electrical: RRV electrical jobs with stages, panels, BOM with component approval, cable schedules, drawings, tests, issues, QC & handover.

Everything goes through the real Electrical API (and Quality for the final
inspection) as the right demo person, so ELJ numbers, the 20 stage gates,
the central approval engine ("electrical.drawing_revision" — any holder of
electrical:drawings:approve except the submitter; "electrical.bom_selection" —
holders of electrical:jobs:approve) and the QC hand-off are real. Re-running on
a database that already has the DEMO jobs only rebuilds the registry key.

Who does what:
  electrical_head      opens jobs, names the lead engineer, approves drawings and
                       component selections, holds / cancels jobs
  electrical_engineer  lead engineer: requirement, drawings, BOM, cables, panels,
                       tests, troubleshooting, stage completion, handover
  quality_manager      passes the final electrical inspection the job raised in Quality

Jobs (demo.data["electrical_jobs"] key -> job detail dict from the API):
  rrv_nr     RRV-8W #1 for Northern Railway — every stage done, handed over and
             CLOSED (QC passed, commissioning tests, as-built drawings, documents)
  rrv_dmrc   RRV-8W #2 for DMRC — design phase done, build in progress: a wiring
             diagram R1 waiting for the Electrical head, a PLC selection waiting
             for approval, cables partly installed, lines still to buy
  rgm        RGM-16 — testing & QC: failed IR test with an open investigation,
             QC inspection requested (pending in Quality), target date passed (overdue)
  tic        TIC-01 — draft: requirement captured, schematic R0 still a draft,
             components only proposed
  hre        HRE-150 power-pack electrics — on hold (waiting for the customer's spec)
  cw         CW-BOX tail-lamp circuit — cancelled
The RRV jobs refer to the Design register wiring diagram / panel layout
(demo.data["design_documents"]) when the design seeder ran.
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL
from demo._engineering import customer_name, ensure_engineering, number_of, reply_requirement_shares, sales_order_for

MOD = "electrical"


def _p(demo, key):
    return demo.data["people"][key]


def _item(demo, code):
    it = (demo.data.get("items") or {}).get(code)
    return it["id"] if it else None


def _job(demo, job_id):
    return demo.call("GET", f"/electrical/jobs/{job_id}", _p(demo, "electrical_head"))


def _design_ref(demo, key):
    doc = (demo.data.get("design_documents") or {}).get(key)
    return f" Design register: {doc['doc_number']} ({doc['title']})." if doc else ""


# ── building blocks (one per record type) ─────────────────────────────────

def create_job(demo, *, title, product_code, customer_key, priority="normal", start=-30, handover=45, **fields):
    """A job opened by the Electrical head with the lead engineer named."""
    so = sales_order_for(demo, product_code)
    ref = f" Sales order {number_of(so)}." if so else ""
    product = (demo.data.get("products") or {}).get(product_code) or {}
    return demo.call("POST", "/electrical/jobs", _p(demo, "electrical_head"), json={
        "title": f"{LABEL} {title}", "rrv_model": product.get("model_number") or product_code,
        "customer_name": customer_name(demo, customer_key), "branch_id": demo.data.get("branch_id"),
        "lead_engineer_id": _p(demo, "electrical_engineer").id, "priority": priority,
        "planned_start_date": str(demo.today + timedelta(days=start)), "target_handover_date": str(demo.today + timedelta(days=handover)),
        "customer_spec_ref": (fields.pop("customer_spec_ref", None) or "") + ref or None, **fields})


def add_drawing(demo, job, title, drawing_type, *, submit=False, approve=False, as_built=False):
    """Drawing R0 with its file; optionally submitted (engineer) and approved (head)."""
    eng = _p(demo, "electrical_engineer")
    d = demo.call("POST", f"/electrical/jobs/{job['id']}/drawings", eng, data={
        "title": f"{LABEL} {title}", "drawing_type": drawing_type, "is_as_built": str(as_built).lower(),
        "change_summary": "First issue"}, files={"file": demo.pdf(f"{job['job_number']}-{drawing_type}.pdf")})
    rev = max(d["revisions"], key=lambda r: r["revision_index"])["id"]
    if submit or approve:
        d = demo.call("POST", f"/electrical/revisions/{rev}/submit", eng)
    if approve:
        d = demo.call("POST", f"/electrical/revisions/{rev}/approve", _p(demo, "electrical_head"), json={"comment": "Approved for build."})
    return d


def add_panel(demo, job, tag, name, panel_type, status, **kw):
    return demo.call("POST", f"/electrical/jobs/{job['id']}/panels", _p(demo, "electrical_engineer"), json={
        "panel_tag": tag, "name": f"{LABEL} {name}", "panel_type": panel_type, "status": status, **kw})


BOM = [  # category, description, item code, make, part, rating, qty, uom, cost
    ("battery", "Starter / service battery", "DEMO-ELE-BATT-12V100", "Exide", "EXP1000", "12 V 100 Ah, 2 in series = 24 V", 2, "NOS", 9800),
    ("alternator", "Engine alternator with regulator", None, "Bosch", "0 124 555 009", "28 V 80 A", 1, "NOS", 21500),
    ("protection", "Miniature circuit breakers (DC)", None, "ABB", "S202M-C10DC", "10 A, 2P, 440 V DC", 18, "NOS", 1150),
    ("relay", "Interface relays with base", "DEMO-ELE-RELAY-24V", "Phoenix Contact", "PLC-RSC-24DC/21", "24 V DC, 1 CO 6 A", 24, "NOS", 420),
    ("controller", "PLC CPU — road/rail interlocks", "DEMO-ELE-PLC-CPU", "Siemens", "6ES7214-1AG40-0XB0", "24 DI / 16 DO, 24 V DC", 1, "NOS", 42000),
    ("sensor", "Guide wheel position sensors", "DEMO-ELE-PROX-M18", "IFM", "IGS232", "M18 PNP NO, Sn 8 mm, IP67", 8, "NOS", 1850),
    ("lighting", "LED working lights", None, "Hella", "1GA 996 192-011", "24 V, 40 W, IP67", 6, "NOS", 6400),
    ("cable", "Flexible control cable", "DEMO-ELE-CABLE-4C25", "Lapp", "Ölflex Classic 110 4G2.5", "4C x 2.5 sq mm, 600 V", 150, "MTR", 145),
]


def add_bom(demo, job, *, selection="selected", procurement="in_stock", rows=BOM):
    """Component lines (make + part + rating), with a selection / procurement state."""
    eng = _p(demo, "electrical_engineer")
    out = []
    for cat, desc, code, make, part, rating, qty, uom, cost in rows:
        out.append(demo.call("POST", f"/electrical/jobs/{job['id']}/bom", eng, json={
            "category": cat, "description": f"{LABEL} {desc}", "store_item_id": _item(demo, code) if code else None,
            "make": make if selection != "proposed" else None, "part_number": part if selection != "proposed" else None,
            "rating": rating, "specification": f"{rating}; railway duty, -25 to +55 °C (IEC 60077-1)", "quantity": qty, "uom": uom,
            "estimated_unit_cost": cost, "selection_status": selection, "procurement_status": procurement}))
    return out


def approve_selection(demo, job, line):
    """The Electrical head approves a selected component (recorded on the approval engine)."""
    return demo.call("PATCH", f"/electrical/jobs/{job['id']}/bom/{line['id']}", _p(demo, "electrical_head"), json={"selection_status": "approved"})


CABLES = [  # tag, circuit, from, to, type, cores, size, length
    ("W001", "Battery main", "Battery box BB1", "Main distribution panel MDP", "Single core battery cable", 1, 35, 6),
    ("W002", "Alternator charging", "Alternator", "MDP", "Single core", 1, 16, 4.5),
    ("W003", "PLC supply", "MDP", "Control panel CP1", "Lapp Ölflex 4G2.5", 4, 2.5, 3),
    ("W004", "Guide wheel sensors front", "CP1", "Front guide wheel JB", "Lapp Ölflex 7G1.0", 7, 1.0, 9),
    ("W005", "Guide wheel sensors rear", "CP1", "Rear guide wheel JB", "Lapp Ölflex 7G1.0", 7, 1.0, 11),
    ("W006", "Working lights", "MDP", "Roof light bar", "Lapp Ölflex 3G1.5", 3, 1.5, 8),
]


def add_cables(demo, job, statuses):
    eng = _p(demo, "electrical_engineer")
    return [demo.call("POST", f"/electrical/jobs/{job['id']}/cables", eng, json={
        "cable_tag": tag, "circuit": circuit, "from_point": a, "to_point": b, "cable_type": ctype, "cores": cores, "size_sqmm": size,
        "length_m": length, "voltage_rating": "600/1000 V", "harness_ref": "H1" if tag in ("W004", "W005") else None, "status": status})
        for (tag, circuit, a, b, ctype, cores, size, length), status in zip(CABLES, statuses)]


def add_test(demo, job, test_type, result, *, phase="factory", expected=None, measured=None, unit=None, retest_of=None, remarks=None, days_ago=3):
    return demo.call("POST", f"/electrical/jobs/{job['id']}/tests", _p(demo, "electrical_engineer"), json={
        "phase": phase, "test_type": test_type, "circuit": "Complete vehicle wiring", "instrument": "Fluke 1587 FC insulation multimeter",
        "expected_value": expected, "measured_value": measured, "unit": unit, "result": result,
        "test_date": str(demo.today - timedelta(days=days_ago)), "retest_of_id": retest_of["id"] if retest_of else None, "remarks": remarks})


def add_document(demo, job, title, category, stage_key=None):
    return demo.call("POST", f"/electrical/jobs/{job['id']}/documents", _p(demo, "electrical_engineer"),
                     data={"title": f"{LABEL} {title}", "category": category, "stage_key": stage_key or ""},
                     files=[("files", demo.pdf(f"{job['job_number']}-{category}.pdf"))])


def complete(demo, job, *stages, remarks=None):
    eng = _p(demo, "electrical_engineer")
    for s in stages:
        job = demo.call("POST", f"/electrical/jobs/{job['id']}/stages/{s}/complete", eng, json={"remarks": remarks})
    return job


def start(demo, job, *stages):
    eng = _p(demo, "electrical_engineer")
    for s in stages:
        job = demo.call("POST", f"/electrical/jobs/{job['id']}/stages/{s}/start", eng)
    return job


REQ = ("24 V DC negative-earth system, 2 x 12 V 100 Ah batteries, 28 V 80 A alternator. Road/rail mode interlock through the PLC: "
       "guide wheels down & locked before rail travel; road steering locked in rail mode. LED working lights front/rear, "
       "beacon, horn. All equipment to IEC 60077-1, cabling to EN 50343, IP65 minimum outside the cab.")
DESIGN_STAGES = ("requirement", "system_design", "schematics", "component_selection", "electrical_bom", "cable_design",
                 "panel_design", "component_specification")


# ── jobs ──────────────────────────────────────────────────────────────────

def seed_closed_job(demo):
    """RRV-8W #1 — full lifecycle through QC, commissioning and handover, closed."""
    job = create_job(demo, title="RRV-8W #1 electrical system — Northern Railway", product_code="DEMO-RRV-8W", customer_key="northern_railway",
                     priority="high", start=-75, handover=-5, system_voltage="24 V DC", battery_spec="2 x 12 V 100 Ah lead-acid, 24 V",
                     alternator_spec="28 V 80 A", applicable_standards="IEC 60077-1, EN 50343, RDSO/2019/CG-12",
                     customer_spec_ref="NR tender spec Annexure E-3.", requirement_notes=REQ + _design_ref(demo, "rrv_wiring"))
    for s in ("requirement", "schematics", "electrical_bom", "electrical_testing"):
        demo.call("PATCH", f"/electrical/jobs/{job['id']}/stages/{s}", _p(demo, "electrical_head"), json={"assignee_id": _p(demo, "electrical_engineer").id})
    sch = add_drawing(demo, job, "Electrical schematic — complete vehicle", "schematic", approve=True)
    add_drawing(demo, job, "Single line diagram 24 V DC", "single_line", approve=True)
    wd = add_drawing(demo, job, "Wiring diagram — road/rail interlock", "wiring_diagram", approve=True)
    add_panel(demo, job, "MDP", "Main distribution panel", "main_distribution", "installed", location_on_vehicle="Behind cab, LH",
                    enclosure_material="CRCA 2 mm, powder coated", ip_rating="IP65", dimensions="600 x 500 x 250 mm")
    add_panel(demo, job, "DC1", "Driver console", "driver_console", "installed", location_on_vehicle="Cab", ip_rating="IP54")
    lines = add_bom(demo, job, procurement="issued")
    for line in lines[:3]:
        approve_selection(demo, job, line)
    add_cables(demo, job, ["tested"] * len(CABLES))
    job = complete(demo, _job(demo, job["id"]), *DESIGN_STAGES)
    job = complete(demo, job, "drawing_revision", "purchase_requirement", "electrical_assembly", "wiring_installation", "panel_assembly")
    add_test(demo, job, "continuity", "pass", expected="< 1 Ω", measured="0.3", unit="Ω", days_ago=20)
    ir = add_test(demo, job, "insulation_resistance", "fail", expected="≥ 1 MΩ at 500 V DC", measured="0.4", unit="MΩ", days_ago=19,
                  remarks="Low IR on the rear guide-wheel harness.")
    iss = demo.call("POST", f"/electrical/jobs/{job['id']}/issues", _p(demo, "electrical_engineer"), json={
        "title": f"{LABEL} Low IR on rear guide wheel harness", "symptom": "IR 0.4 MΩ between core 3 and earth on W005.",
        "severity": "major", "test_id": ir["id"], "assigned_to_id": _p(demo, "electrical_engineer").id})
    demo.call("POST", f"/electrical/issues/{iss['id']}/resolve", _p(demo, "electrical_engineer"), json={
        "root_cause": "Harness pinched under the guide-wheel arm bracket — insulation cut.",
        "corrective_action": "Harness re-routed with P-clips 150 mm pitch, damaged section replaced, grommet added."})
    demo.call("POST", f"/electrical/issues/{iss['id']}/close", _p(demo, "electrical_engineer"))
    add_test(demo, job, "insulation_resistance", "pass", expected="≥ 1 MΩ at 500 V DC", measured="250", unit="MΩ", retest_of=ir, days_ago=18)
    add_test(demo, job, "battery_charging", "pass", expected="27.6–28.4 V", measured="28.1", unit="V", days_ago=18)
    add_test(demo, job, "functional", "pass", remarks="Road/rail interlock: rail travel blocked until all 4 wheels down & locked.", days_ago=17)
    job = complete(demo, _job(demo, job["id"]), "electrical_testing")
    job = demo.call("POST", f"/electrical/jobs/{job['id']}/request-inspection", _p(demo, "electrical_engineer"))
    st, body = demo.try_call("PATCH", f"/quality/inspections/{job['quality_inspection_id']}", _p(demo, "quality_manager"), json={
        "status": "passed", "quantity_accepted": 1, "inspection_date": str(demo.today - timedelta(days=15)),
        "remarks": f"{LABEL} Final electrical inspection passed.",
        "results": [{"parameter": "IR test record", "acceptance_criteria": "≥ 1 MΩ", "observed_value": "250 MΩ", "result": "pass"},
                    {"parameter": "Interlock function", "acceptance_criteria": "As per FAT procedure", "observed_value": "OK", "result": "pass"},
                    {"parameter": "Cable marking & glanding", "acceptance_criteria": "EN 50343", "observed_value": "OK", "result": "pass"}]})
    if st >= 400:
        demo.note(MOD, f"Quality couldn't pass inspection for {job['job_number']} ({st}): {body} — job left at Inspection & QC")
        return _job(demo, job["id"])
    job = complete(demo, _job(demo, job["id"]), "inspection_qc", "troubleshooting")
    job = demo.call("PATCH", f"/electrical/jobs/{job['id']}", _p(demo, "electrical_engineer"), json={
        "commissioning_location": "Northern Railway — Ghaziabad track depot", "commissioned_on": str(demo.today - timedelta(days=8)),
        "handover_to_name": "R K Meena, Dy CE/TM", "handover_to_organization": customer_name(demo, "northern_railway") or "Northern Railway",
        "handover_date": str(demo.today - timedelta(days=6)), "handover_remarks": "Handed over with O&M manual and as-built drawings."})
    add_test(demo, job, "functional", "pass", phase="commissioning", remarks="Rail travel 2 km, interlocks verified on site.", days_ago=8)
    add_test(demo, job, "lighting", "pass", phase="commissioning", days_ago=8)
    job = complete(demo, _job(demo, job["id"]), "commissioning")
    add_document(demo, job, "Factory electrical test report", "test_report", "electrical_testing")
    add_document(demo, job, "Commissioning report — Ghaziabad", "commissioning_report", "commissioning")
    add_document(demo, job, "Electrical handover certificate", "handover_certificate", "handover")
    job = complete(demo, _job(demo, job["id"]), "final_documentation", "handover")
    for d in (sch, wd):
        demo.call("PATCH", f"/electrical/drawings/{d['id']}", _p(demo, "electrical_engineer"), json={"is_as_built": True})
    job = complete(demo, _job(demo, job["id"]), "as_built_records")
    job = demo.call("POST", f"/electrical/jobs/{job['id']}/close", _p(demo, "electrical_head"))
    return job


def seed_build_job(demo):
    """RRV-8W #2 — design done, building; drawing revision + PLC selection waiting for the head."""
    job = create_job(demo, title="RRV-8W #2 electrical system — DMRC", product_code="DEMO-RRV-8W", customer_key="dmrc",
                     priority="high", start=-25, handover=30, system_voltage="24 V DC", battery_spec="2 x 12 V 100 Ah",
                     alternator_spec="28 V 80 A", applicable_standards="IEC 60077-1, EN 50343",
                     requirement_notes=REQ + " DMRC: additional reversing camera and fire detection in the engine bay." + _design_ref(demo, "rrv_panel"))
    add_drawing(demo, job, "Electrical schematic — complete vehicle", "schematic", approve=True)
    wd = add_drawing(demo, job, "Wiring diagram — road/rail interlock", "wiring_diagram", approve=True)
    add_drawing(demo, job, "Main distribution panel GA", "panel_ga", approve=True)
    add_panel(demo, job, "MDP", "Main distribution panel", "main_distribution", "assembled", ip_rating="IP65")
    add_panel(demo, job, "CP1", "PLC control panel", "control", "in_assembly", ip_rating="IP65")
    rows = BOM + [("sensor", "Engine bay fire detector", None, "Dafo", "Forrex DL", "Linear heat detection, 24 V", 1, "SET", 38000)]
    lines = add_bom(demo, job, procurement="in_stock", rows=rows)
    for line in lines[:4]:
        approve_selection(demo, job, line)
    # Lines still to be bought (the Purchase Requirement stage stays open).
    for line in lines[6:]:
        demo.call("PATCH", f"/electrical/jobs/{job['id']}/bom/{line['id']}", _p(demo, "electrical_engineer"), json={"procurement_status": "required"})
    plc = lines[4]
    demo.call("POST", f"/electrical/jobs/{job['id']}/bom/{plc['id']}/submit", _p(demo, "electrical_engineer"))
    add_cables(demo, job, ["installed", "installed", "terminated", "harnessed", "cut", "designed"])
    job = complete(demo, _job(demo, job["id"]), *DESIGN_STAGES)
    job = complete(demo, job, "drawing_revision")
    # DMRC asked for the camera after the drawings were approved: R1 in for approval.
    eng = _p(demo, "electrical_engineer")
    d = demo.call("POST", f"/electrical/drawings/{wd['id']}/revisions", eng, data={"change_summary": "Reversing camera + fire detector circuits added (DMRC)."},
                  files={"file": demo.pdf(f"{wd['drawing_number']}-R1.pdf")})
    demo.call("POST", f"/electrical/revisions/{max(d['revisions'], key=lambda r: r['revision_index'])['id']}/submit", eng)
    job = start(demo, _job(demo, job["id"]), "purchase_requirement", "electrical_assembly", "wiring_installation", "panel_assembly")
    return _job(demo, job["id"])


def seed_test_job(demo):
    """RGM-16 — in testing & QC, failed IR test under investigation, QC requested, overdue."""
    job = create_job(demo, title="RGM-16 electrical system — RVNL", product_code="DEMO-RGM-16", customer_key="rvnl", priority="urgent",
                     start=-60, handover=-3, system_voltage="24 V DC / 415 V AC (stone motors)", battery_spec="2 x 12 V 100 Ah",
                     alternator_spec="Genset 125 kVA for 16 x 22 kW stone motors", applicable_standards="IEC 60077-1, IEC 60204-1",
                     requirement_notes="16 stone motors 22 kW each with soft starters, PLC-controlled stone pressure, spark detection, "
                                       "emergency stop at both ends.")
    add_drawing(demo, job, "Power schematic — stone motors", "schematic", approve=True)
    add_drawing(demo, job, "Control wiring — stone carriage", "wiring_diagram", approve=True)
    add_panel(demo, job, "MCC1", "Motor control centre", "main_distribution", "tested", ip_rating="IP54")
    lines = add_bom(demo, job, procurement="received", rows=BOM[2:6])
    approve_selection(demo, job, lines[0])
    add_cables(demo, job, ["tested", "tested", "tested", "installed", "installed", "installed"])
    job = complete(demo, _job(demo, job["id"]), *DESIGN_STAGES)
    job = complete(demo, job, "drawing_revision", "purchase_requirement", "electrical_assembly", "wiring_installation", "panel_assembly")
    add_test(demo, job, "continuity", "pass", expected="< 1 Ω", measured="0.4", unit="Ω", days_ago=6)
    ir = add_test(demo, job, "insulation_resistance", "fail", expected="≥ 1 MΩ at 1000 V DC", measured="0.6", unit="MΩ", days_ago=4,
                  remarks="Stone motor M7 winding to earth.")
    iss = demo.call("POST", f"/electrical/jobs/{job['id']}/issues", _p(demo, "electrical_engineer"), json={
        "title": f"{LABEL} Stone motor M7 low insulation", "symptom": "IR 0.6 MΩ, motor heater not energised during storage.",
        "severity": "critical", "test_id": ir["id"], "assigned_to_id": _p(demo, "electrical_engineer").id})
    demo.call("PATCH", f"/electrical/issues/{iss['id']}", _p(demo, "electrical_engineer"), json={"status": "investigating"})
    add_test(demo, job, "functional", "pass", remarks="Stone pressure loop and E-stops OK (motor M7 isolated).", days_ago=3)
    job = demo.call("POST", f"/electrical/jobs/{job['id']}/request-inspection", _p(demo, "electrical_engineer"))
    return _job(demo, job["id"])


def seed_draft_job(demo):
    """TIC-01 — draft: requirement in, schematic R0 draft, components only proposed."""
    job = create_job(demo, title="TIC-01 measuring system power & cabling", product_code="DEMO-TIC-01", customer_key="central_railway_workshop",
                     start=7, handover=70, system_voltage="24 V DC + 230 V AC UPS for the measuring PCs",
                     requirement_notes="Clean power for 2 laser sensors, IMU and 2 industrial PCs; 30 min UPS backup.")
    add_drawing(demo, job, "Measuring system power schematic", "schematic")
    add_bom(demo, job, selection="proposed", procurement="required", rows=BOM[:2])
    return _job(demo, job["id"])


def seed_hold_and_cancelled(demo):
    """HRE-150 on hold; CW-BOX tail-lamp circuit cancelled."""
    head = _p(demo, "electrical_head")
    hre = create_job(demo, title="HRE-150 power pack electrics — L&T Metro", product_code="DEMO-HRE-150", customer_key="lt_metro",
                     start=-10, handover=40, system_voltage="415 V AC 3-phase", requirement_notes="7.5 kW motor starter, remote pendant.")
    start(demo, hre, "requirement")
    hre = demo.call("POST", f"/electrical/jobs/{hre['id']}/hold", head, json={"reason": "Waiting for L&T Metro's depot supply details (socket type, earthing)."})
    cw = create_job(demo, title="CW-BOX tail lamp circuit", product_code="DEMO-CW-BOX", customer_key="ircon", priority="low",
                    requirement_notes="Battery-powered LED tail lamp.")
    cw = demo.call("POST", f"/electrical/jobs/{cw['id']}/cancel", head, json={"reason": "Customer chose the self-powered tail lamp (no wiring needed)."})
    return hre, cw


def _already_seeded(demo) -> bool:
    from app.modules.electrical.models.job import ElectricalJob
    rows = demo.db.query(ElectricalJob).filter(ElectricalJob.title.like(f"{LABEL} %"), ElectricalJob.is_deleted == False).all()  # noqa: E712
    if not rows:
        return False
    demo.data["electrical_jobs"] = {r.job_number: _job(demo, r.id) for r in rows}
    demo.note(MOD, "DEMO electrical jobs already present — registry rebuilt, nothing new created")
    return True


def seed(demo):
    ensure_engineering(demo)
    if _already_seeded(demo):
        return
    jobs = {"rrv_nr": seed_closed_job(demo), "rrv_dmrc": seed_build_job(demo), "rgm": seed_test_job(demo), "tic": seed_draft_job(demo)}
    jobs["hre"], jobs["cw"] = seed_hold_and_cancelled(demo)
    reply_requirement_shares(demo, "electrical", _p(demo, "electrical_head"),
                             ("feasible", "24 V DC system with the standard RRV PLC interlock covers it; no new components."))
    demo.data["electrical_jobs"] = {k: _job(demo, j["id"]) for k, j in jobs.items()}
    demo.note(MOD, "jobs → " + ", ".join(f"{k}: {j['job_number']} {j['status']} ({j['progress_percent']}%)" for k, j in demo.data["electrical_jobs"].items()))
