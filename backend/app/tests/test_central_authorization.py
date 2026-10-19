"""Central authorization: approval engine, delegation, escalation, data scope,
security settings."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.auth.jwt_handler import create_access_token
from app.core.data_scope import apply_scope, ensure_in_scope, register_scoped, user_scope
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalDelegation, ApprovalRequestStep
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.products.models.product import FinishedProduct

KEY = "test.ncr_decision"
decided: list[tuple[int, str]] = []


def _on_decided(db, req, outcome, actor):
    decided.append((req.entity_id, outcome))


engine.register_transaction(engine.TransactionType(
    key=KEY, module_key="quality", subtab_key="ncr", label="Test NCR decision", entity_type="test_ncr",
    url="/dashboard/quality/ncr/{id}",
    context_fields={"disposition": {"label": "Disposition", "type": "choice", "choices": ["scrap", "rework"]},
                    "chosen_approver_id": {"label": "Chosen approver", "type": "user"}},
    default_stages=[
        engine.StageDef("Department head", "department_head"),
        engine.StageDef("Partner", "partner", conditions=[{"field": "amount", "op": "gt", "value": 100000}]),
    ],
    on_decided=_on_decided,
))


def _user(db, email, **kw):
    grants = kw.pop("grants", [])
    u = User(email=email, name=email.split("@")[0], role=kw.pop("role", "user"), is_active=True, **kw)
    u.granular_permissions = grants
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def team(db):
    decided.clear()
    approve = ["quality:ncr:approve", "quality:ncr:reject"]
    head = _user(db, "ca.head@premnathrail.com", department="Quality", grants=approve)
    partner = _user(db, "ca.partner@premnathrail.com", is_partner=True, grants=approve)
    req = _user(db, "ca.req@premnathrail.com", department="Quality", reporting_manager_id=head.id)
    db.add(Department(name="Quality", code="QA", head_user_id=head.id))
    db.commit()
    return {"head": head, "partner": partner, "req": req}


def test_routing_conditions_and_completion(db, team):
    r = engine.submit(db, KEY, entity_id=1, requester=team["req"], title="NCR 1", amount=50000)
    assert [s.stage_name for s in r.steps] == ["Department head"]  # partner stage only above 1 lakh
    engine.decide(db, r.id, team["head"], "approve")
    assert r.status == "approved" and decided == [(1, "approved")]

    r2 = engine.submit(db, KEY, entity_id=2, requester=team["req"], title="NCR 2", amount=500000)
    assert [s.stage_name for s in r2.steps] == ["Department head", "Partner"]
    with pytest.raises(HTTPException) as e:
        engine.decide(db, r2.id, team["partner"], "approve")  # not their stage yet
    assert e.value.status_code == 403
    engine.decide(db, r2.id, team["head"], "approve")
    assert r2.status == "pending" and r2.current_sequence == 2
    engine.decide(db, r2.id, team["partner"], "approve")
    assert r2.status == "approved"


def test_reject_needs_comment_and_self_approval_blocked(db, team):
    r = engine.submit(db, KEY, entity_id=3, requester=team["req"], title="NCR 3", amount=10)
    with pytest.raises(HTTPException) as e:
        engine.decide(db, r.id, team["head"], "reject")
    assert e.value.status_code == 422 and "comment" in e.value.detail
    engine.decide(db, r.id, team["head"], "return", "Attach the photos")
    assert r.status == "returned" and decided[-1] == (3, "returned")

    # The head submitting their own NCR: the head stage resolves only to
    # themselves, which four-eyes removes → the submission is refused.
    with pytest.raises(HTTPException) as e:
        engine.submit(db, KEY, entity_id=4, requester=team["head"], title="NCR 4", amount=10)
    assert e.value.status_code == 422 and "Department head" in e.value.detail


def test_permission_required_and_admin_stand_in(db, team):
    team["head"].granular_permissions = []
    team["head"].invalidate_permissions()
    db.commit()
    r = engine.submit(db, KEY, entity_id=5, requester=team["req"], title="NCR 5", amount=10)
    with pytest.raises(HTTPException) as e:
        engine.decide(db, r.id, team["head"], "approve")
    assert "quality:ncr:approve" in e.value.detail
    admin = _user(db, "ca.admin@premnathrail.com", role="admin")
    with pytest.raises(HTTPException):
        engine.decide(db, r.id, admin, "approve")  # stand-in needs a reason
    engine.decide(db, r.id, admin, "approve", "Head on leave, urgent")
    assert r.status == "approved" and r.steps[0].via == "admin"


def test_delegation_and_inbox(db, team):
    deputy = _user(db, "ca.deputy@premnathrail.com", grants=["quality:ncr:approve"])
    db.add(ApprovalDelegation(delegator_id=team["head"].id, delegate_id=deputy.id,
                              start_date=date.today(), end_date=date.today() + timedelta(days=3)))
    db.commit()
    r = engine.submit(db, KEY, entity_id=6, requester=team["req"], title="NCR 6", amount=10)
    assert [x["id"] for x in engine.inbox(db, deputy)] == [r.id]
    engine.decide(db, r.id, deputy, "approve")
    assert r.status == "approved" and r.steps[0].via == "delegation" and r.steps[0].decided_by_id == deputy.id


def test_escalation(db, team):
    wf = engine.ensure_workflow(db, KEY)
    wf.stages[0].escalate_after_hours = 4
    wf.stages[0].escalation_rule = "partner"
    db.commit()
    r = engine.submit(db, KEY, entity_id=7, requester=team["req"], title="NCR 7", amount=10)
    step = r.steps[0]
    step.due_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    assert engine.escalate_overdue(db) == 1
    assert team["partner"].id in step.escalated_to_ids
    engine.decide(db, r.id, team["partner"], "approve")
    assert step.via == "escalation" and r.status == "approved"


def test_central_endpoints(client, db, team):
    r = engine.submit(db, KEY, entity_id=8, requester=team["req"], title="NCR 8", amount=10)
    db.commit()
    inbox = client.get("/api/v1/approvals/inbox", headers=_auth(team["head"])).json()
    assert [x["id"] for x in inbox] == [r.id]
    st = client.get("/api/v1/approvals/entity/test_ncr/8", headers=_auth(team["head"])).json()
    assert st["current"]["can_decide"] is True
    out = client.post(f"/api/v1/approvals/requests/{r.id}/decide", json={"decision": "approve"}, headers=_auth(team["head"]))
    assert out.status_code == 200 and out.json()["status"] == "approved"
    admin = _user(db, "ca.admin2@premnathrail.com", role="admin")
    wf = client.get(f"/api/v1/organization/workflows/{KEY}", headers=_auth(admin)).json()
    assert [s["name"] for s in wf["workflow"]["stages"]] == ["Department head", "Partner"]
    bad = client.put(f"/api/v1/organization/workflows/{KEY}", headers=_auth(admin),
                     json={"stages": [{"name": "X", "approver_rule": "specific_users"}]})
    assert bad.status_code == 422 and "pick at least one user" in bad.json()["detail"]
    pv = client.post(f"/api/v1/organization/workflows/{KEY}/preview", headers=_auth(admin),
                     json={"requester_id": team["req"].id, "context": {"amount": 200000}}).json()
    assert [s["name"] for s in pv["stages"]] == ["Department head", "Partner"]


register_scoped(FinishedProduct, "products", owner=("created_by_id",), label="product")


def test_data_scope(db):
    owner = _user(db, "ds.owner@premnathrail.com", department="Sales")
    peer = _user(db, "ds.peer@premnathrail.com", department="Sales")
    other = _user(db, "ds.other@premnathrail.com", department="Stores")
    for i, u in enumerate((owner, peer, other)):
        db.add(FinishedProduct(code=f"DS-{i}", name=f"P{i}", product_type="machine", created_by_id=u.id))
    role = Role(name="Products – own", permissions=["products:*:*"], data_scopes={"products": "own"})
    db.add(role)
    db.commit()
    owner.roles = [role]
    db.commit()

    assert user_scope(owner, "products") == "own"
    seen = apply_scope(db.query(FinishedProduct), owner, FinishedProduct).all()
    assert [p.code for p in seen] == ["DS-0"]
    with pytest.raises(HTTPException) as e:
        ensure_in_scope(db, owner, db.query(FinishedProduct).filter_by(code="DS-2").one())
    assert e.value.status_code == 403 and "Own records" in e.value.detail

    role.data_scopes = {"products": "department"}
    db.commit()
    assert sorted(p.code for p in apply_scope(db.query(FinishedProduct), owner, FinishedProduct).all()) == ["DS-0", "DS-1"]

    owner.data_access_scopes = {"products": "organization"}  # personal override wins
    db.commit()
    assert len(apply_scope(db.query(FinishedProduct), owner, FinishedProduct).all()) == 3


def test_security_settings_and_sessions(client, db):
    admin = _user(db, "sec.admin@premnathrail.com", role="admin")
    r = client.put("/api/v1/organization/security/settings", headers=_auth(admin), json={"idle_timeout_minutes": 99999})
    assert r.status_code == 422
    r = client.put("/api/v1/organization/security/settings", headers=_auth(admin), json={"max_sessions_per_user": 2})
    assert r.status_code == 200 and r.json()["values"]["max_sessions_per_user"] == 2
    assert client.get("/api/v1/organization/security/sessions", headers=_auth(admin)).status_code == 200
    nobody = _user(db, "sec.user@premnathrail.com")
    assert client.get("/api/v1/organization/security/settings", headers=_auth(nobody)).status_code == 403
