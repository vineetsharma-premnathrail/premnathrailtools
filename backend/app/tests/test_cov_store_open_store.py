"""Open Store controls (docs/02-modules/store/overview.md §10 "Known gaps").

  C-24  a Material Issue against a reservation consumes that reservation
  C-23  posted issues / adjustments can be reversed
  C-09  manual Receipt / Issue / Damage entries are removed for everyone (2026-10-12);
        a stock adjustment's approver must be a Store Manager

A control the code does NOT enforce yet keeps its test, marked
xfail(strict=True) with the reason "OPEN: <id> ...", so the test starts
failing (XPASS) the day the fix lands and the marker must be removed.
Tests without a marker pin behaviour that is already correct.

"Store Manager" here = a user with the `is_store_manager` flag who is also
the store's `manager_user_id`, so either reading of the rule is satisfied.
Opening stock is seeded through the ledger service directly, not the manual
entry API, so these tests don't depend on who may post manual entries.
"""
import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.modules.store.services.stock_ledger import post_stock_transaction

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
    keeper = _user(db, "open.keeper@premnathrail.com")              # plain Store user
    clerk = _user(db, "open.clerk@premnathrail.com")                # another plain Store user
    manager = _user(db, "open.manager@premnathrail.com", is_store_manager=True)
    loc = StoreLocation(name="Main Store", code="MS", manager_user_id=manager.id)
    item = StoreItem(item_code="MT-GEN-0101", item_name="Hex Bolt M12", uom="NOS", item_type="material")
    db.add_all([loc, item])
    db.commit()
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=20,
                           reference_type="test_seed", reference_number="SEED", created_by_id=manager.id)
    db.commit()
    return {"keeper": keeper, "clerk": clerk, "manager": manager, "loc": loc, "item": item}


def _balance(db, env):
    db.expire_all()
    return db.query(StoreStockBalance).filter_by(item_id=env["item"].id, location_id=env["loc"].id).one()


def _try_reverse(client, url, user, reason="Posted in error"):
    """A reversal route may be called /reverse or /cancel — accept either."""
    resp = None
    for action in ("reverse", "cancel"):
        resp = client.post(f"{url}/{action}", json={"reason": reason}, headers=_h(user))
        if resp.status_code not in (404, 405):
            return resp
    return resp


# ── C-24 Reservations ───────────────────────────────────────────────────────

def _reserve(client, env, qty):
    r = client.post(f"{API}/stock-reservations", json={
        "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": qty, "project": "Loco 7",
    }, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_c24_unrelated_issue_is_still_blocked_by_someone_elses_reservation(client, db, env):
    _reserve(client, env, 20)
    r = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "items": [{"item_id": env["item"].id, "quantity": 1}],
    }, headers=_h(env["clerk"]))
    assert r.status_code == 409, r.text
    assert "reserved" in r.json()["detail"]
    assert _balance(db, env).on_hand_qty == 20


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-24 an issue can't consume its own reservation — StoreMaterialIssueItemPayload "
    "(app/modules/store/schemas/material_issue.py:5) has no reservation_id, and create_material_issue "
    "(app/modules/store/routes/material_issues.py:202-208) posts a plain reservation-aware 'issue' "
    "(services/stock_ledger.py:145-151 available = on_hand - reserved), so the issue is refused by its own hold; "
    "fulfil (routes/stock_reservations.py:131-147) only releases the hold and is not linked to any issue"))
def test_c24_issue_against_reservation_consumes_it(client, db, env):
    res = _reserve(client, env, 20)
    r = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "project_or_work_order": "Loco 7",
        "items": [{"item_id": env["item"].id, "quantity": 20, "reservation_id": res["id"]}],
    }, headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    bal = _balance(db, env)
    assert bal.on_hand_qty == 0 and bal.reserved_qty == 0
    assert db.query(StoreStockReservation).filter_by(id=res["id"]).one().status == "fulfilled"


# ── C-23 Reversal of posted Store documents ─────────────────────────────────

@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-23 a posted Material Issue can't be reversed — app/modules/store/routes/material_issues.py "
    "has only GET list/detail and POST create (lines 57-103); no reverse/cancel route posts the return movement"))
def test_c23_material_issue_can_be_reversed(client, db, env):
    issue = client.post(f"{API}/material-issues", json={
        "location_id": env["loc"].id, "items": [{"item_id": env["item"].id, "quantity": 5}],
    }, headers=_h(env["keeper"]))
    assert issue.status_code == 200, issue.text
    assert _balance(db, env).on_hand_qty == 15
    r = _try_reverse(client, f"{API}/material-issues/{issue.json()['id']}", env["manager"])
    assert r.status_code == 200, r.text
    assert _balance(db, env).on_hand_qty == 20


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-23 an approved stock adjustment can't be reversed — app/modules/store/routes/stock_adjustments.py "
    "exposes only create/approve/reject (lines 94, 165, 209); approve is final"))
def test_c23_approved_stock_adjustment_can_be_reversed(client, db, env):
    adj = client.post(f"{API}/stock-adjustments", json={
        "location_id": env["loc"].id, "approved_by_id": env["manager"].id, "reason": "Cycle count",
        "items": [{"item_id": env["item"].id, "actual_quantity": 15}],
    }, headers=_h(env["keeper"]))
    assert adj.status_code == 200, adj.text
    ok = client.post(f"{API}/stock-adjustments/{adj.json()['id']}/approve", headers=_h(env["manager"]))
    assert ok.status_code == 200, ok.text
    assert _balance(db, env).on_hand_qty == 15
    r = _try_reverse(client, f"{API}/stock-adjustments/{adj.json()['id']}", env["manager"])
    assert r.status_code == 200, r.text
    assert _balance(db, env).on_hand_qty == 20


# ── C-09 Manual entries: removed for everyone (2026-10-12, SAP standard) ──

def test_c09_manual_entry_cannot_post_an_adjustment(client, db, env):
    r = client.post(f"{API}/stock/transactions", json={
        "transaction_type": "adjustment_in", "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 1,
    }, headers=_h(env["manager"]))
    assert r.status_code == 410 and "Adjustments" in r.json()["detail"]
    assert _balance(db, env).on_hand_qty == 20


def test_c09_store_manager_cannot_post_a_manual_receipt_any_more(client, db, env):
    r = client.post(f"{API}/stock/transactions", json={
        "entry_type": "receipt", "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 3,
        "reference_number": "DC-55", "remarks": "Free sample from vendor",
    }, headers=_h(env["manager"]))
    assert r.status_code == 410 and r.json()["detail"] == MANUAL_ENTRY_REMOVED
    assert _balance(db, env).on_hand_qty == 20


@pytest.mark.parametrize("entry_type", ["receipt", "issue", "damage"])
def test_c09_plain_store_user_cannot_post_manual_entry(client, db, env, entry_type):
    r = client.post(f"{API}/stock/transactions", json={
        "entry_type": entry_type, "item_id": env["item"].id, "location_id": env["loc"].id, "quantity": 2,
    }, headers=_h(env["keeper"]))
    assert r.status_code in (403, 410), r.text
    assert _balance(db, env).on_hand_qty == 20


# ── C-09 Adjustment approver must be a Store Manager ────────────────────────

def _adjust(client, env, approver):
    return client.post(f"{API}/stock-adjustments", json={
        "location_id": env["loc"].id, "approved_by_id": approver.id, "reason": "Cycle count",
        "items": [{"item_id": env["item"].id, "actual_quantity": 18}],
    }, headers=_h(env["keeper"]))


def test_c09_store_manager_is_accepted_as_adjustment_approver(client, env):
    r = _adjust(client, env, env["manager"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending_approval"


def test_c09_creator_cannot_approve_own_adjustment(client, env):
    r = _adjust(client, env, env["keeper"])
    assert r.status_code == 400 and "your own" in r.json()["detail"]


def test_c09_plain_store_user_cannot_be_adjustment_approver(client, env):
    r = _adjust(client, env, env["clerk"])
    assert r.status_code == 400, r.text
