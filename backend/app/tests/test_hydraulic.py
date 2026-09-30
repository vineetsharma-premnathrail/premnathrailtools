"""Tests for the Hydraulic & Pneumatic module: the calculation engine
against hand-worked values, and the system → component → circuit → BOM →
test → maintenance plan → service record (with Store issue) flow."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.calculations import CalculationError, run_calculation
from app.modules.hydraulic.models.document import HydDocument
from app.modules.hydraulic.service import next_revision
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/hydraulic"


def make_user(db, email, apps=("hydraulic",), role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def result(out: dict, key: str):
    return next(r["value"] for r in out["results"] if r["key"] == key)


# ---------------------------------------------------------------------------
# Calculation engine
# ---------------------------------------------------------------------------

def test_cylinder_force_matches_hand_calc():
    # 63 mm bore at 160 bar, 100 % efficiency: π·63²/4 = 3117.25 mm² × 16 N/mm² = 49.876 kN
    _, out = run_calculation("cylinder_force", {"bore_mm": 63, "rod_mm": 36, "pressure_bar": 160, "efficiency_pct": 100})
    assert result(out, "extend_force_kn") == pytest.approx(49.88, abs=0.01)
    # annulus = 3117.25 − 1017.88 = 2099.37 mm² → 33.59 kN
    assert result(out, "retract_force_kn") == pytest.approx(33.59, abs=0.01)


def test_pump_power_and_motor_size():
    # 40 L/min × 180 bar / 600 = 12 kW hydraulic; / 0.85 = 14.12 kW → 15 kW motor
    _, out = run_calculation("pump_power", {"flow_lpm": 40, "pressure_bar": 180, "overall_efficiency_pct": 85})
    assert result(out, "hydraulic_power_kw") == pytest.approx(12.0)
    assert result(out, "input_power_kw") == pytest.approx(14.12, abs=0.01)
    assert result(out, "recommended_motor_kw") == 15


def test_pipe_sizing_flags_fast_suction_line():
    # 40 L/min in a 16 mm bore = 3.32 m/s — far too fast for suction
    _, out = run_calculation("pipe_sizing", {"flow_lpm": 40, "line_type": "suction", "actual_id_mm": 16})
    assert result(out, "actual_velocity_m_s") == pytest.approx(3.32, abs=0.01)
    assert out["warnings"] and "cavitation" in out["warnings"][0]


def test_accumulator_isothermal():
    # p0=90, p1=100, p2=200 bar(g), ΔV=1 L, n=1 → V0 = 1 / (91.01/101.01 − 91.01/201.01)
    _, out = run_calculation("accumulator_sizing", {"delta_v_l": 1, "p1_bar": 100, "p2_bar": 200, "p0_bar": 90, "process": "isothermal"})
    expected = 1 / (91.01325 / 101.01325 - 91.01325 / 201.01325)
    assert result(out, "required_volume_l") == pytest.approx(expected, abs=0.01)
    assert result(out, "recommended_size_l") == 2.5


def test_air_consumption():
    # Ø50 / Ø20 × 200 mm, double acting, 6 bar, 10 cycles/min
    _, out = run_calculation("air_consumption", {"bore_mm": 50, "rod_mm": 20, "stroke_mm": 200, "cycles_per_min": 10, "pressure_bar": 6})
    swept = (3.14159265 * 50 ** 2 / 4 * 200 + 3.14159265 * (50 ** 2 - 20 ** 2) / 4 * 200) / 1e6
    assert result(out, "consumption_nl_min") == pytest.approx(swept * (7.01325 / 1.01325) * 10, abs=0.1)


def test_calculation_input_errors_are_readable():
    with pytest.raises(CalculationError, match="smaller than the bore"):
        run_calculation("cylinder_force", {"bore_mm": 50, "rod_mm": 60, "pressure_bar": 100, "efficiency_pct": 95})
    with pytest.raises(CalculationError, match="Pre-charge"):
        run_calculation("accumulator_sizing", {"delta_v_l": 1, "p1_bar": 100, "p2_bar": 200, "p0_bar": 120})
    with pytest.raises(CalculationError, match="Unknown calculation type"):
        run_calculation("nope", {})


def test_next_revision():
    assert next_revision("A") == "B"
    assert next_revision("Z") == "AA"
    assert next_revision("AZ") == "BA"
    assert next_revision("3") == "4"


# ---------------------------------------------------------------------------
# API flow
# ---------------------------------------------------------------------------

@pytest.fixture
def ctx(client, db):
    engineer = make_user(db, "engineer@premnathrail.com")
    approver = make_user(db, "approver@premnathrail.com")
    h = auth(engineer)
    system = client.post(f"{API}/systems", json={
        "name": "Tamping unit power pack", "system_type": "hydraulic", "status": "in_service",
        "working_pressure_bar": 180, "max_pressure_bar": 210, "flow_rate": 40, "running_hours": 1000,
    }, headers=h)
    assert system.status_code == 200, system.text
    pump = client.post(f"{API}/components", json={
        "name": "Gear pump 28cc", "category": "pump", "manufacturer": "Bosch Rexroth", "displacement_cc": 28,
        "rated_pressure_bar": 210, "unit_cost": 25000, "specifications": [{"label": "Rotation", "value": "CW"}],
    }, headers=h)
    assert pump.status_code == 200, pump.text
    return {"engineer": engineer, "approver": approver, "h": h, "system": system.json(), "pump": pump.json()}


def test_system_and_component_numbering(client, ctx):
    assert ctx["system"]["system_number"] == f"HYS-{date.today().year}-0001"
    assert ctx["pump"]["code"] == "PMP-0001"
    assert ctx["pump"]["specifications"] == [{"label": "Rotation", "value": "CW"}]
    pn = client.post(f"{API}/systems", json={"name": "Brake air", "system_type": "pneumatic"}, headers=ctx["h"])
    assert pn.json()["system_number"] == f"PNS-{date.today().year}-0001"
    bad = client.post(f"{API}/systems", json={"name": "X", "working_pressure_bar": 300, "max_pressure_bar": 200}, headers=ctx["h"])
    assert bad.status_code == 400 and "can't be higher" in bad.json()["detail"]


def test_module_access_required(client, db):
    outsider = make_user(db, "outsider@premnathrail.com", apps=("erp",))
    assert client.get(f"{API}/systems", headers=auth(outsider)).status_code == 403


def test_circuit_review_and_revision(client, db, ctx):
    h, ha = ctx["h"], auth(ctx["approver"])
    c = client.post(f"{API}/circuits", json={"title": "Main power pack circuit", "system_id": ctx["system"]["id"]}, headers=h).json()
    assert c["status"] == "draft" and c["revision"] == "A"

    # Can't submit without a drawing attached.
    r = client.post(f"{API}/circuits/{c['id']}/submit", headers=h)
    assert r.status_code == 400 and "Upload the circuit diagram" in r.json()["detail"]
    db.add(HydDocument(entity_type="circuit", entity_id=c["id"], doc_type="circuit_diagram", title="Schematic", file_name="ckt.pdf"))
    db.commit()
    assert client.post(f"{API}/circuits/{c['id']}/submit", headers=h).json()["status"] == "under_review"

    # Submitter can't approve their own circuit.
    assert client.post(f"{API}/circuits/{c['id']}/approve", json={}, headers=h).status_code == 403
    assert client.post(f"{API}/circuits/{c['id']}/return", json={"remarks": ""}, headers=ha).status_code == 400
    assert client.post(f"{API}/circuits/{c['id']}/approve", json={"remarks": "OK"}, headers=ha).json()["status"] == "approved"
    assert client.patch(f"{API}/circuits/{c['id']}", json={"title": "x"}, headers=h).status_code == 409

    rev_b = client.post(f"{API}/circuits/{c['id']}/revise", json={"change_note": "Added accumulator"}, headers=h).json()
    assert rev_b["revision"] == "B" and rev_b["circuit_number"] == c["circuit_number"]
    assert client.post(f"{API}/circuits/{c['id']}/revise", json={"change_note": "again"}, headers=h).status_code == 409
    db.add(HydDocument(entity_type="circuit", entity_id=rev_b["id"], doc_type="circuit_diagram", title="Schematic B", file_name="ckt-b.pdf"))
    db.commit()
    client.post(f"{API}/circuits/{rev_b['id']}/submit", headers=h)
    client.post(f"{API}/circuits/{rev_b['id']}/approve", json={}, headers=ha)
    old = client.get(f"{API}/circuits/{c['id']}", headers=h).json()
    assert old["status"] == "superseded"
    assert [r["revision"] for r in old["revisions"]] == ["A", "B"]


def test_bom_release_revise_and_cost(client, ctx):
    h = ctx["h"]
    valve = client.post(f"{API}/components", json={"name": "4/3 DCV NG6", "category": "directional_valve", "unit_cost": 8000}, headers=h).json()
    dup = client.post(f"{API}/boms", json={"title": "Pack BOM", "items": [
        {"component_id": ctx["pump"]["id"], "tag_number": "P1", "quantity": 1},
        {"component_id": valve["id"], "tag_number": "p1", "quantity": 1},
    ]}, headers=h)
    assert dup.status_code == 400 and "P1" in dup.json()["detail"]

    bom = client.post(f"{API}/boms", json={"title": "Pack BOM", "system_id": ctx["system"]["id"], "items": [
        {"component_id": ctx["pump"]["id"], "tag_number": "P1", "quantity": 1},
        {"component_id": valve["id"], "tag_number": "V1", "quantity": 2},
    ]}, headers=h).json()
    assert bom["total_cost"] == 41000 and bom["line_count"] == 2
    # Component on a draft BOM can't be deleted.
    assert client.delete(f"{API}/components/{valve['id']}", headers=h).status_code == 409

    assert client.post(f"{API}/boms/{bom['id']}/release", headers=h).json()["status"] == "released"
    rev = client.post(f"{API}/boms/{bom['id']}/revise", headers=h).json()
    assert rev["revision"] == "B" and rev["status"] == "draft" and len(rev["items"]) == 2
    client.post(f"{API}/boms/{rev['id']}/release", headers=h)
    assert client.get(f"{API}/boms/{bom['id']}", headers=h).json()["status"] == "obsolete"
    csv = client.get(f"{API}/boms/{rev['id']}/export", headers=h)
    assert csv.status_code == 200 and "PMP-0001" in csv.text


def test_saved_calculation_is_recomputed_server_side(client, ctx):
    h = ctx["h"]
    types = client.get(f"{API}/calculations/types", headers=h).json()
    assert {"cylinder_force", "air_consumption"} <= {t["key"] for t in types}
    saved = client.post(f"{API}/calculations", json={
        "title": "Lift cylinder", "calc_type": "pump_power", "system_id": ctx["system"]["id"],
        "inputs": {"flow_lpm": 40, "pressure_bar": 180, "overall_efficiency_pct": 85},
    }, headers=h)
    assert saved.status_code == 200, saved.text
    assert result(saved.json()["results"], "recommended_motor_kw") == 15
    # A pneumatic calc can't be attached to a hydraulic system.
    wrong = client.post(f"{API}/calculations", json={
        "title": "x", "calc_type": "air_consumption", "system_id": ctx["system"]["id"],
        "inputs": {"bore_mm": 50, "rod_mm": 20, "stroke_mm": 100, "cycles_per_min": 5, "pressure_bar": 6},
    }, headers=h)
    assert wrong.status_code == 400
    bad = client.post(f"{API}/calculations/compute", json={"calc_type": "cylinder_force", "inputs": {"bore_mm": 50, "rod_mm": 60, "pressure_bar": 100}}, headers=h)
    assert bad.status_code == 400 and "smaller than the bore" in bad.json()["detail"]


def test_test_readings_auto_judged_and_completion_rules(client, ctx):
    h = ctx["h"]
    t = client.post(f"{API}/tests", json={
        "title": "Proof test", "test_type": "proof_test", "system_id": ctx["system"]["id"], "test_pressure_bar": 315,
        "readings": [
            {"parameter": "Pressure drop in 10 min", "unit": "bar", "max_value": 2, "measured_value": 3.5},
            {"parameter": "External leakage", "measured_text": "None", "result": "pass"},
        ],
    }, headers=h).json()
    assert [r["result"] for r in t["readings"]] == ["fail", "pass"] and t["failed_readings"] == 1
    r = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pass"}, headers=h)
    assert r.status_code == 400 and "outside their limits" in r.json()["detail"]
    done = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "fail", "remarks": "Seal leak at V1"}, headers=h).json()
    assert done["status"] == "completed" and done["result"] == "fail"
    assert client.patch(f"{API}/tests/{t['id']}", json={"title": "x"}, headers=h).status_code == 409
    retest = client.post(f"{API}/tests/{t['id']}/retest", headers=h).json()
    assert retest["status"] == "planned" and retest["readings"][0]["max_value"] == 2 and retest["readings"][0]["measured_value"] is None


def test_plan_service_record_store_issue(client, db, ctx):
    h = ctx["h"]
    loc = StoreLocation(name="Main Store", code="MS01")
    item = StoreItem(item_code="SP-FLT-10", item_name="Return filter element 10µ", item_type="spare_part", uom="NOS", standard_cost=1200, status="active")
    db.add_all([loc, item])
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=3, reference_type="manual")
    db.commit()

    spare = client.post(f"{API}/spare-parts", json={
        "name": "Return filter element", "category": "filter_element", "store_item_id": item.id,
        "min_stock_qty": 4, "criticality": "critical",
    }, headers=h).json()
    assert spare["part_code"] == "HSP-00001" and spare["available_qty"] == 3 and spare["stock_status"] == "low"
    assert client.post(f"{API}/spare-parts", json={"name": "dup", "store_item_id": item.id}, headers=h).status_code == 409

    last = date.today() - timedelta(days=40)
    plan = client.post(f"{API}/maintenance-plans", json={
        "title": "Change return filter", "system_id": ctx["system"]["id"], "maintenance_type": "filter_change",
        "frequency_days": 30, "last_done_date": last.isoformat(), "checklist": "Isolate pump\nReplace element",
    }, headers=h).json()
    assert plan["due_status"] == "overdue" and plan["next_due_date"] == (last + timedelta(days=30)).isoformat()
    assert client.post(f"{API}/maintenance-plans", json={"title": "x", "system_id": ctx["system"]["id"]}, headers=h).status_code == 400

    rec = client.post(f"{API}/service-records", json={
        "system_id": ctx["system"]["id"], "plan_id": plan["id"], "service_type": "filter_change",
        "service_date": date.today().isoformat(), "running_hours": 1250, "labour_cost": 500,
        "parts": [{"spare_part_id": spare["id"], "quantity": 1}],
    }, headers=h).json()
    assert rec["checklist"] == "Isolate pump\nReplace element" and rec["parts"][0]["unit_cost"] == 1200
    assert rec["total_cost"] == 1700
    assert client.post(f"{API}/service-records/{rec['id']}/complete", json={}, headers=h).status_code == 400  # no work_done

    done = client.post(f"{API}/service-records/{rec['id']}/complete", json={
        "work_done": "Replaced return filter element", "issue_from_location_id": loc.id,
    }, headers=h).json()
    assert done["status"] == "completed" and done["parts"][0]["issued_location_name"] == "Main Store"
    db.expire_all()
    assert db.query(StoreStockBalance).filter_by(item_id=item.id, location_id=loc.id).first().on_hand_qty == 2

    plan_after = client.get(f"{API}/maintenance-plans/{plan['id']}", headers=h).json()
    assert plan_after["last_done_date"] == date.today().isoformat() and plan_after["due_status"] == "ok"
    assert client.get(f"{API}/systems/{ctx['system']['id']}", headers=h).json()["running_hours"] == 1250
    assert client.get(f"{API}/spare-parts/{spare['id']}", headers=h).json()["used_last_12m"] == 1


def test_breakdown_takes_system_down_and_back(client, ctx):
    h, sid = ctx["h"], ctx["system"]["id"]
    rec = client.post(f"{API}/service-records", json={
        "system_id": sid, "service_type": "breakdown", "service_date": date.today().isoformat(), "reported_problem": "Pump noisy",
    }, headers=h).json()
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "under_maintenance"
    assert client.delete(f"{API}/systems/{sid}", headers=h).status_code == 409
    client.post(f"{API}/service-records/{rec['id']}/complete", json={"work_done": "Replaced coupling"}, headers=h)
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "in_service"


def test_dashboard(client, ctx):
    d = client.get(f"{API}/dashboard", headers=ctx["h"])
    assert d.status_code == 200, d.text
    k = d.json()["kpis"]
    assert k["hydraulic_systems"] == 1 and k["active_components"] == 1 and k["in_service"] == 1


def test_changing_job_type_moves_system_status(client, ctx):
    h, sid = ctx["h"], ctx["system"]["id"]
    rec = client.post(f"{API}/service-records", json={"system_id": sid, "service_type": "preventive", "service_date": date.today().isoformat()}, headers=h).json()
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "in_service"
    client.patch(f"{API}/service-records/{rec['id']}", json={"service_type": "breakdown"}, headers=h)
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "under_maintenance"
    client.patch(f"{API}/service-records/{rec['id']}", json={"service_type": "inspection"}, headers=h)
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "in_service"


def test_spare_takes_store_unit_and_hours_only_plan_has_no_date(client, db, ctx):
    h = ctx["h"]
    item = StoreItem(item_code="SP-OIL-46", item_name="HLP 46 oil", item_type="consumable", uom="LTR", status="active")
    db.add(item)
    db.commit()
    assert client.post(f"{API}/spare-parts", json={"name": "Hydraulic oil", "store_item_id": item.id}, headers=h).json()["uom"] == "LTR"
    assert client.post(f"{API}/spare-parts", json={"name": "O-ring kit"}, headers=h).json()["uom"] == "NOS"
    plan = client.post(f"{API}/maintenance-plans", json={
        "title": "Oil change", "system_id": ctx["system"]["id"], "frequency_hours": 200, "start_date": date.today().isoformat(),
    }, headers=h).json()
    # System is at 1000 h, plan starts counting from there → due at 1200 h, no calendar date.
    assert plan["next_due_date"] is None and plan["next_due_hours"] == 1200 and plan["due_status"] == "ok"
