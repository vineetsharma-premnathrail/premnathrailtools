"""Stock page bulk import (all-or-nothing) and Excel export."""
import io

import pytest
from openpyxl import load_workbook

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction

API = "/api/v1/store/stock"


@pytest.fixture
def h(db):
    user = User(email="store.keeper@premnathrail.com", name="store.keeper", role="user", is_active=True, assigned_apps=["store"])
    db.add_all([
        user,
        StoreItem(item_code="MT-GEN-0001", item_name="Hex Bolt", item_type="material", category="Hardware", uom="NOS"),
        StoreItem(item_code="MT-GEN-0002", item_name="Gloves", item_type="material", category="PPE", uom="PAIR"),
        StoreLocation(name="Main Store", code="MAIN"),
    ])
    db.commit()
    db.refresh(user)
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def upload(client, h, text):
    return client.post(f"{API}/import", files={"file": ("stock.csv", text, "text/csv")}, headers=h)


def test_import_posts_rows_in_order(client, h, db):
    r = upload(client, h,
               "item_code,warehouse,entry_type,quantity,transaction_date\n"
               "mt-gen-0001,MAIN,Receipt,100,2026-10-01\n"
               "MT-GEN-0001,Main Store,issue,30,\n"
               "MT-GEN-0002,MAIN,Receipt,5,\n")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["errors"] == [] and len(body["posted"]) == 3
    bal = {b["item_code"]: b["on_hand_qty"] for b in client.get(f"{API}/balances", headers=h).json()}
    assert bal == {"MT-GEN-0001": 70, "MT-GEN-0002": 5}


def test_any_bad_row_posts_nothing(client, h, db):
    r = upload(client, h,
               "item_code,warehouse,entry_type,quantity\n"
               "MT-GEN-0001,MAIN,Receipt,10\n"
               "NOPE,MAIN,Receipt,1\n"
               "MT-GEN-0002,MAIN,Issue,5\n"
               "MT-GEN-0001,MAIN,adjustment_in,5\n")
    body = r.json()
    assert body["posted"] == [] and body["would_post"] == 1
    assert [e["row"] for e in body["errors"]] == [3, 4, 5]
    assert "Not enough stock" in body["errors"][1]["reason"]
    assert db.query(StoreStockTransaction).count() == 0
    assert client.get(f"{API}/import/template", headers=h).status_code == 200


def test_export_has_balances_and_movements_with_filters(client, h):
    upload(client, h, "item_code,warehouse,entry_type,quantity\nMT-GEN-0001,MAIN,Receipt,10\nMT-GEN-0002,MAIN,Receipt,4\n")
    r = client.get(f"{API}/export", params={"category": "PPE"}, headers=h)
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    assert [row[0] for row in wb["Balances"].iter_rows(min_row=2, values_only=True)] == ["MT-GEN-0002"]
    assert [row[1] for row in wb["Movements"].iter_rows(min_row=2, values_only=True)] == ["MT-GEN-0002"]


def test_vendor_name_saved_on_entry_import_and_suggested(client, h):
    items = {i["item_code"]: i["id"] for i in client.get("/api/v1/store/items", headers=h).json()}
    loc = client.get("/api/v1/store/locations", headers=h).json()[0]["id"]
    r = client.post(f"{API}/transactions", json={"item_id": items["MT-GEN-0001"], "location_id": loc, "entry_type": "receipt",
                                                 "quantity": 5, "vendor_name": "  Sharma Steels  "}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["vendor_name"] == "Sharma Steels"
    upload(client, h, "item_code,warehouse,entry_type,quantity,vendor_name\nMT-GEN-0002,MAIN,Receipt,3,Bharat Bearings\n")
    assert client.get(f"{API}/vendor-options", headers=h).json() == ["Bharat Bearings", "Sharma Steels"]
