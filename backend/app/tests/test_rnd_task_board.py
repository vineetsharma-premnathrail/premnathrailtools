"""R&D Tasks board (R&D rework 2026-10-30): Create Task by type, the list and analytics (one scoped,
filtered set — tiles add up, cancelled excluded, project progress), and who sees which tasks."""
from datetime import date, timedelta

from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.tests.test_cov_crm_quotations_rnd import auth, make_user, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_intake import _accept, _setup

RND = "/api/v1/rnd"
BOARD = f"{RND}/tasks"


def _due(days=5):
    return (date.today() + timedelta(days=days)).isoformat()


def _env(client, db):
    bd, head, member, inq = _setup(client, db)
    other = make_user(db, "tb.other@premnathrail.com", apps=("rnd",))
    assert _accept(client, inq, head).status_code == 200
    project = RndProject(project_number="RND-2026-0801", title="Wagon prototype", objective="Build", lead_id=head.id,
                         lead_ids=[head.id], team_member_ids=[member.id, other.id])
    db.add(project)
    db.commit()
    return bd, head, member, other, inq, project


def _create(client, who, **fields):
    data = {"title": "A task", "assigned_to_id": str(fields.pop("assignee").id), "due_date": _due(), **fields}
    return client.post(BOARD, data=data, headers=auth(who))


def _req_task(client, inq, who, assignee, **extra):
    return _create(client, who, type="requirement", source="inquiry", record_id=str(inq.id), assignee=assignee, **extra)


def _proj_task(client, project, who, assignee, **extra):
    return _create(client, who, type="prototype", rnd_project_id=str(project.id), assignee=assignee, **extra)


# ── Create Task ───────────────────────────────────────────────────────────

def test_create_task_by_type(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    resp = _req_task(client, inq, head, member, remarks="Check the axle load", priority="Urgent")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "requirement" and body["priority"] == "urgent" and body["remarks"] == "Check the axle load"
    assert body["revision_no"] == 0
    resp = _proj_task(client, project, head, member, checklist='["Draw", "Check"]')
    assert resp.status_code == 200, resp.text
    assert resp.json()["type"] == "prototype" and resp.json()["progress_from_checklist"] is True
    assert db.query(RndRequirementTask).count() == 1 and db.query(RndProjectTask).count() == 1


def test_create_task_refusals(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    resp = _create(client, head, assignee=member)
    assert resp.status_code == 422 and "Pick the task type first" in resp.json()["detail"]
    resp = _create(client, head, assignee=member, type="requirement")
    assert resp.status_code == 422 and "Pick the requirement" in resp.json()["detail"]
    resp = _create(client, head, assignee=member, type="prototype")
    assert resp.status_code == 422 and "Prototype / Research project" in resp.json()["detail"]
    resp = _req_task(client, inq, head, member, due_date=(date.today() - timedelta(days=1)).isoformat())
    assert resp.status_code == 422 and "in the past" in resp.json()["detail"]
    resp = _req_task(client, inq, head, member, start_date=_due(9))
    assert resp.status_code == 422 and "after the due date" in resp.json()["detail"]
    resp = _req_task(client, inq, head, member, priority="high")
    assert resp.status_code == 422 and resp.json()["detail"] == "Priority must be Standard or Urgent."
    # Without rnd:tasks:create (AC-49): view only is not enough, and BD has no R&D access at all.
    viewer = make_user(db, "tb.viewer@premnathrail.com", apps=())
    viewer.granular_permissions = ["rnd:tasks:view", "rnd:requirements:view"]
    db.commit()
    resp = _req_task(client, inq, viewer, member)
    assert resp.status_code == 403 and "R&D Tasks" in resp.json()["detail"]
    assert _req_task(client, inq, bd, member).status_code == 403
    assert db.query(RndRequirementTask).count() == 0


def test_requirement_task_needs_accepted_requirement_project_task_needs_a_lead(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    # A member who is not a lead of the project can't give project tasks.
    resp = _proj_task(client, project, member, other)
    assert resp.status_code == 403 and "project lead" in resp.json()["detail"]
    # A requirement that is not accepted any more (BD re-sent) can't get tasks.
    from app.tests.test_cov_crm_quotations_rnd import send_tor
    inq.product = "Changed"
    inq.product_spec = "BG 1676, revised"  # a re-send needs a changed Customer Requirement
    db.commit()
    send_tor(client, inq.id, bd)
    resp = _req_task(client, inq, head, member)
    assert resp.status_code == 409 and resp.json()["detail"].startswith("Accept the requirement first")
    # The Requirement picker lists only accepted requirements the user can open.
    assert client.get(f"{BOARD}/requirement-options", headers=auth(head)).json() == []
    _accept(client, inq, head)
    opts = client.get(f"{BOARD}/requirement-options", headers=auth(head)).json()
    assert [o["record_id"] for o in opts] == [inq.id] and opts[0]["rd_number"] in opts[0]["label"]
    assert [p["project_number"] for p in client.get(f"{BOARD}/project-options", headers=auth(head)).json()] == ["RND-2026-0801"]
    assert client.get(f"{BOARD}/project-options", headers=auth(member)).json() == []   # not a lead


def test_assignees_follow_the_chosen_record(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    resp = client.get(f"{BOARD}/assignees", params={"type": "requirement"}, headers=auth(head))
    assert resp.status_code == 422 and "Pick the requirement first" in resp.json()["detail"]
    people = client.get(f"{BOARD}/assignees", params={"type": "requirement", "source": "inquiry", "record_id": inq.id}, headers=auth(head)).json()
    assert member.id in {p["id"] for p in people}
    team = client.get(f"{BOARD}/assignees", params={"type": "prototype", "rnd_project_id": project.id}, headers=auth(head)).json()
    assert {p["id"] for p in team} == {member.id, other.id}


# ── list + analytics ──────────────────────────────────────────────────────

def _seed(client, db, head, member, other, inq, project):
    """member: requirement task (open, 50%), project tasks 100 / cancelled; other: overdue project task."""
    a = _req_task(client, inq, head, member).json()
    b = _proj_task(client, project, head, member).json()
    c = _proj_task(client, project, head, member).json()
    d = _proj_task(client, project, head, other, priority="urgent").json()
    e = _proj_task(client, project, head, other).json()
    db.get(RndRequirementTask, a["id"]).progress_percent = 50
    t = db.get(RndProjectTask, b["id"])
    t.status, t.progress_percent = "closed", 100
    db.get(RndProjectTask, c["id"]).status = "cancelled"
    db.get(RndProjectTask, d["id"]).due_date = date.today() - timedelta(days=3)
    db.get(RndProjectTask, e["id"]).progress_percent = 50
    db.commit()
    return a, b, c, d, e


def test_analytics_tiles_add_up_and_cancelled_is_excluded(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    _seed(client, db, head, member, other, inq, project)
    out = client.get(f"{BOARD}/analytics", headers=auth(head)).json()
    t = out["totals"]
    assert (t["total"], t["completed"], t["overdue"], t["pending"]) == (4, 1, 1, 2)
    assert t["pending"] + t["completed"] + t["overdue"] == t["total"]
    assert t["avg_progress"] == 50.0                                   # (50 + 100 + 0 + 50) / 4
    proj = next(g for g in out["by_project"] if g["kind"] == "project")
    assert proj["ref"] == "RND-2026-0801" and (proj["total"], proj["progress"]) == (3, 50.0) and proj["id_ref"]
    req = next(g for g in out["by_project"] if g["kind"] == "requirement")
    assert req["source"] == "inquiry" and req["record_id_ref"] and req["ref"].startswith("RDR-")
    people = {g["name"]: g for g in out["by_user"]}
    assert people["tb.other"]["overdue"] == 1 and people["i.member"]["completed"] == 1
    assert out["scope"] == "all"


def test_project_progress_ignores_cancelled_tasks(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    ids = [_proj_task(client, project, head, member).json()["id"] for _ in range(3)]
    done, half, gone = (db.get(RndProjectTask, i) for i in ids)
    done.status, done.progress_percent = "closed", 100
    half.progress_percent = 50
    gone.status = "cancelled"
    db.commit()
    out = client.get(f"{BOARD}/analytics", headers=auth(head)).json()
    assert out["by_project"][0]["progress"] == 75.0 and out["by_project"][0]["total"] == 2


def test_scope_mine_unless_head_or_analytics_grant(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    _seed(client, db, head, member, other, inq, project)
    mine = client.get(BOARD, headers=auth(other)).json()
    assert {r["assignee"]["id"] for r in mine["items"]} == {other.id} and mine["total"] == 2
    assert client.get(f"{BOARD}/analytics", headers=auth(other)).json()["scope"] == "mine"
    assert client.get(f"{BOARD}/analytics", headers=auth(other)).json()["totals"]["total"] == 2
    assert client.get(BOARD, headers=auth(head)).json()["total"] == 4
    # The analytics feature widens to every task (AC-55).
    other.granular_permissions = ["rnd:tasks.analytics:view"]
    db.commit()
    assert client.get(BOARD, headers=auth(other)).json()["total"] == 4
    # member holds a requirement task and a completed project task (the cancelled one is hidden unless asked for).
    assert client.get(BOARD, headers=auth(member)).json()["total"] == 2
    assert client.get(BOARD, params={"status": "cancelled"}, headers=auth(member)).json()["total"] == 1
    # No R&D access at all.
    assert client.get(BOARD, headers=auth(bd)).status_code == 403


def test_list_order_filters_and_row_shape(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    a, b, c, d, e = _seed(client, db, head, member, other, inq, project)
    rows = client.get(BOARD, headers=auth(head)).json()["items"]
    refs = [r["parent"]["ref"] for r in rows]
    assert refs == sorted(refs)                                          # parent reference ascending
    assert [r["id"] for r in rows if r["type"] == "prototype"] == sorted(r["id"] for r in rows if r["type"] == "prototype")
    row = next(r for r in rows if r["type"] == "requirement")
    assert {"key", "id", "type", "title", "parent", "assignee", "creator", "priority", "status", "work_status", "progress_percent",
            "progress_from_checklist", "start_date", "due_date", "closed_at", "days_overdue", "requirement_changed"} <= set(row)
    assert row["parent"]["source"] == "inquiry" and row["parent"]["record_id_ref"] and row["assignee"]["name"] == "i.member"
    overdue = next(r for r in rows if r["id"] == d["id"])
    assert overdue["days_overdue"] == 3 and overdue["bucket"] == "overdue"

    def ids(**params):
        return sorted(r["id"] for r in client.get(BOARD, params=params, headers=auth(head)).json()["items"])

    assert ids(type="requirement") == [a["id"]]
    assert ids(status="overdue") == [d["id"]]
    assert ids(status="cancelled") == [c["id"]]
    assert ids(status="closed") == [b["id"]]
    assert ids(priority="urgent") == [d["id"]]
    assert ids(progress_band="100") == [b["id"]]
    assert ids(progress_band="50-99") == sorted([a["id"], e["id"]])
    assert ids(assigned_to_id=other.id, type="prototype") == sorted([d["id"], e["id"]])
    assert ids(rnd_project_id=project.id, status="pending") == [e["id"]]
    assert ids(due_to=(date.today() - timedelta(days=1)).isoformat()) == [d["id"]]
    assert client.get(BOARD, params={"status": "weird"}, headers=auth(head)).status_code == 422
    assert client.get(BOARD, params={"priority": "high"}, headers=auth(head)).status_code == 422
    assert client.get(BOARD, params={"page": 2, "page_size": 2}, headers=auth(head)).json()["total"] == 4
    # Filters apply to the analytics too.
    out = client.get(f"{BOARD}/analytics", params={"assigned_to_id": other.id}, headers=auth(head)).json()
    assert out["totals"]["total"] == 2 and [g["name"] for g in out["by_user"]] == ["tb.other"]
    opts = client.get(f"{BOARD}/filter-options", headers=auth(head)).json()
    assert {p["name"] for p in opts["people"]} == {"i.member", "tb.other"} and [p["ref"] for p in opts["projects"]] == ["RND-2026-0801"]


def test_department_comes_from_the_assignees_user_record(client, db, tor_env):
    bd, head, member, other, inq, project = _env(client, db)
    member.department = "Design"
    db.commit()
    _proj_task(client, project, head, member)
    _proj_task(client, project, head, other)
    rows = client.get(BOARD, params={"department": "design"}, headers=auth(head)).json()["items"]
    assert [r["assignee"]["department"] for r in rows] == ["Design"]
