"""R&D project milestones (rnd/routes/project_milestones.py): leads plan
milestones for people on the team, tasks go inside a milestone (due by its
end date), a milestone is achieved only once its tasks are finished, delete
only while it never had a task, and the project History lists it all."""
from datetime import date, timedelta

from app.tests.test_rnd_projects import BASE, auth_header, create_project, make_user


def _setup(client, db):
    lead = make_user(db, "ms-lead@premnathrail.com")
    member = make_user(db, "ms-member@premnathrail.com")
    outsider = make_user(db, "ms-outsider@premnathrail.com")
    h = auth_header(lead)
    p = create_project(client, h, lead_ids=[lead.id], team_member_ids=[member.id])
    return lead, member, outsider, h, p


def _due(days):
    return (date.today() + timedelta(days=days)).isoformat()


def test_milestone_plan_tasks_and_achieve(client, db):
    lead, member, outsider, h, p = _setup(client, db)
    pid = p["id"]

    # The responsible person must be on the project team.
    r = client.post(f"{BASE}/projects/{pid}/milestones", json={"title": "Design", "assignee_id": outsider.id, "due_date": _due(20)}, headers=h)
    assert r.status_code == 422 and "team" in r.json()["detail"]

    r = client.post(f"{BASE}/projects/{pid}/milestones", json={"title": "Design", "assignee_id": member.id, "due_date": _due(20), "icon": "gear", "color": "#0284c7"}, headers=h)
    assert r.status_code == 200, r.text
    ms = r.json()
    assert ms["status"] == "todo" and ms["tasks_total"] == 0 and ms["can_delete"]

    # A team member can't add milestones.
    hm = auth_header(member)
    assert client.post(f"{BASE}/projects/{pid}/milestones", json={"title": "X", "assignee_id": member.id, "due_date": _due(5)}, headers=hm).status_code == 403

    # Task due after the milestone's end date is refused; a valid one starts the milestone.
    form = {"title": "GA drawing", "assigned_to_id": str(member.id), "milestone_id": str(ms["id"])}
    r = client.post(f"{BASE}/projects/{pid}/tasks", data={**form, "due_date": _due(30)}, headers=h)
    assert r.status_code == 422 and "milestone" in r.json()["detail"]
    r = client.post(f"{BASE}/projects/{pid}/tasks", data={**form, "due_date": _due(10)}, headers=h)
    assert r.status_code == 200, r.text
    task = r.json()
    assert task["milestone_id"] == ms["id"]

    rows = client.get(f"{BASE}/projects/{pid}/milestones", headers=h).json()
    assert rows[0]["status"] == "in_progress" and rows[0]["tasks_total"] == 1 and rows[0]["tasks_done"] == 0
    assert not rows[0]["can_delete"]

    # Can't be achieved, deleted or cancelled while the task is open.
    r = client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "done"}, headers=hm)
    assert r.status_code == 409 and "still open" in r.json()["detail"]
    assert client.delete(f"{BASE}/projects/{pid}/milestones/{ms['id']}", headers=h).status_code == 409
    r = client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "cancel", "reason": "dropped"}, headers=h)
    assert r.status_code == 409

    # The assignee completes the task → the responsible person marks the milestone achieved.
    r = client.post(f"{BASE}/project-tasks/{task['id']}/complete", data={"remarks": "Drawing released"}, headers=hm)
    assert r.status_code == 200, r.text
    r = client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "done"}, headers=hm)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["tasks_done"] == 1

    # Reopen needs a lead and a reason.
    assert client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "reopen", "reason": "x"}, headers=hm).status_code == 403
    assert client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "reopen"}, headers=h).status_code == 422
    r = client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "reopen", "reason": "Customer asked for a change"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    history = client.get(f"{BASE}/projects/{pid}/history", headers=h).json()
    text = " ".join(e["summary"] for e in history)
    assert "Milestone 'Design' added" in text and "marked achieved" in text and "GA drawing" in text


def test_milestone_delete_and_dates(client, db):
    lead, member, outsider, h, p = _setup(client, db)
    pid = p["id"]
    r = client.post(f"{BASE}/projects/{pid}/milestones", json={"title": "Testing", "assignee_id": lead.id, "start_date": _due(9), "due_date": _due(3)}, headers=h)
    assert r.status_code == 422 and "after the end date" in r.json()["detail"]
    ms = client.post(f"{BASE}/projects/{pid}/milestones", json={"title": "Testing", "assignee_id": lead.id, "due_date": _due(3)}, headers=h).json()
    r = client.post(f"{BASE}/projects/{pid}/milestones/{ms['id']}/status", json={"action": "cancel", "reason": "Scope dropped"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    # A cancelled milestone takes no tasks.
    r = client.post(f"{BASE}/projects/{pid}/tasks", data={"title": "T", "assigned_to_id": str(member.id), "due_date": _due(2), "milestone_id": str(ms["id"])}, headers=h)
    assert r.status_code == 409
    assert client.delete(f"{BASE}/projects/{pid}/milestones/{ms['id']}", headers=h).status_code == 200
    assert client.get(f"{BASE}/projects/{pid}/milestones", headers=h).json() == []
