"""R&D rework 2026-10-30: requirement intake (R&D ID, revisions, accept / return and their gates),
visibility, document categories, the review reminder, and the Timeline.

Technical Offer upload and the R&D Tasks board have their own files
(test_rnd_technical_offers.py, test_rnd_task_board.py)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
from app.modules.rnd.routes import requirement_work as work_routes
from app.modules.rnd.tasks import review_reminders
from app.tests.test_cov_crm_quotations_rnd import auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import make_rnd_head

RND = "/api/v1/rnd"
WORK = f"{RND}/requirement-work"
CRM = "/api/v1/crm"
LONG_REASON = "The specification has no gauge and no axle load — add both."


def _setup(client, db):
    bd = make_user(db, "i.bd@premnathrail.com")
    head = make_user(db, "i.head@premnathrail.com", apps=("rnd",))
    member = make_user(db, "i.member@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd)
    assert send_tor(client, inq.id, bd).status_code == 200
    return bd, head, member, inq


def _req(db, inq) -> RndRequirement:
    db.expire_all()
    return db.query(RndRequirement).filter(RndRequirement.source == "inquiry", RndRequirement.record_id == inq.id).one()


def _revs(db, inq) -> list[RndRequirementRevision]:
    db.expire_all()
    return db.query(RndRequirementRevision).filter(RndRequirementRevision.requirement_id == _req(db, inq).id).order_by(
        RndRequirementRevision.revision_no).all()


def _accept(client, inq, who, **body):
    return client.post(f"{RND}/requirements/inquiry/{inq.id}/accept", json=body, headers=auth(who))


def _return(client, inq, who, reason=LONG_REASON, **body):
    return client.post(f"{RND}/requirements/inquiry/{inq.id}/return", json={"reason": reason, **body}, headers=auth(who))


def _task(client, inq, who, assignee, **extra):
    due = (date.today() + timedelta(days=3)).isoformat()
    return client.post(f"{WORK}/inquiry/{inq.id}/tasks",
                       data={"title": "Check axle load", "assigned_to_id": str(assignee.id), "due_date": due, **extra}, headers=auth(who))


# ── R&D ID + revisions ────────────────────────────────────────────────────

def test_first_send_creates_rd_id_and_revision_r0(client, db, tor_env, monkeypatch):
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda user, title, message: teams.append(user.id))
    bd, head, member, inq = _setup(client, db)
    req = _req(db, inq)
    assert req.rd_number == f"RDR-{date.today().year}-0001" and req.status == "submitted" and req.current_revision == 0
    (rev,) = _revs(db, inq)
    assert rev.revision_code == f"{req.rd_number}-R0" and rev.status == "submitted" and rev.submitted_by_id == bd.id
    # Bell to the head with the R&D ID and the due date; the sender is not told; no Teams message (AC-17).
    bells = db.query(Notification).filter(Notification.notification_type == "rnd_request_assigned").all()
    assert {n.user_id for n in bells} == {head.id}
    assert all(rev.revision_code in n.message and "response due" in n.message for n in bells)
    assert bd.id not in {n.user_id for n in bells} and teams == []


def test_two_requirements_get_distinct_ascending_ids(client, db, tor_env):
    bd = make_user(db, "i2.bd@premnathrail.com")
    head = make_user(db, "i2.head@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    a = make_inquiry(db, bd, uid="INQ-20261007-0001")
    b = make_inquiry(db, bd, uid="INQ-20261007-0002")
    assert send_tor(client, a.id, bd).status_code == 200 and send_tor(client, b.id, bd).status_code == 200
    assert (_req(db, a).rd_number, _req(db, b).rd_number) == (f"RDR-{date.today().year}-0001", f"RDR-{date.today().year}-0002")
    rows = client.get(f"{RND}/requirements", headers=auth(head)).json()
    assert [r["rd_number"] for r in rows] == sorted(r["rd_number"] for r in rows)
    assert all(r["requirement_id"] and r["revision_code"].endswith("-R0") and r["needs_my_review"] for r in rows)


def test_resend_creates_next_revision_and_supersedes_unanswered(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    inq.product = "Rail cutter Mk2"
    db.commit()
    assert send_tor(client, inq.id, bd).status_code == 200
    r0, r1 = _revs(db, inq)
    assert (r0.status, r1.status, r1.revision_code.endswith("-R1")) == ("superseded", "submitted", True)
    assert r1.changed_fields == ["Product"] and _req(db, inq).current_revision == 1 and _req(db, inq).status == "submitted"
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(head)).json()
    assert detail["intake"]["rd_number"] == _req(db, inq).rd_number and detail["intake"]["revision_code"] == r1.revision_code
    assert [r["revision_no"] for r in detail["revisions"]] == [1, 0]
    assert detail["revisions"][0]["changes"] == [{"field": "product", "label": "Product", "old": "RRV", "new": "Rail cutter Mk2"}]
    assert detail["my_access"]["can_review"] is True


def test_resend_after_return_without_any_change_opens_a_revision(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _return(client, inq, head).status_code == 200
    assert send_tor(client, inq.id, bd).status_code == 200
    r0, r1 = _revs(db, inq)
    assert (r0.status, r1.status) == ("returned", "submitted") and r1.changed_fields is None


def test_resend_after_response_keeps_old_revision_responded(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    req_id = db.query(CrmRndRequest).one().id
    resp = client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "Feasible"}, headers=auth(head))
    assert resp.status_code == 200, resp.text
    assert [r.status for r in _revs(db, inq)] == ["responded"] and _req(db, inq).status == "responded"
    assert send_tor(client, inq.id, bd).status_code == 200
    assert [r.status for r in _revs(db, inq)] == ["responded", "submitted"]


def test_send_without_product_or_past_due_creates_nothing(client, db, tor_env):
    bd = make_user(db, "i3.bd@premnathrail.com")
    head = make_user(db, "i3.head@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd, product=None)
    resp = send_tor(client, inq.id, bd, draft=False)
    assert resp.status_code == 422 and "Product" in resp.json()["detail"]
    inq.product = "RRV"
    db.commit()
    resp = send_tor(client, inq.id, bd, due=date.today() - timedelta(days=2), draft=False)
    assert resp.status_code == 400 and "in the past" in resp.json()["detail"]
    assert db.query(RndRequirement).count() == 0 and db.query(RndRequirementRevision).count() == 0


# ── accept / return ───────────────────────────────────────────────────────

def test_accept_by_head_notifies_bd_and_writes_audit(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    resp = _accept(client, inq, head, remarks="Looks complete")
    assert resp.status_code == 200, resp.text
    assert resp.json()["intake"]["status"] == "accepted"
    rev = _revs(db, inq)[0]
    assert (rev.status, rev.reviewed_by_id, rev.review_remarks) == ("accepted", head.id, "Looks complete") and rev.reviewed_at
    n = db.query(Notification).filter(Notification.notification_type == "rnd_requirement_accepted").all()
    assert {x.user_id for x in n} == {bd.id} and n[0].entity_type == "rnd_req_inquiry" and n[0].entity_id == inq.id
    from app.modules.main.models.audit_log import AuditLog
    assert db.query(AuditLog).filter(AuditLog.action == "requirement_accepted", AuditLog.entity_id == inq.id).count() == 1
    # Twice is a 409, not a second accept.
    again = _accept(client, inq, head)
    assert again.status_code == 409 and "already accepted" in again.json()["detail"]


def test_review_needs_head_or_review_grant(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    for fn in (lambda: _accept(client, inq, member), lambda: _return(client, inq, member)):
        resp = fn()
        assert resp.status_code == 403
        assert "R&D head" in resp.json()["detail"] and "Role & Permissions" in resp.json()["detail"]
    assert _revs(db, inq)[0].status == "submitted"
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(member)).json()["my_access"]["can_review"] is False
    # BD (no R&D access at all) can't reach the review endpoints.
    assert _accept(client, inq, bd).status_code == 403
    # An explicit Review › Approve tick lets a non-head accept (Reject is separate).
    reviewer = make_user(db, "i.reviewer@premnathrail.com", apps=("rnd",))
    reviewer.granular_permissions = ["rnd:requirements.review:approve"]
    db.commit()
    assert _accept(client, inq, reviewer).status_code == 200
    assert _return(client, inq, reviewer).status_code == 403


def test_return_needs_a_real_reason_and_tells_bd(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    for reason in ("", "too short"):
        resp = _return(client, inq, head, reason=reason)
        assert resp.status_code == 422 and resp.json()["detail"] == "Enter the reason BD must fix (at least 10 characters)."
    assert _revs(db, inq)[0].status == "submitted"
    resp = _return(client, inq, head)
    assert resp.status_code == 200
    rev = _revs(db, inq)[0]
    assert (rev.status, rev.return_reason) == ("returned", LONG_REASON) and _req(db, inq).status == "returned"
    assert db.query(CrmRndRequest).one().status == "returned"
    n = db.query(Notification).filter(Notification.notification_type == "rnd_requirement_returned").all()
    assert {x.user_id for x in n} == {bd.id} and LONG_REASON in n[0].message
    # BD sees "Returned by R&D" with the reason, and can always re-send.
    bd_view = client.get(f"{CRM}/inquiries/{inq.id}/rnd-requirement", headers=auth(bd)).json()
    assert bd_view["status"] == "returned" and bd_view["return_reason"] == LONG_REASON and bd_view["can_resend"] is True
    assert bd_view["rd_number"] == _req(db, inq).rd_number and [r["revision_code"] for r in bd_view["revisions"]] == [rev.revision_code]
    moves = client.get(f"{CRM}/inquiries/{inq.id}/requirement-movements", headers=auth(bd)).json()
    assert moves[0]["rnd_request"]["review_status"] == "returned" and moves[0]["rnd_request"]["return_reason"] == LONG_REASON


def test_return_allowed_from_accepted_but_not_after_response(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    assert _return(client, inq, head).status_code == 200            # AC-11: the only clarification channel
    assert _revs(db, inq)[0].status == "returned"
    assert _return(client, inq, head).status_code == 409           # already returned

    inq2 = make_inquiry(db, bd, uid="INQ-20261007-0002")
    assert send_tor(client, inq2.id, bd).status_code == 200
    assert _accept(client, inq2, head).status_code == 200
    req_id = db.query(CrmRndRequest).filter(CrmRndRequest.record_id == inq2.id).one().id
    assert client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(head)).status_code == 200
    resp = _return(client, inq2, head)
    assert resp.status_code == 409 and resp.json()["detail"] == "Already answered — ask BD to re-send if it must change."


def test_old_revision_cannot_be_accepted(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert send_tor(client, inq.id, bd).status_code == 200
    resp = _accept(client, inq, head, revision_no=0)
    assert resp.status_code == 409 and resp.json()["detail"].startswith("R1 is newer")
    assert _accept(client, inq, head, revision_no=1).status_code == 200


# ── gates (AC-15) ─────────────────────────────────────────────────────────

def test_tasks_offers_and_response_wait_for_accept(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    req_id = db.query(CrmRndRequest).one().id
    for label, resp in (
        ("task", _task(client, inq, head, member)),
        ("respond", client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(head))),
        ("offer", client.post(f"{WORK}/inquiry/{inq.id}/technical-offers", data={"title": "T", "offer_date": date.today().isoformat()}, headers=auth(head))),
    ):
        assert resp.status_code == 409, (label, resp.text)
        assert resp.json()["detail"].startswith("Accept the requirement first (") and "-R0 is submitted" in resp.json()["detail"], label
    _return(client, inq, head)
    resp = _task(client, inq, head, member)
    assert resp.status_code == 409 and "is returned" in resp.json()["detail"]
    send_tor(client, inq.id, bd)
    assert _accept(client, inq, head).status_code == 200
    resp = _task(client, inq, head, member)
    assert resp.status_code == 200, resp.text
    assert resp.json()["revision_no"] == 1 and resp.json()["requirement_changed"] is False


def test_task_flags_requirement_changed_until_new_revision_accepted(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    _accept(client, inq, head)
    task = _task(client, inq, head, member).json()
    inq.product_spec = "BG 1676, 22.5 t axle load"
    db.commit()
    send_tor(client, inq.id, bd)
    rows = client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(head)).json()
    assert [(t["id"], t["requirement_changed"]) for t in rows] == [(task["id"], True)]
    # New tasks wait for the new revision to be accepted; existing ones are not blocked.
    assert _task(client, inq, head, member).status_code == 409
    done = client.post(f"{WORK}/tasks/{task['id']}/complete", data={"remarks": "done"}, headers=auth(member))
    assert done.status_code == 200
    _accept(client, inq, head)
    assert client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(head)).json()[0]["requirement_changed"] is False


# ── visibility (AC-20 / AC-21) ────────────────────────────────────────────

def test_rnd_side_sees_all_outsiders_only_their_tasks(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    designer = make_user(db, "i.design@premnathrail.com", apps=("design",))
    assert [r["record_id"] for r in client.get(f"{RND}/requirements", headers=auth(member)).json()] == [inq.id]
    # No R&D access and no task: nothing, and a clear 403 naming who to ask.
    assert client.get(f"{RND}/requirements", headers=auth(designer)).status_code == 403
    resp = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(designer))
    assert resp.status_code == 403 and "give you a task" in resp.json()["detail"]
    _accept(client, inq, head)
    assert _task(client, inq, head, designer).status_code == 200
    # With a task: sees the requirement (and only it), reads it, but can't upload, respond, accept or return.
    rows = client.get(f"{RND}/requirements", headers=auth(designer)).json()
    assert [r["record_id"] for r in rows] == [inq.id]
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(designer))
    assert detail.status_code == 200
    acc = detail.json()["my_access"]
    assert (acc["view"], acc["download"], acc["upload"], acc["respond"], acc["can_review"]) == (True, True, False, False, False)
    assert _accept(client, inq, designer).status_code == 403 and _return(client, inq, designer).status_code == 403
    up = client.post(f"{WORK}/inquiry/{inq.id}/documents", data={"category": "drawing"},
                     files={"files": ("d.pdf", b"%PDF-1", "application/pdf")}, headers=auth(designer))
    assert up.status_code == 403 and "outside R&D" in up.json()["detail"]
    other = make_inquiry(db, bd, uid="INQ-20261007-0002")
    send_tor(client, other.id, bd)
    assert client.get(f"{RND}/requirements/inquiry/{other.id}", headers=auth(designer)).status_code == 403
    # Their own task list shows only what they hold.
    assert [t["assigned_to_id"] for t in client.get(f"{WORK}/inquiry/{inq.id}/tasks", headers=auth(designer)).json()] == [designer.id]


def test_cancelled_task_takes_outsider_access_away(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    designer = make_user(db, "i.design2@premnathrail.com", apps=("design",))
    _accept(client, inq, head)
    task = _task(client, inq, head, designer).json()
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(designer)).status_code == 200
    resp = client.post(f"{WORK}/tasks/{task['id']}/cancel", json={"remarks": "Not needed any more"}, headers=auth(head))
    assert resp.status_code == 200
    assert client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(designer)).status_code == 403


def test_only_head_responds_to_crm(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    _accept(client, inq, head)
    req_id = db.query(CrmRndRequest).one().id
    resp = client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(member))
    assert resp.status_code == 403 and "R&D head" in resp.json()["detail"]
    assert client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "ok"}, headers=auth(head)).status_code == 200


# ── documents (AC-23) ─────────────────────────────────────────────────────

@pytest.fixture
def doc_env(monkeypatch):
    async def fake_upload(site, path, f):
        data = await f.read()
        return {"name": f.filename, "path": f"{path}/{f.filename}", "webUrl": "https://sp/x", "size": len(data)}
    monkeypatch.setattr(work_routes, "upload_file_to_sharepoint", fake_upload)


def _upload(client, inq, who, category=None, name="spec.pdf"):
    data = {"category": category} if category is not None else {}
    return client.post(f"{WORK}/inquiry/{inq.id}/documents", data=data, files={"files": (name, b"%PDF-1.4 x", "application/pdf")}, headers=auth(who))


def test_documents_need_a_category_and_can_be_filtered(client, db, tor_env, doc_env):
    bd, head, member, inq = _setup(client, db)
    resp = _upload(client, inq, member)
    assert resp.status_code == 422 and resp.json()["detail"].startswith("Pick a category")
    resp = _upload(client, inq, member, category="technical_offer")
    assert resp.status_code == 422 and "Technical Offer" in resp.json()["detail"]
    assert _upload(client, inq, member, category="nonsense").status_code == 422
    a = _upload(client, inq, member, category="drawing", name="ga.pdf")
    assert a.status_code == 200, a.text
    assert a.json()[0]["category"] == "drawing" and a.json()[0]["category_label"] == "Drawing" and a.json()[0]["can_change_category"] is True
    _upload(client, inq, member, category="calculation", name="calc.pdf")
    listed = client.get(f"{WORK}/inquiry/{inq.id}/documents", params={"category": "drawing"}, headers=auth(head)).json()
    assert [d["name"] for d in listed] == ["ga.pdf"]
    everything = client.get(f"{WORK}/inquiry/{inq.id}/all-documents", headers=auth(head)).json()
    assert {d["category_label"] for d in everything if d["group"] == "rnd"} == {"Drawing", "Calculation"}
    assert [c["key"] for c in client.get(f"{WORK}/document-categories", headers=auth(member)).json()] == [
        "customer_specification", "technical_specification", "reference_standard", "drawing", "calculation", "test_report", "datasheet", "other"]


def test_category_change_by_uploader_or_head_only(client, db, tor_env, doc_env):
    bd, head, member, inq = _setup(client, db)
    other = make_user(db, "i.other@premnathrail.com", apps=("rnd",))
    doc_id = _upload(client, inq, member, category="drawing").json()[0]["id"]
    url = f"{WORK}/documents/{doc_id}/category"
    resp = client.patch(url, json={"category": "datasheet"}, headers=auth(other))
    assert resp.status_code == 403 and "uploaded this file" in resp.json()["detail"]
    assert client.patch(url, json={"category": "technical_offer"}, headers=auth(member)).status_code == 422
    assert client.patch(url, json={"category": "datasheet"}, headers=auth(member)).json()["category"] == "datasheet"
    assert client.patch(url, json={"category": "test_report"}, headers=auth(head)).json()["category_label"] == "Test Report"


# ── Timeline ──────────────────────────────────────────────────────────────

def test_timeline_lists_revisions_with_changes_and_review(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    _return(client, inq, head)
    inq.product = "Rail cutter Mk2"
    db.commit()
    send_tor(client, inq.id, bd)
    _accept(client, inq, head)
    rows = client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(head)).json()
    kinds = [r["action"] for r in rows]
    assert kinds.count("requirement_submitted") == 2 and "requirement_returned" in kinds and "requirement_accepted" in kinds
    r1 = next(r for r in rows if r["kind"] == "revision" and r["revision_code"].endswith("-R1"))
    assert r1["changes"] == [{"field": "product", "label": "Product", "old": "RRV", "new": "Rail cutter Mk2"}]
    assert any(LONG_REASON in r["summary"] for r in rows)
    # Newest first.
    assert [r["performed_at"] for r in rows] == sorted((r["performed_at"] for r in rows), reverse=True)
    assert client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(bd)).status_code == 403


def test_hidden_customer_block_also_hides_snapshot_diff(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    inq.product = "Rail cutter Mk2"
    db.commit()
    send_tor(client, inq.id, bd)
    limited = make_user(db, "i.limited@premnathrail.com", apps=())
    limited.granular_permissions = ["rnd:requirements:view", "rnd:requirements.history:view", "rnd:requirements.crm_request:view"]
    db.commit()
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(limited)).json()
    assert "product_requirement" in detail["hidden_sections"]
    assert all(c["field"] != "product" for rev in detail["revisions"] for c in rev["changes"])
    rows = client.get(f"{WORK}/inquiry/{inq.id}/history", headers=auth(limited)).json()
    assert all(c["field"] != "product" for r in rows for c in r.get("changes", []))


# ── review reminder (AC-18) ───────────────────────────────────────────────

def test_review_reminder_after_two_working_days_then_every_three(client, db, tor_env, monkeypatch):
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda user, title, message: teams.append(user.id))
    bd, head, member, inq = _setup(client, db)
    rev = _revs(db, inq)[0]
    # Pin the send to a Monday so "2 working days" is Wednesday.
    monday = datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
    rev.submitted_at = monday
    db.commit()
    run = review_reminders.run_review_reminders
    assert run(db, monday + timedelta(days=1)) == 0                    # Tuesday: 1 working day
    assert run(db, monday + timedelta(days=2)) == 1                    # Wednesday: 2 working days
    db.commit()
    got = db.query(Notification).filter(Notification.notification_type == "rnd_review_reminder").all()
    assert {n.user_id for n in got} == {head.id} and got[0].entity_type == "rnd_req_inquiry" and got[0].entity_id == inq.id
    assert teams == [head.id]
    assert run(db, monday + timedelta(days=4)) == 0                    # Friday: only 2 days since the last reminder
    assert run(db, monday + timedelta(days=5)) == 1                    # three days later
    # Accepted or returned revisions get none.
    _accept(client, inq, head)
    assert run(db, monday + timedelta(days=30)) == 0


def test_weekend_does_not_count(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    rev = _revs(db, inq)[0]
    friday = datetime(2026, 11, 6, 5, 0, tzinfo=timezone.utc)
    rev.submitted_at = friday
    db.commit()
    assert review_reminders.run_review_reminders(db, friday + timedelta(days=2)) == 0   # Sunday: still 0 working days
    assert review_reminders.run_review_reminders(db, friday + timedelta(days=4)) == 1   # Tuesday: Mon + Tue
