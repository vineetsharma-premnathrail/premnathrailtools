"""ERP review control C-09 for Store (docs/erp-review/05-summary-and-roadmap.md):
self-approved adjustments, unrestricted manual stock entry and uncapped
returns.

A control the code does NOT enforce yet keeps its test, marked
xfail(strict=True) with the reason "OPEN: C-09 ...".
"""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.tests._stock_seed import client_db, seed_opening_stock

API = "/api/v1/store"


def _user(db, email, apps=("store",), **flags):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    for k, v in flags.items():
        setattr(u, k, v)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def env(db):
    keeper = _user(db, "c09.keeper@premnathrail.com")
    manager = _user(db, "c09.manager@premnathrail.com", is_store_manager=True)
    clerk = _user(db, "c09.clerk@premnathrail.com")  # plain Store user, no manager flag
    loc = StoreLocation(name="Main Store", code="MS", manager_user_id=manager.id)
    item = StoreItem(item_code="MT-GEN-0001", item_name="Bolt M12", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    return {"keeper": keeper, "manager": manager, "clerk": clerk, "loc": loc, "item": item}


def _on_hand(db, env):
    db.expire_all()
    bal = db.query(StoreStockBalance).filter_by(item_id=env["item"].id, location_id=env["loc"].id).first()
    return bal.on_hand_qty if bal else 0


def _seed_stock(client, env, qty=20):
    """Opening stock through the ledger (manual stock entry is removed, 2026-10-12)."""
    seed_opening_stock(client_db(), env["item"].id, env["loc"].id, qty, created_by_id=env["manager"].id)


def _adjust(client, env, creator, approver, qty=4):
    return client.post(f"{API}/stock-adjustments", json={
        "location_id": env["loc"].id, "approved_by_id": approver.id, "reason": "Cycle count",
        "items": [{"item_id": env["item"].id, "actual_quantity": qty}],
    }, headers=_h(creator))


# ── Adjustments: draft -> approve by someone other than the creator ─────────

def test_c09_adjustment_creator_cannot_name_self_as_approver(client, db, env):
    r = _adjust(client, env, env["keeper"], env["keeper"])
    assert r.status_code == 400 and "your own" in r.json()["detail"]


def test_c09_adjustment_posts_nothing_until_approved(client, db, env):
    _seed_stock(client, env, 20)
    r = _adjust(client, env, env["keeper"], env["manager"], qty=4)
    assert r.status_code == 200 and r.json()["status"] == "pending_approval"
    assert _on_hand(db, env) == 20


def test_c09_adjustment_creator_cannot_approve_it(client, db, env):
    _seed_stock(client, env, 20)
    adj = _adjust(client, env, env["keeper"], env["manager"], qty=4).json()
    own = client.post(f"{API}/stock-adjustments/{adj['id']}/approve", headers=_h(env["keeper"]))
    assert own.status_code == 403
    other = client.post(f"{API}/stock-adjustments/{adj['id']}/approve", headers=_h(env["clerk"]))
    assert other.status_code == 403  # not the named approver
    assert _on_hand(db, env) == 20
    ok = client.post(f"{API}/stock-adjustments/{adj['id']}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert _on_hand(db, env) == 4


def test_c09_admin_creator_cannot_approve_own_adjustment(client, db, env):
    admin = _user(db, "c09.admin@premnathrail.com")
    admin.role = "admin"
    db.commit()
    adj = _adjust(client, env, admin, env["manager"]).json()
    r = client.post(f"{API}/stock-adjustments/{adj['id']}/approve", headers=_h(admin))
    assert r.status_code == 403


def test_c09_adjustment_approver_must_be_a_store_manager(client, db, env):
    r = _adjust(client, env, env["keeper"], env["clerk"])
    assert r.status_code in (400, 403)


# ── Manual stock entry (removed 2026-10-12, SAP standard) ──────────────────

@pytest.mark.parametrize("who", ["keeper", "manager", "clerk"])
@pytest.mark.parametrize("txn_type", ["receipt", "damage", "adjustment_in"])
def test_c09_manual_stock_entry_is_gone_for_everyone(client, db, env, who, txn_type):
    r = client.post(f"{API}/stock/transactions", json={
        "transaction_type": txn_type, "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 5,
        "reference_number": "DC-1", "remarks": "x",
    }, headers=_h(env[who]))
    assert r.status_code == 410 and r.json()["detail"] == MANUAL_ENTRY_REMOVED
    assert _on_hand(db, env) == 0


# ── Returns capped at issued quantity ───────────────────────────────────────

def _issue(client, env, qty):
    r = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "issue_type": "production", "items": [{"item_id": env["item"].id, "quantity": qty}],
    }, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    return r.json()


def _return(client, env, issue_id, qty, item_id=None):
    return client.post(f"{API}/material-returns", json={
        "location_id": env["loc"].id, "source_type": "issue", "source_issue_id": issue_id,
        "items": [{"item_id": item_id or env["item"].id, "quantity": qty, "condition": "good"}],
    }, headers=_h(env["keeper"]))


def test_c09_return_cannot_exceed_issued_qty(client, db, env):
    _seed_stock(client, env, 20)
    issue = _issue(client, env, 5)
    r = _return(client, env, issue["id"], 6)
    assert r.status_code == 422 and "returnable" in r.json()["detail"]
    assert _on_hand(db, env) == 15


def test_c09_returns_are_capped_cumulatively(client, db, env):
    _seed_stock(client, env, 20)
    issue = _issue(client, env, 5)
    assert _return(client, env, issue["id"], 3).status_code == 200
    second = _return(client, env, issue["id"], 3)
    assert second.status_code == 422 and "2" in second.json()["detail"]
    assert _return(client, env, issue["id"], 2).status_code == 200


def test_c09_return_of_item_not_on_issue_is_refused(client, db, env):
    _seed_stock(client, env, 20)
    other = StoreItem(item_code="MT-GEN-0002", item_name="Nut M12", uom="NOS", item_type="material")
    db.add(other)
    db.commit()
    issue = _issue(client, env, 5)
    r = _return(client, env, issue["id"], 1, item_id=other.id)
    assert r.status_code == 422 and "not part of issue" in r.json()["detail"]
