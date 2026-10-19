"""Quality on the central authorization framework: NCR disposition routing
by disposition (incl. the scrap-over-limit Partner stage), the legacy
in-flight path, inspection plan submit → approve, vendor block → Partner,
and data scope on Quality records."""
import pytest

from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.quality.models.ncr import QualityNcr, QualityNcrApproval
from app.modules.quality.models.supplier_quality import QualityApprovedVendor
from app.modules.quality.services import authz
from app.tests.test_quality_phase1 import Q, hdr, make_user, setup_item

A = "/api/v1/approvals"


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


@pytest.fixture
def people(db):
    if not hasattr(User, "is_partner"):
        pytest.skip("User.is_partner not in this tree")
    return {
        "eng": make_user(db, "ca.eng@x.com", quality_role="engineer"),
        "eng2": make_user(db, "ca.eng2@x.com", quality_role="engineer"),
        "head": make_user(db, "ca.head@x.com", quality_role="head"),
        "partner": make_user(db, "ca.partner@x.com", is_partner=True),
        "designer": make_user(db, "ca.design@x.com", granular_permissions=["design:reviews:approve", "design:dashboard:view"]),
        "buyer": make_user(db, "ca.buyer@x.com", is_purchase_head=True),
    }


def _ncr(client, db, user, cost=1000.0, qty=10, vendor="Acme Castings"):
    item, _loc = setup_item(db, name=f"Part {cost:g}", cost=cost)
    r = client.post(f"{Q}/ncr", json={"source": "internal", "severity": "minor", "item_id": item.id, "quantity": qty,
                                      "vendor_name": vendor, "description": "Burr on edge"}, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _codes(client, user):
    return {c["disposition_type"]: c for c in client.get(f"{Q}/masters/disposition-codes", headers=hdr(user)).json()}


def _propose(client, ncr_id, code, user, **extra):
    r = client.post(f"{Q}/ncr/{ncr_id}/propose-disposition", json={"disposition_code_id": code["id"], **extra}, headers=hdr(user))
    assert r.status_code == 200, r.text
    return r.json()


def _request(db, ncr_id):
    db.expire_all()
    return engine.latest_request(db, authz.NCR_ENTITY, ncr_id)


def _decide(client, req_id, user, decision="approve", comment=None):
    return client.post(f"{A}/requests/{req_id}/decide", json={"decision": decision, "comment": comment}, headers=hdr(user))


def test_scrap_over_limit_needs_quality_head_then_partner(client, db, people):
    ncr = _ncr(client, db, people["eng"], cost=10000)  # 10 × ₹10,000 = ₹1,00,000 > ₹50,000
    body = _propose(client, ncr["id"], _codes(client, people["eng"])["scrap"], people["eng"])
    assert body["disposition_status"] == "pending_approval"
    assert body["pending_roles"] == ["quality_head", "partner"] and not body["legacy_approval"]
    assert body["scrap_value_limit"] == 50000
    req = _request(db, ncr["id"])
    assert [s.stage_name for s in req.steps if s.approver_id] == ["Quality head", "Partner"]

    assert _decide(client, req.id, people["partner"]).status_code == 403  # not their stage yet
    assert _decide(client, req.id, people["head"]).status_code == 200
    assert client.get(f"{Q}/ncr/{ncr['id']}", headers=hdr(people["eng"])).json()["pending_roles"] == ["partner"]
    assert _decide(client, req.id, people["partner"]).status_code == 200

    db.expire_all()
    n = db.get(QualityNcr, ncr["id"])
    assert (n.status, n.disposition_status) == ("disposition_decided", "approved")
    signed = {(a.role, a.approved_by_id) for a in db.query(QualityNcrApproval).filter_by(ncr_id=n.id).all()}
    assert signed == {("quality_head", people["head"].id), ("partner", people["partner"].id)}


def test_scrap_under_limit_needs_only_quality_head(client, db, people):
    ncr = _ncr(client, db, people["eng"], cost=100)  # ₹1,000
    body = _propose(client, ncr["id"], _codes(client, people["eng"])["scrap"], people["eng"])
    assert body["pending_roles"] == ["quality_head"]
    assert _decide(client, _request(db, ncr["id"]).id, people["head"]).status_code == 200
    db.expire_all()
    assert db.get(QualityNcr, ncr["id"]).status == "disposition_decided"


def test_partner_limit_is_the_workflow_condition(client, db, people):
    wf = authz.ensure_ncr_workflow(db)
    partner_stage = next(s for s in wf.stages if s.name == "Partner")
    partner_stage.conditions = [{"field": "disposition_type", "op": "eq", "value": "scrap"},
                                {"field": "scrap_value", "op": "gt", "value": 500}]
    db.commit()
    ncr = _ncr(client, db, people["eng"], cost=100)  # ₹1,000 > ₹500
    body = _propose(client, ncr["id"], _codes(client, people["eng"])["scrap"], people["eng"])
    assert body["pending_roles"] == ["quality_head", "partner"] and body["scrap_value_limit"] == 500


@pytest.mark.parametrize("disposition,roles", [
    ("rework", ["quality_engineer"]),
    ("return_to_vendor", ["quality_engineer", "purchase"]),
    ("use_as_is", ["quality_head", "design"]),
    ("repair", ["quality_head", "design"]),
])
def test_disposition_role_table(client, db, people, disposition, roles):
    ncr = _ncr(client, db, people["eng"])
    body = _propose(client, ncr["id"], _codes(client, people["eng"])[disposition], people["eng"])
    assert body["pending_roles"] == roles and body["required_roles"] == roles
    req = _request(db, ncr["id"])
    approvers = {"quality_engineer": people["eng2"], "quality_head": people["head"], "design": people["designer"],
                 "purchase": people["buyer"]}
    for role in roles:
        r = _decide(client, req.id, approvers[role])
        assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(QualityNcr, ncr["id"]).status == "disposition_decided"


def test_one_person_signs_one_stage_and_reject_reopens_proposal(client, db, people):
    both = make_user(db, "ca.headdesign@x.com", quality_role="head")
    both.granular_permissions = list(both.granular_permissions or []) + ["design:reviews:approve"]
    both.invalidate_permissions()
    db.commit()
    ncr = _ncr(client, db, people["eng"])
    _propose(client, ncr["id"], _codes(client, people["eng"])["use_as_is"], people["eng"])
    req = _request(db, ncr["id"])
    assert _decide(client, req.id, both).status_code == 200  # as Quality head
    r = _decide(client, req.id, both)  # again, as Design
    assert r.status_code == 403 and "earlier stage" in r.json()["detail"]
    assert _decide(client, req.id, people["designer"], "reject").status_code == 422  # comment required
    assert _decide(client, req.id, people["designer"], "reject", "Not acceptable for the bogie frame").status_code == 200
    db.expire_all()
    n = db.get(QualityNcr, ncr["id"])
    assert (n.status, n.disposition_status) == ("open", "none")


def test_reproposal_withdraws_the_open_request(client, db, people):
    ncr = _ncr(client, db, people["eng"])
    codes = _codes(client, people["eng"])
    _propose(client, ncr["id"], codes["use_as_is"], people["eng"])
    first = _request(db, ncr["id"])
    _propose(client, ncr["id"], codes["rework"], people["eng"])
    db.expire_all()
    assert first.status == "cancelled" and _request(db, ncr["id"]).id != first.id


def test_customer_approval_reference_needed_at_proposal(client, db, people):
    ncr = _ncr(client, db, people["eng"])
    r = client.post(f"{Q}/ncr/{ncr['id']}/propose-disposition", headers=hdr(people["eng"]),
                    json={"disposition_code_id": _codes(client, people["eng"])["use_as_is"]["id"], "customer_approval_required": True})
    assert r.status_code == 422 and "customer" in r.json()["detail"]


def test_legacy_in_flight_disposition_finishes_on_old_path(client, db, people):
    ncr = _ncr(client, db, people["eng"])
    n = db.get(QualityNcr, ncr["id"])
    n.disposition_type, n.disposition_status = "rework", "pending_approval"  # proposed before the engine
    db.commit()
    body = client.get(f"{Q}/ncr/{n.id}", headers=hdr(people["eng"])).json()
    assert body["legacy_approval"] and body["pending_roles"] == ["quality_engineer"]
    r = client.post(f"{Q}/ncr/{n.id}/approve-disposition", json={"role": "quality_engineer"}, headers=hdr(people["eng2"]))
    assert r.status_code == 200 and r.json()["status"] == "disposition_decided"
    assert _request(db, n.id) is None


def test_ncr_cannot_be_cancelled_while_waiting_for_approval(client, db, people):
    ncr = _ncr(client, db, people["eng"])
    _propose(client, ncr["id"], _codes(client, people["eng"])["rework"], people["eng"])
    r = client.post(f"{Q}/ncr/{ncr['id']}/cancel", json={"reason": "Duplicate"}, headers=hdr(people["head"]))
    assert r.status_code == 409 and "Withdraw" in r.json()["detail"]


def test_inspection_plan_submit_then_approve(client, db, people):
    from app.tests.test_quality_phase1 import QualityCharacteristic
    item, _ = setup_item(db, name="Axle box")
    ch = QualityCharacteristic(code="VIS-CA", name="Visual", char_type="attribute", classification="minor")
    db.add(ch)
    db.commit()
    plan = client.post(f"{Q}/inspection-plans", json={"item_id": item.id, "inspection_type": "incoming", "sampling_type": "full",
                                                      "lines": [{"characteristic_id": ch.id}]}, headers=hdr(people["eng"])).json()
    r = client.post(f"{Q}/inspection-plans/{plan['id']}/submit", headers=hdr(people["eng"]))
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"
    assert client.patch(f"{Q}/inspection-plans/{plan['id']}", json={"title": "x"}, headers=hdr(people["eng"])).status_code == 409
    req = engine.latest_request(db, authz.PLAN_ENTITY, plan["id"])
    assert _decide(client, req.id, people["head"], "return", "Add the hardness check").status_code == 200
    assert client.get(f"{Q}/inspection-plans/{plan['id']}", headers=hdr(people["eng"])).json()["status"] == "draft"
    client.post(f"{Q}/inspection-plans/{plan['id']}/submit", headers=hdr(people["eng"]))
    req = engine.latest_request(db, authz.PLAN_ENTITY, plan["id"])
    assert req.revision == 2 and _decide(client, req.id, people["head"]).status_code == 200
    assert client.get(f"{Q}/inspection-plans/{plan['id']}", headers=hdr(people["eng"])).json()["status"] == "approved"


def test_vendor_block_goes_to_a_partner(client, db, people):
    item, _ = setup_item(db, name="Brake shoe")
    avl = QualityApprovedVendor(item_id=item.id, vendor_name="Acme Castings", vendor_key="acme castings", status="approved")
    db.add(avl)
    db.commit()
    r = client.post(f"{Q}/supplier-quality/avl/{avl.id}/request-block", json={"reason": "Three rejected lots"}, headers=hdr(people["head"]))
    assert r.status_code == 200 and r.json()["pending_action"] == "block"
    req = engine.latest_request(db, authz.AVL_ENTITY, avl.id)
    assert [s.approver_id for s in req.steps] == [people["partner"].id]
    assert _decide(client, req.id, people["head"]).status_code == 403
    assert _decide(client, req.id, people["partner"]).status_code == 200
    db.expire_all()
    a = db.get(QualityApprovedVendor, avl.id)
    assert a.status == "blocked" and a.pending_action is None


def test_ncr_data_scope_own(client, db, people):
    mine = _ncr(client, db, people["eng"])
    theirs = _ncr(client, db, people["eng2"])
    role = Role(name="Quality – own records", permissions=["quality:*:*"], data_scopes={"quality": "own"})
    db.add(role)
    db.commit()
    people["eng"].roles = [role]
    db.commit()
    seen = [n["id"] for n in client.get(f"{Q}/ncr", headers=hdr(people["eng"])).json()]
    assert seen == [mine["id"]]
    r = client.get(f"{Q}/ncr/{theirs['id']}", headers=hdr(people["eng"]))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.get(f"{Q}/dashboard", headers=hdr(people["eng"])).json()["kpis"]["open_ncrs"] == 1
