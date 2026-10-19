"""Electrical on the central authorization framework: drawing-revision and
BOM component-selection approvals through the approval engine (plus the
legacy path for revisions submitted before the cut-over), and the job data
scope applied to lists, records and child records."""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.electrical.models.bom import ElectricalBomItem
from app.modules.electrical.models.drawing import ElectricalDrawing, ElectricalDrawingRevision
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.service import seed_stages
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine

API = "/api/v1/electrical"


def make_user(db, email, apps=("electrical",), role="user", grants=None):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True,
                assigned_apps=list(apps), granular_permissions=list(grants or []))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def people(db):
    return {
        "engineer": make_user(db, "ea.engineer@premnathrail.com"),
        "checker": make_user(db, "ea.checker@premnathrail.com", grants=["electrical:drawings:view", "electrical:drawings:approve"]),
        "approver": make_user(db, "ea.approver@premnathrail.com", grants=["electrical:jobs:view", "electrical:jobs:edit", "electrical:jobs:approve"]),
    }


@pytest.fixture
def job(client, people):
    r = client.post(f"{API}/jobs", json={"title": "RRV-500 wiring"}, headers=auth(people["engineer"]))
    assert r.status_code == 200, r.text
    return r.json()


def submitted_revision(client, db, job, h):
    d = client.post(f"{API}/jobs/{job['id']}/drawings", data={"title": "SLD", "drawing_type": "single_line"}, headers=h).json()
    rev = db.get(ElectricalDrawingRevision, d["revisions"][0]["id"])
    rev.file_name, rev.sharepoint_path = "sld.pdf", "Electrical-media/x/sld.pdf"
    db.commit()
    r = client.post(f"{API}/revisions/{rev.id}/submit", headers=h)
    assert r.status_code == 200, r.text
    return rev.id, r.json()


def test_revision_goes_through_the_engine(client, db, people, job):
    h, hc = auth(people["engineer"]), auth(people["checker"])
    rid, drawing = submitted_revision(client, db, job, h)
    req = engine.latest_request(db, "electrical_drawing_revision", rid)
    assert req.status == "pending" and req.workflow_key == "electrical.drawing_revision"
    # Only the deliberate holder of drawings:approve is routed; the preparer never is.
    assert [s.approver_id for s in req.steps] == [people["checker"].id]
    assert drawing["revisions"][0]["approval_request_id"] == req.id

    # Return for changes → back to draft with the comment.
    out = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "return", "comment": "Add fuse ratings"}, headers=hc)
    assert out.status_code == 200 and out.json()["status"] == "returned"
    db.expire_all()
    rev = db.get(ElectricalDrawingRevision, rid)
    assert rev.status == "draft" and rev.decision_comment == "Add fuse ratings"

    # Resubmit; the old /approve route decides the engine request.
    assert client.post(f"{API}/revisions/{rid}/submit", headers=h).status_code == 200
    r = client.post(f"{API}/revisions/{rid}/approve", json={"comment": "OK"}, headers=hc)
    assert r.status_code == 200 and r.json()["approved_revision_label"] == "R0"
    req = engine.latest_request(db, "electrical_drawing_revision", rid)
    assert req.status == "approved" and req.revision == 2
    db.expire_all()
    rev = db.get(ElectricalDrawingRevision, rid)
    assert rev.decided_by_id == people["checker"].id and rev.decision_comment == "OK"


def test_legacy_submitted_revision_uses_old_route(client, db, people, job):
    # A revision already 'submitted' before the cut-over has no engine request.
    d = ElectricalDrawing(job_id=job["id"], drawing_number="OLD-1", title="Old", drawing_type="schematic")
    db.add(d)
    db.flush()
    rev = ElectricalDrawingRevision(drawing_id=d.id, revision_index=0, revision_label="R0", status="submitted",
                                    prepared_by_id=people["engineer"].id, sharepoint_path="x.pdf")
    db.add(rev)
    db.commit()
    assert engine.latest_request(db, "electrical_drawing_revision", rev.id) is None
    r = client.post(f"{API}/revisions/{rev.id}/reject", json={"comment": "Wrong sheet"}, headers=auth(people["checker"]))
    assert r.status_code == 200 and r.json()["revisions"][0]["status"] == "rejected"
    assert engine.latest_request(db, "electrical_drawing_revision", rev.id) is None


def test_bom_selection_submit_and_one_step_approve(client, db, people, job):
    h, ha = auth(people["engineer"]), auth(people["approver"])
    base = f"{API}/jobs/{job['id']}/bom"
    sel = {"make": "ABB", "part_number": "S201-C10"}
    line = client.post(base, json={"description": "MCB", "selection_status": "selected", **sel}, headers=h).json()
    r = client.post(f"{base}/{line['id']}/submit", headers=h)
    assert r.status_code == 200 and r.json()["approval_request_id"]
    # Frozen while it waits.
    assert client.patch(f"{base}/{line['id']}", json={"make": "Siemens"}, headers=h).status_code == 409
    req = engine.latest_request(db, "electrical_bom_item", line["id"])
    assert [s.approver_id for s in req.steps] == [people["approver"].id]
    engine.decide(db, req.id, people["approver"], "approve")
    db.commit()
    assert db.get(ElectricalBomItem, line["id"]).selection_status == "approved"

    # An approver marking a line approved directly = submit + approve in one go.
    line2 = client.post(base, json={"description": "Relay", "selection_status": "approved", "make": "Omron", "part_number": "MY2"}, headers=ha).json()
    assert line2["selection_status"] == "approved"
    req2 = engine.latest_request(db, "electrical_bom_item", line2["id"])
    assert req2.status == "approved" and req2.requester_id == people["approver"].id


def test_job_data_scope(client, db, people):
    role = Role(name="Electrical – own jobs", permissions=["electrical:*:*"], data_scopes={"electrical": "own"})
    db.add(role)
    db.commit()
    a = User(email="ea.scope.a@premnathrail.com", name="Scope A", role="user", is_active=True)
    b = User(email="ea.scope.b@premnathrail.com", name="Scope B", role="user", is_active=True)
    a.roles, b.roles = [role], [role]
    db.add_all([a, b])
    db.commit()
    mine = client.post(f"{API}/jobs", json={"title": "A's job"}, headers=auth(a)).json()
    theirs = client.post(f"{API}/jobs", json={"title": "B's job"}, headers=auth(b)).json()

    listed = [j["id"] for j in client.get(f"{API}/jobs", headers=auth(a)).json()]
    assert mine["id"] in listed and theirs["id"] not in listed
    r = client.get(f"{API}/jobs/{theirs['id']}", headers=auth(a))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.get(f"{API}/jobs/{theirs['id']}/bom", headers=auth(a)).status_code == 403
    assert client.get(f"{API}/jobs/{mine['id']}/bom", headers=auth(a)).status_code == 200

    # Assigned: lead engineer on B's job → visible at 'assigned', not at 'own'.
    job = db.get(ElectricalJob, theirs["id"])
    job.lead_engineer_id = a.id
    db.commit()
    assert client.get(f"{API}/jobs/{theirs['id']}", headers=auth(a)).status_code == 403
    role.data_scopes = {"electrical": "assigned"}
    db.commit()
    assert client.get(f"{API}/jobs/{theirs['id']}", headers=auth(a)).status_code == 200
    # Admins and users without a narrowed role see everything.
    admin = make_user(db, "ea.admin@premnathrail.com", role="admin")
    assert {mine["id"], theirs["id"]} <= {j["id"] for j in client.get(f"{API}/jobs", headers=auth(admin)).json()}


def test_approver_outside_scope_can_open_the_job(client, db, people):
    role = Role(name="Electrical – own only", permissions=["electrical:*:*"], data_scopes={"electrical": "own"})
    db.add(role)
    db.commit()
    checker = User(email="ea.scoped.checker@premnathrail.com", name="Scoped checker", role="user", is_active=True,
                   granular_permissions=["electrical:drawings:approve"])
    checker.roles = [role]
    db.add(checker)
    db.commit()
    owner = people["engineer"]
    j = ElectricalJob(job_number=f"ELJ-{date.today().year}-9001", title="Scoped", status="draft", created_by_id=owner.id)
    seed_stages(j)
    db.add(j)
    db.commit()
    assert client.get(f"{API}/jobs/{j.id}", headers=auth(checker)).status_code == 403
    submitted_revision(client, db, {"id": j.id}, auth(owner))
    assert db.query(ApprovalRequest).count() == 1
    assert client.get(f"{API}/jobs/{j.id}", headers=auth(checker)).status_code == 200


def test_cancelling_job_withdraws_pending_drawing_approval(client, db, people, job):
    h = auth(people["engineer"])
    rid, _ = submitted_revision(client, db, job, h)
    assert engine.latest_request(db, "electrical_drawing_revision", rid).status == "pending"
    r = client.post(f"{API}/jobs/{job['id']}/cancel", json={"reason": "Order lost"}, headers=h)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert engine.latest_request(db, "electrical_drawing_revision", rid).status == "cancelled"
    assert db.get(ElectricalDrawingRevision, rid).status == "draft"
