"""End-to-end tests for Production RRV Builds: build → stage gates → main &
sub-assembly work orders → electrical/hydraulic integration gates → final
inspection → vehicle tests with auto-raised rework → completion registering
the machine → handover writing dates/warranty to it → certificate.

Quality's inspection-number generator takes a Postgres advisory lock that
SQLite can't run, so it's replaced with a plain counter (as in test_production)."""
from datetime import date, timedelta
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.electrical.models.job import ElectricalJob
from app.modules.erp.models.project import Project
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.models.testing import HydTest
from app.modules.main.models.user import User
from app.modules.quality.models.inspection import QualityInspection
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.production.service import notify_inspection_result

API = "/api/v1/production"
TODAY = date.today()


@pytest.fixture(autouse=True)
def _sqlite_numbers(monkeypatch):
    seq = count(1)
    fake = lambda db, code: f"{code}-TEST-{next(seq):04d}"  # noqa: E731
    monkeypatch.setattr("app.modules.production.routes.work_orders.generate_inspection_number", fake)
    monkeypatch.setattr("app.modules.production.routes.rrv_builds.generate_inspection_number", fake)
    monkeypatch.setattr("app.modules.production.service.generate_stock_reservation_number", lambda db: f"RES-TEST-{next(seq):04d}")
    # A whole vehicle build is well over the 40 writes/min an IP may make.
    import app.middleware.owasp as owasp
    monkeypatch.setitem(owasp.RATE_CONFIG["write"], "limit", 100000)
    monkeypatch.setitem(owasp.RATE_CONFIG["delete"], "limit", 100000)


def make_user(db, email, role="user", manager=False, apps=("production", "quality")):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    if manager:
        user.is_production_manager = True
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def plant(client, db):
    planner = make_user(db, "planner@premnathrail.com")
    manager = make_user(db, "manager@premnathrail.com", manager=True)
    fitter = make_user(db, "fitter@premnathrail.com")
    raw = StoreLocation(name="Raw Material Store", code="RM01")
    fg = StoreLocation(name="Finished Goods", code="FG01")
    vehicle = StoreItem(item_code="FG-RRV-01", item_name="RRV 4x4", item_type="finished_good", uom="NOS", status="active")
    bogie = StoreItem(item_code="SA-BOG-01", item_name="Rail guide bogie", item_type="semi_finished", uom="NOS", status="active", standard_cost=50000.0)
    steel = StoreItem(item_code="RM-STL-01", item_name="Steel section", item_type="raw_material", uom="KG", standard_cost=80.0, status="active")
    db.add_all([raw, fg, vehicle, bogie, steel])
    db.commit()
    post_stock_transaction(db, item_id=steel.id, location_id=raw.id, transaction_type="receipt", quantity=1000, reference_type="manual")
    post_stock_transaction(db, item_id=bogie.id, location_id=raw.id, transaction_type="receipt", quantity=5, reference_type="manual")
    db.commit()
    h = auth(planner)
    ws = client.post(f"{API}/workstations", json={"code": "ASM-01", "name": "Assembly Bay", "workstation_type": "assembly_bay"}, headers=h).json()

    def bom(product, component, qty):
        b = client.post(f"{API}/boms", json={
            "product_item_id": product.id, "base_quantity": 1,
            "items": [{"component_item_id": component.id, "quantity": qty}],
            "operations": [{"sequence": 10, "operation_name": "Assemble", "workstation_id": ws["id"], "run_hours_per_unit": 8}],
        }, headers=h).json()
        client.post(f"{API}/boms/{b['id']}/activate", headers=h)
        return b

    return {
        "planner": planner, "manager": manager, "fitter": fitter, "h": h, "hm": auth(manager), "hf": auth(fitter),
        "raw": raw, "fg": fg, "vehicle": vehicle, "bogie": bogie, "steel": steel,
        "vehicle_bom": bom(vehicle, bogie, 2), "bogie_bom": bom(bogie, steel, 120),
    }


def new_build(client, p, **extra):
    body = {"rrv_model": "PR-RRV 4x4", "customer_name": "Northern Railway", "customer_po_number": "NR/PO/77",
            "target_completion_date": str(TODAY + timedelta(days=30)), "target_handover_date": str(TODAY + timedelta(days=45)),
            "build_manager_id": p["manager"].id, **extra}
    r = client.post(f"{API}/rrv-builds", json=body, headers=p["h"])
    assert r.status_code == 201, r.text
    return r.json()


def raise_wo(client, p, build, bom, role):
    r = client.post(f"{API}/work-orders", json={
        "bom_id": bom["id"], "quantity_planned": 1, "source_location_id": p["raw"].id, "target_location_id": p["fg"].id,
        "rrv_build_id": build["id"], "build_role": role,
    }, headers=p["h"])
    assert r.status_code == 200, r.text
    return r.json()


def run_wo(client, p, wo, issue=True, finish=True):
    """Release → issue all material → do the operation → receive → complete."""
    h = p["h"]
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    if issue:
        lines = [{"item_id": m["item_id"], "quantity": m["required_qty"]} for m in wo["materials"]]
        r = client.post(f"{API}/work-orders/{wo['id']}/issue-materials", json={"lines": lines}, headers=h)
        assert r.status_code == 200, r.text
        wo = r.json()
    if finish:
        op = wo["operations"][0]
        client.post(f"{API}/time-logs", json={"work_order_id": wo["id"], "operation_id": op["id"], "log_date": str(TODAY), "hours": 8, "qty_good": 1}, headers=h)
        assert client.post(f"{API}/work-orders/{wo['id']}/operations/{op['id']}/complete", json={}, headers=h).status_code == 200
        assert client.post(f"{API}/work-orders/{wo['id']}/receive-output", json={"quantity": 1, "batch_number": "SN-1"}, headers=h).status_code == 200
        wo = client.post(f"{API}/work-orders/{wo['id']}/complete", headers=h).json()
    return wo


def stage(detail, key):
    return next(s for s in detail["stages"] if s["stage_key"] == key)


def complete(client, headers, build_id, key, code=200):
    r = client.post(f"{API}/rrv-builds/{build_id}/stages/{key}/complete", json={}, headers=headers)
    assert r.status_code == code, r.text
    return r.json()


# ---------------------------------------------------------------------------

def test_create_seeds_stages_and_default_tests(client, plant):
    b = new_build(client, plant)
    assert b["build_number"].startswith("RRV-") and b["status"] == "planned"
    assert [s["stage_key"] for s in b["stages"]][:3] == ["planning", "material_kitting", "sub_assembly"]
    assert len(b["stages"]) == 12 and b["stages_done"] == 0
    assert "rail_trial" in b["required_tests"] and b["test_status"]["rail_trial"] == "pending"
    assert "Link the main" in " ".join(stage(b, "planning")["gate_problems"])
    r = client.post(f"{API}/rrv-builds/{b['id']}/stages/planning/complete", json={}, headers=plant["h"])
    assert r.status_code == 409 and "main (final vehicle assembly) work order" in r.json()["detail"]


def test_one_main_work_order_and_links(client, plant):
    b = new_build(client, plant)
    main = raise_wo(client, plant, b, plant["vehicle_bom"], "main")
    assert main["rrv_build_id"] == b["id"] and main["build_role"] == "main" and main["rrv_build_number"] == b["build_number"]
    r = client.post(f"{API}/work-orders", json={"bom_id": plant["vehicle_bom"]["id"], "quantity_planned": 1, "rrv_build_id": b["id"], "build_role": "main"}, headers=plant["h"])
    assert r.status_code == 409 and "already has a main work order" in r.json()["detail"]
    loose = client.post(f"{API}/work-orders", json={"bom_id": plant["bogie_bom"]["id"], "quantity_planned": 1}, headers=plant["h"]).json()
    d = client.post(f"{API}/rrv-builds/{b['id']}/work-orders/{loose['id']}", json={"build_role": "sub_assembly"}, headers=plant["h"]).json()
    assert {w["build_role"] for w in d["work_orders"]} == {"main", "sub_assembly"}
    other = new_build(client, plant, rrv_model="Second")
    r = client.post(f"{API}/rrv-builds/{other['id']}/work-orders/{loose['id']}", json={"build_role": "sub_assembly"}, headers=plant["h"])
    assert r.status_code == 409 and b["build_number"] in r.json()["detail"]
    d = client.delete(f"{API}/rrv-builds/{b['id']}/work-orders/{loose['id']}", headers=plant["h"]).json()
    assert len(d["work_orders"]) == 1


def test_full_build_to_handover(client, db, plant):
    h, hm = plant["h"], plant["hm"]
    b = new_build(client, plant, vehicle_serial_number="PR-RRV-2026-014", chassis_number="CHS-9981", engine_number="ENG-4410")
    bid = b["id"]
    sub = raise_wo(client, plant, b, plant["bogie_bom"], "sub_assembly")
    main = raise_wo(client, plant, b, plant["vehicle_bom"], "main")
    d = complete(client, h, bid, "planning")
    assert d["status"] == "in_progress"

    # Kitting needs every WO released and fully issued.
    r = client.post(f"{API}/rrv-builds/{bid}/stages/material_kitting/complete", json={}, headers=h)
    assert r.status_code == 409 and "draft" in r.json()["detail"]
    run_wo(client, plant, sub)                       # sub-assembly done
    main = run_wo(client, plant, main, finish=False)  # main issued, in progress
    complete(client, h, bid, "material_kitting")
    complete(client, h, bid, "sub_assembly")
    complete(client, h, bid, "main_assembly")

    consumption = client.get(f"{API}/rrv-builds/{bid}/material-consumption", headers=h).json()
    by_code = {r["item_code"]: r for r in consumption["rows"]}
    assert by_code["RM-STL-01"]["consumed_qty"] == 120 and by_code["SA-BOG-01"]["consumed_qty"] == 2
    assert consumption["total_consumed_value"] == 120 * 80 + 2 * 50000

    # No machine linked: integration stages can only be N/A.
    r = client.post(f"{API}/rrv-builds/{bid}/stages/electrical_integration/complete", json={}, headers=h)
    assert r.status_code == 409 and "Link the machine" in r.json()["detail"]
    for key in ("electrical_integration", "hydraulic_integration"):
        assert client.post(f"{API}/rrv-builds/{bid}/stages/{key}/not-applicable", json={"reason": "Mechanical-only demo unit"}, headers=h).status_code == 200
    assert client.post(f"{API}/rrv-builds/{bid}/stages/testing/not-applicable", json={"reason": "not needed"}, headers=h).status_code == 400

    r = client.post(f"{API}/rrv-builds/{bid}/stages/final_assembly/complete", json={}, headers=h)
    assert r.status_code == 409 and main["wo_number"] in r.json()["detail"]
    op = main["operations"][0]
    client.post(f"{API}/time-logs", json={"work_order_id": main["id"], "operation_id": op["id"], "log_date": str(TODAY), "hours": 8, "qty_good": 1}, headers=h)
    client.post(f"{API}/work-orders/{main['id']}/operations/{op['id']}/complete", json={}, headers=h)
    client.post(f"{API}/work-orders/{main['id']}/receive-output", json={"quantity": 1, "batch_number": "PR-RRV-2026-014"}, headers=h)
    client.post(f"{API}/work-orders/{main['id']}/complete", headers=h)
    complete(client, h, bid, "final_assembly")

    # Final inspection: fails → rework raised automatically.
    d = client.post(f"{API}/rrv-builds/{bid}/request-final-inspection", headers=h).json()
    insp = db.get(QualityInspection, d["final_inspection_id"])
    assert insp.inspection_type == "final" and insp.batch_number == b["build_number"]
    insp.status, insp.remarks = "failed", "Paint run on boom"
    notify_inspection_result(db, insp, None)
    db.commit()
    d = client.get(f"{API}/rrv-builds/{bid}", headers=h).json()
    rw = next(r for r in d["rework_orders"] if r["source"] == "final_inspection")
    assert rw["status"] == "open" and "Paint run" in rw["defect_description"]

    # Rework: done by fitter, verify needs a fresh passed inspection + someone else.
    client.post(f"{API}/rrv-builds/rework/{rw['id']}/start", headers=plant["hf"])
    client.post(f"{API}/rrv-builds/rework/{rw['id']}/done", json={"corrective_action": "Sanded and repainted"}, headers=plant["hf"])
    r = client.post(f"{API}/rrv-builds/rework/{rw['id']}/verify", json={}, headers=plant["hf"])
    assert r.status_code == 403 and "someone else" in r.json()["detail"]
    r = client.post(f"{API}/rrv-builds/rework/{rw['id']}/verify", json={}, headers=h)
    assert r.status_code == 409 and "fresh inspection" in r.json()["detail"]
    d = client.post(f"{API}/rrv-builds/{bid}/request-final-inspection", headers=h).json()
    insp2 = db.get(QualityInspection, d["final_inspection_id"])
    assert insp2.id != insp.id
    insp2.status = "passed"
    db.commit()
    assert client.post(f"{API}/rrv-builds/rework/{rw['id']}/verify", json={"remarks": "OK"}, headers=h).status_code == 200
    complete(client, h, bid, "final_inspection")

    # Vehicle tests: a failure raises rework that needs a passing retest.
    fails = client.post(f"{API}/rrv-builds/{bid}/tests", json={
        "test_type": "brake_test_rail", "test_date": str(TODAY), "result": "fail", "observed": "Stopping distance 38 m > 30 m",
        "rework_assignee_id": plant["fitter"].id,
    }, headers=h).json()
    brake_rw = next(r for r in fails["rework_orders"] if r["source"] == "test")
    assert brake_rw["assigned_to_name"] == "fitter"
    client.post(f"{API}/rrv-builds/rework/{brake_rw['id']}/done", json={"corrective_action": "Bled brake circuit, new pads"}, headers=plant["hf"])
    r = client.post(f"{API}/rrv-builds/rework/{brake_rw['id']}/verify", json={}, headers=h)
    assert r.status_code == 409 and "passing retest" in r.json()["detail"]
    for t in b["required_tests"]:
        client.post(f"{API}/rrv-builds/{bid}/tests", json={"test_type": t, "test_date": str(TODAY), "result": "pass", "witnessed_by": "RDSO inspector"}, headers=h)
    assert client.post(f"{API}/rrv-builds/rework/{brake_rw['id']}/verify", json={}, headers=h).status_code == 200
    d = complete(client, h, bid, "testing")
    assert all(v == "pass" for v in d["test_status"].values())
    complete(client, h, bid, "rework_closure")

    # Sign-off stages: planner can't; manager can.
    r = client.post(f"{API}/rrv-builds/{bid}/stages/rrv_completion/complete", json={}, headers=h)
    assert r.status_code == 403 and "sign-off" in r.json()["detail"]
    d = complete(client, hm, bid, "rrv_completion")
    assert d["status"] == "completed" and d["erp_project_id"]
    machine = db.get(Project, d["erp_project_id"])
    assert machine.serial_number == "PR-RRV-2026-014" and machine.chassis_number == "CHS-9981"
    assert machine.status == "manufacturing_under_progress" and machine.client_company == "Northern Railway"
    locked = client.patch(f"{API}/rrv-builds/{bid}", json={"chassis_number": "X"}, headers=h)
    assert locked.status_code == 409 and "handover details" in locked.json()["detail"]

    r = client.post(f"{API}/rrv-builds/{bid}/stages/handover/complete", json={}, headers=hm)
    assert r.status_code == 409 and "handover date" in r.json()["detail"]
    client.patch(f"{API}/rrv-builds/{bid}", json={
        "handover_date": str(TODAY), "handed_over_to_name": "Sr. DEN (Works)", "handed_over_to_organization": "Northern Railway",
        "handover_location": "Ghaziabad depot", "warranty_months": 18,
    }, headers=h)
    d = complete(client, hm, bid, "handover")
    assert d["status"] == "handed_over" and d["stages_done"] == 12
    db.expire_all()
    machine = db.get(Project, d["erp_project_id"])
    assert machine.status == "active" and machine.handover_date == TODAY and machine.delivery_date == TODAY
    assert machine.warranty_start_date == TODAY and machine.warranty_end_date > TODAY + timedelta(days=500)

    pdf = client.get(f"{API}/rrv-builds/{bid}/handover-certificate", headers=h)
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    assert client.patch(f"{API}/rrv-builds/{bid}", json={"remarks": "x"}, headers=h).status_code == 409


def test_integration_gates_read_electrical_and_hydraulic(client, db, plant):
    machine = Project(serial_number="PR-RRV-2026-020", machine_type="RRV")
    db.add(machine)
    db.commit()
    b = new_build(client, plant, erp_project_id=machine.id)
    bid = b["id"]
    # Sub/main assembly N/A-able path: mark sub-assembly N/A so gates focus on integration.
    job = ElectricalJob(job_number="ELJ-TEST-1", title="RRV electrics", erp_project_id=machine.id, status="in_progress")
    system = HydSystem(system_number="HYD-TEST-1", name="Boom power pack", erp_project_id=machine.id, status="testing")
    db.add_all([job, system])
    db.commit()
    d = client.get(f"{API}/rrv-builds/{bid}", headers=plant["h"]).json()
    assert "ELJ-TEST-1 is in progress" in " ".join(stage(d, "electrical_integration")["gate_problems"])
    assert "no completed test" in " ".join(stage(d, "hydraulic_integration")["gate_problems"])
    assert d["integration"]["electrical_jobs"][0]["job_number"] == "ELJ-TEST-1"

    job.status = "handed_over"
    db.add(HydTest(test_number="HT-1", title="Proof test", test_type="pressure_test", system_id=system.id, status="completed", result="pass"))
    db.commit()
    assert complete(client, plant["h"], bid, "electrical_integration")["status"] == "in_progress"
    complete(client, plant["h"], bid, "hydraulic_integration")

    # One machine = one build.
    r = client.post(f"{API}/rrv-builds", json={"rrv_model": "Dup", "erp_project_id": machine.id}, headers=plant["h"])
    assert r.status_code == 409 and b["build_number"] in r.json()["detail"]


def test_operation_inspection_failure_on_build_wo_raises_rework(client, db, plant):
    h = plant["h"]
    b = new_build(client, plant)
    bom = client.post(f"{API}/boms", json={
        "product_item_id": plant["vehicle"].id, "items": [{"component_item_id": plant["bogie"].id, "quantity": 1}],
        "operations": [{"sequence": 10, "operation_name": "Weld frame", "workstation_id": plant["vehicle_bom"]["operations"][0]["workstation_id"], "requires_inspection": True}],
    }, headers=h).json()
    client.post(f"{API}/boms/{bom['id']}/activate", headers=h)
    wo = raise_wo(client, plant, b, bom, "main")
    wo = client.post(f"{API}/work-orders/{wo['id']}/release", headers=h).json()
    wo = client.post(f"{API}/work-orders/{wo['id']}/operations/{wo['operations'][0]['id']}/request-inspection", headers=h).json()
    insp = db.get(QualityInspection, wo["operations"][0]["quality_inspection_id"])
    insp.status = "failed"
    notify_inspection_result(db, insp, None)
    notify_inspection_result(db, insp, None)  # idempotent — one rework per inspection
    db.commit()
    reworks = client.get(f"{API}/rrv-builds/rework", headers=h).json()
    assert len(reworks) == 1 and reworks[0]["source"] == "operation_inspection" and reworks[0]["wo_number"] == wo["wo_number"]


def test_hold_cancel_delete_and_permissions(client, db, plant):
    h, hm = plant["h"], plant["hm"]
    b = new_build(client, plant)
    d = client.post(f"{API}/rrv-builds/{b['id']}/hold", json={"reason": "Customer changed spec"}, headers=h).json()
    assert d["status"] == "on_hold"
    r = client.post(f"{API}/rrv-builds/{b['id']}/stages/planning/start", headers=h)
    assert r.status_code == 409 and "on hold" in r.json()["detail"]
    assert client.post(f"{API}/rrv-builds/{b['id']}/resume", headers=h).json()["status"] == "planned"

    r = client.post(f"{API}/rrv-builds/{b['id']}/cancel", json={"reason": "Order lost"}, headers=h)
    assert r.status_code == 403
    assert client.post(f"{API}/rrv-builds/{b['id']}/cancel", json={"reason": "Order lost"}, headers=hm).json()["status"] == "cancelled"

    fresh = new_build(client, plant, rrv_model="Throwaway")
    assert client.delete(f"{API}/rrv-builds/{fresh['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/rrv-builds/{fresh['id']}", headers=h).status_code == 404

    outsider = make_user(db, "crm@premnathrail.com", apps=("crm",))
    assert client.get(f"{API}/rrv-builds", headers=auth(outsider)).status_code == 403


def test_validation_messages(client, plant):
    h = plant["h"]
    r = client.post(f"{API}/rrv-builds", json={"rrv_model": "X1", "required_tests": ["moon_walk"]}, headers=h)
    assert r.status_code == 400 and "moon_walk" in r.json()["detail"]
    r = client.post(f"{API}/rrv-builds", json={"rrv_model": "X1", "target_completion_date": str(TODAY + timedelta(days=10)), "target_handover_date": str(TODAY)}, headers=h)
    assert r.status_code == 400 and "before the target completion" in r.json()["detail"]
    b = new_build(client, plant)
    r = client.post(f"{API}/rrv-builds/{b['id']}/tests", json={"test_type": "road_trial", "test_date": str(TODAY), "result": "fail"}, headers=h)
    assert r.status_code == 400 and "observed" in r.json()["detail"]
    r = client.post(f"{API}/rrv-builds/{b['id']}/tests", json={"test_type": "road_trial", "test_date": str(TODAY + timedelta(days=2)), "result": "pass"}, headers=h)
    assert r.status_code == 400 and "future" in r.json()["detail"]
