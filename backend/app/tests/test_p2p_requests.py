"""Tests for the standalone Purchase Requisition module (app.modules.p2p).

The now-deleted app.modules.purchase used to handle PRs raised from a Service
Request's materials list separately — those are now created directly as
P2PRequest rows too (see erp/routes/service_requests.py), so this module
covers both the self-service PR pipeline and ERP-raised PRs.
"""
from itertools import count

import pytest
from sqlalchemy.orm import object_session

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

BASE = "/api/v1/p2p/requests"
_seq = count(1)


@pytest.fixture(autouse=True)
def _sqlite_number_series(monkeypatch):
    """P2P/RFQ/PO/GRN numbers serialize concurrent creates with a Postgres
    advisory lock (pg_advisory_xact_lock + hashtext), which the in-memory
    SQLite test DB doesn't have — PR creation 500s without this. The lock is
    purely a concurrency guard, so a no-op is exact for single-threaded tests."""
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def make_user(db, email, role="user", assigned_apps=(), department=None, **flags):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(assigned_apps), department=department,
    )
    for flag, value in flags.items():
        setattr(user, flag, value)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth_header(user):
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def _requester(db, email="req1@premnathrail.com", department="R&D"):
    return make_user(db, email, assigned_apps=("p2p",), department=department)


def _purchaser(db, email="buyer1@premnathrail.com"):
    return make_user(db, email, assigned_apps=("purchase",))


# Manager-role approval matrix: a "new project" PR needs one named R&D,
# Production and Store Manager, all of whom must approve (see
# PR_APPROVAL_ROLE_SETS). Each PR gets its own freshly flagged approvers.
_PR_ROLE_FLAGS = {"rnd_manager": "is_rnd_manager", "production_manager": "is_production_manager", "store_manager": "is_store_manager"}


def _pr_approvers(db) -> dict[str, User]:
    n = next(_seq)
    return {
        role: make_user(db, f"{role}.{n}@premnathrail.com", assigned_apps=("p2p",), **{flag: True})
        for role, flag in _PR_ROLE_FLAGS.items()
    }


def _create_payload(**overrides):
    payload = {
        "category_code": "RAW",
        "project_label": "Project Alpha",
        "project_type": "new",
        "approvers": {},
        "priority": "medium",
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs", "project_inhouse": "Project"}],
    }
    payload.update(overrides)
    return payload


def _create_pr(client, requester, **overrides):
    """Raise a PR under the matrix with freshly flagged approvers. The
    approver User objects ride along on the response as `_approvers` so a
    test can act as them."""
    db = object_session(requester)
    approvers = _pr_approvers(db)
    n = next(_seq)
    po_approvers = {
        role: make_user(db, f"po.{role}.{n}@premnathrail.com", assigned_apps=("p2p",))
        for role in ("rnd_manager", "purchase_manager", "production_manager")
    }
    response = client.post(
        BASE, json=_create_payload(
            approvers={r: u.id for r, u in approvers.items()},
            po_approvers={r: u.id for r, u in po_approvers.items()},
            **overrides,
        ), headers=auth_header(requester),
    )
    assert response.status_code == 200, response.text
    pr = response.json()
    pr["_approvers"] = approvers
    pr["_po_approvers"] = po_approvers
    return pr


def _approve_pr(client, pr):
    """Every named approver signs; returns the final response."""
    response = None
    for approver in pr["_approvers"].values():
        response = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(approver))
        assert response.status_code == 200, response.text
    return response


# ── Create ───────────────────────────────────────────────────────────────────

def test_create_requires_p2p_app(client, db):
    outsider = make_user(db, "outsider1@premnathrail.com", assigned_apps=("erp",))
    response = client.post(BASE, json=_create_payload(), headers=auth_header(outsider))
    assert response.status_code == 403


def test_create_rejects_invalid_category(client, db):
    requester = _requester(db)
    response = client.post(BASE, json=_create_payload(category_code="NOPE"), headers=auth_header(requester))
    assert response.status_code == 400


def test_create_rejects_no_items(client, db):
    requester = _requester(db)
    response = client.post(BASE, json=_create_payload(items=[]), headers=auth_header(requester))
    assert response.status_code == 400


def test_create_success_auto_fills_and_generates_p2p_number(client, db):
    requester = _requester(db, "req2@premnathrail.com", department="R&D")
    pr = _create_pr(client, requester)
    assert pr["p2p_number"].startswith("P2P-RAW-")
    assert pr["status"] == "submitted"
    assert pr["department"] == "R&D"
    assert pr["requested_by_id"] == requester.id
    assert pr["requested_by_name"] == requester.name
    assert pr["category_label"] == "Raw Material"
    assert len(pr["items"]) == 1
    assert pr["items"][0]["item_name"] == "Hydraulic Cylinder"
    assert pr["items"][0]["quantity"] == 2


def test_p2p_number_sequence_is_scoped_per_category_and_year(client, db):
    requester = _requester(db, "req3@premnathrail.com")
    hyd1 = _create_pr(client, requester, category_code="RAW")
    hyd2 = _create_pr(client, requester, category_code="RAW")
    mec1 = _create_pr(client, requester, category_code="ELE")

    hyd1_num = int(hyd1["p2p_number"].rsplit("-", 1)[-1])
    hyd2_num = int(hyd2["p2p_number"].rsplit("-", 1)[-1])
    mec1_num = int(mec1["p2p_number"].rsplit("-", 1)[-1])
    assert hyd2_num == hyd1_num + 1
    assert mec1_num == 1  # independent sequence for a different category
    assert mec1["p2p_number"].startswith("P2P-ELE-")


def test_create_requires_project_or_inhouse_on_every_line(client, db):
    requester = _requester(db, "reqpi@premnathrail.com")
    approvers = _pr_approvers(db)
    response = client.post(BASE, json=_create_payload(
        approvers={r: u.id for r, u in approvers.items()},
        items=[
            {"item_name": "Hydraulic Cylinder", "quantity": 1, "project_inhouse": "Project"},
            {"item_name": "Hose clamp", "quantity": 4},
        ],
    ), headers=auth_header(requester))
    assert response.status_code == 400
    assert response.json()["detail"] == "Line 2 (Hose clamp): choose Project or Inhouse."


# ── Meta ─────────────────────────────────────────────────────────────────────

def test_meta_requires_module_access(client, db):
    outsider = make_user(db, "outsider2@premnathrail.com", assigned_apps=("erp",))
    response = client.get(f"{BASE}/meta", headers=auth_header(outsider))
    assert response.status_code == 403


def test_meta_returns_categories_and_statuses(client, db):
    requester = _requester(db, "req4@premnathrail.com")
    response = client.get(f"{BASE}/meta", headers=auth_header(requester))
    assert response.status_code == 200
    body = response.json()
    assert any(c["code"] == "RAW" for c in body["categories"])
    assert "submitted" in body["statuses"]


# ── List & view access ───────────────────────────────────────────────────────

def test_requester_only_sees_own_prs_in_list(client, db):
    req_a = _requester(db, "reqa@premnathrail.com")
    req_b = _requester(db, "reqb@premnathrail.com")
    pr_a = _create_pr(client, req_a)
    _create_pr(client, req_b)

    response = client.get(BASE, headers=auth_header(req_a))
    assert response.status_code == 200
    ids = [p["id"] for p in response.json()]
    assert pr_a["id"] in ids
    assert len(ids) == 1


def test_purchase_team_sees_all_prs_in_list(client, db):
    req_a = _requester(db, "reqc@premnathrail.com")
    req_b = _requester(db, "reqd@premnathrail.com")
    pr_a = _create_pr(client, req_a)
    pr_b = _create_pr(client, req_b)

    buyer = _purchaser(db)
    response = client.get(BASE, headers=auth_header(buyer))
    assert response.status_code == 200
    ids = [p["id"] for p in response.json()]
    assert pr_a["id"] in ids and pr_b["id"] in ids


def test_list_filters_by_status_and_category(client, db):
    requester = _requester(db, "reqe@premnathrail.com")
    _create_pr(client, requester, category_code="RAW")
    _create_pr(client, requester, category_code="ELE")
    buyer = _purchaser(db, "buyere@premnathrail.com")

    response = client.get(BASE, params={"category_code": "ELE"}, headers=auth_header(buyer))
    assert response.status_code == 200
    assert all(p["category_code"] == "ELE" for p in response.json())


def test_requester_cannot_view_others_pr_detail(client, db):
    req_a = _requester(db, "reqf@premnathrail.com")
    req_b = _requester(db, "reqg@premnathrail.com")
    pr = _create_pr(client, req_a)

    response = client.get(f"{BASE}/{pr['id']}", headers=auth_header(req_b))
    assert response.status_code == 403


def test_purchase_team_can_view_any_pr_detail(client, db):
    requester = _requester(db, "reqh@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerh@premnathrail.com")

    response = client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["p2p_number"] == pr["p2p_number"]


def test_get_unknown_pr_404s(client, db):
    requester = _requester(db, "reqi@premnathrail.com")
    response = client.get(f"{BASE}/999999", headers=auth_header(requester))
    assert response.status_code == 404


# ── Audit trail ──────────────────────────────────────────────────────────────

def test_audit_trail_records_creation_and_approval(client, db):
    requester = _requester(db, "reqj@premnathrail.com")
    pr = _create_pr(client, requester)
    _approve_pr(client, pr)

    response = client.get(f"{BASE}/{pr['id']}/audit", headers=auth_header(requester))
    assert response.status_code == 200
    entries = response.json()
    # One "approved" entry per approver slot, the final status change, then
    # the stock re-check that routes lines to store issue or procurement.
    assert [e["action"] for e in entries] == ["created"] + ["approved"] * (len(pr["_approvers"]) + 1) + ["stock_checked"]
    assert entries[-2]["old_status"] == "submitted"
    assert entries[-2]["new_status"] == "approved"


def test_stock_is_checked_at_create_and_lines_are_routed_on_approval(client, db):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.services.stock_ledger import post_stock_transaction

    loc = StoreLocation(name="Main Store", code="MS01")
    cyl = StoreItem(item_code="RM-CYL-01", item_name="Hydraulic Cylinder", uom="NOS", status="active")
    db.add_all([loc, cyl])
    db.commit()
    post_stock_transaction(db, item_id=cyl.id, location_id=loc.id, transaction_type="receipt", quantity=5, reference_type="manual")
    db.commit()

    requester = _requester(db, "reqst@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs", "project_inhouse": "Project"},
        {"item_name": "Special seal kit", "quantity": 1, "unit": "set", "project_inhouse": "Inhouse"},
    ])
    stock = {i["item_name"]: i["stock_status"] for i in pr["items"]}
    assert stock == {"Hydraulic Cylinder": "in_stock", "Special seal kit": "no_match"}

    approved = _approve_pr(client, pr).json()
    routed = {i["item_name"]: i["fulfillment_status"] for i in approved["items"]}
    # In stock → waits for the store/buyer to issue it (nothing auto-issues);
    # not in the item master → straight to procurement for the RFQ.
    assert routed == {"Hydraulic Cylinder": "pending", "Special seal kit": "sent_to_procurement"}


# ── Approve / reject / cancel ────────────────────────────────────────────────

def test_requester_cannot_approve_own_pr(client, db):
    requester = _requester(db, "reqk@premnathrail.com")
    pr = _create_pr(client, requester)
    response = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(requester))
    assert response.status_code == 403


def test_buyer_who_is_not_an_approver_cannot_approve(client, db):
    requester = _requester(db, "reqk2@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerk2@premnathrail.com")
    response = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(buyer))
    assert response.status_code == 403


def test_pr_needs_every_named_approver(client, db):
    requester = _requester(db, "reqk3@premnathrail.com")
    pr = _create_pr(client, requester)
    approvers = list(pr["_approvers"].values())
    partial = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(approvers[0]))
    assert partial.status_code == 200 and partial.json()["status"] == "submitted"
    again = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(approvers[0]))
    assert again.status_code == 403  # already signed their slot


def test_approve_only_from_submitted(client, db):
    requester = _requester(db, "reql@premnathrail.com")
    pr = _create_pr(client, requester)
    last_approver = list(pr["_approvers"].values())[-1]

    first = _approve_pr(client, pr)
    assert first.json()["status"] == "approved"
    assert first.json()["approved_by_id"] == last_approver.id

    second = client.post(f"{BASE}/{pr['id']}/approve", json={"comment": "Checked and OK"}, headers=auth_header(last_approver))
    assert second.status_code == 409


def test_reject_from_submitted_or_approved(client, db):
    requester = _requester(db, "reqm@premnathrail.com")
    pr = _create_pr(client, requester)
    approver = pr["_approvers"]["store_manager"]

    response = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "Duplicate request"}, headers=auth_header(approver))
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["rejected_reason"] == "Duplicate request"


def test_only_an_assigned_approver_can_reject(client, db):
    requester = _requester(db, "reqm2@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerm2@premnathrail.com")
    response = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "x"}, headers=auth_header(buyer))
    assert response.status_code == 403


def test_reject_terminal_status_fails(client, db):
    requester = _requester(db, "reqn@premnathrail.com")
    pr = _create_pr(client, requester)
    approver = pr["_approvers"]["rnd_manager"]
    client.post(f"{BASE}/{pr['id']}/reject", json={}, headers=auth_header(approver))

    response = client.post(f"{BASE}/{pr['id']}/reject", json={}, headers=auth_header(approver))
    assert response.status_code == 409


def test_requester_can_cancel_own_pr(client, db):
    requester = _requester(db, "reqo@premnathrail.com")
    pr = _create_pr(client, requester)

    response = client.post(f"{BASE}/{pr['id']}/cancel", json={"reason": "No longer needed"}, headers=auth_header(requester))
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_requester_cannot_cancel_others_pr(client, db):
    req_a = _requester(db, "reqp@premnathrail.com")
    req_b = _requester(db, "reqq@premnathrail.com")
    pr = _create_pr(client, req_a)

    response = client.post(f"{BASE}/{pr['id']}/cancel", json={}, headers=auth_header(req_b))
    assert response.status_code == 403


def test_cancel_disallowed_once_po_raised(client, db):
    requester = _requester(db, "reqr@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerr@premnathrail.com")
    _raise_po(client, db, pr, buyer, po_number="PO-1")

    response = client.post(f"{BASE}/{pr['id']}/cancel", json={}, headers=auth_header(requester))
    assert response.status_code == 409


# ── Buyer assignment / RFQ / vendor selection ───────────────────────────────

def test_assign_buyer_requires_approved_status(client, db):
    requester = _requester(db, "reqs@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyers@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": buyer.id}, headers=auth_header(buyer))
    assert response.status_code == 409


def test_assign_buyer_success(client, db):
    requester = _requester(db, "reqt@premnathrail.com")
    pr = _create_pr(client, requester)
    manager = _purchaser(db, "managert@premnathrail.com")
    buyer = _purchaser(db, "buyert@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": buyer.id}, headers=auth_header(manager))
    assert response.status_code == 200
    assert response.json()["assigned_buyer_id"] == buyer.id
    assert response.json()["assigned_buyer_name"] == buyer.name
    assert response.json()["assignment_date"] is not None


def test_assign_buyer_unknown_buyer_404s(client, db):
    requester = _requester(db, "requ@premnathrail.com")
    pr = _create_pr(client, requester)
    manager = _purchaser(db, "manageru@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": 999999}, headers=auth_header(manager))
    assert response.status_code == 404


def test_request_quotations_requires_approved_status(client, db):
    requester = _requester(db, "reqv@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerv@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/request-quotations", json={"vendor": "Acme"}, headers=auth_header(buyer))
    assert response.status_code == 409


def test_request_quotations_success(client, db):
    requester = _requester(db, "reqw@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerw@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(
        f"{BASE}/{pr['id']}/request-quotations",
        json={"vendor": "Acme Corp", "rfq_number": "RFQ-001", "quotation": "50000", "vendor_comparison": "Acme vs Beta"},
        headers=auth_header(buyer),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["vendor"] == "Acme Corp"
    assert body["rfq_number"] == "RFQ-001"
    assert body["vendor_comparison"] == "Acme vs Beta"


def test_select_vendor_requires_approved_status(client, db):
    requester = _requester(db, "reqx@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerx@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/select-vendor", json={"selected_vendor": "Acme"}, headers=auth_header(buyer))
    assert response.status_code == 409


def test_select_vendor_success(client, db):
    requester = _requester(db, "reqy@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyery@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(f"{BASE}/{pr['id']}/select-vendor", json={"selected_vendor": "Acme Corp"}, headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["selected_vendor"] == "Acme Corp"


# ── PO creation ──────────────────────────────────────────────────────────────

def test_create_po_requires_approved_status(client, db):
    requester = _requester(db, "reqz@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerz@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/create-po", json={"po_number": "PO-1"}, headers=auth_header(buyer))
    assert response.status_code == 409


def test_create_po_refuses_unpriced_lines(client, db):
    requester = _requester(db, "reqaa0@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyeraa0@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(f"{BASE}/{pr['id']}/create-po", json={"po_number": "PO-99"}, headers=auth_header(buyer))
    assert response.status_code == 400 and "unit price" in response.json()["detail"]


def test_create_po_defaults_ordered_quantity_to_item_sum(client, db):
    requester = _requester(db, "reqaa@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"item_name": "Bolt", "quantity": 5, "unit": "pcs", "project_inhouse": "Project"},
        {"item_name": "Nut", "quantity": 5, "unit": "pcs", "project_inhouse": "Project"},
    ])
    buyer = _purchaser(db, "buyeraa@premnathrail.com")
    _approve_pr(client, pr)
    bolt, nut = pr["items"]

    # po_value in the payload is ignored — the total is computed from the priced lines.
    response = client.post(f"{BASE}/{pr['id']}/create-po", json={
        "po_number": "PO-100", "po_value": 999.5,
        "item_pricing": [{"pr_item_id": bolt["id"], "unit_price": 10}, {"pr_item_id": nut["id"], "unit_price": 20}],
    }, headers=auth_header(buyer))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "po_raised"
    assert body["po_number"] == "PO-100"
    assert body["ordered_quantity"] == 10
    assert body["po_value"] == 150.0


def test_create_po_respects_explicit_ordered_quantity(client, db):
    requester = _requester(db, "reqab@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerab@premnathrail.com")
    _approve_pr(client, pr)

    response = client.post(
        f"{BASE}/{pr['id']}/create-po",
        json={"po_number": "PO-2", "ordered_quantity": 7, "item_pricing": [{"pr_item_id": pr["items"][0]["id"], "unit_price": 50}]},
        headers=auth_header(buyer),
    )
    assert response.status_code == 200, response.text
    assert response.json()["ordered_quantity"] == 7


def test_approval_requires_a_comment(client, db):
    requester = _requester(db, "reqcm@premnathrail.com")
    pr = _create_pr(client, requester)
    approver = pr["_approvers"]["rnd_manager"]
    for body in ({}, {"comment": "   "}):
        response = client.post(f"{BASE}/{pr['id']}/approve", json=body, headers=auth_header(approver))
        assert response.status_code == 400
        assert "Add a comment before approving" in response.json()["detail"]
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).json()["approvals"][0]["approved_at"] is None


# ── PO approval (manager matrix: any ONE holder of the PO role set) ─────────

def _raise_po(client, db, pr, buyer, po_number="PO-REC"):
    _approve_pr(client, pr)
    raised = client.post(f"{BASE}/{pr['id']}/create-po", json={
        "po_number": po_number, "item_pricing": [{"pr_item_id": i["id"], "unit_price": 100, "tax_rate": 18} for i in pr["items"]],
    }, headers=auth_header(buyer))
    assert raised.status_code == 200, raised.text
    return raised.json()


def _approve_and_raise_po(client, db, pr, buyer):
    """Approve the PR, raise a priced PO, and have a Purchase Manager (a PO
    role for "new" projects who is neither requester nor buyer) approve it,
    so the PR reaches 'po_approved' and goods can be received."""
    _raise_po(client, db, pr, buyer)
    approver = make_user(db, f"purchase.manager.{pr['id']}@premnathrail.com", assigned_apps=("p2p",), is_director=True)
    resp = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Checked and OK"}, headers=auth_header(approver))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "po_approved"
    return resp.json()


def test_po_approval_by_any_one_role_holder(client, db):
    requester = _requester(db, "reqpo1@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerpo1@premnathrail.com")
    body = _approve_and_raise_po(client, db, pr, buyer)
    assert body["po_approved_role"] == "director"
    assert body["po_approved_by_name"].startswith("purchase.manager")


def test_po_approval_refuses_non_role_holders_but_allows_own_po(client, db):
    requester = _requester(db, "reqpo2@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = make_user(db, "buyerpo2@premnathrail.com", assigned_apps=("purchase",), is_director=True)
    _raise_po(client, db, pr, buyer)

    store_mgr = make_user(db, "storepo2@premnathrail.com", assigned_apps=("p2p",), is_store_manager=True)
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Checked and OK"}, headers=auth_header(store_mgr)).status_code == 403  # not a PO role
    assert client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Checked and OK"}, headers=auth_header(requester)).status_code == 403  # no PO role
    # Holding a PO role is enough — even for whoever raised the PO.
    own = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "Checked and OK"}, headers=auth_header(buyer))
    assert own.status_code == 200 and own.json()["status"] == "po_approved"


def test_po_approval_requires_a_comment(client, db):
    requester = _requester(db, "reqpo3@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerpo3@premnathrail.com")
    _raise_po(client, db, pr, buyer)
    approver = make_user(db, "purchase.manager.po3@premnathrail.com", assigned_apps=("p2p",), is_director=True)
    response = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": ""}, headers=auth_header(approver))
    assert response.status_code == 400
    assert "Add a comment before approving" in response.json()["detail"]
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] == "po_raised"


# ── Approval queues (P.R Approval / P.O Approval tabs) ──────────────────────

def test_pr_approval_queue_shows_only_my_slots(client, db):
    requester = _requester(db, "reqq1@premnathrail.com")
    mine = _create_pr(client, requester)
    _create_pr(client, requester)  # different, freshly created approvers
    approver = mine["_approvers"]["store_manager"]

    queue = client.get(BASE, params={"queue": "pr-approval"}, headers=auth_header(approver)).json()
    assert [p["id"] for p in queue] == [mine["id"]]
    me = client.get("/api/v1/auth/me", headers=auth_header(approver)).json()
    assert me["is_pr_approver"] is True

    outsider = _requester(db, "reqq2@premnathrail.com")
    assert client.get(BASE, params={"queue": "pr-approval"}, headers=auth_header(outsider)).json() == []
    assert client.get("/api/v1/auth/me", headers=auth_header(outsider)).json()["is_pr_approver"] is False


def test_po_approval_queue_shows_only_pos_i_can_approve(client, db):
    requester = _requester(db, "reqq3@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = make_user(db, "buyerq3@premnathrail.com", assigned_apps=("purchase",), is_director=True)
    _raise_po(client, db, pr, buyer)

    approver = make_user(db, "pmq3@premnathrail.com", assigned_apps=("p2p",), is_director=True)
    queue = client.get(BASE, params={"queue": "po-approval"}, headers=auth_header(approver)).json()
    assert [p["id"] for p in queue] == [pr["id"]]
    assert client.get("/api/v1/auth/me", headers=auth_header(approver)).json()["is_po_approver"] is True
    # The buyer raised this PO but holds a PO role, so it's in their queue too.
    assert [p["id"] for p in client.get(BASE, params={"queue": "po-approval"}, headers=auth_header(buyer)).json()] == [pr["id"]]
    store_mgr = make_user(db, "storeq3@premnathrail.com", assigned_apps=("p2p",), is_store_manager=True)
    assert client.get(BASE, params={"queue": "po-approval"}, headers=auth_header(store_mgr)).json() == []


# ── Receiving (per-PO Goods Receipt → quality inspection → PR receipt status) ─

def _receive(client, pr_id, buyer, quantity):
    """Record a GRN for `quantity` of the PO's first line and accept it all at
    inspection — that is what rolls the receipt up onto the PR."""
    po = next(p for p in client.get("/api/v1/p2p/purchase-orders", headers=auth_header(buyer)).json() if p["p2p_request_id"] == pr_id)
    grn = client.post("/api/v1/p2p/goods-receipts", json={
        "purchase_order_id": po["id"], "items": [{"po_item_id": po["items"][0]["id"], "received_quantity": quantity}],
    }, headers=auth_header(buyer))
    if grn.status_code != 200:
        return grn
    grn = grn.json()
    return client.post(f"/api/v1/p2p/goods-receipts/{grn['id']}/inspect", json={"items": [
        {"item_id": grn["items"][0]["id"], "accepted_quantity": quantity, "quality_status": "passed"},
    ]}, headers=auth_header(buyer))


def test_goods_receipt_requires_po_approval(client, db):
    requester = _requester(db, "reqac@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerac@premnathrail.com")
    _raise_po(client, db, pr, buyer)

    response = _receive(client, pr["id"], buyer, 1)
    assert response.status_code == 409
    assert "approval" in response.json()["detail"]


def test_partial_receipt_moves_to_partially_received(client, db):
    requester = _requester(db, "reqad@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyerad@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)

    assert _receive(client, pr["id"], buyer, 4).status_code == 200
    body = client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()
    assert body["status"] == "partially_received"
    assert body["receipt_status"] == "partial"
    assert body["received_quantity"] == 4
    assert body["pending_quantity"] == 6


def test_full_receipt_moves_to_received(client, db):
    requester = _requester(db, "reqae@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyerae@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)

    assert _receive(client, pr["id"], buyer, 10).status_code == 200
    body = client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()
    assert body["status"] == "received"
    assert body["receipt_status"] == "received"
    assert body["pending_quantity"] == 0
    assert body["grn_number"]


def test_receipt_over_ordered_quantity_is_refused(client, db):
    requester = _requester(db, "reqaf@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 5, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyeraf@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)

    response = _receive(client, pr["id"], buyer, 999)
    assert response.status_code == 409


def test_second_partial_receipt_can_complete_the_order(client, db):
    requester = _requester(db, "reqag@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyerag@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)

    assert _receive(client, pr["id"], buyer, 6).status_code == 200
    assert _receive(client, pr["id"], buyer, 4).status_code == 200
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] == "received"


# ── Close ────────────────────────────────────────────────────────────────────

def test_close_requires_received_status(client, db):
    requester = _requester(db, "reqah@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerah@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(buyer))
    assert response.status_code == 409


def test_close_success(client, db):
    requester = _requester(db, "reqai@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 3, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyerai@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    assert _receive(client, pr["id"], buyer, 3).status_code == 200

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert response.json()["closed_by_id"] == buyer.id
    assert response.json()["closed_at"] is not None


def test_close_requires_purchase_app(client, db):
    requester = _requester(db, "reqaj@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 1, "unit": "mtr", "project_inhouse": "Project"}])
    buyer = _purchaser(db, "buyeraj@premnathrail.com")
    _approve_and_raise_po(client, db, pr, buyer)
    assert _receive(client, pr["id"], buyer, 1).status_code == 200

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(requester))
    assert response.status_code == 403


# ── Manual update (purchase-only header edit) ───────────────────────────────

def test_update_requires_purchase_app(client, db):
    requester = _requester(db, "reqak@premnathrail.com")
    pr = _create_pr(client, requester)
    response = client.patch(f"{BASE}/{pr['id']}", json={"remarks": "hello"}, headers=auth_header(requester))
    assert response.status_code == 403


def test_update_header_fields(client, db):
    requester = _requester(db, "reqal@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyeral@premnathrail.com")

    response = client.patch(f"{BASE}/{pr['id']}", json={"remarks": "Updated remarks", "priority": "high"}, headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["remarks"] == "Updated remarks"
    assert response.json()["priority"] == "high"


def test_update_rejects_invalid_status(client, db):
    requester = _requester(db, "reqam@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyeram@premnathrail.com")

    response = client.patch(f"{BASE}/{pr['id']}", json={"status": "not_a_real_status"}, headers=auth_header(buyer))
    assert response.status_code == 400


def test_status_cannot_be_patched_directly(client, db):
    """Status only moves through approve/reject/cancel/close, so a PATCH
    can't skip the approval chain — and nothing is changed."""
    requester = _requester(db, "reqan@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyeran@premnathrail.com")

    response = client.patch(f"{BASE}/{pr['id']}", json={"status": "cancelled"}, headers=auth_header(buyer))
    assert response.status_code == 400 and "can't be edited directly" in response.json()["detail"]
    assert client.get(f"{BASE}/{pr['id']}", headers=auth_header(buyer)).json()["status"] == "submitted"


# ── Attachments ──────────────────────────────────────────────────────────────

def test_upload_attachment_requires_sharepoint_configured(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")

    requester = _requester(db, "reqao@premnathrail.com")
    pr = _create_pr(client, requester)

    response = client.post(
        f"{BASE}/{pr['id']}/attachments",
        files={"files": ("spec.pdf", b"fake-bytes", "application/pdf")},
        headers=auth_header(requester),
    )
    assert response.status_code == 503


def test_upload_attachment_success(client, db, monkeypatch):
    import app.modules.p2p.routes.p2p_requests as pr_routes
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": f"{folder_path}/{upload_file.filename}", "webUrl": "https://sp.example/x", "size": 42}

    monkeypatch.setattr(pr_routes, "upload_file_to_sharepoint", fake_upload)

    requester = _requester(db, "reqap@premnathrail.com")
    pr = _create_pr(client, requester)
    item_id = pr["items"][0]["id"]

    response = client.post(
        f"{BASE}/{pr['id']}/attachments",
        data={"doc_type": "supporting", "item_id": str(item_id)},
        files={"files": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        headers=auth_header(requester),
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["filename"] == "photo.jpg"
    assert body[0]["item_id"] == item_id

    refetched = client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).json()
    item = next(i for i in refetched["items"] if i["id"] == item_id)
    assert len(item["attachments"]) == 1
    assert item["attachments"][0]["filename"] == "photo.jpg"


def test_upload_attachment_rejects_item_from_other_pr(client, db, monkeypatch):
    import app.modules.p2p.routes.p2p_requests as pr_routes
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": "x", "webUrl": "https://sp.example/x", "size": 1}

    monkeypatch.setattr(pr_routes, "upload_file_to_sharepoint", fake_upload)

    requester = _requester(db, "reqaq@premnathrail.com")
    pr1 = _create_pr(client, requester)
    pr2 = _create_pr(client, requester)
    other_item_id = pr2["items"][0]["id"]

    response = client.post(
        f"{BASE}/{pr1['id']}/attachments",
        data={"item_id": str(other_item_id)},
        files={"files": ("x.jpg", b"bytes", "image/jpeg")},
        headers=auth_header(requester),
    )
    assert response.status_code == 400


def test_upload_attachment_rejects_others_pr(client, db, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    req_a = _requester(db, "reqar@premnathrail.com")
    req_b = _requester(db, "reqas@premnathrail.com")
    pr = _create_pr(client, req_a)

    response = client.post(
        f"{BASE}/{pr['id']}/attachments",
        files={"files": ("x.jpg", b"bytes", "image/jpeg")},
        headers=auth_header(req_b),
    )
    assert response.status_code == 403


def test_delete_attachment(client, db, monkeypatch):
    import app.modules.p2p.routes.p2p_requests as pr_routes
    from app.core.config import settings
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "fake-site-id")

    async def fake_upload(site_id, folder_path, upload_file):
        return {"name": upload_file.filename, "path": "x", "webUrl": "https://sp.example/x", "size": 1}

    monkeypatch.setattr(pr_routes, "upload_file_to_sharepoint", fake_upload)

    requester = _requester(db, "reqat@premnathrail.com")
    pr = _create_pr(client, requester)
    uploaded = client.post(
        f"{BASE}/{pr['id']}/attachments",
        files={"files": ("x.jpg", b"bytes", "image/jpeg")},
        headers=auth_header(requester),
    ).json()
    attachment_id = uploaded[0]["id"]

    response = client.delete(f"{BASE}/{pr['id']}/attachments/{attachment_id}", headers=auth_header(requester))
    assert response.status_code == 200

    refetched = client.get(f"{BASE}/{pr['id']}", headers=auth_header(requester)).json()
    assert refetched["attachments"] == []


def test_delete_attachment_unknown_404s(client, db):
    requester = _requester(db, "reqau@premnathrail.com")
    pr = _create_pr(client, requester)

    response = client.delete(f"{BASE}/{pr['id']}/attachments/999999", headers=auth_header(requester))
    assert response.status_code == 404


# ── Issue from stock (Store Manager only, comment required) ─────────────────

def _approved_pr_with_stock(client, db, tag, on_hand, qty):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.services.stock_ledger import post_stock_transaction
    loc = StoreLocation(name=f"Store {tag}", code=f"S{tag}")
    it = StoreItem(item_code=f"RM-{tag}", item_name=f"Item {tag}", uom="NOS", status="active")
    db.add_all([loc, it])
    db.commit()
    post_stock_transaction(db, item_id=it.id, location_id=loc.id, transaction_type="receipt", quantity=on_hand, reference_type="manual")
    db.commit()
    requester = _requester(db, f"req{tag}@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": f"Item {tag}", "quantity": qty, "unit": "NOS", "project_inhouse": "Project"}])
    approved = _approve_pr(client, pr).json()
    approved["_store_manager"] = pr["_approvers"]["store_manager"]
    return approved, approved["items"][0]["id"], loc.id


def test_only_store_manager_can_issue_and_comment_is_required(client, db):
    pr, item_id, loc_id = _approved_pr_with_stock(client, db, "I1", on_hand=20, qty=1)
    url = f"{BASE}/{pr['id']}/items/{item_id}/issue-from-stock"

    buyer = _purchaser(db, "buyer.i1@premnathrail.com")
    assert client.post(url, json={"location_id": loc_id, "comment": "x"}, headers=auth_header(buyer)).status_code == 403

    store = pr["_store_manager"]
    assert client.post(url, json={"location_id": loc_id}, headers=auth_header(store)).status_code == 400

    ok = client.post(url, json={"location_id": loc_id, "comment": "Handed to site"}, headers=auth_header(store))
    assert ok.status_code == 200
    assert ok.json()["items"][0]["fulfillment_status"] == "stock_issued"
    assert ok.json()["status"] == "closed"


def test_partial_issue_sends_only_shortfall_to_procurement(client, db):
    pr, item_id, loc_id = _approved_pr_with_stock(client, db, "I2", on_hand=200, qty=400)
    store = pr["_store_manager"]
    resp = client.post(
        f"{BASE}/{pr['id']}/items/{item_id}/issue-from-stock",
        json={"location_id": loc_id, "quantity": 200, "comment": "Partial from Plant store"},
        headers=auth_header(store),
    )
    assert resp.status_code == 200
    line = resp.json()["items"][0]
    assert line["fulfillment_status"] == "sent_to_procurement"
    assert line["issued_qty"] == 200
    assert resp.json()["status"] == "approved"



def test_picked_po_approver_can_approve_but_unpicked_role_holder_cannot(client, db):
    requester = _requester(db, "reqpo9@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerpo9@premnathrail.com")
    _raise_po(client, db, pr, buyer)

    # Holding a manager flag no longer counts — only the person picked on the PR.
    other_pm = make_user(db, "other.pm9@premnathrail.com", assigned_apps=("p2p",), is_purchase_manager=True)
    refused = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "OK"}, headers=auth_header(other_pm))
    assert refused.status_code == 403

    picked = pr["_po_approvers"]["purchase_manager"]
    queue = client.get(BASE, params={"queue": "po-approval"}, headers=auth_header(picked)).json()
    assert [p["id"] for p in queue] == [pr["id"]]
    ok = client.post(f"{BASE}/{pr['id']}/approve-po", json={"comment": "OK"}, headers=auth_header(picked))
    assert ok.status_code == 200
    assert ok.json()["po_approved_role"] == "purchase_manager"


def test_create_requires_po_approvers(client, db):
    requester = _requester(db, "reqpo10@premnathrail.com")
    approvers = _pr_approvers(db)
    resp = client.post(BASE, json=_create_payload(approvers={r: u.id for r, u in approvers.items()}), headers=auth_header(requester))
    assert resp.status_code == 400
    assert "PO approver" in resp.json()["detail"]
