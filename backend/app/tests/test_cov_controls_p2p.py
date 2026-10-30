"""ERP review controls for P2P (docs/erp-review/05-summary-and-roadmap.md):

  C-02  approval control  — a requester can't approve their own PR
  C-03  approval control  — PR/PO PATCH can't move status or swap approvers
  C-04  financial control — a PO can't go for approval without line prices

A control the code does NOT enforce yet keeps its test, marked
xfail(strict=True) with the reason "OPEN: C-0x ...", so the test starts
failing (XPASS) the day the fix lands and the marker must be removed.
"""
from app.tests.p2p_workflow_helpers import attach_tally_po
from datetime import date
from itertools import count

import pytest
from sqlalchemy.orm import object_session

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.tests.p2p_po_helpers import post_upload_po, rfq_for_pr, upload_po_details, upload_po_for_pr
from app.tests.p2p_workflow_helpers import link_items, set_po_workflow, set_pr_workflow

BASE = "/api/v1/p2p/requests"
PO_BASE = "/api/v1/p2p/purchase-orders"
_seq = count(1)

_PR_ROLE_FLAGS = {"rnd_manager": "is_rnd_manager", "production_manager": "is_production_manager", "store_manager": "is_store_manager"}
_PO_PICKED_ROLES = ("rnd_manager", "purchase_manager", "production_manager")


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    # Postgres advisory lock — a no-op is exact for single-threaded SQLite tests.
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


def _fresh_approvers(db):
    n = next(_seq)
    pr = {role: _user(db, f"cov.{role}.{n}@premnathrail.com", **{flag: True}) for role, flag in _PR_ROLE_FLAGS.items()}
    po = {role: _user(db, f"cov.po.{role}.{n}@premnathrail.com") for role in _PO_PICKED_ROLES}
    return pr, po


def _payload(pr_approvers, po_approvers, **over):
    body = {
        "category_code": "RAW", "project_label": "Project Alpha", "project_type": "new", "priority": "standard",
        "approvers": {r: u.id if isinstance(u, User) else u for r, u in pr_approvers.items()},
        "po_approvers": {r: u.id if isinstance(u, User) else u for r, u in po_approvers.items()},
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs", "project_inhouse": "Project"}],
    }
    body.update(over)
    return body


def _create_pr(client, requester):
    """Raise a PR whose approval goes to three fresh approvers (all must), with
    the PO workflow pointed at three fresh PO approvers."""
    db = object_session(requester)
    pr_appr, po_appr = _fresh_approvers(db)
    set_pr_workflow(db, [u.id for u in pr_appr.values()], requester)
    set_po_workflow(db, [u.id for u in po_appr.values()], requester)
    r = client.post(BASE, json=link_items(db, _payload({}, {})), headers=_h(requester))
    assert r.status_code == 200, r.text
    pr = r.json()
    pr["_approvers"], pr["_po_approvers"] = pr_appr, po_appr
    return pr


def _approve_pr(client, pr):
    for approver in pr["_approvers"].values():
        r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked"}, headers=_h(approver))
        assert r.status_code == 200, r.text


def _raise_po(client, pr, buyer, po_number):
    """Approve the PR, then upload the Tally PO on it (priced 100 + 18% a unit); returns the PR."""
    _approve_pr(client, pr)
    upload_po_for_pr(client, object_session(buyer), pr["id"], buyer, tally_po_no=po_number)
    return client.get(f"{BASE}/{pr['id']}", headers=_h(buyer)).json()


# ── C-02 Approval control: no self-approval of requisitions ─────────────────

def test_c02_pr_with_nobody_to_approve_is_refused_with_the_reason(client, db):
    requester = _user(db, "c02.req1@premnathrail.com")
    gone = _user(db, "c02.gone1@premnathrail.com")
    set_pr_workflow(db, [gone.id], requester)
    gone.is_active = False
    db.commit()
    r = client.post(BASE, json=link_items(db, _payload({}, {})), headers=_h(requester))
    assert r.status_code == 422
    assert "PR approvers" in r.json()["detail"] and "Workflows" in r.json()["detail"]


def test_c02_requester_not_named_cannot_approve_own_pr(client, db):
    requester = _user(db, "c02.req2@premnathrail.com")
    pr = _create_pr(client, requester)
    r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "self"}, headers=_h(requester))
    assert r.status_code == 403
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(requester)).json()["status"] == "submitted"


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-02 an admin can stand in on their OWN requisition — "
    "app/modules/organization/services/approval_engine.py decide() skips the four-eyes check for via='admin'"))
def test_c02_admin_override_never_applies_to_own_pr(client, db):
    admin = _user(db, "c02.admin@premnathrail.com")
    admin.role = "admin"
    db.commit()
    pr = _create_pr(client, admin)
    r = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "override"}, headers=_h(admin))
    assert r.status_code == 403


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-02 a requester who is one of the PR approvers can sign their own requisition — "
    "app/modules/p2p/approvals.py registers p2p.purchase_requisition with allow_self_approval=True "
    "(today's Settings-scheme behaviour, kept as the default; switch it off in Organization › Approval Workflows)"))
def test_c02_requester_cannot_self_approve_a_slot_they_hold(client, db):
    requester = _user(db, "c02.req4@premnathrail.com")
    other = _user(db, "c02.other4@premnathrail.com")
    set_pr_workflow(db, [requester.id, other.id], requester)
    created = client.post(BASE, json=link_items(db, _payload({}, {})), headers=_h(requester))
    assert created.status_code == 200, created.text
    r = client.post(f"{BASE}/{created.json()['id']}/approve", json={"comment": "self"}, headers=_h(requester))
    assert r.status_code == 403


def test_c02_po_creator_cannot_approve_own_po(client, db):
    requester = _user(db, "c02.req6@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c02.buyer6@premnathrail.com", apps=("purchase", "p2p"), is_director=True)
    set_po_workflow(db, [buyer.id, pr["_po_approvers"]["purchase_manager"].id], buyer)
    _raise_po(client, pr, buyer, "PO-C02-6")
    r = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "my own PO"}, headers=_h(buyer))
    assert r.status_code == 403


# ── C-03 Approval control: PATCH can't set status or approvers ──────────────

def test_c03_pr_patch_cannot_set_status(client, db):
    requester = _user(db, "c03.req1@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c03.buyer1@premnathrail.com", apps=("purchase",))
    for target in ("approved", "po_approved", "closed"):
        r = client.patch(f"{BASE}/{pr['id']}", json={"status": target}, headers=_h(buyer))
        assert r.status_code == 400, target
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(buyer)).json()["status"] == "submitted"


def test_c03_pr_patch_cannot_swap_approvers(client, db):
    from app.modules.organization.services import approval_engine as engine

    requester = _user(db, "c03.req2@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c03.buyer2@premnathrail.com", apps=("purchase",))
    for body in ({"approvers": {"rnd_manager": buyer.id}}, {"approver_id": buyer.id}, {"project_type": "existing"}):
        r = client.patch(f"{BASE}/{pr['id']}", json=body, headers=_h(buyer))
        assert r.status_code == 400, body
    steps = engine.latest_request(db, "p2p_request", pr["id"]).steps
    assert {s.approver_id for s in steps} == {u.id for u in pr["_approvers"].values()}


def test_c03_pr_patch_cannot_change_po_approvers(client, db):
    requester = _user(db, "c03.req3@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c03.buyer3@premnathrail.com", apps=("purchase",))
    r = client.patch(f"{BASE}/{pr['id']}", json={"po_approvers": {"purchase_manager": buyer.id}}, headers=_h(buyer))
    assert r.status_code in (200, 400)
    # Approvers aren't stored on the requisition any more — nothing to swap.
    from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover
    db.expire_all()
    assert db.query(P2PRequestPOApprover).filter(P2PRequestPOApprover.p2p_request_id == pr["id"]).count() == 0


def test_c03_buyer_cannot_swap_themselves_in_as_po_approver(client, db):
    requester = _user(db, "c03.req6@premnathrail.com")
    pr = _create_pr(client, requester)
    _approve_pr(client, pr)
    buyer = _user(db, "c03.buyer6@premnathrail.com", apps=("purchase",))
    # The per-PR picker route is gone: PO approvers are the admin's workflow.
    r = client.post(f"{BASE}/{pr['id']}/set-po-approvers",
                    json={"po_approvers": {role: buyer.id for role in _PO_PICKED_ROLES}}, headers=_h(buyer))
    assert r.status_code in (404, 405)


def test_c03_po_patch_cannot_set_status_or_value(client, db):
    requester = _user(db, "c03.req4@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c03.buyer4@premnathrail.com", apps=("purchase",))
    _raise_po(client, pr, buyer, "PO-C03-4")
    po = next(p for p in client.get(PO_BASE, headers=_h(buyer)).json() if p["p2p_request_id"] == pr["id"])
    for body in ({"status": "po_approved"}, {"status": "closed"}, {"total_value": 1.0}):
        r = client.patch(f"{PO_BASE}/{po['id']}", json=body, headers=_h(buyer))
        assert r.status_code == 400, body
    after = client.get(f"{PO_BASE}/{po['id']}", headers=_h(buyer)).json()
    assert after["status"] == po["status"] and after["total_value"] == po["total_value"]
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(buyer)).json()["status"] == "po_raised"


def test_c03_ad_hoc_po_without_pr_cannot_be_created(client, db):
    buyer = _user(db, "c03.buyer5@premnathrail.com", apps=("purchase",))
    r = client.post(PO_BASE, json={"po_number": "PO-ADHOC", "vendor_name": "Any", "items": []}, headers=_h(buyer))
    assert r.status_code in (404, 405)


# ── C-04 Financial control: no PO approval without line prices ─────────────

def test_c04_upload_po_refuses_unpriced_lines(client, db):
    requester = _user(db, "c04.req1@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c04.buyer1@premnathrail.com", apps=("purchase",))
    _approve_pr(client, pr)
    rfq = rfq_for_pr(db, pr["id"], buyer.id)
    line = pr["items"][0]
    # A line left out of the payload is refused by name, with how to fix it.
    details = upload_po_details(db, pr["id"])
    details["lines"] = []
    r = post_upload_po(client, buyer, rfq.id, details, "PO-C04-1")
    assert r.status_code == 422
    # A zero price is not a price.
    zero = upload_po_details(db, pr["id"], prices={line["id"]: 0})
    r = post_upload_po(client, buyer, rfq.id, zero, "PO-C04-1")
    assert r.status_code == 422 and "unit_price" in r.json()["detail"]
    other = upload_po_details(db, pr["id"])
    other["lines"] = [{"pr_item_id": line["id"] + 9999, "unit_price": 5}]
    r = post_upload_po(client, buyer, rfq.id, other, "PO-C04-1")
    assert r.status_code == 422 and "not open lines" in r.json()["detail"]
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(buyer)).json()["status"] == "vendor_quotations"


def test_c04_po_value_is_derived_from_line_prices_not_typed(client, db):
    requester = _user(db, "c04.req2@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c04.buyer2@premnathrail.com", apps=("purchase",))
    _approve_pr(client, pr)
    # A typed po_value in the details is not part of the contract and is ignored.
    po = upload_po_for_pr(client, db, pr["id"], buyer, tally_po_no="PO-C04-2", unit_price=50, tax_rate=None, po_value=1)
    assert po["total_value"] == 100.0  # 2 x 50
    assert client.get(f"{BASE}/{pr['id']}", headers=_h(buyer)).json()["po_value"] == 100.0


def test_c04_rfq_po_draft_cannot_be_submitted_without_prices(client, db):
    """The RFQ path the UI uses: a draft PO with an unpriced line can't be
    sent into PO approval."""
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    from app.modules.p2p.models.rfq import RFQ

    requester = _user(db, "c04.req3@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _user(db, "c04.buyer3@premnathrail.com", apps=("purchase",))
    row = db.query(P2PRequest).filter(P2PRequest.id == pr["id"]).one()
    row.status = "po_drafted"
    rfq = RFQ(rfq_number="RFQ-C04-3", p2p_request_id=row.id, status="submitted", created_by_id=buyer.id)
    po = P2PPurchaseOrder(po_number="PO-C04-3", p2p_request_id=row.id, vendor_name="Pune Steels", status="draft",
                          po_date=date.today(), created_by_id=buyer.id)
    db.add_all([rfq, po])
    db.flush()
    db.add_all([
        P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Priced", quantity=2, unit_price=10),
        P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Unpriced", quantity=1, unit_price=None),
    ])
    db.commit()

    attach_tally_po(db, po.id)
    r = client.post(f"/api/v1/p2p/rfqs/{rfq.id}/po-draft/{po.id}/submit", headers=_h(buyer))
    assert r.status_code == 400, r.text
    assert "Unpriced" in r.json()["detail"]
    db.expire_all()
    assert db.query(P2PRequest).filter(P2PRequest.id == pr["id"]).one().status == "po_drafted"
    assert db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id == po.id).one().status == "draft"
