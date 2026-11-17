"""R&D tasks on PAST MACHINES of All Projects (2026-11-17): Create Task › Project lists every
All Projects entry — Project Management projects and the past machines (erp_projects not
linked to a project) — and a task on a machine runs like a task on a PM project."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.modules.erp.models.project import Project as Machine
from app.modules.main.models.notification import Notification
from app.modules.projects.models.project import PmProject
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.services import task_board
from app.tests.test_cov_crm_quotations_rnd import auth, make_user, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_task_board import BOARD, RND, _create, _due, _env


def _machine(db, serial, **extra):
    m = Machine(serial_number=serial, status=extra.pop("status", "active"), **extra)
    db.add(m)
    db.commit()
    return m


def _machines_env(client, db):
    bd, head, member, other, inq, project = _env(client, db)
    pm = PmProject(project_code="PEW-78", name="Crane for NR — PO-9", client_name="NR", status="active", customer_po_ref="PO-9")
    db.add(pm)
    db.commit()
    m2 = _machine(db, "PEW-2", model_name="RRV", client_company="Northern Rly", site_name="Delhi yard")
    m10 = _machine(db, "PEW-10", client_company="Eastern Rly", status="handed_over")
    m77 = _machine(db, "PEW-77-1", model_name="Tower wagon")
    return head, member, other, pm, m2, m10, m77


def _machine_task(client, m, who, assignee, **extra):
    return _create(client, who, type="project", machine_id=str(m.id), assignee=assignee, **extra)


# ── The picker ────────────────────────────────────────────────────────────

def test_picker_lists_pm_projects_and_past_machines_in_natural_order(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    linked = _machine(db, "PEW-78-LINKED", client_company="Linked")
    linked.pm_project_id = pm.id
    gone = _machine(db, "PEW-99", client_company="Deleted")
    gone.is_deleted = True
    db.commit()
    rows = client.get(f"{BOARD}/pm-project-options", headers=auth(head)).json()
    assert [r["project_code"] for r in rows] == ["PEW-2", "PEW-10", "PEW-77-1", "PEW-78"]
    assert [r["kind"] for r in rows] == ["machine", "machine", "machine", "pm_project"]
    by_code = {r["project_code"]: r for r in rows}
    assert by_code["PEW-2"]["id"] == m2.id and by_code["PEW-2"]["label"] == "PEW-2 · Northern Rly"
    assert by_code["PEW-2"]["client_name"] == "Northern Rly" and by_code["PEW-2"]["name"] == "Northern Rly"
    assert by_code["PEW-77-1"]["label"] == "PEW-77-1 · Tower wagon"       # model name when there is no customer
    assert by_code["PEW-10"]["kind"] == "machine"                        # any status
    assert by_code["PEW-78"]["label"] == "PEW-78 · Crane for NR"         # no PO number in the picker


def test_picker_search_and_who_sees_machines(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    url = f"{BOARD}/pm-project-options"
    for term, expected in (("PEW-10", ["PEW-10"]), ("tower", ["PEW-77-1"]), ("northern", ["PEW-2"]), ("yard", ["PEW-2"])):
        assert [r["project_code"] for r in client.get(url, params={"q": term}, headers=auth(head)).json()] == expected
    # A plain R&D user (not head, not management) gets neither machines nor other people's projects.
    assert client.get(url, headers=auth(member)).json() == []
    # Management (a Partner) and admins see the machines.
    partner = make_user(db, "pm.partner@premnathrail.com", apps=("rnd",))
    partner.is_partner = True
    admin = make_user(db, "pm.admin@premnathrail.com", role="admin", apps=("rnd",))
    db.commit()
    for who in (partner, admin):
        assert {r["project_code"] for r in client.get(url, headers=auth(who)).json()} >= {"PEW-2", "PEW-10", "PEW-77-1"}


def test_natural_order_key():
    refs = ["PEW-78", "PEW-10", "PEW-77-1", "PEW-2", "PEW-77", "PEW-1"]
    assert sorted(refs, key=task_board.natural_key) == ["PEW-1", "PEW-2", "PEW-10", "PEW-77", "PEW-77-1", "PEW-78"]
    assert task_board.natural_key(None) == [""]


# ── Create Task ───────────────────────────────────────────────────────────

def test_create_task_on_a_machine_and_refusals(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    # Not a head / management and no task on it: the machine does not exist for them.
    r = _machine_task(client, m2, member, other)
    assert r.status_code == 404 and "no R&D task on it" in r.json()["detail"]
    r = _create(client, head, type="project", assignee=member)
    assert r.status_code == 422 and "Pick the project" in r.json()["detail"]
    r = _create(client, head, type="project", machine_id=str(m2.id), pm_project_id=str(pm.id), assignee=member)
    assert r.status_code == 422 and "not both" in r.json()["detail"]
    r = _machine_task(client, _machine(db, "PEW-5"), head, member, due_date=(date.today() - timedelta(days=1)).isoformat())
    assert r.status_code == 422 and "in the past" in r.json()["detail"]
    r = client.post(f"{RND}/machines/999999/tasks", data={"title": "x", "assigned_to_id": str(member.id), "due_date": _due()}, headers=auth(head))
    assert r.status_code == 404
    linked = _machine(db, "PEW-80")
    linked.pm_project_id = pm.id
    db.commit()
    r = _machine_task(client, linked, head, member)
    assert r.status_code == 422 and "linked to a Project Management project" in r.json()["detail"]
    assert db.query(RndProjectTask).count() == 0

    r = _machine_task(client, m2, head, member, remarks="Re-check the axle", checklist='["Measure", "Report"]')
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "project" and body["source"] == "machine" and body["record_id"] == m2.id
    t = db.query(RndProjectTask).one()
    assert t.machine_id == m2.id and t.project_id is None and t.pm_project_id is None
    # The assignee is told (bell), pointing at the machine page.
    note = db.query(Notification).filter(Notification.user_id == member.id, Notification.notification_type == "rnd_project_task_assigned").one()
    assert note.entity_type == "rnd_machine" and note.entity_id == m2.id and "PEW-2" in note.title


def test_create_task_via_machine_endpoint_and_assignees(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    people = client.get(f"{BOARD}/assignees", params={"type": "project", "machine_id": m2.id}, headers=auth(head)).json()
    assert {member.id, other.id} <= {p["id"] for p in people}
    r = client.get(f"{BOARD}/assignees", params={"type": "project", "machine_id": m2.id}, headers=auth(member))
    assert r.status_code == 404
    r = client.get(f"{BOARD}/assignees", params={"type": "project", "machine_id": m2.id, "pm_project_id": pm.id}, headers=auth(head))
    assert r.status_code == 422 and "one project only" in r.json()["detail"]
    r = client.post(f"{RND}/machines/{m77.id}/tasks", data={"title": "Survey", "assigned_to_id": str(member.id), "due_date": _due()}, headers=auth(head))
    assert r.status_code == 200 and r.json()["source"] == "machine"
    # An assignee outside R&D is refused with the reason and the fix.
    outsider = make_user(db, "pm.outsider@premnathrail.com", apps=("crm",))
    r = client.post(f"{RND}/machines/{m77.id}/tasks", data={"title": "S2", "assigned_to_id": str(outsider.id), "due_date": _due()}, headers=auth(head))
    assert r.status_code == 400 and "R&D" in r.json()["detail"]


# ── The task page, the board, analytics ───────────────────────────────────

def test_machine_page_access_list_and_board(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    assert _machine_task(client, m2, head, member, checklist='["Measure"]').status_code == 200
    access = client.get(f"{RND}/machines/{m2.id}/task-access", headers=auth(head)).json()
    assert access["can_manage"] is True
    assert access["project"]["project_code"] == "PEW-2" and access["project"]["kind"] == "machine" and access["project"]["client_name"] == "Northern Rly"
    assert access["machine"]["project_number"] == "PEW-2" and access["machine"]["title"] == "Northern Rly" and access["machine"]["id"] == m2.id
    assert "people" in access and "team" in access
    for path in (f"{RND}/machines/{m2.id}/task-access", f"{RND}/machines/{m2.id}/tasks"):
        r = client.get(path, headers=auth(other))
        assert r.status_code == 404 and "no R&D task on it" in r.json()["detail"]
    assert client.get(f"{RND}/machines/{m2.id}/task-access", headers=auth(member)).json()["can_manage"] is False
    assert len(client.get(f"{RND}/machines/{m2.id}/tasks", headers=auth(head)).json()) == 1
    mine = client.get(f"{RND}/machines/{m2.id}/tasks", headers=auth(member)).json()
    assert len(mine) == 1 and mine[0]["source"] == "machine"
    assert client.get(f"{RND}/machines/999999/tasks", headers=auth(head)).status_code == 404

    # Board: type "project", parent = serial, signed ref present; filters and analytics agree.
    assert _create(client, head, type="project", pm_project_id=str(pm.id), assignee=member).status_code == 200
    rows = client.get(BOARD, headers=auth(head)).json()["items"]
    assert [r["parent"]["ref"] for r in rows] == ["PEW-2", "PEW-78"]
    machine_row = rows[0]
    assert machine_row["type"] == "project" and machine_row["parent"]["kind"] == "machine" and machine_row["parent"]["id_ref"]
    assert machine_row["parent"]["id"] == m2.id and machine_row["parent"]["title"] == "Northern Rly"
    assert client.get(BOARD, params={"type": "project"}, headers=auth(head)).json()["total"] == 2
    assert client.get(BOARD, params={"type": "prototype"}, headers=auth(head)).json()["total"] == 0
    assert client.get(BOARD, params={"machine_id": m2.id}, headers=auth(head)).json()["total"] == 1
    assert client.get(BOARD, params={"pm_project_id": pm.id}, headers=auth(head)).json()["total"] == 1
    assert client.get(BOARD, params={"q": "PEW-2"}, headers=auth(head)).json()["total"] == 1
    groups = client.get(f"{BOARD}/analytics", headers=auth(head)).json()["by_project"]
    assert [(g["kind"], g["ref"]) for g in groups] == [("machine", "PEW-2"), ("pm_project", "PEW-78")]
    opts = client.get(f"{BOARD}/filter-options", headers=auth(head)).json()
    assert {(p["kind"], p["ref"]) for p in opts["pm_projects"]} == {("machine", "PEW-2"), ("pm_project", "PEW-78")}
    assert [p["ref"] for p in opts["machines"]] == ["PEW-2"]
    # The assignee sees only their own tasks on the board.
    assert client.get(BOARD, headers=auth(member)).json()["total"] == 2
    assert client.get(BOARD, headers=auth(other)).json()["total"] == 0


def test_task_works_like_any_project_task(client, db, tor_env):  # noqa: F811
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    assert _machine_task(client, m2, head, member, checklist='["Measure"]').status_code == 200
    task_id = client.get(f"{RND}/machines/{m2.id}/tasks", headers=auth(member)).json()[0]["id"]
    detail = client.get(f"{RND}/project-tasks/{task_id}/detail", headers=auth(member)).json()
    assert detail["parent"]["kind"] == "machine" and detail["parent"]["project_number"] == "PEW-2" and detail["parent"]["id"] == m2.id
    assert detail["can_manage"] is False
    assert client.get(f"{RND}/project-tasks/{task_id}/detail", headers=auth(other)).status_code == 404
    mine = client.get(f"{RND}/project-tasks/mine", headers=auth(member)).json()
    assert mine[0]["source"] == "machine" and mine[0]["requirement_ref"] == "PEW-2"
    # Sub-task for a colleague.
    r = client.post(f"{RND}/project-tasks/{task_id}/subtasks", data={"title": "Part", "assigned_to_id": str(other.id), "due_date": _due(2)}, headers=auth(member))
    assert r.status_code == 200 and r.json()["source"] == "machine" and r.json()["parent_task_id"] == task_id
    sub_id = r.json()["id"]
    assert db.get(RndProjectTask, sub_id).machine_id == m2.id
    # Approval request → the head decides; an admin who is only an admin does not.
    r = client.post(f"{RND}/project-tasks/{task_id}/approvals", data={"request": "Use the 2 mm plate?"}, headers=auth(member))
    assert r.status_code == 200 and r.json()["pending_approval"] is True
    approval_id = r.json()["approvals"][0]["id"]
    assert db.query(Notification).filter(Notification.user_id == head.id, Notification.entity_type == "rnd_machine").count() >= 1
    admin = make_user(db, "pm.admin2@premnathrail.com", role="admin", apps=("rnd",))
    r = client.post(f"{RND}/project-task-approvals/{approval_id}/decide", json={"decision": "approve"}, headers=auth(admin))
    assert r.status_code == 403 and "admin does not decide" in r.json()["detail"]
    r = client.post(f"{RND}/project-task-approvals/{approval_id}/decide", json={"decision": "approve"}, headers=auth(head))
    assert r.status_code == 200 and r.json()["pending_approval"] is False
    # Complete (sub-task first), then the head reopens; the admin may cancel (manage).
    client.post(f"{RND}/project-tasks/{sub_id}/complete", data={"remarks": "Done"}, headers=auth(other))
    step = client.get(f"{RND}/machines/{m2.id}/tasks", headers=auth(member)).json()
    main = next(t for t in step if t["id"] == task_id)
    r = client.post(f"{RND}/project-tasks/{task_id}/progress", json={"item_id": main["checklist"][0]["id"], "done": True}, headers=auth(member))
    assert r.status_code == 200 and r.json()["progress_percent"] == 100
    r = client.post(f"{RND}/project-tasks/{task_id}/complete", data={"remarks": "Done"}, headers=auth(member))
    assert r.status_code == 200 and r.json()["status"] == "closed"
    r = client.post(f"{RND}/project-tasks/{task_id}/reopen", json={"remarks": "Redo", "new_due_date": _due(3)}, headers=auth(other))
    assert r.status_code == 403 and "Only the person who created this task" in r.json()["detail"]   # holds the sub-task, not a reviewer
    stranger = make_user(db, "pm.stranger@premnathrail.com", apps=("rnd",))
    r = client.post(f"{RND}/project-tasks/{task_id}/reopen", json={"remarks": "Redo", "new_due_date": _due(3)}, headers=auth(stranger))
    assert r.status_code == 404
    r = client.post(f"{RND}/project-tasks/{task_id}/reopen", json={"remarks": "Redo", "new_due_date": _due(3)}, headers=auth(head))
    assert r.status_code == 200 and r.json()["status"] == "open"
    r = client.post(f"{RND}/project-tasks/{task_id}/cancel", json={"remarks": "Not needed"}, headers=auth(admin))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


# ── Task files and reminders ──────────────────────────────────────────────

def test_machine_task_files_follow_the_task_access_rule(db, client, tor_env):  # noqa: F811
    from app.modules.rnd.routes import documents as docs
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    assert _machine_task(client, m2, head, member).status_code == 200
    task = db.query(RndProjectTask).one()
    doc = RndDocument(machine_id=m2.id, task_id=task.id, task_doc_role="work", doc_type="other", title="f.pdf", file_name="f.pdf",
                      sharepoint_path="p/f.pdf", uploaded_by_id=member.id, uploaded_by_name="m")
    db.add(doc)
    db.commit()
    assert docs._get_or_404(db, doc.id, user=member).id == doc.id          # assignee
    assert docs._get_or_404(db, doc.id, user=head).id == doc.id            # head manages
    with pytest.raises(HTTPException) as exc:
        docs._get_or_404(db, doc.id, user=other)                           # uninvolved: not found
    assert exc.value.status_code == 404
    # A reader who can see the task (assigned a sub-task elsewhere) but is not its assignee / creator is refused with 403.
    sub = RndProjectTask(machine_id=m2.id, title="s", assigned_to_id=other.id, created_by_id=member.id,
                         original_due_date=date.today(), due_date=date.today(), parent_task_id=task.id)
    db.add(sub)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        docs._get_or_404(db, doc.id, user=other)
    assert exc.value.status_code == 403 and "isn't yours" in exc.value.detail


def test_reminders_point_at_the_machine(db, client, tor_env):  # noqa: F811
    from app.modules.rnd.tasks.task_reminders import run_task_reminders
    head, member, other, pm, m2, m10, m77 = _machines_env(client, db)
    assert _machine_task(client, m2, head, member, due_date=_due(1)).status_code == 200
    assert run_task_reminders(db, today=date.today()) >= 1
    db.commit()  # each scheduled run commits
    note = db.query(Notification).filter(Notification.user_id == member.id, Notification.notification_type == "rnd_task_due_soon").one()
    assert note.entity_type == "rnd_machine" and note.entity_id == m2.id and "project PEW-2" in note.title
