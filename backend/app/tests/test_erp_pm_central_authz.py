"""Service (erp) and Project Management on the central authorization
framework: approvals through the approval engine (incl. pre-engine in-flight
items) and data-scope filtering."""
from datetime import date, timedelta

from app.auth.jwt_handler import create_access_token
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.organization.services import approval_engine as engine
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject

API = "/api/v1"
TODAY = date.today()


def _user(db, email, role="user", **kw):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def _scoped(db, email, module, perms, level):
    role = Role(name=f"{module} {level} {email}", permissions=perms, data_scopes={module: level})
    db.add(role)
    db.commit()
    u = _user(db, email)
    u.roles = [role]
    db.commit()
    return u


# ── Service: machine approval ────────────────────────────────────────────

def _enable_machine_approval(client, admin, approver_ids):
    r = client.put(f"{API}/erp/settings", json={"values": {"project_approval_required": True}}, headers=h(admin))
    assert r.status_code == 200, r.text
    r = client.put(f"{API}/organization/workflows/erp.machine", headers=h(admin), json={
        "stages": [{"name": "Machine approvers", "approver_rule": "specific_users", "rule_config": {"user_ids": approver_ids}}]})
    assert r.status_code == 200, r.text


def test_machine_approval_through_central_endpoint(client, db):
    admin = _user(db, "erp.admin@premnathrail.com", role="admin")
    approver = _user(db, "erp.appr@premnathrail.com", assigned_apps=["erp"])
    creator = _user(db, "erp.maker@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_edit"])
    _enable_machine_approval(client, admin, [approver.id])

    m = client.post(f"{API}/erp/projects", json={"serial_number": "CA-1"}, headers=h(creator)).json()
    assert m["approval_status"] == "pending"
    st = client.get(f"{API}/approvals/entity/erp_machine/{m['id']}", headers=h(approver)).json()
    assert st["current"]["can_decide"] is True
    assert client.get(f"{API}/approvals/entity/erp_machine/{m['id']}", headers=h(creator)).json()["current"]["can_decide"] is False

    r = client.post(f"{API}/approvals/requests/{st['current']['id']}/decide", json={"decision": "approve"}, headers=h(approver))
    assert r.status_code == 200, r.text
    db.expire_all()
    p = db.get(Project, m["id"])
    assert p.approval_status == "approved" and p.approved_by_id == approver.id


def test_machine_rejected_then_resubmitted_by_editing(client, db):
    admin = _user(db, "erp.admin2@premnathrail.com", role="admin")
    approver = _user(db, "erp.appr2@premnathrail.com", assigned_apps=["erp"])
    creator = _user(db, "erp.maker2@premnathrail.com", assigned_apps=["erp"], erp_permissions=["project_create", "project_edit"])
    _enable_machine_approval(client, admin, [approver.id])
    m = client.post(f"{API}/erp/projects", json={"serial_number": "CA-2"}, headers=h(creator)).json()
    req = engine.latest_request(db, "erp_machine", m["id"])
    r = client.post(f"{API}/approvals/requests/{req.id}/decide", json={"decision": "return", "comment": "Wrong client"}, headers=h(approver))
    assert r.status_code == 200, r.text
    assert client.get(f"{API}/erp/projects/{m['id']}", headers=h(creator)).json()["approval_status"] == "rejected"
    r = client.patch(f"{API}/erp/projects/{m['id']}", json={"client_company": "Right Co"}, headers=h(creator))
    assert r.json()["approval_status"] == "pending"
    assert engine.latest_request(db, "erp_machine", m["id"]).revision == 2


def test_machine_in_flight_before_engine_uses_old_approvers(client, db):
    old = _user(db, "erp.old@premnathrail.com", assigned_apps=["erp"])
    other = _user(db, "erp.other@premnathrail.com", assigned_apps=["erp"])
    db.add(ModuleSetting(module_key="erp", key="project_approvers", value=[old.id]))
    p = Project(serial_number="CA-OLD", approval_status="pending")
    db.add(p)
    db.commit()
    assert engine.latest_request(db, "erp_machine", p.id) is None
    r = client.post(f"{API}/erp/projects/{p.id}/approve", json={}, headers=h(other))
    assert r.status_code == 403 and "original approvers" in r.json()["detail"]
    r = client.post(f"{API}/erp/projects/{p.id}/approve", json={}, headers=h(old))
    assert r.status_code == 200 and r.json()["approval_status"] == "approved"


def test_old_approver_setting_seeds_the_workflow(db):
    from app.modules.erp import access

    keeper = _user(db, "erp.keep@premnathrail.com")
    db.add(ModuleSetting(module_key="erp", key="sr_close_approvers", value=[keeper.id]))
    db.commit()
    access.seed_workflow(db, access.SR_CLOSE_KEY)
    wf = engine.ensure_workflow(db, access.SR_CLOSE_KEY)
    assert wf.stages[0].approver_rule == "specific_users" and wf.stages[0].rule_config == {"user_ids": [keeper.id]}


# ── Service: data scope ──────────────────────────────────────────────────

def test_service_request_scope_own(client, db):
    machine = Project(serial_number="SC-1", approval_status="approved")
    db.add(machine)
    db.commit()
    mine = _scoped(db, "erp.own@premnathrail.com", "erp", ["erp:*:*"], "own")
    eng = _user(db, "erp.eng@premnathrail.com")
    db.add_all([
        ServiceRequest(request_number="SR-A", project_id=machine.id, issue_title="a", created_by_id=mine.id),
        ServiceRequest(request_number="SR-B", project_id=machine.id, issue_title="b", created_by_id=eng.id),
        ServiceRequest(request_number="SR-C", project_id=machine.id, issue_title="c", created_by_id=eng.id,
                       assigned_service_person_id=mine.id),
    ])
    db.commit()
    rows = client.get(f"{API}/erp/service-requests", headers=h(mine)).json()
    assert sorted(r["request_number"] for r in rows) == ["SR-A"]
    other = db.query(ServiceRequest).filter_by(request_number="SR-B").one()
    r = client.get(f"{API}/erp/service-requests/{other.id}", headers=h(mine))
    assert r.status_code == 403 and "Own records" in r.json()["detail"]

    mine.data_access_scopes = {"erp": "assigned"}  # personal override: + assigned to me
    db.commit()
    rows = client.get(f"{API}/erp/service-requests", headers=h(mine)).json()
    assert sorted(r["request_number"] for r in rows) == ["SR-A", "SR-C"]


# ── Project Management: milestone acceptance ─────────────────────────────

def _pm_setup(client, db):
    partner = _user(db, "pm.partner@x.com", assigned_apps=["projects"], is_partner=True)
    pm = _user(db, "pm.pm@x.com", assigned_apps=["projects"])
    head = _user(db, "pm.head@x.com", assigned_apps=["design"], department="Design")
    member = _user(db, "pm.member@x.com", assigned_apps=["design"], department="Design")
    dept = Department(name="Design", code="DES", head_user_id=head.id)
    db.add(dept)
    db.commit()
    p = client.post(f"{API}/projects", headers=h(partner), json={
        "project_code": "CA-39", "name": "RRV", "client_name": "IRCON", "project_manager_id": pm.id,
        "customer_po_ref": "PO-CA", "sales_order_ref": "SO-CA",
        "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=60))}).json()
    m = client.post(f"{API}/projects/{p['id']}/milestones", headers=h(pm), json={
        "title": "GA drawing", "department_id": dept.id, "lead_user_id": head.id,
        "target_date": str(TODAY + timedelta(days=30)), "deliverable": "Signed GA drawing + BOM"}).json()
    # Adding the first WBS already releases the project (no separate Release step).
    assert client.get(f"{API}/projects/{p['id']}", headers=h(pm)).json()["status"] == "active"
    t = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=h(head), json={
        "title": "Draw", "assignee_id": member.id, "due_date": str(TODAY + timedelta(days=10))}).json()
    assert client.post(f"{API}/pm-work/tasks/{t['id']}/start", headers=h(member)).status_code == 200
    assert client.post(f"{API}/pm-work/tasks/{t['id']}/complete", headers=h(member), json={"note": "Delivered drawing DWG-12 rev A"}).status_code == 200
    return {"partner": partner, "pm": pm, "head": head, "member": member, "project": p, "milestone": m}


def test_milestone_acceptance_through_engine(client, db):
    s = _pm_setup(client, db)
    mid = s["milestone"]["id"]
    r = client.post(f"{API}/pm-work/milestones/{mid}/submit", headers=h(s["head"]), json={"submission_note": "DWG-12"})
    assert r.status_code == 200, r.text
    req = engine.latest_request(db, "pm_milestone", mid)
    assert req.status == "pending"
    assert {st.approver_id for st in req.steps} == {s["pm"].id, s["partner"].id}  # PM + management
    # The department head is not management → can't accept.
    bad = client.post(f"{API}/approvals/requests/{req.id}/decide", json={"decision": "approve"}, headers=h(s["head"]))
    assert bad.status_code == 403
    ok = client.post(f"{API}/approvals/requests/{req.id}/decide", json={"decision": "approve"}, headers=h(s["partner"]))
    assert ok.status_code == 200, ok.text
    db.expire_all()
    m = db.get(PmProjectMilestone, mid)
    assert m.status == "achieved" and m.achieved_by_id == s["partner"].id and m.actual_date == TODAY


def test_milestone_reject_via_module_route_goes_through_engine(client, db):
    s = _pm_setup(client, db)
    pid, mid = s["project"]["id"], s["milestone"]["id"]
    client.post(f"{API}/pm-work/milestones/{mid}/submit", headers=h(s["head"]), json={"submission_note": "DWG-12"})
    r = client.post(f"{API}/projects/{pid}/milestones/{mid}/reject", headers=h(s["pm"]), json={"reason": "Missing BOM"})
    assert r.status_code == 200 and r.json()["status"] == "in_progress" and r.json()["return_reason"] == "Missing BOM"
    assert engine.latest_request(db, "pm_milestone", mid).status == "rejected"


def test_milestone_in_flight_before_engine_uses_old_check(client, db):
    s = _pm_setup(client, db)
    pid, mid = s["project"]["id"], s["milestone"]["id"]
    m = db.get(PmProjectMilestone, mid)
    m.status = "submitted"  # submitted before the cut-over: no engine request
    db.commit()
    assert client.post(f"{API}/projects/{pid}/milestones/{mid}/accept", headers=h(s["head"]), json={}).status_code == 403
    r = client.post(f"{API}/projects/{pid}/milestones/{mid}/accept", headers=h(s["pm"]), json={})
    assert r.status_code == 200 and r.json()["status"] == "achieved"


# ── Project Management: data scope ───────────────────────────────────────

def test_pm_project_scope(client, db):
    viewer = _scoped(db, "pm.scoped@x.com", "projects", ["projects:*:*"], "own")
    other = _user(db, "pm.someone@x.com")
    db.add_all([
        PmProject(project_code="OWN-1", name="Mine", project_manager_id=viewer.id),
        PmProject(project_code="OTH-1", name="Not mine", project_manager_id=other.id, created_by_id=other.id),
    ])
    db.commit()
    rows = client.get(f"{API}/projects", headers=h(viewer)).json()
    assert [r["project_code"] for r in rows] == ["OWN-1"]
    oth = db.query(PmProject).filter_by(project_code="OTH-1").one()
    r = client.get(f"{API}/projects/{oth.id}", headers=h(viewer))
    assert r.status_code == 403 and "project" in r.json()["detail"]
    # A milestone I lead on someone else's project opens it at "assigned".
    db.add(PmProjectMilestone(project_id=oth.id, title="Step", target_date=TODAY, lead_user_id=viewer.id))
    viewer.data_access_scopes = {"projects": "assigned"}
    db.commit()
    assert sorted(r["project_code"] for r in client.get(f"{API}/projects", headers=h(viewer)).json()) == ["OTH-1", "OWN-1"]
