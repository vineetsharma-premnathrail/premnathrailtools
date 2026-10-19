"""Project Management, 2026-10-08 additions: milestone lead + assistants,
strict step order, team members adding their own tasks, time logging, and
the milestone team chat with @mentions."""
from datetime import timedelta

import pytest

from app.modules.projects.models.milestone import PmProjectMilestone
from app.tests.test_pm_department_workflow import API, TODAY, activate, auth, make_user, notes, s  # noqa: F401


@pytest.fixture
def t(client, db, s):  # noqa: F811
    s["lead"] = make_user(db, "lead@x.com", apps=("design",), department="Design")
    s["asst"] = make_user(db, "asst@x.com", apps=("design",), department="Design")
    # Procurement has no "Ongoing Projects" tab, so a buyer tagged into a
    # milestone chat needs Project Management › My Tasks.
    s["purchase"] = make_user(db, "buyer@x.com", department="Purchase",
                              granular_permissions=["projects:my_tasks:view", "projects:my_tasks:edit"])
    return s


def add(client, s, title, days, lead, assistants=()):
    r = client.post(f"{API}/projects/{s['project']['id']}/milestones", headers=auth(s["pm"]), json={
        "title": title, "department_id": s["dept"].id, "lead_user_id": lead.id,
        "assistant_user_ids": [a.id for a in assistants], "target_date": str(TODAY + timedelta(days=days)),
        "deliverable": "Signed GA drawing + BOM",
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_lead_is_required_and_steps_are_numbered(client, db, t):
    r = client.post(f"{API}/projects/{t['project']['id']}/milestones", headers=auth(t["pm"]), json={
        "title": "R&D finish", "department_id": t["dept"].id, "target_date": str(TODAY + timedelta(days=5)), "deliverable": "Signed GA drawing + BOM"})
    assert r.status_code == 422 and "WBS lead" in r.json()["detail"]
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"], t["lead"]])
    b = add(client, t, "Design finish", 20, t["lead"])
    assert (a["sequence"], b["sequence"]) == (1, 2)
    assert a["lead_name"] == "lead" and [p["name"] for p in a["assistants"]] == ["asst"]
    assert b["is_locked"] and b["waiting_for_title"] == "R&D finish"


def test_next_step_cannot_start_until_previous_is_achieved(client, db, t):
    pid = t["project"]["id"]
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    b = add(client, t, "Design finish", 20, t["lead"], [t["asst"]])
    activate(client, t)
    assert notes(db, t["asst"], "pm_milestone_assigned") == 2

    # Planning ahead is allowed; starting is not.
    r = client.post(f"{API}/pm-work/milestones/{b['id']}/tasks", headers=auth(t["lead"]), json={
        "title": "GA", "assignee_id": t["asst"].id, "due_date": str(TODAY + timedelta(days=15))})
    assert r.status_code == 200, r.text
    later = r.json()
    r = client.post(f"{API}/pm-work/tasks/{later['id']}/start", headers=auth(t["asst"]))
    assert r.status_code == 409 and "step 1 'R&D finish'" in r.json()["detail"]

    # Finish step 1 → step 2 unlocks and its team is told.
    first = client.post(f"{API}/pm-work/milestones/{a['id']}/tasks", headers=auth(t["lead"]), json={
        "title": "Market survey", "assignee_id": t["asst"].id, "due_date": str(TODAY + timedelta(days=5))}).json()
    h = auth(t["asst"])
    assert client.post(f"{API}/pm-work/tasks/{first['id']}/start", headers=h).status_code == 200
    assert client.post(f"{API}/pm-work/tasks/{first['id']}/complete", headers=h, json={"note": "Delivered drawing DWG-12 rev A"}).status_code == 200
    assert client.post(f"{API}/pm-work/milestones/{a['id']}/submit", headers=auth(t["lead"]), json={"submission_note": "Survey"}).status_code == 200
    assert client.post(f"{API}/projects/{pid}/milestones/{a['id']}/accept", headers=auth(t["pm"]), json={}).status_code == 200
    assert notes(db, t["lead"], "pm_milestone_unlocked") == 1
    assert client.post(f"{API}/pm-work/tasks/{later['id']}/start", headers=h).status_code == 200


def test_reorder_only_unstarted_steps(client, db, t):
    pid = t["project"]["id"]
    a = add(client, t, "One", 10, t["lead"])
    b = add(client, t, "Two", 20, t["lead"])
    r = client.post(f"{API}/projects/{pid}/milestones/{b['id']}/move", headers=auth(t["pm"]), json={"direction": "up"})
    assert r.status_code == 200 and [m["title"] for m in r.json()] == ["Two", "One"]
    r = client.post(f"{API}/projects/{pid}/milestones/{a['id']}/move", headers=auth(t["pm"]), json={"direction": "down"})
    assert r.status_code == 409 and "last step" in r.json()["detail"]


def test_member_sees_own_tasks_only_and_adds_own_task(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    activate(client, t)
    client.post(f"{API}/pm-work/milestones/{a['id']}/tasks", headers=auth(t["lead"]), json={
        "title": "Lead's own", "assignee_id": t["lead"].id, "due_date": str(TODAY + timedelta(days=5))})
    h = auth(t["asst"])
    r = client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=h, json={
        "title": "Check vendor catalogue", "due_date": str(TODAY + timedelta(days=4)), "estimated_hours": 3})
    assert r.status_code == 200 and r.json()["assignee_id"] == t["asst"].id and r.json()["is_self_created"]
    assert notes(db, t["lead"], "pm_task_self_added") == 1
    ws = client.get(f"{API}/pm-work/milestones/{a['id']}", headers=h).json()
    assert ws["role"] == "member" and [x["title"] for x in ws["tasks"]] == ["Check vendor catalogue"]
    assert ws["milestone"]["progress_percent"] == 0 and not ws["can_plan"]
    # Outsiders can't add tasks.
    r = client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=auth(t["purchase"]), json={
        "title": "x", "due_date": str(TODAY + timedelta(days=4))})
    assert r.status_code == 403
    # Department/projects view hides progress from the assistant.
    rows = client.get(f"{API}/pm-work/department/projects", headers=h).json()
    assert rows[0]["milestones"][0]["my_role"] == "member"


def test_lead_manages_team_and_cannot_drop_person_with_open_task(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"])
    activate(client, t)
    r = client.put(f"{API}/pm-work/milestones/{a['id']}/team", headers=auth(t["lead"]), json={"assistant_user_ids": [t["asst"].id]})
    assert r.status_code == 200 and [p["id"] for p in r.json()["assistants"]] == [t["asst"].id]
    assert notes(db, t["asst"], "pm_milestone_assigned") == 1
    client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=auth(t["asst"]), json={
        "title": "x", "due_date": str(TODAY + timedelta(days=4))})
    r = client.put(f"{API}/pm-work/milestones/{a['id']}/team", headers=auth(t["lead"]), json={"assistant_user_ids": []})
    assert r.status_code == 409 and "open tasks" in r.json()["detail"]
    assert client.put(f"{API}/pm-work/milestones/{a['id']}/team", headers=auth(t["asst"]), json={"assistant_user_ids": []}).status_code == 403


def test_head_assigning_department_person_adds_them_to_team(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"])
    activate(client, t)
    r = client.post(f"{API}/pm-work/milestones/{a['id']}/tasks", headers=auth(t["lead"]), json={
        "title": "x", "assignee_id": t["member"].id, "due_date": str(TODAY + timedelta(days=4))})
    assert r.status_code == 200
    db.expire_all()
    assert t["member"].id in db.get(PmProjectMilestone, a["id"]).assistant_user_ids


def test_time_log_rules(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    activate(client, t)
    h = auth(t["asst"])
    task = client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=h, json={
        "title": "x", "due_date": str(TODAY + timedelta(days=4))}).json()
    r = client.post(f"{API}/pm-work/tasks/{task['id']}/time", headers=h, json={"work_date": str(TODAY), "hours": 2})
    assert r.status_code == 409 and "Start the task" in r.json()["detail"]
    client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=h)
    r = client.post(f"{API}/pm-work/tasks/{task['id']}/time", headers=h, json={"work_date": str(TODAY), "hours": 2.5, "note": "Survey"})
    assert r.status_code == 200 and r.json()["task"]["logged_hours"] == 2.5 and len(r.json()["time_logs"]) == 1
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/time", headers=h, json={"work_date": str(TODAY), "hours": 22}).status_code == 422
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/time", headers=h, json={"work_date": str(TODAY + timedelta(days=1)), "hours": 1}).status_code == 422
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/time", headers=auth(t["lead"]), json={"work_date": str(TODAY), "hours": 1}).status_code == 403
    log_id = r.json()["time_logs"][0]["id"]
    assert client.delete(f"{API}/pm-work/time/{log_id}", headers=auth(t["lead"])).status_code == 403
    assert client.delete(f"{API}/pm-work/time/{log_id}", headers=h).json()["task"]["logged_hours"] == 0


def test_chat_mentions_give_access_and_notify(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    activate(client, t)
    url = f"{API}/pm-work/milestones/{a['id']}/messages"
    assert client.get(url, headers=auth(t["purchase"])).status_code == 403
    assert client.post(url, headers=auth(t["asst"]), data={"body": " "}).status_code == 422
    r = client.post(url, headers=auth(t["lead"]), data={"body": "@buyer is this cylinder available?", "mention_user_ids": f"{t['purchase'].id}"})
    assert r.status_code == 200 and [p["name"] for p in r.json()["mentions"]] == ["buyer"]
    assert notes(db, t["purchase"], "pm_mention") == 1
    # The tagged buyer can now read and reply, but sees no tasks.
    assert len(client.get(url, headers=auth(t["purchase"])).json()) == 1
    ws = client.get(f"{API}/pm-work/milestones/{a['id']}", headers=auth(t["purchase"])).json()
    assert ws["role"] == "guest" and ws["tasks"] == []
    assert client.post(url, headers=auth(t["purchase"]), data={"body": "Yes, 2 weeks lead time"}).status_code == 200


def test_task_comment_mentions(client, db, t):
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    activate(client, t)
    h = auth(t["asst"])
    task = client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=h, json={
        "title": "x", "due_date": str(TODAY + timedelta(days=4))}).json()
    assert client.get(f"{API}/pm-work/tasks/{task['id']}", headers=auth(t["purchase"])).status_code == 403
    r = client.post(f"{API}/pm-work/tasks/{task['id']}/comments", headers=h, json={"comment": "@buyer price?", "mention_user_ids": [t["purchase"].id]})
    assert r.status_code == 200 and r.json()["updates"][0]["mentions"][0]["name"] == "buyer"
    assert notes(db, t["purchase"], "pm_mention") == 1
    assert client.get(f"{API}/pm-work/tasks/{task['id']}", headers=auth(t["purchase"])).status_code == 200


def test_breakdown_shows_whole_hierarchy(client, db, t):
    pid = t["project"]["id"]
    a = add(client, t, "R&D finish", 10, t["lead"], [t["asst"]])
    activate(client, t)
    given = client.post(f"{API}/pm-work/milestones/{a['id']}/tasks", headers=auth(t["lead"]), json={
        "title": "Survey", "assignee_id": t["asst"].id, "due_date": str(TODAY + timedelta(days=5))}).json()
    h = auth(t["asst"])
    client.post(f"{API}/pm-work/milestones/{a['id']}/my-tasks", headers=h, json={"title": "Own", "due_date": str(TODAY + timedelta(days=5))})
    client.post(f"{API}/pm-work/tasks/{given['id']}/start", headers=h)
    client.post(f"{API}/pm-work/tasks/{given['id']}/block", headers=h, json={"reason": "Waiting for vendor quote"})
    client.post(f"{API}/pm-work/tasks/{given['id']}/comments", headers=h, json={"comment": "@buyer quote?", "mention_user_ids": [t["purchase"].id]})
    client.post(f"{API}/pm-work/milestones/{a['id']}/messages", headers=auth(t["lead"]), data={"body": "kickoff"})

    b = client.get(f"{API}/projects/{pid}/breakdown", headers=auth(t["pm"])).json()
    ms = b["milestones"][0]
    assert ms["milestone"]["title"] == "R&D finish" and len(ms["tasks"]) == 2
    person = ms["people"][0]
    assert person["name"] == "asst" and person["given"] == 1 and person["self_added"] == 1 and person["open"] == 2
    task = next(x for x in ms["tasks"] if x["id"] == given["id"])
    assert task["blocker_reason"] == "Waiting for vendor quote" and task["created_by_name"] == "lead"
    assert [c["mentions"][0]["name"] for c in task["comments"]] == ["buyer"]
    assert [x["to_status"] for x in task["history"]] == ["in_progress", "blocked"]
    assert ms["mentioned"] == [{"id": t["purchase"].id, "name": "buyer"}] and ms["messages"][0]["body"] == "kickoff"
    # Lead sees the same for their milestone; an assistant doesn't.
    assert client.get(f"{API}/pm-work/milestones/{a['id']}/breakdown", headers=auth(t["lead"])).status_code == 200
    assert client.get(f"{API}/pm-work/milestones/{a['id']}/breakdown", headers=h).status_code == 403
