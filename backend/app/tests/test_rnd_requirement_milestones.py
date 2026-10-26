"""Milestones on an R&D requirement (rnd/routes/requirement_milestones.py): the
R&D head plans milestones for people in R&D or a shared department, tasks go
inside a milestone (due by its end date), a milestone is achieved only once its
tasks are finished, delete only while it never had a task, and the History tab
lists it all. Tasks without a milestone keep working as before."""
from datetime import date, timedelta

from app.main import app
from app.modules.main.models.role import Role
from app.modules.rnd.models.requirement_milestone import RndRequirementMilestone
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.modules.rnd.routes import requirement_milestones as milestone_routes
from app.tests.test_cov_crm_quotations_rnd import auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import _setup

RND = "/api/v1/rnd"
WORK = f"{RND}/requirement-work"

# The router is mounted in main.py; mount it here too only while it isn't.
if not any(getattr(r, "path", "") == f"{RND}/requirement-work/{{source}}/{{record_id}}/milestone-people" for r in app.routes):
    app.include_router(milestone_routes.router, prefix=RND)


def _due(days):
    return (date.today() + timedelta(days=days)).isoformat()


def _ms(client, inq, by, owner, title="Design freeze", due=20, **extra):
    return client.post(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(by),
                       json={"title": title, "assignee_id": owner.id, "due_date": _due(due), **extra})


def _task(client, inq, by, to, ms=None, due=5, title="GA drawing"):
    data = {"title": title, "assigned_to_id": str(to.id), "due_date": _due(due)}
    if ms is not None:
        data["milestone_id"] = str(ms)
    return client.post(f"{WORK}/inquiry/{inq.id}/tasks", data=data, headers=auth(by))


def _status(client, inq, ms, by, action, reason=None):
    return client.post(f"{WORK}/inquiry/{inq.id}/milestones/{ms}/status", json={"action": action, "reason": reason}, headers=auth(by))


def _complete(client, task_id, by):
    r = client.post(f"{WORK}/tasks/{task_id}/complete", data={"remarks": "done"}, headers=auth(by))
    assert r.status_code == 200, r.text


def test_head_creates_edits_deletes_and_others_are_refused(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    r = _ms(client, inq, head, eng, icon="gear", color="#0284c7")
    assert r.status_code == 200, r.text
    ms = r.json()
    assert ms["status"] == "todo" and ms["source"] == "inquiry" and ms["record_id"] == inq.id
    assert ms["can_edit"] and ms["can_delete"] and ms["tasks_total"] == 0 and "project_id" not in ms

    # Non-head with access can see, but not change.
    assert client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": [{"user_id": eng.id, "can_view": True}]}, headers=auth(head)).status_code == 200
    rows = client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(eng)).json()
    assert [m["id"] for m in rows] == [ms["id"]] and rows[0]["can_edit"] is False and rows[0]["can_work"] is True
    r = _ms(client, inq, eng, eng, title="X")
    assert r.status_code == 403 and "R&D head" in r.json()["detail"]
    assert client.patch(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", json={"title": "Y"}, headers=auth(eng)).status_code == 403
    assert client.delete(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", headers=auth(eng)).status_code == 403

    # No access to the requirement at all: 403 everywhere.
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(other)).status_code == 403
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestone-people", headers=auth(other)).status_code == 403
    assert client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(other)).status_code == 403

    r = client.patch(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", json={"title": "Design freeze v2", "due_date": _due(25)}, headers=auth(head))
    assert r.status_code == 200 and r.json()["title"] == "Design freeze v2" and r.json()["due_date"] == _due(25)
    r = _ms(client, inq, head, eng, title="Bad", due=3, start_date=_due(9))
    assert r.status_code == 422 and "after the end date" in r.json()["detail"]
    assert _ms(client, inq, head, eng, title=" ").status_code == 422

    assert client.delete(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", headers=auth(head)).status_code == 200
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(head)).json() == []


def test_milestone_of_another_requirement_is_404_everywhere(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    inq2 = make_inquiry(db, bd, uid="INQ-20261007-0002")
    assert send_tor(client, inq2.id, bd).status_code == 200
    ms = _ms(client, inq, head, eng).json()
    mid = ms["id"]

    base2 = f"{WORK}/inquiry/{inq2.id}/milestones/{mid}"
    for call in (client.patch(base2, json={"title": "Z"}, headers=auth(head)), client.delete(base2, headers=auth(head)),
                 _status(client, inq2, mid, head, "cancel", "x")):
        assert call.status_code == 404 and "isn't on" in call.json()["detail"]
    # The other source has no such requirement either.
    assert client.get(f"{WORK}/tender/{inq.id}/milestones", headers=auth(head)).status_code == 404

    # Tasks: create and move.
    r = _task(client, inq2, head, eng, ms=mid)
    assert r.status_code == 404 and "isn't on" in r.json()["detail"]
    local = _task(client, inq2, head, eng).json()
    r = client.patch(f"{WORK}/tasks/{local['id']}", json={"milestone_id": mid}, headers=auth(head))
    assert r.status_code == 404
    assert db.get(RndRequirementTask, local["id"]).milestone_id is None


def test_owner_rules_and_new_rnd_owner_gets_access(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    outsider = make_user(db, "ms.crm@premnathrail.com")
    r = _ms(client, inq, head, outsider)
    assert r.status_code == 422 and "doesn't work on this requirement" in r.json()["detail"]
    r = client.post(f"{WORK}/inquiry/{inq.id}/milestones", json={"title": "No owner", "due_date": _due(5)}, headers=auth(head))
    assert r.status_code == 422 and "responsible" in r.json()["detail"]

    # A new R&D owner can open the requirement afterwards.
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(other)).status_code == 403
    assert _ms(client, inq, head, other).status_code == 200
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(other)).status_code == 200

    # The role's "Set milestone owners to" rule.
    role = Role(name="Ms planner", is_active=True, permissions=["rnd:requirements:view"],
                assignee_rules={"rnd:requirements.milestones": {"mode": "custom", "users": [eng.id]}})
    db.add(role)
    head.roles.append(role)
    db.commit()
    r = _ms(client, inq, head, other, title="Second")
    assert r.status_code == 403 and "Set milestone owners to" in r.json()["detail"]
    assert _ms(client, inq, head, eng, title="Second").status_code == 200
    people = client.get(f"{WORK}/inquiry/{inq.id}/milestone-people", headers=auth(head)).json()
    assert [p["id"] for p in people] == [eng.id]


def test_people_list_is_deduplicated_and_marks_heads(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    people = client.get(f"{WORK}/inquiry/{inq.id}/milestone-people", headers=auth(head)).json()
    ids = [p["id"] for p in people]
    assert len(ids) == len(set(ids)) and {head.id, eng.id, other.id} <= set(ids)
    assert {p["id"]: p["team_role"] for p in people}[head.id] == "head"
    assert {p["id"]: p["team_role"] for p in people}[eng.id] == "member"


def test_tasks_inside_milestones(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng, due=10).json()
    # Later than the milestone ends: refused.
    r = _task(client, inq, head, eng, ms=ms["id"], due=15)
    assert r.status_code == 422 and "milestone's end date" in r.json()["detail"]
    r = _task(client, inq, head, eng, ms=ms["id"], due=5)
    assert r.status_code == 200, r.text
    task = r.json()
    assert task["milestone_id"] == ms["id"] and task["milestone_title"] == "Design freeze"
    row = client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(head)).json()[0]
    assert row["status"] == "in_progress" and row["tasks_total"] == 1 and row["can_delete"] is False

    # Sub-task inherits the milestone.
    r = client.post(f"{WORK}/tasks/{task['id']}/subtasks", data={"title": "Part", "assigned_to_id": str(other.id), "due_date": _due(4)}, headers=auth(eng))
    assert r.status_code == 200, r.text
    sub = r.json()
    assert sub["milestone_id"] == ms["id"]
    # Sub-tasks don't count in progress.
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(head)).json()[0]["tasks_total"] == 1

    # A task due after the milestone can't be moved later than its end.
    r = client.patch(f"{WORK}/tasks/{task['id']}", json={"due_date": _due(15)}, headers=auth(head))
    assert r.status_code == 422 and "milestone's end date" in r.json()["detail"]

    # A cancelled milestone takes no tasks.
    ms2 = _ms(client, inq, head, eng, title="Dropped").json()
    assert _status(client, inq, ms2["id"], head, "cancel", "Scope dropped").status_code == 200
    r = _task(client, inq, head, eng, ms=ms2["id"])
    assert r.status_code == 409 and "Reopen it first" in r.json()["detail"]


def test_achieve_reopen_cancel_delete_rules(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng, due=10).json()
    task = _task(client, inq, head, eng, ms=ms["id"]).json()

    r = _status(client, inq, ms["id"], eng, "done")
    assert r.status_code == 409 and "still open" in r.json()["detail"]
    assert _status(client, inq, ms["id"], head, "cancel", "dropped").status_code == 409
    r = client.delete(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", headers=auth(head))
    assert r.status_code == 409 and "Cancel milestone" in r.json()["detail"]
    assert _status(client, inq, ms["id"], head, "bogus").status_code == 422

    # An outsider with access but not responsible can't achieve it.
    client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": [{"user_id": other.id, "can_view": True}]}, headers=auth(head))
    _complete(client, task["id"], eng)
    r = _status(client, inq, ms["id"], other, "done")
    assert r.status_code == 403 and "responsible" in r.json()["detail"]

    # The responsible person achieves it.
    r = _status(client, inq, ms["id"], eng, "done")
    assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["tasks_done"] == 1
    assert _status(client, inq, ms["id"], eng, "done").status_code == 409

    # Reopen / cancel: head only, with a reason.
    assert _status(client, inq, ms["id"], eng, "reopen", "x").status_code == 403
    assert _status(client, inq, ms["id"], head, "reopen").status_code == 422
    r = _status(client, inq, ms["id"], head, "reopen", "Customer asked for a change")
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert _status(client, inq, ms["id"], head, "cancel").status_code == 422
    r = _status(client, inq, ms["id"], head, "cancel", "Dropped")
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Dropped"
    assert db.query(RndRequirementMilestone).count() == 1


def test_end_date_cannot_go_before_an_open_task(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng, due=20).json()
    assert _task(client, inq, head, eng, ms=ms["id"], due=12, title="Long task").status_code == 200
    r = client.patch(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", json={"due_date": _due(8)}, headers=auth(head))
    assert r.status_code == 422 and "Long task" in r.json()["detail"]
    r = client.patch(f"{WORK}/inquiry/{inq.id}/milestones/{ms['id']}", json={"due_date": _due(13)}, headers=auth(head))
    assert r.status_code == 200


def test_reopening_a_task_reopens_the_achieved_milestone(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng, due=10).json()
    task = _task(client, inq, head, eng, ms=ms["id"]).json()
    _complete(client, task["id"], eng)
    assert _status(client, inq, ms["id"], eng, "done").status_code == 200

    r = client.post(f"{WORK}/tasks/{task['id']}/reopen", json={"remarks": "Add brake calc"}, headers=auth(head))
    assert r.status_code == 200 and r.json()["status"] == "open"
    row = client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(head)).json()[0]
    assert row["status"] == "in_progress" and row["completed_at"] is None
    texts = " ".join(e["summary"] for e in client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(head)).json())
    assert "is open again" in texts


def test_move_between_milestones_is_head_only_and_subtasks_follow(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    a = _ms(client, inq, head, eng, title="A", due=10).json()
    b = _ms(client, inq, head, eng, title="B", due=15).json()
    task = _task(client, inq, head, eng, ms=a["id"]).json()
    sub = client.post(f"{WORK}/tasks/{task['id']}/subtasks", data={"title": "Part", "assigned_to_id": str(other.id), "due_date": _due(4)}, headers=auth(eng)).json()

    # The assignee created the sub-task, so reviews it — but a sub-task can't move alone.
    r = client.patch(f"{WORK}/tasks/{sub['id']}", json={"milestone_id": b["id"]}, headers=auth(head))
    assert r.status_code == 409 and "main task" in r.json()["detail"]
    # Eng reviews the sub-task they gave, but moving needs the head.
    r = client.patch(f"{WORK}/tasks/{sub['id']}", json={"milestone_id": b["id"]}, headers=auth(eng))
    assert r.status_code == 409
    # A reviewer who isn't the head can't move a main task.
    assert client.patch(f"{WORK}/tasks/{task['id']}", json={"milestone_id": b["id"]}, headers=auth(eng)).status_code == 403

    r = client.patch(f"{WORK}/tasks/{task['id']}", json={"milestone_id": b["id"]}, headers=auth(head))
    assert r.status_code == 200 and r.json()["milestone_id"] == b["id"] and r.json()["milestone_title"] == "B"
    assert db.get(RndRequirementTask, sub["id"]).milestone_id == b["id"]

    # Into a milestone that ends before the task is due.
    c = _ms(client, inq, head, eng, title="C", due=2).json()
    r = client.patch(f"{WORK}/tasks/{task['id']}", json={"milestone_id": c["id"]}, headers=auth(head))
    assert r.status_code == 422


def test_tasks_without_a_milestone_behave_as_before(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task = _task(client, inq, head, eng).json()
    assert task["milestone_id"] is None and task["milestone_title"] is None
    # Re-dating an overdue task has no milestone check.
    ms = _ms(client, inq, head, eng, due=10).json()
    in_ms = _task(client, inq, head, eng, ms=ms["id"], due=5, title="In milestone").json()
    t = db.get(RndRequirementTask, in_ms["id"])
    t.due_date = date.today() - timedelta(days=1)
    db.commit()
    r = client.post(f"{WORK}/tasks/{in_ms['id']}/extend", data={"reason": "Waiting", "new_due_date": _due(40)}, headers=auth(eng))
    assert r.status_code == 200, r.text
    assert client.get(f"{WORK}/tasks/mine", headers=auth(eng)).json()[0]["milestone_id"] in (None, ms["id"])


def test_history_merges_audit_and_task_events_and_hides_access_rows(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng, due=10).json()
    _task(client, inq, head, eng, ms=ms["id"], title="Axle check")
    client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": [{"user_id": eng.id, "can_view": True}]}, headers=auth(head))

    rows = client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(head)).json()
    kinds = {r["kind"] for r in rows}
    text = " ".join(r["summary"] for r in rows)
    assert {"milestone", "task", "requirement"} <= kinds
    assert "Milestone 'Design freeze' added" in text and "Axle check" in text
    assert any(r["action"] == "access_updated" for r in rows)

    rows = client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(eng)).json()
    assert rows and not any(r["action"].startswith("access_") for r in rows)


def test_feature_gate_for_rnd_side_roles_and_department_side_users(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    ms = _ms(client, inq, head, eng).json()
    # A role-based user (no legacy app list) whose role customises the requirement
    # features without Milestones / History.
    gated = make_user(db, "ms.gated@premnathrail.com", apps=())
    role = Role(name="Tasks only", is_active=True, permissions=["rnd:requirements:view", "rnd:requirements.tasks:view"])
    db.add(role)
    gated.roles.append(role)
    db.commit()
    assert client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": [{"user_id": gated.id, "can_view": True}]}, headers=auth(head)).status_code == 200
    assert client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(gated)).status_code == 200
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(gated)).status_code == 403
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestone-people", headers=auth(gated)).status_code == 403
    assert client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(gated)).status_code == 403
    assert _status(client, inq, ms["id"], gated, "done").status_code == 403
    # An uncustomised role keeps today's access (features inherit the tab's view).
    plain = make_user(db, "ms.plain@premnathrail.com", apps=())
    plain_role = Role(name="Requirements view", is_active=True, permissions=["rnd:requirements:view"])
    db.add(plain_role)
    plain.roles.append(plain_role)
    db.commit()
    client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": [{"user_id": plain.id, "can_view": True}]}, headers=auth(head))
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(plain)).status_code == 200
    assert client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(plain)).status_code == 200

    # Department side: record rules only (no feature gate), no History, never head-only actions.
    designer = make_user(db, "ms.designer@premnathrail.com", apps=("design",))
    resp = client.post(f"{WORK}/inquiry/{inq.id}/shares", json={"departments": ["design"], "note": "Check the platform fit"}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    assert client.get(f"{WORK}/inquiry/{inq.id}/milestones", headers=auth(designer)).status_code == 200
    r = client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(designer))
    assert r.status_code == 403 and "History is on R&D's requirement page" in r.json()["detail"]
    assert _ms(client, inq, designer, designer).status_code == 403
    # A designer can be made responsible once the requirement is shared with Design.
    assert _ms(client, inq, head, designer, title="Layout").status_code == 200
