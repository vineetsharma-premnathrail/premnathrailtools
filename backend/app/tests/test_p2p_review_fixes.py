"""P2P review fixes (docs/erp-review): PO approval (now on the central
approval engine), who may see/reject a PR's PO, attachment access/lock, legacy create-po
shortfall ordering.
"""
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.tests.p2p_workflow_helpers import link_items, set_po_workflow, set_pr_workflow

BASE = "/api/v1/p2p/requests"
_seq = count(1)
_PR_ROLE_FLAGS = {"rnd_manager": "is_rnd_manager", "production_manager": "is_production_manager", "store_manager": "is_store_manager"}
_PO_PICKED_ROLES = ("rnd_manager", "purchase_manager", "production_manager")


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


# RBAC (2026-10-08): a Purchase-team user holds the `purchase` desk AND the
# Procurement tabs (p2p) AND Store › GRN & Inspection — the `purchase` app
# alone no longer opens requisitions, RFQs, POs or GRNs.
def _apps(apps):
    apps = list(apps)
    if "purchase" in apps and "p2p" not in apps:
        apps.append("p2p")
    return apps


def _grants(apps):
    if not apps:
        # A named PR / PO approver from another department: their role gives
        # them only 'View' on the two tabs; the routing lets them approve.
        return ["p2p:purchase_requisitions:view", "p2p:purchase_orders:view"]
    return ["store:grn:view", "store:grn:create", "store:grn:approve"] if "purchase" in apps else []


def _user(db, email, apps=("p2p",), **flags):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=_apps(apps), granular_permissions=_grants(apps), department="R&D")
    for k, v in flags.items():
        setattr(u, k, v)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _pr(client, db, po_pick=None, qty=2, partner=False):
    """A PR raised with its approval going to three fresh PR approvers, and
    the "Purchase order" workflow pointed at three fresh PO approvers (plus
    any one Partner when `partner`). Returns (pr_json, pr_approvers,
    po_approvers, requester)."""
    n = next(_seq)
    requester = _user(db, f"rf.req.{n}@premnathrail.com")
    pr_appr = {role: _user(db, f"rf.{role}.{n}@premnathrail.com", apps=(), **{flag: True}) for role, flag in _PR_ROLE_FLAGS.items()}
    po_appr = {role: _user(db, f"rf.po.{role}.{n}@premnathrail.com", apps=()) for role in _PO_PICKED_ROLES}
    po_appr.update(po_pick or {})
    set_pr_workflow(db, [u.id for u in pr_appr.values()], requester)
    set_po_workflow(db, [u.id for u in po_appr.values()], requester, partner=partner)
    r = client.post(BASE, json=link_items(db, {
        "category_code": "RAW", "project_label": "Project Alpha", "project_type": "new", "priority": "medium",
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": qty, "unit": "pcs", "project_inhouse": "Project"}],
    }), headers=_h(requester))
    assert r.status_code == 200, r.text
    return r.json(), pr_appr, po_appr, requester


def _approve_pr(client, pr, pr_appr):
    for u in pr_appr.values():
        a = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked"}, headers=_h(u))
        assert a.status_code == 200, a.text


def _raise_po(client, db, pr, n_suffix=""):
    buyer = _user(db, f"rf.buyer.{pr['id']}{n_suffix}@premnathrail.com", apps=("purchase", "p2p"))
    r = client.post(f"{BASE}/{pr['id']}/create-po", json={
        "po_number": f"PO-RF-{pr['id']}{n_suffix}",
        "item_pricing": [{"pr_item_id": i["id"], "unit_price": 100, "tax_rate": 18} for i in pr["items"]],
    }, headers=_h(buyer))
    assert r.status_code == 200, r.text
    return buyer


def _po_raised(client, db, po_pick=None, partner=False):
    pr, pr_appr, po_appr, requester = _pr(client, db, po_pick, partner=partner)
    _approve_pr(client, pr, pr_appr)
    buyer = _raise_po(client, db, pr)
    return pr, po_appr, requester, buyer


# ── approve_po through the approval engine ────────────────────────────────────────────────

def test_po_approver_listed_twice_signs_once(client, db):
    double = _user(db, f"rf.double.{next(_seq)}@premnathrail.com", apps=())
    pr, po_appr, _, buyer = _po_raised(client, db, {"rnd_manager": double, "production_manager": double})
    r = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "OK"}, headers=_h(double))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "po_raised"
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Again"}, headers=_h(double)).status_code == 403
    final = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "OK"}, headers=_h(po_appr["purchase_manager"]))
    assert final.status_code == 200, final.text
    assert final.json()["status"] == "po_approved"


def test_second_partner_cannot_approve_after_the_final_approval(client, db):
    p1 = _user(db, f"rf.p1.{next(_seq)}@premnathrail.com", apps=(), is_partner=True)
    p2 = _user(db, f"rf.p2.{next(_seq)}@premnathrail.com", apps=(), is_partner=True)
    pr, po_appr, _, _ = _po_raised(client, db, partner=True)
    # The Partner stage opens only after every PO approver has signed.
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Early"}, headers=_h(p1)).status_code == 403
    for u in po_appr.values():
        assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "OK"}, headers=_h(u)).status_code == 200
    first = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "First"}, headers=_h(p1))
    assert first.status_code == 200 and first.json()["status"] == "po_approved"
    assert first.json()["po_approved_by_name"] == p1.name and first.json()["po_approval_comment"] == "First"
    r = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Second"}, headers=_h(p2))
    assert r.status_code == 409


# ── PO reject access ──────────────────────────────────────────

def test_picked_po_approver_without_flag_can_reject_and_po_is_cancelled(client, db):
    pr, po_appr, _, _ = _po_raised(client, db)
    r = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "Wrong vendor"}, headers=_h(po_appr["purchase_manager"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    db.expire_all()
    assert {po.status for po in db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).all()} == {"cancelled"}


def test_manager_flag_holder_who_is_not_an_approver_cannot_reject_the_po(client, db):
    pr, _, _, _ = _po_raised(client, db)
    outsider = _user(db, f"rf.pm.{pr['id']}@premnathrail.com", apps=("p2p",), is_production_manager=True)
    r = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "No"}, headers=_h(outsider))
    assert r.status_code == 403


# ── View access ─────────────────────────────────────────────────────────────

def test_store_manager_flag_alone_does_not_expose_other_prs(client, db):
    pr, _, _, _ = _po_raised(client, db)
    sm = _user(db, f"rf.sm.{pr['id']}@premnathrail.com", apps=("p2p",), is_store_manager=True)
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(sm)).status_code == 403
    assert pr["id"] not in [p["id"] for p in client.get(BASE, headers=_h(sm)).json()]


def test_po_approver_sees_po_lines_and_value(client, db):
    pr, po_appr, _, _ = _po_raised(client, db)
    r = client.get(f"{BASE}/{pr['id']}", headers=_h(po_appr["rnd_manager"]))
    assert r.status_code == 200, r.text
    body = r.json()
    po = body["purchase_order"]
    assert po and po["status"] != "cancelled"
    assert len(po["items"]) == 1 and po["items"][0]["unit_price"] == 100
    assert body["po_value"] == po["total_value"]
    assert body["engine_approval"]["entity_type"] == "p2p_purchase_order" and body["engine_approval"]["can_decide"] is True


# ── Attachments ─────────────────────────────────────────────────────────────

def _attach(db, pr_id, user_id):
    a = P2PRequestAttachment(p2p_request_id=pr_id, doc_type="supporting", filename="spec.pdf",
                             content_type="application/pdf", size=3, sharepoint_path="p2p/spec.pdf", created_by_id=user_id)
    db.add(a)
    db.commit()
    return a


def test_named_pr_approver_can_open_attachment(client, db, monkeypatch):
    pr, pr_appr, _, requester = _pr(client, db)
    att = _attach(db, pr["id"], requester.id)
    monkeypatch.setattr("app.modules.p2p.routes.p2p_requests.settings.SHAREPOINT_SITE_ID", "site")

    async def _fake_download(site, path):
        return b"pdf", "application/pdf"
    monkeypatch.setattr("app.modules.p2p.routes.p2p_requests.download_file_content", _fake_download)
    r = client.get(f"{BASE}/{pr['id']}/attachments/{att.id}/content", headers=_h(pr_appr["store_manager"]))
    assert r.status_code == 200, r.text
    assert r.content == b"pdf"


def test_requester_cannot_delete_attachment_after_approval(client, db):
    pr, pr_appr, _, requester = _pr(client, db)
    att = _attach(db, pr["id"], requester.id)
    _approve_pr(client, pr, pr_appr)
    r = client.delete(f"{BASE}/{pr['id']}/attachments/{att.id}", headers=_h(requester))
    assert r.status_code == 409
    assert "ask Purchase" in r.json()["detail"]


def test_attachment_delete_is_audited(client, db):
    pr, _, _, requester = _pr(client, db)
    att = _attach(db, pr["id"], requester.id)
    r = client.delete(f"{BASE}/{pr['id']}/attachments/{att.id}", headers=_h(requester))
    assert r.status_code == 200, r.text
    assert db.query(AuditLog).filter_by(entity_type="p2p_request", entity_id=pr["id"], action="attachment_deleted").count() == 1


# ── Legacy create-po orders only the shortfall ──────────────────────────────

def test_legacy_create_po_orders_only_the_unissued_shortfall(client, db):
    pr, pr_appr, _, _ = _pr(client, db, qty=5)
    _approve_pr(client, pr, pr_appr)
    line = db.query(P2PRequestItem).filter_by(p2p_request_id=pr["id"]).one()
    line.issued_qty = 2
    line.fulfillment_status = "sent_to_procurement"
    db.commit()
    _raise_po(client, db, pr)
    db.expire_all()
    po = db.query(P2PPurchaseOrder).filter_by(p2p_request_id=pr["id"]).one()
    assert [i.quantity for i in po.items] == [3]
