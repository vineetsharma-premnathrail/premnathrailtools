"""Free-form manual stock posting removed (2026-10-12, SAP standard): every
goods movement has its own document; opening stock at go-live is the
admin-only Opening Stock Import."""
import json

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.tests._stock_seed import seed_opening_stock

API = "/api/v1/store/stock"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def env(db):
    admin = User(email="mer.admin@premnathrail.com", name="admin", role="admin", is_active=True, assigned_apps=["store"])
    manager = User(email="mer.manager@premnathrail.com", name="manager", role="user", is_active=True,
                   assigned_apps=["store"], is_store_manager=True)
    db.add_all([admin, manager])
    db.flush()
    loc = StoreLocation(name="Main Store", code="MS", manager_user_id=manager.id)
    item = StoreItem(item_code="MT-GEN-0901", item_name="Hex Bolt M10", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    seed_opening_stock(db, item.id, loc.id, 20)
    return {"admin": admin, "manager": manager, "loc": loc, "item": item}


def _on_hand(db, env):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=env["item"].id, location_id=env["loc"].id).one().on_hand_qty


@pytest.mark.parametrize("who", ["admin", "manager"])
def test_manual_transaction_and_stock_entry_are_gone(client, db, env, who):
    txn_count = db.query(StoreStockTransaction).count()
    for entry_type in ("receipt", "issue", "damage"):
        r = client.post(f"{API}/transactions", json={
            "entry_type": entry_type, "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 5,
            "reference_number": "DC-1", "remarks": "Free sample",
        }, headers=_h(env[who]))
        assert r.status_code == 410, (entry_type, r.text)
        assert r.json()["detail"] == MANUAL_ENTRY_REMOVED
        assert r.json()["detail"].startswith("Stock can't be added or removed by hand any more")
    payload = {"entry_type": "receipt", "location_id": env["loc"].id, "remarks": "x",
               "lines": [{"item_id": env["item"].id, "quantity": 5}]}
    r = client.post(f"{API}/entries", data={"payload": json.dumps(payload)}, headers=_h(env[who]))
    assert r.status_code == 410 and r.json()["detail"] == MANUAL_ENTRY_REMOVED
    assert _on_hand(db, env) == 20
    assert db.query(StoreStockTransaction).count() == txn_count


def test_admin_opening_stock_import_posts_opening_stock(client, db, env):
    csv = "item_code,warehouse,quantity,reference_number,remarks\nMT-GEN-0901,MS,7,OPENING-STOCK-2026,Opening balance at go-live\n"
    r = client.post(f"{API}/import", files={"file": ("s.csv", csv, "text/csv")}, headers=_h(env["admin"]))
    assert r.status_code == 200 and r.json()["errors"] == [] and len(r.json()["posted"]) == 1, r.text
    txn = db.query(StoreStockTransaction).filter_by(reference_number="OPENING-STOCK-2026").one()
    assert (txn.transaction_type, txn.entry_type, txn.reference_type) == ("manual_in", "opening_stock", "opening_stock")
    assert txn.created_by_id == env["admin"].id
    assert _on_hand(db, env) == 27


def test_non_admin_opening_stock_import_is_refused(client, db, env):
    csv = "item_code,warehouse,quantity,reference_number,remarks\nMT-GEN-0901,MS,7,OPENING-STOCK-2026,Opening balance\n"
    r = client.post(f"{API}/import", files={"file": ("s.csv", csv, "text/csv")}, headers=_h(env["manager"]))
    assert r.status_code == 403 and "Opening Stock Import is for an admin only" in r.json()["detail"]
    assert _on_hand(db, env) == 20
