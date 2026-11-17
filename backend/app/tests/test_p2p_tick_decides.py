"""Procurement: the role-matrix tick ALONE decides (owner decision 2026-11-14).

Every p2p tab / route follows its own tab or feature grant. "Purchase Desk"
(p2p:purchase_desk:view) no longer gates visibility; it is only a requisition
data-scope right. These users are built WITHOUT assigned_apps, so they get
exactly the grants listed (deny by default)."""
from itertools import count

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User

API = "/api/v1/p2p"
DESK = "p2p:purchase_desk:view"
_seq = count(1)


def _user(db, grants=()):
    n = next(_seq)
    u = User(email=f"tick.p2p{n}@premnathrail.com", name=f"tick{n}", role="user", is_active=True,
             assigned_apps=[], granular_permissions=list(grants), department="Purchase")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _no_desk(u):
    assert "purchase" not in u.get_apps(), "test user must not hold the Purchase Desk"


# (grants that open it, method, path, expected status with the grant)
CASES = {
    "vendors list": (["p2p:vendors:view"], "get", f"{API}/vendors", 200),
    "item rates": (["p2p:vendors:view"], "get", f"{API}/info-records", 200),
    "rfq list": (["p2p:rfq:view"], "get", f"{API}/rfqs", 200),
    # Create passes the gate; the made-up requisition then is 404 (not 403).
    "rfq create": (["p2p:rfq:view", "p2p:rfq:create"], "post", f"{API}/rfqs", 404),
    "rfq detail": (["p2p:rfq:view"], "get", f"{API}/rfqs/987654", 404),
    "po list": (["p2p:purchase_orders:view"], "get", f"{API}/purchase-orders", 200),
    "po tracking": (["p2p:purchase_orders:view"], "get", f"{API}/po-reports/tracking", 200),
    "po tracking filters": (["p2p:purchase_orders:view"], "get", f"{API}/po-reports/tracking/filters", 200),
    "po detail": (["p2p:purchase_orders:view"], "get", f"{API}/purchase-orders/987654", 404),
    "po amendments": (["p2p:purchase_orders:view"], "get", f"{API}/purchase-orders/987654/amendments", 404),
    "before-po list": (["p2p:purchase_orders:view"], "get", f"{API}/pre-po-receipts/pending", 200),
    "mis summary": (["p2p:mis:view"], "get", f"{API}/mis/summary?period=weekly", 200),
}


@pytest.mark.parametrize("name", list(CASES))
def test_tab_grant_alone_opens_the_route(client, db, name):
    grants, method, path, expected = CASES[name]
    u = _user(db, grants)
    _no_desk(u)
    kwargs = {"json": {"p2p_request_id": 987654}} if method == "post" else {}
    r = getattr(client, method)(path, headers=_h(u), **kwargs)
    assert r.status_code == expected, f"{name}: {r.status_code} {r.text}"


@pytest.mark.parametrize("name", list(CASES))
def test_without_the_grant_the_route_is_refused_even_with_purchase_desk(client, db, name):
    _grants, method, path, _expected = CASES[name]
    # The Purchase Desk plus an unrelated Procurement tab: neither opens this route any more.
    other = "p2p:settings:view"
    u = _user(db, [DESK, other] if "vendors" not in path and "info-records" not in path else [other])
    kwargs = {"json": {"p2p_request_id": 987654}} if method == "post" else {}
    r = getattr(client, method)(path, headers=_h(u), **kwargs)
    assert r.status_code == 403, f"{name}: {r.status_code} {r.text}"


def test_mis_needs_no_approver_flag_or_desk(client, db):
    u = _user(db, ["p2p:mis:view"])
    assert not (u.is_purchase_head or u.is_director or u.is_partner)
    assert client.get(f"{API}/mis/summary?period=weekly", headers=_h(u)).status_code == 200
    # Export follows its own tick.
    assert client.get(f"{API}/mis/export?period=weekly", headers=_h(u)).status_code == 403


def test_rfq_view_without_create_cannot_start_an_rfq(client, db):
    u = _user(db, ["p2p:rfq:view"])
    r = client.post(f"{API}/rfqs", json={"p2p_request_id": 987654}, headers=_h(u))
    assert r.status_code == 403 and "R.F.Q" in r.json()["detail"], r.text
