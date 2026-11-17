"""Owner decision 2026-11-14 ("role ke permission di hai fir bhi show nahi hota"):
in Project Management and R&D the role tick decides — being the project
manager / management / a lead is no longer an extra gate on top of a ticked
grant; the data scope (View / Edit) still decides which records."""
from datetime import date, timedelta

from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask
from app.tests.test_pm_department_workflow import (  # noqa: F401  (s is a fixture)
    API, TODAY, add_milestone, auth, make_user, s,
)

EDITOR = ["projects:all_projects:view", "projects:overview:view", "projects:overview:edit"]


def _scoped(db, email, grants, level="assigned"):
    u = make_user(db, email, granular_permissions=grants)
    u.data_access_scopes = {"projects": level}
    db.commit()
    return u


def test_overview_edit_tick_edits_an_in_scope_project_without_being_pm(client, db, s):
    pid = s["project"]["id"]
    editor = make_user(db, "tick.editor@x.com", department="Design", granular_permissions=EDITOR)
    # On the project's team (WBS lead) -> inside the default Edit scope "Own + assigned".
    add_milestone(client, s, lead_user_id=editor.id)
    r = client.patch(f"{API}/projects/{pid}", headers=auth(editor), json={"name": "Renamed by tick"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renamed by tick" and r.json()["can_manage"] is True

    # Same tick, but not on the project: outside the Edit scope -> refused with the reason.
    stranger = make_user(db, "tick.stranger@x.com", granular_permissions=EDITOR)
    r = client.patch(f"{API}/projects/{pid}", headers=auth(stranger), json={"name": "Nope"})
    assert r.status_code == 403 and "Edit scope" in r.json()["detail"]
    assert client.get(f"{API}/projects/{pid}", headers=auth(stranger)).json()["can_manage"] is False

    # On the team but without the Edit tick: still refused (by the tick).
    no_tick = make_user(db, "tick.notick@x.com", granular_permissions=EDITOR[:2])
    db.get(PmProject, pid).project_manager_id = no_tick.id
    db.commit()
    r = client.patch(f"{API}/projects/{pid}", headers=auth(no_tick), json={"name": "Nope"})
    assert r.status_code == 403 and "'edit' permission" in r.json()["detail"].lower()


def test_workspace_tab_only_user_opens_the_project(client, db, s):
    pid = s["project"]["id"]
    for i, grant in enumerate(("projects:documents:view", "projects:project_history:view", "projects:overview:view")):
        u = make_user(db, f"tick.ws{i}@x.com", granular_permissions=[grant])
        r = client.get(f"{API}/projects/{pid}", headers=auth(u))
        assert r.status_code == 200, (grant, r.text)
    # My Tasks alone does not open a project page — refused with what to tick.
    u = make_user(db, "tick.mytasks@x.com", granular_permissions=["projects:my_tasks:view"])
    r = client.get(f"{API}/projects/{pid}", headers=auth(u))
    assert r.status_code == 403 and "Overview" in r.json()["detail"]


def test_co_owner_and_subtask_holder_see_the_project(client, db, s):
    pid = s["project"]["id"]
    co = _scoped(db, "tick.co@x.com", ["projects:all_projects:view"])
    sub_holder = _scoped(db, "tick.sub@x.com", ["projects:all_projects:view"])
    outsider = _scoped(db, "tick.out@x.com", ["projects:all_projects:view"])
    ms = PmProjectTask(project_id=pid, milestone_id=None, title="Bogie frame", assignee_id=s["pm"].id,
                       co_owner_ids=[co.id], due_date=TODAY + timedelta(days=9), status="todo", created_by_id=s["pm"].id)
    db.add(ms)
    db.flush()
    db.add(PmTaskSubtask(task_id=ms.id, title="Weld jig", assignee_id=sub_holder.id, status="todo"))
    db.commit()

    for who in (co, sub_holder):
        ids = [p["id"] for p in client.get(f"{API}/projects", headers=auth(who)).json()]
        assert pid in ids, who.email
        assert client.get(f"{API}/projects/{pid}", headers=auth(who)).status_code == 200
    assert pid not in [p["id"] for p in client.get(f"{API}/projects", headers=auth(outsider)).json()]
    r = client.get(f"{API}/projects/{pid}", headers=auth(outsider))
    assert r.status_code == 403 and "outside your data access" in r.json()["detail"]


def test_milestones_tick_adds_wbs_without_being_pm(client, db, s):
    pid = s["project"]["id"]
    planner = make_user(db, "tick.planner@x.com", granular_permissions=[
        "projects:all_projects:view", "projects:milestones:view", "projects:milestones:create"])
    db.get(PmProject, pid).created_by_id = planner.id  # own record -> inside the Edit scope
    db.commit()
    r = client.post(f"{API}/projects/{pid}/milestones", headers=auth(planner), json={
        "title": "Frame welded", "department_id": s["dept"].id, "lead_user_id": s["head"].id,
        "target_date": str(TODAY + timedelta(days=5)), "deliverable": "Welded frame + inspection report"})
    assert r.status_code == 200, r.text


def test_rnd_tasks_only_user_opens_a_project_task(client, db):
    lead = make_user(db, "tick.rndlead@x.com", granular_permissions=["rnd:projects:view"])
    worker = make_user(db, "tick.rndworker@x.com", granular_permissions=["rnd:tasks:view"])
    project = RndProject(project_number="RND-2026-0901", title="Rail grinder head", objective="Prototype",
                         lead_id=lead.id, lead_ids=[lead.id], team_member_ids=[worker.id])
    db.add(project)
    db.flush()
    due = date.today() + timedelta(days=4)
    task = RndProjectTask(project_id=project.id, title="Spindle calc", assigned_to_id=worker.id, created_by_id=lead.id,
                          original_due_date=due, due_date=due)
    db.add(task)
    db.commit()

    r = client.get(f"{API}/rnd/project-tasks/{task.id}/detail", headers=auth(worker))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [t["id"] for t in body["tasks"]] == [task.id]
    # The Prototype / Research page itself needs its own tab.
    assert body["can_open_parent"] is False

    # Neither R&D Tasks nor Prototype / Research ticked -> refused with what to tick.
    bare = make_user(db, "tick.rndbare@x.com", granular_permissions=["rnd:dashboard:view"])
    r = client.get(f"{API}/rnd/project-tasks/{task.id}/detail", headers=auth(bare))
    assert r.status_code == 403 and "R&D Tasks" in r.json()["detail"]


def test_rnd_task_create_tick_lets_a_team_member_give_tasks(client, db):
    lead = make_user(db, "tick.rl2@x.com", granular_permissions=["rnd:projects:view"])
    member = make_user(db, "tick.rm2@x.com", granular_permissions=["rnd:projects:view", "rnd:projects:edit"])
    other = make_user(db, "tick.ro2@x.com", granular_permissions=["rnd:projects:view"])
    project = RndProject(project_number="RND-2026-0902", title="Tamper arm", objective="Prototype",
                         lead_id=lead.id, lead_ids=[lead.id], team_member_ids=[member.id, other.id])
    db.add(project)
    db.commit()
    data = {"title": "Check weld", "assigned_to_id": str(other.id), "due_date": (date.today() + timedelta(days=3)).isoformat()}
    # View alone does not give tasks (Project tasks › Create inherits from Prototype / Research › Edit).
    viewer = client.post(f"{API}/rnd/projects/{project.id}/tasks", data=data, headers=auth(other))
    assert viewer.status_code == 403, viewer.text
    # The uncustomised role inherits Project tasks › Create from Prototype / Research › Edit.
    r = client.post(f"{API}/rnd/projects/{project.id}/tasks", data=data, headers=auth(member))
    assert r.status_code == 200, r.text
    access = client.get(f"{API}/rnd/projects/{project.id}/task-access", headers=auth(member)).json()
    assert access["can_manage"] is True
