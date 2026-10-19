"""HR on the central authorization framework: leave / travel / claims /
regularization approvals through the approval engine, in-flight (pre-engine)
requests still decidable the old way, HR handover moving every module's open
approval steps, and HR data scope."""
from datetime import date

from app.modules.hr.models.leave import HrLeaveBalance, HrLeaveRequest
from app.modules.hr.services import approvals as hr_approvals
from app.modules.main.models.role import Role
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.tests.test_cov_hr_support import *  # noqa: F401,F403

L = f"{HR}/leave"


def _org(db):
    plant = make_branch(db, "P1", "Mon-Sat")
    hr = make_user(db, "ca.hr@premnathrail.com", apps=("hr",))
    hr.granular_permissions = ["hr:approvals:view", "hr:approvals:approve", "hr:approvals:reject", "hr:leave:view"]
    mgr = make_user(db, "ca.mgr@premnathrail.com", apps=("hr",), branch_id=plant.id)
    emp = make_user(db, "ca.emp@premnathrail.com", apps=("hr",), branch_id=plant.id, reporting_manager_id=mgr.id)
    db.commit()
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, emp, cl, 2026, allotted=10)
    return {"plant": plant, "hr": hr, "mgr": mgr, "emp": emp, "cl": cl}


def _apply(client, user, lt, start, end):
    return client.post(f"{L}/requests", headers=hdr(user), data={
        "leave_type_id": str(lt.id), "from_date": start.isoformat(), "to_date": end.isoformat(),
        "from_session": "full", "to_session": "full", "reason": "Family function"})


def test_leave_submit_routes_through_engine_and_decides(client, db):
    o = _org(db)
    r = _apply(client, o["emp"], o["cl"], date(2026, 11, 2), date(2026, 11, 3))
    assert r.status_code == 200, r.text
    leave = r.json()
    areq = engine.latest_request(db, hr_approvals.LEAVE_ENTITY, leave["id"])
    assert areq is not None and areq.workflow_key == "hr.leave" and areq.status == "pending"
    approvers = {s.approver_id for s in areq.steps}
    also = {i for s in areq.steps for i in (s.escalated_to_ids or [])}
    # The manager is the approver; HR approvers may also decide (not pinged).
    assert approvers == {o["mgr"].id} and o["hr"].id in also and o["emp"].id not in approvers | also
    assert leave["approval_request_id"] == areq.id and leave["approver_id"] == o["mgr"].id

    # Manager sees it in HR > Approvals (engine inbox) and in the central inbox.
    pend = client.get(f"{L}/requests/pending-for-me", headers=hdr(o["mgr"])).json()
    assert [p["id"] for p in pend] == [leave["id"]] and pend[0]["can_decide"] is True
    central = client.get("/api/v1/approvals/inbox", headers=hdr(o["mgr"])).json()
    assert [(x["module_key"], x["entity_id"]) for x in central] == [("hr", leave["id"])]

    # The requester can't decide their own leave.
    r = client.post(f"{L}/requests/{leave['id']}/approve", json={}, headers=hdr(o["emp"]))
    assert r.status_code == 403 and "your own" in r.json()["detail"]

    # Decide on the central endpoint: on_decided deducts the balance.
    r = client.post(f"/api/v1/approvals/requests/{areq.id}/decide", json={"decision": "approve", "comment": "Enjoy"},
                    headers=hdr(o["mgr"]))
    assert r.status_code == 200, r.text
    db.expire_all()
    lv = db.get(HrLeaveRequest, leave["id"])
    assert lv.status == "approved" and lv.decided_by_id == o["mgr"].id and lv.decision_remarks == "Enjoy"
    bal = db.query(HrLeaveBalance).filter_by(user_id=o["emp"].id, leave_type_id=o["cl"].id, year=2026).one()
    assert bal.used == Decimal("2")

    # Module endpoint after the engine finished: the usual "already approved".
    r = client.post(f"{L}/requests/{leave['id']}/approve", json={}, headers=hdr(o["mgr"]))
    assert r.status_code == 400 and "already approved" in r.json()["detail"]


def test_leave_reject_via_module_endpoint_and_withdraw(client, db):
    o = _org(db)
    first = _apply(client, o["emp"], o["cl"], date(2026, 11, 9), date(2026, 11, 9)).json()
    # HR (plus_permission co-approver) rejects through the HR endpoint → engine.
    r = client.post(f"{L}/requests/{first['id']}/reject", json={"remarks": "Audit week"}, headers=hdr(o["hr"]))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"
    assert engine.latest_request(db, hr_approvals.LEAVE_ENTITY, first["id"]).status == "rejected"

    second = _apply(client, o["emp"], o["cl"], date(2026, 11, 10), date(2026, 11, 10)).json()
    r = client.post(f"{L}/requests/{second['id']}/cancel", json={}, headers=hdr(o["emp"]))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert engine.latest_request(db, hr_approvals.LEAVE_ENTITY, second["id"]).status == "cancelled"
    assert client.get(f"{L}/requests/pending-for-me", headers=hdr(o["mgr"])).json() == []


def test_requester_without_any_approver_gets_the_engine_reason(client, db):
    lonely = make_user(db, "ca.lonely@premnathrail.com", apps=())
    lonely.granular_permissions = ["hr:me:view", "hr:me:create", "hr:me:edit"]
    db.commit()
    cl = make_leave_type(db, "CL", "Casual Leave", 12)
    make_balance(db, lonely, cl, 2026, allotted=5)
    # Nobody holds hr:approvals:approve and there's no reporting manager.
    if hr_approvals.engine.permission_holders(db, hr_approvals.HR_DECIDER_PERMISSION):
        return  # environment has HR approvers (legacy app grants) — the stage resolves
    r = _apply(client, lonely, cl, date(2026, 11, 2), date(2026, 11, 2))
    assert r.status_code == 422 and "no reporting manager" in r.json()["detail"]


def test_inflight_pre_engine_leave_still_decided_the_old_way(client, db):
    o = _org(db)
    legacy = HrLeaveRequest(request_no="LV-2026-0900", user_id=o["emp"].id, leave_type_id=o["cl"].id,
                            from_date=date(2026, 11, 2), to_date=date(2026, 11, 2), days=Decimal("1"),
                            status="pending", approver_id=o["mgr"].id)
    db.add(legacy)
    db.commit()
    pend = client.get(f"{L}/requests/pending-for-me", headers=hdr(o["mgr"])).json()
    assert [p["id"] for p in pend] == [legacy.id] and pend[0]["approval_request_id"] is None
    r = client.post(f"{L}/requests/{legacy.id}/approve", json={}, headers=hdr(o["mgr"]))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert db.query(ApprovalRequest).filter_by(entity_type=hr_approvals.LEAVE_ENTITY, entity_id=legacy.id).count() == 0


def test_handover_moves_every_open_engine_step(db):
    o = _org(db)
    succ = make_user(db, "ca.successor@premnathrail.com", apps=("hr",))
    hr_actor = make_user(db, "ca.hr2@premnathrail.com", apps=("hr",))
    # An open step of the leaving manager in another module…
    other = engine.submit(db, "hr.travel", entity_id=4242, requester=o["emp"], title="Trip", reference="TR-X")
    # …and one on a request the successor raised themself (can't be handed to them).
    succ.reporting_manager_id = o["mgr"].id
    db.commit()
    own = engine.submit(db, "hr.travel", entity_id=4243, requester=succ, title="Own trip", reference="TR-Y")
    db.commit()

    changes, conflicts = hr_approvals.hand_over_engine_steps(db, o["mgr"], succ, hr_actor, "Exit LC-1")
    db.commit()
    assert any("→" in c for c in changes)
    assert [s.approver_id for s in other.steps if s.approver_id in (o["mgr"].id, succ.id)] == [succ.id]
    assert o["mgr"].id in [s.approver_id for s in own.steps]  # stays put
    assert len(conflicts) == 1 and "TR-Y" in conflicts[0]


def test_manager_change_reroutes_open_steps(db):
    o = _org(db)
    new_mgr = make_user(db, "ca.newmgr@premnathrail.com", apps=("hr",))
    req = engine.submit(db, "hr.leave", entity_id=777, requester=o["emp"], title="Leave", reference="LV-Z")
    db.commit()
    moved = hr_approvals.reroute_requester_steps(db, o["emp"].id, o["mgr"].id, new_mgr.id, o["hr"])
    db.commit()
    assert moved == ["LV-Z"]
    assert new_mgr.id in [s.approver_id for s in req.steps] and o["mgr"].id not in [s.approver_id for s in req.steps]


def test_hr_data_scope_limits_lists_but_not_my_hr(client, db):
    o = _org(db)
    other = make_user(db, "ca.other@premnathrail.com", apps=("hr",))
    make_balance(db, other, o["cl"], 2026, allotted=5)
    db.add_all([
        HrLeaveRequest(request_no="LV-2026-0950", user_id=o["emp"].id, leave_type_id=o["cl"].id, from_date=date(2026, 11, 2),
                       to_date=date(2026, 11, 2), days=Decimal("1"), status="approved"),
        HrLeaveRequest(request_no="LV-2026-0951", user_id=other.id, leave_type_id=o["cl"].id, from_date=date(2026, 11, 3),
                       to_date=date(2026, 11, 3), days=Decimal("1"), status="approved"),
    ])
    clerk = make_user(db, "ca.clerk@premnathrail.com", apps=())
    role = Role(name="HR clerk (own)", permissions=["hr:leave:view", "hr:me:view"], data_scopes={"hr": "own"})
    db.add(role)
    db.commit()
    clerk.roles = [role]
    db.commit()
    rows = client.get(f"{L}/requests", headers=hdr(clerk)).json()
    assert rows == []  # own scope: none of these are the clerk's
    # Widen to organization → both.
    role.data_scopes = {"hr": "organization"}
    db.commit()
    rows = client.get(f"{L}/requests", headers=hdr(clerk)).json()
    assert {r["request_no"] for r in rows} == {"LV-2026-0950", "LV-2026-0951"}
    # My HR is unaffected by the scope.
    mine = client.get(f"{L}/requests/me", headers=hdr(o["emp"])).json()
    assert [r["request_no"] for r in mine] == ["LV-2026-0950"]


def test_hr_lists_and_employee_record_under_department_scope(client, db):
    o = _org(db)
    for u, dept in ((o["emp"], "Stores"), (o["mgr"], "Stores")):
        u.department = dept
    outsider = make_user(db, "ca.outsider@premnathrail.com", apps=("hr",), department="Sales", branch_id=o["plant"].id)
    db.add_all([
        HrLeaveRequest(request_no="LV-2026-0960", user_id=o["emp"].id, leave_type_id=o["cl"].id, from_date=date(2026, 10, 7),
                       to_date=date(2026, 10, 7), days=Decimal("1"), status="approved"),
        HrLeaveRequest(request_no="LV-2026-0961", user_id=outsider.id, leave_type_id=o["cl"].id, from_date=date(2026, 10, 7),
                       to_date=date(2026, 10, 7), days=Decimal("1"), status="approved"),
    ])
    head = make_user(db, "ca.storeshead@premnathrail.com", apps=(), department="Stores", branch_id=o["plant"].id)
    role = Role(name="Stores HR (dept)", permissions=["hr:dashboard:view", "hr:leave:view", "hr:employees:view"],
                data_scopes={"hr": "department"})
    db.add(role)
    db.commit()
    head.roles = [role]
    db.commit()
    rows = client.get(f"{L}/requests", headers=hdr(head)).json()
    assert [r["request_no"] for r in rows] == ["LV-2026-0960"]
    # (The dashboard and employee list use Postgres-only SQL — split_part — so
    # they are not exercised on SQLite here; both take the same scope filters.)
    assert client.get(f"{HR}/employees/{o['emp'].id}", headers=hdr(head)).status_code == 200
    r = client.get(f"{HR}/employees/{outsider.id}", headers=hdr(head))
    assert r.status_code == 403 and "outside your HR data access" in r.json()["detail"]
