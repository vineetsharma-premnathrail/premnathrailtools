"""Tests for Phase 2 of the shared Item master unification: linking P2P
request/PO line items to app.modules.item.models.item.Item via a nullable,
non-blocking item_id (mirrors the existing stock_item_id bridge)."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.item.models.item import Item

P2P_BASE = "/api/v1/p2p/requests"
PO_BASE = "/api/v1/p2p/purchase-orders"
ITEMS_BASE = "/api/v1/items"


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


def _make_item(db, code="ITM-001", name="Demo Item", unit="pcs", part_no=None):
    item = Item(item_code=code, item_name=name, unit_of_measure=unit, manufacturer_part_number=part_no)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _create_payload(**overrides):
    payload = {
        "category_code": "OTH",
        "project_label": "Project Alpha",
        "priority": "medium",
        "items": [{"item_name": "Hydraulic Cylinder", "quantity": 2, "unit": "pcs"}],
    }
    payload.update(overrides)
    return payload


def _create_pr(client, requester, **overrides):
    return client.post(P2P_BASE, json=_create_payload(**overrides), headers=auth_header(requester)).json()


# ── Items route now allows p2p access ──────────────────────────────────────

def test_items_list_allows_p2p_app_access(client, db):
    user = _requester(db, "p2puser@premnathrail.com")
    response = client.get(ITEMS_BASE, headers=auth_header(user))
    assert response.status_code == 200


def test_items_list_still_rejects_unrelated_app(client, db):
    outsider = make_user(db, "outsider@premnathrail.com", assigned_apps=("erp",))
    response = client.get(ITEMS_BASE, headers=auth_header(outsider))
    assert response.status_code == 403


# ── P2PRequestItem.item_id ──────────────────────────────────────────────────

def test_create_pr_item_with_item_id_persists(client, db):
    item = _make_item(db, "ITM-100", "Hydraulic Cylinder")
    requester = _requester(db, "reqi1@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"item_name": item.item_name, "quantity": 3, "unit": "pcs", "item_id": item.id},
    ])
    assert pr["items"][0]["item_id"] == item.id


def test_create_pr_item_without_item_id_defaults_to_none(client, db):
    requester = _requester(db, "reqi2@premnathrail.com")
    pr = _create_pr(client, requester)
    assert pr["items"][0]["item_id"] is None


# ── PO auto-generated from a PR carries item_id forward ─────────────────────

def test_po_created_from_pr_carries_item_id(client, db):
    item = _make_item(db, "ITM-200", "Bolt")
    requester = _requester(db, "reqi3@premnathrail.com")
    pr = _create_pr(client, requester, items=[
        {"item_name": "Bolt", "quantity": 5, "unit": "pcs", "item_id": item.id},
        {"item_name": "Unlinked Nut", "quantity": 5, "unit": "pcs"},
    ])
    buyer = _purchaser(db, "buyeri3@premnathrail.com")
    client.post(f"{P2P_BASE}/{pr['id']}/approve", headers=auth_header(buyer))
    create_po_resp = client.post(
        f"{P2P_BASE}/{pr['id']}/create-po", json={"po_number": "PO-ITM-1"}, headers=auth_header(buyer),
    )
    assert create_po_resp.status_code == 200

    pos = client.get(PO_BASE, params={"search": "PO-ITM-1"}, headers=auth_header(buyer)).json()
    assert len(pos) == 1
    po_items = {i["item_name"]: i["item_id"] for i in pos[0]["items"]}
    assert po_items["Bolt"] == item.id
    assert po_items["Unlinked Nut"] is None


# ── Ad-hoc PO creation also accepts item_id ─────────────────────────────────

def test_ad_hoc_po_create_persists_item_id(client, db):
    item = _make_item(db, "ITM-300", "Gasket")
    buyer = _purchaser(db, "buyeri4@premnathrail.com")
    response = client.post(PO_BASE, json={
        "po_date": "2026-01-01",
        "items": [{"item_name": "Gasket", "quantity": 10, "unit": "pcs", "item_id": item.id}],
    }, headers=auth_header(buyer))
    assert response.status_code == 200
    assert response.json()["items"][0]["item_id"] == item.id
