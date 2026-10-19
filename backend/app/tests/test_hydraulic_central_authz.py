"""Hydraulic & Pneumatic on the central authorization framework: circuit
review, BOM release and test sign-off through the approval engine (plus the
legacy path for circuits sent for review before the cut-over and the
one-step approver routes), and data scope on circuits / systems."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.document import HydDocument
from app.modules.hydraulic.models.testing import HydTest
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine

API = "/api/v1/hydraulic"


def make_user(db, email, role="user", grants=None, apps=("hydraulic",)):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True,
                assigned_apps=list(apps), granular_permissions=list(grants or []))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def eng(db):
    return make_user(db, "ha.eng@premnathrail.com")


@pytest.fixture
def reviewer(db):
    return make_user(db, "ha.reviewer@premnathrail.com", grants=[
        "hydraulic:circuits:view", "hydraulic:circuits:approve", "hydraulic:bom:view", "hydraulic:bom:approve",
        "hydraulic:testing:view", "hydraulic:testing:approve",
    ])


def new_circuit(client, db, h):
    c = client.post(f"{API}/circuits", json={"title": "Lift circuit"}, headers=h).json()
    db.add(HydDocument(entity_type="circuit", entity_id=c["id"], doc_type="circuit_diagram", title="D", file_name="d.pdf"))
    db.commit()
    return c


def test_circuit_review_on_the_engine(client, db, eng, reviewer):
    h, hr = auth(eng), auth(reviewer)
    c = new_circuit(client, db, h)
    sub = client.post(f"{API}/circuits/{c['id']}/submit", headers=h).json()
    assert sub["status"] == "under_review" and sub["approval_request_id"]
    req = engine.latest_request(db, "hyd_circuit", c["id"])
    assert [s.approver_id for s in req.steps] == [reviewer.id]
    # Submitter can't decide it (four-eyes), the reviewer can.
    assert client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "approve"}, headers=h).status_code == 403
    out = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "approve", "comment": "Checked"}, headers=hr)
    assert out.status_code == 200 and out.json()["status"] == "approved"
    db.expire_all()
    circuit = db.get(HydCircuit, c["id"])
    assert circuit.status == "approved" and circuit.approved_by_id == reviewer.id and circuit.review_remarks == "Checked"


def test_legacy_under_review_circuit_uses_old_route(client, db, eng, reviewer):
    c = new_circuit(client, db, auth(eng))
    circuit = db.get(HydCircuit, c["id"])
    circuit.status, circuit.submitted_by_id = "under_review", eng.id  # sent before the cut-over
    db.commit()
    r = client.post(f"{API}/circuits/{c['id']}/return", json={"remarks": "Relief setting missing"}, headers=auth(reviewer))
    assert r.status_code == 200 and r.json()["status"] == "draft"
    assert engine.latest_request(db, "hyd_circuit", c["id"]) is None


def test_bom_release_submit_and_one_step(client, db, eng, reviewer):
    h, hr = auth(eng), auth(reviewer)
    comp = client.post(f"{API}/components", json={"name": "Pump", "category": "pump", "unit_cost": 500}, headers=h).json()
    editor = make_user(db, "ha.bomed@premnathrail.com", grants=["hydraulic:bom:view", "hydraulic:bom:create", "hydraulic:bom:edit", "hydraulic:bom:submit"])
    bom = client.post(f"{API}/boms", json={"title": "Pack", "items": [{"component_id": comp["id"], "quantity": 2}]}, headers=auth(editor)).json()
    # No approve grant: release is refused, submit sends it for approval.
    assert client.post(f"{API}/boms/{bom['id']}/release", headers=auth(editor)).status_code == 403
    sub = client.post(f"{API}/boms/{bom['id']}/submit", headers=auth(editor)).json()
    assert sub["status"] == "under_review" and sub["approval_request_id"]
    assert client.patch(f"{API}/boms/{bom['id']}", json={"title": "x"}, headers=auth(editor)).status_code == 409
    req = engine.latest_request(db, "hyd_bom", bom["id"])
    assert req.amount == 1000 and [s.approver_id for s in req.steps] == [reviewer.id]
    rel = client.post(f"{API}/boms/{bom['id']}/release", headers=hr).json()  # old route decides the request
    assert rel["status"] == "released" and rel["released_by_name"] == "ha.reviewer"
    assert engine.latest_request(db, "hyd_bom", bom["id"]).status == "approved"

    # An approver releasing a draft = submit + approve at once (self-approval allowed, as before).
    rev = client.post(f"{API}/boms/{bom['id']}/revise", headers=auth(editor)).json()
    out = client.post(f"{API}/boms/{rev['id']}/release", headers=hr).json()
    assert out["status"] == "released"
    req2 = engine.latest_request(db, "hyd_bom", rev["id"])
    assert req2.status == "approved" and req2.requester_id == reviewer.id
    assert db.get(HydBom, bom["id"]).status == "obsolete"


def test_test_result_sign_off(client, db, eng, reviewer):
    tester = make_user(db, "ha.tester@premnathrail.com", grants=["hydraulic:testing:view", "hydraulic:testing:create", "hydraulic:testing:edit", "hydraulic:testing:submit"])
    system = client.post(f"{API}/systems", json={"name": "Pack", "system_type": "hydraulic", "status": "in_service"}, headers=auth(eng)).json()
    t = client.post(f"{API}/tests", json={"title": "Proof", "test_type": "pressure_test", "system_id": system["id"],
                                          "readings": [{"parameter": "Leak", "measured_text": "None", "result": "pass"}]},
                    headers=auth(tester)).json()
    assert client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pass"}, headers=auth(tester)).status_code == 403
    sub = client.post(f"{API}/tests/{t['id']}/submit", json={"result": "pass"}, headers=auth(tester)).json()
    assert sub["status"] == "under_review" and sub["result"] == "pass"
    req = engine.latest_request(db, "hyd_test", t["id"])
    engine.decide(db, req.id, reviewer, "return", "Attach the gauge certificate")
    db.commit()
    db.expire_all()
    test = db.get(HydTest, t["id"])
    assert test.status == "in_progress" and test.result == "pending"
    client.post(f"{API}/tests/{t['id']}/submit", json={"result": "pass"}, headers=auth(tester))
    done = client.post(f"{API}/tests/{t['id']}/complete", json={}, headers=auth(reviewer))
    assert done.status_code == 422  # payload needs a result
    done = client.post(f"{API}/tests/{t['id']}/complete", json={"result": "pass"}, headers=auth(reviewer)).json()
    assert done["status"] == "completed" and done["result"] == "pass" and done["completed_by_name"] == "ha.reviewer"


def test_scope_on_circuits_and_systems(client, db):
    role = Role(name="Hydraulic – own", permissions=["hydraulic:*:*"], data_scopes={"hydraulic": "own"})
    db.add(role)
    db.commit()
    a = User(email="ha.scope.a@premnathrail.com", name="A", role="user", is_active=True)
    b = User(email="ha.scope.b@premnathrail.com", name="B", role="user", is_active=True)
    a.roles, b.roles = [role], [role]
    db.add_all([a, b])
    db.commit()
    mine = client.post(f"{API}/circuits", json={"title": "Mine"}, headers=auth(a)).json()
    theirs = client.post(f"{API}/circuits", json={"title": "Theirs"}, headers=auth(b)).json()
    ids = [c["id"] for c in client.get(f"{API}/circuits", headers=auth(a)).json()]
    assert mine["id"] in ids and theirs["id"] not in ids
    r = client.get(f"{API}/circuits/{theirs['id']}", headers=auth(a))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.get(f"{API}/documents", params={"entity_type": "circuit", "entity_id": theirs["id"]}, headers=auth(a)).status_code == 403

    sys_b = client.post(f"{API}/systems", json={"name": "B pack", "system_type": "hydraulic", "status": "in_service"}, headers=auth(b)).json()
    assert client.get(f"{API}/systems/{sys_b['id']}", headers=auth(a)).status_code == 403
    assert sys_b["id"] not in [s["id"] for s in client.get(f"{API}/systems", headers=auth(a)).json()]
    assert client.get(f"{API}/dashboard", headers=auth(a)).json()["kpis"]["hydraulic_systems"] == 0
