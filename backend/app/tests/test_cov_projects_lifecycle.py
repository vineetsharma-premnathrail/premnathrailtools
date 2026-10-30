"""Coverage: Project Management — project-level rules. Who counts as
management, the app-access gate, create/edit validation, the lifecycle
transition table (Planning → Active ⇄ On hold → Technically complete →
Closed, Cancelled) with its real error messages, deletion rules and audit."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department

API = "/api/v1"
TODAY = date.today()


def make_user(db, email, apps=(), department=None, grants=None, role="user", **flags):
    flags.setdefault("is_active", True)
    user = User(email=email, name=email.split("@")[0], role=role, assigned_apps=list(apps),
                department=department, **flags)
    if grants is not None:
        user.granular_permissions = list(grants)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def notes(db, user, ntype):
    db.expire_all()
    return db.query(Notification).filter(Notification.user_id == user.id, Notification.notification_type == ntype).count()


def body(pm_id, **extra):
    data = {"project_code": "PEW-50", "name": "Tamping machine", "client_name": "RVNL", "project_manager_id": pm_id,
            "customer_po_ref": "PO-1", "sales_order_ref": "SO-1",
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=60))}
    data.update(extra)
    return data


@pytest.fixture
def w(client, db):
    partner = make_user(db, "lc.partner@x.com", apps=("projects",), is_partner=True)
    pm = make_user(db, "lc.pm@x.com", apps=("projects",))
    head = make_user(db, "lc.head@x.com", apps=("design",), department="Design")  # Design › Ongoing Projects
    member = make_user(db, "lc.member@x.com", apps=("design",), department="Design")
    viewer = make_user(db, "lc.viewer@x.com", apps=("projects",))
    noapp = make_user(db, "lc.noapp@x.com")
    dept = Department(name="Design", code="DES", head_user_id=head.id)
    db.add(dept)
    db.commit()
    return {"partner": partner, "pm": pm, "head": head, "member": member, "viewer": viewer, "noapp": noapp, "dept": dept}


def create(client, w, **extra):
    r = client.post(f"{API}/projects", headers=auth(w["partner"]), json=body(w["pm"].id, **extra))
    assert r.status_code == 200, r.text
    return r.json()


def add_milestone(client, w, pid, days=30, title="GA drawing"):
    r = client.post(f"{API}/projects/{pid}/milestones", headers=auth(w["pm"]), json={
        "title": title, "department_id": w["dept"].id, "lead_user_id": w["head"].id,
        "target_date": str(TODAY + timedelta(days=days)), "deliverable": "Signed GA drawing + BOM"})
    assert r.status_code == 200, r.text
    return r.json()


def transition(client, user, pid, action, **extra):
    return client.post(f"{API}/projects/{pid}/transition", headers=auth(user), json={"action": action, **extra})


# ── App-access gate and who is management ──────────────────────────────

def test_project_routes_need_the_projects_app(client, db, w):
    p = create(client, w)
    for path in ("/projects", "/projects/dashboard", "/projects/board", f"/projects/{p['id']}",
                 f"/projects/{p['id']}/milestones", f"/projects/{p['id']}/documents", f"/projects/{p['id']}/audit"):
        r = client.get(f"{API}{path}", headers=auth(w["noapp"]))
        assert r.status_code == 403, path
        assert r.json()["detail"].startswith("You can't open the ")
    # A department head without the app is still gated out of the management side.
    assert client.get(f"{API}/projects/{p['id']}", headers=auth(w["head"])).status_code == 403
    # No token at all → not authenticated.
    assert client.get(f"{API}/projects").status_code in (401, 403)


def test_admin_passes_the_gate_without_assigned_apps(client, db, w):
    admin = make_user(db, "lc.admin@x.com", role="admin")
    r = client.post(f"{API}/projects", headers=auth(admin), json=body(w["pm"].id))
    assert r.status_code == 200 and r.json()["can_manage"] is True


def test_meta_can_create_reflects_management(client, db, w):
    director = make_user(db, "lc.dir@x.com", apps=("projects",), is_director=True)
    granted = make_user(db, "lc.grant@x.com", apps=("projects",), grants=["projects:all_projects:view", "projects:all_projects:create"])
    other_grant = make_user(db, "lc.othergrant@x.com", apps=("projects",), grants=["projects:all_projects:view"])
    expected = {w["viewer"]: False, w["pm"]: False, w["partner"]: True, director: True, granted: True, other_grant: False}
    for user, can in expected.items():
        r = client.get(f"{API}/projects/meta", headers=auth(user))
        assert r.status_code == 200
        assert r.json()["can_create"] is can, user.email
        assert set(r.json()["statuses"]) == {"planning", "active", "on_hold", "technically_complete", "closed", "cancelled"}


def test_director_can_create_but_pm_and_viewer_cannot(client, db, w):
    director = make_user(db, "lc.dir2@x.com", apps=("projects",), is_director=True)
    assert client.post(f"{API}/projects", headers=auth(director), json=body(w["pm"].id)).status_code == 200
    for user in (w["pm"], w["viewer"]):
        r = client.post(f"{API}/projects", headers=auth(user), json=body(w["pm"].id, project_code="PEW-51"))
        assert r.status_code == 403
        assert "Only authorised management can create projects" in r.json()["detail"]
        assert "Permission Matrix" in r.json()["detail"]


def test_project_manager_manages_only_own_project(client, db, w):
    mine = create(client, w)
    other_pm = make_user(db, "lc.pm2@x.com", apps=("projects",))
    theirs = create(client, w, project_code="PEW-60", project_manager_id=other_pm.id)
    r = client.patch(f"{API}/projects/{mine['id']}", headers=auth(w["pm"]), json={"priority": "urgent"})
    assert r.status_code == 200 and r.json()["priority"] == "urgent" and r.json()["can_manage"] is True
    r = client.patch(f"{API}/projects/{theirs['id']}", headers=auth(w["pm"]), json={"priority": "urgent"})
    assert r.status_code == 403
    assert r.json()["detail"] == "Only management or the project manager of PEW-60 can edit the project."
    # Viewer reads, but can_manage is False and edits are refused.
    v = client.get(f"{API}/projects/{mine['id']}", headers=auth(w["viewer"]))
    assert v.status_code == 200 and v.json()["can_manage"] is False
    assert transition(client, w["viewer"], mine["id"], "cancel", reason="x").status_code == 403


# ── Create / edit validation ──────────────────────────────────────────

def test_create_validation_messages(client, db, w):
    h = auth(w["partner"])
    cases = [
        ({"name": " "}, 422, "Project name is required."),
        ({"client_name": ""}, 422, "Customer is required."),
        ({"priority": "asap"}, 422, "Priority must be Standard or Urgent"),
        ({"target_handover_date": str(TODAY - timedelta(days=1))}, 422, "is before the start date"),
        ({"project_manager_id": 999999}, 422, "doesn't exist or is deactivated"),
    ]
    for extra, code, msg in cases:
        r = client.post(f"{API}/projects", headers=h, json=body(w["pm"].id, **extra))
        assert r.status_code == code, (extra, r.text)
        assert msg in r.json()["detail"], (extra, r.json())
    # Blank number = next PEW-<N> (shared with Order Projects); blank project manager = the creator.
    r = client.post(f"{API}/projects", headers=h, json=body(None, project_code="  "))
    assert r.status_code == 200 and r.json()["project_code"] == "PEW-1"
    assert r.json()["project_manager_id"] == w["partner"].id
    r = client.post(f"{API}/projects", headers=h, json=body(None, project_code=""))
    assert r.json()["project_code"] == "PEW-2"
    inactive = make_user(db, "lc.gone@x.com", is_active=False)
    r = client.post(f"{API}/projects", headers=h, json=body(inactive.id))
    assert r.status_code == 422 and "project manager" in r.json()["detail"]


def test_create_normalises_code_and_po_ref_and_notifies_pm(client, db, w):
    p = create(client, w, project_code="  pew-77 ", name="  RRV  ", customer_po_ref="  PO-9  ")
    assert p["project_code"] == "PEW-77" and p["name"] == "RRV"
    assert p["customer_po_ref"] == "PO-9" and p["status"] == "planning" and p["health"] is None
    assert p["progress_percent"] == 0 and p["milestones_total"] == 0 and p["next_milestone"] is None
    assert p["created_by_name"] == "lc.partner" and p["project_manager_name"] == "lc.pm"
    assert notes(db, w["pm"], "pm_project_manager") == 1
    dup = client.post(f"{API}/projects", headers=auth(w["partner"]), json=body(w["pm"].id, project_code="Pew-77"))
    assert dup.status_code == 409 and "already used by project 'RRV'" in dup.json()["detail"]


def test_code_only_changes_in_planning(client, db, w):
    p = create(client, w)
    url = f"{API}/projects/{p['id']}"
    r = client.patch(url, headers=auth(w["pm"]), json={"project_code": "pew-50a"})
    assert r.status_code == 200 and r.json()["project_code"] == "PEW-50A"
    add_milestone(client, w, p["id"])  # the first WBS releases the project
    r = client.patch(url, headers=auth(w["pm"]), json={"project_code": "PEW-99"})
    assert r.status_code == 409 and "can only change while the project is in Planning" in r.json()["detail"]
    # Re-sending the same code (any case) is not a change.
    assert client.patch(url, headers=auth(w["pm"]), json={"project_code": "pew-50a"}).status_code == 200


def test_edit_validation_messages(client, db, w):
    p = create(client, w)
    add_milestone(client, w, p["id"], days=40, title="Assembly")
    url = f"{API}/projects/{p['id']}"
    h = auth(w["pm"])
    r = client.patch(url, headers=h, json={"project_manager_id": None})
    assert r.status_code == 422 and r.json()["detail"] == "A project must have a project manager."
    r = client.patch(url, headers=h, json={"start_date": None})
    assert r.status_code == 422 and "required" in r.json()["detail"]
    r = client.patch(url, headers=h, json={"name": "  "})
    assert r.status_code == 422 and r.json()["detail"] == "Project name can't be empty."
    r = client.patch(url, headers=h, json={"target_handover_date": str(TODAY + timedelta(days=20))})
    assert r.status_code == 422 and "WBS 'Assembly' is due" in r.json()["detail"]
    assert "Move that WBS first" in r.json()["detail"]
    r = client.patch(url, headers=h, json={"start_date": str(TODAY + timedelta(days=90))})
    assert r.status_code == 422 and "is before the start date" in r.json()["detail"]


@pytest.mark.xfail(strict=True, reason="BUG: moving the project start date past an existing milestone's target date is "
                                         "accepted — update_project only re-checks milestones against a new handover date, "
                                         "while create/update_milestone refuse targets before the start "
                                         "app/modules/projects/routes/project.py:249-260")
def test_moving_start_after_a_milestone_is_refused(client, db, w):
    p = create(client, w)
    add_milestone(client, w, p["id"], days=5, title="Kick-off")
    r = client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"start_date": str(TODAY + timedelta(days=10))})
    assert r.status_code == 422


def test_reassigning_pm_notifies_new_pm_and_shifts_rights(client, db, w):
    p = create(client, w)
    new_pm = make_user(db, "lc.newpm@x.com", apps=("projects",))
    r = client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"project_manager_id": new_pm.id})
    assert r.status_code == 200 and r.json()["project_manager_name"] == "lc.newpm"
    assert notes(db, new_pm, "pm_project_manager") == 1
    # The old PM lost manage rights on this project.
    assert client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"priority": "low"}).status_code == 403


# ── Lifecycle transitions ─────────────────────────────────────────────

def test_unknown_and_out_of_order_transitions(client, db, w):
    p = create(client, w)
    pid = p["id"]
    r = transition(client, w["pm"], pid, "launch")
    assert r.status_code == 400 and "Unknown action 'launch'" in r.json()["detail"]
    r = transition(client, w["pm"], pid, "activate")
    assert r.status_code == 422 and "Add at least one department WBS" in r.json()["detail"]
    for action, needs in (("resume", "On hold"), ("hold", "Active"), ("complete", "Active")):
        r = transition(client, w["pm"], pid, action, reason="r")
        assert r.status_code == 409, action
        assert r.json()["detail"] == f"Can't {action} project PEW-50: it is Planning, and this needs it to be {needs}."
    # An open project closes from the closure panel — the checklist gates it.
    r = transition(client, w["pm"], pid, "close", closure_note="Settled", documents_archived=True)
    assert r.status_code == 409 and "Final Project Report created" in r.json()["detail"]
    add_milestone(client, w, pid)  # releases the project by itself
    r = transition(client, w["pm"], pid, "activate")
    assert r.status_code == 409 and "it is Active, and this needs it to be Planning" in r.json()["detail"]


def test_first_wbs_releases_the_project(client, db, w):
    p = create(client, w)
    assert p["status"] == "planning"
    add_milestone(client, w, p["id"])
    j = client.get(f"{API}/projects/{p['id']}", headers=auth(w["pm"])).json()
    assert j["status"] == "active" and j["released_by_name"] == "lc.pm" and j["released_at"]
    assert j["health"] == "on_track" and j["milestones_total"] == 1 and j["current_departments"] == []
    assert notes(db, w["head"], "pm_milestone_assigned") == 1


def test_hold_and_resume_notify_people_with_open_work(client, db, w):
    p = create(client, w)
    m = add_milestone(client, w, p["id"])
    transition(client, w["pm"], p["id"], "activate")
    client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(w["head"]), json={
        "title": "Draw", "assignee_id": w["member"].id, "due_date": str(TODAY + timedelta(days=5))})
    r = transition(client, w["pm"], p["id"], "hold", reason="  ")
    assert r.status_code == 422 and "Give a reason for putting the project on hold" in r.json()["detail"]
    r = transition(client, w["pm"], p["id"], "hold", reason="Customer payment pending")
    assert r.status_code == 200 and r.json()["status"] == "on_hold" and r.json()["hold_reason"] == "Customer payment pending"
    assert notes(db, w["head"], "pm_project_hold") == 1 and notes(db, w["member"], "pm_project_hold") == 1
    r = transition(client, w["pm"], p["id"], "resume")
    assert r.json()["status"] == "active" and r.json()["hold_reason"] is None
    assert notes(db, w["member"], "pm_project_resume") == 1


def test_complete_needs_every_live_milestone_achieved(client, db, w):
    p = create(client, w)
    m1 = add_milestone(client, w, p["id"], title="M1")
    add_milestone(client, w, p["id"], title="M2")
    transition(client, w["pm"], p["id"], "activate")
    r = transition(client, w["pm"], p["id"], "complete")
    assert r.status_code == 409 and "2 WBS element(s) are not accepted yet: " in r.json()["detail"]
    # Cancelling every milestone leaves nothing to achieve.
    for m in client.get(f"{API}/projects/{p['id']}/milestones", headers=auth(w["pm"])).json():
        client.post(f"{API}/projects/{p['id']}/milestones/{m['id']}/cancel", headers=auth(w["pm"]), json={"reason": "Scope cut"})
    r = transition(client, w["pm"], p["id"], "complete")
    assert r.status_code == 409 and r.json()["detail"] == "This project has no WBS elements to achieve."
    assert m1["status"] == "not_started"


def test_last_wbs_accepted_completes_project_automatically(client, db, w):
    from app.modules.projects.models.milestone import PmProjectMilestone
    p = create(client, w)
    m1 = add_milestone(client, w, p["id"], title="M1")
    m2 = add_milestone(client, w, p["id"], title="M2")
    transition(client, w["pm"], p["id"], "activate")
    db.get(PmProjectMilestone, m1["id"]).status = "submitted"
    db.commit()
    assert client.post(f"{API}/projects/{p['id']}/milestones/{m1['id']}/accept", headers=auth(w["pm"]), json={}).status_code == 200
    assert client.get(f"{API}/projects/{p['id']}", headers=auth(w["pm"])).json()["status"] == "active"
    # Cancelling the only open WBS leaves every live one achieved.
    client.post(f"{API}/projects/{p['id']}/milestones/{m2['id']}/cancel", headers=auth(w["pm"]), json={"reason": "Scope cut"})
    j = client.get(f"{API}/projects/{p['id']}", headers=auth(w["pm"])).json()
    assert j["status"] == "technically_complete" and j["technically_completed_on"] == str(TODAY)


def test_closure_checklist_without_wbs(client, db, w):
    p = create(client, w)
    j = client.get(f"{API}/projects/{p['id']}/closure", headers=auth(w["pm"])).json()
    assert {c["key"] for c in j["checks"]} == {"no_open_tasks", "final_report", "documents_archived"}
    assert j["can_close"] is False  # the Final Project Report is still missing


def test_milestones_go_to_one_person_who_works_them_in_my_tasks(client, db, w):
    p = create(client, w)
    url = f"{API}/projects/{p['id']}/project-tasks"
    due = str(TODAY + timedelta(days=10))
    goal = {"title": "GA drawing", "department_id": w["dept"].id, "assignee_id": w["member"].id, "due_date": due}
    assert client.post(url, headers=auth(w["viewer"]), json=goal).status_code == 403  # only management / the PM
    r = client.post(url, headers=auth(w["pm"]), json={**goal, "assignee_id": w["viewer"].id})
    assert r.status_code == 422 and "is not in Design" in r.json()["detail"]
    r = client.post(url, headers=auth(w["pm"]), json={k: v for k, v in goal.items() if k != "assignee_id"})
    assert r.status_code == 422
    r = client.post(url, headers=auth(w["pm"]), json=goal)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["assignee_name"] == "lc.member" and t["created_by_name"] == "lc.pm" and t["project_code"] == "PEW-50"
    assert t["can_edit"] and t["can_work"] and not t["mine"]
    assert notes(db, w["member"], "pm_dept_task") == 1 and notes(db, w["head"], "pm_dept_task") == 0

    # Each user sees only their own work — no list of every project any more.
    assert client.get(f"{API}/pm-ongoing/projects", headers=auth(w["member"])).status_code in (404, 405)
    mine = client.get(f"{API}/pm-ongoing/my", headers=auth(w["member"])).json()
    assert [x["title"] for x in mine] == ["GA drawing"] and mine[0]["mine"] and mine[0]["can_plan"] and mine[0]["can_work"]
    assert client.get(f"{API}/pm-ongoing/my", headers=auth(w["head"])).json() == []
    assert client.get(f"{API}/pm-ongoing/tasks/{t['id']}", headers=auth(w["head"])).status_code == 403
    assert client.get(f"{API}/pm-ongoing/tasks/{t['id']}/activity", headers=auth(w["noapp"])).status_code == 403

    # The owner splits it — to anyone, due no later than the milestone.
    sub_url = f"{API}/pm-ongoing/tasks/{t['id']}/subtasks"
    assert client.post(sub_url, headers=auth(w["head"]), json={"title": "Frame", "assignee_id": w["noapp"].id, "due_date": due}).status_code == 403
    r = client.post(sub_url, headers=auth(w["member"]), json={"title": "Frame", "assignee_id": w["noapp"].id})
    assert r.status_code == 422  # due date is required
    late = str(TODAY + timedelta(days=11))
    r = client.post(sub_url, headers=auth(w["member"]), json={"title": "Frame", "assignee_id": w["noapp"].id, "due_date": late})
    assert r.status_code == 422 and "after the milestone's due date" in r.json()["detail"]
    r = client.post(sub_url, headers=auth(w["member"]), json={"title": "Frame", "assignee_id": w["noapp"].id, "due_date": due})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "in_progress" and j["subtasks"][0]["assignee_name"] == "lc.noapp" and j["subtasks"][0]["created_by_name"] == "lc.member"
    assert notes(db, w["noapp"], "pm_subtask") == 1
    sid = j["subtasks"][0]["id"]

    # The sub-task's person sees the milestone (and who gave it) in My Tasks.
    theirs = client.get(f"{API}/pm-ongoing/my", headers=auth(w["noapp"])).json()
    assert len(theirs) == 1 and theirs[0]["has_my_subtask"] and not theirs[0]["mine"] and theirs[0]["subtasks"][0]["mine"]
    assert theirs[0]["created_by_name"] == "lc.pm" and not theirs[0]["can_plan"]
    assert client.get(f"{API}/pm-ongoing/tasks/{t['id']}", headers=auth(w["noapp"])).status_code == 200

    r = client.post(f"{API}/pm-ongoing/tasks/{t['id']}/status", headers=auth(w["member"]), json={"action": "done"})
    assert r.status_code == 409 and "not done yet: Frame" in r.json()["detail"]
    assert client.post(f"{API}/pm-ongoing/subtasks/{sid}/status", headers=auth(w["head"]), json={"done": True}).status_code == 403
    r = client.post(f"{API}/pm-ongoing/subtasks/{sid}/status", headers=auth(w["noapp"]), json={"done": True})
    assert r.json()["subtasks"][0]["status"] == "done"
    assert notes(db, w["member"], "pm_dept_task") == 2  # its owner hears the sub-task is done
    assert client.post(f"{API}/pm-ongoing/tasks/{t['id']}/status", headers=auth(w["head"]), json={"action": "done"}).status_code == 403
    r = client.post(f"{API}/pm-ongoing/tasks/{t['id']}/status", headers=auth(w["member"]), json={"action": "done"})
    assert r.status_code == 200 and r.json()["status"] == "done"
    assert notes(db, w["pm"], "pm_project_task_done") == 1
    assert client.get(f"{API}/pm-ongoing/my", headers=auth(w["member"])).json() == []  # finished work drops off
    assert len(client.get(f"{API}/pm-ongoing/my", params={"include_closed": True}, headers=auth(w["member"])).json()) == 1
    r = client.post(f"{API}/pm-ongoing/tasks/{t['id']}/status", headers=auth(w["member"]), json={"action": "reopen", "reason": "x"})
    assert r.status_code == 403
    r = client.post(f"{API}/pm-ongoing/tasks/{t['id']}/status", headers=auth(w["pm"]), json={"action": "reopen", "reason": "Customer changed the frame"})
    assert r.json()["status"] == "in_progress" and notes(db, w["member"], "pm_dept_task") == 3

    # Remarks: the PM, the owner and sub-task holders write; nobody else.
    rem = f"{API}/pm-ongoing/tasks/{t['id']}/remarks"
    assert client.post(rem, headers=auth(w["head"]), json={"comment": "x"}).status_code == 403
    assert client.post(rem, headers=auth(w["member"]), json={"comment": "  "}).status_code == 422
    r = client.post(rem, headers=auth(w["member"]), json={"comment": "Frame drawing sent for checking"})
    assert r.status_code == 200 and [x["comment"] for x in r.json()["remarks"]] == ["Frame drawing sent for checking"]
    assert notes(db, w["pm"], "pm_task_remark") == 1
    srem = f"{API}/pm-ongoing/subtasks/{sid}/remarks"
    r = client.post(srem, headers=auth(w["noapp"]), json={"comment": "Need the latest frame size"})
    assert r.status_code == 200 and r.json()["can_write"] is True
    assert notes(db, w["member"], "pm_task_remark") == 1

    # Reassigning to someone else tells the new owner.
    other = make_user(db, "lc.member2@x.com", department="Design")
    r = client.patch(f"{url}/{t['id']}", headers=auth(w["pm"]), json={"assignee_id": other.id})
    assert r.status_code == 200 and r.json()["assignee_name"] == "lc.member2" and notes(db, other, "pm_dept_task") == 1


def test_milestone_due_date_reminders_reach_owner_and_giver(client, db, w):
    from app.tasks.pm_reminders import run_pm_reminders
    p = create(client, w)
    url = f"{API}/projects/{p['id']}/project-tasks"
    tomorrow, today = TODAY + timedelta(days=1), TODAY
    t = client.post(url, headers=auth(w["pm"]), json={"title": "BOM", "department_id": w["dept"].id,
                                                      "assignee_id": w["member"].id, "due_date": str(tomorrow)}).json()
    client.post(f"{API}/pm-ongoing/tasks/{t['id']}/subtasks", headers=auth(w["member"]),
                json={"title": "Fasteners list", "assignee_id": w["noapp"].id, "due_date": str(today)})
    run_pm_reminders(db, today)
    db.commit()
    # Milestone due tomorrow → its owner only. Sub-task due today → its person and whoever gave it.
    assert notes(db, w["member"], "pm_goal_due_soon") == 1 and notes(db, w["pm"], "pm_goal_due_soon") == 0
    assert notes(db, w["noapp"], "pm_goal_due_today") == 1 and notes(db, w["member"], "pm_goal_due_today") == 1
    # On the due day both hear it; once overdue both hear it, and a second run
    # the same day (scheduler restart) sends nothing new.
    run_pm_reminders(db, tomorrow)
    db.commit()
    assert notes(db, w["member"], "pm_goal_due_today") == 2 and notes(db, w["pm"], "pm_goal_due_today") == 1
    run_pm_reminders(db, tomorrow + timedelta(days=1))
    db.commit()
    run_pm_reminders(db, tomorrow + timedelta(days=1))
    db.commit()
    # member: owner of the milestone AND giver of the sub-task → both overdue.
    assert notes(db, w["pm"], "pm_goal_overdue") == 1 and notes(db, w["member"], "pm_goal_overdue") == 2


def test_cancel_rules(client, db, w):
    p = create(client, w)
    r = transition(client, w["pm"], p["id"], "cancel")
    assert r.status_code == 422 and r.json()["detail"] == "Give a reason for cancelling the project."
    r = transition(client, w["pm"], p["id"], "cancel", reason="Order withdrawn")
    j = r.json()
    assert r.status_code == 200 and j["status"] == "cancelled" and j["cancel_reason"] == "Order withdrawn"
    assert j["closure_date"] == str(TODAY) and j["closed_by_name"] == "lc.pm"
    r = transition(client, w["pm"], p["id"], "cancel", reason="again")
    assert r.status_code == 409 and "needs it to be Planning, Active or On hold" in r.json()["detail"]
    # Cancelled = locked: only the closure note is editable; milestones can't be added.
    r = client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"name": "New"})
    assert r.status_code == 409 and "only the closure note and lessons learned can still be edited" in r.json()["detail"]
    r = client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"closure_note": "Advance refunded"})
    assert r.status_code == 200 and r.json()["closure_note"] == "Advance refunded"
    r = client.post(f"{API}/projects/{p['id']}/milestones", headers=auth(w["pm"]), json={
        "title": "x", "department_id": w["dept"].id, "target_date": str(TODAY), "deliverable": "y"})
    assert r.status_code == 409 and "its WBS elements can no longer change" in r.json()["detail"]


# ── Delete and audit ─────────────────────────────────────────────────

def test_delete_only_empty_planning_projects(client, db, w):
    empty = create(client, w, project_code="PEW-D1")
    assert client.delete(f"{API}/projects/{empty['id']}", headers=auth(w["viewer"])).status_code == 403
    # Company delete rule: only the creator (the partner here) — not the PM.
    r = client.delete(f"{API}/projects/{empty['id']}", headers=auth(w["pm"]))
    assert r.status_code == 403 and "created by someone else" in r.json()["detail"]
    r = client.delete(f"{API}/projects/{empty['id']}", headers=auth(w["partner"]))
    assert r.status_code == 200 and r.json()["message"] == "Project deleted"
    r = client.get(f"{API}/projects/{empty['id']}", headers=auth(w["pm"]))
    assert r.status_code == 404 and "not found" in r.json()["detail"]

    with_ms = create(client, w, project_code="PEW-D2")
    add_milestone(client, w, with_ms["id"])  # released by its first WBS
    r = client.delete(f"{API}/projects/{with_ms['id']}", headers=auth(w["partner"]))
    assert r.status_code == 409 and "Only projects still in Planning can be deleted" in r.json()["detail"]

    # A Planning project that already has department tasks keeps them as history.
    with_task = create(client, w, project_code="PEW-D3")
    r = client.post(f"{API}/projects/{with_task['id']}/project-tasks", headers=auth(w["pm"]),
                    json={"title": "GA drawing", "department_id": w["dept"].id, "assignee_id": w["member"].id,
                          "due_date": str(TODAY + timedelta(days=10))})
    assert r.status_code == 200, r.text
    r = client.delete(f"{API}/projects/{with_task['id']}", headers=auth(w["partner"]))
    assert r.status_code == 409 and "1 task(s)" in r.json()["detail"] and "Cancel project" in r.json()["detail"]


def test_audit_trail_records_create_edit_and_status(client, db, w):
    p = create(client, w)
    client.patch(f"{API}/projects/{p['id']}", headers=auth(w["pm"]), json={"priority": "urgent"})
    add_milestone(client, w, p["id"])
    transition(client, w["pm"], p["id"], "activate")
    log = client.get(f"{API}/projects/{p['id']}/audit", headers=auth(w["viewer"])).json()
    actions = {e["action"] for e in log}
    assert {"created", "updated", "milestone_created", "status_changed"} <= actions
    upd = next(e for e in log if e["action"] == "updated")
    assert upd["field_name"] == "priority" and upd["old_value"] == "standard" and upd["new_value"] == "urgent"
    st = next(e for e in log if e["action"] == "status_changed")
    assert st["old_value"] == "planning" and st["new_value"] == "active" and st["performed_by"] == "lc.pm"


def test_list_filters(client, db, w):
    a = create(client, w, project_code="PEW-A", name="Alpha", client_name="IRCON", priority="urgent")
    create(client, w, project_code="PEW-B", name="Beta", client_name="RVNL")
    add_milestone(client, w, a["id"])
    transition(client, w["pm"], a["id"], "activate")
    h = auth(w["viewer"])
    assert [p["project_code"] for p in client.get(f"{API}/projects?status=active", headers=h).json()] == ["PEW-A"]
    assert [p["project_code"] for p in client.get(f"{API}/projects?search=rvnl", headers=h).json()] == ["PEW-B"]
    assert [p["project_code"] for p in client.get(f"{API}/projects?priority=urgent", headers=h).json()] == ["PEW-A"]
    assert [p["project_code"] for p in client.get(f"{API}/projects?health=on_track", headers=h).json()] == ["PEW-A"]


def test_private_subtask_file_needs_the_subtask_not_just_the_milestone(client, db, w, monkeypatch):
    """Security fix: someone holding one sub-task on a milestone could download
    the files of another person's sub-task by id (its activity was already 403)."""
    from fastapi import Response

    from app.modules.projects.models.document import PmProjectDocument
    from app.modules.projects.routes import project_tasks as pt

    async def fake_file(doc):
        return Response(content=b"bytes", media_type="application/pdf")

    monkeypatch.setattr(pt, "file_response", fake_file)
    p = create(client, w)
    due = str(TODAY + timedelta(days=10))
    t = client.post(f"{API}/projects/{p['id']}/project-tasks", headers=auth(w["pm"]), json={
        "title": "GA drawing", "department_id": w["dept"].id, "assignee_id": w["member"].id, "due_date": due}).json()
    sub_url = f"{API}/pm-ongoing/tasks/{t['id']}/subtasks"
    other = make_user(db, "lc.other.sub@x.com")
    client.post(sub_url, headers=auth(w["member"]), json={"title": "Frame", "assignee_id": w["noapp"].id, "due_date": due})
    j = client.post(sub_url, headers=auth(w["member"]), json={"title": "Bogie", "assignee_id": other.id, "due_date": due}).json()
    bogie = next(s for s in j["subtasks"] if s["title"] == "Bogie")
    doc = PmProjectDocument(project_id=p["id"], task_id=t["id"], subtask_id=bogie["id"], doc_type="other", title="calc",
                            file_name="calc.pdf", file_path="x/calc.pdf", sharepoint_path="x/calc.pdf", uploaded_by_id=other.id)
    db.add(doc)
    db.commit()
    url = f"{API}/pm-ongoing/files/{doc.id}/content"
    assert client.get(url, headers=auth(w["noapp"])).status_code == 403  # holds 'Frame', not 'Bogie'
    assert client.get(url, headers=auth(other)).status_code == 200
    assert client.get(url, headers=auth(w["member"])).status_code == 200  # created the sub-task
