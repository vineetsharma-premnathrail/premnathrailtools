"""Procurement › Settings › Buyer for each requisition category never blank
(2026-10-26): standard buyers pre-filled, the other four categories required."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.tests.test_p2p_requests import make_user

URL = "/api/v1/p2p/settings"
NO_STANDARD = ("srv", "adm", "cap", "oth")
STANDARD = ("mkt", "pnh", "raw", "ele", "hwc", "job")


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _admin(db):
    return make_user(db, "req.admin@premnathrail.com", role="admin")


def test_standard_buyer_prefilled_and_specs_required(client, db):
    ele = make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    body = client.get(URL, headers=_h(_admin(db))).json()
    specs = {s["key"]: s for s in body["specs"]}
    for c in STANDARD + NO_STANDARD:
        assert specs[f"buyer_{c}"]["required"] is True
        assert "default_resolver" not in specs[f"buyer_{c}"]
        assert "Blank" not in specs[f"buyer_{c}"]["help"]
    assert specs["rfq_quote_days"]["required"] is False
    assert body["values"]["buyer_ele"] == ele.id
    assert body["is_default"]["buyer_ele"] is True
    assert body["values"]["buyer_mkt"] is None  # standard buyer not a user here: no crash
    for c in NO_STANDARD:
        assert body["values"][f"buyer_{c}"] is None


def test_inactive_standard_buyer_not_shown(client, db):
    u = make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    u.is_active = False
    db.commit()
    assert client.get(URL, headers=_h(_admin(db))).json()["values"]["buyer_ele"] is None


@pytest.mark.parametrize("blank", [None, ""])
def test_required_buyer_cannot_be_saved_blank(client, db, blank):
    r = client.put(URL, json={"values": {"buyer_srv": blank}}, headers=_h(_admin(db)))
    assert r.status_code == 422
    assert "Services (SRV): pick a person — this setting can't be left blank." in r.json()["detail"]


def test_reset_rules(client, db):
    admin = _admin(db)
    ele = make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    other = make_user(db, "req.other@premnathrail.com", assigned_apps=("p2p",))
    h = _h(admin)
    assert client.put(URL, json={"values": {"buyer_ele": other.id, "buyer_srv": other.id}}, headers=h).status_code == 200
    # standard category: reset allowed, standard buyer shows again
    r = client.post(f"{URL}/reset/buyer_ele", headers=h)
    assert r.status_code == 200
    assert r.json()["values"]["buyer_ele"] == ele.id
    assert r.json()["is_default"]["buyer_ele"] is True
    # no standard buyer: reset refused
    r = client.post(f"{URL}/reset/buyer_srv", headers=h)
    assert r.status_code == 422
    assert "pick a person instead" in r.json()["detail"]


def test_resolve_auto_buyer_id_unchanged(db):
    from app.modules.p2p.models.p2p_request import resolve_auto_buyer_id
    ele = make_user(db, "manish.kumar@premnathrail.com", assigned_apps=("p2p",))
    assert resolve_auto_buyer_id(db, "ELE") == ele.id
    assert resolve_auto_buyer_id(db, "SRV") is None


def test_non_editor_denied(client, db):
    u = make_user(db, "req.plain@premnathrail.com", assigned_apps=("p2p",))
    r = client.put(URL, json={"values": {"buyer_srv": u.id}}, headers=_h(u))
    assert r.status_code == 403
