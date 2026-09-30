"""End-to-end tests for the Electrical module: an RRV electrical job walked
through all 20 scope stages — requirement → BOM / cables / panels /
drawings → purchase → assembly → testing (with a retest) → Quality QC →
troubleshooting → commissioning → handover → as-built → close.

Quality's inspection-number generator takes a Postgres advisory lock that
SQLite can't run, so it's replaced with a plain counter here. SharePoint
isn't configured in tests, so drawing / document files are attached by
writing the pointer straight onto the row."""
from datetime import date
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.middleware.owasp import get_rate_store
from app.modules.electrical.models.document import ElectricalDocument
from app.modules.electrical.models.drawing import ElectricalDrawingRevision
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.quality.models.inspection import QualityInspection

API = "/api/v1/electrical"


@pytest.fixture(autouse=True)
def _sqlite_document_numbers(monkeypatch):
    seq = count(1)
    monkeypatch.setattr(
        "app.modules.electrical.routes.jobs.generate_inspection_number",
        lambda db, code: f"INSP-{code}-TEST-{next(seq):04d}",
    )


def make_user(db, email, apps=("electrical",)):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def attach_file(db, revision_id):
    rev = db.query(ElectricalDrawingRevision).filter_by(id=revision_id).first()
    rev.file_name = "drawing.pdf"
    rev.sharepoint_path = f"Electrical-media/test/{revision_id}.pdf"
    rev.mime_type = "application/pdf"
    db.commit()


def stage(job, key):
    return next(s for s in job["stages"] if s["stage_key"] == key)


@pytest.fixture
def people(db):
    return make_user(db, "engineer@premnathrail.com"), make_user(db, "checker@premnathrail.com")


@pytest.fixture
def job(client, people):
    engineer, _ = people
    r = client.post(f"{API}/jobs", json={
        "title": "RRV-450 electrical", "rrv_model": "RRV-450", "vehicle_number": "PRL-RRV-0007",
        "target_handover_date": "2026-12-31",
    }, headers=auth(engineer))
    assert r.status_code == 200, r.text
    return r.json()


def test_requires_electrical_app(client, db):
    outsider = make_user(db, "outsider@premnathrail.com", apps=("erp",))
    r = client.get(f"{API}/jobs", headers=auth(outsider))
    assert r.status_code == 403


def test_job_is_seeded_with_all_twenty_stages(job):
    assert job["job_number"].startswith(f"ELJ-{date.today().year}-")
    assert job["status"] == "draft"
    assert len(job["stages"]) == 20
    assert [s["sequence"] for s in job["stages"]] == list(range(1, 21))
    assert job["stages"][0]["stage_key"] == "requirement"
    assert job["stages"][-1]["stage_key"] == "as_built_records"
    assert job["progress_percent"] == 0
    assert job["current_stage_key"] == "requirement"


def test_stage_gates_block_completion_with_actionable_reasons(client, people, job):
    engineer, _ = people
    h = auth(engineer)
    r = client.post(f"{API}/jobs/{job['id']}/stages/requirement/complete", json={}, headers=h)
    assert r.status_code == 409
    assert "system voltage" in r.json()["detail"]

    r = client.post(f"{API}/jobs/{job['id']}/stages/electrical_bom/complete", json={}, headers=h)
    assert r.status_code == 409 and "BOM" in r.json()["detail"]

    # Mandatory stages can't be waived; optional ones can with a reason.
    r = client.post(f"{API}/jobs/{job['id']}/stages/electrical_testing/not-applicable", json={"reason": "no"}, headers=h)
    assert r.status_code == 400
    r = client.post(f"{API}/jobs/{job['id']}/stages/panel_design/not-applicable", json={"reason": "Loose-wired vehicle, no panel"}, headers=h)
    assert r.status_code == 200
    assert stage(r.json(), "panel_design")["status"] == "not_applicable"
    assert r.json()["status"] == "draft"


def test_full_rrv_electrical_lifecycle(client, db, people, job):
    engineer, checker = people
    h, hc = auth(engineer), auth(checker)
    jid = job["id"]
    base = f"{API}/jobs/{jid}"

    def complete(key, expect=200):
        # This one test makes more writes than the OWASP limiter's per-IP
        # budget allows; conftest only resets it between tests.
        store = get_rate_store()
        if hasattr(store, "reset"):
            store.reset()
        r = client.post(f"{base}/stages/{key}/complete", json={}, headers=h)
        assert r.status_code == expect, f"{key}: {r.text}"
        return r.json()

    # 1. Requirement
    r = client.patch(base, json={"system_voltage": "24 V DC", "requirement_notes": "Head/tail lamps, beacon, 2x 12V batteries"}, headers=h)
    assert r.status_code == 200
    j = complete("requirement")
    assert j["status"] == "in_progress" and j["started_at"]
    complete("system_design")

    # Panels + BOM + cables
    panel = client.post(f"{base}/panels", json={"panel_tag": "mdp-01", "name": "Main distribution", "panel_type": "main_distribution"}, headers=h)
    assert panel.status_code == 200 and panel.json()["panel_tag"] == "MDP-01"
    dup = client.post(f"{base}/panels", json={"panel_tag": "MDP-01", "name": "Again"}, headers=h)
    assert dup.status_code == 409
    panel_id = panel.json()["id"]

    b1 = client.post(f"{base}/bom", json={"category": "battery", "description": "12V 150Ah battery", "quantity": 2}, headers=h).json()
    b2 = client.post(f"{base}/bom", json={"category": "protection", "description": "MCB 10A", "panel_id": panel_id, "quantity": 6}, headers=h).json()
    assert (b1["line_no"], b2["line_no"]) == (1, 2)
    complete("electrical_bom")

    r = client.post(f"{base}/stages/component_selection/complete", json={}, headers=h)
    assert r.status_code == 409 and "line(s) 1, 2" in r.json()["detail"]
    bad = client.patch(f"{base}/bom/{b1['id']}", json={"selection_status": "selected"}, headers=h)
    assert bad.status_code == 400  # needs make + part number
    for item, make, pn in ((b1, "Exide", "EX-150"), (b2, "Schneider", "A9F74110")):
        r = client.patch(f"{base}/bom/{item['id']}", json={"make": make, "part_number": pn, "rating": "rated", "selection_status": "selected"}, headers=h)
        assert r.status_code == 200, r.text
    complete("component_selection")
    complete("component_specification")
    complete("panel_design")

    cable = client.post(f"{base}/cables", json={"cable_tag": "c-001", "from_point": "Battery", "to_point": "MDP-01", "cores": 1, "size_sqmm": 35}, headers=h)
    assert cable.status_code == 200
    cable_id = cable.json()["id"]
    complete("cable_design")

    # Drawings: schematic R0 → submit → approve by someone else
    dwg = client.post(f"{base}/drawings", data={"title": "Main schematic", "drawing_type": "schematic"}, headers=h)
    assert dwg.status_code == 200, dwg.text
    dwg = dwg.json()
    assert dwg["drawing_number"] == f"{job['job_number']}-E01"
    rev0 = dwg["revisions"][0]
    assert rev0["revision_label"] == "R0" and rev0["status"] == "draft"
    r = client.post(f"{API}/revisions/{rev0['id']}/submit", headers=h)
    assert r.status_code == 400 and "Attach" in r.json()["detail"]
    attach_file(db, rev0["id"])
    assert client.post(f"{API}/revisions/{rev0['id']}/submit", headers=h).status_code == 200
    r = client.post(f"{API}/revisions/{rev0['id']}/approve", json={}, headers=h)
    assert r.status_code == 403  # author can't approve own revision
    r = client.post(f"{API}/revisions/{rev0['id']}/approve", json={"comment": "OK"}, headers=hc)
    assert r.status_code == 200 and r.json()["approved_revision_label"] == "R0"
    complete("schematics")
    complete("drawing_revision")

    # Purchase requirement: one line in stock, one linked to a PR
    complete("purchase_requirement", expect=409)
    pr = P2PRequest(p2p_number="P2P-ELE-2026-0099", category_code="ELE", request_date=date.today(), status="approved")
    db.add(pr)
    db.commit()
    r = client.post(f"{base}/bom/{b2['id']}/link-pr", json={"p2p_number": "p2p-ele-2026-0099"}, headers=h)
    assert r.status_code == 200 and r.json()["procurement_status"] == "pr_raised" and r.json()["p2p_number"] == "P2P-ELE-2026-0099"
    assert client.post(f"{base}/bom/{b1['id']}/link-pr", json={"p2p_number": "NOPE"}, headers=h).status_code == 404
    client.patch(f"{base}/bom/{b1['id']}", json={"procurement_status": "in_stock"}, headers=h)
    reqs = client.get(f"{API}/purchase-requirements", headers=h).json()
    assert [x["line_no"] for x in reqs] == [2] and reqs[0]["job_number"] == job["job_number"]
    complete("purchase_requirement")

    # Build
    complete("electrical_assembly")
    complete("wiring_installation", expect=409)
    r = client.post(f"{base}/cables/bulk-status", json={"cable_ids": [cable_id], "status": "installed"}, headers=h)
    assert r.status_code == 200
    complete("wiring_installation")
    r = client.patch(f"{base}/panels/{panel_id}", json={"status": "assembled"}, headers=h)
    assert r.json()["assembled_by_name"] == "engineer"
    complete("panel_assembly")

    # Testing: a failure blocks until a passing retest
    t1 = client.post(f"{base}/tests", json={"test_type": "insulation_resistance", "result": "fail", "test_date": str(date.today()), "cable_id": cable_id, "measured_value": "0.2", "unit": "MΩ"}, headers=h).json()
    assert t1["test_number"] == "T-001" and t1["needs_retest"] is True
    r = client.post(f"{base}/stages/electrical_testing/complete", json={}, headers=h)
    assert r.status_code == 409 and "T-001" in r.json()["detail"]
    issue = client.post(f"{base}/issues", json={"title": "Low IR on C-001", "test_id": t1["id"], "severity": "major"}, headers=h).json()
    assert issue["issue_number"] == "ISS-001"
    t2 = client.post(f"{base}/tests", json={"test_type": "insulation_resistance", "result": "pass", "test_date": str(date.today()), "retest_of_id": t1["id"]}, headers=h)
    assert t2.status_code == 200 and t2.json()["retest_of_number"] == "T-001"
    again = client.post(f"{base}/tests", json={"test_type": "insulation_resistance", "result": "pass", "test_date": str(date.today()), "retest_of_id": t1["id"]}, headers=h)
    assert again.status_code == 409
    complete("electrical_testing")

    # QC via Quality
    complete("inspection_qc", expect=409)
    j = client.post(f"{base}/request-inspection", headers=h).json()
    assert j["summary"]["inspection_status"] == "pending"
    assert stage(j, "inspection_qc")["status"] == "in_progress"
    insp = db.query(QualityInspection).filter_by(id=j["quality_inspection_id"]).first()
    assert insp.inspection_type == "final" and insp.batch_number == job["job_number"]
    insp.status = "passed"
    db.commit()
    complete("inspection_qc")

    # Troubleshooting
    complete("troubleshooting", expect=409)
    r = client.post(f"{API}/issues/{issue['id']}/resolve", json={"root_cause": "Chafed insulation at bulkhead", "corrective_action": "Re-routed with grommet"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    complete("troubleshooting")

    # Commissioning
    client.patch(base, json={"commissioned_on": str(date.today()), "commissioning_location": "Customer yard"}, headers=h)
    complete("commissioning", expect=409)
    client.post(f"{base}/tests", json={"phase": "commissioning", "test_type": "functional", "result": "pass", "test_date": str(date.today())}, headers=h)
    complete("commissioning")

    # Final documentation
    complete("final_documentation", expect=409)
    db.add(ElectricalDocument(job_id=jid, category="test_report", title="Final test report", file_name="report.pdf", uploaded_by_id=engineer.id))
    db.commit()
    complete("final_documentation")

    # Handover
    r = client.post(f"{base}/stages/handover/complete", json={}, headers=h)
    assert r.status_code == 409 and "handed over to" in r.json()["detail"]
    client.patch(base, json={"handover_to_name": "Mr. Rao", "handover_to_organization": "Indian Railways", "handover_date": str(date.today())}, headers=h)
    j = complete("handover")
    assert j["status"] == "handed_over" and j["handed_over_at"]

    # Closing needs the as-built record too
    assert client.post(f"{base}/close", headers=h).status_code == 409
    r = client.patch(f"{API}/drawings/{dwg['id']}", json={"is_as_built": True}, headers=h)
    assert r.status_code == 200
    j = complete("as_built_records")
    assert j["progress_percent"] == 100 and j["current_stage_key"] is None
    r = client.post(f"{base}/close", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "closed"

    # A closed job is read-only
    r = client.post(f"{base}/bom", json={"description": "Late add"}, headers=h)
    assert r.status_code == 409 and "closed" in r.json()["detail"]

    dash = client.get(f"{API}/dashboard", headers=h)
    assert dash.status_code == 200
    assert dash.json()["recent"][0]["job_number"] == job["job_number"]


def test_revision_supersedes_previous_approved(client, db, people, job):
    engineer, checker = people
    h, hc = auth(engineer), auth(checker)
    dwg = client.post(f"{API}/jobs/{job['id']}/drawings", data={"title": "Harness", "drawing_type": "harness", "drawing_number": "hr-100"}, headers=h).json()
    assert dwg["drawing_number"] == "HR-100"
    r0 = dwg["revisions"][0]["id"]
    attach_file(db, r0)
    client.post(f"{API}/revisions/{r0}/submit", headers=h)
    client.post(f"{API}/revisions/{r0}/approve", json={}, headers=hc)

    r = client.post(f"{API}/drawings/{dwg['id']}/revisions", data={"change_summary": "Added beacon circuit"}, headers=h)
    assert r.status_code == 200
    r1 = r.json()["revisions"][-1]
    assert r1["revision_label"] == "R1"
    blocked = client.post(f"{API}/drawings/{dwg['id']}/revisions", data={"change_summary": "another"}, headers=h)
    assert blocked.status_code == 409
    attach_file(db, r1["id"])
    client.post(f"{API}/revisions/{r1['id']}/submit", headers=h)
    rejected = client.post(f"{API}/revisions/{r1['id']}/reject", json={}, headers=hc)
    assert rejected.status_code == 400  # needs a reason
    r = client.post(f"{API}/revisions/{r1['id']}/approve", json={}, headers=hc).json()
    statuses = {rev["revision_label"]: rev["status"] for rev in r["revisions"]}
    assert statuses == {"R0": "superseded", "R1": "approved"}
    assert client.delete(f"{API}/drawings/{dwg['id']}", headers=h).status_code == 409


def test_hold_blocks_work_and_draft_delete(client, people, job):
    engineer, _ = people
    h = auth(engineer)
    base = f"{API}/jobs/{job['id']}"
    assert client.post(f"{base}/hold", json={"reason": "Awaiting customer spec"}, headers=h).json()["status"] == "on_hold"
    r = client.post(f"{base}/stages/system_design/start", headers=h)
    assert r.status_code == 409 and "Resume" in r.json()["detail"]
    assert client.post(f"{base}/resume", headers=h).json()["status"] == "draft"
    assert client.delete(base, headers=h).status_code == 200
    assert client.get(base, headers=h).status_code == 404
