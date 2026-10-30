"""Priority API behaviour: two values only, permission gate, default Standard."""
from app.tests.test_maintenance import BASE, create_asset, hdr, make_user, setup_plant


def test_maintenance_request_priority_api(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "prio-m@premnathrail.com")
    asset = create_asset(client, hdr(maint), branch, criticality="C")
    body = {"asset_id": asset["id"], "machine_down": False, "problem_description": "Noise from gearbox"}

    r = client.post(f"{BASE}/requests", json={**body, "priority": "high"}, headers=hdr(maint))
    assert r.status_code == 422 and r.json()["detail"] == "Priority must be Standard or Urgent."
    r = client.post(f"{BASE}/requests", json={**body, "priority": "URGENT"}, headers=hdr(maint))
    assert r.status_code == 200 and r.json()["priority"] == "urgent"
    assert client.post(f"{BASE}/requests", json=body, headers=hdr(maint)).json()["priority"] == "standard"


def test_maintenance_request_priority_denied_without_app(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "prio-m2@premnathrail.com")
    asset = create_asset(client, hdr(maint), branch)
    outsider = make_user(db, "prio-out@premnathrail.com", apps=())
    r = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "problem_description": "x" * 10, "priority": "urgent"}, headers=hdr(outsider))
    assert r.status_code == 403
