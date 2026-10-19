"""Project Management RBAC: the Permission Matrix tab/action is necessary,
the workflow authority (management, project manager, head, assignee) is
still required on top, and deletes follow the company rule (Delete on the
tab + only your own records)."""
from datetime import timedelta

from app.modules.projects.models.document import PmProjectDocument
from app.tests.test_pm_department_workflow import (  # noqa: F401  (s is a fixture)
    API, TODAY, activate, add_milestone, add_task, auth, make_user, s,
)

VIEW_ONLY = [
    "projects:dashboard:view", "projects:all_projects:view", "projects:overview:view",
    "projects:milestones:view", "projects:documents:view", "projects:project_history:view",
]
MANAGER = VIEW_ONLY + [
    "projects:all_projects:create", "projects:all_projects:delete", "projects:overview:edit",
    "projects:documents:delete",
]


def _body(pm_id, code):
    return {"project_code": code, "name": "RBAC", "client_name": "IR", "project_manager_id": pm_id,
            "start_date": str(TODAY), "target_handover_date": str(TODAY + timedelta(days=30))}


def _doc(db, project_id, uploader_id):
    doc = PmProjectDocument(project_id=project_id, doc_type="other", title="Spec", file_name="spec.pdf",
                            file_path="p/spec.pdf", sharepoint_path=None, uploaded_by_id=uploader_id)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_view_only_user_reads_but_cannot_create_edit_or_delete(client, db, s):
    # Project manager of the project (workflow authority) but only View in the matrix.
    viewer = make_user(db, "rbac.view@x.com", granular_permissions=VIEW_ONLY)
    pid = s["project"]["id"]
    from app.modules.projects.models.project import PmProject
    db.get(PmProject, pid).project_manager_id = viewer.id
    db.commit()
    h = auth(viewer)

    assert client.get(f"{API}/projects", headers=h).status_code == 200
    assert client.get(f"{API}/projects/{pid}", headers=h).status_code == 200
    assert client.get(f"{API}/projects/{pid}/milestones", headers=h).status_code == 200
    assert client.get(f"{API}/projects/{pid}/audit", headers=h).status_code == 200

    assert client.post(f"{API}/projects", headers=h, json=_body(viewer.id, "RB-1")).status_code == 403
    r = client.patch(f"{API}/projects/{pid}", headers=h, json={"name": "Renamed"})
    assert r.status_code == 403 and "'edit' permission" in r.json()["detail"].lower()
    r = client.post(f"{API}/projects/{pid}/milestones", headers=h, json={
        "title": "X", "department_id": s["dept"].id, "lead_user_id": s["head"].id,
        "target_date": str(TODAY + timedelta(days=5)), "deliverable": "Signed GA drawing + BOM"})
    assert r.status_code == 403 and "'create' permission" in r.json()["detail"].lower()
    r = client.delete(f"{API}/projects/{pid}", headers=h)
    assert r.status_code == 403 and "'delete' permission" in r.json()["detail"].lower()
    doc = _doc(db, pid, viewer.id)
    assert client.delete(f"{API}/projects/{pid}/documents/{doc.id}", headers=h).status_code == 403


def test_no_tab_view_blocks_lists(client, db, s):
    only_board = make_user(db, "rbac.board@x.com", granular_permissions=["projects:department_board:view"])
    h = auth(only_board)
    assert client.get(f"{API}/projects/board", headers=h).status_code == 200
    assert client.get(f"{API}/projects", headers=h).status_code == 403
    assert client.get(f"{API}/projects/dashboard", headers=h).status_code == 403
    assert client.get(f"{API}/projects/{s['project']['id']}/audit", headers=h).status_code == 403


def test_delete_only_own_records(client, db, s):
    a = make_user(db, "rbac.a@x.com", is_director=True, granular_permissions=MANAGER)
    b = make_user(db, "rbac.b@x.com", is_director=True, granular_permissions=MANAGER)
    pa = client.post(f"{API}/projects", headers=auth(a), json=_body(a.id, "RB-A"))
    assert pa.status_code == 200, pa.text
    pid = pa.json()["id"]

    # B has Delete and is management, but didn't create it.
    r = client.delete(f"{API}/projects/{pid}", headers=auth(b))
    assert r.status_code == 403 and "created by someone else" in r.json()["detail"]

    # Documents: same rule on the uploader.
    theirs = _doc(db, pid, a.id)
    mine = _doc(db, pid, b.id)
    r = client.delete(f"{API}/projects/{pid}/documents/{theirs.id}", headers=auth(b))
    assert r.status_code == 403 and "created by someone else" in r.json()["detail"]
    assert client.delete(f"{API}/projects/{pid}/documents/{mine.id}", headers=auth(b)).status_code == 200
    assert client.delete(f"{API}/projects/{pid}/documents/{theirs.id}", headers=auth(a)).status_code == 200

    r = client.delete(f"{API}/projects/{pid}", headers=auth(a))
    assert r.status_code == 200 and r.json()["message"] == "Project deleted"


def test_assignee_needs_my_tasks_edit(client, db, s):
    """The record check (you are the assignee) isn't enough on its own: the
    matrix must let you work tasks — My Tasks, or your department module's
    Ongoing Projects tab."""
    m = add_milestone(client, s)
    activate(client, s)
    bare = make_user(db, "rbac.bare@x.com", department="Design")
    task = add_task(client, s, m, assignee_id=bare.id)
    r = client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(bare))
    assert r.status_code == 403 and "My Tasks" in r.json()["detail"]

    bare.granular_permissions = ["projects:my_tasks:view"]
    db.commit()
    assert client.get(f"{API}/pm-work/my-tasks", headers=auth(bare)).status_code == 200
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(bare)).status_code == 403

    bare.granular_permissions = ["projects:my_tasks:view", "projects:my_tasks:edit"]
    db.commit()
    assert client.post(f"{API}/pm-work/tasks/{task['id']}/start", headers=auth(bare)).status_code == 200
    # ...but My Tasks alone doesn't make them able to plan the department's work.
    r = client.post(f"{API}/pm-work/milestones/{m['id']}/tasks", headers=auth(bare), json={
        "title": "x", "assignee_id": bare.id, "due_date": str(TODAY + timedelta(days=3))})
    assert r.status_code == 403
