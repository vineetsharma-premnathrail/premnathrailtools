"""Store → Settings deletes: a master row can be deleted only while unused."""
import pytest
from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token


@pytest.fixture
def h(db):
    u = User(email="store.admin@example.com", name="Store Admin", role="admin", is_active=True, assigned_apps=["store"])
    db.add(u)
    db.commit()
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def test_uom_delete_only_when_unused(client, h):
    client.post("/api/v1/store/uoms", json={"code": "BOX", "label": "Box"}, headers=h)
    client.post("/api/v1/store/items", json={"item_name": "Gloves", "uom": "BOX"}, headers=h)
    r = client.delete("/api/v1/store/uoms/BOX", headers=h)
    assert r.status_code == 409 and "1 store item" in r.json()["detail"]
    client.post("/api/v1/store/uoms", json={"code": "ROLL", "label": "Roll"}, headers=h)
    r = client.delete("/api/v1/store/uoms/ROLL", headers=h)
    assert r.status_code == 200 and "ROLL" not in [o["value"] for o in r.json()]


def test_item_type_delete_rules(client, h):
    assert client.delete("/api/v1/store/item-types/material", headers=h).status_code == 409
    types = client.post("/api/v1/store/item-types", json={"label": "Packing"}, headers=h).json()
    value = next(t["value"] for t in types if t["label"] == "Packing")
    client.post("/api/v1/store/items", json={"item_name": "Carton", "uom": "NOS", "item_type": value}, headers=h)
    assert client.delete(f"/api/v1/store/item-types/{value}", headers=h).status_code == 409
    types = client.post("/api/v1/store/item-types", json={"label": "Samples"}, headers=h).json()
    value = next(t["value"] for t in types if t["label"] == "Samples")
    assert client.delete(f"/api/v1/store/item-types/{value}", headers=h).status_code == 200


def test_doc_type_delete_rules(client, h):
    # Issue types are a fixed list (2026-10-12): none can be added or deleted.
    add = client.post("/api/v1/store/doc-types/issue", json={"label": "Trial run"}, headers=h)
    assert add.status_code == 409 and "fixed in code" in add.json()["detail"]
    assert client.delete("/api/v1/store/doc-types/issue/rework", headers=h).status_code == 409
    r = client.delete("/api/v1/store/doc-types/return_condition/good", headers=h)
    assert r.status_code == 409 and "deactivate" in r.json()["detail"]
