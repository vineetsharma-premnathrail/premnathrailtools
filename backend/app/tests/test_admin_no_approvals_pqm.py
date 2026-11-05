"""Production, Quality and Maintenance: a portal admin approves / releases /
signs off / accepts / decides nothing just because they are admin
(owner decision 2026-11-04). Management actions (cancel a build, reopen a
stage) stay with the admin; decisions need a real grant or the named person."""
from datetime import datetime, timedelta, timezone

from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.production.service import rrv_can_manage, rrv_can_sign_off
from app.modules.quality.services import access as qaccess
from app.tests.test_cov_production_execution import (  # noqa: F401  (fixtures: s + SQLite number patch)
    API as PROD_API, _sqlite_document_numbers, auth, make_user as prod_user, new_wo, s,
)
from app.tests.test_maintenance import BASE, create_asset, hdr, make_user, setup_plant
from app.tests.test_rrv_builds import (  # noqa: F401  (fixtures: plant + SQLite number patch)
    _sqlite_numbers, new_build, plant, sp,
)

QUALITY_API = "/api/v1/quality"
NOW = datetime.now(timezone.utc)


def _admin(db, email, **kw):
    u = User(email=email, name=email.split("@")[0], role="admin", is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


# ── Production: work order release ───────────────────────────────────────

def test_admin_release_with_no_approver_is_refused_not_bypassed(client, db, s):
    admin = _admin(db, "adm.rel1@premnathrail.com")
    wo = new_wo(client, s, qty=1, release=False)
    s["user"].is_active = False  # the only holder of the Release approval
    db.commit()
    r = client.post(f"{PROD_API}/work-orders/{wo['id']}/release", headers=auth(admin))
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert "Nobody holds" in detail and "Role & Permissions" in detail  # who to configure, and where
    assert client.get(f"{PROD_API}/work-orders/{wo['id']}", headers=auth(admin)).json()["status"] == "draft"


def test_admin_release_goes_to_the_approver_and_stays_draft(client, db, s):
    admin = _admin(db, "adm.rel2@premnathrail.com")
    wo = new_wo(client, s, qty=1, release=False)
    r = client.post(f"{PROD_API}/work-orders/{wo['id']}/release", headers=auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"  # not released by the admin
    req = db.query(ApprovalRequest).filter_by(entity_id=wo["id"]).order_by(ApprovalRequest.id.desc()).first()
    assert req is not None and req.status == "pending" and req.requester_id == admin.id
    # The named approver decides it.
    assert client.post(f"{PROD_API}/work-orders/{wo['id']}/release", headers=s["h"]).json()["status"] == "released"


def test_admin_cannot_complete_or_close_a_work_order(client, db, s):
    admin = _admin(db, "adm.rel3@premnathrail.com")
    wo = new_wo(client, s, qty=1)
    for action in ("complete", "close"):
        r = client.post(f"{PROD_API}/work-orders/{wo['id']}/{action}", headers=auth(admin))
        assert r.status_code == 403, (action, r.text)


# ── Production: RRV sign-off vs management ───────────────────────────────

def test_rrv_sign_off_authority_excludes_admin_but_management_keeps_it(db, plant):
    admin = _admin(db, "adm.rrv1@premnathrail.com")
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    build = ProductionRrvBuild(build_manager_id=plant["manager"].id)
    assert rrv_can_sign_off(admin, build) is False
    assert rrv_can_sign_off(plant["manager"], build) is True       # build manager / production manager
    assert rrv_can_sign_off(plant["planner"], build) is False
    assert rrv_can_manage(admin, build) is True                     # cancel / reopen / cancel rework stay
    assert rrv_can_manage(plant["planner"], build) is False


def test_admin_gets_cancel_but_not_sign_off_on_a_build(client, db, plant):
    admin = _admin(db, "adm.rrv2@premnathrail.com")
    b = new_build(client, plant)
    detail = client.get(f"{PROD_API}/rrv-builds/{b['id']}", headers=auth(admin)).json()
    assert "sign_off" not in detail["allowed_actions"]
    assert "cancel" in detail["allowed_actions"] and "manage" in detail["allowed_actions"]  # cancel / reopen stage / cancel rework
    assert "request_sign_off" in detail["allowed_actions"]  # admin may only send it to the signers
    r = client.post(f"{PROD_API}/rrv-builds/{b['id']}/cancel", json={"reason": "Order lost"}, headers=auth(admin))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


# ── Quality: decisions need a real grant ─────────────────────────────────

def test_quality_authority_checks_never_pass_on_admin_alone(db):
    admin = _admin(db, "adm.q1@premnathrail.com")
    for fn in (qaccess.is_quality_head, qaccess.can_decide_lot, qaccess.can_approve_fai, qaccess.can_approve_plan,
               qaccess.can_close_capa, qaccess.can_close_complaint, qaccess.can_approve_vendor):
        assert fn(admin) is False, fn.__name__
    holder = _admin(db, "adm.q2@premnathrail.com", granular_permissions=["quality:inspection_lots:approve", "quality:ncr:approve"])
    assert qaccess.can_decide_lot(holder) is True and qaccess.is_quality_head(holder) is True
    assert qaccess.can_approve_plan(holder) is False


def test_ncr_design_and_purchase_authority_not_given_to_admin(db):
    admin = _admin(db, "adm.q3@premnathrail.com")
    assert qaccess.is_design_authority(admin) is False
    assert qaccess.is_purchase_authority(admin) is False
    designer = make_user(db, "q.designer@premnathrail.com", apps=("design",))
    buyer = make_user(db, "q.buyer@premnathrail.com", apps=("purchase",))
    assert qaccess.is_design_authority(designer) is True
    assert qaccess.is_purchase_authority(buyer) is True
    with_grant = _admin(db, "adm.q4@premnathrail.com", granular_permissions=["design:dashboard:view"])
    assert qaccess.is_design_authority(with_grant) is True  # a real grant still counts


def test_admin_is_refused_on_lot_usage_decision_and_fai_decision(client, db):
    admin = _admin(db, "adm.q5@premnathrail.com")
    h = {"Authorization": hdr(admin)["Authorization"]}
    r = client.post(f"{QUALITY_API}/inspection-lots/1/decision", json={"decision": "accept"}, headers=h)
    assert r.status_code == 403, r.text
    r = client.post(f"{QUALITY_API}/first-articles/1/decision", json={"approve": True}, headers=h)
    assert r.status_code == 403, r.text
    r = client.post(f"{QUALITY_API}/first-articles/1/decision", json={"approve": False, "remarks": "x"}, headers=h)
    assert r.status_code == 403, r.text


# ── Maintenance ──────────────────────────────────────────────────────────

def test_admin_cannot_confirm_a_repair_for_the_requester(client, db):
    branch, *_ = setup_plant(db)
    maint = make_user(db, "adm.m1.maint@premnathrail.com")
    prod = make_user(db, "adm.m1.prod@premnathrail.com", apps=("production",))
    admin = make_user(db, "adm.m1.admin@premnathrail.com", role="admin")
    hm, hp, ha = hdr(maint), hdr(prod), hdr(admin)
    asset = create_asset(client, hm, branch, criticality="C")
    req = client.post(f"{BASE}/requests", json={"asset_id": asset["id"], "machine_down": True, "problem_description": "Leak"}, headers=hp).json()
    wo_id = client.post(f"{BASE}/requests/{req['id']}/convert", json={"assigned_to_id": maint.id}, headers=hm).json()["work_order"]["id"]
    client.post(f"{BASE}/work-orders/{wo_id}/start", headers=hm)
    client.post(f"{BASE}/work-orders/{wo_id}/complete", json={"failure_category": "hydraulic", "root_cause": "Seal", "action_taken": "Seal changed"}, headers=hm)

    assert client.get(f"{BASE}/requests/{req['id']}", headers=hp).json()["can_confirm"] is True
    assert client.get(f"{BASE}/requests/{req['id']}", headers=ha).json()["can_confirm"] is False
    r = client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": True}, headers=ha)
    assert r.status_code == 403 and "can't confirm it on their behalf" in r.json()["detail"]
    assert client.post(f"{BASE}/requests/{req['id']}/confirm", json={"ok": True}, headers=hp).status_code == 200


def test_admin_cannot_accept_a_permit_even_one_they_issued(client, db):
    branch, *_ = setup_plant(db)
    admin = make_user(db, "adm.m2.admin@premnathrail.com", role="admin")
    tech = make_user(db, "adm.m2.tech@premnathrail.com")
    ha = hdr(admin)
    a = create_asset(client, ha, branch)
    wo = client.post(f"{BASE}/work-orders", json={"asset_id": a["id"], "title": "Weld guard", "assigned_to_id": tech.id, "wo_type": "improvement",
                                                  "permit_required": True}, headers=ha).json()
    r = client.post(f"{BASE}/work-orders/{wo['id']}/permits", json={"permit_type": "hot_work", "hazards": "Sparks",
                                                                   "valid_to": (NOW + timedelta(hours=8)).isoformat()}, headers=ha)
    assert r.status_code == 201, r.text
    permit = r.json()
    assert permit["status"] == "issued"
    r = client.post(f"{BASE}/permits/{permit['id']}/activate", headers=ha)
    assert r.status_code in (403, 409), r.text  # no 'approve' grant for an admin; two-person rule has no admin exception
    assert client.post(f"{BASE}/permits/{permit['id']}/activate", headers=hdr(tech)).json()["status"] == "active"
