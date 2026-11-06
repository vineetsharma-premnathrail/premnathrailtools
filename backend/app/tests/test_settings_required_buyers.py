"""Procurement > Settings: the required Default buyer (2026-11-06). Replaces the
2026-10-26 "Buyer by category" settings, which are gone."""
from app.auth.jwt_handler import create_access_token
from app.tests.test_p2p_requests import make_user

URL = "/api/v1/p2p/settings"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _admin(db):
    return make_user(db, "req.admin@premnathrail.com", role="admin")


def test_default_buyer_spec_is_required_and_old_category_buyers_are_gone(client, db):
    body = client.get(URL, headers=_h(_admin(db))).json()
    specs = {s["key"]: s for s in body["specs"]}
    assert specs["default_buyer"]["required"] is True and specs["default_buyer"]["group"] == "line_buyers"
    assert specs["rfq_quote_days"]["required"] is False
    assert body["values"]["default_buyer"] is None
    assert not [k for k in specs if k.startswith("buyer_") and not k.startswith("buyer_type_")]
    assert "buyers" not in [g["key"] for g in body["groups"]]
    # Item type buyers are optional now: blank falls through to the default buyer.
    assert all(specs[k]["required"] is False for k in specs if k.startswith("buyer_type_"))


def test_default_buyer_cannot_be_saved_blank(client, db):
    admin = _admin(db)
    for blank in (None, ""):
        r = client.put(URL, json={"values": {"default_buyer": blank}}, headers=_h(admin))
        assert r.status_code == 422
        assert "Default buyer: pick a person — this setting can't be left blank." in r.json()["detail"]


def test_default_buyer_must_be_a_buyer_and_can_be_saved(client, db):
    from app.tests.test_erp_service_requests import make_user as erp_user
    admin = _admin(db)
    buyer = make_user(db, "req.buyer@premnathrail.com", assigned_apps=("p2p",))
    outsider = erp_user(db, "req.outsider@premnathrail.com")
    r = client.put(URL, json={"values": {"default_buyer": outsider.id}}, headers=_h(admin))
    assert r.status_code == 422 and "no access to the p2p or purchase module" in r.json()["detail"]
    r = client.put(URL, json={"values": {"default_buyer": buyer.id}}, headers=_h(admin))
    assert r.status_code == 200 and r.json()["values"]["default_buyer"] == buyer.id
    # Required with no default to go back to: reset is refused with the way forward.
    r = client.post(f"{URL}/reset/default_buyer", headers=_h(admin))
    assert r.status_code == 422 and "pick a person instead" in r.json()["detail"]


def test_non_editor_denied(client, db):
    u = make_user(db, "req.plain@premnathrail.com", assigned_apps=("p2p",))
    r = client.put(URL, json={"values": {"default_buyer": u.id}}, headers=_h(u))
    assert r.status_code == 403
