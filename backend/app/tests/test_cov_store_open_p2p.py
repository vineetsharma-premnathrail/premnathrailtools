"""Open Store-side P2P controls (docs/02-modules/p2p/overview.md §13 and
docs/02-modules/store/overview.md §10 "Known gaps").

  C-21  a GRN can't complete without posting stock; PO/GRN lines are tied
        to the Item Master by item id, not by name text
  C-23  a completed GRN can be reversed
  C-43  cancelling a PR after PO approval doesn't leave the PO 'issued'
        (fixed: refused at po_approved; po_drafted / reject-at-po_raised
        cancel the linked PO)
  —     a PO uploaded on a requisition (Upload PO; the old create-po route is
        gone) goes through PO approval - never leaves a PO nobody can approve
  C-15  GRN pages are gated on 'store' but the GRN API needs 'purchase'

A control the code does NOT enforce yet keeps its test, marked
xfail(strict=True) with the reason "OPEN: <id> ...", so the test starts
failing (XPASS) the day the fix lands and the marker must be removed.
Tests without a marker pin behaviour that is already correct.
"""
from datetime import date, datetime, timezone
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.tests.p2p_po_helpers import post_upload_po, rfq_for_pr, upload_po_details
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance

PR_BASE = "/api/v1/p2p/requests"
GRN_BASE = "/api/v1/p2p/goods-receipts"
_seq = count(1)


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


def _qty(db, item_id, location_id):
    db.expire_all()
    b = db.query(StoreStockBalance).filter_by(item_id=item_id, location_id=location_id).first()
    return b.on_hand_qty if b else 0


@pytest.fixture
def env(db):
    requester = _user(db, "open.p2p.req@premnathrail.com")
    buyer = _user(db, "open.p2p.buyer@premnathrail.com", apps=("purchase", "p2p"))
    receiver = _user(db, "open.p2p.receiver@premnathrail.com", apps=("store",))  # Store-only GRN clerk
    loc = StoreLocation(name="Main Store", code="MS")
    item = StoreItem(item_code="MT-GEN-0201", item_name="Hex Bolt M12", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    return {"requester": requester, "buyer": buyer, "receiver": receiver, "loc": loc, "item": item}


def _approved_po(db, env, item_name="Hex Bolt M12", qty=10, pr_status="po_approved", po_status="issued", store_item_id=None):
    """A legacy-chain PR (project_type NULL) whose Purchase Head / Director /
    Partner stamps are all set, plus its PO — i.e. a PO cleared for receipt.
    The PO line carries its Item Master id (env's item unless given)."""
    n = next(_seq)
    now = datetime.now(timezone.utc)
    pr = P2PRequest(
        p2p_number=f"P2P-RAW-2026-9{n:03d}", category_code="RAW", request_date=date.today(),
        requested_by_id=env["requester"].id, status=pr_status, project_label="Loco 7",
        purchase_head_approved_at=now, director_approved_at=now, partner_approved_at=now,
    )
    db.add(pr)
    db.flush()
    po = P2PPurchaseOrder(po_number=f"PO-OPEN-{n}", p2p_request_id=pr.id, vendor_name="Pune Steels",
                          status=po_status, po_date=date.today(), created_by_id=env["buyer"].id)
    db.add(po)
    db.flush()
    line = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name=item_name, unit="NOS", quantity=qty, unit_price=10,
                                store_item_id=store_item_id or env["item"].id)
    db.add(line)
    db.commit()
    return pr, po, line


def _receive(client, user, po, line, qty, store_id):
    return client.post(GRN_BASE, json={
        "purchase_order_id": po.id, "store_location_id": store_id,
        "items": [{"po_item_id": line.id, "received_quantity": qty}],
    }, headers=_h(user))


def _inspect_all_passed(client, user, grn):
    return client.post(f"{GRN_BASE}/{grn['id']}/inspect", json={"items": [
        {"item_id": it["id"], "accepted_quantity": it["received_quantity"], "rejected_quantity": 0, "quality_status": "passed"}
        for it in grn["items"]
    ]}, headers=_h(user))


# ── C-21 GRN stock integrity ────────────────────────────────────────────────

def test_c21_grn_with_store_posts_accepted_qty_to_stock(client, db, env):
    _, po, line = _approved_po(db, env)
    grn = _receive(client, env["buyer"], po, line, 10, env["loc"].id)
    assert grn.status_code == 200, grn.text
    done = _inspect_all_passed(client, env["buyer"], grn.json())
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"
    assert _qty(db, env["item"].id, env["loc"].id) == 10


# Closed 2026-10-13 (MIGO 101): a GRN must name its store — it posts stock at once.
def test_c21_grn_without_store_cannot_complete_without_posting_stock(client, db, env):
    _, po, line = _approved_po(db, env)
    grn = _receive(client, env["buyer"], po, line, 10, None)
    if grn.status_code >= 400:  # refused up front — the control holds
        assert "store" in grn.json()["detail"].lower()
        return
    done = _inspect_all_passed(client, env["buyer"], grn.json())
    assert done.status_code in (400, 409, 422), done.text
    db.expire_all()
    assert db.query(P2PGoodsReceipt).filter_by(id=grn.json()["id"]).one().status != "completed"


# C-21 closed 2026-10-11: PO/GRN lines carry the Item Master id
# (store_item_id) and the GRN posts stock against it — never a name match.
def test_c21_grn_posts_to_the_po_lines_item_id_not_name_match(client, db, env):
    assert "store_item_id" in P2PPurchaseOrderItem.__table__.columns, "PO line has no link to the Item Master"
    twin = StoreItem(item_code="MT-GEN-0202", item_name="Hex Bolt M12", uom="NOS", item_type="material",
                     specification="Grade 10.9 — the one actually ordered")
    db.add(twin)
    db.commit()
    _, po, line = _approved_po(db, env, store_item_id=twin.id)
    grn = _receive(client, env["buyer"], po, line, 4, env["loc"].id)
    assert grn.status_code == 200, grn.text
    assert _inspect_all_passed(client, env["buyer"], grn.json()).status_code == 200
    assert _qty(db, twin.id, env["loc"].id) == 4
    assert _qty(db, env["item"].id, env["loc"].id) == 0


# ── C-23 GRN reversal ───────────────────────────────────────────────────────

# Closed 2026-10-11: POST /p2p/goods-receipts/{id}/reverse (SAP 102).
def test_c23_completed_grn_can_be_reversed(client, db, env):
    _, po, line = _approved_po(db, env)
    grn = _receive(client, env["buyer"], po, line, 10, env["loc"].id)
    assert _inspect_all_passed(client, env["buyer"], grn.json()).status_code == 200
    assert _qty(db, env["item"].id, env["loc"].id) == 10
    r = None
    for action in ("reverse", "cancel"):
        r = client.post(f"{GRN_BASE}/{grn.json()['id']}/{action}", json={"reason": "Received against wrong PO"},
                        headers=_h(env["buyer"]))
        if r.status_code not in (404, 405):
            break
    assert r.status_code == 200, r.text
    assert _qty(db, env["item"].id, env["loc"].id) == 0
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(id=po.id).one().status == "issued"


# ── C-43 Cancel cascade ─────────────────────────────────────────────────────

def test_c43_pr_with_po_awaiting_approval_cannot_be_cancelled(client, db, env):
    pr, po, _ = _approved_po(db, env, pr_status="po_raised")
    r = client.post(f"{PR_BASE}/{pr.id}/cancel", json={"reason": "No longer needed"}, headers=_h(env["requester"]))
    assert r.status_code == 409, r.text
    db.expire_all()
    assert db.query(P2PRequest).filter_by(id=pr.id).one().status == "po_raised"


def test_c43_cancelling_pr_after_po_approval_does_not_leave_po_issued(client, db, env):
    pr, po, _ = _approved_po(db, env, pr_status="po_approved")
    r = client.post(f"{PR_BASE}/{pr.id}/cancel", json={"reason": "No longer needed"}, headers=_h(env["requester"]))
    db.expire_all()
    po_status = db.query(P2PPurchaseOrder).filter_by(id=po.id).one().status
    # The requester can't call off an approved PO (only Purchase can) —
    # refused outright, PR and PO both untouched.
    assert r.status_code == 403, r.text
    assert db.query(P2PRequest).filter_by(id=pr.id).one().status == "po_approved"
    assert po_status == "issued"
    # Purchase cancelling it takes the PO down with the requisition.
    r = client.post(f"{PR_BASE}/{pr.id}/cancel", json={"reason": "No longer needed"}, headers=_h(env["buyer"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(id=po.id).one().status == "cancelled"


def test_c43_cancelling_pr_at_po_drafted_cancels_the_draft_po(client, db, env):
    pr, po, _ = _approved_po(db, env, pr_status="po_drafted", po_status="draft")
    r = client.post(f"{PR_BASE}/{pr.id}/cancel", json={"reason": "No longer needed"}, headers=_h(env["requester"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(id=po.id).one().status == "cancelled"


def test_c43_rejecting_at_po_raised_cancels_the_po(client, db, env):
    pr, po, _ = _approved_po(db, env, pr_status="po_raised")
    pr.director_approved_at = None  # legacy chain: Director slot still pending
    db.commit()
    director = _user(db, "open.p2p.director@premnathrail.com", is_director=True)
    r = client.post(f"{PR_BASE}/{pr.id}/reject", json={"reason": "Price too high"}, headers=_h(director))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    db.expire_all()
    assert db.query(P2PPurchaseOrder).filter_by(id=po.id).one().status == "cancelled"


# ── Legacy create-po bypass ─────────────────────────────────────────────────

_PR_ROLE_FLAGS = {"rnd_manager": "is_rnd_manager", "production_manager": "is_production_manager", "store_manager": "is_store_manager"}


def _approved_matrix_pr_without_po_picks(client, db):
    """A PR fully approved through the approval engine (its PO approvers are
    never picked per PR any more — the PO workflow decides)."""
    from app.tests.p2p_workflow_helpers import link_items, set_pr_workflow

    n = next(_seq)
    requester = _user(db, f"open.legacy.req.{n}@premnathrail.com")
    approvers = {role: _user(db, f"open.legacy.{role}.{n}@premnathrail.com", **{flag: True}) for role, flag in _PR_ROLE_FLAGS.items()}
    set_pr_workflow(db, [u.id for u in approvers.values()], requester)
    r = client.post(PR_BASE, json=link_items(db, {
        "category_code": "RAW", "project_label": "Project Alpha", "project_type": "new", "priority": "standard",
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs", "project_inhouse": "Project"}],
    }), headers=_h(requester))
    assert r.status_code == 200, r.text
    pr = r.json()
    for u in approvers.values():
        a = client.post(f"{PR_BASE}/{pr['id']}/approve", json={"comment": "Checked"}, headers=_h(u))
        assert a.status_code == 200, a.text
    assert a.json()["status"] == "approved"
    return pr


def _upload_po(client, db, pr, buyer):
    """Upload the Tally PO on the approved requisition (the way POs are made now)."""
    rfq = rfq_for_pr(db, pr["id"], buyer.id)
    return post_upload_po(client, buyer, rfq.id, upload_po_details(db, pr["id"]), f"PO-UPLOAD-{pr['id']}")


def test_upload_po_refuses_when_nobody_can_approve_the_po(client, db):
    # Default PO workflow ends with "any one Partner"; with no Partner set the
    # PO is refused at once with the reason, instead of stalling in approval.
    pr = _approved_matrix_pr_without_po_picks(client, db)
    buyer = _user(db, f"open.legacy.buyer.{pr['id']}@premnathrail.com", apps=("purchase", "p2p"))
    r = _upload_po(client, db, pr, buyer)
    assert r.status_code == 422, r.text
    assert "Partner" in r.json()["detail"]


def test_uploaded_po_can_reach_po_approved(client, db):
    pr = _approved_matrix_pr_without_po_picks(client, db)
    buyer = _user(db, f"open.legacy.buyer2.{pr['id']}@premnathrail.com", apps=("purchase", "p2p"))
    partner = _user(db, f"open.legacy.partner.{pr['id']}@premnathrail.com", is_partner=True)
    r = _upload_po(client, db, pr, buyer)
    assert r.status_code == 200, r.text
    a = client.post(f"{PR_BASE}/{pr['id']}/approve-po", json={"comment": "Commercials OK"}, headers=_h(partner))
    assert a.status_code == 200, a.text
    final = client.get(f"{PR_BASE}/{pr['id']}", headers=_h(buyer)).json()
    assert final["status"] == "po_approved"


# ── C-15 GRN access: store receivers ────────────────────────────────────────

def test_c15_user_without_store_or_purchase_cannot_receive(client, db, env):
    outsider = _user(db, "open.p2p.outsider@premnathrail.com", apps=("p2p",))
    _, po, line = _approved_po(db, env)
    r = _receive(client, outsider, po, line, 5, env["loc"].id)
    assert r.status_code == 403
    assert db.query(P2PGoodsReceipt).count() == 0


def test_c15_store_only_receiver_can_receive_and_purchase_inspects(client, db, env):
    """C-15 fixed: the GRN API takes 'store' OR 'purchase'. Inspection stays
    with the Purchase/QC team by design (goods_receipts.py inspect_goods_receipt;
    pinned by test_store_access_controls.py::test_store_only_user_gets_a_real_reason_on_inspect)."""
    _, po, line = _approved_po(db, env)
    h = _h(env["receiver"])
    pending = client.get(f"{GRN_BASE}/pending-purchase-orders", headers=h)
    assert pending.status_code == 200, pending.text
    assert po.id in [p["id"] for p in pending.json()]
    grn = _receive(client, env["receiver"], po, line, 10, env["loc"].id)
    assert grn.status_code == 200, grn.text
    assert client.get(f"{GRN_BASE}/{grn.json()['id']}", headers=h).status_code == 200
    done = _inspect_all_passed(client, env["buyer"], grn.json())
    assert done.status_code == 200, done.text
    assert _qty(db, env["item"].id, env["loc"].id) == 10
