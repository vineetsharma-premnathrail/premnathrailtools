"""Coverage tests for the Hydraulic & Pneumatic module's records — system
numbering (HYS- / PNS-), component master codes, circuit revision approval
with the four-eyes rule, BOM release / revise / CSV export, test reading
auto-judgement and re-tests, maintenance plan due logic, and the retired
(plan rule R5) maintenance / service / spares write paths."""
import csv
import io
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.models.document import HydDocument
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.system import HydSystem
from app.modules.hydraulic.service import compute_next_due_date, plan_due_state
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/hydraulic"
YEAR = date.today().year
TODAY = date.today()


def make_user(db, email, apps=("hydraulic",), role="user", grants=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(apps), granular_permissions=list(grants or []),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def attach_diagram(db, circuit_id):
    db.add(HydDocument(entity_type="circuit", entity_id=circuit_id, doc_type="circuit_diagram", title="Diagram", file_name="d.pdf"))
    db.commit()


@pytest.fixture
def eng(db):
    return make_user(db, "cov.hyd.eng@premnathrail.com")


@pytest.fixture
def h(eng):
    return auth(eng)


def new_system(client, h, **kw):
    body = {"name": "Power pack", "system_type": "hydraulic", "status": "in_service", **kw}
    r = client.post(f"{API}/systems", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def new_component(client, h, **kw):
    body = {"name": "Gear pump", "category": "pump", "unit_cost": 1000, **kw}
    r = client.post(f"{API}/components", json=body, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Systems & component master
# ---------------------------------------------------------------------------

def test_system_numbers_run_separately_per_medium(client, h):
    assert new_system(client, h)["system_number"] == f"HYS-{YEAR}-0001"
    assert new_system(client, h, name="Brake air", system_type="pneumatic")["system_number"] == f"PNS-{YEAR}-0001"
    assert new_system(client, h, name="Second pack")["system_number"] == f"HYS-{YEAR}-0002"
    assert new_system(client, h, name="Horn air", system_type="pneumatic")["system_number"] == f"PNS-{YEAR}-0002"
    r = client.post(f"{API}/systems", json={"name": "x", "system_type": "steam"}, headers=h)
    assert r.status_code == 400 and "Invalid system type" in r.json()["detail"]
    r = client.post(f"{API}/systems", json={"name": "x", "operating_temp_min_c": 80, "operating_temp_max_c": 20}, headers=h)
    assert r.status_code == 400 and "temperature" in r.json()["detail"]


def test_system_update_checks_merged_pressures(client, h):
    s = new_system(client, h, working_pressure_bar=150, max_pressure_bar=200)
    # Only one side sent — validated against the stored other side.
    r = client.patch(f"{API}/systems/{s['id']}", json={"working_pressure_bar": 250}, headers=h)
    assert r.status_code == 400 and "can't be higher" in r.json()["detail"]
    ok = client.patch(f"{API}/systems/{s['id']}", json={"working_pressure_bar": 180}, headers=h)
    assert ok.status_code == 200 and ok.json()["working_pressure_bar"] == 180


def test_component_codes_per_category_prefix(client, h):
    assert new_component(client, h)["code"] == "PMP-0001"
    assert new_component(client, h, name="Piston pump")["code"] == "PMP-0002"
    cyl = new_component(client, h, name="Lift cylinder", category="cylinder", bore_mm=80, rod_mm=45)
    assert cyl["code"] == "CYL-0001"
    assert new_component(client, h, name="FRL", category="frl_unit", system_type="pneumatic")["code"] == "FRL-0001"

    r = client.post(f"{API}/components", json={"name": "x", "category": "teleporter"}, headers=h)
    assert r.status_code == 400 and "Invalid category" in r.json()["detail"]
    r = client.post(f"{API}/components", json={"name": "x", "category": "cylinder", "bore_mm": 50, "rod_mm": 50}, headers=h)
    assert r.status_code == 400 and "smaller than the bore" in r.json()["detail"]
    r = client.post(f"{API}/components", json={"name": "x", "category": "pump", "rated_pressure_bar": 250, "max_pressure_bar": 210}, headers=h)
    assert r.status_code == 400 and "can't exceed" in r.json()["detail"]
    # PATCH re-checks rod vs. the stored bore.
    r = client.patch(f"{API}/components/{cyl['id']}", json={"rod_mm": 90}, headers=h)
    assert r.status_code == 400
    # Category is fixed after creation (its prefix is in the code) — ignored on update.
    r = client.patch(f"{API}/components/{cyl['id']}", json={"category": "pump", "name": "Lift cyl"}, headers=h).json()
    assert r["category"] == "cylinder" and r["code"] == "CYL-0001" and r["name"] == "Lift cyl"
    # Listing filters on medium include "both".
    listed = client.get(f"{API}/components", params={"system_type": "pneumatic"}, headers=h).json()
    assert [c["code"] for c in listed] == ["FRL-0001"]


# ---------------------------------------------------------------------------
# Circuits — four-eyes approval
# ---------------------------------------------------------------------------

def test_circuit_four_eyes_is_about_the_submitter(client, db, h, eng):
    colleague = make_user(db, "cov.hyd.colleague@premnathrail.com")
    hc = auth(colleague)
    system = new_system(client, h, system_type="pneumatic", name="Brake air")
    # system_type comes from the linked system, not the payload.
    c = client.post(f"{API}/circuits", json={"title": "Brake circuit", "system_id": system["id"], "system_type": "hydraulic"}, headers=h).json()
    assert c["system_type"] == "pneumatic" and c["circuit_number"] == f"CKT-{YEAR}-0001" and c["revision"] == "A"
    attach_diagram(db, c["id"])

    # Draft can't be approved directly.
    r = client.post(f"{API}/circuits/{c['id']}/approve", json={}, headers=hc)
    assert r.status_code == 409 and "under review" in r.json()["detail"]

    # The colleague submits the engineer's circuit; the engineer (author, not submitter) may approve it.
    sub = client.post(f"{API}/circuits/{c['id']}/submit", headers=hc).json()
    assert sub["status"] == "under_review" and sub["submitted_by_name"] == "cov.hyd.colleague"
    r = client.post(f"{API}/circuits/{c['id']}/approve", json={}, headers=hc)
    assert r.status_code == 403 and "four-eyes" in r.json()["detail"]
    ok = client.post(f"{API}/circuits/{c['id']}/approve", json={"remarks": "Checked"}, headers=h).json()
    assert ok["status"] == "approved" and ok["approved_by_name"] == "cov.hyd.eng" and ok["review_remarks"] == "Checked"
    # Approved circuits are frozen.
    assert client.delete(f"{API}/circuits/{c['id']}", headers=h).status_code == 409
    assert client.post(f"{API}/circuits/{c['id']}/submit", headers=h).status_code == 409


def test_circuit_return_and_resubmit(client, db, h):
    reviewer = make_user(db, "cov.hyd.reviewer@premnathrail.com")
    hr = auth(reviewer)
    c = client.post(f"{API}/circuits", json={"title": "Main"}, headers=h).json()
    attach_diagram(db, c["id"])
    client.post(f"{API}/circuits/{c['id']}/submit", headers=h)
    # Can't edit while under review.
    assert client.patch(f"{API}/circuits/{c['id']}", json={"title": "x"}, headers=h).status_code == 409
    r = client.post(f"{API}/circuits/{c['id']}/return", json={"remarks": "  Relief valve setting missing  "}, headers=hr).json()
    assert r["status"] == "draft" and r["review_remarks"] == "Relief valve setting missing"
    assert client.patch(f"{API}/circuits/{c['id']}", json={"title": "Main (fixed)"}, headers=h).json()["title"] == "Main (fixed)"
    again = client.post(f"{API}/circuits/{c['id']}/submit", headers=h).json()
    assert again["status"] == "under_review" and again["review_remarks"] is None
    assert client.post(f"{API}/circuits/{c['id']}/approve", json={}, headers=hr).json()["status"] == "approved"


def test_admin_submitter_may_approve_and_matrix_gates_approve(client, db, h):
    admin = make_user(db, "cov.hyd.admin@premnathrail.com", role="admin")
    ha = auth(admin)
    c = client.post(f"{API}/circuits", json={"title": "Admin"}, headers=ha).json()
    attach_diagram(db, c["id"])
    client.post(f"{API}/circuits/{c['id']}/submit", headers=ha)
    # Four-eyes binds admins too (central approval engine, 2026-10-08).
    own = client.post(f"{API}/circuits/{c['id']}/approve", json={"comment": "self"}, headers=ha)
    assert own.status_code == 403 and "four-eyes" in own.json()["detail"]

    editor = make_user(db, "cov.hyd.editor@premnathrail.com", grants=["hydraulic:circuits:view", "hydraulic:circuits:create", "hydraulic:circuits:edit"])
    c2 = client.post(f"{API}/circuits", json={"title": "Other"}, headers=h).json()
    attach_diagram(db, c2["id"])
    client.post(f"{API}/circuits/{c2['id']}/submit", headers=h)
    r = client.post(f"{API}/circuits/{c2['id']}/approve", json={}, headers=auth(editor))
    assert r.status_code == 403 and "'approve' permission" in r.json()["detail"]


def test_circuit_revision_letters_skip_deleted_drafts(client, db, h):
    reviewer = make_user(db, "cov.hyd.rev2@premnathrail.com")
    hr = auth(reviewer)
    c = client.post(f"{API}/circuits", json={"title": "Pack"}, headers=h).json()
    attach_diagram(db, c["id"])
    client.post(f"{API}/circuits/{c['id']}/submit", headers=h)
    client.post(f"{API}/circuits/{c['id']}/approve", json={}, headers=hr)
    b = client.post(f"{API}/circuits/{c['id']}/revise", json={"change_note": "Add cooler"}, headers=h).json()
    assert b["revision"] == "B"
    assert client.delete(f"{API}/circuits/{b['id']}", headers=h).status_code == 200
    # Rev B was deleted, but its letter stays used — the next one is C.
    cc = client.post(f"{API}/circuits/{c['id']}/revise", json={"change_note": "Add cooler v2"}, headers=h).json()
    assert cc["revision"] == "C"
    assert [r["revision"] for r in cc["revisions"]] == ["A", "C"]
    # Rev A stays approved (in force) until C is approved.
    assert client.get(f"{API}/circuits/{c['id']}", headers=h).json()["status"] == "approved"
    listed = client.get(f"{API}/circuits", headers=h).json()
    assert {(x["revision"], x["status"]) for x in listed} == {("A", "approved"), ("C", "draft")}


# ---------------------------------------------------------------------------
# BOM
# ---------------------------------------------------------------------------

def test_bom_release_revise_and_guards(client, db, h):
    approver = make_user(db, "cov.hyd.bomapp@premnathrail.com")
    pump = new_component(client, h)
    empty = client.post(f"{API}/boms", json={"title": "Empty"}, headers=h).json()
    assert empty["bom_number"] == f"HBOM-{YEAR}-0001"
    r = client.post(f"{API}/boms/{empty['id']}/release", headers=h)
    assert r.status_code == 400 and "at least one component" in r.json()["detail"]
    r = client.post(f"{API}/boms/{empty['id']}/revise", headers=h)
    assert r.status_code == 409 and "only a released BOM" in r.json()["detail"]

    missing = client.post(f"{API}/boms", json={"title": "x", "items": [{"component_id": 9999, "quantity": 1}]}, headers=h)
    assert missing.status_code == 404 and "#9999" in missing.json()["detail"]

    bom = client.post(f"{API}/boms", json={"title": "Pack", "items": [{"component_id": pump["id"], "tag_number": " p1 ", "quantity": 2, "uom": "nos"}]}, headers=h).json()
    assert bom["items"][0]["tag_number"] == "P1" and bom["items"][0]["uom"] == "NOS"

    # Release needs the BOM 'approve' grant once the matrix is configured.
    limited = make_user(db, "cov.hyd.bomed@premnathrail.com", grants=["hydraulic:bom:view", "hydraulic:bom:edit"])
    r = client.post(f"{API}/boms/{bom['id']}/release", headers=auth(limited))
    assert r.status_code == 403
    rel = client.post(f"{API}/boms/{bom['id']}/release", headers=auth(approver)).json()
    assert rel["status"] == "released" and rel["released_by_name"] == "cov.hyd.bomapp"
    assert client.patch(f"{API}/boms/{bom['id']}", json={"title": "x"}, headers=h).status_code == 409
    assert client.delete(f"{API}/boms/{bom['id']}", headers=h).status_code == 409

    rev_b = client.post(f"{API}/boms/{bom['id']}/revise", headers=h).json()
    assert rev_b["revision"] == "B" and rev_b["bom_number"] == bom["bom_number"]
    again = client.post(f"{API}/boms/{bom['id']}/revise", headers=h)
    assert again.status_code == 409 and "already an open draft" in again.json()["detail"]
    # Editing the draft replaces its items; the released Rev A is untouched.
    upd = client.patch(f"{API}/boms/{rev_b['id']}", json={"items": [{"component_id": pump["id"], "tag_number": "P1", "quantity": 3, "uom": "NOS"}]}, headers=h).json()
    assert upd["items"][0]["quantity"] == 3
    assert client.get(f"{API}/boms/{bom['id']}", headers=h).json()["items"][0]["quantity"] == 2


def test_bom_update_items_default_uom(client, h):
    pump = new_component(client, h)
    bom = client.post(f"{API}/boms", json={"title": "Pack", "items": [{"component_id": pump["id"], "quantity": 1}]}, headers=h).json()
    assert bom["items"][0]["uom"] == "NOS"
    r = client.patch(f"{API}/boms/{bom['id']}", json={"items": [{"component_id": pump["id"], "quantity": 2}]}, headers=h)
    assert r.status_code == 200 and r.json()["items"][0]["uom"] == "NOS"


def test_bom_circuit_must_match_system(client, h):
    s1, s2 = new_system(client, h, name="One"), new_system(client, h, name="Two")
    ckt = client.post(f"{API}/circuits", json={"title": "C", "system_id": s1["id"]}, headers=h).json()
    r = client.post(f"{API}/boms", json={"title": "x", "system_id": s2["id"], "circuit_id": ckt["id"]}, headers=h)
    assert r.status_code == 400 and "different system" in r.json()["detail"]
    ok = client.post(f"{API}/boms", json={"title": "x", "system_id": s1["id"], "circuit_id": ckt["id"]}, headers=h).json()
    assert ok["circuit_number"] == ckt["circuit_number"] and ok["circuit_revision"] == "A"


def test_bom_csv_export_layout_and_totals(client, h):
    system = new_system(client, h)
    pump = new_component(client, h, name="Gear pump 28cc", manufacturer="Rexroth", model_number="AZPF-28", unit_cost=25000)
    valve = new_component(client, h, name="4/3 DCV", category="directional_valve", unit_cost=7999.5)
    bom = client.post(f"{API}/boms", json={"title": "Pack, main", "system_id": system["id"], "items": [
        {"component_id": pump["id"], "tag_number": "P1", "quantity": 1},
        {"component_id": valve["id"], "tag_number": "V1", "quantity": 2, "remarks": "with coils"},
    ]}, headers=h).json()
    r = client.get(f"{API}/boms/{bom['id']}/export", headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert f'filename="{bom["bom_number"]}-RevA.csv"' in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    # Title row (comma in title is quoted, so it stays one cell).
    assert rows[0] == [f"{bom['bom_number']} Rev A", "Pack, main", system["system_number"], "draft"]
    assert rows[1][:3] == ["#", "Tag", "Code"]
    assert rows[2] == ["1", "P1", "PMP-0001", "Gear pump 28cc", "pump", "Rexroth", "AZPF-28", "1.0", "NOS", "25000.0", "25000.0", ""]
    # 2 × 7999.5 = 15 999.0
    assert rows[3][1:3] == ["V1", "DCV-0001"] and rows[3][10] == "15999.0" and rows[3][11] == "with coils"
    # Total = 25 000 + 15 999 = 40 999
    assert rows[4][9:11] == ["Total", "40999.0"]


# ---------------------------------------------------------------------------
# Tests — auto-judgement and re-tests
# ---------------------------------------------------------------------------

def test_reading_auto_judgement(client, h):
    system = new_system(client, h)
    t = client.post(f"{API}/tests", json={"title": "Pressure test", "test_type": "pressure_test", "system_id": system["id"], "readings": [
        {"parameter": "Relief crack", "min_value": 200, "max_value": 210, "measured_value": 205},   # inside → pass
        {"parameter": "Relief low", "min_value": 200, "max_value": 210, "measured_value": 199.9},   # below min → fail
        {"parameter": "Min only", "min_value": 50, "measured_value": 50},                          # on the limit → pass
        {"parameter": "Max only", "max_value": 2, "measured_value": 2.01},                         # above max → fail
        {"parameter": "Limits, no value", "max_value": 5, "result": "pass"},                       # tester's mark kept
        {"parameter": "Visual", "measured_text": "No leaks", "result": "pass"},                    # no limits → tester's mark
        {"parameter": "Untested"},                                                                 # → na
        {"parameter": "Tester says pass", "max_value": 1, "measured_value": 3, "result": "pass"},  # numbers override the mark
    ]}, headers=h)
    assert t.status_code == 200, t.text
    t = t.json()
    assert t["test_number"] == f"HTST-{YEAR}-0001" and t["status"] == "planned" and t["result"] == "pending"
    assert [r["result"] for r in t["readings"]] == ["pass", "fail", "pass", "fail", "pass", "pass", "na", "fail"]
    assert t["failed_readings"] == 3


def test_reading_and_subject_validation(client, h):
    system = new_system(client, h)
    r = client.post(f"{API}/tests", json={"title": "x", "test_type": "leak_test", "readings": []}, headers=h)
    assert r.status_code == 400 and "Pick the system or the component" in r.json()["detail"]
    r = client.post(f"{API}/tests", json={"title": "x", "test_type": "leak_test", "system_id": system["id"], "readings": [{"parameter": "p", "min_value": 5, "max_value": 1}]}, headers=h)
    assert r.status_code == 400 and "minimum limit (5) is above the maximum (1)" in r.json()["detail"]
    r = client.post(f"{API}/tests", json={"title": "x", "test_type": "leak_test", "system_id": system["id"], "readings": [{"parameter": "p", "result": "ok"}]}, headers=h)
    assert r.status_code == 400 and "Invalid result on reading 'p'" in r.json()["detail"]
    r = client.post(f"{API}/tests", json={"title": "x", "test_type": "vibe_check", "system_id": system["id"]}, headers=h)
    assert r.status_code == 400
    # A pneumatic component test picks up the component's medium.
    frl = new_component(client, h, name="FRL", category="frl_unit", system_type="pneumatic")
    t = client.post(f"{API}/tests", json={"title": "FRL leak", "test_type": "leak_test", "component_id": frl["id"]}, headers=h).json()
    assert t["system_type"] == "pneumatic" and t["component_code"] == "FRL-0001"


def test_completion_rules_and_retest_chain(client, db, h):
    system = new_system(client, h)
    t = client.post(f"{API}/tests", json={"title": "Proof", "test_type": "proof_test", "system_id": system["id"]}, headers=h).json()
    r = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pass"}, headers=h)
    assert r.status_code == 400 and "at least one reading" in r.json()["detail"]
    r = client.post(f"{API}/tests/{t['id']}/retest", headers=h)
    assert r.status_code == 409 and "isn't completed" in r.json()["detail"]

    # Entering measured values moves a planned test to in_progress.
    upd = client.patch(f"{API}/tests/{t['id']}", json={"readings": [{"parameter": "Drop", "unit": "bar", "max_value": 2, "measured_value": 4}]}, headers=h).json()
    assert upd["status"] == "in_progress" and upd["readings"][0]["result"] == "fail"
    assert client.post(f"{API}/tests/{t['id']}/start", headers=h).status_code == 409

    r = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pending"}, headers=h)
    assert r.status_code == 400
    r = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "conditional"}, headers=h)
    assert r.status_code == 400 and "conditional pass needs remarks" in r.json()["detail"]
    # Completing needs the testing 'approve' grant once the matrix is configured.
    tester = make_user(db, "cov.hyd.tester@premnathrail.com", grants=["hydraulic:testing:view", "hydraulic:testing:edit", "hydraulic:testing:create"])
    assert client.post(f"{API}/tests/{t['id']}/complete", json={"result": "fail"}, headers=auth(tester)).status_code == 403
    done = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "conditional", "remarks": "Concession QA-12"}, headers=h).json()
    assert done["status"] == "completed" and done["result"] == "conditional" and done["test_date"] == TODAY.isoformat()
    assert client.post(f"{API}/tests/{t['id']}/complete", json={"result": "fail"}, headers=h).status_code == 409
    assert client.delete(f"{API}/tests/{t['id']}", headers=h).status_code == 409

    re1 = client.post(f"{API}/tests/{t['id']}/retest", headers=h).json()
    assert re1["title"] == f"Re-test of {t['test_number']}: Proof"
    assert re1["readings"][0]["max_value"] == 2 and re1["readings"][0]["measured_value"] is None and re1["readings"][0]["result"] == "na"
    client.patch(f"{API}/tests/{re1['id']}", json={"readings": [{"parameter": "Drop", "unit": "bar", "max_value": 2, "measured_value": 1.5}]}, headers=h)
    assert client.post(f"{API}/tests/{re1['id']}/complete", json={"result": "pass"}, headers=h).json()["result"] == "pass"
    # Re-test of a re-test points at the latest test number, without nesting titles.
    re2 = client.post(f"{API}/tests/{re1['id']}/retest", headers=h).json()
    assert re2["title"] == f"Re-test of {re1['test_number']}: Proof"


def test_retest_cannot_pass_without_any_measurement(client, h):
    system = new_system(client, h)
    t = client.post(f"{API}/tests", json={"title": "Leak", "test_type": "leak_test", "system_id": system["id"], "readings": [
        {"parameter": "Drop", "max_value": 2, "measured_value": 5},
    ]}, headers=h).json()
    client.post(f"{API}/tests/{t['id']}/complete", json={"result": "fail"}, headers=h)
    retest = client.post(f"{API}/tests/{t['id']}/retest", headers=h).json()
    r = client.post(f"{API}/tests/{retest['id']}/complete", json={"result": "pass"}, headers=h)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Maintenance plans (retired, plan rule R5 — read-only history)
# ---------------------------------------------------------------------------

def _seed_plan(db, sid, n, **kw):
    plan = HydMaintenancePlan(plan_number=f"HMP-{YEAR}-{n:04d}", title=f"Task {n}", system_id=sid, **kw)
    plan.next_due_date = compute_next_due_date(plan)
    db.add(plan)
    db.commit()
    return plan


def test_plan_calendar_due_states(client, db, h):
    sid = new_system(client, h)["id"]
    # Never done: first due on the start date.
    p = _seed_plan(db, sid, 1, frequency_days=90, start_date=TODAY + timedelta(days=30))
    got = client.get(f"{API}/maintenance-plans/{p.id}", headers=h).json()
    assert got["next_due_date"] == (TODAY + timedelta(days=30)).isoformat() and got["due_status"] == "ok" and got["days_to_due"] == 30
    # Never done, no start date → due today → due_soon (0 ≤ 7 days).
    _seed_plan(db, sid, 2, frequency_days=30)
    # last done 25 days ago + 30 → due in 5 days → due_soon.
    p3 = _seed_plan(db, sid, 3, frequency_days=30, last_done_date=TODAY - timedelta(days=25))
    got3 = client.get(f"{API}/maintenance-plans/{p3.id}", headers=h).json()
    assert got3["days_to_due"] == 5 and got3["due_status"] == "due_soon"
    # Inactive plans aren't judged.
    _seed_plan(db, sid, 4, frequency_days=30, is_active=False)
    # List is sorted most urgent first and hides inactive plans by default.
    listed = client.get(f"{API}/maintenance-plans", headers=h).json()
    assert [x["due_status"] for x in listed] == ["due_soon", "due_soon", "ok"]
    assert len(client.get(f"{API}/maintenance-plans", params={"include_inactive": True}, headers=h).json()) == 4


def test_plan_running_hours_due_states(db):
    def state(last, **kw):
        plan = HydMaintenancePlan(title="Oil", system_id=1, frequency_hours=200, last_done_hours=last, is_active=True, **kw)
        plan.next_due_date = compute_next_due_date(plan)
        return plan_due_state(plan, 1000)

    # Next due = last + 200 h. "Due soon" inside 10 % of the interval (20 h).
    assert state(900) == {"due_status": "ok", "days_to_due": None, "next_due_hours": 1100}
    assert state(820)["due_status"] == "due_soon"      # 1020 − 1000 = 20 h left
    assert state(800)["due_status"] == "overdue"       # exactly at 1000 h
    # Calendar and hours both set: the worse of the two wins.
    assert state(900, frequency_days=30, last_done_date=TODAY - timedelta(days=40))["due_status"] == "overdue"


# ---------------------------------------------------------------------------
# Service records & spares (retired, plan rule R5)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("post", "/maintenance-plans"), ("patch", "/maintenance-plans/1"),
    ("post", "/service-records"), ("patch", "/service-records/1"),
    ("post", "/service-records/1/start"), ("post", "/service-records/1/complete"),
    ("post", "/spare-parts"), ("patch", "/spare-parts/1"),
    ("delete", "/maintenance-plans/1"), ("delete", "/spare-parts/1"),
])
def test_retired_writes_answer_410(client, h, method, path):
    r = client.delete(f"{API}{path}", headers=h) if method == "delete" else getattr(client, method)(f"{API}{path}", json={}, headers=h)
    assert r.status_code == 410 and "plan rule R5" in r.json()["detail"]
    assert "Maintenance module" in r.json()["detail"] and "Service & Commissioning" in r.json()["detail"]


@pytest.mark.parametrize("field,value", [("running_hours", 1000), ("commissioned_on", "2026-01-01"), ("location", "Bay 3")])
def test_retired_system_fields_rejected_422(client, h, field, value):
    r = client.post(f"{API}/systems", json={"name": "Power pack", field: value}, headers=h)
    assert r.status_code == 422 and "rule R5" in r.json()["detail"], r.text
    sid = new_system(client, h)["id"]
    r = client.patch(f"{API}/systems/{sid}", json={field: value}, headers=h)
    assert r.status_code == 422 and "Maintenance" in r.json()["detail"], r.text
    # An empty value (old clients send null) is accepted and ignored.
    assert client.patch(f"{API}/systems/{sid}", json={field: None}, headers=h).status_code == 200


def test_service_completion_no_longer_touches_store(client, db, h):
    loc = StoreLocation(name="Hyd Store", code="HYD1")
    seal = StoreItem(item_code="SP-SEAL-63", item_name="Seal kit 63", item_type="spare_part", uom="SET", standard_cost=800, status="active")
    db.add_all([loc, seal])
    db.commit()
    post_stock_transaction(db, item_id=seal.id, location_id=loc.id, transaction_type="receipt", quantity=5, reference_type="manual")
    db.commit()
    sid = new_system(client, h)["id"]
    rec = HydServiceRecord(record_number=f"HSR-{YEAR}-0001", system_id=sid, service_type="corrective", status="open", service_date=TODAY)
    db.add(rec)
    db.commit()
    r = client.post(f"{API}/service-records/{rec.id}/complete", json={"work_done": "x", "issue_from_location_id": loc.id}, headers=h)
    assert r.status_code == 410
    assert db.query(StoreStockTransaction).filter_by(reference_type="hyd_service").count() == 0
    db.expire_all()
    assert db.query(StoreStockBalance).filter_by(item_id=seal.id, location_id=loc.id).first().on_hand_qty == 5


def test_cancel_still_closes_out_old_breakdowns_delete_is_retired(client, db, h):
    sid = new_system(client, h)["id"]
    a = HydServiceRecord(record_number=f"HSR-{YEAR}-0001", system_id=sid, service_type="breakdown", status="open", service_date=TODAY)
    b = HydServiceRecord(record_number=f"HSR-{YEAR}-0002", system_id=sid, service_type="overhaul", status="open", service_date=TODAY)
    db.add_all([a, b])
    db.query(HydSystem).filter(HydSystem.id == sid).update({"status": "under_maintenance"})
    db.commit()
    assert client.post(f"{API}/service-records/{a.id}/cancel", json={"reason": "Duplicate"}, headers=h).json()["status"] == "cancelled"
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "under_maintenance"  # b still open
    assert client.post(f"{API}/service-records/{a.id}/cancel", json={"reason": "x"}, headers=h).status_code == 409
    # Deleting is a retired write (410); cancelling the last open downtime job releases the system.
    r = client.delete(f"{API}/service-records/{b.id}", headers=h)
    assert r.status_code == 410 and "plan rule R5" in r.json()["detail"]
    assert client.post(f"{API}/service-records/{b.id}/cancel", json={"reason": "Retired"}, headers=h).status_code == 200
    assert client.get(f"{API}/systems/{sid}", headers=h).json()["status"] == "in_service"
