"""GRC + Basis: PFUD validity / access reviews, SU53 denial trace, SoD ruleset,
SM37 job runs, SM21 error log, SM12 optimistic locking, management cockpit.

Users are built WITHOUT assigned_apps so the real roles + deny-by-default
rules apply (see conftest's legacy shim)."""
import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.core import jobs
from app.core.optimistic_lock import StaleRecordError, _state, parse_target
from app.core.permission_registry import all_permission_ids, can_perform
from app.core.sod_rules import SOD_RULES, conflicts_in
from app.main import app
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.grc import (
    AccessReviewLine, AccessValidity, JobRun, PermissionDenial, SodMitigation, SystemErrorLog,
)
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.main.services import basis_log, grc
from sqlalchemy.orm import sessionmaker


@pytest.fixture(autouse=True)
def _own_sessions(db):
    """Basis logs and job runs write through their own session — point it at
    the test database."""
    basis_log.SESSION_FACTORY = sessionmaker(bind=db.get_bind(), autoflush=False)
    basis_log.reset_rate_limiter()
    yield
    basis_log.SESSION_FACTORY = None


def _user(db, email, role="user", grants=None, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role=role, is_active=True,
             granular_permissions=grants or [], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, permissions):
    r = Role(name=name, permissions=permissions)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


# ------------------------------------------------------------------ SoD

def test_sod_rule_permissions_exist_in_registry():
    known = all_permission_ids()
    for r in SOD_RULES:
        for p in (*r.side_a, *r.side_b):
            assert p in known, f"{r.rule_id}: {p} is not a Permission Matrix id"


def test_sod_conflict_detection():
    assert conflicts_in({"accounts:journal_vouchers:create"}) == []
    c = conflicts_in({"accounts:journal_vouchers:create", "accounts:journal_vouchers:approve"})
    assert [x["rule_id"] for x in c] == ["SOD-03"] and c[0]["risk"] == "high"


def test_assigning_high_risk_role_needs_mitigation_reason(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    target = _user(db, "clerk@premnathrail.com")
    jv = _role(db, "JV Maker+Checker", ["accounts:journal_vouchers:create", "accounts:journal_vouchers:approve"])

    preview = client.post("/api/v1/organization/grc/sod/preview", json={"user_id": target.id, "role_ids": [jv.id]},
                          headers=_auth(admin))
    assert preview.status_code == 200 and preview.json()["needs_reason"] is True

    r = client.put(f"/api/v1/users/{target.id}/roles", json={"role_ids": [jv.id]}, headers=_auth(admin))
    assert r.status_code == 409 and "SOD-03" in r.json()["detail"]

    r = client.put(f"/api/v1/users/{target.id}/roles",
                   json={"role_ids": [jv.id], "sod_mitigation_reason": "Finance manager reviews every JV weekly"},
                   headers=_auth(admin))
    assert r.status_code == 200, r.text
    m = db.query(SodMitigation).filter_by(user_id=target.id).one()
    assert m.rule_id == "SOD-03"

    report = client.get("/api/v1/organization/grc/sod/report", headers=_auth(admin)).json()
    row = next(u for u in report["users"] if u["user_id"] == target.id)
    assert row["conflicts"][0]["mitigation"]["reason"].startswith("Finance manager")
    assert any(x["name"] == "JV Maker+Checker" for x in report["roles"])


# ------------------------------------------------------------------ PFUD

def test_role_outside_validity_grants_nothing_and_expires(db):
    store = _role(db, "Store Keeper", ["store:issues:view", "store:issues:create"])
    u = _user(db, "temp@premnathrail.com")
    u.roles = [store]
    db.commit()
    assert can_perform(u, "store", "issues", "create")

    db.add(AccessValidity(user_id=u.id, kind="role", role_id=store.id, valid_to=date.today() - timedelta(days=1)))
    db.commit()
    u.__dict__.pop("_inactive_access_cache", None)
    u.invalidate_permissions()
    assert not can_perform(u, "store", "issues", "create")

    assert grc.expire_access(db) == 1
    db.refresh(u)
    assert store not in u.roles
    assert db.query(AccessValidity).count() == 0
    assert db.query(AuditLog).filter_by(action="access_expired", entity_id=u.id).count() == 1


def test_future_valid_from_not_yet_active(db):
    u = _user(db, "future@premnathrail.com", grants=["quality:ncr:view"])
    db.add(AccessValidity(user_id=u.id, kind="grant", permission="quality:ncr:view",
                          valid_from=date.today() + timedelta(days=3)))
    db.commit()
    off_roles, off_grants = grc.inactive_access(u)
    assert off_grants == {"quality:ncr:view"}


def test_set_validity_endpoint(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    store = _role(db, "Store Keeper", ["store:issues:view"])
    u = _user(db, "temp@premnathrail.com")
    u.roles = [store]
    db.commit()
    r = client.put(f"/api/v1/organization/grc/users/{u.id}/validity",
                   json={"kind": "role", "role_id": store.id, "valid_to": str(date.today() + timedelta(days=10)),
                         "reason": "Covering leave"}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()[0]["active"] is True and r.json()[0]["reason"] == "Covering leave"


# ------------------------------------------------------------------ access review

def test_access_review_manager_revokes_report_role(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    mgr = _user(db, "mgr@premnathrail.com")
    store = _role(db, "Store Keeper", ["store:issues:view"])
    emp = _user(db, "emp@premnathrail.com", reporting_manager_id=mgr.id)
    emp.roles = [store]
    db.commit()

    r = client.post("/api/v1/organization/grc/reviews", json={"period": "2026-Q4"}, headers=_auth(admin))
    assert r.status_code == 201, r.text
    lines = client.get("/api/v1/organization/grc/reviews/my-lines", headers=_auth(mgr)).json()
    assert len(lines) == 1 and lines[0]["user_id"] == emp.id

    bad = client.post(f"/api/v1/organization/grc/review-lines/{lines[0]['id']}/decide",
                      json={"decision": "revoke"}, headers=_auth(mgr))
    assert bad.status_code == 400  # a revoke needs a reason

    other = _user(db, "other@premnathrail.com")
    assert client.post(f"/api/v1/organization/grc/review-lines/{lines[0]['id']}/decide",
                       json={"decision": "keep"}, headers=_auth(other)).status_code == 403

    ok = client.post(f"/api/v1/organization/grc/review-lines/{lines[0]['id']}/decide",
                     json={"decision": "revoke", "comment": "Moved to Sales"}, headers=_auth(mgr))
    assert ok.status_code == 200, ok.text
    db.expire_all()
    assert db.get(User, emp.id).roles == []
    assert db.get(AccessReviewLine, lines[0]["id"]).decision == "revoke"


# ------------------------------------------------------------------ SU53

def test_denied_request_is_traced_and_deduplicated(client, db):
    u = _user(db, "nobody@premnathrail.com")
    for _ in range(3):
        r = client.get("/api/v1/organization/security/settings", headers=_auth(u))
        assert r.status_code == 403
    rows = db.query(PermissionDenial).all()
    assert len(rows) == 1
    assert rows[0].user_id == u.id and rows[0].permission_key == "organization:security:view"
    assert rows[0].repeat_count == 3

    admin = _user(db, "admin@premnathrail.com", role="admin")
    sec = _role(db, "Security viewer", ["organization:security:view"])
    trace = client.get(f"/api/v1/organization/grc/denials?user_id={u.id}", headers=_auth(admin)).json()
    assert trace[0]["permission_key"] == "organization:security:view"
    assert {"id": sec.id, "name": sec.name} in trace[0]["granted_by_roles"]


def test_permission_key_parsing():
    assert basis_log.permission_key_from_detail("You don't have 'edit' permission on X › Y (store:issues:edit). Ask") == "store:issues:edit"
    assert basis_log.permission_key_from_detail("You don't have 'view' permission on X › Y (store:issues). Ask") == "store:issues:view"
    assert basis_log.permission_key_from_detail("Access to 'crm' module required — none") == "crm:*:view"
    # The core checks now say it in words and pass the id on the exception itself.
    from app.core.permissions import PermissionDenied
    assert PermissionDenied("You can't open the CRM module", "crm:*:view").permission_key == "crm:*:view"


# ------------------------------------------------------------------ SM21

def test_unhandled_error_is_persisted_with_matching_ref(db):
    path = f"/__test_boom_{uuid.uuid4().hex[:6]}"

    async def boom():
        raise RuntimeError("kaboom for test")

    app.add_api_route(path, boom, methods=["GET"])
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get(path)
    assert r.status_code == 500
    ref = r.json()["error_id"]
    uuid.UUID(ref)  # a real uuid, not id(exc)
    assert ref in r.json()["detail"]
    db.expire_all()
    row = db.query(SystemErrorLog).filter_by(error_ref=ref).one()
    assert row.path == path and "kaboom for test" in row.traceback


# ------------------------------------------------------------------ SM37

def test_job_runs_are_recorded(db):
    rid = jobs.run_tracked("unit_ok", lambda: {"sent": 2, "skipped": 1})
    run = db.get(JobRun, rid)
    assert run.status == "success" and run.rows == 3 and run.duration_ms is not None

    def bad():
        raise ValueError("graph down")
    rid = jobs.run_tracked("unit_bad", bad)
    db.expire_all()
    run = db.get(JobRun, rid)
    assert run.status == "failed" and "graph down" in run.error


def test_job_logging_error_marks_run_failed(db):
    import logging

    def swallowing():
        logging.getLogger("app.tasks.fake").error("Azure sync failed: 401")
    rid = jobs.run_tracked("unit_swallow", swallowing)
    db.expire_all()
    assert db.get(JobRun, rid).status == "failed"


def test_rerun_refuses_non_idempotent_job(client, db):
    admin = _user(db, "admin@premnathrail.com", role="admin")
    jobs.register_func("maintenance_pm_scheduler", lambda: 0)
    r = client.post("/api/v1/organization/monitor/jobs/maintenance_pm_scheduler/run", headers=_auth(admin))
    assert r.status_code == 409
    listed = client.get("/api/v1/organization/monitor/jobs", headers=_auth(admin))
    assert listed.status_code == 200
    assert any(j["job_id"] == "maintenance_pm_scheduler" for j in listed.json())


# ------------------------------------------------------------------ SM12

def test_parse_lock_target():
    t = parse_target("PATCH", "/api/v1/p2p/purchase-orders/12", "3")
    assert t["table"] == "p2p_purchase_orders" and t["ident"] == "12" and t["expected"] == 3
    assert parse_target("GET", "/api/v1/p2p/purchase-orders/12", "3") is None
    assert parse_target("PATCH", "/api/v1/p2p/purchase-orders/12", None) is None


def test_stale_save_raises_and_fresh_save_bumps_version(db):
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    other = _user(db, "first@premnathrail.com")
    other_name = other.name
    u = _user(db, "emp@premnathrail.com")
    p = HrEmployeeProfile(user_id=u.id)
    db.add(p)
    db.commit()
    assert p.lock_version == 1

    token = _state.set(parse_target("PATCH", f"/api/v1/hr/employees/{u.id}", "1"))
    try:
        p.work_location = "Plant 1"
        db.commit()
    finally:
        _state.reset(token)
    assert p.lock_version == 2

    p.lock_changed_by_id = other.id  # someone else saved last
    db.commit()
    token = _state.set(parse_target("PATCH", f"/api/v1/hr/employees/{u.id}", "2"))
    try:
        p.work_location = "Plant 2"
        with pytest.raises(StaleRecordError) as e:
            db.commit()
        assert e.value.changed_by == other_name
    finally:
        _state.reset(token)
        db.rollback()


def test_stale_http_save_returns_409(client, db):
    from app.modules.hr.models.employee_profile import HrEmployeeProfile

    admin = _user(db, "admin@premnathrail.com", role="admin")
    first = _user(db, "first@premnathrail.com")
    u = _user(db, "emp@premnathrail.com")
    p = HrEmployeeProfile(user_id=u.id, lock_version=1)
    db.add(p)
    db.commit()
    p.work_location = "A"
    p.lock_changed_by_id = first.id
    db.commit()  # version 2, changed by First
    r = client.patch(f"/api/v1/hr/employees/{u.id}", json={"work_location": "B"},
                     headers={**_auth(admin), "X-Lock-Version": "1"})
    assert r.status_code == 409, r.text
    assert "changed by First" in r.json()["detail"] and "Reload" in r.json()["detail"]


# ------------------------------------------------------------------ cockpit

def test_cockpit_access_and_shape(client, db):
    nobody = _user(db, "nobody@premnathrail.com")
    assert client.get("/api/v1/analytics/cockpit", headers=_auth(nobody)).status_code == 403
    partner = _user(db, "partner@premnathrail.com", is_partner=True)
    r = client.get("/api/v1/analytics/cockpit?refresh=true", headers=_auth(partner))
    assert r.status_code == 200, r.text
    kpis = {k["key"]: k for k in r.json()["kpis"]}
    # Sales retired (2026-10-30): the order intake, backlog and dispatch tiles are gone.
    assert list(kpis) == ["enquiries", "production_wip", "qc_holds", "billing", "collections", "service_sla"]
    assert all(k["status"] in ("ok", "unavailable") for k in kpis.values())
    assert kpis["billing"]["status"] == "ok" and len(kpis["billing"]["trend"]) == 12

    viewer = _user(db, "viewer@premnathrail.com", grants=["organization:cockpit:view"])
    r = client.get("/api/v1/analytics/cockpit?refresh=true", headers=_auth(viewer))
    assert all(k["status"] == "restricted" for k in r.json()["kpis"])
