"""Owner, 2026-11-03: a CRM record whose requirement is still with R&D may move its
status / stage back only while R&D has not started (no task, no uploaded document,
no technical offer). Moving back then takes the requirement back from R&D; once R&D
has started, the move back is refused with the real reason."""
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.main.models.notification import Notification
from app.modules.rnd.models.requirement import RndRequirement
from app.tests.test_cov_crm_quotations_rnd import auth, make_inquiry, make_user, send_tor, tor_env  # noqa: F401 — fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture
from app.tests.test_rnd_intake import _accept, _task, _upload, doc_env  # noqa: F401 — fixture
from app.tests.test_rnd_requirement_work import make_rnd_head

RND = "/api/v1/rnd"
CRM = "/api/v1/crm"


def _setup(client, db):
    bd = make_user(db, "tb.bd@premnathrail.com")
    head = make_user(db, "tb.head@premnathrail.com", apps=("rnd",))
    member = make_user(db, "tb.member@premnathrail.com", apps=("rnd",))
    make_rnd_head(db, head)
    inq = make_inquiry(db, bd, status="R&D / Technical Review", current_stage="Requirement Received")
    assert send_tor(client, inq.id, bd).status_code == 200
    return bd, head, member, inq


def _status_back(client, inq, who, status="Requirement Received"):
    return client.patch(f"{CRM}/inquiries/{inq.id}", json={"status": status}, headers=auth(who))


def _request(db) -> CrmRndRequest:
    db.expire_all()
    return db.query(CrmRndRequest).order_by(CrmRndRequest.id.desc()).first()


def test_status_back_before_rnd_starts_takes_the_requirement_back(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert len(client.get(f"{RND}/requirements", headers=auth(head)).json()) == 1
    resp = _status_back(client, inq, bd)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "Requirement Received" and resp.json()["technical_offer_sent_at"] is None
    req = _request(db)
    assert req.status == "withdrawn" and req.response_remarks.startswith("Taken back by BD:") and req.responded_by_id == bd.id
    db.expire_all()
    assert db.query(RndRequirement).one().status == "withdrawn"
    # Gone from R&D › Requirements; the head is told; the timeline shows it.
    assert client.get(f"{RND}/requirements", headers=auth(head)).json() == []
    bells = db.query(Notification).filter(Notification.notification_type == "rnd_request_withdrawn").all()
    assert {n.user_id for n in bells} == {head.id}
    logs = db.query(CrmStageLog).filter(CrmStageLog.related_id == inq.id, CrmStageLog.stage == "Taken back from R&D").all()
    assert len(logs) == 1 and "taken back from R&D" in logs[0].notes
    # BD sees the state on the Requirement Movement card.
    moves = client.get(f"{CRM}/inquiries/{inq.id}/requirement-movements", headers=auth(bd)).json()
    assert moves[0]["rnd_request"]["status"] == "withdrawn"
    # Sending again is allowed without a Customer Requirement change and opens the next revision (R1).
    assert send_tor(client, inq.id, bd).status_code == 200, "re-send after take-back must not hit the unchanged-requirement rule"
    db.expire_all()
    assert db.query(RndRequirement).one().current_revision == 1 and _request(db).status == "open"
    assert len(client.get(f"{RND}/requirements", headers=auth(head)).json()) == 1


def test_stage_back_takes_it_back_too_and_needs_the_usual_reason(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    db.get(Inquiry, inq.id).current_stage = "Quotation Sent"
    db.commit()
    assert client.patch(f"{CRM}/inquiries/{inq.id}", json={"current_stage": "Requirement Received"}, headers=auth(bd)).status_code == 422
    resp = client.patch(f"{CRM}/inquiries/{inq.id}", json={"current_stage": "Requirement Received", "stage_reason": "customer changed scope"}, headers=auth(bd))
    assert resp.status_code == 200, resp.text
    assert _request(db).status == "withdrawn" and "customer changed scope" in _request(db).response_remarks


def test_move_back_is_refused_once_rnd_created_a_task(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    assert _task(client, inq, head, member).status_code == 200
    resp = _status_back(client, inq, bd)
    assert resp.status_code == 409
    assert "R&D has already started" in resp.json()["detail"] and "1 R&D task" in resp.json()["detail"]
    # Nothing changed: still open, still with R&D.
    assert _request(db).status == "open" and db.get(Inquiry, inq.id).status == "R&D / Technical Review"
    assert len(client.get(f"{RND}/requirements", headers=auth(head)).json()) == 1


def test_move_back_is_refused_once_rnd_uploaded_a_document(client, db, tor_env, doc_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    assert _upload(client, inq, head, category="drawing", name="ga.pdf").status_code == 200
    resp = _status_back(client, inq, bd)
    assert resp.status_code == 409 and "1 document uploaded by R&D" in resp.json()["detail"]
    assert _request(db).status == "open"


def test_after_rnd_responded_a_move_back_leaves_rnd_alone(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    assert _accept(client, inq, head).status_code == 200
    req_id = _request(db).id
    assert client.post(f"{RND}/requirements/requests/{req_id}/respond", data={"remarks": "Feasible"}, headers=auth(head)).status_code == 200
    resp = _status_back(client, inq, bd)
    assert resp.status_code == 200, resp.text
    assert _request(db).status == "responded" and db.get(Inquiry, inq.id).technical_offer_sent_at is not None
    assert db.query(CrmStageLog).filter(CrmStageLog.related_id == inq.id, CrmStageLog.stage == "Taken back from R&D").count() == 0


def test_forward_status_change_never_touches_rnd(client, db, tor_env):
    bd, head, member, inq = _setup(client, db)
    resp = _status_back(client, inq, bd, status="Qualified Inquiry")
    assert resp.status_code == 200, resp.text
    assert _request(db).status == "open" and len(client.get(f"{RND}/requirements", headers=auth(head)).json()) == 1
