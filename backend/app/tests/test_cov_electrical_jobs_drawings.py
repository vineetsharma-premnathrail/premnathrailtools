"""Coverage tests for the Electrical module — job lifecycle, stage gates and
the drawing-revision workflow (draft → submitted → approved / rejected,
with the four-eyes rule: the person who prepared a revision can't approve
it). Complements test_electrical.py, which walks one happy-path job end to
end; these tests poke the edges each gate and guard is meant to hold.

SharePoint isn't configured in tests, so drawing files are attached by
writing the pointer straight onto the revision row (same as
test_electrical.py)."""
from datetime import date
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.electrical.models.drawing import ElectricalDrawingRevision
from app.modules.main.models.user import User

API = "/api/v1/electrical"


@pytest.fixture(autouse=True)
def _sqlite_inspection_numbers(monkeypatch):
    # Quality's number generator takes a Postgres advisory lock.
    seq = count(1)
    monkeypatch.setattr(
        "app.modules.electrical.routes.jobs.generate_inspection_number",
        lambda db, code: f"INSP-{code}-COV-{next(seq):04d}",
    )


def make_user(db, email, apps=("electrical",), role="user", grants=None):
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


def attach_file(db, revision_id):
    rev = db.query(ElectricalDrawingRevision).filter_by(id=revision_id).first()
    rev.file_name = "drawing.pdf"
    rev.sharepoint_path = f"Electrical-media/cov/{revision_id}.pdf"
    rev.mime_type = "application/pdf"
    db.commit()


def stage(job, key):
    return next(s for s in job["stages"] if s["stage_key"] == key)


@pytest.fixture
def people(db):
    return {
        "engineer": make_user(db, "cov.engineer@premnathrail.com"),
        "checker": make_user(db, "cov.checker@premnathrail.com"),
    }


@pytest.fixture
def job(client, people):
    r = client.post(f"{API}/jobs", json={"title": "  RRV-300 lighting  ", "rrv_model": "RRV-300"}, headers=auth(people["engineer"]))
    assert r.status_code == 200, r.text
    return r.json()


def new_drawing(client, job_id, h, **form):
    data = {"title": "Main schematic", "drawing_type": "schematic", **form}
    r = client.post(f"{API}/jobs/{job_id}/drawings", data=data, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

def test_job_numbers_are_sequential_and_title_is_trimmed(client, people, job):
    year = date.today().year
    assert job["job_number"] == f"ELJ-{year}-0001"
    assert job["title"] == "RRV-300 lighting"
    second = client.post(f"{API}/jobs", json={"title": "Second"}, headers=auth(people["engineer"])).json()
    assert second["job_number"] == f"ELJ-{year}-0002"


def test_job_create_validation_messages(client, people):
    h = auth(people["engineer"])
    r = client.post(f"{API}/jobs", json={"title": "x", "priority": "asap"}, headers=h)
    assert r.status_code == 400 and "Invalid priority 'asap'" in r.json()["detail"]
    r = client.post(f"{API}/jobs", json={"title": "x", "planned_start_date": "2026-12-01", "target_handover_date": "2026-11-01"}, headers=h)
    assert r.status_code == 400 and "can't be before the planned start" in r.json()["detail"]
    r = client.post(f"{API}/jobs", json={"title": "x", "lead_engineer_id": 99999}, headers=h)
    assert r.status_code == 404 and "Lead engineer" in r.json()["detail"]


def test_requirement_gate_names_each_missing_field(client, people, job):
    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    detail = client.get(base, headers=h).json()
    problems = stage(detail, "requirement")["gate_problems"]
    assert len(problems) == 2  # voltage + requirement notes
    client.patch(base, json={"system_voltage": "24 V DC"}, headers=h)
    r = client.post(f"{base}/stages/requirement/complete", json={}, headers=h)
    assert r.status_code == 409
    assert "system voltage" not in r.json()["detail"] and "customer's electrical requirement" in r.json()["detail"]
    client.patch(base, json={"requirement_notes": "Beacon + work lamps"}, headers=h)
    j = client.post(f"{base}/stages/requirement/complete", json={"remarks": "Agreed with customer"}, headers=h).json()
    req = stage(j, "requirement")
    assert req["status"] == "completed" and req["remarks"] == "Agreed with customer" and req["gate_problems"] == []
    # Completing the first stage starts the job.
    assert j["status"] == "in_progress" and j["started_at"]
    assert j["progress_percent"] == 5  # 1 of 20 stages
    assert j["current_stage_key"] == "system_design"


def test_stage_actions_reject_unknown_and_repeat(client, people, job):
    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    r = client.post(f"{base}/stages/painting/complete", json={}, headers=h)
    assert r.status_code == 404 and "Unknown stage 'painting'" in r.json()["detail"]
    # system_design has no gate → completes on the engineer's word.
    assert client.post(f"{base}/stages/system_design/complete", json={}, headers=h).status_code == 200
    again = client.post(f"{base}/stages/system_design/complete", json={}, headers=h)
    assert again.status_code == 409 and "already completed" in again.json()["detail"]
    assert client.post(f"{base}/stages/system_design/start", headers=h).status_code == 409
    # Reopen brings it back to in_progress (it was started when completed).
    j = client.post(f"{base}/stages/system_design/reopen", headers=h).json()
    assert stage(j, "system_design")["status"] == "in_progress"
    assert stage(j, "system_design")["completed_at"] is None
    r = client.post(f"{base}/stages/system_design/reopen", headers=h)
    assert r.status_code == 409 and "nothing to reopen" in r.json()["detail"]


def test_not_applicable_then_reopen_clears_reason(client, people, job):
    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    j = client.post(f"{base}/stages/panel_assembly/not-applicable", json={"reason": "No panel"}, headers=h).json()
    pa = stage(j, "panel_assembly")
    assert pa["status"] == "not_applicable" and pa["remarks"] == "Not applicable: No panel"
    r = client.post(f"{base}/stages/panel_assembly/not-applicable", json={"reason": "again"}, headers=h)
    assert r.status_code == 409 and "marked not applicable" in r.json()["detail"]
    j = client.post(f"{base}/stages/panel_assembly/reopen", headers=h).json()
    pa = stage(j, "panel_assembly")
    assert pa["status"] == "not_started" and pa["remarks"] is None
    for key in ("requirement", "electrical_bom", "electrical_testing", "handover"):
        r = client.post(f"{base}/stages/{key}/not-applicable", json={"reason": "skip"}, headers=h)
        assert r.status_code == 400, key
    assert stage(j, "handover")["is_mandatory"] is True


def test_gate_message_summarises_long_lists(client, people, job):
    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    for n in range(7):
        assert client.post(f"{base}/bom", json={"description": f"Relay {n}"}, headers=h).status_code == 200
    r = client.post(f"{base}/stages/component_selection/complete", json={}, headers=h)
    # _NAME_LIMIT = 5 → lines 1–5 named, the remaining 2 summarised.
    assert r.status_code == 409 and "line(s) 1, 2, 3, 4, 5 and 2 more" in r.json()["detail"]
    r = client.post(f"{base}/stages/component_specification/complete", json={}, headers=h)
    assert r.status_code == 409 and "rating or specification" in r.json()["detail"]


def test_handover_gate_needs_earlier_stages_and_recipient(client, people, job):
    h = auth(people["engineer"])
    r = client.post(f"{API}/jobs/{job['id']}/stages/handover/complete", json={}, headers=h)
    assert r.status_code == 409
    detail = r.json()["detail"]
    # 18 earlier stages are open: five are named, the rest summarised.
    assert "still open: Electrical Requirement, Electrical System Design" in detail and "and 13 more." in detail
    assert "handed over to" in detail


def test_hold_resume_cancel_and_delete_rules(client, people, job):
    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    client.post(f"{base}/stages/system_design/complete", json={}, headers=h)
    # Stage progress recorded → can't delete, must cancel.
    r = client.delete(base, headers=h)
    assert r.status_code == 409 and "in progress" in r.json()["detail"]

    held = client.post(f"{base}/hold", json={"reason": "Parts awaited"}, headers=h).json()
    assert held["status"] == "on_hold" and held["hold_reason"] == "Parts awaited"
    r = client.post(f"{base}/bom", json={"description": "Fuse"}, headers=h)
    assert r.status_code == 409 and "Resume the job first" in r.json()["detail"]
    assert client.post(f"{base}/hold", json={"reason": "again"}, headers=h).status_code == 409
    # Resume returns to in_progress because the job had started.
    resumed = client.post(f"{base}/resume", headers=h).json()
    assert resumed["status"] == "in_progress" and resumed["hold_reason"] is None
    assert client.post(f"{base}/resume", headers=h).status_code == 409

    cancelled = client.post(f"{base}/cancel", json={"reason": "Order withdrawn"}, headers=h).json()
    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "Order withdrawn"
    assert client.post(f"{base}/cancel", json={"reason": "x"}, headers=h).status_code == 409
    r = client.patch(base, json={"title": "renamed"}, headers=h)
    assert r.status_code == 409 and "cancelled" in r.json()["detail"]
    r = client.post(f"{base}/stages/requirement/complete", json={}, headers=h)
    assert r.status_code == 409 and "can't be changed" in r.json()["detail"]
    assert client.post(f"{base}/close", headers=h).status_code == 409


def test_unknown_job_is_404_with_reason(client, people):
    r = client.get(f"{API}/jobs/424242", headers=auth(people["engineer"]))
    assert r.status_code == 404 and "#424242 not found" in r.json()["detail"]


def test_request_inspection_twice_is_blocked_until_failed(client, db, people, job):
    from app.modules.quality.models.inspection import QualityInspection

    h = auth(people["engineer"])
    base = f"{API}/jobs/{job['id']}"
    j = client.post(f"{base}/request-inspection", headers=h).json()
    assert stage(j, "inspection_qc")["status"] == "in_progress" and j["status"] == "in_progress"
    r = client.post(f"{base}/request-inspection", headers=h)
    assert r.status_code == 409 and "already pending" in r.json()["detail"]
    # Gate message reflects the live inspection.
    r = client.post(f"{base}/stages/inspection_qc/complete", json={}, headers=h)
    assert r.status_code == 409 and "Wait for Quality" in r.json()["detail"]
    insp = db.query(QualityInspection).filter_by(id=j["quality_inspection_id"]).first()
    insp.status = "failed"
    db.commit()
    r = client.post(f"{base}/stages/inspection_qc/complete", json={}, headers=h)
    assert r.status_code == 409 and "request a fresh inspection" in r.json()["detail"]
    again = client.post(f"{base}/request-inspection", headers=h)
    assert again.status_code == 200 and again.json()["quality_inspection_id"] != j["quality_inspection_id"]


# ---------------------------------------------------------------------------
# Drawings & revisions
# ---------------------------------------------------------------------------

def test_drawing_number_validation(client, people, job):
    h = auth(people["engineer"])
    d = new_drawing(client, job["id"], h, drawing_number=" wd-01 ")
    assert d["drawing_number"] == "WD-01"
    dup = client.post(f"{API}/jobs/{job['id']}/drawings", data={"title": "Copy", "drawing_number": "Wd-01"}, headers=h)
    assert dup.status_code == 409 and "already used" in dup.json()["detail"]
    bad = client.post(f"{API}/jobs/{job['id']}/drawings", data={"title": "x", "drawing_type": "napkin_sketch"}, headers=h)
    assert bad.status_code == 400 and "Invalid drawing type" in bad.json()["detail"]
    blank = client.post(f"{API}/jobs/{job['id']}/drawings", data={"title": "   "}, headers=h)
    assert blank.status_code == 400
    # Auto-numbering skips the manual number and continues per job.
    auto = new_drawing(client, job["id"], h)
    assert auto["drawing_number"] == f"{job['job_number']}-E02"


def test_four_eyes_on_revision_approval(client, db, people, job):
    eng, chk = auth(people["engineer"]), auth(people["checker"])
    d = new_drawing(client, job["id"], eng)
    r0 = d["revisions"][0]["id"]
    attach_file(db, r0)

    # Only the preparer submits.
    r = client.post(f"{API}/revisions/{r0}/submit", headers=chk)
    assert r.status_code == 403 and "prepared R0" in r.json()["detail"]
    # A draft can't be approved — it has to be submitted first.
    r = client.post(f"{API}/revisions/{r0}/approve", json={}, headers=chk)
    assert r.status_code == 409 and "only a submitted revision" in r.json()["detail"]

    sub = client.post(f"{API}/revisions/{r0}/submit", headers=eng).json()
    assert sub["latest_revision_status"] == "submitted"
    assert client.post(f"{API}/revisions/{r0}/submit", headers=eng).status_code == 409

    # Submitter (= preparer) can't approve; somebody else can.
    r = client.post(f"{API}/revisions/{r0}/approve", json={"comment": "self"}, headers=eng)
    assert r.status_code == 403 and "someone else has to approve" in r.json()["detail"]
    ok = client.post(f"{API}/revisions/{r0}/approve", json={"comment": "  Checked  "}, headers=chk).json()
    rev = ok["revisions"][0]
    assert rev["status"] == "approved" and rev["decided_by_name"] == "cov.checker" and rev["decision_comment"] == "Checked"
    assert rev["prepared_by_name"] == "cov.engineer" and rev["has_file"] is True
    assert client.post(f"{API}/revisions/{r0}/approve", json={}, headers=chk).status_code == 409


def test_admin_cannot_approve_own_revision(client, db, job):
    # Four-eyes binds admins too (central approval engine, 2026-10-08); an
    # admin may switch "Requester may approve own document" on per workflow.
    admin = make_user(db, "cov.admin@premnathrail.com", role="admin")
    h = auth(admin)
    d = new_drawing(client, job["id"], h, title="Admin drawn")
    r0 = d["revisions"][0]["id"]
    attach_file(db, r0)
    client.post(f"{API}/revisions/{r0}/submit", headers=h)
    r = client.post(f"{API}/revisions/{r0}/approve", json={"comment": "self"}, headers=h)
    assert r.status_code == 403 and "four-eyes" in r.json()["detail"]


def test_reject_then_raise_next_revision(client, db, people, job):
    eng, chk = auth(people["engineer"]), auth(people["checker"])
    d = new_drawing(client, job["id"], eng)
    r0 = d["revisions"][0]["id"]
    attach_file(db, r0)
    client.post(f"{API}/revisions/{r0}/submit", headers=eng)
    r = client.post(f"{API}/revisions/{r0}/reject", json={"comment": "   "}, headers=chk)
    assert r.status_code == 400 and "Say why" in r.json()["detail"]
    rej = client.post(f"{API}/revisions/{r0}/reject", json={"comment": "Wrong fuse rating"}, headers=chk).json()
    assert rej["revisions"][0]["status"] == "rejected" and rej["approved_revision_label"] is None
    # Rejected stays on record — can't be discarded, re-submitted or approved.
    assert client.delete(f"{API}/revisions/{r0}", headers=eng).status_code == 409
    assert client.post(f"{API}/revisions/{r0}/approve", json={}, headers=chk).status_code == 409

    # Change summary is mandatory for a new revision.
    blank = client.post(f"{API}/drawings/{d['id']}/revisions", data={"change_summary": "  "}, headers=eng)
    assert blank.status_code == 400
    r1 = client.post(f"{API}/drawings/{d['id']}/revisions", data={"change_summary": "Fuse 10A → 16A"}, headers=eng).json()
    assert [r["revision_label"] for r in r1["revisions"]] == ["R0", "R1"]
    assert r1["latest_revision_label"] == "R1" and r1["latest_revision_status"] == "draft"

    # The R1 draft can be discarded by its preparer (another revision exists).
    r1_id = r1["revisions"][-1]["id"]
    assert client.delete(f"{API}/revisions/{r1_id}", headers=chk).status_code == 403
    after = client.delete(f"{API}/revisions/{r1_id}", headers=eng).json()
    assert [r["revision_label"] for r in after["revisions"]] == ["R0"]
    # A drawing with no approved revision can be deleted.
    assert client.delete(f"{API}/drawings/{d['id']}", headers=eng).status_code == 200
    assert client.get(f"{API}/drawings/{d['id']}", headers=eng).status_code == 404


def test_only_revision_cannot_be_discarded(client, people, job):
    h = auth(people["engineer"])
    d = new_drawing(client, job["id"], h)
    r = client.delete(f"{API}/revisions/{d['revisions'][0]['id']}", headers=h)
    assert r.status_code == 409 and "Delete the drawing instead" in r.json()["detail"]


def test_drawing_gates_schematic_type_and_open_revisions(client, db, people, job):
    eng, chk = auth(people["engineer"]), auth(people["checker"])
    base = f"{API}/jobs/{job['id']}"
    # An approved harness drawing doesn't satisfy the schematics gate.
    harness = new_drawing(client, job["id"], eng, title="Harness", drawing_type="harness")
    hid = harness["revisions"][0]["id"]
    attach_file(db, hid)
    client.post(f"{API}/revisions/{hid}/submit", headers=eng)
    client.post(f"{API}/revisions/{hid}/approve", json={}, headers=chk)
    r = client.post(f"{base}/stages/schematics/complete", json={}, headers=eng)
    assert r.status_code == 409 and "schematic or single line" in r.json()["detail"]

    # A single line diagram does — once approved.
    sld = new_drawing(client, job["id"], eng, title="SLD", drawing_type="single_line")
    sid = sld["revisions"][0]["id"]
    r = client.post(f"{base}/stages/drawing_revision/complete", json={}, headers=eng)
    assert r.status_code == 409
    assert f"Get a revision approved for drawing(s) {sld['drawing_number']}" in r.json()["detail"]
    assert "Finish (approve, reject or discard) the open revision" in r.json()["detail"]
    attach_file(db, sid)
    client.post(f"{API}/revisions/{sid}/submit", headers=eng)
    detail = client.get(base, headers=eng).json()
    assert detail["summary"]["drawings_pending_approval"] == 1
    client.post(f"{API}/revisions/{sid}/approve", json={}, headers=chk)
    assert client.post(f"{base}/stages/schematics/complete", json={}, headers=eng).status_code == 200
    assert client.post(f"{base}/stages/drawing_revision/complete", json={}, headers=eng).status_code == 200

    # Lists filter on the latest revision's status.
    approved = client.get(f"{API}/drawings", params={"job_id": job["id"], "revision_status": "approved"}, headers=eng).json()
    assert {x["drawing_number"] for x in approved} == {harness["drawing_number"], sld["drawing_number"]}


def test_approve_requires_matrix_permission(client, db, people, job):
    eng = auth(people["engineer"])
    # Matrix-configured user: may view/edit jobs and view drawings, but not approve them.
    limited = make_user(db, "cov.limited@premnathrail.com", grants=[
        "electrical:jobs:view", "electrical:jobs:edit", "electrical:drawings:view",
    ])
    d = new_drawing(client, job["id"], eng)
    r0 = d["revisions"][0]["id"]
    attach_file(db, r0)
    client.post(f"{API}/revisions/{r0}/submit", headers=eng)
    r = client.post(f"{API}/revisions/{r0}/approve", json={}, headers=auth(limited))
    assert r.status_code == 403 and "'Approve' permission on Electrical › Drawings" in r.json()["detail"]
    assert client.post(f"{API}/revisions/{r0}/reject", json={"comment": "no"}, headers=auth(limited)).status_code == 403
    # Granting approve lets the same user through. Approvers are fixed when the
    # revision is submitted (central approval engine), so it is withdrawn and
    # submitted again after the grant.
    limited.granular_permissions = [*limited.granular_permissions, "electrical:drawings:approve"]
    db.commit()
    req_id = client.get(f"/api/v1/approvals/entity/electrical_drawing_revision/{r0}", headers=eng).json()["current"]["id"]
    assert client.post(f"/api/v1/approvals/requests/{req_id}/cancel", json={}, headers=eng).status_code == 200
    assert client.post(f"{API}/revisions/{r0}/submit", headers=eng).status_code == 200
    assert client.post(f"{API}/revisions/{r0}/approve", json={}, headers=auth(limited)).status_code == 200


def test_closed_states_freeze_drawings(client, db, people, job):
    h = auth(people["engineer"])
    d = new_drawing(client, job["id"], h)
    client.post(f"{API}/jobs/{job['id']}/hold", json={"reason": "wait"}, headers=h)
    r = client.post(f"{API}/drawings/{d['id']}/revisions", data={"change_summary": "x"}, headers=h)
    assert r.status_code == 409 and "on hold" in r.json()["detail"]
    r = client.patch(f"{API}/drawings/{d['id']}", json={"title": "x"}, headers=h)
    assert r.status_code == 409
