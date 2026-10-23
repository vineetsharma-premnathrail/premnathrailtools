"""RBAC enforcement on HR & Administration (deny by default).

Users here are built WITHOUT assigned_apps (apps=()), so they get only the
grants listed in granular_permissions — no migrated legacy access."""
from datetime import date

import pytest

from app.modules.hr.models.asset import HrAsset
from app.modules.hr.models.holiday import HrHoliday
from app.modules.hr.models.leave import HrLeaveRequest
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

ME_ALL = ["hr:me:view", "hr:me:create", "hr:me:edit"]


def rbac_user(db, email, grants, **fields):
    return make_user(db, email, apps=(), granular_permissions=list(grants), **fields)


@pytest.fixture
def plant(db):
    return make_branch(db, "P1", "Mon-Sat")


# (a) view-only user: 403 on create / edit / delete ─────────────────────────

def test_holidays_view_only_user_cannot_write(client, db):
    h = HrHoliday(holiday_date=date(2026, 12, 25), name="Christmas", holiday_type="national", year=2026)
    db.add(h)
    db.commit()
    viewer = rbac_user(db, "holiday.viewer@premnathrail.com", ["hr:holidays:view"])
    hv = hdr(viewer)
    assert client.get(f"{HR}/holidays?year=2026", headers=hv).status_code == 200
    r = client.post(f"{HR}/holidays", json={"holiday_date": "2026-11-14", "name": "Diwali", "holiday_type": "festival"}, headers=hv)
    assert r.status_code == 403 and "'Create' permission on HR & Administration › Holidays" in r.json()["detail"]
    assert client.patch(f"{HR}/holidays/{h.id}", json={"name": "X-mas"}, headers=hv).status_code == 403
    r = client.delete(f"{HR}/holidays/{h.id}", headers=hv)
    assert r.status_code == 403 and "'Delete' permission on HR & Administration › Holidays" in r.json()["detail"]
    assert db.get(HrHoliday, h.id) is not None


def test_assets_and_masters_view_only_user_cannot_write(client, db):
    viewer = rbac_user(db, "asset.viewer@premnathrail.com", ["hr:assets:view", "hr:masters:view"])
    hv = hdr(viewer)
    assert client.get(f"{HR}/assets", headers=hv).status_code == 200
    assert client.post(f"{HR}/assets", json={"name": "Laptop", "category": "laptop"}, headers=hv).status_code == 403
    assert client.post(f"{HR}/masters/grades", json={"code": "G1", "name": "Grade 1", "level": 1}, headers=hv).status_code == 403


# (b) delete = 'delete' on the tab AND you created the record ───────────────

def test_asset_delete_only_own_records(client, db):
    other = rbac_user(db, "other.hr@premnathrail.com", ["hr:assets:view", "hr:assets:create"])
    theirs = HrAsset(asset_code="AST-9001", name="Their laptop", category="laptop", status="in_stock", created_by_id=other.id)
    db.add(theirs)
    db.commit()
    keeper = rbac_user(db, "asset.keeper@premnathrail.com",
                       ["hr:assets:view", "hr:assets:create", "hr:assets:edit", "hr:assets:delete"])
    hk = hdr(keeper)
    r = client.post(f"{HR}/assets", json={"asset_code": "AST-9002", "name": "My laptop", "category": "laptop"}, headers=hk)
    assert r.status_code == 201, r.text
    mine = r.json()
    assert mine["created_by_id"] == keeper.id

    r = client.delete(f"{HR}/assets/{theirs.id}", headers=hk)
    assert r.status_code == 403 and "created yourself" in r.json()["detail"]
    assert client.delete(f"{HR}/assets/{mine['id']}", headers=hk).status_code == 200
    # Creator without 'delete' can't delete their own either.
    assert client.delete(f"{HR}/assets/{theirs.id}", headers=hdr(other)).status_code == 403


# (c) an employee holding only hr:me:* applies their own leave ──────────────

def test_me_only_employee_applies_and_withdraws_own_leave(client, db, plant):
    mgr = rbac_user(db, "me.mgr@premnathrail.com", ["hr:me:view"], branch_id=plant.id)
    emp = rbac_user(db, "me.emp@premnathrail.com", ME_ALL, branch_id=plant.id, reporting_manager_id=mgr.id)
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl, 2026, allotted=10)
    he = hdr(emp)
    data = {"leave_type_id": str(cl.id), "from_date": "2026-11-02", "to_date": "2026-11-03", "reason": "Family function"}
    r = client.post(f"{HR}/leave/requests", data=data, headers=he)
    assert r.status_code == 200, r.text
    assert r.json()["approver_id"] == mgr.id and r.json()["can_cancel"] is True
    assert client.get(f"{HR}/leave/requests/me", headers=he).status_code == 200
    assert client.get(f"{HR}/leave/balances/me", headers=he).status_code == 200
    # Withdrawing your own request is hr:me:edit, not delete.
    r = client.post(f"{HR}/leave/requests/{r.json()['id']}/cancel", json={}, headers=he)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # ...but the HR Leave tab stays closed.
    assert client.get(f"{HR}/leave/requests", headers=he).status_code == 403
    # Without hr:me:create you can't apply.
    viewer = rbac_user(db, "me.viewer@premnathrail.com", ["hr:me:view"], branch_id=plant.id)
    assert client.post(f"{HR}/leave/requests", data=data, headers=hdr(viewer)).status_code == 403


# (d) the routed approver (reporting manager) decides on routing alone ─────

def _pending(db, emp, cl, approver, no):
    req = HrLeaveRequest(request_no=no, user_id=emp.id, leave_type_id=cl.id, from_date=date(2026, 11, 2),
                         to_date=date(2026, 11, 2), days=Decimal("1"), reason="x", status="pending",
                         approver_id=approver.id if approver else None)
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def test_reporting_manager_with_only_me_view_approves_reportee_leave(client, db, plant):
    mgr = rbac_user(db, "route.mgr@premnathrail.com", ["hr:me:view"], branch_id=plant.id)
    emp = rbac_user(db, "route.emp@premnathrail.com", ME_ALL, branch_id=plant.id, reporting_manager_id=mgr.id)
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl, 2026, allotted=10)
    req = _pending(db, emp, cl, mgr, "LV-2026-0950")
    pend = client.get(f"{HR}/leave/requests/pending-for-me", headers=hdr(mgr)).json()
    assert [p["id"] for p in pend] == [req.id] and pend[0]["can_decide"] is True
    r = client.post(f"{HR}/leave/requests/{req.id}/approve", json={"remarks": "ok"}, headers=hdr(mgr))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"

    # Not the routed approver: approvals:view alone isn't enough to decide…
    other = _pending(db, emp, cl, None, "LV-2026-0951")
    viewer = rbac_user(db, "approvals.viewer@premnathrail.com", ["hr:approvals:view"])
    r = client.post(f"{HR}/leave/requests/{other.id}/reject", json={"remarks": "no"}, headers=hdr(viewer))
    assert r.status_code == 403
    # …HR with hr:approvals:reject can.
    decider = rbac_user(db, "approvals.decider@premnathrail.com", ["hr:approvals:view", "hr:approvals:approve", "hr:approvals:reject"])
    r = client.post(f"{HR}/leave/requests/{other.id}/reject", json={"remarks": "Clash with audit"}, headers=hdr(decider))
    assert r.status_code == 200, r.text
    # A me-only colleague who isn't the approver can't decide.
    stranger = rbac_user(db, "route.stranger@premnathrail.com", ["hr:me:view"])
    third = _pending(db, emp, cl, mgr, "LV-2026-0952")
    assert client.post(f"{HR}/leave/requests/{third.id}/approve", json={}, headers=hdr(stranger)).status_code == 403
