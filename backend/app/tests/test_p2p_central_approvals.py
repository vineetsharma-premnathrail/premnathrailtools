"""Procurement on the central authorization framework (2026-10-08):
requisition and PO approval through the approval engine (p2p/approvals.py),
in-flight items finishing on the old path, workflow seeding from the old
Settings, and the Procurement data scope (p2p/access.py)."""
from datetime import date
from itertools import count

import pytest
from sqlalchemy.orm import object_session

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p.approvals import PO_KEY, PR_KEY, migrate_p2p_approval_workflows
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.tests.p2p_po_helpers import post_upload_po, rfq_for_pr, upload_po_details
from app.tests.p2p_workflow_helpers import master_item
from app.tests.p2p_workflow_helpers import set_po_workflow, set_pr_workflow

BASE = "/api/v1/p2p/requests"
_seq = count(1)
APPROVER = ["p2p:purchase_requisitions:view", "p2p:purchase_orders:view"]
REQUESTER = ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:create", "p2p:purchase_requisitions:submit",
             "p2p:purchase_requisitions:cancel"]
BUYER = ["purchase:desk:view", "p2p:purchase_requisitions:view", "p2p:purchase_requisitions:edit", "p2p:rfq:view",
         "p2p:purchase_orders:view", "p2p:purchase_orders:create", "p2p:purchase_orders:submit", "store:grn:view",
         "p2p:purchase_orders.po_document:view", "p2p:purchase_orders.po_document:create"]  # Upload PO needs the PO document feature


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def _user(db, grants=(), role="user", **kw):
    n = next(_seq)
    u = User(email=f"ca.p2p{n}@premnathrail.com", name=f"cap2p{n}", role=role, is_active=True,
             granular_permissions=list(grants), department=kw.pop("department", "R&D"), **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _raise(client, user):
    r = client.post(BASE, json={"category_code": "RAW", "project_label": "RRV-7", "project_type": "existing", "priority": "standard",
                                "items": [{"store_item_id": master_item(object_session(user), "Gear box", uom="Nos").id,
                                           "quantity": 2, "project_inhouse": "Project"}]},
                    headers=_h(user))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def team(db):
    t = {"requester": _user(db, REQUESTER), "a1": _user(db, APPROVER), "a2": _user(db, APPROVER),
         "po1": _user(db, APPROVER), "buyer": _user(db, BUYER), "partner": _user(db, APPROVER, is_partner=True),
         "admin": _user(db, role="admin")}
    set_pr_workflow(db, [t["a1"].id, t["a2"].id], t["admin"])
    set_po_workflow(db, [t["po1"].id], t["admin"], partner=True)
    return t


def _approved(client, team):
    pr = _raise(client, team["requester"])
    for a in ("a1", "a2"):
        assert client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "ok"}, headers=_h(team[a])).status_code == 200
    return pr


def _po(client, team, pr):
    """The buyer uploads the Tally PO on the approved requisition (the PO goes into approval)."""
    db = object_session(team["buyer"])
    rfq = rfq_for_pr(db, pr["id"], team["buyer"].id)
    r = post_upload_po(client, team["buyer"], rfq.id, upload_po_details(db, pr["id"], unit_price=10, tax_rate=None),
                       f"PO-CA-{pr['id']}")
    assert r.status_code == 200, r.text
    return client.get(f"{BASE}/{pr['id']}", headers=_h(team["buyer"])).json()


# ── PR: submit → decide → status ────────────────────────────────────────────

def test_pr_submit_decide_through_central_endpoint(client, db, team):
    pr = _raise(client, team["requester"])
    assert pr["status"] == "submitted" and pr["approval_scheme"] == "engine"
    req = engine.latest_request(db, "p2p_request", pr["id"])
    assert req.workflow_key == PR_KEY and {s.approver_id for s in req.steps} == {team["a1"].id, team["a2"].id}
    # The approver's list row carries what the inline Approve needs.
    row = next(p for p in client.get(BASE, params={"queue": "pr-approval"}, headers=_h(team["a1"])).json() if p["id"] == pr["id"])
    assert row["engine_approval"]["can_decide"] is True and row["engine_approval"]["request_id"] == req.id
    for a in ("a1", "a2"):
        r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "approve", "comment": "OK"}, headers=_h(team[a]))
        assert r.status_code == 200, r.text
    body = client.get(f"{BASE}/{pr['id']}", headers=_h(team["requester"])).json()
    assert body["status"] == "approved" and body["approved_by_id"] == team["a2"].id
    assert body["items"][0]["fulfillment_status"] == "sent_to_procurement"  # lines routed on approval


def test_pr_return_resubmit_and_reject(client, db, team):
    pr = _raise(client, team["requester"])
    req = engine.latest_request(db, "p2p_request", pr["id"])
    r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "return", "comment": "Add the drawing"},
                    headers=_h(team["a1"]))
    assert r.status_code == 200, r.text
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(team["requester"])).json()["status"] == "returned"
    # Resubmitting needs 'Submit' and is a new revision.
    viewer = _user(db, ["p2p:purchase_requisitions:view"])
    assert client.post(f"{BASE}/{pr['id']}/submit", headers=_h(viewer)).status_code == 403
    again = client.post(f"{BASE}/{pr['id']}/submit", headers=_h(team["requester"]))
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "submitted"
    assert engine.latest_request(db, "p2p_request", pr["id"]).revision == 2
    rej = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "Not budgeted"}, headers=_h(team["a2"]))
    assert rej.status_code == 200 and rej.json()["status"] == "rejected" and rej.json()["rejected_reason"] == "Not budgeted"


def test_cancelling_a_pending_pr_withdraws_its_approval(client, db, team):
    pr = _raise(client, team["requester"])
    r = client.post(f"{BASE}/{pr['id']}/cancel", json={"reason": "Duplicate"}, headers=_h(team["requester"]))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert engine.latest_request(db, "p2p_request", pr["id"]).status == "cancelled"
    assert engine.inbox(db, team["a1"]) == []


# ── PO: submit → decide → status ────────────────────────────────────────────

def test_po_submit_decide_two_stages(client, db, team):
    pr = _approved(client, team)
    raised = _po(client, team, pr)
    assert raised["status"] == "po_raised"
    po = db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).one()
    req = engine.latest_request(db, "p2p_purchase_order", po.id)
    assert req.workflow_key == PO_KEY and req.amount == po.total_value
    # The approval link opens the requisition.
    assert client.get(f"{BASE}/by-po/{po.id}", headers=_h(team["po1"])).json()["id"] == pr["id"]
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "ok"}, headers=_h(team["partner"])).status_code == 403
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "ok"}, headers=_h(team["po1"])).json()["status"] == "po_raised"
    final = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "approve", "comment": "OK"}, headers=_h(team["partner"]))
    assert final.status_code == 200, final.text
    body = client.get(f"{BASE}/{pr['id']}", headers=_h(team["buyer"])).json()
    assert body["status"] == "po_approved" and body["po_approved_by_name"] == team["partner"].name
    assert body["pending_po_approval_roles"] == []  # GRN is no longer blocked


def test_po_reject_cancels_po_and_return_reopens_the_draft(client, db, team):
    pr = _approved(client, team)
    _po(client, team, pr)
    po = db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).one()
    req = engine.latest_request(db, "p2p_purchase_order", po.id)
    r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "return", "comment": "Fix the rate"},
                    headers=_h(team["po1"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(P2PPurchaseOrder, po.id).status == "draft" and db.get(P2PRequest, pr["id"]).status == "po_drafted"

    pr2 = _approved(client, team)
    _po(client, team, pr2)
    r = client.post(f"{BASE}/{pr2['id']}/reject", json={"reason": "Wrong vendor"}, headers=_h(team["po1"]))
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    db.expire_all()
    assert {p.status for p in db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr2["id"])} == {"cancelled"}


# ── In-flight items keep the old path ───────────────────────────────────────

def test_inflight_settings_scheme_pr_finishes_on_the_old_path(client, db, team):
    pr = P2PRequest(p2p_number="P2P-RAW-2026-0901", category_code="RAW", project_type="existing", approval_scheme="settings",
                    request_date=date.today(), requested_by_id=team["requester"].id, status="submitted", project_label="Old")
    db.add(pr)
    db.flush()
    db.add(P2PRequestItem(p2p_request_id=pr.id, item_name="Bolt", quantity=1, project_inhouse="Project"))
    db.add(P2PRequestApproval(p2p_request_id=pr.id, role="pr_approver_1", approver_id=team["a1"].id, approver_name="A1"))
    db.commit()
    assert engine.latest_request(db, "p2p_request", pr.id) is None
    r = client.post(f"{BASE}/{pr.id}/approve", json={"comment": "old path"}, headers=_h(team["a1"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["approvals"][0]["approved_at"]
    assert engine.latest_request(db, "p2p_request", pr.id) is None


# ── Seeding from the old Procurement › Settings ─────────────────────────────

def test_migration_seeds_workflows_from_old_settings(db):
    a, b, p = _user(db), _user(db), _user(db)
    db.add_all([ModuleSetting(module_key="p2p", key="pr_approvers", value=[a.id, b.id]),
                ModuleSetting(module_key="p2p", key="po_approvers", value=[p.id])])
    db.commit()
    migrate_p2p_approval_workflows(db.connection())
    migrate_p2p_approval_workflows(db.connection())  # idempotent
    db.expire_all()
    pr_wf = db.query(ApprovalWorkflow).filter_by(key=PR_KEY).one()
    assert [(s.approver_rule, s.rule_config["user_ids"], s.approval_mode) for s in pr_wf.stages] == [("specific_users", [a.id, b.id], "all")]
    po_wf = db.query(ApprovalWorkflow).filter_by(key=PO_KEY).one()
    assert [s.approver_rule for s in po_wf.stages] == ["specific_users", "partner"]
    assert po_wf.distinct_approvers is True and po_wf.allow_self_approval is False


def test_settings_no_longer_hold_approvers(client, db):
    admin = _user(db, role="admin")
    keys = {s["key"] for s in client.get("/api/v1/p2p/settings", headers=_h(admin)).json()["specs"]}
    assert "pr_approvers" not in keys and "po_approvers" not in keys and "company_terms" in keys
    flow = client.get("/api/v1/p2p/approval-flow", headers=_h(admin)).json()
    assert set(flow) == {"pr", "po"}


# ── Data scope ──────────────────────────────────────────────────────────────

def test_own_scope_limits_requisitions_but_approvers_still_see_theirs(client, db, team):
    role = Role(name="Procurement – own", permissions=REQUESTER + ["p2p:purchase_orders:view"],
                data_scopes={"p2p": "own"})
    db.add(role)
    db.commit()
    mine_user = _user(db)
    mine_user.roles = [role]
    team["a1"].roles = [role]
    db.commit()
    other = _raise(client, team["requester"])  # a1 approves this one
    mine = _raise(client, mine_user)

    seen = [p["id"] for p in client.get(BASE, headers=_h(mine_user)).json()]
    assert mine["id"] in seen and other["id"] not in seen
    r = client.get(f"{BASE}/{other['id']}", headers=_h(mine_user))
    assert r.status_code == 403
    # The approver (also 'own' scope) still opens what they approve.
    assert client.get(f"{BASE}/{other['id']}", headers=_h(team["a1"])).status_code == 200
