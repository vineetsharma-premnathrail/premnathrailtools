"""Assign-to rules (core/assignee_rules.py) on Project Management: who a role's
members may make a milestone's owner, and give its tasks to. People whose
roles don't open the project workspace (My Tasks users) are not restricted."""
from datetime import date, timedelta

from app.modules.main.models.role import Role
from app.tests.test_cov_projects_lifecycle import API, auth, create, w  # noqa: F401  (w = fixture)

MS_KEY = "projects:overview.milestones"
TASK_KEY = "projects:overview.tasks"
DUE = str(date.today() + timedelta(days=10))


def _limit(db, user, rules):
    role = Role(name=f"Narrow {user.id}", permissions=["projects:overview:view"], assignee_rules=rules)
    db.add(role)
    user.roles = [role]
    db.commit()


def test_milestone_owner_and_task_assignee_follow_the_role_rule(client, db, w):
    p = create(client, w)
    _limit(db, w["pm"], {MS_KEY: {"mode": "self"}, TASK_KEY: {"mode": "self"}})
    url = f"{API}/projects/{p['id']}/project-tasks"

    r = client.post(url, headers=auth(w["pm"]), json={"title": "GA drawing", "assignee_id": w["member"].id, "due_date": DUE})
    assert r.status_code == 403, r.text
    assert "doesn't let you assign this to" in r.json()["detail"] and "Set milestone owners to" in r.json()["detail"]
    r = client.post(url, headers=auth(w["pm"]), json={"title": "GA drawing", "assignee_id": w["pm"].id, "due_date": DUE,
                                                      "co_owner_ids": [w["member"].id]})
    assert r.status_code == 403  # a co-owner is picked too
    r = client.post(url, headers=auth(w["pm"]), json={"title": "GA drawing", "assignee_id": w["pm"].id, "due_date": DUE})
    assert r.status_code == 200, r.text
    ms = r.json()

    # Handing it over to someone outside the rule is refused; an untouched owner never blocks an edit.
    assert client.patch(f"{url}/{ms['id']}", headers=auth(w["pm"]), json={"assignee_id": w["member"].id}).status_code == 403
    assert client.patch(f"{url}/{ms['id']}", headers=auth(w["pm"]), json={"title": "GA drawing rev A"}).status_code == 200

    sub_url = f"{API}/pm-ongoing/tasks/{ms['id']}/subtasks"
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Frame", "assignee_id": w["member"].id, "due_date": DUE})
    assert r.status_code == 403 and "Assign tasks to" in r.json()["detail"]
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Frame", "assignee_id": w["pm"].id, "due_date": DUE,
                                                          "collaborator_ids": [w["member"].id]})
    assert r.status_code == 403  # collaborators too
    r = client.post(sub_url, headers=auth(w["pm"]), json={"title": "Frame", "assignee_id": w["pm"].id, "due_date": DUE})
    assert r.status_code == 200, r.text
    sub = r.json()["subtasks"][0]
    r = client.patch(f"{API}/pm-ongoing/subtasks/{sub['id']}", headers=auth(w["pm"]), json={"assignee_id": w["member"].id})
    assert r.status_code == 403


def test_my_tasks_users_outside_project_management_are_not_restricted(client, db, w):
    p = create(client, w)
    r = client.post(f"{API}/projects/{p['id']}/project-tasks", headers=auth(w["pm"]),
                    json={"title": "GA drawing", "department_id": w["dept"].id, "assignee_id": w["member"].id, "due_date": DUE})
    assert r.status_code == 200, r.text
    # The member's role doesn't open projects:overview, so a rule on another role can't touch them.
    _limit(db, w["pm"], {TASK_KEY: {"mode": "self"}})
    r = client.post(f"{API}/pm-ongoing/tasks/{r.json()['id']}/subtasks", headers=auth(w["member"]),
                    json={"title": "Frame", "assignee_id": w["noapp"].id, "due_date": DUE})
    assert r.status_code == 200, r.text


def test_allowed_endpoint_reports_the_rule_for_the_frontend_filter(client, db, w):
    _limit(db, w["pm"], {TASK_KEY: {"mode": "self"}})
    r = client.get(f"{API}/assignee-rules/allowed", headers=auth(w["pm"]), params={"key": TASK_KEY})
    assert r.status_code == 200 and r.json() == {"restricted": True, "user_ids": [w["pm"].id]}
    r = client.get(f"{API}/assignee-rules/allowed", headers=auth(w["pm"]), params={"key": "erp:service_requests.visits"})
    assert r.status_code == 200 and r.json() == {"restricted": False}
