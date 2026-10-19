"""Store access controls: manual entry is removed and opening stock import is
admin-only (C-09, 2026-10-12), stores
can't be re-planted / re-managed by non-admins, return approval types are
fixed in code, reservations respect the Store data scope, stock documents refuse
future dates, and Store users can record GRNs (plan §16 #3)."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.routes.stock import MANUAL_ENTRY_REMOVED
from app.modules.store.services.stock_ledger import post_stock_transaction

API = "/api/v1/store"
TOMORROW = (date.today() + timedelta(days=1)).isoformat()


def _user(db, email, apps=("store",), role="user", **kw):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps), **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def env(db):
    p1, p2 = Branch(name="Unit 1", code="U1"), Branch(name="Unit 2", code="U2")
    db.add_all([p1, p2])
    db.flush()
    admin = _user(db, "ac.admin@premnathrail.com", apps=(), role="admin")
    manager = _user(db, "ac.manager@premnathrail.com", branch_id=p1.id)
    keeper = _user(db, "ac.keeper@premnathrail.com", branch_id=p1.id)
    other = _user(db, "ac.other@premnathrail.com", branch_id=p2.id)
    s1 = StoreLocation(name="U1 Main Store", code="U1-MS", branch_id=p1.id, manager_user_id=manager.id)
    s2 = StoreLocation(name="U2 Main Store", code="U2-MS", branch_id=p2.id)
    item = StoreItem(item_code="MT-GEN-0501", item_name="Washer M12", uom="NOS", item_type="material")
    db.add_all([s1, s2, item])
    db.flush()
    post_stock_transaction(db, item_id=item.id, location_id=s1.id, transaction_type="receipt", quantity=20)
    post_stock_transaction(db, item_id=item.id, location_id=s2.id, transaction_type="receipt", quantity=20)
    db.commit()
    return {"p1": p1, "p2": p2, "admin": admin, "manager": manager, "keeper": keeper, "other": other,
            "s1": s1, "s2": s2, "item": item}


def _enable_plant_access(client, env):
    """Plant-scoped Store data access for the plant users (the old Store ›
    Settings › Plant Access switch is now the central data scope)."""
    from sqlalchemy.orm import object_session

    for key in ("manager", "keeper", "other"):
        u = env[key]
        u.data_access_scopes = {**(u.data_access_scopes or {}), "store": "plant"}
    object_session(env["keeper"]).commit()


def _entry(client, env, user, **body):
    return client.post(f"{API}/stock/transactions", json={
        "entry_type": "receipt", "item_id": env["item"].id, "location_id": env["s1"].id, "quantity": 2, "reference_number": "OPENING-STOCK", "remarks": "Opening stock", **body,
    }, headers=_h(user))


# ── C-09 manual entry: removed (2026-10-12); opening stock is admin-only ──

def test_manual_entry_is_gone_even_for_store_manager_or_admin(client, env):
    for who in ("keeper", "manager", "admin"):
        r = _entry(client, env, env[who])
        assert r.status_code == 410 and r.json()["detail"] == MANUAL_ENTRY_REMOVED, who


def _import(client, user, csv):
    return client.post(f"{API}/stock/import", files={"file": ("s.csv", csv, "text/csv")}, headers=_h(user))


def test_opening_stock_import_is_admin_only(client, env):
    csv = "item_code,warehouse,quantity,reference_number,remarks\nMT-GEN-0501,U1-MS,5,OPENING-STOCK,Opening stock\n"
    for who in ("keeper", "manager"):
        r = _import(client, env[who], csv)
        assert r.status_code == 403 and "admin only" in r.json()["detail"], who
    ok = _import(client, env["admin"], csv)
    assert ok.status_code == 200 and ok.json()["errors"] == [] and len(ok.json()["posted"]) == 1


def test_opening_stock_import_refuses_future_date(client, env):
    csv = f"item_code,warehouse,quantity,reference_number,transaction_date,remarks\nMT-GEN-0501,U1-MS,5,OPENING-STOCK,{TOMORROW},Opening stock\n"
    r = _import(client, env["admin"], csv)
    assert r.status_code == 200 and r.json()["posted"] == [] and "future" in r.json()["errors"][0]["reason"]


# ── Store re-plant / re-manage ──────────────────────────────────────────────

def test_non_admin_cannot_move_store_or_change_manager(client, env):
    url = f"{API}/locations/{env['s2'].id}"
    for body in ({"branch_id": env["p1"].id}, {"manager_user_id": env["keeper"].id}):
        r = client.patch(url, json=body, headers=_h(env["keeper"]))
        assert r.status_code == 403 and "Only an admin" in r.json()["detail"], body
    # Re-sending unchanged values (a full-form save) is fine.
    same = client.patch(f"{API}/locations/{env['s1'].id}", json={"name": "U1 Main", "branch_id": env["p1"].id,
                        "manager_user_id": env["manager"].id}, headers=_h(env["keeper"]))
    assert same.status_code == 200, same.text
    assert client.patch(url, json={"manager_user_id": env["other"].id}, headers=_h(env["admin"])).status_code == 200


def test_plant_restricted_user_cannot_edit_or_delete_other_plants_store(client, env):
    _enable_plant_access(client, env)
    url = f"{API}/locations/{env['s2'].id}"
    assert client.patch(url, json={"name": "Mine now"}, headers=_h(env["keeper"])).status_code == 403
    assert client.delete(url, headers=_h(env["keeper"])).status_code == 403


def test_create_store_limited_to_own_plant_and_no_manager(client, env):
    _enable_plant_access(client, env)
    h = _h(env["keeper"])
    wrong = client.post(f"{API}/locations", json={"name": "X", "code": "X1", "branch_id": env["p2"].id}, headers=h)
    assert wrong.status_code == 403 and "own plant" in wrong.json()["detail"]
    mgr = client.post(f"{API}/locations", json={"name": "Y", "code": "Y1", "branch_id": env["p1"].id,
                      "manager_user_id": env["keeper"].id}, headers=h)
    assert mgr.status_code == 403
    ok = client.post(f"{API}/locations", json={"name": "Z", "code": "Z1", "branch_id": env["p1"].id}, headers=h)
    assert ok.status_code == 200, ok.text


# ── Return approval types fixed in code ─────────────────────────────────────

def test_return_types_cannot_be_added_or_switched_off(client, env):
    for user in (env["keeper"], env["admin"]):
        add = client.post(f"{API}/doc-types/return_source", json={"label": "Free return", "approver_rule": "none"}, headers=_h(user))
        assert add.status_code == 409 and "fixed in code" in add.json()["detail"]
    off = client.put(f"{API}/doc-types/return_source/other", json={"label": "Other", "approver_rule": "none"}, headers=_h(env["keeper"]))
    assert off.status_code == 409
    admin_off = client.put(f"{API}/doc-types/return_source/other", json={"label": "Other", "approver_rule": "none"}, headers=_h(env["admin"]))
    assert admin_off.status_code == 409
    cond = client.put(f"{API}/doc-types/return_condition/damaged", json={
        "label": "Damaged", "stock_effect": "quarantine", "approver_rule": "none"}, headers=_h(env["keeper"]))
    assert cond.status_code == 409
    rename = client.put(f"{API}/doc-types/return_source/other", json={
        "label": "Other (no issue)", "approver_rule": "warehouse_manager"}, headers=_h(env["admin"]))
    assert rename.status_code == 200, rename.text


# ── Reservations respect the Store data scope ───────────────────────────────

@pytest.mark.parametrize("action", ["cancel", "fulfill"])
def test_other_plant_cannot_release_reservation(client, db, env, action):
    res = client.post(f"{API}/stock-reservations", json={
        "item_id": env["item"].id, "location_id": env["s1"].id, "quantity": 5, "project": "Loco 9",
    }, headers=_h(env["keeper"]))
    assert res.status_code == 200, res.text
    _enable_plant_access(client, env)
    r = client.post(f"{API}/stock-reservations/{res.json()['id']}/{action}", headers=_h(env["other"]))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]
    db.expire_all()
    assert db.query(StoreStockReservation).get(res.json()["id"]).status == "active"


# ── Future-dated stock documents ────────────────────────────────────────────

def test_documents_refuse_future_dates(client, env):
    h = _h(env["keeper"])
    item = env["item"].id
    t = client.post(f"{API}/stock-transfers", json={
        "from_location_id": env["s1"].id, "to_location_id": env["s2"].id, "transfer_date": TOMORROW,
        "items": [{"item_id": item, "quantity": 1}]}, headers=h)
    assert t.status_code == 422 and "Transfer date" in t.json()["detail"]
    a = client.post(f"{API}/stock-adjustments", json={
        "location_id": env["s1"].id, "approved_by_id": env["manager"].id, "adjustment_date": TOMORROW,
        "items": [{"item_id": item, "actual_quantity": 18}]}, headers=h)
    assert a.status_code == 422 and "Adjustment date" in a.json()["detail"]
    r = client.post(f"{API}/material-returns", json={
        "location_id": env["s1"].id, "source_type": "other", "source_description": "Surplus", "return_date": TOMORROW,
        "items": [{"item_id": item, "quantity": 1, "condition": "good"}]}, headers=h)
    assert r.status_code == 422 and "Return date" in r.json()["detail"]


# ── GRN open to Store users ─────────────────────────────────────────────────

def test_store_only_user_can_open_grn_lists(client, db, env):
    h = _h(env["keeper"])
    assert client.get("/api/v1/p2p/goods-receipts", headers=h).status_code == 200
    assert client.get("/api/v1/p2p/goods-receipts/pending-purchase-orders", headers=h).status_code == 200
    outsider = _user(db, "ac.outsider@premnathrail.com", apps=("crm",))
    assert client.get("/api/v1/p2p/goods-receipts", headers=_h(outsider)).status_code == 403


# ── GRN Plant Access: Store users scoped, Purchase users cross-plant ───────

def _grn_po(db, env):
    from datetime import datetime, timezone
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    now = datetime.now(timezone.utc)
    pr = P2PRequest(p2p_number="P2P-RAW-2026-8001", category_code="RAW", request_date=date.today(),
                    requested_by_id=env["admin"].id, status="po_approved", project_label="Loco 7",
                    purchase_head_approved_at=now, director_approved_at=now, partner_approved_at=now)
    db.add(pr)
    db.flush()
    po = P2PPurchaseOrder(po_number="PO-AC-1", p2p_request_id=pr.id, vendor_name="Pune Steels",
                          status="issued", po_date=date.today(), created_by_id=env["admin"].id)
    db.add(po)
    db.flush()
    line = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Washer M12", unit="NOS", quantity=10, unit_price=5,
                                store_item_id=env["item"].id)
    db.add(line)
    db.commit()
    return po, line


def _grn(client, user, po, line, store_id, qty=1):
    return client.post("/api/v1/p2p/goods-receipts", json={
        "purchase_order_id": po.id, "store_location_id": store_id,
        "items": [{"po_item_id": line.id, "received_quantity": qty}]}, headers=_h(user))


@pytest.fixture
def _no_series_lock(monkeypatch):
    monkeypatch.setattr("app.modules.p2p.service._lock_number_series", lambda db, prefix: None)


def test_purchase_user_receives_into_any_plant_with_plant_access_on(client, db, env, _no_series_lock):
    _enable_plant_access(client, env)
    # central buyer, no plant; GRNs are Store › GRN & Inspection grants (RBAC 2026-10-08)
    buyer = _user(db, "ac.buyer@premnathrail.com", apps=("purchase", "p2p"),
                  granular_permissions=["store:grn:view", "store:grn:create", "store:grn:approve"])
    po, line = _grn_po(db, env)
    for store in (env["s1"], env["s2"]):
        r = _grn(client, buyer, po, line, store.id)
        assert r.status_code == 200, r.text
    assert len(client.get("/api/v1/p2p/goods-receipts", headers=_h(buyer)).json()) == 2


def test_store_user_sees_and_records_grns_only_for_own_plant(client, db, env, _no_series_lock):
    po, line = _grn_po(db, env)
    g1 = _grn(client, env["admin"], po, line, env["s1"].id)
    g2 = _grn(client, env["admin"], po, line, env["s2"].id)
    assert g1.status_code == 200 and g2.status_code == 200, (g1.text, g2.text)
    _enable_plant_access(client, env)
    h = _h(env["keeper"])
    listed = [g["id"] for g in client.get("/api/v1/p2p/goods-receipts", headers=h).json()]
    assert listed == [g1.json()["id"]]
    assert client.get(f"/api/v1/p2p/goods-receipts/{g1.json()['id']}", headers=h).status_code == 200
    other = client.get(f"/api/v1/p2p/goods-receipts/{g2.json()['id']}", headers=h)
    assert other.status_code == 403 and "outside your data access" in other.json()["detail"]
    assert _grn(client, env["keeper"], po, line, env["s2"].id).status_code == 403
    assert _grn(client, env["keeper"], po, line, env["s1"].id).status_code == 200


def test_store_user_with_grn_approve_can_inspect_a_non_qc_receipt(client, db, env, _no_series_lock):
    """2026-10-13 (MIGO 101): the Permission Matrix ('Approve' on Store › GRN)
    alone decides who inspects — no separate Purchase-module check."""
    po, line = _grn_po(db, env)
    g = _grn(client, env["keeper"], po, line, env["s1"].id).json()
    r = client.post(f"/api/v1/p2p/goods-receipts/{g['id']}/inspect", json={"items": [
        {"item_id": g["items"][0]["id"], "accepted_quantity": 1, "rejected_quantity": 0, "quality_status": "passed"}]},
        headers=_h(env["keeper"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"


def test_weakened_return_types_heal_to_code_defaults(client, db, env):
    from app.modules.store.models.doc_type import StoreDocType
    client.get(f"{API}/doc-types/return_condition", headers=_h(env["admin"]))  # seed
    damaged = db.query(StoreDocType).filter_by(kind="return_condition", value="damaged").one()
    damaged.approver_rule, damaged.is_active = "none", False
    db.add(StoreDocType(kind="return_condition", value="scrap_free", label="Scrap (no approval)",
                        stock_effect="quarantine", approver_rule="none", approver_user_ids=[], is_active=True))
    db.commit()
    rows = {r["value"]: r for r in client.get(f"{API}/doc-types/return_condition?include_inactive=true", headers=_h(env["admin"])).json()}
    assert rows["damaged"]["approver_rule"] == "department_head" and rows["damaged"]["is_active"]
    assert rows["scrap_free"]["is_active"] is False
    active = [r["value"] for r in client.get(f"{API}/doc-types/return_condition", headers=_h(env["keeper"])).json()]
    assert "scrap_free" not in active
