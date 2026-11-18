"""R&D <-> BD (owner, 2026-11-17): R&D's question to BD pauses R&D's clock and BD answers it on the
same request; changing an inquiry's Customer Requirement after a send goes through "Change
requirement" (a new revision with a reason, or a same-revision correction before R&D accepts)."""
from datetime import date, timedelta

from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem
from app.modules.crm.models.rnd_request import CrmRndRequest, CrmRndRequestQuery
from app.modules.crm.services import requirement_movement
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.notification import Notification
from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
from app.tests.test_cov_crm_quotations_rnd import API, auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import make_rnd_head

RND = "/api/v1/rnd"
QUESTION = "Axle load and gauge are missing"
ANSWER = "Axle load is 22.5 t and gauge is 1676 mm."


def _setup(client, db):
    bd = make_user(db, "qc.bd@premnathrail.com")
    head = make_user(db, "qc.head@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd)
    assert send_tor(client, inq.id, bd).status_code == 200
    return bd, head, inq


def _accept(client, inq, who):
    resp = client.post(f"{RND}/requirements/inquiry/{inq.id}/accept", json={}, headers=auth(who))
    assert resp.status_code == 200, resp.text


def _crm_req(db, inq) -> CrmRndRequest:
    db.expire_all()
    return db.query(CrmRndRequest).filter(CrmRndRequest.source == "inquiry", CrmRndRequest.record_id == inq.id).order_by(
        CrmRndRequest.id.desc()).first()


def _revs(db, inq) -> list[RndRequirementRevision]:
    db.expire_all()
    req = db.query(RndRequirement).filter(RndRequirement.source == "inquiry", RndRequirement.record_id == inq.id).one()
    return db.query(RndRequirementRevision).filter(RndRequirementRevision.requirement_id == req.id).order_by(
        RndRequirementRevision.revision_no).all()


def _respond_url(db, inq) -> str:
    return f"{RND}/requirements/requests/{_crm_req(db, inq).id}/respond"


def _ask(client, db, inq, who, text=QUESTION):
    return client.post(_respond_url(db, inq), data={"remarks": text, "ask_details": "true"}, headers=auth(who))


def _due(days=7) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _answer(client, db, inq, who, query_id, **data):
    form = {"answer": ANSWER, "channel": "portal", "due_date": _due(), **data}
    form = {k: v for k, v in form.items() if v is not None}
    return client.post(f"{API}/rnd-requests/{_crm_req(db, inq).id}/queries/{query_id}/answer", data=form, headers=auth(who))


def _asked(client, db, inq, head):
    """Accepts, then R&D asks one question; returns its id."""
    _accept(client, inq, head)
    resp = _ask(client, db, inq, head)
    assert resp.status_code == 200, resp.text
    return resp.json()["queries"][0]["id"]


def _make_overdue(db, inq):
    crm = _crm_req(db, inq)
    crm.due_date = date.today() - timedelta(days=2)
    db.commit()


def _resend(client, inq, bd, **extra):
    return client.post(f"{API}/inquiries/{inq.id}/technical-offer-request",
                       json={"response_due_date": _due(5), **extra}, headers=auth(bd))


# ── 1. question pauses the clock ───────────────────────────────────────────

def test_question_pauses_rnd_clock_and_only_one_may_be_open(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    _accept(client, inq, head)
    _make_overdue(db, inq)
    rows = client.get(f"{RND}/requirements", headers=auth(head)).json()
    assert rows[0]["rnd_request"]["is_late"] is True and rows[0]["waiting_on_bd"] is False

    resp = _ask(client, db, inq, head)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Still open, but BD owes the answer: R&D is never overdue while waiting.
    assert body["status"] == "open" and body["waiting_on"] == "bd" and body["is_late"] is False
    (q,) = body["queries"]
    assert q["remarks"] == QUESTION and q["asked_by"] and q["answer"] is None and q["answered_side"] is None
    assert q["due_date_before"] == (date.today() - timedelta(days=2)).isoformat() and q["answer_documents"] == []

    rows = client.get(f"{RND}/requirements", headers=auth(head)).json()
    assert rows[0]["waiting_on_bd"] is True and rows[0]["rnd_request"]["is_late"] is False

    # The timeline still gets its audit row, and BD is told how to reply.
    audit = client.get(f"{API}/inquiries/{inq.id}/audit", headers=auth(bd)).json()
    assert any(a["action"] == "rnd_asked_details" and QUESTION in a["summary"] for a in audit)
    note = db.query(Notification).filter(Notification.notification_type == "rnd_request_details_asked").one()
    assert note.user_id == bd.id and QUESTION in note.message and "Reply to R&D on the R&D tab" in note.message
    assert "send it to R&D again" not in note.message

    again = _ask(client, db, inq, head, "Which track section is this for?")
    assert again.status_code == 409 and "has not answered" in again.json()["detail"] and QUESTION in again.json()["detail"]
    assert db.query(CrmRndRequestQuery).count() == 1


# ── 2. BD answers on the same request ──────────────────────────────────────

def test_bd_answer_sets_due_date_answers_the_question_and_tells_rnd(client, db, tor_env, monkeypatch):
    teams = []
    monkeypatch.setattr("app.utils.notifications._notify_teams", lambda user, title, message: teams.append(user.id))
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    _make_overdue(db, inq)
    new_due = _due(9)

    resp = _answer(client, db, inq, bd, qid, due_date=new_due, channel="phone")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "open" and body["waiting_on"] is None and body["due_date"] == new_due and body["is_late"] is False
    (q,) = body["queries"]
    assert (q["answer"], q["answer_channel"], q["answered_side"], q["due_date_after"]) == (ANSWER, "phone", "bd", new_due)
    assert q["answered_by"] and q["answered_at"] and q["due_date_before"] == _due(5)  # the due date when it was asked
    # Same request, no new revision.
    assert db.query(CrmRndRequest).count() == 1 and len(_revs(db, inq)) == 1

    told = db.query(Notification).filter(Notification.notification_type == "rnd_query_answered").all()
    assert {n.user_id for n in told} == {head.id} and ANSWER in told[0].message
    audit = client.get(f"{API}/inquiries/{inq.id}/audit", headers=auth(bd)).json()
    assert any(a["action"] == "rnd_query_answered" and "by phone" in a["summary"] for a in audit)

    # Answered once only.
    twice = _answer(client, db, inq, bd, qid)
    assert twice.status_code == 409 and "already answered" in twice.json()["detail"]
    # R&D can ask the next question now.
    assert _ask(client, db, inq, head, "Is the line electrified or not?").json()["waiting_on"] == "bd"


def test_bd_answer_validation_messages(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    cases = [
        ({"answer": "too short"}, "at least 10 characters"),
        ({"channel": "carrier-pigeon"}, "Portal, Phone, Email or Meeting"),
        ({"channel": None}, "Portal, Phone, Email or Meeting"),
        ({"due_date": None}, "new due date"),
        ({"due_date": (date.today() - timedelta(days=1)).isoformat()}, "in the past"),
        ({"due_date": "31/12/2026"}, "not a valid date"),
    ]
    for data, text in cases:
        resp = _answer(client, db, inq, bd, qid, **data)
        assert resp.status_code == 400 and text in resp.json()["detail"], (data, resp.text)
    assert _crm_req(db, inq).due_date != date.today()
    assert db.get(CrmRndRequestQuery, qid).answer is None


def test_bd_answer_ids_must_match_and_request_must_be_open(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    rid = _crm_req(db, inq).id
    base = f"{API}/rnd-requests"
    form = {"answer": ANSWER, "channel": "portal", "due_date": _due()}
    assert client.post(f"{base}/{rid + 99}/queries/{qid}/answer", data=form, headers=auth(bd)).status_code == 404
    other = client.post(f"{base}/{rid}/queries/{qid + 99}/answer", data=form, headers=auth(bd))
    assert other.status_code == 404 and "isn't on this request" in other.json()["detail"]
    # A question that belongs to another request can't be answered through this one.
    inq2 = make_inquiry(db, bd, uid="INQ-20261007-0002")
    assert send_tor(client, inq2.id, bd).status_code == 200
    _accept(client, inq2, head)
    q2 = _ask(client, db, inq2, head).json()["queries"][0]["id"]
    assert client.post(f"{base}/{rid}/queries/{q2}/answer", data=form, headers=auth(bd)).status_code == 404
    # Closed requests take no answer.
    crm = _crm_req(db, inq)
    crm.status = "closed"
    db.commit()
    closed = client.post(f"{base}/{rid}/queries/{qid}/answer", data=form, headers=auth(bd))
    assert closed.status_code == 409 and "closed" in closed.json()["detail"]


def test_bd_answer_permission_and_data_scope(client, db, tor_env, monkeypatch):
    from app.core.config import settings
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    # R&D has no CRM send right: denied before anything is read.
    assert _answer(client, db, inq, head, qid).status_code == 403
    # A CRM user outside the record's data scope (default scope = own + assigned) is refused too.
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    stranger = make_user(db, "qc.stranger@premnathrail.com")
    resp = _answer(client, db, inq, stranger, qid)
    assert resp.status_code == 403 and "outside your data access" in resp.json()["detail"]
    assert db.get(CrmRndRequestQuery, qid).answer is None
    assert _answer(client, db, inq, bd, qid).status_code == 200


def test_bd_answer_files_are_filed_with_the_question(client, db, tor_env, monkeypatch):
    from app.core.config import settings
    from app.modules.crm.models.document import CrmDocument
    from app.modules.crm.routes import rnd_requests as route

    async def fake_upload(site_id, folder, f):
        return {"name": f.filename, "path": f"{folder}/{f.filename}", "webUrl": "https://sp.example/x", "size": 4}

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(route, "upload_file_to_sharepoint", fake_upload)
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    rid = _crm_req(db, inq).id
    resp = client.post(
        f"{API}/rnd-requests/{rid}/queries/{qid}/answer",
        data={"answer": ANSWER, "channel": "email", "due_date": _due()},
        files=[("files", ("axle.pdf", b"data", "application/pdf"))], headers=auth(bd))
    assert resp.status_code == 200, resp.text
    assert [d["name"] for d in resp.json()["queries"][0]["answer_documents"]] == [f"q{qid}_axle.pdf"]
    doc = db.query(CrmDocument).filter(CrmDocument.related_sub_module == "rnd_query").one()
    assert (doc.related_module, doc.related_id, doc.related_sub_id, doc.shared_via_tor) == ("inquiry", inq.id, qid, True)


# ── 3. R&D's fallback: BD told R&D outside the portal ──────────────────────

def test_final_response_while_waiting_needs_how_bd_told_rnd(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    _make_overdue(db, inq)
    url = _respond_url(db, inq)

    no_fields = client.post(url, data={"remarks": "Feasible, offer follows"}, headers=auth(head))
    assert no_fields.status_code == 400 and "has not answered" in no_fields.json()["detail"] and "phone, email or in a meeting" in no_fields.json()["detail"]
    short = client.post(url, data={"remarks": "Feasible", "bd_told_channel": "phone", "bd_told_note": "ok"}, headers=auth(head))
    assert short.status_code == 400 and "at least 10 characters" in short.json()["detail"]
    bad_channel = client.post(url, data={"remarks": "Feasible", "bd_told_channel": "fax", "bd_told_note": "Axle load is 22 t"}, headers=auth(head))
    assert bad_channel.status_code == 400
    assert _crm_req(db, inq).status == "open"

    # Overdue, but R&D was waiting on BD: no delay reason is demanded.
    ok = client.post(url, data={"remarks": "Feasible, offer follows", "bd_told_channel": "phone", "bd_told_note": "BD said axle load is 22 t"}, headers=auth(head))
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["status"] == "responded" and body["delay_reason"] is None and body["is_late"] is False and body["waiting_on"] is None
    (q,) = body["queries"]
    assert (q["answer"], q["answer_channel"], q["answered_side"]) == ("BD said axle load is 22 t", "phone", "rnd")
    assert db.get(CrmRndRequestQuery, qid).answered_by_id == head.id


def test_final_response_without_a_question_ignores_bd_told_fields_and_keeps_late_rule(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    _accept(client, inq, head)
    _make_overdue(db, inq)
    resp = client.post(_respond_url(db, inq), data={"remarks": "Feasible"}, headers=auth(head))
    assert resp.status_code == 400 and "late" in resp.json()["detail"]


def test_is_late_is_false_while_waiting_flag_is_passed():
    class R:  # the rule alone: waiting_on_bd wins over an overdue open request
        status, responded_at, due_date = "open", None, date.today() - timedelta(days=3)
    assert requirement_movement.is_late(R) is True and requirement_movement.is_late(R, True) is False


# ── 4. re-send needs a reason ──────────────────────────────────────────────

def test_resend_needs_change_reason_and_stores_it_on_the_revision(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    inq.product_spec = "BG 1676, hydraulic braking"
    db.commit()
    missing = _resend(client, inq, bd)
    assert missing.status_code == 422 and "Say why" in missing.json()["detail"]
    short = _resend(client, inq, bd, change_reason="other", change_note="typo")
    assert short.status_code == 422 and "at least 10 characters" in short.json()["detail"]
    assert db.query(CrmRndRequest).count() == 1 and len(_revs(db, inq)) == 1

    ok = _resend(client, inq, bd, change_reason="customer_changed", change_note="Customer added hydraulic braking")
    assert ok.status_code == 200, ok.text
    r0, r1 = _revs(db, inq)
    assert (r0.change_reason, r1.change_reason, r1.change_note) == (None, "customer_changed", "Customer added hydraulic braking")
    msg = db.query(Notification).filter(Notification.notification_type == "rnd_request_assigned").order_by(Notification.id.desc()).first().message
    assert "Customer changed the requirement" in msg and "hydraulic braking" in msg
    assert "Customer changed the requirement" in tor_env[-1]["remarks"]
    audit = db.query(AuditLog).filter(AuditLog.action == "requirement_submitted").order_by(AuditLog.id.desc()).first()
    assert "Reason: Customer changed the requirement" in audit.summary
    # R&D's detail page and the CRM card both carry the reason.
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(head)).json()
    assert detail["revisions"][0]["change_reason"] == "customer_changed" and detail["revisions"][0]["corrected_at"] is None
    rows = client.get(f"{RND}/requirements", headers=auth(head)).json()
    assert rows[0]["new_revision"] is True
    moves = client.get(f"{API}/inquiries/{inq.id}/requirement-movements", headers=auth(bd)).json()
    assert moves[-1]["rnd_request"]["change_reason"] == "customer_changed"


def test_first_send_needs_no_reason(client, db, tor_env):
    bd, head, inq = _setup(client, db)  # _setup sent without any reason
    assert _revs(db, inq)[0].change_reason is None
    assert client.get(f"{RND}/requirements", headers=auth(head)).json()[0]["new_revision"] is False


# ── 5. the Customer Requirement is locked in Edit after a send ─────────────

def test_inquiry_edit_cannot_change_customer_requirement_after_send(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    url = f"{API}/inquiries/{inq.id}"
    blocked = client.patch(url, json={"product_spec": "BG 1676, changed"}, headers=auth(bd))
    assert blocked.status_code == 409
    detail = blocked.json()["detail"]
    assert "Customer Requirement was sent to R&D as RDR-" in detail and "Change requirement" in detail
    # The same text (also with different spacing) and every other field still save.
    same = client.patch(url, json={"product_spec": "BG  1676", "remarks": None, "project_details": "Northern zone"}, headers=auth(bd))
    assert same.status_code == 200, same.text
    other = client.patch(url, json={"project_details": "Northern zone, phase 2"}, headers=auth(bd))
    assert other.status_code == 200 and other.json()["project_details"] == "Northern zone, phase 2"
    # An additional product's specification is part of the Customer Requirement too.
    item = InquiryLineItem(inquiry_id=inq.id, sort_order=0, product="Jack", product_spec="Lift 20 t")
    db.add(item)
    db.commit()
    changed_item = client.patch(url, json={"additional_items": [{"product": "Jack", "product_spec": "Lift 25 t"}]}, headers=auth(bd))
    assert changed_item.status_code == 409
    same_item = client.patch(url, json={"additional_items": [{"product": "Jack", "product_spec": "Lift 20 t", "quantity": 2}]}, headers=auth(bd))
    assert same_item.status_code == 200, same_item.text
    db.expire_all()
    assert " ".join(db.get(Inquiry, inq.id).product_spec.split()) == "BG 1676"  # spacing only: not a change


def test_requirement_is_editable_again_when_the_send_was_taken_back(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    crm = _crm_req(db, inq)
    crm.status = "withdrawn"
    db.commit()
    assert client.patch(f"{API}/inquiries/{inq.id}", json={"product_spec": "BG 1676, changed"}, headers=auth(bd)).status_code == 200


def test_requirement_is_editable_before_any_send(client, db, tor_env):
    bd = make_user(db, "qc.free@premnathrail.com")
    inq = make_inquiry(db, bd)
    assert client.patch(f"{API}/inquiries/{inq.id}", json={"product_spec": "Anything new"}, headers=auth(bd)).status_code == 200


# ── 6. Change requirement ──────────────────────────────────────────────────

def _change(client, inq, who, **extra):
    body = {"mode": "revision", "product_spec": "BG 1676, hydraulic braking", "item_specs": [], "change_reason": "customer_changed",
            "change_note": None, "response_due_date": _due(6), "remarks": None, "document_ids": [], **extra}
    return client.post(f"{API}/inquiries/{inq.id}/change-requirement", json=body, headers=auth(who))


def test_change_requirement_revision_creates_next_revision_with_reason(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    resp = _change(client, inq, bd, change_note="Customer wants hydraulic braking")
    assert resp.status_code == 200, resp.text
    assert resp.json()["product_spec"] == "BG 1676, hydraulic braking"
    r0, r1 = _revs(db, inq)
    assert (r0.status, r1.status, r1.revision_code.endswith("-R1")) == ("superseded", "submitted", True)
    assert (r1.change_reason, r1.change_note) == ("customer_changed", "Customer wants hydraulic braking")
    assert r1.changed_fields == ["Specification"]
    assert len(tor_env) == 2 and "Customer changed the requirement" in tor_env[-1]["remarks"]
    # The Info tab's revision log has the text change.
    revs = client.get(f"{API}/inquiries/{inq.id}/spec-revisions", headers=auth(bd)).json()
    assert revs[0]["changes"] == [{"field": "product_spec", "old": "BG 1676", "new": "BG 1676, hydraulic braking"}]
    # Now it is the new text that is locked again.
    assert client.patch(f"{API}/inquiries/{inq.id}", json={"product_spec": "something else"}, headers=auth(bd)).status_code == 409


def test_change_requirement_revision_validations_leave_the_text_alone(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    nothing = _change(client, inq, bd, product_spec=" BG   1676 ")
    assert nothing.status_code == 400 and "Nothing changed" in nothing.json()["detail"]
    no_reason = _change(client, inq, bd, change_reason=None)
    assert no_reason.status_code == 422 and "Say why" in no_reason.json()["detail"]
    other = _change(client, inq, bd, change_reason="other", change_note="short")
    assert other.status_code == 422 and "at least 10 characters" in other.json()["detail"]
    no_date = _change(client, inq, bd, response_due_date=None)
    assert no_date.status_code == 400 and "Response Due Date" in no_date.json()["detail"]
    bad_items = _change(client, inq, bd, item_specs=["extra"])
    assert bad_items.status_code == 400 and "additional product" in bad_items.json()["detail"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).product_spec == "BG 1676" and len(_revs(db, inq)) == 1


def test_change_requirement_email_failure_rolls_the_text_back(client, db, tor_env, monkeypatch):
    from app.modules.crm.routes import inquiries as inquiry_routes

    async def failing_email(db, **kwargs):
        return False, "SMTP down"

    bd, head, inq = _setup(client, db)
    monkeypatch.setattr(inquiry_routes, "send_technical_offer_request_email", failing_email)
    resp = _change(client, inq, bd)
    assert resp.status_code == 502 and "SMTP down" in resp.json()["detail"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).product_spec == "BG 1676" and len(_revs(db, inq)) == 1


def test_correction_fixes_the_same_revision_before_rnd_accepts(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    old_due = _crm_req(db, inq).due_date
    old_log = _crm_req(db, inq).movement_log_id
    resp = _change(client, inq, bd, mode="correction", product_spec="BG 1676 (corrected)", change_reason="bd_correction",
                   change_note="Typo in gauge", response_due_date=None)
    assert resp.status_code == 200, resp.text
    assert resp.json()["product_spec"] == "BG 1676 (corrected)"
    # No new revision, no new request, no email, due date unchanged.
    (rev,) = _revs(db, inq)
    assert rev.status == "submitted" and rev.corrected_at is not None and rev.corrected_by_id == bd.id
    assert db.query(CrmRndRequest).count() == 1 and _crm_req(db, inq).due_date == old_due and len(tor_env) == 1
    assert rev.movement_log_id != old_log and _crm_req(db, inq).movement_log_id == rev.movement_log_id
    # R&D sees the corrected text, a single send in the movement list, and when it was corrected.
    detail = client.get(f"{RND}/requirements/inquiry/{inq.id}", headers=auth(head)).json()
    assert len(detail["movements"]) == 1
    spec = next(f["value"] for f in detail["movements"][0]["snapshot"] if f["field"] == "product_spec")
    assert spec == "BG 1676 (corrected)"
    assert detail["revisions"][0]["corrected_at"] and detail["revisions"][0]["corrected_by"] == bd.email.split("@")[0]
    audit = client.get(f"{API}/inquiries/{inq.id}/audit", headers=auth(bd)).json()
    assert any(a["action"] == "requirement_corrected" and "before R&D accepted" in a["summary"] for a in audit)
    told = db.query(Notification).filter(Notification.notification_type == "rnd_requirement_corrected").all()
    assert {n.user_id for n in told} == {head.id} and "corrected" in told[0].message
    # Still the same requirement for the lock / re-send rules: the corrected text is "what R&D has".
    again = _resend(client, inq, bd, change_reason="customer_changed")
    assert again.status_code == 409 and "already has this Customer Requirement" in again.json()["detail"]


def test_correction_is_refused_once_rnd_accepted(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    _accept(client, inq, head)
    resp = _change(client, inq, bd, mode="correction", product_spec="BG 1676 (corrected)")
    assert resp.status_code == 409
    assert "R&D already accepted RDR-" in resp.json()["detail"] and "send the change as a new revision" in resp.json()["detail"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).product_spec == "BG 1676" and _revs(db, inq)[0].corrected_at is None
    # The same change goes through as a revision.
    assert _change(client, inq, bd, product_spec="BG 1676 (corrected)").status_code == 200
    assert [r.revision_no for r in _revs(db, inq)] == [0, 1]


def test_change_requirement_permission_scope_and_unsent(client, db, tor_env, monkeypatch):
    from app.core.config import settings
    bd, head, inq = _setup(client, db)
    # Needs the CRM send right.
    assert _change(client, inq, head).status_code == 403
    # Outside the data scope.
    monkeypatch.setattr(settings, "DEFAULT_DATA_SCOPE", "assigned")
    stranger = make_user(db, "qc.stranger2@premnathrail.com")
    resp = _change(client, inq, stranger)
    assert resp.status_code == 403 and "outside your data access" in resp.json()["detail"]
    # Nothing sent yet: use Edit.
    fresh = make_inquiry(db, bd, uid="INQ-20261007-0009")
    resp = _change(client, fresh, bd)
    assert resp.status_code == 409 and "has not been sent to R&D yet" in resp.json()["detail"]
    assert _change(client, inq, bd, mode="oops").status_code == 422
    assert client.post(f"{API}/inquiries/99999/change-requirement", json={"mode": "revision", "product_spec": "x"}, headers=auth(bd)).status_code == 404


# ── review follow-ups (2026-11-17) ─────────────────────────────────────────

def test_change_requirement_needs_the_inquiry_edit_tick_not_only_send(client, db, tor_env):
    from app.modules.main.models.role import Role
    from app.modules.main.models.user import User
    bd, head, inq = _setup(client, db)
    sender = User(email="qc.sendonly@premnathrail.com", name="Send Only", role="user", is_active=True)
    db.add(sender)
    db.commit()
    role = Role(name="Send only", permissions=["crm:inquiries_tenders:view", "crm:inquiries_tenders.send_tor:create"],
                data_scopes={"crm": "organization", "crm:edit": "organization"})
    db.add(role)
    db.commit()
    sender.roles = [role]
    db.commit()
    resp = _change(client, inq, sender)
    assert resp.status_code == 403 and "Edit" in resp.json()["detail"], resp.text
    db.expire_all()
    assert db.get(Inquiry, inq.id).product_spec == "BG 1676" and len(_revs(db, inq)) == 1
    # With the Edit tick it goes through.
    role.permissions = [*role.permissions, "crm:inquiries_tenders:edit"]
    db.commit()
    assert _change(client, inq, sender).status_code == 200


def test_rnd_recorded_answer_is_not_late_when_the_wait_caused_it_and_due_date_is_kept(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)   # asked while on time
    _make_overdue(db, inq)                # the due date passed while R&D waited on BD
    overdue = _crm_req(db, inq).due_date
    ok = client.post(_respond_url(db, inq), data={"remarks": "Feasible, offer follows", "bd_told_channel": "meeting",
                                                  "bd_told_note": "BD said axle load is 22 t"}, headers=auth(head))
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["is_late"] is False and body["delay_reason"] is None and body["due_date"] == overdue.isoformat()
    assert db.get(CrmRndRequestQuery, qid).due_date_after == overdue
    # The audit row names how BD told R&D and what BD said.
    row = db.query(AuditLog).filter(AuditLog.action == "rnd_responded").one()
    assert "told by meeting" in row.summary and "BD said axle load is 22 t" in row.summary
    assert client.get(f"{RND}/requirements", headers=auth(head)).json()[0]["rnd_request"]["is_late"] is False


def test_rnd_recorded_answer_is_late_when_the_request_was_already_past_due_at_the_question(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    _accept(client, inq, head)
    _make_overdue(db, inq)                # already late BEFORE R&D asked
    assert _ask(client, db, inq, head).status_code == 200
    url = _respond_url(db, inq)
    told = {"remarks": "Feasible, offer follows", "bd_told_channel": "phone", "bd_told_note": "BD said axle load is 22 t"}
    no_reason = client.post(url, data=told, headers=auth(head))
    assert no_reason.status_code == 400 and "late" in no_reason.json()["detail"] and "reason for the delay" in no_reason.json()["detail"]
    ok = client.post(url, data={**told, "delay_reason": "Drawing was not ready"}, headers=auth(head))
    assert ok.status_code == 200, ok.text
    assert ok.json()["delay_reason"] == "Drawing was not ready" and ok.json()["is_late"] is True


def test_correction_keeps_edited_after_send_quiet_and_resend_message_points_to_change_requirement(client, db, tor_env):
    bd, head, inq = _setup(client, db)
    before = db.get(Inquiry, inq.id).technical_offer_sent_at
    assert _change(client, inq, bd, mode="correction", product_spec="BG 1676 (corrected)", response_due_date=None).status_code == 200
    db.expire_all()
    after = db.get(Inquiry, inq.id)
    assert after.technical_offer_sent_at >= before
    assert client.get(f"{RND}/requirements", headers=auth(head)).json()[0]["edited_after_send"] is False
    again = _resend(client, inq, bd, change_reason="customer_changed")
    assert again.status_code == 409 and "Change requirement" in again.json()["detail"] and "click Edit" not in again.json()["detail"]


def test_item_specs_none_keeps_and_empty_clears_an_additional_products_requirement(client, db, tor_env):
    bd = make_user(db, "qc.items@premnathrail.com")
    head = make_user(db, "qc.items.head@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd)
    db.add(InquiryLineItem(inquiry_id=inq.id, sort_order=0, product="Jack", product_spec="Lift 20 t"))
    db.commit()
    assert send_tor(client, inq.id, bd).status_code == 200
    kept = _change(client, inq, bd, product_spec="BG 1676", item_specs=[None])
    assert kept.status_code == 400 and "Nothing changed" in kept.json()["detail"]
    cleared = _change(client, inq, bd, product_spec="BG 1676", item_specs=[""])
    assert cleared.status_code == 200, cleared.text
    db.expire_all()
    assert db.get(Inquiry, inq.id).additional_items[0].product_spec is None
    assert [r.revision_no for r in _revs(db, inq)] == [0, 1]


def test_reply_files_get_unique_names_and_are_capped(client, db, tor_env, monkeypatch):
    from app.core.config import settings
    from app.modules.crm.models.document import CrmDocument
    from app.modules.crm.routes import rnd_requests as route

    async def fake_upload(site_id, folder, f):
        return {"name": f.filename, "path": f"{folder}/{f.filename}", "webUrl": None, "size": 4}

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site-1")
    monkeypatch.setattr(route, "upload_file_to_sharepoint", fake_upload)
    bd, head, inq = _setup(client, db)
    qid = _asked(client, db, inq, head)
    rid = _crm_req(db, inq).id
    url = f"{API}/rnd-requests/{rid}/queries/{qid}/answer"
    form = {"answer": ANSWER, "channel": "email", "due_date": _due()}
    many = [("files", (f"a{i}.pdf", b"data", "application/pdf")) for i in range(11)]
    capped = client.post(url, data=form, files=many, headers=auth(bd))
    assert capped.status_code == 400 and "at most 10" in capped.json()["detail"]
    assert db.get(CrmRndRequestQuery, qid).answer is None
    ok = client.post(url, data=form, files=[("files", ("axle.pdf", b"data", "application/pdf"))], headers=auth(bd))
    assert ok.status_code == 200, ok.text
    assert db.query(CrmDocument).filter(CrmDocument.related_sub_module == "rnd_query").one().file_name == f"q{qid}_axle.pdf"


# ── bulk import must not bypass the requirement lock or the Edit scope ─────

def _csv(*rows):
    import csv
    import io
    from app.modules.crm.routes.bulk_import import _HEADER
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=_HEADER)
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


def _import(client, who, *rows):
    return client.post(f"{API}/bulk-import", headers=auth(who), files={"file": ("crm.csv", _csv(*rows), "text/csv")})


def _bulk_setup(db, uid="INQ-20261007-0050"):
    from app.modules.crm.models.organization import Organization
    bd = make_user(db, "qc.bulk.bd@premnathrail.com")
    head = make_user(db, "qc.bulk.head@premnathrail.com", apps=("rnd",))
    admin = make_user(db, "qc.bulk.admin@premnathrail.com", role="admin")
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd, uid=uid, bulk_import_ref="REF-LOCK")
    return bd, head, admin, inq, db.get(Organization, inq.org_id).name


def test_bulk_import_cannot_change_a_requirement_that_is_with_rnd(client, db, tor_env):
    bd, head, admin, inq, org = _bulk_setup(db)
    assert send_tor(client, inq.id, bd).status_code == 200
    base = {"org_name": org, "inquiry_ref": "REF-LOCK"}
    # Refresh with a different specification: refused, nothing saved.
    res = _import(client, admin, {**base, "product": "RRV", "product_spec": "BG 1676 changed by import"}).json()
    assert res["inquiries_updated"] == 0 and res["rows_skipped"] == 1
    assert "already with R&D" in res["errors"][0]["message"] and "Change requirement" in res["errors"][0]["message"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).product_spec == "BG 1676"
    # The same specification (spacing aside) plus another field still refreshes.
    res = _import(client, admin, {**base, "product": "RRV", "product_spec": "BG  1676", "delivery_location": "Delhi depot"}).json()
    assert res["rows_skipped"] == 0 and res["inquiries_updated"] == 1
    # A further product line WITH a specification is refused; one without a specification is fine.
    res = _import(client, admin, {**base, "product": "RRV"}, {**base, "product": "Jack", "product_spec": "Lift 20 t"}).json()
    assert res["product_lines_added"] == 0 and res["rows_skipped"] == 1 and "already with R&D" in res["errors"][0]["message"]
    res = _import(client, admin, {**base, "product": "RRV"}, {**base, "product": "Jack"}).json()
    assert res["product_lines_added"] == 1 and res["rows_skipped"] == 0
    db.expire_all()
    assert [i.product_spec for i in db.get(Inquiry, inq.id).additional_items] == [None]


def test_bulk_import_spec_changes_freely_before_any_send(client, db, tor_env):
    bd, head, admin, inq, org = _bulk_setup(db)
    res = _import(client, admin, {"org_name": org, "inquiry_ref": "REF-LOCK", "product": "RRV", "product_spec": "BG 1676 new"}).json()
    assert res["rows_skipped"] == 0 and res["inquiries_updated"] == 1


def test_bulk_import_skips_deleted_inquiries_and_inquiries_outside_the_edit_scope(client, db, tor_env):
    from app.modules.main.models.role import Role
    from app.modules.main.models.user import User
    bd, head, admin, inq, org = _bulk_setup(db)
    base = {"org_name": org, "inquiry_ref": "REF-LOCK", "product": "RRV", "delivery_location": "Delhi depot"}
    # A person who may import but may change only their own inquiries.
    importer = User(email="qc.bulk.imp@premnathrail.com", name="Importer", role="user", is_active=True)
    db.add(importer)
    db.commit()
    role = Role(name="Importer own edit", permissions=["crm:organizations:view", "crm:organizations:import", "crm:inquiries_tenders:view",
                                                       "crm:inquiries_tenders:create"],
                data_scopes={"crm": "organization", "crm:edit": "own"})
    db.add(role)
    db.commit()
    importer.roles = [role]
    db.commit()
    res = _import(client, importer, base).json()
    assert res["inquiries_updated"] == 0 and res["rows_skipped"] == 1 and "Edit scope" in res["errors"][0]["message"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).delivery_location is None
    # A deleted inquiry is never refreshed by import: the row creates a new inquiry instead.
    inq.is_deleted = True
    db.commit()
    res = _import(client, admin, base).json()
    assert res["inquiries_updated"] == 0 and res["inquiries_created"] == 1
    db.expire_all()
    assert db.get(Inquiry, inq.id).delivery_location is None
