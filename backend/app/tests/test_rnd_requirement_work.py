"""R&D requirement work: R&D head (Organization › Department), per-requirement access set
by the head, and tasks (create → extend when late → assignee completes; approval requests while open; reopen)."""
from datetime import date, timedelta

from app.modules.crm.models.document import CrmDocument
from app.modules.main.models.notification import Notification
from app.modules.rnd.models.requirement_work import RndRequirementTask, RndTaskEvent
from app.modules.rnd.routes import requirement_work as work_routes
from app.tests.test_cov_crm_quotations_rnd import auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture

RND = "/api/v1/rnd"
WORK = f"{RND}/requirement-work"


def make_rnd_head(db, user):
    """R&D heads are the R&D department's heads in Organization › Department."""
    from app.modules.organization.models.department import Department
    db.add(Department(name="R&D", code=f"RND-{user.id}", head_user_id=user.id))
    db.commit()


def _setup(client, db):
    bd = make_user(db, "w.bd@premnathrail.com")
    head = make_user(db, "w.head@premnathrail.com", apps=("rnd",))
    eng = make_user(db, "w.eng@premnathrail.com", apps=("rnd",))
    other = make_user(db, "w.other@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd)
    assert send_tor(client, inq.id, bd).status_code == 200
    return bd, head, eng, other, inq


def _new_task(client, inq, head, eng, due=None, **extra):
    due = due or (date.today() + timedelta(days=3))
    return client.post(f"{WORK}/inquiry/{inq.id}/tasks",
                       data={"title": "Feasibility check", "assigned_to_id": str(eng.id), "due_date": due.isoformat(), **extra},
                       headers=auth(head))


def test_settings_rules(client, db):
    head = make_user(db, "s.head@premnathrail.com", apps=("rnd",))
    member = make_user(db, "s.member@premnathrail.com", apps=("rnd",))
    no_rnd = make_user(db, "s.crm@premnathrail.com")
    make_rnd_head(db, head)
    url = f"{RND}/settings"
    resp = client.put(url, json={"creator_ids": [no_rnd.id]}, headers=auth(head))
    assert resp.status_code == 400 and "no access to the R&D module" in resp.json()["detail"]
    # Not a head → can't change who creates or sees Technical Offers.
    resp = client.put(url, json={"creator_ids": [member.id]}, headers=auth(member))
    assert resp.status_code == 403 and "Only the R&D head" in resp.json()["detail"]
    body = client.get(url, headers=auth(head)).json()
    assert [h["user_id"] for h in body["heads"]] == [head.id] and body["can_edit"] is True


def test_new_requirement_goes_to_head_only(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    notified = {n.user_id for n in db.query(Notification).filter(Notification.notification_type == "rnd_request_assigned").all()}
    assert notified == {head.id}
    assert [r["record_id"] for r in client.get(f"{RND}/requirements", headers=auth(head)).json()] == [inq.id]
    assert client.get(f"{RND}/requirements", headers=auth(eng)).json() == []
    resp = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng))
    assert resp.status_code == 403 and "Access tab" in resp.json()["detail"]
    resp = client.get(f"/api/v1/requirement-discussion/inquiry/{inq.id}", params={"side": "rnd"}, headers=auth(eng))
    assert resp.status_code == 403


def test_head_grants_access_rights_separately(client, db, tor_env, monkeypatch):
    bd, head, eng, other, inq = _setup(client, db)
    url = f"{WORK}/inquiry/{inq.id}/access"
    assert client.put(url, json={"rows": [{"user_id": eng.id, "can_view": True}]}, headers=auth(eng)).status_code == 403
    resp = client.put(url, json={"rows": [{"user_id": eng.id, "can_view": False, "can_download": True}]}, headers=auth(head))
    assert resp.status_code == 400 and "tick View too" in resp.json()["detail"]
    resp = client.put(url, json={"rows": [{"user_id": eng.id, "can_view": True}]}, headers=auth(head))
    assert resp.status_code == 200, resp.text

    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng))
    assert detail.status_code == 200
    assert detail.json()["my_access"] == {"view": True, "download": False, "upload": False, "respond": False, "is_head": False, "create_technical_offer": False, "departments": ["rnd"]}

    # View only: the sent TOR PDF can't be opened, upload and respond are refused.
    async def fake_download(site, path):
        return b"%PDF", "application/pdf"
    monkeypatch.setattr(work_routes, "download_file_content", fake_download)
    tor = db.query(CrmDocument).filter(CrmDocument.related_id == inq.id, CrmDocument.shared_via_tor == True).first()  # noqa: E712
    assert client.get(f"{WORK}/documents/{tor.id}/content", headers=auth(eng)).status_code == 403
    assert client.get(f"{WORK}/documents/{tor.id}/content", headers=auth(head)).status_code == 200
    req_id = detail.json()["movements"][-1]["rnd_request"]["id"]
    resp = client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(eng))
    assert resp.status_code == 403 and "respond to CRM" in resp.json()["detail"]

    client.put(url, json={"rows": [{"user_id": eng.id, "can_view": True, "can_download": True, "can_respond": True}]}, headers=auth(head))
    assert client.get(f"{WORK}/documents/{tor.id}/content", headers=auth(eng)).status_code == 200
    assert client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(eng)).status_code == 200
    # Removing the row takes the access away again.
    client.put(url, json={"rows": []}, headers=auth(head))
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng)).status_code == 403


def test_task_flow_create_complete_reopen(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    assert _new_task(client, inq, eng, other).status_code == 403  # only the head creates tasks
    resp = _new_task(client, inq, head, eng, due=date.today() - timedelta(days=1))
    assert resp.status_code == 422 and "in the past" in resp.json()["detail"]
    resp = _new_task(client, inq, head, eng, remarks="Check axle load")
    assert resp.status_code == 200, resp.text
    task = resp.json()
    assert task["status"] == "open" and task["assigned_to"] == "w.eng"

    # The assignee can now open the requirement and sees only their own task.
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng)).status_code == 200
    assert [t["id"] for t in client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(eng)).json()] == [task["id"]]
    assert [t["id"] for t in client.get(f"{WORK}/tasks/mine", headers=auth(eng)).json()] == [task["id"]]

    # The assignee completes the task themselves — no approve & close step.
    done = f"{WORK}/tasks/{task['id']}/complete"
    assert client.post(done, data={"remarks": "done"}, headers=auth(other)).status_code == 403
    assert client.post(done, data={"remarks": "  "}, headers=auth(eng)).status_code == 422
    resp = client.post(done, data={"remarks": "Load OK, drawing attached"}, headers=auth(eng))
    assert resp.status_code == 200 and resp.json()["status"] == "closed"
    assert client.post(f"{WORK}/tasks/{task['id']}/close", json={}, headers=auth(head)).status_code in (404, 405)

    # Whoever gave the task can reopen a completed one with a reason.
    resp = client.post(f"{WORK}/tasks/{task['id']}/reopen", json={"remarks": ""}, headers=auth(head))
    assert resp.status_code == 422
    resp = client.post(f"{WORK}/tasks/{task['id']}/reopen", json={"remarks": "Add brake calc"}, headers=auth(head))
    assert resp.status_code == 200 and resp.json()["status"] == "open"
    assert client.post(done, data={"remarks": "Brake calc added"}, headers=auth(eng)).status_code == 200
    assert [e["action"] for e in client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(head)).json()[0]["events"]] == ["created", "completed", "reopened", "completed"]


def test_ask_for_approval_keeps_task_open(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task_id = _new_task(client, inq, head, eng).json()["id"]
    ask = f"{WORK}/tasks/{task_id}/approvals"
    assert client.post(ask, data={"request": "Use EN8 for axle"}, headers=auth(head)).status_code == 403  # only the assignee asks
    assert client.post(ask, data={"request": " "}, headers=auth(eng)).status_code == 422
    resp = client.post(ask, data={"request": "Use EN8 for axle"}, headers=auth(eng))
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status"] == "open" and out["pending_approval"] is True
    approval_id = out["approvals"][0]["id"]
    assert db.query(Notification).filter(Notification.notification_type == "rnd_task_approval_requested", Notification.user_id == head.id).count() == 1

    # One pending request at a time, and the task can't be completed while it waits.
    assert client.post(ask, data={"request": "Another"}, headers=auth(eng)).status_code == 409
    resp = client.post(f"{WORK}/tasks/{task_id}/complete", data={"remarks": "done"}, headers=auth(eng))
    assert resp.status_code == 409 and "waiting for a decision" in resp.json()["detail"]

    decide = f"{WORK}/approvals/{approval_id}/decide"
    assert client.post(decide, json={"decision": "approve"}, headers=auth(other)).status_code == 403
    resp = client.post(decide, json={"decision": "reject"}, headers=auth(head))
    assert resp.status_code == 422 and "why you reject" in resp.json()["detail"]
    resp = client.post(decide, json={"decision": "reject", "remarks": "Use EN24"}, headers=auth(head))
    assert resp.status_code == 200
    out = resp.json()
    assert out["status"] == "open" and out["pending_approval"] is False
    assert out["approvals"][0]["status"] == "rejected" and out["approvals"][0]["decision_remarks"] == "Use EN24"

    # Ask again, withdraw it, ask again and get it approved — then complete.
    second = client.post(ask, data={"request": "Use EN24 for axle"}, headers=auth(eng)).json()["approvals"][-1]["id"]
    assert client.post(f"{WORK}/approvals/{second}/withdraw", headers=auth(head)).status_code == 403
    assert client.post(f"{WORK}/approvals/{second}/withdraw", headers=auth(eng)).json()["approvals"][-1]["status"] == "withdrawn"
    third = client.post(ask, data={"request": "Use EN24 for axle"}, headers=auth(eng)).json()["approvals"][-1]["id"]
    assert client.post(f"{WORK}/approvals/{third}/decide", json={"decision": "approve"}, headers=auth(head)).json()["approvals"][-1]["status"] == "approved"
    assert client.post(f"{WORK}/tasks/{task_id}/complete", data={"remarks": "Done with EN24"}, headers=auth(eng)).json()["status"] == "closed"


def test_overdue_task_needs_reason_and_new_date(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task_id = _new_task(client, inq, head, eng).json()["id"]
    t = db.get(RndRequirementTask, task_id)
    t.due_date = date.today() - timedelta(days=2)
    db.commit()

    resp = client.post(f"{WORK}/tasks/{task_id}/complete", data={"remarks": "done"}, headers=auth(eng))
    assert resp.status_code == 422 and "reason for the delay" in resp.json()["detail"]

    ext = f"{WORK}/tasks/{task_id}/extend"
    new_due = (date.today() + timedelta(days=4)).isoformat()
    assert client.post(ext, data={"reason": "", "new_due_date": new_due}, headers=auth(eng)).status_code == 422
    resp = client.post(ext, data={"reason": "x", "new_due_date": (date.today() - timedelta(days=1)).isoformat()}, headers=auth(eng))
    assert resp.status_code == 422 and "in the past" in resp.json()["detail"]
    resp = client.post(ext, data={"reason": "Waiting for RDSO drawing", "new_due_date": new_due}, headers=auth(eng))
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["due_date"] == new_due and out["is_overdue"] is False and out["extensions"] == 1
    assert out["original_due_date"] != new_due
    ev = db.query(RndTaskEvent).filter(RndTaskEvent.task_id == task_id, RndTaskEvent.action == "extended").one()
    assert ev.remarks == "Waiting for RDSO drawing" and ev.new_due_date.isoformat() == new_due
    assert db.query(Notification).filter(Notification.notification_type == "rnd_task_extended", Notification.user_id == head.id).count() == 1


def test_cancelled_task_removes_auto_view(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task_id = _new_task(client, inq, head, eng).json()["id"]
    resp = client.post(f"{WORK}/tasks/{task_id}/cancel", json={"remarks": "Not needed"}, headers=auth(head))
    assert resp.status_code == 200 and resp.json()["status"] == "cancelled"
    # The access row the task added (view + download) stays until the head removes it.
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng)).status_code == 200
    client.put(f"{WORK}/inquiry/{inq.id}/access", json={"rows": []}, headers=auth(head))
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(eng)).status_code == 403


def test_head_links_existing_project(client, db, tor_env):
    from app.modules.rnd.models.project import RndProject
    bd, head, eng, other, inq = _setup(client, db)
    proj = RndProject(project_number="RND-2026-0901", title="Wagon prototype", objective="Build it", lead_ids=[head.id], lead_id=head.id, team_member_ids=[])
    gone = RndProject(project_number="RND-2026-0902", title="Old", objective="x", status="cancelled", lead_ids=[], team_member_ids=[])
    db.add_all([proj, gone])
    db.commit()
    url = f"{WORK}/inquiry/{inq.id}/projects"

    assert client.post(url, json={"project_id": proj.id}, headers=auth(eng)).status_code == 403  # only the head links
    options = client.get(f"{WORK}/inquiry/{inq.id}/linkable-projects", headers=auth(head)).json()
    assert [p["project_number"] for p in options] == ["RND-2026-0901"]  # cancelled ones aren't offered
    assert client.post(url, json={"project_id": gone.id}, headers=auth(head)).status_code == 409

    resp = client.post(url, json={"project_id": proj.id}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    assert [p["project_number"] for p in resp.json()] == ["RND-2026-0901"]
    assert client.post(url, json={"project_id": proj.id}, headers=auth(head)).status_code == 409
    assert client.get(f"{WORK}/inquiry/{inq.id}/linkable-projects", headers=auth(head)).json() == []

    # The project shows the requirement it serves.
    detail = client.get(f"{RND}/projects/{proj.id}", headers=auth(head)).json()
    assert [r["ref"] for r in detail["linked_requirements"]] == ["TOR-20261007-0001"]

    assert client.delete(f"{url}/{proj.id}", headers=auth(head)).json() == []


def test_cancel_withdraws_pending_approval_and_blocks_decision(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task_id = _new_task(client, inq, head, eng).json()["id"]
    approval_id = client.post(f"{WORK}/tasks/{task_id}/approvals", data={"request": "Use EN8"}, headers=auth(eng)).json()["approvals"][0]["id"]
    out = client.post(f"{WORK}/tasks/{task_id}/cancel", json={"remarks": "Customer dropped it"}, headers=auth(head)).json()
    assert out["status"] == "cancelled" and out["pending_approval"] is False
    assert out["approvals"][0]["status"] == "withdrawn"
    resp = client.post(f"{WORK}/approvals/{approval_id}/decide", json={"decision": "approve"}, headers=auth(head))
    assert resp.status_code == 409


def test_subtask_cannot_reopen_under_closed_main_task(client, db, tor_env):
    bd, head, eng, other, inq = _setup(client, db)
    task_id = _new_task(client, inq, head, eng).json()["id"]
    resp = client.post(f"{WORK}/tasks/{task_id}/subtasks", data={
        "title": "Brake calc", "assigned_to_id": str(other.id), "due_date": (date.today() + timedelta(days=2)).isoformat(),
    }, headers=auth(eng))
    assert resp.status_code == 200, resp.text
    sub_id = resp.json()["id"]
    # The main task can't be pulled in before its open sub-task.
    resp = client.patch(f"{WORK}/tasks/{task_id}", json={"due_date": (date.today() + timedelta(days=1)).isoformat()}, headers=auth(head))
    assert resp.status_code == 422 and "Brake calc" in resp.json()["detail"]
    assert client.post(f"{WORK}/tasks/{sub_id}/complete", data={"remarks": "done"}, headers=auth(other)).status_code == 200
    assert client.post(f"{WORK}/tasks/{task_id}/complete", data={"remarks": "done"}, headers=auth(eng)).status_code == 200
    resp = client.post(f"{WORK}/tasks/{sub_id}/reopen", json={"remarks": "Redo"}, headers=auth(eng))
    assert resp.status_code == 409 and "reopen the main task first" in resp.json()["detail"]
    assert client.post(f"{WORK}/tasks/{task_id}/reopen", json={"remarks": "More work"}, headers=auth(head)).status_code == 200
    assert client.post(f"{WORK}/tasks/{sub_id}/reopen", json={"remarks": "Redo"}, headers=auth(eng)).status_code == 200
