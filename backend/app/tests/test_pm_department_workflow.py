"""Project Management, end to end, as agreed in the 2026-10-06 plan:
management creates the project and department milestones → releases it →
department head creates and assigns tasks → user splits a task into
sub-tasks and completes it → head submits the milestone → management
accepts → project technically complete → closed."""
from datetime import date, timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department

API = "/api/v1"
TODAY = date.today()


def make_user(db, email, apps=(), department=None, **flags):
    user = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps),
                department=department, **flags)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def notes(db, user, ntype):
    db.expire_all()
    return db.query(Notification).filter(Notification.user_id == user.id, Notification.notification_type == ntype).count()


@pytest.fixture
def s(client, db):
    partner = make_user(db, "partner@x.com", apps=("projects",), is_partner=True)
    pm = make_user(db, "pm@x.com", apps=("projects",))
    # No Projects app — they work from Design › Ongoing Projects (RBAC: that
    # tab's grant is what lets them use /pm-work at all).
    head = make_user(db, "head@x.com", apps=("design",), department="Design")
    member = make_user(db, "member@x.com", apps=("design",), department="Design")
    other = make_user(db, "other@x.com", apps=("store",), department="Stores")
    viewer = make_user(db, "viewer@x.com", apps=("projects",))
    dept = Department(name="Design", code="DES", head_user_id=head.id)
    db.add(dept)
    db.commit()
    r = client.post(f"{API}/projects", headers=auth(partner), json={
        "project_code": "pew-39", "name": "RRV build", "client_name": "IRCON", "project_manager_id": pm.id,
        "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=60)),
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "planning" and r.json()["project_code"] == "PEW-39"
    return {"partner": partner, "pm": pm, "head": head, "member": member, "other": other, "viewer": viewer,
            "dept": dept, "project": r.json()}


def add_milestone(client, s, days=30, **extra):
    r = client.post(f"{API}/projects/{s['project']['id']}/milestones", headers=auth(s["pm"]), json={
        "title": "GA drawing released", "department_id": s["dept"].id, "lead_user_id": s["head"].id,
        "target_date": str(TODAY + timedelta(days=days)), "deliverable": "Signed GA drawing", **extra,
    })
    assert r.status_code == 200, r.text
    return r.json()


def activate(client, s):
    r = client.post(f"{API}/projects/{s['project']['id']}/transition", headers=auth(s["pm"]), json={"action": "activate"})
    # Adding the first WBS already releases the project.
    assert r.status_code == 200 or "it is Active" in r.text, r.text


def add_task(client, s, m, **extra):
    r = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(s["head"]), json={
        "title": "Draw GA", "assignee_id": s["member"].id, "due_date": str(TODAY + timedelta(days=10)), **extra,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_only_management_creates_projects(client, db, s):
    body = {"project_code": "PEW-40", "name": "X", "client_name": "Y", "project_manager_id": s["pm"].id,
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=5))}
    assert client.post(f"{API}/projects", headers=auth(s["viewer"]), json=body).status_code == 403
    granted = make_user(db, "granted@x.com", apps=("projects",), granular_permissions=["projects:all_projects:view", "projects:all_projects:create"])
    assert client.post(f"{API}/projects", headers=auth(granted), json=body).status_code == 200
    dup = client.post(f"{API}/projects", headers=auth(s["partner"]), json={**body, "project_code": "pew-40"})
    assert dup.status_code == 409 and "already used" in dup.json()["detail"]


def test_full_workflow(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    assert notes(db, s["head"], "pm_milestone_assigned") == 1

    # Head plans: due date can't pass the milestone; assignee must be in the department.
    late = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(s["head"]), json={
        "title": "Late", "assignee_id": s["member"].id, "due_date": str(TODAY + timedelta(days=40))})
    assert late.status_code == 422
    outsider = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(s["head"]), json={
        "title": "X", "assignee_id": s["other"].id, "due_date": str(TODAY + timedelta(days=5))})
    assert outsider.status_code == 422 and "nor in Design" in outsider.json()["detail"]
    task = add_task(client, s, m)
    assert notes(db, s["member"], "pm_task_assigned") == 1

    # User works: sub-tasks gate completion.
    h = auth(s["member"])
    assert [t["id"] for t in client.get(f"{API}/pm-work/my-tasks", headers=h).json()] == [task["id"]]
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=h).status_code == 200
    assert client.get(f"{API}/projects/{pid}/milestones", headers=auth(s["pm"])).json()[0]["status"] == "in_progress"
    sub = client.post(f"{API}/pm-work/tasks/{task['id']}/subtasks", headers=h, json={"title": "Sketch"}).json()
    client.post(f"{API}/pm-work/tasks/{task['id']}/subtasks", headers=h, json={"title": "Check"})
    blocked = client.post(f"{API}/pm-work/tasks/{task['id']}/complete", headers=h, json={"note": "Delivered drawing DWG-12 rev A"})
    assert blocked.status_code == 409 and "sub-task" in blocked.json()["detail"]
    client.patch(f"{API}/pm-work/subtasks/{sub['id']}", headers=h, json={"status": "done"})
    detail = client.get(f"{API}/pm-work/tasks/{task['id']}", headers=h).json()
    assert detail["task"]["progress_percent"] == 50
    for st in detail["subtasks"]:
        client.patch(f"{API}/pm-work/subtasks/{st['id']}", headers=h, json={"status": "done"})
    client.post(f"{API}/pm-work/tasks/{task['id']}/comments", headers=h, json={"comment": "Drawing DWG-12 uploaded"})
    done = client.post(f"{API}/pm-work/tasks/{task['id']}/complete", headers=h, json={"note": "Delivered drawing DWG-12 rev A"})
    assert done.status_code == 200 and done.json()["task"]["status"] == "done"
    assert notes(db, s["head"], "pm_task_done") == 1

    # Head submits, management rejects then accepts.
    no_note = client.post(f"{API}/pm-work/milestones/{m['id']}/submit", headers=auth(s["head"]), json={"submission_note": " "})
    assert no_note.status_code == 422
    assert client.post(f"{API}/pm-work/milestones/{m['id']}/submit", headers=auth(s["head"]), json={"submission_note": "GA DWG-12 rev A"}).status_code == 200
    assert notes(db, s["pm"], "approval") == 1  # central approval engine notifies the acceptors
    assert client.post(f"{API}/projects/{pid}/milestones/{m['id']}/reject", headers=auth(s["pm"]), json={"reason": "Missing BOM"}).json()["status"] == "in_progress"
    client.post(f"{API}/pm-work/milestones/{m['id']}/submit", headers=auth(s["head"]), json={"submission_note": "Added BOM"})
    acc = client.post(f"{API}/projects/{pid}/milestones/{m['id']}/accept", headers=auth(s["pm"]), json={})
    assert acc.status_code == 200 and acc.json()["status"] == "achieved" and acc.json()["actual_date"] == str(TODAY)

    proj = client.get(f"{API}/projects/{pid}", headers=auth(s["viewer"])).json()
    assert proj["progress_percent"] == 100 and proj["milestones_achieved"] == 1
    # Accepting the last WBS moves the project to Technically complete by itself.
    assert proj["status"] == "technically_complete" and proj["technically_completed_on"] == str(TODAY)
    # Closure checklist: the Final Project Report must exist, then the PM
    # confirms documents are archived and writes the closure note.
    chk = client.get(f"{API}/projects/{pid}/closure", headers=auth(s["pm"])).json()
    assert not chk["can_close"] and {c["key"] for c in chk["checks"] if not c["ok"]} >= {"final_report", "documents_archived"}
    r = client.post(f"{API}/projects/{pid}/transition", headers=auth(s["pm"]), json={"action": "close", "closure_note": "Final invoice settled", "documents_archived": True})
    assert r.status_code == 409 and "Final Project Report" in r.json()["detail"]
    from app.modules.main.models.managed_document import ManagedDocument
    from app.modules.projects.closure import REPORT_ENTITY, report_context
    from app.modules.projects.models.project import PmProject
    from app.modules.projects.reports.closure_report_docx import build_closure_report_docx
    assert build_closure_report_docx(report_context(db, db.get(PmProject, pid))).getbuffer().nbytes > 1000
    db.add(ManagedDocument(entity_type=REPORT_ENTITY, entity_id=pid, source_revision=0, title="Final Project Report",
                           docx_item_id="x", docx_path="x", created_by_id=s["pm"].id))
    db.commit()
    assert client.get(f"{API}/projects/{pid}/closure", headers=auth(s["pm"])).json()["can_close"]
    r = client.post(f"{API}/projects/{pid}/transition", headers=auth(s["pm"]), json={"action": "close", "closure_note": "Final invoice settled"})
    assert r.status_code == 422 and "Documents tab" in r.json()["detail"]
    r = client.post(f"{API}/projects/{pid}/transition", headers=auth(s["pm"]), json={
        "action": "close", "closure_note": "Final invoice settled", "documents_archived": True, "lessons_learned": "Freeze GA earlier"})
    assert r.json()["status"] == "closed" and r.json()["documents_archived_at"] and r.json()["lessons_learned"] == "Freeze GA earlier"


def test_viewer_is_read_only_and_users_see_only_own_tasks(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    task = add_task(client, s, m)
    assert client.get(f"{API}/projects/{pid}", headers=auth(s["viewer"])).status_code == 200
    assert client.post(f"{API}/projects/{pid}/milestones", headers=auth(s["viewer"]), json={
        "title": "x", "department_id": s["dept"].id, "target_date": str(TODAY), "deliverable": "Signed GA drawing + BOM"}).status_code == 403
    assert client.get(f"{API}/pm-work/tasks/{task['id']}", headers=auth(s["other"])).status_code == 403
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(s["head"])).status_code == 403
    # The assignee sees the milestone as a member: only their own task, no progress.
    ws = client.get(f"{API}/pm-work/milestones/{m['id']}", headers=auth(s["member"])).json()
    assert ws["role"] == "member" and [t["id"] for t in ws["tasks"]] == [task["id"]] and ws["evidence"] == []
    assert client.get(f"{API}/pm-work/milestones/{m['id']}", headers=auth(s["other"])).status_code == 403
    assert client.get(f"{API}/pm-work/department/milestones", headers=auth(s["member"])).json() == []


def test_date_change_needs_reason_and_keeps_original(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s, days=30)
    activate(client, s)
    url = f"{API}/projects/{pid}/milestones/{m['id']}"
    new = str(TODAY + timedelta(days=40))
    assert client.patch(url, headers=auth(s["pm"]), json={"target_date": new}).status_code == 422
    r = client.patch(url, headers=auth(s["pm"]), json={"target_date": new, "date_change_reason": "Customer changed spec"})
    assert r.status_code == 200
    assert r.json()["target_date"] == new and r.json()["original_target_date"] == str(TODAY + timedelta(days=30))
    assert notes(db, s["head"], "pm_milestone_date_changed") == 1


def test_hold_freezes_work_and_nothing_deleted_after_start(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s)
    activate(client, s)
    task = add_task(client, s, m)
    client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(s["member"]))
    assert client.delete(f"{API}/pm-work/tasks/{task['id']}", headers=auth(s["head"])).status_code == 409
    assert client.delete(f"{API}/projects/{pid}/milestones/{m['id']}", headers=auth(s["pm"])).status_code == 409
    assert client.post(f"{API}/projects/{pid}/transition", headers=auth(s["pm"]), json={"action": "hold"}).status_code == 422
    client.post(f"{API}/projects/{pid}/transition", headers=auth(s["pm"]), json={"action": "hold", "reason": "Customer payment"})
    frozen = client.post(f"{API}/pm-work/tasks/{task['id']}/block", headers=auth(s["member"]), json={"reason": "x"})
    assert frozen.status_code == 409 and "on hold" in frozen.json()["detail"]


def test_dashboard_and_board(client, db, s):
    pid = s["project"]["id"]
    m = add_milestone(client, s, days=5)
    activate(client, s)
    task = add_task(client, s, m, due_date=str(TODAY + timedelta(days=2)))
    client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(s["member"]))
    client.post(f"{API}/pm-work/tasks/{task['id']}/block", headers=auth(s["member"]), json={"reason": "Waiting for vendor data"})
    dash = client.get(f"{API}/projects/dashboard", headers=auth(s["viewer"])).json()
    assert dash["counts"]["at_risk"] == 1
    assert dash["blocked_tasks"][0]["blocker_reason"] == "Waiting for vendor data"
    board = client.get(f"{API}/projects/board", headers=auth(s["viewer"])).json()
    assert board["departments"][0]["name"] == "Design"
    assert board["rows"][0]["cells"][str(s["dept"].id)][0]["status"] == "in_progress"
    lst = client.get(f"{API}/projects", headers=auth(s["viewer"])).json()
    assert lst[0]["next_milestone"]["id"] == m["id"] and lst[0]["health"] == "at_risk"


def test_reminders(client, db, s):
    from app.tasks.pm_reminders import run_pm_reminders
    m = add_milestone(client, s, days=5)
    activate(client, s)
    add_task(client, s, m, due_date=str(TODAY + timedelta(days=1)))
    db.expire_all()  # the job runs in its own fresh session in production
    run_pm_reminders(db, TODAY)
    db.commit()
    assert notes(db, s["member"], "pm_task_due_soon") == 1
    run_pm_reminders(db, TODAY + timedelta(days=3))
    db.commit()
    assert notes(db, s["head"], "pm_task_overdue_escalated") == 1
