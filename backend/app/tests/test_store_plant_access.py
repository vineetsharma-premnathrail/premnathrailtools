"""Plant-wise Store visibility on the central data scope (the old Store ›
Settings › Plant Access list moved to Organization › Role & Permissions):
a plant-scoped Store user sees and posts stock only in their plant's stores,
multi-plant adds their Branch assignments, admins see every plant; Store
documents (transfers, adjustments …) follow the same scope.
`migrate_store_plant_access` converts the old per-user list."""
import pytest
from sqlalchemy.orm import object_session

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.setting import STORE_SETTING_PLANT_ACCESS, StoreSetting
from app.modules.store.services.plant_access import migrate_store_plant_access
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/store"


def _headers(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


@pytest.fixture
def setup(db):
    p1, p2 = Branch(name="Unit 1", code="U1"), Branch(name="Unit 2", code="U2")
    db.add_all([p1, p2])
    db.flush()
    s1 = StoreLocation(name="U1 Main Store", code="U1-MS", branch_id=p1.id)
    s2 = StoreLocation(name="U2 Main Store", code="U2-MS", branch_id=p2.id)
    item = StoreItem(item_code="MT-GEN-0001", item_name="Bolt M12", uom="NOS")
    admin = User(email="admin@premnathrail.com", name="admin", role="admin", is_active=True)
    keeper = User(email="keeper1@premnathrail.com", name="keeper1", role="user", is_active=True, assigned_apps=["store"], branch_id=p1.id)
    keeper2 = User(email="keeper2@premnathrail.com", name="keeper2", role="user", is_active=True, assigned_apps=["store"], branch_id=p2.id)
    db.add_all([s1, s2, item, admin, keeper, keeper2])
    db.flush()
    s1.manager_user_id = keeper.id
    s2.manager_user_id = keeper2.id
    for loc in (s1, s2):
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=10)
    db.commit()
    return {"p1": p1, "p2": p2, "s1": s1, "s2": s2, "item": item, "admin": _headers(admin), "keeper": _headers(keeper),
            "keeper2": _headers(keeper2), "keeper_user": keeper, "keeper2_user": keeper2}


def _scope(user: User, level: str) -> None:
    user.data_access_scopes = {**(user.data_access_scopes or {}), "store": level}
    object_session(user).commit()


def _store_names(client, h, path="/stock/balances", key="location_name"):
    return sorted(r[key] for r in client.get(f"{API}{path}", headers=h).json())


def test_organization_scope_by_default_sees_every_plant(client, setup):
    assert _store_names(client, setup["keeper"]) == ["U1 Main Store", "U2 Main Store"]
    assert client.get(f"{API}/settings/plant-access/me", headers=setup["keeper"]).json() == {"restricted": False, "plant_names": []}


def test_plant_scope_sees_only_own_plant_admin_sees_all(client, setup):
    _scope(setup["keeper_user"], "plant")
    assert _store_names(client, setup["keeper"]) == ["U1 Main Store"]
    assert _store_names(client, setup["keeper"], "/locations", "name") == ["U1 Main Store"]
    assert _store_names(client, setup["admin"]) == ["U1 Main Store", "U2 Main Store"]
    # Inter-unit transfer destination picker still lists every plant's store.
    every = client.get(f"{API}/locations", params={"all_plants": True}, headers=setup["keeper"]).json()
    assert sorted(loc["name"] for loc in every) == ["U1 Main Store", "U2 Main Store"]
    me = client.get(f"{API}/settings/plant-access/me", headers=setup["keeper"]).json()
    assert me == {"restricted": True, "plant_names": ["Unit 1"]}


def test_plant_scope_cannot_post_in_another_plants_store(client, setup):
    # Manual stock entry is removed (2026-10-12) — a Material Issue is the posting document here.
    _scope(setup["keeper_user"], "plant")
    body = {"issue_type": "production", "items": [{"item_id": setup["item"].id, "quantity": 1}]}
    blocked = client.post(f"{API}/material-issues", json={**body, "location_id": setup["s2"].id}, headers=setup["keeper"])
    assert blocked.status_code == 403 and "Store data access" in blocked.json()["detail"]
    ok = client.post(f"{API}/material-issues", json={**body, "location_id": setup["s1"].id}, headers=setup["keeper"])
    assert ok.status_code == 200, ok.text


def test_multi_plant_scope_adds_branch_assignments(client, db, setup):
    _scope(setup["keeper_user"], "multi_plant")
    assert _store_names(client, setup["keeper"]) == ["U1 Main Store"]
    db.add(BranchUserAssignment(branch_id=setup["p2"].id, user_id=setup["keeper_user"].id, status="active"))
    db.commit()
    assert _store_names(client, setup["keeper"]) == ["U1 Main Store", "U2 Main Store"]


def test_documents_follow_the_store_scope(client, setup):
    """A transfer U1 → U2 is seen by both plants' keepers; an adjustment only in its own plant."""
    t = client.post(f"{API}/stock-transfers", json={
        "from_location_id": setup["s1"].id, "to_location_id": setup["s2"].id,
        "items": [{"item_id": setup["item"].id, "quantity": 1}]}, headers=setup["keeper"])
    assert t.status_code == 200, t.text
    adj = client.post(f"{API}/stock-adjustments", json={
        "location_id": setup["s2"].id, "approved_by_id": setup["keeper2_user"].id,
        "items": [{"item_id": setup["item"].id, "actual_quantity": 9}]}, headers=setup["admin"])
    assert adj.status_code == 200, adj.text
    _scope(setup["keeper_user"], "plant")
    _scope(setup["keeper2_user"], "plant")
    for h in (setup["keeper"], setup["keeper2"]):
        assert [x["id"] for x in client.get(f"{API}/stock-transfers", headers=h).json()] == [t.json()["id"]]
    assert client.get(f"{API}/stock-adjustments", headers=setup["keeper"]).json() == []
    blocked = client.get(f"{API}/stock-adjustments/{adj.json()['id']}", headers=setup["keeper"])
    assert blocked.status_code == 403 and "outside your data access" in blocked.json()["detail"]
    # keeper2 is the approver (and in the plant): sees it.
    assert [x["id"] for x in client.get(f"{API}/stock-adjustments", headers=setup["keeper2"]).json()] == [adj.json()["id"]]


def test_migrate_store_plant_access(db, setup):
    other = User(email="keeper3@premnathrail.com", name="keeper3", role="user", is_active=True, assigned_apps=["store"],
                 branch_id=setup["p1"].id)
    central = User(email="central@premnathrail.com", name="central", role="user", is_active=True, assigned_apps=["store"])
    db.add_all([other, central])
    db.flush()
    db.add(StoreSetting(key=STORE_SETTING_PLANT_ACCESS, value={"enabled": True, "users": {
        str(setup["keeper2_user"].id): {"all_plants": False, "branch_ids": [setup["p2"].id]},
        str(other.id): {"all_plants": False, "branch_ids": [setup["p1"].id, setup["p2"].id]},
        str(central.id): {"all_plants": True, "branch_ids": []},
    }}))
    db.commit()
    out = migrate_store_plant_access(db.get_bind())
    assert out["enabled"] and out["assignments_added"] == 1
    db.expire_all()
    scopes = {u.email: (u.data_access_scopes or {}).get("store") for u in db.query(User).all()}
    assert scopes["keeper1@premnathrail.com"] == "plant"     # no entry → own plant
    assert scopes["keeper2@premnathrail.com"] == "plant"     # only own plant listed
    assert scopes["keeper3@premnathrail.com"] == "multi_plant"
    assert scopes["central@premnathrail.com"] == "organization"
    assert scopes["admin@premnathrail.com"] is None          # admins are always organization-wide
    assert db.query(BranchUserAssignment).filter_by(user_id=other.id, branch_id=setup["p2"].id, status="active").count() == 1
    assert migrate_store_plant_access(db.get_bind())["enabled"] is False  # marked migrated → idempotent
