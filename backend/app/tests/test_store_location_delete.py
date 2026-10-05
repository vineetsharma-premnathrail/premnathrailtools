"""Stores are no longer auto-created per branch, and a branch/company default
no longer blocks deleting a store — only recorded stock history does."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.location import StoreLocation


def _admin(db):
    user = User(email="loc-admin@premnathrail.com", name="Admin", role="admin", is_active=True, assigned_apps=["store"])
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}"}


def test_new_branch_gets_no_store(client, db):
    headers = _admin(db)
    resp = client.post("/api/v1/organization/branches", json={"name": "Unit 9", "code": "U9"}, headers=headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["default_warehouse_id"] is None
    assert db.query(StoreLocation).count() == 0


def test_branch_default_store_can_be_deleted(client, db):
    headers = _admin(db)
    loc_id = client.post("/api/v1/store/locations", json={"name": "Old", "code": "OLD"}, headers=headers).json()["id"]
    branch = Branch(name="Unit 8", code="U8", default_warehouse_id=loc_id)
    db.add(branch)
    db.commit()

    resp = client.delete(f"/api/v1/store/locations/{loc_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    db.refresh(branch)
    assert branch.default_warehouse_id is None


def test_store_with_stock_history_is_blocked(client, db):
    headers = _admin(db)
    loc_id = client.post("/api/v1/store/locations", json={"name": "Busy", "code": "BUSY"}, headers=headers).json()["id"]
    item_id = client.post("/api/v1/store/items", json={"item_code": "ITM-D", "item_name": "Bolt", "uom": "NOS"}, headers=headers).json()["id"]
    client.post("/api/v1/store/stock/transactions", json={"item_id": item_id, "location_id": loc_id, "transaction_type": "receipt", "quantity": 5}, headers=headers)

    resp = client.delete(f"/api/v1/store/locations/{loc_id}", headers=headers)
    assert resp.status_code == 409
    assert "stock movements" in resp.json()["detail"] and "Inactive" in resp.json()["detail"]
