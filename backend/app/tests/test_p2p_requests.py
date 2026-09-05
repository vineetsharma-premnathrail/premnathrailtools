"""Tests for the standalone Purchase Requisition module (app.modules.p2p).

The now-deleted app.modules.purchase used to handle PRs raised from a Service
Request's materials list separately — those are now created directly as
P2PRequest rows too (see erp/routes/service_requests.py), so this module
covers both the self-service PR pipeline and ERP-raised PRs.
"""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

BASE = "/api/v1/p2p/requests"


def make_user(db, email, role="user", assigned_apps=(), department=None):
    user = User(
        email=email, name=email.split("@")[0], role=role, is_active=True,
        assigned_apps=list(assigned_apps), department=department,
    )
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


def _create_payload(**overrides):
    payload = {
        "category_code": "RAW",
        "project_label": "Project Alpha",
        "priority": "medium",
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs"}],
    }
    payload.update(overrides)
    return payload


def _create_pr(client, requester, **overrides):
    return client.post(BASE, json=_create_payload(**overrides), headers=auth_header(requester)).json()


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
    buyer = _purchaser(db, "buyerj@premnathrail.com")
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))

    response = client.get(f"{BASE}/{pr['id']}/audit", headers=auth_header(requester))
    assert response.status_code == 200
    actions = [e["action"] for e in response.json()]
    assert actions == ["created", "approved"]
    assert response.json()[1]["old_status"] == "submitted"
    assert response.json()[1]["new_status"] == "approved"


# ── Approve / reject / cancel ────────────────────────────────────────────────

def test_approve_requires_purchase_app(client, db):
    requester = _requester(db, "reqk@premnathrail.com")
    pr = _create_pr(client, requester)
    response = client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(requester))
    assert response.status_code == 403


def test_approve_only_from_submitted(client, db):
    requester = _requester(db, "reql@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerl@premnathrail.com")

    first = client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))
    assert first.status_code == 200
    assert first.json()["status"] == "approved"
    assert first.json()["approved_by_id"] == buyer.id

    second = client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))
    assert second.status_code == 409


def test_reject_from_submitted_or_approved(client, db):
    requester = _requester(db, "reqm@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerm@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/reject", json={"reason": "Duplicate request"}, headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["rejected_reason"] == "Duplicate request"


def test_reject_terminal_status_fails(client, db):
    requester = _requester(db, "reqn@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyern@premnathrail.com")
    client.post(f"{BASE}/{pr['id']}/reject", json={}, headers=auth_header(buyer))

    response = client.post(f"{BASE}/{pr['id']}/reject", json={}, headers=auth_header(buyer))
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
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))
    client.post(f"{BASE}/{pr['id']}/create-po", json={"po_number": "PO-1"}, headers=auth_header(buyer))

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
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(manager))

    response = client.post(f"{BASE}/{pr['id']}/assign-buyer", json={"assigned_buyer_id": buyer.id}, headers=auth_header(manager))
    assert response.status_code == 200
    assert response.json()["assigned_buyer_id"] == buyer.id
    assert response.json()["assigned_buyer_name"] == buyer.name
    assert response.json()["assignment_date"] is not None


def test_assign_buyer_unknown_buyer_404s(client, db):
    requester = _requester(db, "requ@premnathrail.com")
    pr = _create_pr(client, requester)
    manager = _purchaser(db, "manageru@premnathrail.com")
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(manager))

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
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))

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
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))

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


def test_create_po_defaults_ordered_quantity_to_item_sum(client, db):
    requester = _requester(db, "reqaa@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"item_name": "Bolt", "quantity": 5, "unit": "pcs"},
        {"item_name": "Nut", "quantity": 5, "unit": "pcs"},
    ])
    buyer = _purchaser(db, "buyeraa@premnathrail.com")
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))

    response = client.post(f"{BASE}/{pr['id']}/create-po", json={"po_number": "PO-100", "po_value": 999.5}, headers=auth_header(buyer))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "po_raised"
    assert body["po_number"] == "PO-100"
    assert body["ordered_quantity"] == 10
    assert body["po_value"] == 999.5


def test_create_po_respects_explicit_ordered_quantity(client, db):
    requester = _requester(db, "reqab@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerab@premnathrail.com")
    client.post(f"{BASE}/{pr['id']}/approve", headers=auth_header(buyer))

    response = client.post(
        f"{BASE}/{pr['id']}/create-po",
        json={"po_number": "PO-2", "ordered_quantity": 7},
        headers=auth_header(buyer),
    )
    assert response.json()["ordered_quantity"] == 7


# ── Receiving ────────────────────────────────────────────────────────────────

def _approve_and_raise_po(client, db, pr_id, buyer, ordered_quantity=None):
    """Approve the PR, raise a PO, then clear all three PO-approval roles
    (purchase_head, director, md — all required, see P2PRequest.pending_po_approval_roles)
    so the PR reaches 'po_approved' and receiving can proceed."""
    client.post(f"{BASE}/{pr_id}/approve", headers=auth_header(buyer))
    payload = {"po_number": "PO-REC"}
    if ordered_quantity is not None:
        payload["ordered_quantity"] = ordered_quantity
    client.post(f"{BASE}/{pr_id}/create-po", json=payload, headers=auth_header(buyer))

    resp = None
    for role_flag in ("is_purchase_head", "is_director", "is_md"):
        approver = make_user(db, f"{role_flag}.{pr_id}@premnathrail.com", assigned_apps=("purchase",))
        setattr(approver, role_flag, True)
        db.commit()
        resp = client.post(f"{BASE}/{pr_id}/approve-po", headers=auth_header(approver))
        assert resp.status_code == 200, resp.text
    return resp.json()


def test_update_receipt_requires_po_raised_or_partial(client, db):
    requester = _requester(db, "reqac@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerac@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 1}, headers=auth_header(buyer))
    assert response.status_code == 409


def test_partial_receipt_moves_to_partially_received(client, db):
    requester = _requester(db, "reqad@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr"}])
    buyer = _purchaser(db, "buyerad@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)

    response = client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 4}, headers=auth_header(buyer))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "partially_received"
    assert body["receipt_status"] == "partial"
    assert body["received_quantity"] == 4
    assert body["pending_quantity"] == 6


def test_full_receipt_moves_to_received(client, db):
    requester = _requester(db, "reqae@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr"}])
    buyer = _purchaser(db, "buyerae@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)

    response = client.post(
        f"{BASE}/{pr['id']}/update-receipt",
        json={"received_quantity": 10, "grn_number": "GRN-1"},
        headers=auth_header(buyer),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "received"
    assert body["receipt_status"] == "received"
    assert body["pending_quantity"] == 0
    assert body["grn_number"] == "GRN-1"


def test_receipt_quantity_clamped_to_ordered_quantity(client, db):
    requester = _requester(db, "reqaf@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 5, "unit": "mtr"}])
    buyer = _purchaser(db, "buyeraf@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)

    response = client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 999}, headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["received_quantity"] == 5
    assert response.json()["status"] == "received"


def test_second_partial_receipt_can_complete_the_order(client, db):
    requester = _requester(db, "reqag@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 10, "unit": "mtr"}])
    buyer = _purchaser(db, "buyerag@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)

    client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 6}, headers=auth_header(buyer))
    response = client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 10}, headers=auth_header(buyer))
    assert response.json()["status"] == "received"


# ── Close ────────────────────────────────────────────────────────────────────

def test_close_requires_received_status(client, db):
    requester = _requester(db, "reqah@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyerah@premnathrail.com")

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(buyer))
    assert response.status_code == 409


def test_close_success(client, db):
    requester = _requester(db, "reqai@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 3, "unit": "mtr"}])
    buyer = _purchaser(db, "buyerai@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)
    client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 3}, headers=auth_header(buyer))

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert response.json()["closed_by_id"] == buyer.id
    assert response.json()["closed_at"] is not None


def test_close_requires_purchase_app(client, db):
    requester = _requester(db, "reqaj@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"item_name": "Cable", "quantity": 1, "unit": "mtr"}])
    buyer = _purchaser(db, "buyeraj@premnathrail.com")
    _approve_and_raise_po(client, db, pr["id"], buyer)
    client.post(f"{BASE}/{pr['id']}/update-receipt", json={"received_quantity": 1}, headers=auth_header(buyer))

    response = client.post(f"{BASE}/{pr['id']}/close", headers=auth_header(requester))
    assert response.status_code == 403


# ── Manual update (purchase-only header edit / status override) ────────────

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


def test_update_status_writes_audit_entry(client, db):
    requester = _requester(db, "reqan@premnathrail.com")
    pr = _create_pr(client, requester)
    buyer = _purchaser(db, "buyeran@premnathrail.com")

    client.patch(f"{BASE}/{pr['id']}", json={"status": "cancelled"}, headers=auth_header(buyer))
    audit = client.get(f"{BASE}/{pr['id']}/audit", headers=auth_header(buyer)).json()
    assert any(e["action"] == "status_changed" for e in audit)


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
