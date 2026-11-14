"""Procurement > Settings: no buyer settings in the generic list. The Default
buyer (2026-11-06) and "Buyer for each item type" were removed on 2026-11-14 —
a requisition line's buyer comes only from Buyer responsibility (Item Master
category -> buyer, its own card). The 2026-10-26 "Buyer by category" settings
are gone too."""
from app.auth.jwt_handler import create_access_token
from app.tests.test_p2p_requests import make_user

URL = "/api/v1/p2p/settings"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _admin(db):
    return make_user(db, "req.admin@premnathrail.com", role="admin")


def test_no_default_item_type_or_category_buyer_settings(client, db):
    body = client.get(URL, headers=_h(_admin(db))).json()
    specs = {s["key"]: s for s in body["specs"]}
    assert "default_buyer" not in specs and "default_buyer" not in body["values"]
    assert not [k for k in specs if k.startswith("buyer_")]
    assert not {"buyers", "line_buyers"} & {g["key"] for g in body["groups"]}
    assert specs["rfq_quote_days"]["required"] is False


def test_saving_the_removed_default_buyer_is_refused(client, db):
    admin = _admin(db)
    buyer = make_user(db, "req.buyer@premnathrail.com", assigned_apps=("p2p",))
    r = client.put(URL, json={"values": {"default_buyer": buyer.id}}, headers=_h(admin))
    assert r.status_code in (400, 422), r.text


def test_non_editor_denied(client, db):
    u = make_user(db, "req.plain@premnathrail.com", assigned_apps=("p2p",))
    r = client.put(URL, json={"values": {"rfq_quote_days": 5}}, headers=_h(u))
    assert r.status_code == 403
