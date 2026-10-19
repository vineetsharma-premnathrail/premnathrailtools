"""Maintenance on the central authorization framework: work-order close-out
through the approval engine (submit on completion / requester confirmation,
decide via the central endpoints and the legacy close / reopen wrappers,
in-flight jobs completed before the cut-over) and the Maintenance data scope
(own / plant) on work orders, requests and assets."""
from app.auth.jwt_handler import create_access_token
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.maintenance.access import CLOSE_OUT_KEY, WO_ENTITY
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.request import MaintenanceRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.organization.models.branch import Branch
from app.modules.organization.services import approval_engine as engine

BASE = "/api/v1/maintenance"


def _user(db, email, apps=("maintenance",), **kw):
    u = User(email=email, name=email.split("@")[0], role=kw.pop("role", "user"), is_active=True,
             assigned_apps=list(apps), **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _hdr(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _plant(db, code="FBD"):
    b = Branch(name=f"Plant {code}", code=code)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def _asset(client, h, branch, **extra):
    r = client.post(f"{BASE}/assets", json={"name": "CNC Lathe", "branch_id": branch.id, "criticality": "B", **extra}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _inspection_wo(client, h, asset_id, tech_id):
    r = client.post(f"{BASE}/work-orders", json={
        "asset_id": asset_id, "wo_type": "inspection", "title": "Monthly check", "assigned_to_id": tech_id,
    }, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _complete(client, h, wo_id):
    assert client.post(f"{BASE}/work-orders/{wo_id}/start", headers=h).status_code == 200
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ── Close-out approval ───────────────────────────────────────────────────

def test_completion_submits_close_out_and_engine_decides(client, db):
    branch = _plant(db)
    planner, tech = _user(db, "mca.planner@premnathrail.com"), _user(db, "mca.tech@premnathrail.com")
    hp, ht = _hdr(planner), _hdr(tech)
    asset = _asset(client, hp, branch)
    wo_id = _inspection_wo(client, hp, asset["id"], tech.id)

    assert _complete(client, ht, wo_id)["status"] == "completed"
    req = engine.latest_request(db, WO_ENTITY, wo_id)
    assert req is not None and req.status == "pending" and req.workflow_key == CLOSE_OUT_KEY
    assert req.requester_id == tech.id and req.reference.startswith("MWO-")
    assert {s.stage_name for s in req.steps} == {"Work order approver"}

    # The planner sees it in the central panel and sends it back (comment required).
    st = client.get(f"/api/v1/approvals/entity/{WO_ENTITY}/{wo_id}", headers=hp).json()
    assert st["current"]["can_decide"] is True
    r = client.post(f"/api/v1/approvals/requests/{req.id}/decide", json={"decision": "return"}, headers=hp)
    assert r.status_code == 422
    r = client.post(f"/api/v1/approvals/requests/{req.id}/decide",
                    json={"decision": "return", "comment": "Belt tension not recorded"}, headers=hp)
    assert r.status_code == 200, r.text
    wo = client.get(f"{BASE}/work-orders/{wo_id}", headers=hp).json()
    assert wo["status"] == "in_progress" and wo["requester_comment"] == "Belt tension not recorded"

    # Completed again → a new submission; the legacy "Verify & Close" endpoint
    # now just approves the live request.
    r = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=ht)
    assert r.status_code == 200, r.text
    req2 = engine.latest_request(db, WO_ENTITY, wo_id)
    assert req2.id != req.id and req2.revision == 2 and req2.status == "pending"
    r = client.post(f"{BASE}/work-orders/{wo_id}/close", headers=hp)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed" and r.json()["verified_by_id"] == planner.id
    db.expire_all()
    assert engine.latest_request(db, WO_ENTITY, wo_id).status == "approved"


def test_reopen_wrapper_returns_or_withdraws(client, db):
    branch = _plant(db)
    planner, tech = _user(db, "mcr.planner@premnathrail.com"), _user(db, "mcr.tech@premnathrail.com")
    hp, ht = _hdr(planner), _hdr(tech)
    asset = _asset(client, hp, branch)

    wo_id = _inspection_wo(client, hp, asset["id"], tech.id)
    _complete(client, ht, wo_id)
    r = client.post(f"{BASE}/work-orders/{wo_id}/reopen", json={"reason": "Oil level wrong"}, headers=hp)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    db.expire_all()
    assert engine.latest_request(db, WO_ENTITY, wo_id).status == "returned"

    # The technician who completed it reopens it themselves = withdraws the request.
    _complete_again = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={}, headers=ht)
    assert _complete_again.status_code == 200
    r = client.post(f"{BASE}/work-orders/{wo_id}/reopen", json={"reason": "Forgot the photos"}, headers=ht)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    db.expire_all()
    assert engine.latest_request(db, WO_ENTITY, wo_id).status == "cancelled"


def test_breakdown_job_submits_after_requester_confirms(client, db):
    branch = _plant(db)
    planner, tech = _user(db, "mcb.planner@premnathrail.com"), _user(db, "mcb.tech@premnathrail.com")
    prod = _user(db, "mcb.prod@premnathrail.com", apps=("production",))
    hp, ht, hr = _hdr(planner), _hdr(tech), _hdr(prod)
    asset = _asset(client, hp, branch)
    req = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Leak"}, headers=hr).json()
    wo_id = client.post(f"{BASE}/requests/{req['id']}/convert", json={"assigned_to_id": tech.id}, headers=hp).json()["work_order"]["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/start", headers=ht)
    done = client.post(f"{BASE}/work-orders/{wo_id}/complete", json={
        "failure_category": "hydraulic", "root_cause": "Seal", "action_taken": "Seal changed"}, headers=ht).json()
    assert done["awaiting_confirmation"] is True
    assert engine.latest_request(db, WO_ENTITY, wo_id) is None  # not closable yet

    assert client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": True}, headers=hr).status_code == 200
    live = engine.latest_request(db, WO_ENTITY, wo_id)
    assert live is not None and live.status == "pending" and live.requester_id == tech.id
    r = client.post(f"/api/v1/approvals/requests/{live.id}/decide", json={"decision": "approve"}, headers=hp)
    assert r.status_code == 200, r.text
    assert client.get(f"{BASE}/work-orders/{wo_id}", headers=hp).json()["status"] == "closed"


def test_in_flight_completed_job_uses_old_path(client, db):
    """A job already Completed before the cut-over has no engine request: the
    old Verify & Close / Reopen endpoints finish it exactly as before."""
    branch = _plant(db)
    planner = _user(db, "mcl.planner@premnathrail.com")
    hp = _hdr(planner)
    asset = _asset(client, hp, branch)
    a, b = (MaintenanceWorkOrder(wo_number=f"MWO-OLD-{i}", asset_id=asset["id"], title="Old job", status="completed",
                                 wo_type="inspection") for i in (1, 2))
    db.add_all([a, b])
    db.commit()
    r = client.post(f"{BASE}/work-orders/{a.id}/close", headers=hp)
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["verified_by_id"] == planner.id
    r = client.post(f"{BASE}/work-orders/{b.id}/reopen", json={"reason": "Recheck"}, headers=hp)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert engine.latest_request(db, WO_ENTITY, a.id) is None and engine.latest_request(db, WO_ENTITY, b.id) is None


# ── Data scope ───────────────────────────────────────────────────────────

def _scoped_user(db, email, level, **kw):
    role = Role(name=f"Maintenance – {level} ({email})", permissions=["maintenance:*:*"], data_scopes={"maintenance": level})
    db.add(role)
    db.commit()
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, **kw)
    db.add(u)
    db.commit()
    u.roles = [role]
    db.commit()
    db.refresh(u)
    return u


def test_data_scope_own_and_plant(client, db):
    fbd, plw = _plant(db, "FBD"), _plant(db, "PLW")
    admin = _user(db, "mcs.admin@premnathrail.com", role="admin")
    ha = _hdr(admin)
    a1 = _asset(client, ha, fbd)
    a2 = _asset(client, ha, plw, name="Press")
    own = _scoped_user(db, "mcs.own@premnathrail.com", "own", branch_id=fbd.id)
    plant = _scoped_user(db, "mcs.plant@premnathrail.com", "plant", branch_id=fbd.id)
    ho, hpl = _hdr(own), _hdr(plant)

    mine = client.post(f"{BASE}/work-orders", json={"asset_id": a2["id"], "title": "Mine on PLW"}, headers=ho)
    assert mine.status_code == 200, mine.text
    mine_id = mine.json()["id"]
    other_fbd = client.post(f"{BASE}/work-orders", json={"asset_id": a1["id"], "title": "Admin's on FBD"}, headers=ha).json()["id"]
    other_plw = client.post(f"{BASE}/work-orders", json={"asset_id": a2["id"], "title": "Admin's on PLW"}, headers=ha).json()["id"]

    # Own: only what they raised (plus what's assigned to them at 'assigned').
    assert [w["id"] for w in client.get(f"{BASE}/work-orders", headers=ho).json()] == [mine_id]
    r = client.get(f"{BASE}/work-orders/{other_fbd}", headers=ho)
    assert r.status_code == 403 and "Own records" in r.json()["detail"]
    assert client.post(f"{BASE}/work-orders/{other_fbd}/assign", json={"assigned_to_id": own.id}, headers=ho).status_code == 403
    assert client.get(f"{BASE}/assets", headers=ho).json() == []  # registered by the admin
    assert client.get(f"{BASE}/assets/{a1['id']}", headers=ho).status_code == 403

    # Plant: everything on their plant's assets (the record's plant = its asset's).
    seen = {w["id"] for w in client.get(f"{BASE}/work-orders", headers=hpl).json()}
    assert seen == {other_fbd}
    assert client.get(f"{BASE}/work-orders/{other_plw}", headers=hpl).status_code == 403
    assert [a["id"] for a in client.get(f"{BASE}/assets", headers=hpl).json()] == [a1["id"]]

    # Requests follow the same rules; the dashboard counts only what's in scope.
    db.add_all([
        MaintenanceRequest(request_number="MRQ-T-1", asset_id=a1["id"], problem_description="x", status="open",
                           reported_at=_now(), raised_by_id=admin.id),
        MaintenanceRequest(request_number="MRQ-T-2", asset_id=a2["id"], problem_description="y", status="open",
                           reported_at=_now(), raised_by_id=admin.id),
    ])
    db.commit()
    assert [r["request_number"] for r in client.get(f"{BASE}/requests", headers=hpl).json()] == ["MRQ-T-1"]
    assert client.get(f"{BASE}/requests", headers=ho).json() == []
    dash = client.get(f"{BASE}/dashboard", headers=hpl).json()["counts"]
    assert dash["assets"] == 1 and dash["open_requests"] == 1 and dash["open_work_orders"] == 1

    # Admin: organization-wide.
    assert len(client.get(f"{BASE}/work-orders", headers=ha).json()) == 3
    assert db.query(MaintenanceAsset).count() == 2


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)
