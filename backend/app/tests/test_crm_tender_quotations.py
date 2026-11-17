"""Tender quotations (the tender's price bid): the same quotation document as an inquiry's, hung off a
CRM tender — numbering (QT-TND-...), revisions, approval on the central engine, send / accept (one accepted
per tender), delete, documents, the link target, data scope, past quotations and the quotation report."""
from datetime import date
from types import SimpleNamespace

from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.role import Role
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.crm.services import quotation_status as qs
from app.tests._so_project_helpers import hdr, make_user
from app.tests.quote_lines import LINE_REF, quote_product  # noqa: F401 — autouse fixture

CRM = "/api/v1/crm"
ITEM = {"description": "RRV 10T", "model_number": "RRV-10T", "quantity": 1, "unit_price": 1000000, "gst_percent": 18, **LINE_REF}


def _people(db):
    owner = make_user(db, "tq.owner@premnathrail.com", apps=("crm",))
    head = make_user(db, "tq.head@premnathrail.com", apps=("crm",))
    db.add(ModuleSetting(module_key="crm", key="quotation_head_id", value=head.id))
    db.commit()
    return owner, head


def _tender(db, owner, uid="PRT-TND-2026-0001", number="RB/TN/2026/77"):
    org = db.query(Organization).filter(Organization.name == "Northern Railway").first()
    if org is None:
        org = Organization(name="Northern Railway", gst_number="07AAAGC1234F1Z5", city="Delhi")
        db.add(org)
        db.flush()
    tnd = Tender(universal_id=uid, org_id=org.id, created_by_id=owner.id, bd_owner=owner.name, tender_number=number,
                 railway_zone="Northern", lead_source="Portal")
    db.add(tnd)
    db.commit()
    return tnd


def _inquiry(db, owner, uid="PRT-INQ-2026-0001"):
    org = db.query(Organization).filter(Organization.name == "Northern Railway").first()
    if org is None:
        org = Organization(name="Northern Railway")
        db.add(org)
        db.flush()
    inq = Inquiry(universal_id=uid, org_id=org.id, created_by_id=owner.id)
    db.add(inq)
    db.commit()
    return inq


def _tq(client, tnd, user, **extra):
    return client.post(f"{CRM}/tenders/{tnd.id}/quotations",
                       json={"items": [ITEM], "quote_date": str(date.today()), **extra}, headers=hdr(user))


def _act(client, tnd, q, action, user, **body):
    return client.post(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}/{action}", json=body, headers=hdr(user))


def _narrow(db, user, level="own"):
    role = Role(name=f"CRM {level} {user.id}", permissions=["crm:*:*"], data_scopes={"crm": level})
    db.add(role)
    db.commit()
    user.roles = [role]
    user.granular_permissions = ["crm:*:*"]
    db.commit()


# ---------------------------------------------------------------- create / list / numbering

def test_create_list_and_number_format(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    r = _tq(client, tnd, owner)
    assert r.status_code == 201, r.text
    q1 = r.json()
    assert q1["quot_number"] == "QT-TND-2026-0001-01"
    assert q1["tender_id"] == tnd.id and q1["inquiry_id"] is None
    assert q1["status"] == "draft" and q1["revision_number"] == 0
    assert _tq(client, tnd, owner).json()["quot_number"] == "QT-TND-2026-0001-02"

    rows = client.get(f"{CRM}/tenders/{tnd.id}/quotations", headers=hdr(owner))
    assert rows.status_code == 200
    assert [x["quot_number"] for x in rows.json()] == ["QT-TND-2026-0001-02", "QT-TND-2026-0001-01"]  # newest first
    assert all(x["tender_id"] == tnd.id and x["items"] for x in rows.json())


def test_tender_numbers_never_clash_with_inquiry_numbers(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)               # PRT-TND-2026-0001
    inq = _inquiry(db, owner)              # PRT-INQ-2026-0001  (same year / serial)
    tq = _tq(client, tnd, owner).json()
    iq = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=hdr(owner)).json()
    assert tq["quot_number"] == "QT-TND-2026-0001-01"
    assert iq["quot_number"] == "QT-2026-0001-01" and iq["inquiry_id"] == inq.id and iq["tender_id"] is None
    # Each parent lists only its own quotations.
    assert [x["id"] for x in client.get(f"{CRM}/tenders/{tnd.id}/quotations", headers=hdr(owner)).json()] == [tq["id"]]
    assert [x["id"] for x in client.get(f"{CRM}/inquiries/{inq.id}/quotations", headers=hdr(owner)).json()] == [iq["id"]]


def test_deleted_number_stays_burnt_and_delete_cancels_pending_approval(client, db):
    owner, head = _people(db)
    admin = make_user(db, "tq.admin@premnathrail.com", apps=("crm",), role="admin")
    tnd = _tender(db, owner)
    q1 = _tq(client, tnd, owner).json()
    q2 = _tq(client, tnd, owner).json()
    assert _act(client, tnd, q2, "submit", owner).status_code == 200
    req = engine.latest_request(db, qs.APPROVAL_ENTITY, q2["id"])
    assert req is not None and req.status == "pending" and "tender PRT-TND-2026-0001" in req.title

    # Only an admin deletes a quotation (legal offer).
    assert client.delete(f"{CRM}/tenders/{tnd.id}/quotations/{q2['id']}", headers=hdr(owner)).status_code == 403
    assert client.delete(f"{CRM}/tenders/{tnd.id}/quotations/{q2['id']}", headers=hdr(admin)).status_code == 200
    db.expire_all()
    assert db.get(Quotation, q2["id"]) is None
    assert engine.latest_request(db, qs.APPROVAL_ENTITY, q2["id"]).status == "cancelled"
    assert _tq(client, tnd, owner).json()["quot_number"] == "QT-TND-2026-0001-03"
    assert q1["id"] != q2["id"]


# ---------------------------------------------------------------- revisions

def test_update_and_revision_history(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    r = client.patch(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}", json={"delivery_time": "12 weeks"}, headers=hdr(owner))
    assert r.status_code == 200, r.text
    assert r.json()["quot_number"] == "QT-TND-2026-0001-01-r1" and r.json()["revision_number"] == 1
    rev = client.get(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}/revisions", headers=hdr(owner))
    assert rev.status_code == 200 and rev.json()[0]["changes"][0]["field"] == "delivery_time"
    # Lump-sum pricing works on a tender quotation too.
    r = client.patch(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}", json={"pricing_mode": "lumpsum", "price": 500000}, headers=hdr(owner))
    assert r.status_code == 200 and r.json()["pricing_mode"] == "lumpsum" and r.json()["price"] == 500000


# ---------------------------------------------------------------- approval flow

def test_submit_approve_send_accept_one_per_tender(client, db):
    owner, head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    assert _act(client, tnd, q, "send", owner).status_code == 409  # not approved yet
    r = _act(client, tnd, q, "submit", owner)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["status_view"]["approval_stage"] == "BD Head"
    assert engine.latest_request(db, qs.APPROVAL_ENTITY, q["id"]).status == "pending"
    assert _act(client, tnd, q, "approve", owner).status_code == 403  # the creator never approves
    assert client.get(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}/status", headers=hdr(head)).json()["can_decide"] is True
    r = _act(client, tnd, q, "approve", head)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert _act(client, tnd, q, "send", owner).json()["status"] == "sent"
    assert _act(client, tnd, q, "accept", owner).json()["status"] == "accepted"

    # A second quotation cannot also be accepted on the same tender.
    q2 = _tq(client, tnd, owner).json()
    _act(client, tnd, q2, "submit", owner)
    _act(client, tnd, q2, "approve", head)
    _act(client, tnd, q2, "send", owner)
    r = _act(client, tnd, q2, "accept", owner)
    assert r.status_code == 409 and "one accepted offer per tender" in r.json()["detail"] and q["quot_number"] in r.json()["detail"]

    # An accepted quotation on an inquiry does not block the tender, and vice versa.
    inq = _inquiry(db, owner, uid="PRT-INQ-2026-0002")
    iq = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM], "quote_date": str(date.today())}, headers=hdr(owner)).json()
    for action, who in (("submit", owner), ("approve", head), ("send", owner), ("accept", owner)):
        resp = client.post(f"{CRM}/inquiries/{inq.id}/quotations/{iq['id']}/{action}", json={}, headers=hdr(who))
        assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "accepted"


def test_reject_returns_to_draft_with_reason(client, db):
    owner, head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    _act(client, tnd, q, "submit", owner)
    assert _act(client, tnd, q, "reject", head).status_code == 422  # a reason is required
    r = _act(client, tnd, q, "return", head, comment="Rates look high")
    assert r.status_code == 200 and r.json()["status"] == "draft"
    assert r.json()["status_comment"].startswith("Returned for changes by")


def test_withdraw_and_lost(client, db):
    owner, head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    _act(client, tnd, q, "submit", owner)
    assert _act(client, tnd, q, "withdraw", owner).json()["status"] == "draft"
    _act(client, tnd, q, "submit", owner)
    _act(client, tnd, q, "approve", head)
    assert _act(client, tnd, q, "lost", owner).status_code == 422  # reason required
    r = _act(client, tnd, q, "lost", owner, comment="L2 on price")
    assert r.status_code == 200 and r.json()["status"] == "lost"
    r = _act(client, tnd, q, "reopen", owner)
    assert r.status_code == 422 and "create a revision" in r.json()["detail"]


# ---------------------------------------------------------------- link target

def test_link_endpoint_returns_the_parent(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    inq = _inquiry(db, owner)
    tq = _tq(client, tnd, owner).json()
    iq = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=hdr(owner)).json()
    r = client.get(f"{CRM}/quotations/{tq['id']}", headers=hdr(owner))
    assert r.status_code == 200
    assert r.json() == {"id": tq["id"], "inquiry_id": None, "tender_id": tnd.id, "quot_number": tq["quot_number"], "status": "draft"}
    r = client.get(f"{CRM}/quotations/{iq['id']}", headers=hdr(owner))
    assert r.json()["inquiry_id"] == inq.id and r.json()["tender_id"] is None

    tnd.is_deleted = True
    db.commit()
    r = client.get(f"{CRM}/quotations/{tq['id']}", headers=hdr(owner))
    assert r.status_code == 404 and "tender of this quotation was deleted" in r.json()["detail"]


# ---------------------------------------------------------------- scope and permissions

def test_out_of_scope_user_is_refused_everywhere(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    stranger = make_user(db, "tq.stranger@premnathrail.com", apps=("crm",))
    _narrow(db, stranger, "own")
    h = hdr(stranger)
    base = f"{CRM}/tenders/{tnd.id}/quotations"
    for resp in (
        client.get(base, headers=h),
        client.post(base, json={"items": [ITEM]}, headers=h),
        client.patch(f"{base}/{q['id']}", json={"delivery_time": "x"}, headers=h),
        client.get(f"{base}/{q['id']}/revisions", headers=h),
        client.get(f"{base}/{q['id']}/pdf", headers=h),
        client.get(f"{base}/{q['id']}/status", headers=h),
        client.post(f"{base}/{q['id']}/submit", json={}, headers=h),
        client.delete(f"{base}/{q['id']}", headers=h),
        client.get(f"{CRM}/quotations/{q['id']}", headers=h),
        client.get(f"{CRM}/tenders/{tnd.id}/quotation-products/1/price", headers=h),
    ):
        assert resp.status_code in (403, 404), (resp.request.url, resp.text)
    assert "outside your data access" in client.get(base, headers=h).json()["detail"]


def test_edit_scope_decides_who_changes_a_tender_quotation(client, db):
    owner, _head = _people(db)
    other = make_user(db, "tq.other@premnathrail.com", apps=("crm",))
    admin = make_user(db, "tq.admin2@premnathrail.com", apps=("crm",), role="admin")
    tnd = _tender(db, owner)
    r = _tq(client, tnd, other)
    assert r.status_code == 403
    assert "Edit scope" in r.json()["detail"] and "tender PRT-TND-2026-0001" in r.json()["detail"]
    assert _tq(client, tnd, admin).status_code == 201


def test_wrong_parent_url_is_404(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    inq = _inquiry(db, owner)
    tq = _tq(client, tnd, owner).json()
    iq = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=hdr(owner)).json()
    # A tender's quotation is not served through an inquiry's URL, nor the other way round.
    assert client.get(f"{CRM}/inquiries/{inq.id}/quotations/{tq['id']}/revisions", headers=hdr(owner)).status_code == 404
    assert client.get(f"{CRM}/tenders/{tnd.id}/quotations/{iq['id']}/revisions", headers=hdr(owner)).status_code == 404
    assert client.patch(f"{CRM}/tenders/{tnd.id}/quotations/{iq['id']}", json={"delivery_time": "x"}, headers=hdr(owner)).status_code == 404
    assert _act(client, tnd, iq, "submit", owner).status_code == 404


def test_deleted_tender_blocks_quotation_endpoints(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    tnd.is_deleted = True
    db.commit()
    base = f"{CRM}/tenders/{tnd.id}/quotations"
    for resp in (
        client.get(base, headers=hdr(owner)),
        _tq(client, tnd, owner),
        client.patch(f"{base}/{q['id']}", json={"delivery_time": "x"}, headers=hdr(owner)),
        client.get(f"{base}/{q['id']}/pdf", headers=hdr(owner)),
        client.get(f"/api/v1/managed-documents/crm_quotation/{q['id']}", headers=hdr(owner)),
    ):
        assert resp.status_code == 404, resp.text
        assert "Tender not found or deleted" in resp.json()["detail"] and "restore it" in resp.json()["detail"]


def test_user_without_quotation_permission_is_denied(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    nobody = User(email="tq.nobody@premnathrail.com", name="Nobody", role="user", is_active=True, granular_permissions=["crm:organizations:view"])
    db.add(nobody)
    db.commit()
    assert client.get(f"{CRM}/tenders/{tnd.id}/quotations", headers=hdr(nobody)).status_code == 403
    assert _tq(client, tnd, nobody).status_code == 403


# ---------------------------------------------------------------- documents

def test_pdf_and_word_context_carry_the_tender(client, db):
    from app.modules.crm.reports.quotation_docx import build_quotation_docx
    from app.modules.crm.routes.workflow import quotation_document_context

    owner, _head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    r = client.get(f"{CRM}/tenders/{tnd.id}/quotations/{q['id']}/pdf", headers=hdr(owner))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF"
    ctx = quotation_document_context(db, db.get(Quotation, q["id"]))
    assert ctx["tender_number"] == "RB/TN/2026/77" and ctx["client_gst_number"] == "07AAAGC1234F1Z5"
    assert len(build_quotation_docx(ctx).getvalue()) > 1000
    # An inquiry quotation prints no tender number.
    inq = _inquiry(db, owner)
    iq = client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=hdr(owner)).json()
    assert quotation_document_context(db, db.get(Quotation, iq["id"]))["tender_number"] is None


def test_managed_word_document_target_checks_the_tender(client, db):
    from app.modules.crm.routes.workflow import _quotation_document_target

    owner, _head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    target = _quotation_document_target(db, q["id"], owner, modify=True)
    assert target.entity_id == q["id"] and "QT-TND-2026-0001-01" in target.title
    stranger = make_user(db, "tq.stranger2@premnathrail.com", apps=("crm",))
    _narrow(db, stranger, "own")
    try:
        _quotation_document_target(db, q["id"], stranger, modify=False)
        raised = False
    except Exception as exc:  # HTTPException 403
        raised = getattr(exc, "status_code", None) in (403, 404)
    assert raised


# ---------------------------------------------------------------- price prefill, past quotations, reports

def test_price_prefill_on_a_tender(client, db):
    owner, _head = _people(db)
    tnd = _tender(db, owner)
    r = client.get(f"{CRM}/tenders/{tnd.id}/quotation-products/1/price", headers=hdr(owner))
    assert r.status_code == 200 and "price" in r.json()
    assert client.get(f"{CRM}/tenders/{tnd.id}/quotation-products/9999/price", headers=hdr(owner)).status_code == 404


def test_past_quotations_include_tender_quotations_in_scope(client, db):
    owner, _head = _people(db)
    mine = _tender(db, owner)
    q = _tq(client, mine, owner).json()
    other_owner = make_user(db, "tq.owner2@premnathrail.com", apps=("crm",))
    theirs = _tender(db, other_owner, uid="PRT-TND-2026-0002")
    theirs_q = _tq(client, theirs, other_owner).json()
    _narrow(db, owner, "own")

    ids = {x["id"] for x in client.get(f"{CRM}/past-quotations", headers=hdr(owner)).json()}
    assert q["id"] in ids and theirs_q["id"] not in ids
    # A deleted tender's quotations drop out.
    mine.is_deleted = True
    db.commit()
    assert q["id"] not in {x["id"] for x in client.get(f"{CRM}/past-quotations", headers=hdr(owner)).json()}


def test_quotation_report_dataset_lists_tender_rows(client, db):
    from app.modules.crm import reporting

    owner, _head = _people(db)
    tnd = _tender(db, owner)
    inq = _inquiry(db, owner)
    _tq(client, tnd, owner)
    client.post(f"{CRM}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=hdr(owner))
    db.expire_all()
    ctx = SimpleNamespace(db=db, user=db.get(User, owner.id), today=date.today())
    rows = reporting.load_quotation_rows(ctx)
    by_number = {r["inquiry_number"]: r for r in rows}
    assert set(by_number) == {"PRT-TND-2026-0001", "PRT-INQ-2026-0001"}
    t = by_number["PRT-TND-2026-0001"]
    assert t["tender_id"] == tnd.id and t["inquiry_id"] is None and t["customer"] == "Northern Railway" and t["zone"] == "Northern"
    assert t["lead_key"] == f"tender:{tnd.id}" and by_number["PRT-INQ-2026-0001"]["lead_key"] == f"inquiry:{inq.id}"
    assert t["value_inr"] == 1180000

    # Outside the viewer's scope the tender row is gone.
    stranger = make_user(db, "tq.stranger3@premnathrail.com", apps=("crm",))
    _narrow(db, stranger, "own")
    db.expire_all()
    ctx = SimpleNamespace(db=db, user=db.get(User, stranger.id), today=date.today())
    assert reporting.load_quotation_rows(ctx) == []


def test_expiry_job_handles_tender_quotations(client, db):
    from datetime import timedelta

    owner, head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner, valid_until=str(date.today() + timedelta(days=3))).json()
    _act(client, tnd, q, "submit", owner)
    _act(client, tnd, q, "approve", head)
    assert qs.remind_expiring(db, date.today()) == 1
    row = db.get(Quotation, q["id"])
    row.valid_until = date.today() - timedelta(days=1)
    db.commit()
    assert qs.expire_due(db) == 1
    db.commit()
    assert db.get(Quotation, q["id"]).status == "expired"


def test_inbox_decision_refused_after_the_tender_is_deleted(client, db):
    """Approval inbox / email link go through engine.decide, not the CRM route — the
    quotation's validate_decision must refuse once its tender is deleted."""
    import pytest
    from fastapi import HTTPException
    owner, head = _people(db)
    tnd = _tender(db, owner)
    q = _tq(client, tnd, owner).json()
    assert _act(client, tnd, q, "submit", owner).status_code == 200
    req = engine.latest_request(db, qs.APPROVAL_ENTITY, q["id"])
    tnd.is_deleted = True
    db.commit()
    with pytest.raises(HTTPException) as exc:
        engine.decide(db, req.id, db.get(User, head.id), "approve")
    assert exc.value.status_code == 409 and "tender" in exc.value.detail and "recycle bin" in exc.value.detail
    db.rollback()
    assert db.get(Quotation, q["id"]).status == "submitted"
