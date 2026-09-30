"""
Tests for the Maintenance module, Phase 1 (backend/app/modules/maintenance):
access split between maintenance and requester (production) users, the
asset ↔ workstation status sync, the work-order status machine, downtime
maths, spares through the Store ledger (incl. the stock-short path), labour
cost, requester confirmation and the cancel guards.
"""
from datetime import datetime, timedelta, timezone

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.maintenance.models.asset import MaintenanceAsset

BASE = "/api/v1/maintenance"


def make_user(db, email, apps=("maintenance",), role="user"):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def setup_plant(db):
    branch = Branch(name="Faridabad Plant", code="FBD")
    loc = StoreLocation(name="Main Store", code="MS01")
    item = StoreItem(item_code="SP-BRG", item_name="Bearing 6205-2RS", uom="NOS", item_type="spare_part", standard_cost=250)
    ws = ProductionWorkstation(code="CNC-01", name="CNC Lathe 1")
    db.add_all([branch, loc, item, ws])
    db.commit()
    for o in (branch, loc, item, ws):
        db.refresh(o)
    return branch, loc, item, ws


def create_asset(client, h, branch, **extra):
    r = client.post(f"{BASE}/assets", json={"name": "CNC Lathe", "branch_id": branch.id, "criticality": "A", **extra}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_access_split(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "m1@premnathrail.com")
    prod = make_user(db, "p1@premnathrail.com", apps=("production",))
    other = make_user(db, "x1@premnathrail.com", apps=("crm",))
    asset = create_asset(client, hdr(maint), branch)

    assert client.get(f"{BASE}/requests", headers=hdr(other)).status_code == 403
    assert client.get(f"{BASE}/assets", headers=hdr(prod)).status_code == 403  # requesters don't browse the register

    r = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "problem_description": "Spindle noise"}, headers=hdr(prod))
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["request_number"].startswith("MRQ-") and req["priority"] == "high"  # criticality A, not down

    # Another requester can't see it; the requester can't triage it.
    prod2 = make_user(db, "p2@premnathrail.com", apps=("production",))
    assert client.get(f"{BASE}/requests/{req['id']}", headers=hdr(prod2)).status_code == 403
    assert client.get(f"{BASE}/requests", headers=hdr(prod2)).json() == []
    r = client.post(f"{BASE}/requests/{req['id']}/acknowledge", headers=hdr(prod))
    assert r.status_code == 403 and "Maintenance team" in r.json()["detail"]
    # Asset picker is open to requesters.
    assert len(client.get(f"{BASE}/lookups/assets", headers=hdr(prod)).json()) == 1


def test_asset_codes_and_manual_status(client, db):
    branch, *_ = setup_plant(db)
    h = hdr(make_user(db, "m2@premnathrail.com"))
    a1 = create_asset(client, h, branch)
    a2 = create_asset(client, h, branch, asset_code="cnc-07")
    assert a1["asset_code"] == "EQ-0001" and a2["asset_code"] == "CNC-07"
    r = client.post(f"{BASE}/assets", json={"name": "X", "branch_id": branch.id, "asset_code": "CNC-07"}, headers=h)
    assert r.status_code == 409
    r = client.patch(f"{BASE}/assets/{a1['id']}", json={"status": "breakdown"}, headers=h)
    assert r.status_code == 400 and "automatically" in r.json()["detail"]
    r = client.patch(f"{BASE}/assets/{a1['id']}", json={"status": "standby"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "standby"


def test_breakdown_flow_end_to_end(client, db):
    branch, loc, item, ws = setup_plant(db)
    maint = make_user(db, "m3@premnathrail.com")
    tech = make_user(db, "t3@premnathrail.com")
    prod = make_user(db, "p3@premnathrail.com", apps=("production",))
    hm, ht, hp = hdr(maint), hdr(tech), hdr(prod)
    asset = create_asset(client, hm, branch, workstation_id=ws.id)

    # 1. Requester raises a machine-down breakdown 90 minutes ago.
    reported = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
    req = client.post(f"{BASE}/requests", json={
        "asset_id": asset["id"], "machine_down": True, "reported_at": reported, "problem_description": "Spindle seized",
    }, headers=hp).json()
    assert req["priority"] == "urgent"
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "breakdown"
    assert db.get(ProductionWorkstation, ws.id).status == "under_maintenance"

    # 2. Planner converts and assigns.
    r = client.post(f"{BASE}/requests/{req['id']}/convert", json={"assigned_to_id": tech.id}, headers=hm)
    assert r.status_code == 200, r.text
    wo_id = r.json()["work_order"]["id"]
    wo = client.get(f"{BASE}/work-orders/{wo_id}", headers=hm).json()
    assert wo["wo_number"].startswith("MWO-") and wo["status"] == "assigned" and wo["wo_type"] == "breakdown"
    assert wo["machine_down"] and wo["downtime_start"] is not None

    # Invalid transition gives the real reason.
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hm)
    assert r.status_code == 409 and "Assigned" in r.json()["detail"]

    # 3. Technician starts → asset under maintenance.
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=ht).status_code == 200
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "under_maintenance"

    # 4. Spares: stock short → 409 with numbers, then issue + return.
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": item.id, "location_id": loc.id, "quantity": 2}, headers=ht)
    assert r.status_code == 409 and "Only 0 of 2 'Bearing 6205-2RS' available at Main Store" in r.json()["detail"]
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=5)
    db.commit()
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/issue", json={"store_item_id": item.id, "location_id": loc.id, "quantity": 3}, headers=ht)
    assert r.status_code == 200, r.text
    spare = r.json()["spares"][0]
    assert spare["qty_issued"] == 3 and spare["available_qty"] == 2 and r.json()["spares_cost"] == 750
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/return", json={"spare_id": spare["id"], "quantity": 1}, headers=ht)
    assert r.status_code == 200 and r.json()["spares_cost"] == 500
    r = client.post(f"{BASE}/work-orders/{wo_id}/spares/return", json={"spare_id": spare["id"], "quantity": 5}, headers=ht)
    assert r.status_code == 400

    # 5. Labour.
    r = client.post(f"{BASE}/work-orders/{wo_id}/labour", json={"technician_id": tech.id, "hours": 1.5, "hourly_rate": 200}, headers=ht)
    assert r.status_code == 200 and r.json()["labour_cost"] == 300 and r.json()["total_cost"] == 800

    # 6. Complete needs RCA; then downtime is stored and the machine is released.
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=ht)
    assert r.status_code == 400 and "root cause" in r.json()["detail"]
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={
        "failure_category": "mechanical", "root_cause": "Lubrication starvation", "action_taken": "Replaced bearing",
    }, headers=ht)
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["status"] == "completed" and 85 <= done["downtime_minutes"] <= 95 and done["awaiting_confirmation"]
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "operational"
    assert db.get(ProductionWorkstation, ws.id).status == "active"

    # 7. Close waits for the requester.
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hm)
    assert r.status_code == 409 and "confirm" in r.json()["detail"]
    view = client.get(f"{BASE}/requests/{req['id']}", headers=hp).json()
    assert view["can_confirm"] and view["work_order"]["action_taken"] == "Replaced bearing"
    assert client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": True}, headers=hm).status_code == 403  # not the requester
    assert client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": True}, headers=hp).status_code == 200
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hm)
    assert r.status_code == 200 and r.json()["status"] == "closed"

    # Closed is locked.
    assert client.patch(f"{BASE}/work-orders/{wo_id}", json={"title": "x"}, headers=hm).status_code == 409
    history = client.get(f"{BASE}/assets/{asset['id']}/history", headers=hm).json()
    assert {h["kind"] for h in history} == {"request", "work_order"}


def test_requester_rejects_repair_reopens_job(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "m4@premnathrail.com")
    prod = make_user(db, "p4@premnathrail.com", apps=("production",))
    hm, hp = hdr(maint), hdr(prod)
    asset = create_asset(client, hm, branch, criticality="C")
    req = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Leak"}, headers=hp).json()
    wo_id = client.post(f"{BASE}/requests/{req['id']}/convert", json={"assigned_to_id": maint.id}, headers=hm).json()["work_order"]["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/start", headers=hm)
    client.post(f"{BASE}/work-orders/{wo_id}/complete", json={"failure_category": "hydraulic", "root_cause": "Seal", "action_taken": "Seal changed"}, headers=hm)

    r = client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": False}, headers=hp)
    assert r.status_code == 400
    r = client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": False, "comment": "Still leaking"}, headers=hp)
    assert r.status_code == 200
    wo = client.get(f"{BASE}/work-orders/{wo_id}", headers=hm).json()
    assert wo["status"] == "in_progress" and wo["downtime_end"] is None and wo["requester_comment"] == "Still leaking"
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "under_maintenance"


def test_cancel_guards_and_checklist(client, db):
    branch, loc, item, _ws = setup_plant(db)
    maint = make_user(db, "m5@premnathrail.com")
    hm = hdr(maint)
    asset = create_asset(client, hm, branch)
    post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=2)
    db.commit()

    r = client.post(f"{BASE}/work-orders", json={
        "asset_id": asset["id"], "wo_type": "inspection", "title": "Monthly check", "assigned_to_id": maint.id,
        "tasks": [{"description": "Check oil level"}, {"description": "Check belt tension"}],
    }, headers=hm)
    assert r.status_code == 200, r.text
    wo = r.json()
    assert [t["sequence"] for t in wo["tasks"]] == [10, 20]

    client.post(f"{BASE}/work-orders/{wo['id']}/spares/issue", json={"store_item_id": item.id, "location_id": loc.id, "quantity": 1}, headers=hm)
    r = client.post(f"{BASE}/work-orders/{wo['id']}/cancel", json={"reason": "not needed"}, headers=hm)
    assert r.status_code == 409 and "Return them first" in r.json()["detail"]

    client.post(f"{BASE}/work-orders/{wo['id']}/start", headers=hm)
    r = client.post(f"{BASE}/work-orders/{wo['id']}/complete", json={}, headers=hm)
    assert r.status_code == 400 and "checklist" in r.json()["detail"]
    for t in wo["tasks"]:
        assert client.patch(f"{BASE}/work-orders/{wo['id']}/tasks/{t['id']}", json={"result": "ok"}, headers=hm).status_code == 200
    r = client.post(f"{BASE}/work-orders/{wo['id']}/complete", json={}, headers=hm)  # inspection: no RCA needed
    assert r.status_code == 200
    # No request → can close without confirmation.
    assert client.post(f"{BASE}/work-orders/{wo['id']}/close", headers=hm).json()["status"] == "closed"


def test_cancel_returns_request_to_triage(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "m6@premnathrail.com")
    hm = hdr(maint)
    asset = create_asset(client, hm, branch)
    req = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Trip"}, headers=hm).json()
    wo_id = client.post(f"{BASE}/requests/{req['id']}/convert", json={}, headers=hm).json()["work_order"]["id"]
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=hm).status_code == 409  # draft: assign first
    r = client.post(f"{BASE}/work-orders/{wo_id}/cancel", json={"reason": "duplicate job"}, headers=hm)
    assert r.status_code == 200
    assert client.get(f"{BASE}/requests/{req['id']}", headers=hm).json()["status"] == "acknowledged"
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "breakdown"  # request still open & machine still down

    r = client.post(f"{BASE}/requests/{req['id']}/reject", json={"status": "duplicate", "reason": "Same as MRQ-1"}, headers=hm)
    assert r.status_code == 200
    db.expire_all()
    assert db.get(MaintenanceAsset, asset["id"]).status == "operational"


def test_dashboard(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "m7@premnathrail.com")
    hm = hdr(maint)
    asset = create_asset(client, hm, branch)
    client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Down"}, headers=hm)
    data = client.get(f"{BASE}/dashboard", headers=hm).json()
    assert data["counts"]["down"] == 1 and data["counts"]["open_requests"] == 1
    assert data["machines_down"][0]["asset_code"] == asset["asset_code"]
    lookups = client.get(f"{BASE}/lookups", headers=hm).json()
    assert "breakdown" in lookups["wo_types"] and lookups["workstations"][0]["code"] == "CNC-01"
