"""Store tab permissions (deny by default): view-only users can't write,
delete needs 'delete' + being the creator, and item / store lookups stay
open to other modules' users."""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.category import StoreItemCategory

API = "/api/v1/store"


def _user(db, email, grants, role="user"):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, granular_permissions=list(grants))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def admin(db):
    return _user(db, "rbac.admin@premnathrail.com", [], role="admin")


@pytest.fixture
def item(client, admin):
    r = client.post(f"{API}/items", json={"item_name": "Bolt M8", "uom": "NOS"}, headers=_h(admin))
    assert r.status_code == 200, r.text
    return r.json()


def test_view_only_user_cannot_create_edit_or_delete_items(client, db, item):
    viewer = _user(db, "rbac.viewer@premnathrail.com", ["store:items:view"])
    h = _h(viewer)
    assert client.get(f"{API}/items", headers=h).status_code == 200
    assert client.get(f"{API}/items/{item['id']}", headers=h).status_code == 200
    r = client.post(f"{API}/items", json={"item_name": "Nut", "uom": "NOS"}, headers=h)
    assert r.status_code == 403 and "'create' permission on store › items" in r.json()["detail"].lower()
    assert client.patch(f"{API}/items/{item['id']}", json={"item_name": "X"}, headers=h).status_code == 403
    r = client.delete(f"{API}/items/{item['id']}", headers=h)
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()
    assert client.get(f"{API}/items/export", headers=h).status_code == 403


def test_view_only_user_cannot_write_settings_masters(client, db):
    viewer = _user(db, "rbac.settings@premnathrail.com", ["store:uoms:view", "store:categories:view", "store:entry_types:view"])
    h = _h(viewer)
    assert client.post(f"{API}/uoms", json={"code": "BAG", "label": "Bag"}, headers=h).status_code == 403
    assert client.post(f"{API}/categories", json={"name": "Fasteners"}, headers=h).status_code == 403
    assert client.post(f"{API}/doc-types/stock_entry", json={"label": "Found", "stock_effect": "in"}, headers=h).status_code == 403
    # Issue Rules settings were retired (2026-10-12) — the per-type form standard replaced them.
    assert client.put(f"{API}/settings/issue-rules", json={}, headers=h).status_code in (404, 405)


def test_movements_and_adjustment_decisions_need_their_tab(client, db):
    stock_only = _user(db, "rbac.stock@premnathrail.com", ["store:stock:view"])
    h = _h(stock_only)
    assert client.get(f"{API}/stock/balances", headers=h).status_code == 200
    assert client.get(f"{API}/stock/transactions", headers=h).status_code == 403
    assert client.get(f"{API}/stock-adjustments", headers=h).status_code == 403
    assert client.post(f"{API}/stock-adjustments/1/approve", headers=h).status_code == 403
    assert client.post(f"{API}/stock/transactions", json={"item_id": 1, "location_id": 1, "quantity": 1,
                                                          "transaction_type": "receipt"}, headers=h).status_code == 403


def test_other_module_user_can_still_look_up_items_and_stores(client, db, item):
    prod = _user(db, "rbac.prod@premnathrail.com", ["production:work_orders:view"])
    h = _h(prod)
    assert client.get(f"{API}/items", headers=h).status_code == 200
    assert client.get(f"{API}/items/{item['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/locations", headers=h).status_code == 200
    assert client.get(f"{API}/categories", headers=h).status_code == 200
    # …but not the Store item master's write paths.
    assert client.post(f"{API}/items", json={"item_name": "Nut", "uom": "NOS"}, headers=h).status_code == 403


def test_delete_needs_delete_grant_and_being_the_creator(client, db, admin, monkeypatch):
    deleter = _user(db, "rbac.deleter@premnathrail.com", ["store:categories:view", "store:categories:delete"])
    other = _user(db, "rbac.other@premnathrail.com", [])
    h = _h(deleter)
    mine = client.post(f"{API}/categories", json={"name": "Mine"}, headers=_h(admin)).json()
    theirs = client.post(f"{API}/categories", json={"name": "Theirs"}, headers=_h(admin)).json()

    # Store categories carry no creator column; simulate one to prove the
    # endpoint applies the company owner rule through ensure_can_delete.
    owners = {mine["id"]: deleter.id, theirs["id"]: other.id}
    monkeypatch.setattr(StoreItemCategory, "created_by_id", property(lambda self: owners.get(self.id)), raising=False)

    r = client.delete(f"{API}/categories/{theirs['id']}", headers=h)
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]
    assert client.delete(f"{API}/categories/{mine['id']}", headers=h).status_code == 200
    # An admin deletes anyone's record.
    assert client.delete(f"{API}/categories/{theirs['id']}", headers=_h(admin)).status_code == 200
