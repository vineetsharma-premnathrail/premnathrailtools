"""Hydraulic & Pneumatic: component master, systems, circuits, BOMs, engineering calculations, tests, documents.

Everything goes through the real Hydraulic & Pneumatic API as the right demo
person, so HYS / circuit / BOM / CALC / test numbers and the central approval
engine ("hydraulic.circuit" — holders of hydraulic:circuits:approve except the
submitter; "hydraulic.bom_release" — hydraulic:bom:approve; "hydraulic.test_result"
— hydraulic:testing:approve) are real. Calculations are run by the module's own
calculation endpoint (POST /hydraulic/calculations computes and saves the
result) — the seeder only supplies the inputs. Re-running on a database that
already has the DEMO systems only rebuilds the registry key.

Who does what:
  hydraulic_engineer  components, systems, circuits (with the diagram file), BOMs,
                      calculations, tests and readings — submits for approval
  hydraulic_head      approves circuits, releases BOMs, signs off test results

Left at different stages:
  systems     RRV-8W hydraulics (under build) · RRV-8W pneumatic brakes (design) ·
              RGM-16 stone carriage hydraulics (testing) · HRE-150 700 bar
              re-railing (commissioned) · TIC-01 sensor-beam pneumatics (design)
  circuits    approved (R0) + R1 draft revision · under review (with the head) ·
              returned for changes · approved (HRE) · draft (pneumatic)
  BOMs        released + next revision draft (RRV) · under review (RGM) · released (HRE) · draft (pneumatic)
  tests       completed pass (HRE proof test) · completed FAIL + planned re-test (cylinder
              drift) · under review (RGM leak test) · in progress (relief valve setting) ·
              planned (RRV flow test)
  calculations 10 saved calculations (cylinder force/speed, pump flow/power,
              pipe sizing, accumulator, reservoir, heat load, pneumatic force, air
              receiver) linked to their systems
Skipped on purpose: maintenance plans, service records and spare parts — the
module answers 410 Gone for new ones (owner decision 2026-10-07: hydraulic
maintenance / service / spares were dropped from this module for now).

demo.data keys set here:
  hydraulic_systems     dict key (rrv_hyd, rrv_pneu, rgm_hyd, hre_hyd, tic_pneu) -> system dict from the API
  hydraulic_components  dict key -> component dict;  hydraulic_circuits dict key -> circuit dict
  hydraulic_boms        dict key -> BOM dict;  hydraulic_tests dict key -> test dict
  hydraulic_calculations dict key -> saved calculation dict (inputs + results from the API)
"""
from __future__ import annotations

from datetime import timedelta

from demo._common import LABEL
from demo._engineering import reply_requirement_shares

MOD = "hydraulic"


def _p(demo, key):
    return demo.data["people"][key]


def _item(demo, code):
    it = (demo.data.get("items") or {}).get(code)
    return it["id"] if it else None


# ── Component master ──────────────────────────────────────────────────────

COMPONENTS = {  # key: (name, category, system_type, make, model, store item, extra)
    "pump": ("Gear pump 28 cc/rev", "pump", "hydraulic", "Bosch Rexroth", "AZPF-12-028", "DEMO-HYD-PUMP-GP28",
             {"displacement_cc": 28, "rated_pressure_bar": 250, "max_pressure_bar": 280, "unit_cost": 18500}),
    "motor": ("Orbital motor 200 cc (rail travel)", "motor", "hydraulic", "Danfoss", "OMR 200", "DEMO-HYD-MOTOR-ORB200",
              {"displacement_cc": 200, "rated_pressure_bar": 175, "unit_cost": 26500}),
    "dcv": ("4/3 DCV CETOP-5 24 V DC", "directional_valve", "hydraulic", "Bosch Rexroth", "4WE10J3X/CG24N9K4", "DEMO-HYD-DCV-43",
            {"rated_pressure_bar": 315, "flow_rate_lpm": 120, "port_size": "CETOP-5 (NG10)", "unit_cost": 9200}),
    "relief": ("Pressure relief valve 50–315 bar", "pressure_valve", "hydraulic", "Sun Hydraulics", "RDDA-LAN", None,
               {"rated_pressure_bar": 315, "flow_rate_lpm": 120, "unit_cost": 6400}),
    "cylinder": ("Guide wheel lift cylinder 63/36 x 250", "cylinder", "hydraulic", "DEMO Hydro Seals", "HC-63-36-250", None,
                 {"bore_mm": 63, "rod_mm": 36, "stroke_mm": 250, "rated_pressure_bar": 160, "mounting": "Clevis both ends", "seal_material": "PU", "unit_cost": 21000}),
    "jack": ("Re-railing jack 150 t, 700 bar", "cylinder", "hydraulic", "DEMO Hydro Seals", "RJ-150-700", None,
             {"bore_mm": 165, "rod_mm": 140, "stroke_mm": 250, "rated_pressure_bar": 700, "max_pressure_bar": 720, "unit_cost": 185000}),
    "filter": ("Return line filter 10 µm", "filter", "hydraulic", "Hydac", "RF BN/HC 160", "DEMO-SP-FILTER-RET10", {"flow_rate_lpm": 160, "unit_cost": 1650}),
    "hose": ("Hose 1/2 in 2SN with crimped ends", "hose", "hydraulic", "Parker", "302-8", "DEMO-HYD-HOSE-12", {"rated_pressure_bar": 275, "unit_cost": 380}),
    "reservoir": ("Reservoir 120 L with breather & level gauge", "reservoir", "hydraulic", "DEMO Hydro Seals", "RES-120", None, {"unit_cost": 14500}),
    "accumulator": ("Bladder accumulator 4 L", "accumulator", "hydraulic", "Hydac", "SB330-4", None, {"rated_pressure_bar": 330, "unit_cost": 23500}),
    "compressor": ("Engine-driven air compressor 300 L/min", "compressor", "pneumatic", "Knorr-Bremse", "LP 4857", None, {"flow_rate_lpm": 300, "max_pressure_bar": 10, "unit_cost": 68000}),
    "frl": ("FRL unit 1/2 in", "frl_unit", "pneumatic", "Festo", "MSB6-1/2", None, {"max_pressure_bar": 16, "unit_cost": 7800}),
    "brake_cyl": ("Brake cylinder 8 in (pneumatic)", "pneumatic_actuator", "pneumatic", "Knorr-Bremse", "BC-8", None, {"bore_mm": 203, "stroke_mm": 100, "unit_cost": 15500}),
    "solenoid": ("Solenoid valve 5/2 24 V DC", "solenoid_valve", "pneumatic", "Festo", "VUVG-L14-M52", None, {"max_pressure_bar": 10, "unit_cost": 4200}),
    "receiver": ("Air receiver 100 L", "air_receiver", "pneumatic", "DEMO Hydro Seals", "AR-100", None, {"max_pressure_bar": 10, "unit_cost": 16500}),
}


def seed_components(demo):
    """Component master — one entry per fluid-power component model, linked to Store items where they exist."""
    eng = _p(demo, "hydraulic_engineer")
    comps = {}
    for key, (name, cat, stype, make, model, code, extra) in COMPONENTS.items():
        comps[key] = demo.call("POST", "/hydraulic/components", eng, json={
            "name": f"{LABEL} {name}", "category": cat, "system_type": stype, "manufacturer": make, "model_number": model,
            "part_number": model, "store_item_id": _item(demo, code) if code else None, "media": "ISO VG 68" if stype == "hydraulic" else "Compressed air",
            "specifications": [{"label": "Duty", "value": "Railway track machine, -10 to +55 °C"}], **extra})
    demo.call("POST", "/hydraulic/documents", eng, data={"entity_type": "component", "entity_id": str(comps["pump"]["id"]),
              "doc_type": "datasheet", "title": f"{LABEL} AZPF gear pump datasheet"}, files=[("files", demo.pdf("DEMO-AZPF-datasheet.pdf"))])
    demo.data["hydraulic_components"] = comps
    demo.note(MOD, f"{len(comps)} components in the master (pump datasheet attached)")
    return comps


# ── Systems ───────────────────────────────────────────────────────────────

def seed_systems(demo):
    """Hydraulic / pneumatic systems of the machines, each at a lifecycle status."""
    eng = _p(demo, "hydraulic_engineer")
    branch = demo.data.get("branch_id")

    def mk(key, name, stype, status, **kw):
        return demo.call("POST", "/hydraulic/systems", eng, json={
            "name": f"{LABEL} {name}", "system_type": stype, "status": status, "branch_id": branch, "owner_id": eng.id, **kw})

    systems = {
        "rrv_hyd": mk("rrv_hyd", "RRV-8W hydraulics — guide wheel lift & rail travel", "hydraulic", "under_build",
                      application="Guide wheel lift (4 cylinders) + hydrostatic rail travel (2 orbital motors)", equipment_ref="DEMO-RRV-8W",
                      working_pressure_bar=160, max_pressure_bar=210, flow_rate=40, reservoir_capacity_l=120, prime_mover_kw=11,
                      fluid_medium="ISO VG 68 mineral oil", filtration_micron=10, cleanliness_target="ISO 18/16/13",
                      operating_temp_min_c=-10, operating_temp_max_c=70),
        "rrv_pneu": mk("rrv_pneu", "RRV-8W pneumatic brake system", "pneumatic", "design", application="Rail brake (4 brake cylinders), horn",
                       equipment_ref="DEMO-RRV-8W", working_pressure_bar=7, max_pressure_bar=10, flow_rate=300, fluid_medium="Compressed air, dried"),
        "rgm_hyd": mk("rgm_hyd", "RGM-16 stone carriage hydraulics", "hydraulic", "testing",
                      application="Stone head lift / pressure control (16 heads)", equipment_ref="DEMO-RGM-16",
                      working_pressure_bar=140, max_pressure_bar=180, flow_rate=60, reservoir_capacity_l=200, prime_mover_kw=18.5,
                      fluid_medium="ISO VG 68 mineral oil", filtration_micron=10, cleanliness_target="ISO 17/15/12"),
        "hre_hyd": mk("hre_hyd", "HRE-150 700 bar re-railing power pack", "hydraulic", "commissioned",
                      application="2 x 150 t lifting jacks + 500 mm traverse", equipment_ref="DEMO-HRE-150",
                      working_pressure_bar=700, max_pressure_bar=720, flow_rate=4, reservoir_capacity_l=40, prime_mover_kw=7.5,
                      fluid_medium="ISO VG 32"),
        "tic_pneu": mk("tic_pneu", "TIC-01 sensor beam pneumatics", "pneumatic", "design", application="Sensor beam deploy / stow",
                       equipment_ref="DEMO-TIC-01", working_pressure_bar=6, max_pressure_bar=8),
    }
    demo.data["hydraulic_systems"] = systems
    demo.note(MOD, f"{len(systems)} systems: under build, design (2), testing, commissioned")
    return systems


# ── Circuits ──────────────────────────────────────────────────────────────

def _circuit(demo, system, title, number, *, stype="hydraulic"):
    eng = _p(demo, "hydraulic_engineer")
    c = demo.call("POST", "/hydraulic/circuits", eng, json={
        "title": f"{LABEL} {title}", "system_type": stype, "system_id": system["id"], "drawing_number": number,
        "symbol_standard": "ISO 1219-1", "description": f"{LABEL} {title}.", "change_note": "First issue"})
    demo.call("POST", "/hydraulic/documents", eng, data={"entity_type": "circuit", "entity_id": str(c["id"]), "doc_type": "circuit_diagram",
              "title": f"{LABEL} {number} circuit diagram"}, files=[("files", demo.pdf(f"{number}.pdf"))])
    return c


def seed_circuits(demo, systems):
    """Circuit revisions: approved (+ next draft), under review, returned, draft."""
    eng, head = _p(demo, "hydraulic_engineer"), _p(demo, "hydraulic_head")
    design_doc = (demo.data.get("design_documents") or {}).get("rrv_hyd_circuit")
    number = design_doc["doc_number"] if design_doc else "DEMO-HYC-RRV-01"
    out = {}
    c = _circuit(demo, systems["rrv_hyd"], "RRV-8W guide wheel lift & travel circuit", number)
    demo.call("POST", f"/hydraulic/circuits/{c['id']}/submit", eng)
    out["rrv_hyd"] = demo.call("POST", f"/hydraulic/circuits/{c['id']}/approve", head, json={"remarks": "Relief set 210 bar, counterbalance on lift OK."})
    out["rrv_hyd_r1"] = demo.call("POST", f"/hydraulic/circuits/{c['id']}/revise", eng, json={"change_note": "Add an accumulator for the guide wheel lock circuit."})

    c = _circuit(demo, systems["rgm_hyd"], "RGM-16 stone head pressure control circuit", "DEMO-HYC-RGM-01")
    out["rgm_hyd"] = demo.call("POST", f"/hydraulic/circuits/{c['id']}/submit", eng)

    c = _circuit(demo, systems["hre_hyd"], "HRE-150 700 bar jack circuit", "DEMO-HYC-HRE-01")
    demo.call("POST", f"/hydraulic/circuits/{c['id']}/submit", eng)
    out["hre_hyd"] = demo.call("POST", f"/hydraulic/circuits/{c['id']}/approve", head, json={"remarks": "Safety valve at 720 bar verified."})

    c = _circuit(demo, systems["rrv_pneu"], "RRV-8W pneumatic brake circuit", "DEMO-PNC-RRV-01", stype="pneumatic")
    out["rrv_pneu"] = c
    c = _circuit(demo, systems["tic_pneu"], "TIC-01 sensor beam deploy circuit", "DEMO-PNC-TIC-01", stype="pneumatic")
    demo.call("POST", f"/hydraulic/circuits/{c['id']}/submit", eng)
    out["tic_pneu"] = demo.call("POST", f"/hydraulic/circuits/{c['id']}/return", head, json={
        "remarks": "Add a pilot-operated check valve so the beam can't drop on air loss."})
    demo.data["hydraulic_circuits"] = out
    demo.note(MOD, f"{len(out)} circuit revisions: approved + R1 draft, under review, approved, draft, returned")
    return out


# ── BOMs ──────────────────────────────────────────────────────────────────

def seed_boms(demo, systems, circuits, comps):
    """Hydraulic BOMs: released + next draft, under review, released, draft."""
    eng, head = _p(demo, "hydraulic_engineer"), _p(demo, "hydraulic_head")

    def items(*rows):
        return [{"component_id": comps[k]["id"], "tag_number": tag, "quantity": q, "uom": uom} for k, tag, q, uom in rows]

    out = {}
    b = demo.call("POST", "/hydraulic/boms", eng, json={
        "title": f"{LABEL} RRV-8W hydraulic BOM", "system_type": "hydraulic", "system_id": systems["rrv_hyd"]["id"],
        "circuit_id": circuits["rrv_hyd"]["id"], "items": items(
            ("pump", "P1", 1, "NOS"), ("motor", "M1-M2", 2, "NOS"), ("dcv", "V1-V4", 4, "NOS"), ("relief", "RV1", 1, "NOS"),
            ("cylinder", "C1-C4", 4, "NOS"), ("filter", "F1", 1, "NOS"), ("hose", None, 36, "MTR"), ("reservoir", "T1", 1, "NOS"))})
    demo.call("POST", f"/hydraulic/boms/{b['id']}/submit", eng)
    out["rrv_hyd"] = demo.call("POST", f"/hydraulic/boms/{b['id']}/release", head)
    r1 = demo.call("POST", f"/hydraulic/boms/{b['id']}/revise", eng)
    out["rrv_hyd_r1"] = demo.call("PATCH", f"/hydraulic/boms/{r1['id']}", eng, json={"items": [
        *items(("pump", "P1", 1, "NOS"), ("motor", "M1-M2", 2, "NOS"), ("dcv", "V1-V4", 4, "NOS"), ("relief", "RV1", 1, "NOS"),
               ("cylinder", "C1-C4", 4, "NOS"), ("filter", "F1", 1, "NOS"), ("hose", None, 36, "MTR"), ("reservoir", "T1", 1, "NOS"),
               ("accumulator", "A1", 1, "NOS"))]})

    b = demo.call("POST", "/hydraulic/boms", eng, json={
        "title": f"{LABEL} RGM-16 stone carriage hydraulic BOM", "system_type": "hydraulic", "system_id": systems["rgm_hyd"]["id"],
        "items": items(("pump", "P1", 2, "NOS"), ("dcv", "V1-V16", 16, "NOS"), ("cylinder", "C1-C16", 16, "NOS"), ("filter", "F1-F2", 2, "NOS"),
                       ("hose", None, 120, "MTR"))})
    out["rgm_hyd"] = demo.call("POST", f"/hydraulic/boms/{b['id']}/submit", eng)

    b = demo.call("POST", "/hydraulic/boms", eng, json={
        "title": f"{LABEL} HRE-150 power pack & jacks BOM", "system_type": "hydraulic", "system_id": systems["hre_hyd"]["id"],
        "circuit_id": circuits["hre_hyd"]["id"], "items": items(("jack", "J1-J2", 2, "NOS"), ("hose", None, 45, "MTR"), ("relief", "SV1", 1, "NOS"))})
    demo.call("POST", f"/hydraulic/boms/{b['id']}/submit", eng)
    out["hre_hyd"] = demo.call("POST", f"/hydraulic/boms/{b['id']}/release", head)

    out["rrv_pneu"] = demo.call("POST", "/hydraulic/boms", eng, json={
        "title": f"{LABEL} RRV-8W pneumatic brake BOM", "system_type": "pneumatic", "system_id": systems["rrv_pneu"]["id"],
        "items": items(("compressor", "K1", 1, "NOS"), ("receiver", "R1", 1, "NOS"), ("frl", "FRL1", 1, "NOS"),
                       ("solenoid", "SV1-SV2", 2, "NOS"), ("brake_cyl", "BC1-BC4", 4, "NOS"))})
    demo.data["hydraulic_boms"] = out
    demo.note(MOD, f"{len(out)} hydraulic BOM revisions: released + R1 draft, under review, released, draft")
    return out


# ── Calculations (module's own calculator) ───────────────────────────────

CALCS = [  # key, title, calc_type, system key, inputs (keys from GET /hydraulic/calculations/types)
    ("lift_force", "Guide wheel lift cylinder force", "cylinder_force", "rrv_hyd", {"bore_mm": 63, "rod_mm": 36, "pressure_bar": 160, "efficiency_pct": 95}),
    ("lift_speed", "Guide wheel lift speed / cycle time", "cylinder_speed", "rrv_hyd", {"bore_mm": 63, "rod_mm": 36, "stroke_mm": 250, "flow_lpm": 20}),
    ("pump_flow", "Main pump delivery at 1500 rpm", "pump_flow", "rrv_hyd", {"displacement_cc": 28, "speed_rpm": 1500, "vol_efficiency_pct": 95}),
    ("pump_power", "Pump drive power", "pump_power", "rrv_hyd", {"flow_lpm": 40, "pressure_bar": 160, "overall_efficiency_pct": 85}),
    ("pressure_line", "Pressure line sizing", "pipe_sizing", "rrv_hyd", {"flow_lpm": 40, "line_type": "pressure", "actual_id_mm": 12.7}),
    ("accumulator", "Guide wheel lock accumulator", "accumulator_sizing", "rrv_hyd", {"delta_v_l": 0.8, "p1_bar": 100, "p2_bar": 160, "process": "adiabatic"}),
    ("reservoir", "Stone carriage reservoir size", "reservoir_sizing", "rgm_hyd", {"pump_flow_lpm": 60, "factor": 3}),
    ("heat", "Stone carriage heat load", "heat_load", "rgm_hyd", {"input_power_kw": 18.5, "overall_efficiency_pct": 75}),
    ("brake_force", "Brake cylinder force", "pneumatic_cylinder_force", "rrv_pneu", {"bore_mm": 203, "rod_mm": 30, "pressure_bar": 5, "efficiency_pct": 90}),
    ("receiver", "Brake air receiver size", "air_receiver_sizing", "rrv_pneu", {"demand_nl_min": 600, "p_max_bar": 10, "p_min_bar": 7, "time_min": 1}),
]


def seed_calculations(demo, systems):
    """Saved engineering calculations — results come from the module's calculator, not from here."""
    eng = _p(demo, "hydraulic_engineer")
    catalog = {c["key"]: {i["key"] for i in c["inputs"]} for c in demo.call("GET", "/hydraulic/calculations/types", eng)}
    out = {}
    for key, title, ctype, sys_key, inputs in CALCS:
        if ctype not in catalog:
            demo.note(MOD, f"calculation type '{ctype}' isn't offered by the module — '{title}' skipped")
            continue
        clean = {k: v for k, v in inputs.items() if k in catalog[ctype]}
        st, body = demo.try_call("POST", "/hydraulic/calculations", eng, json={
            "title": f"{LABEL} {title}", "calc_type": ctype, "system_id": systems[sys_key]["id"], "inputs": clean,
            "remarks": f"{LABEL} design calculation for {systems[sys_key]['name']}."})
        if st >= 400:
            demo.note(MOD, f"calculation '{title}' refused ({st}): {body}")
            continue
        out[key] = body
    demo.data["hydraulic_calculations"] = out
    demo.note(MOD, f"{len(out)} calculations saved through the module calculator")
    return out


# ── Testing ───────────────────────────────────────────────────────────────

def _reading(param, unit, lo, hi, measured=None, text=None, spec=None):
    return {"parameter": param, "unit": unit, "min_value": lo, "max_value": hi, "measured_value": measured, "measured_text": text,
            "specification": spec, "result": "na"}


def seed_tests(demo, systems, comps):
    """Tests at every stage: completed pass / fail (+ re-test), under review, in progress, planned."""
    eng, head = _p(demo, "hydraulic_engineer"), _p(demo, "hydraulic_head")
    t = demo.today
    out = {}

    def mk(title, ttype, **kw):
        return demo.call("POST", "/hydraulic/tests", eng, json={"title": f"{LABEL} {title}", "test_type": ttype, "tested_by_id": eng.id, **kw})

    proof = mk("HRE-150 jack proof test 1.1 x WP", "proof_test", system_id=systems["hre_hyd"]["id"], component_id=comps["jack"]["id"],
               component_serial="RJ150-0012", test_date=str(t - timedelta(days=24)), test_standard="ISO 10771-1", test_pressure_bar=770,
               hold_time_min=10, test_medium="ISO VG 32", witnessed_by="L&T Metro inspector",
               readings=[_reading("Holding pressure after 10 min", "bar", 760, 780, 768), _reading("Visible leakage", None, None, None, text="None")])
    demo.call("POST", "/hydraulic/documents", eng, data={"entity_type": "test", "entity_id": str(proof["id"]), "doc_type": "test_certificate",
              "title": f"{LABEL} Proof test certificate RJ150-0012"}, files=[("files", demo.pdf("DEMO-RJ150-0012-proof.pdf"))])
    demo.call("POST", f"/hydraulic/tests/{proof['id']}/submit", eng, json={"result": "pass", "remarks": "No leakage, no permanent set."})
    out["hre_proof"] = demo.call("POST", f"/hydraulic/tests/{proof['id']}/complete", head, json={"result": "pass", "remarks": "Signed off."})

    drift = mk("Guide wheel cylinder drift test", "cylinder_drift", system_id=systems["rrv_hyd"]["id"], component_id=comps["cylinder"]["id"],
               component_serial="HC63-0104", test_date=str(t - timedelta(days=5)), test_pressure_bar=160, hold_time_min=30,
               readings=[_reading("Rod drift in 30 min under 2 t load", "mm", 0, 2, 5.5)])
    demo.call("POST", f"/hydraulic/tests/{drift['id']}/submit", eng, json={"result": "fail", "remarks": "Drift 5.5 mm — piston seal suspected."})
    out["rrv_drift_fail"] = demo.call("POST", f"/hydraulic/tests/{drift['id']}/complete", head, json={"result": "fail", "remarks": "Reseal and re-test."})
    out["rrv_drift_retest"] = demo.call("POST", f"/hydraulic/tests/{drift['id']}/retest", eng)

    leak = mk("RGM-16 stone carriage leak test", "leak_test", system_id=systems["rgm_hyd"]["id"], test_date=str(t - timedelta(days=2)),
              test_pressure_bar=180, hold_time_min=15, readings=[_reading("Pressure decay in 15 min", "bar", 0, 5, 2),
                                                                 _reading("External leakage at fittings", None, None, None, text="Dry")])
    out["rgm_leak"] = demo.call("POST", f"/hydraulic/tests/{leak['id']}/submit", eng, json={"result": "pass", "remarks": "Within limits."})

    relief = mk("RRV-8W main relief valve setting", "relief_valve_setting", system_id=systems["rrv_hyd"]["id"], component_id=comps["relief"]["id"],
                readings=[_reading("Cracking pressure", "bar", 205, 215), _reading("Full-flow pressure", "bar", None, 225)])
    demo.call("POST", f"/hydraulic/tests/{relief['id']}/start", eng)
    out["rrv_relief"] = demo.call("PATCH", f"/hydraulic/tests/{relief['id']}", eng, json={"readings": [
        _reading("Cracking pressure", "bar", 205, 215, 208), _reading("Full-flow pressure", "bar", None, 225)]})

    out["rrv_flow"] = mk("RRV-8W rail travel flow test", "flow_test", system_id=systems["rrv_hyd"]["id"], test_date=str(t + timedelta(days=4)),
                         readings=[_reading("Motor flow at 1500 rpm", "L/min", 38, 42)])
    demo.data["hydraulic_tests"] = out
    demo.note(MOD, f"{len(out)} tests: completed pass, completed fail + re-test planned, under review, in progress, planned")
    return out


def note_retired(demo):
    """Maintenance plans / service records / spare parts: the module refuses new ones (410)."""
    st, body = demo.try_call("POST", "/hydraulic/spare-parts", _p(demo, "hydraulic_engineer"), json={})
    demo.note(MOD, f"maintenance plans, service records, spare parts not seeded — the module answers {st} "
                   f"({(body or {}).get('detail') if isinstance(body, dict) else body}) per the 2026-10-07 decision")


def _already_seeded(demo) -> bool:
    from app.modules.hydraulic.models.system import HydSystem
    rows = demo.db.query(HydSystem).filter(HydSystem.name.like(f"{LABEL} %"), HydSystem.is_deleted == False).all()  # noqa: E712
    if not rows:
        return False
    eng = _p(demo, "hydraulic_head")
    demo.data["hydraulic_systems"] = {r.system_number: demo.call("GET", f"/hydraulic/systems/{r.id}", eng) for r in rows}
    demo.note(MOD, "DEMO hydraulic systems already present — registry rebuilt, nothing new created")
    return True


def seed(demo):
    from demo._engineering import ensure_engineering
    ensure_engineering(demo)
    if _already_seeded(demo):
        return
    comps = seed_components(demo)
    systems = seed_systems(demo)
    circuits = seed_circuits(demo, systems)
    seed_boms(demo, systems, circuits, comps)
    seed_calculations(demo, systems)
    seed_tests(demo, systems, comps)
    note_retired(demo)
    reply_requirement_shares(demo, "hydraulic", _p(demo, "hydraulic_head"),
                             ("feasible_with_changes", "Needs a second pump section (16 cc) for the attachment; power pack grows "
                                                       "from 11 to 15 kW — see the attached sizing."))
    head = _p(demo, "hydraulic_head")
    demo.data["hydraulic_systems"] = {k: demo.call("GET", f"/hydraulic/systems/{s['id']}", head) for k, s in demo.data["hydraulic_systems"].items()}
    d = demo.data
    demo.note(MOD, "status → systems: " + ", ".join(f"{k} {s['status']}" for k, s in d["hydraulic_systems"].items())
              + " | circuits: " + ", ".join(f"{k} {c['status']}" for k, c in d["hydraulic_circuits"].items())
              + " | BOMs: " + ", ".join(f"{k} {b['status']}" for k, b in d["hydraulic_boms"].items())
              + " | tests: " + ", ".join(f"{k} {x['status']}/{x['result']}" for k, x in d["hydraulic_tests"].items()))
