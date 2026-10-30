"""Procurement RBAC (2026-10-08): the Permission Matrix gates every
Procurement action (deny by default), approver routing still decides who
approves, and the company delete rule (Delete grant + own record) applies.

Users here are built WITHOUT assigned_apps, so they get the real
roles + deny-by-default behaviour (see conftest)."""
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment
from sqlalchemy.orm import object_session

from app.tests.p2p_workflow_helpers import link_items, set_pr_workflow

BASE = "/api/v1/p2p/requests"
_seq = count(1)

VIEW_ONLY = ["p2p:purchase_requisitions:view"]
REQUESTER = ["p2p:purchase_requisitions:view", "p2p:purchase_requisitions:create",
             "p2p:purchase_requisitions:edit", "p2p:purchase_requisitions:delete",
             "p2p:purchase_requisitions:submit", "p2p:purchase_requisitions:cancel"]


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    from app.modules.p2p import service
    monkeypatch.setattr(service, "_lock_number_series", lambda db, prefix: None)


def _user(db, grants=(), role="user", apps=(), **flags):
    n = next(_seq)
    u = User(email=f"rbac.p2p{n}@premnathrail.com", name=f"rbac{n}", role=role, is_active=True,
             assigned_apps=list(apps), granular_permissions=list(grants), department="R&D")
    for k, v in flags.items():
        setattr(u, k, v)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _settings(client, db, approver):
    # The admin points the "Purchase requisition" approval workflow at them.
    set_pr_workflow(db, [approver.id], _user(db, role="admin"))


def _create(client, user):
    body = {"category_code": "RAW", "project_label": "Project Alpha", "project_type": "new", "priority": "standard",
            "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs", "project_inhouse": "Project"}]}
    return client.post(BASE, json=link_items(object_session(user), body), headers=_h(user))


def test_view_only_user_cannot_create_edit_or_cancel(client, db):
    approver = _user(db, VIEW_ONLY)
    _settings(client, db, approver)
    viewer = _user(db, VIEW_ONLY, apps=())
    r = _create(client, viewer)
    assert r.status_code == 403 and "'create' permission" in r.json()["detail"].lower()

    requester = _user(db, REQUESTER)
    pr = _create(client, requester).json()
    # Cancelling needs 'Cancel'.
    r = client.post(f"{BASE}/{pr['id']}/cancel", json={"reason": "x"}, headers=_h(viewer))
    assert r.status_code == 403 and "'cancel' permission" in r.json()["detail"].lower()
    # Export needs 'Export'.
    assert client.get(f"{BASE}/export", headers=_h(viewer)).status_code == 403


def test_no_view_grant_means_no_access_even_when_named_approver(client, db):
    approver = _user(db, ["store:items:view"])  # named in Settings, but no Procurement View grant
    _settings(client, db, approver)
    requester = _user(db, REQUESTER)
    pr = _create(client, requester).json()
    r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "ok"}, headers=_h(approver))
    assert r.status_code == 403 and "Purchase Requisitions" in r.json()["detail"]


def test_named_approver_approves_with_view_only(client, db):
    # Routing decides who approves — no 'Approve' box needed (see p2p_requests.py RBAC note).
    approver = _user(db, VIEW_ONLY)
    _settings(client, db, approver)
    pr = _create(client, _user(db, REQUESTER)).json()
    r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "ok"}, headers=_h(approver))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    # …but a View-only user who is NOT the named approver still can't.
    other = _user(db, VIEW_ONLY)
    pr2 = _create(client, _user(db, REQUESTER)).json()
    assert client.post(f"{BASE}/{pr2['id']}/approve", json={"comment": "ok"}, headers=_h(other)).status_code == 403


def _attachment(db, pr_id, owner_id):
    a = P2PRequestAttachment(p2p_request_id=pr_id, doc_type="supporting", filename="spec.pdf", content_type="application/pdf",
                             size=10, sharepoint_path="x/spec.pdf", created_by_id=owner_id)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def test_delete_needs_grant_and_own_record(client, db):
    approver = _user(db, VIEW_ONLY)
    _settings(client, db, approver)
    owner = _user(db, REQUESTER)
    pr = _create(client, owner).json()
    mine = _attachment(db, pr["id"], owner.id)

    # A Purchase-team member holding 'Delete' can't remove someone else's file.
    other = _user(db, REQUESTER + ["purchase:desk:view"])
    r = client.delete(f"{BASE}/{pr['id']}/attachments/{mine.id}", headers=_h(other))
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]

    # A user without the 'Delete' grant can't either.
    no_delete = _user(db, ["p2p:purchase_requisitions:view", "purchase:desk:view"])
    r = client.delete(f"{BASE}/{pr['id']}/attachments/{mine.id}", headers=_h(no_delete))
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()

    # The uploader with 'Delete' can.
    assert client.delete(f"{BASE}/{pr['id']}/attachments/{mine.id}", headers=_h(owner)).status_code == 200


def test_vendor_writes_need_vendor_tab_actions(client, db):
    viewer = _user(db, ["p2p:vendors:view"])
    assert client.get("/api/v1/p2p/vendors", headers=_h(viewer)).status_code == 200
    r = client.post("/api/v1/p2p/vendors", json={"name": "Shree Hydraulics"}, headers=_h(viewer))
    assert r.status_code == 403 and "'create' permission" in r.json()["detail"].lower()
    assert client.get("/api/v1/p2p/vendors/export", headers=_h(viewer)).status_code == 403

    creator = _user(db, ["p2p:vendors:view", "p2p:vendors:create"])
    r = client.post("/api/v1/p2p/vendors", json={"name": "Shree Hydraulics"}, headers=_h(creator))
    assert r.status_code == 201, r.text
    r = client.patch(f"/api/v1/p2p/vendors/{r.json()['id']}", json={"city": "Pune"}, headers=_h(creator))
    assert r.status_code == 403 and "'edit' permission" in r.json()["detail"].lower()


def test_rfq_and_po_tabs_are_gated(client, db):
    # Purchase desk alone (purchase:desk:view) no longer opens RFQs / POs.
    desk_only = _user(db, ["purchase:desk:view"])
    assert client.get("/api/v1/p2p/rfqs", headers=_h(desk_only)).status_code == 403
    assert client.get("/api/v1/p2p/purchase-orders", headers=_h(desk_only)).status_code == 403
    buyer = _user(db, ["purchase:desk:view", "p2p:rfq:view", "p2p:purchase_orders:view"])
    assert client.get("/api/v1/p2p/rfqs", headers=_h(buyer)).status_code == 200
    assert client.get("/api/v1/p2p/purchase-orders", headers=_h(buyer)).status_code == 200
    # MIS needs its own tab.
    assert client.get("/api/v1/p2p/mis/summary", headers=_h(buyer)).status_code == 403
