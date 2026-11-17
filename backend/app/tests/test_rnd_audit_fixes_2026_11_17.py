"""R&D workflow audit fixes (2026-11-17).

1. Task board: the page's "Completed" status filter ("completed") is an alias of "closed"; unknown values stay 422.
2. Task files on a Prototype / Research project open only to the task's people and the project's leads / admins.
3. Project list is ordered by project number ascending and pages; the board hides tasks of deleted records.
4. The engineer named on the current open CRM request may respond / close it, and the access flag agrees.
5. Return to BD is gone from the Role editor (no Reject on the Review feature) and from the review flags.
"""
from datetime import date, datetime, timedelta, timezone

from app.core import permission_registry as registry
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.tests.test_cov_crm_quotations_rnd import auth, make_user, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_intake import _accept, _setup

RND = "/api/v1/rnd"
BOARD = f"{RND}/tasks"


def _due(days=5):
    return date.today() + timedelta(days=days)


def _project(db, number, lead, members=(), **extra):
    p = RndProject(project_number=number, title=f"Project {number}", objective="Build", lead_id=lead.id,
                   lead_ids=[lead.id], team_member_ids=[m.id for m in members], **extra)
    db.add(p)
    db.commit()
    return p


def _project_task(db, project, creator, assignee, **extra):
    t = RndProjectTask(project_id=project.id, title="Draw the frame", assigned_to_id=assignee.id, created_by_id=creator.id,
                       original_due_date=_due(), due_date=_due(), **extra)
    db.add(t)
    db.commit()
    return t


# ── 1. board status alias ─────────────────────────────────────────────────

def test_completed_filter_is_closed_and_unknown_status_stays_422(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    project = _project(db, "RND-2026-0901", head, [member])
    open_task = _project_task(db, project, head, member)
    done = _project_task(db, project, head, member, status="closed", closed_at=datetime.now(timezone.utc))

    resp = client.get(BOARD, params={"status": "completed"}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    assert [r["id"] for r in resp.json()["items"]] == [done.id]
    same = client.get(BOARD, params={"status": "closed"}, headers=auth(head)).json()["items"]
    assert [r["id"] for r in same] == [done.id]
    # The analytics call the page makes with the same filter works too.
    assert client.get(f"{BOARD}/analytics", params={"status": "completed"}, headers=auth(head)).json()["totals"]["completed"] == 1
    assert open_task.id not in [r["id"] for r in resp.json()["items"]]

    bad = client.get(BOARD, params={"status": "finished"}, headers=auth(head))
    assert bad.status_code == 422 and "Status 'finished' isn't valid" in bad.json()["detail"]


def test_board_hides_tasks_of_deleted_records(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    due = _due().isoformat()
    resp = client.post(BOARD, data={"title": "Axle", "assigned_to_id": str(member.id), "due_date": due, "type": "requirement",
                                    "source": "inquiry", "record_id": str(inq.id)}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    project = _project(db, "RND-2026-0902", head, [member])
    _project_task(db, project, head, member)
    assert client.get(BOARD, headers=auth(head)).json()["total"] == 2

    inq.is_deleted = True
    project.is_deleted = True
    db.commit()
    assert client.get(BOARD, headers=auth(head)).json()["total"] == 0


# ── 2. task files on a Prototype / Research project ───────────────────────

def _open(client, doc, who):
    return client.get(f"{RND}/documents/{doc.id}/content", headers=auth(who))


def test_task_file_on_an_rnd_project_opens_only_for_the_tasks_people(client, db, tor_env, monkeypatch):
    from app.core.config import settings

    async def fake_download(site, path):
        return b"%PDF-1.4 test", "application/pdf"

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr("app.modules.rnd.routes.documents.download_file_content", fake_download)

    bd, head, member, inq = _setup(client, db)
    other = make_user(db, "af.other@premnathrail.com", apps=("rnd",))
    project = _project(db, "RND-2026-0903", head, [member, other])
    task = _project_task(db, project, head, member)
    sub = _project_task(db, project, head, other, parent_task_id=task.id)
    doc = RndDocument(project_id=project.id, task_id=task.id, task_doc_role="work", doc_type="other", title="frame.pdf", file_name="frame.pdf",
                      sharepoint_path="RnD/frame.pdf", uploaded_by_id=member.id, uploaded_by_name="member")
    db.add(doc)
    db.commit()

    assert _open(client, doc, member).status_code == 200          # the assignee
    assert _open(client, doc, head).status_code == 200            # creator + project lead
    # The holder of a sub-task does not see the main task (project_tasks._visible) — nor its files.
    assert _open(client, doc, other).status_code == 403
    # But the main task's holder sees the sub-task, so its files open for them.
    sub_doc = RndDocument(project_id=project.id, task_id=sub.id, task_doc_role="work", doc_type="other", title="sub.pdf", file_name="sub.pdf",
                          sharepoint_path="RnD/sub.pdf", uploaded_by_id=other.id, uploaded_by_name="other")
    db.add(sub_doc)
    db.commit()
    assert _open(client, sub_doc, member).status_code == 200
    assert _open(client, sub_doc, other).status_code == 200
    stranger = make_user(db, "af.stranger@premnathrail.com", apps=("rnd",))
    resp = _open(client, doc, stranger)
    assert resp.status_code == 403 and "isn't yours" in resp.json()["detail"] and "assignee" in resp.json()["detail"]
    assert _open(client, sub_doc, stranger).status_code == 403
    # An admin manages every project's files.
    admin = make_user(db, "af.admin@premnathrail.com", role="admin", apps=("rnd",))
    assert _open(client, doc, admin).status_code == 200


def test_task_files_never_appear_in_document_lists(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    project = _project(db, "RND-2026-0904", head, [member])
    task = _project_task(db, project, head, member)
    db.add_all([
        RndDocument(project_id=project.id, doc_type="other", title="Spec", file_name="spec.pdf", sharepoint_path="a"),
        RndDocument(project_id=project.id, task_id=task.id, doc_type="other", title="Task file", file_name="t.pdf", sharepoint_path="b"),
    ])
    db.commit()
    titles = [d["title"] for d in client.get(f"{RND}/documents", params={"project_id": project.id}, headers=auth(head)).json()]
    assert titles == ["Spec"]


def test_document_list_has_limit_offset_and_project_numbers(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    project = _project(db, "RND-2026-0905", head, [member])
    db.add_all(RndDocument(project_id=project.id, doc_type="other", title=f"Doc {i}", file_name=f"{i}.pdf", sharepoint_path=str(i)) for i in range(5))
    db.commit()
    page = client.get(f"{RND}/documents", params={"limit": 2, "offset": 1}, headers=auth(head)).json()
    assert [d["title"] for d in page] == ["Doc 3", "Doc 2"] and {d["project_number"] for d in page} == {"RND-2026-0905"}
    assert client.get(f"{RND}/documents", params={"limit": 5000}, headers=auth(head)).status_code == 422


# ── 3. project list order + paging ────────────────────────────────────────

def test_project_list_is_ordered_by_number_ascending_and_pages(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    # Created out of order on purpose.
    for number in ("RND-2026-0010", "RND-2026-0002", "RND-2026-0001", "RND-2026-0100"):
        _project(db, number, head, [member])
    rows = client.get(f"{RND}/projects", headers=auth(head))
    assert rows.status_code == 200, rows.text
    assert [p["project_number"] for p in rows.json()] == ["RND-2026-0001", "RND-2026-0002", "RND-2026-0010", "RND-2026-0100"]
    assert all(p["lead_name"] and p["team_members"] for p in rows.json())
    page = client.get(f"{RND}/projects", params={"limit": 2, "offset": 1}, headers=auth(head)).json()
    assert [p["project_number"] for p in page] == ["RND-2026-0002", "RND-2026-0010"]
    assert client.get(f"{RND}/projects", params={"limit": 0}, headers=auth(head)).status_code == 422


def test_project_list_does_not_query_per_project(client, db, tor_env):
    """The page's lookups (names, linked requirements, budgets, origin) are batched: more projects, same query count."""
    from sqlalchemy import event

    bd, head, member, inq = _setup(client, db)
    _project(db, "RND-2026-0201", head, [member])
    counts = []

    def count_for():
        n = [0]

        def before(*_a, **_k):
            n[0] += 1
        event.listen(db.get_bind(), "before_cursor_execute", before)
        try:
            assert client.get(f"{RND}/projects", headers=auth(head)).status_code == 200
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", before)
        return n[0]

    counts.append(count_for())
    for i in range(202, 212):
        _project(db, f"RND-2026-0{i}", head, [member])
    counts.append(count_for())
    assert counts[1] <= counts[0] + 1, counts


# ── 4. the engineer named on the open request may respond ─────────────────

def test_assigned_engineer_may_respond_and_flag_agrees(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    outsider = make_user(db, "af.outsider@premnathrail.com", apps=("rnd",))
    assert _accept(client, inq, head).status_code == 200
    crm_req = db.query(CrmRndRequest).one()
    crm_req.assigned_to_id = member.id        # older request that named an engineer
    db.commit()

    # Before the fix `respond` was head-only (or a legacy tick): the flag and the server now both say yes.
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(member)).json()
    assert detail["my_access"]["respond"] is True
    listing = client.get(f"{RND}/requirements", headers=auth(member)).json()
    row = next(r for r in (listing["items"] if isinstance(listing, dict) else listing) if r["record_id"] == inq.id)
    assert row["can_respond"] is True

    # Another R&D person who is not the head, a tick-holder or the named engineer: no.
    outsider_access = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(outsider))
    if outsider_access.status_code == 200:
        assert outsider_access.json()["my_access"]["respond"] is False
    resp = client.post(f"{RND}/requirements/requests/{crm_req.id}/respond", data={"remarks": "Feasible"}, headers=auth(outsider))
    assert resp.status_code == 403

    resp = client.post(f"{RND}/requirements/requests/{crm_req.id}/respond", data={"remarks": "Feasible with EN24"}, headers=auth(member))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "responded"
    # Answered: the request is no longer open, so the right is gone with it.
    db.expire_all()
    from app.modules.rnd.services import requirement_access as ra
    assert ra.is_assigned_engineer(db, member, "inquiry", inq.id) is False


def test_assigned_engineer_may_close_the_request(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    crm_req = db.query(CrmRndRequest).one()
    crm_req.assigned_to_id = member.id
    db.commit()
    resp = client.post(f"{RND}/requirements/requests/{crm_req.id}/close", json={"reason": "Nothing for R&D to deliver here"}, headers=auth(member))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "closed"


def test_unassigned_member_cannot_respond(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    crm_req = db.query(CrmRndRequest).one()
    assert crm_req.assigned_to_id is None
    resp = client.post(f"{RND}/requirements/requests/{crm_req.id}/respond", data={"remarks": "Feasible"}, headers=auth(member))
    assert resp.status_code == 403 and "R&D head" in resp.json()["detail"]


# ── 5. Return to BD is gone from the Role editor ──────────────────────────

def test_review_feature_has_no_reject_action():
    review = registry.MODULES["rnd"]["features"]["requirements"]["review"]
    assert review["actions"] == ["view", "approve"], review["actions"]
    assert "reject" not in review["inherit"] and "return" not in review["label"].lower()
    assert "rnd:requirements.review:reject" not in registry.all_permission_ids()


def test_can_review_depends_on_accept_only(client, db, tor_env):
    from app.modules.rnd.services import requirement_access as ra
    bd, head, member, inq = _setup(client, db)
    assert not hasattr(ra, "can_return")
    # A leftover 'Reject' grant on a role no longer makes anybody a reviewer.
    member.granular_permissions = ["rnd:requirements:view", "rnd:requirements.review:reject"]
    db.commit()
    body = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(member)).json()
    assert body["my_access"]["can_review"] is False and body["can_accept"] is False and "can_return" not in body
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(head)).json()["my_access"]["can_review"] is True


def test_requirement_task_still_listed_for_assignee_scope(client, db, tor_env):
    """Guard for the batched changed-flag: a task on a re-sent (unaccepted) revision is flagged, others are not."""
    from app.tests.test_cov_crm_quotations_rnd import send_tor
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    resp = client.post(BOARD, data={"title": "Axle", "assigned_to_id": str(member.id), "due_date": _due().isoformat(), "type": "requirement",
                                    "source": "inquiry", "record_id": str(inq.id)}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    assert client.get(BOARD, headers=auth(head)).json()["items"][0]["requirement_changed"] is False
    inq.product_spec = "BG 1676, revised"
    db.commit()
    assert send_tor(client, inq.id, bd).status_code == 200
    assert client.get(BOARD, headers=auth(head)).json()["items"][0]["requirement_changed"] is True
    assert db.query(RndRequirementTask).count() == 1
