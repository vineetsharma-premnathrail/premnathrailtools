"""Coverage: CRM quotation revisions (-rN numbering, revision log, server-side
totals, Export GST rules) and the CRM -> R&D Technical Offer Request channel
(assignment validation, requirement movement history, supersede on re-send,
R&D response rules). test_crm_quotations.py covers numbering-after-delete,
payload validation and the customer-response permission; not repeated here."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.crm.routes import inquiries as inquiry_routes
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.tests.quote_lines import LINE_REF, quote_product  # noqa: F401 — autouse fixture
from app.tests.test_crm_quotation_documents import sp  # noqa: F401 — fixture

API = "/api/v1/crm"


def make_user(db, email, role="user", apps=("crm",)):
    user = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def auth(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def make_inquiry(db, owner, uid="INQ-20261007-0001", **extra):
    # A Technical Offer Request needs a product and a spec/requirement to send.
    extra.setdefault("product", "RRV")
    extra.setdefault("product_spec", "BG 1676")
    org = Organization(name=f"Org for {uid}", org_type="Customer")
    db.add(org)
    db.flush()
    contact = OrgContact(org_id=org.id, name="SSE Track", created_at=datetime.now(timezone.utc))
    db.add(contact)
    db.flush()
    inq = Inquiry(universal_id=uid, org_id=org.id, org_contact_id=contact.id, created_by_id=owner.id, lead_source="Direct", **extra)
    db.add(inq)
    db.commit()
    db.refresh(inq)
    return inq


ITEM = {"description": "Rail drill", "quantity": 2, "unit_price": 1000, "gst_percent": 18, **LINE_REF}


def create_quot(client, inq_id, user, **extra):
    body = {"items": [ITEM], **extra}
    resp = client.post(f"{API}/inquiries/{inq_id}/quotations", json=body, headers=auth(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Quotation totals & revisions
# ---------------------------------------------------------------------------

def test_totals_are_computed_server_side_not_trusted(client, db):
    owner = make_user(db, "q.tot@premnathrail.com")
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner, items=[{**ITEM, "subtotal": 1, "total": 1}])
    item = q["items"][0]
    assert item["subtotal"] == 2000.0 and item["total"] == 2360.0
    assert q["quot_number"] == "QT-20261007-0001-01" and q["revision_number"] == 0


def test_export_quotation_drops_gst(client, db):
    owner = make_user(db, "q.exp@premnathrail.com")
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner, quotation_type="Export")
    item = q["items"][0]
    assert item["gst_percent"] is None and item["subtotal"] == item["total"] == 2000.0
    # A revised price on an Export quote stays GST-free.
    q = client.patch(f"{API}/inquiries/{inq.id}/quotations/{q['id']}", json={"items": [{**ITEM, "unit_price": 1500}]}, headers=auth(owner)).json()
    assert q["items"][0]["total"] == 3000.0


def test_revision_numbering_and_log(client, db):
    owner = make_user(db, "q.rev@premnathrail.com")
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner, delivery_time="8 weeks", payment_terms="100% advance")
    base = f"{API}/inquiries/{inq.id}/quotations/{q['id']}"
    h = auth(owner)

    r1 = client.patch(base, json={"delivery_time": "10 weeks"}, headers=h).json()
    assert r1["quot_number"] == "QT-20261007-0001-01-r1" and r1["revision_number"] == 1

    # Unchanged values are not a revision.
    same = client.patch(base, json={"delivery_time": "10 weeks"}, headers=h).json()
    assert same["revision_number"] == 1

    r2 = client.patch(base, json={"payment_terms": "30 days credit", "items": [{**ITEM, "unit_price": 900}]}, headers=h).json()
    assert r2["quot_number"] == "QT-20261007-0001-01-r2" and r2["revision_number"] == 2
    assert r2["items"][0]["subtotal"] == 1800.0 and r2["items"][0]["total"] == 2124.0

    # Tracking-only fields never count as a revision. (Negotiating needs the
    # quotation to be with the customer — status flow, quotation_status.py.)
    from app.modules.crm.models.inquiry import Quotation as _Q
    db.get(_Q, q["id"]).status = "sent"
    db.commit()
    tracked = client.patch(base, json={"customer_response": "Negotiating", "submitted_date": "2026-10-07"}, headers=h).json()
    assert tracked["revision_number"] == 2 and tracked["customer_response"] == "Negotiating"

    revs = client.get(f"{base}/revisions", headers=h).json()
    assert [r["revision_id"] for r in revs] == ["r2", "r1"]
    latest = {c["field"]: (c["old"], c["new"]) for c in revs[0]["changes"]}
    assert latest["payment_terms"] == ("100% advance", "30 days credit")
    assert latest["items"] == ("Rail drill (RRV-MC) × 2 @ 1000 GST 18%", "Rail drill (RRV-MC) × 2 @ 900 GST 18%")
    assert revs[1]["changes"] == [{"field": "delivery_time", "old": "8 weeks", "new": "10 weeks"}]
    assert revs[0]["performed_by"] == "q.rev"


def test_revision_can_change_everything(client, db):
    owner = make_user(db, "q.ign@premnathrail.com")
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner)
    base = f"{API}/inquiries/{inq.id}/quotations/{q['id']}"
    resp = client.patch(base, json={
        "discount": 10, "discount_type": "percent", "notes": "Revised scope", "client_name": "New Client",
        "items": [{**ITEM, "quantity": 3}, {"description": "Spare bits", "quantity": 10, "unit_price": 50, "gst_percent": 18, **LINE_REF}],
    }, headers=auth(owner)).json()
    assert resp["revision_number"] == 1 and resp["discount"] == 10 and resp["notes"] == "Revised scope" and resp["client_name"] == "New Client"
    assert [(i["description"], i["quantity"], i["total"]) for i in resp["items"]] == [("Rail drill", 3.0, 3540.0), ("Spare bits", 10.0, 590.0)]
    # Switching to Export drops GST from the existing lines and recomputes totals.
    resp = client.patch(base, json={"quotation_type": "Export"}, headers=auth(owner)).json()
    assert resp["revision_number"] == 2 and resp["items"][0]["gst_percent"] is None and resp["items"][0]["total"] == 3000.0
    # Removing every line is refused.
    assert client.patch(base, json={"items": []}, headers=auth(owner)).status_code == 422
    changed = {c["field"] for c in client.get(f"{base}/revisions", headers=auth(owner)).json()[1]["changes"]}
    assert {"discount", "notes", "client_name", "items"} <= changed


def test_new_quotation_after_revision_takes_next_base_number(client, db):
    owner = make_user(db, "q.next@premnathrail.com")
    inq = make_inquiry(db, owner)
    q1 = create_quot(client, inq.id, owner)
    client.patch(f"{API}/inquiries/{inq.id}/quotations/{q1['id']}", json={"payment_terms": "x"}, headers=auth(owner))
    q2 = create_quot(client, inq.id, owner)
    assert q2["quot_number"] == "QT-20261007-0001-02"
    listed = client.get(f"{API}/inquiries/{inq.id}/quotations", headers=auth(owner)).json()
    assert [q["quot_number"] for q in listed] == ["QT-20261007-0001-02", "QT-20261007-0001-01-r1"]


def test_quotation_delete_admin_only_and_revisions_hide_delete_rows(client, db):
    owner = make_user(db, "q.del@premnathrail.com")
    admin = make_user(db, "q.deladmin@premnathrail.com", role="admin")
    inq = make_inquiry(db, owner)
    q1 = create_quot(client, inq.id, owner)
    q2 = create_quot(client, inq.id, owner)
    resp = client.delete(f"{API}/inquiries/{inq.id}/quotations/{q1['id']}", headers=auth(owner))
    assert resp.status_code == 403 and resp.json()["detail"] == "Only an admin can delete this quotation."
    assert client.delete(f"{API}/inquiries/{inq.id}/quotations/{q1['id']}", headers=auth(admin)).status_code == 200
    assert client.delete(f"{API}/inquiries/{inq.id}/quotations/{q1['id']}", headers=auth(admin)).status_code == 404
    # The other quotation's revision list is unaffected by the burnt-number row.
    assert client.get(f"{API}/inquiries/{inq.id}/quotations/{q2['id']}/revisions", headers=auth(owner)).json() == []


def test_quotation_cannot_be_reached_through_another_inquiry(client, db):
    owner = make_user(db, "q.cross@premnathrail.com")
    a = make_inquiry(db, owner, uid="INQ-20261007-0001")
    b = make_inquiry(db, owner, uid="INQ-20261007-0002")
    q = create_quot(client, a.id, owner)
    h = auth(owner)
    assert client.patch(f"{API}/inquiries/{b.id}/quotations/{q['id']}", json={"payment_terms": "x"}, headers=h).status_code == 404
    assert client.get(f"{API}/inquiries/{b.id}/quotations/{q['id']}/revisions", headers=h).status_code == 404
    assert client.get(f"{API}/inquiries/{b.id}/quotations/{q['id']}/pdf", headers=h).status_code == 404


def test_quotation_pdf_downloads(client, db):
    owner = make_user(db, "q.pdf@premnathrail.com")
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner)
    resp = client.get(f"{API}/inquiries/{inq.id}/quotations/{q['id']}/pdf", headers=auth(owner))
    assert resp.status_code == 200 and resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_quotation_routes_require_crm_app(client, db):
    owner = make_user(db, "q.app@premnathrail.com")
    outsider = make_user(db, "q.out@premnathrail.com", apps=("rnd",))
    inq = make_inquiry(db, owner)
    q = create_quot(client, inq.id, owner)
    h = auth(outsider)
    for resp in (
        client.get(f"{API}/inquiries/{inq.id}/quotations", headers=h),
        client.post(f"{API}/inquiries/{inq.id}/quotations", json={"items": [ITEM]}, headers=h),
        client.get(f"{API}/inquiries/{inq.id}/quotations/{q['id']}/revisions", headers=h),
    ):
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Technical Offer Request (CRM -> R&D)
# ---------------------------------------------------------------------------

@pytest.fixture
def tor_env(monkeypatch, sp):
    sent = []

    async def fake_upload(site_id, folder, filename, content_type, data):
        return {"path": f"{folder}/{filename}", "webUrl": "https://sp/x", "size": len(data)}

    async def fake_email(db, **kwargs):
        sent.append(kwargs)
        return True, None

    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "test-site")
    monkeypatch.setattr(inquiry_routes, "upload_bytes_to_sharepoint", fake_upload)
    monkeypatch.setattr(inquiry_routes, "send_technical_offer_request_email", fake_email)
    return sent


@pytest.fixture
def people(db):
    return {
        "bd": make_user(db, "tor.bd@premnathrail.com"),
        "rnd": make_user(db, "tor.rnd@premnathrail.com", apps=("rnd",)),
        "rnd2": make_user(db, "tor.rnd2@premnathrail.com", apps=("rnd",)),
        "plain": make_user(db, "tor.plain@premnathrail.com", apps=("store",)),
    }


def send_tor(client, inq_id, user, due=None, draft=True, **extra):
    """CRM creates the TOR Word draft first, then sends (to the whole R&D team)."""
    if draft:
        created = client.post(f"/api/v1/managed-documents/crm_tor_inquiry/{inq_id}", headers=auth(user))
        assert created.status_code == 200, created.text
    due = due or (date.today() + timedelta(days=5))
    return client.post(
        f"{API}/inquiries/{inq_id}/technical-offer-request",
        json={"response_due_date": due.isoformat(), **extra},
        headers=auth(user),
    )


def test_rnd_assignees_lists_only_active_rnd_users(client, db, people):
    gone = make_user(db, "tor.gone@premnathrail.com", apps=("rnd",))
    gone.is_active = False
    db.commit()
    rows = client.get(f"{API}/rnd-requests/assignees", headers=auth(people["bd"])).json()
    assert sorted(r["email"] for r in rows) == ["tor.rnd2@premnathrail.com", "tor.rnd@premnathrail.com"]


def test_tor_validation_runs_before_upload(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"])
    bd = people["bd"]
    resp = client.post(f"{API}/inquiries/{inq.id}/technical-offer-request", headers=auth(bd))
    assert resp.status_code == 400 and "Response Due Date" in resp.json()["detail"]
    resp = send_tor(client, inq.id, bd, due=date.today() - timedelta(days=3), draft=False)
    assert resp.status_code == 400 and "in the past" in resp.json()["detail"]
    # The Word document must be created before sending.
    resp = send_tor(client, inq.id, bd, draft=False)
    assert resp.status_code == 400 and "Create the Technical Offer Word document first" in resp.json()["detail"]
    # Nothing was uploaded or emailed for any of the rejected attempts.
    assert tor_env == []
    assert db.query(CrmDocument).count() == 0


def test_tor_needs_someone_with_rnd_access(client, db, tor_env):
    bd = make_user(db, "tor.solo.bd@premnathrail.com")
    inq = make_inquiry(db, bd)
    resp = send_tor(client, inq.id, bd)
    assert resp.status_code == 400 and "Nobody could receive this request" in resp.json()["detail"]


def test_tor_without_sharepoint_is_503(client, db, people, sp, monkeypatch):
    inq = make_inquiry(db, people["bd"])
    created = client.post(f"/api/v1/managed-documents/crm_tor_inquiry/{inq.id}", headers=auth(people["bd"]))
    assert created.status_code == 200, created.text
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "")
    resp = send_tor(client, inq.id, people["bd"], draft=False)
    assert resp.status_code == 503


def test_tor_email_failure_is_502_and_opens_no_request(client, db, people, tor_env, monkeypatch):
    async def failing_email(db, **kwargs):
        return False, "SMTP down"
    monkeypatch.setattr(inquiry_routes, "send_technical_offer_request_email", failing_email)
    inq = make_inquiry(db, people["bd"])
    resp = send_tor(client, inq.id, people["bd"])
    assert resp.status_code == 502 and "SMTP down" in resp.json()["detail"]
    db.expire_all()
    assert db.get(Inquiry, inq.id).technical_offer_number is None
    assert db.query(CrmRndRequest).count() == 0


def test_tor_send_creates_shared_doc_movement_and_rnd_request(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"], product="USFD tester", quantity=3)
    ref = CrmDocument(related_module="inquiry", related_id=inq.id, folder_type="client", file_name="spec.pdf", file_path="p", created_by_id=people["bd"].id)
    unrelated = CrmDocument(related_module="inquiry", related_id=inq.id + 100, folder_type="client", file_name="other.pdf", file_path="p")
    db.add_all([ref, unrelated])
    db.commit()

    resp = send_tor(client, inq.id, people["bd"], remarks="  urgent  ", document_ids=[ref.id, unrelated.id])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["technical_offer_number"] == "TOR-20261007-0001" and body["technical_offer_sent_at"]

    email = tor_env[0]
    assert email["offer_number"] == "TOR-20261007-0001" and email["attachment_filename"] == "TOR-20261007-0001.pdf"
    assert email["attachment_bytes"].startswith(b"%PDF")
    # Only documents of this inquiry may be shared.
    assert [d["name"] for d in email["reference_documents"]] == ["spec.pdf"]
    db.expire_all()
    assert db.get(CrmDocument, ref.id).shared_via_tor is True
    assert db.get(CrmDocument, unrelated.id).shared_via_tor is False

    req = db.query(CrmRndRequest).one()
    # Whole R&D team queue: no named engineer, every R&D user is notified.
    assert (req.status, req.assigned_to_id, req.crm_remarks, req.offer_number) == ("open", None, "urgent", "TOR-20261007-0001")
    notified = {n.user_id for n in db.query(Notification).filter(Notification.notification_type == "rnd_request_assigned").all()}
    assert notified == {people["rnd"].id, people["rnd2"].id}

    moves = client.get(f"{API}/inquiries/{inq.id}/requirement-movements", headers=auth(people["bd"])).json()
    assert len(moves) == 1 and moves[0]["sequence"] == 1 and moves[0]["changes"] == []
    snap = {s["field"]: s["value"] for s in moves[0]["snapshot"]}
    assert snap["product"] == "USFD tester" and snap["quantity_display"] is None  # quantity is no longer sent to R&D
    assert moves[0]["rnd_request"]["assigned_to"] is None and moves[0]["rnd_request"]["status"] == "open"


def test_resend_supersedes_open_request_and_diffs_snapshot(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"], product="Rail cutter")
    assert send_tor(client, inq.id, people["bd"]).status_code == 200
    inq.product = "Rail cutter Mk2"
    db.commit()
    assert send_tor(client, inq.id, people["bd"]).status_code == 200

    reqs = db.query(CrmRndRequest).order_by(CrmRndRequest.id).all()
    assert [r.status for r in reqs] == ["superseded", "open"]
    moves = client.get(f"{API}/inquiries/{inq.id}/requirement-movements", headers=auth(people["bd"])).json()
    assert [m["sequence"] for m in moves] == [1, 2]
    assert moves[1]["changes"] == [{"field": "product", "label": "Product", "old": "Rail cutter", "new": "Rail cutter Mk2"}]

    # R&D cannot answer the outdated request.
    resp = client.post(f"/api/v1/rnd/requirements/requests/{reqs[0].id}/respond", data={"remarks": "done"}, headers=auth(people["rnd"]))
    assert resp.status_code == 409 and "re-sent" in resp.json()["detail"]


def test_rnd_response_rules(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"])
    assert send_tor(client, inq.id, people["bd"]).status_code == 200
    req = db.query(CrmRndRequest).one()
    url = f"/api/v1/rnd/requirements/requests/{req.id}/respond"

    # The CRM user has no R&D app at all.
    assert client.post(url, data={"remarks": "x"}, headers=auth(people["bd"])).status_code == 403
    # Older requests that named an engineer stay with that engineer.
    req.assigned_to_id = people["rnd"].id
    db.commit()
    resp = client.post(url, data={"remarks": "x"}, headers=auth(people["rnd2"]))
    assert resp.status_code == 403 and "Only tor.rnd can answer" in resp.json()["detail"]
    req.assigned_to_id = None
    db.commit()
    resp = client.post(url, data={"remarks": "   "}, headers=auth(people["rnd"]))
    assert resp.status_code == 400 and "Add response remarks" in resp.json()["detail"]

    # Team-queue request: any R&D user may answer.
    resp = client.post(url, data={"remarks": "Feasible, 6 weeks"}, headers=auth(people["rnd2"]))
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["status"] == "responded" and out["responded_by"] == "tor.rnd2" and out["is_late"] is False
    assert out["delay_reason"] is None

    resp = client.post(url, data={"remarks": "again"}, headers=auth(people["rnd"]))
    assert resp.status_code == 409 and "already been answered" in resp.json()["detail"]
    assert client.post("/api/v1/rnd/requirements/requests/9999/respond", data={"remarks": "x"}, headers=auth(people["rnd"])).status_code == 404


def test_late_rnd_response_requires_delay_reason(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"])
    assert send_tor(client, inq.id, people["bd"]).status_code == 200
    req = db.query(CrmRndRequest).one()
    req.due_date = date.today() - timedelta(days=2)
    db.commit()
    url = f"/api/v1/rnd/requirements/requests/{req.id}/respond"
    resp = client.post(url, data={"remarks": "late answer"}, headers=auth(people["rnd"]))
    assert resp.status_code == 400 and "reason for the delay" in resp.json()["detail"]
    resp = client.post(url, data={"remarks": "late answer", "delay_reason": "Waiting for RDSO drawing"}, headers=auth(people["rnd"]))
    assert resp.status_code == 200
    assert resp.json()["delay_reason"] == "Waiting for RDSO drawing" and resp.json()["is_late"] is True


def test_response_to_request_of_deleted_inquiry_is_404(client, db, people, tor_env):
    inq = make_inquiry(db, people["bd"])
    assert send_tor(client, inq.id, people["bd"]).status_code == 200
    req = db.query(CrmRndRequest).one()
    # An inquiry linked to R&D can't be deleted any more...
    assert client.delete(f"{API}/inquiries/{inq.id}", headers=auth(people["bd"])).status_code == 409
    # ...but one deleted before that rule (or from the recycle bin) still can't be answered.
    inq.is_deleted = True
    db.commit()
    resp = client.post(f"/api/v1/rnd/requirements/requests/{req.id}/respond", data={"remarks": "x"}, headers=auth(people["rnd"]))
    assert resp.status_code == 404 and "was deleted" in resp.json()["detail"]


def test_tor_on_deleted_or_missing_inquiry_is_404(client, db, people, tor_env):
    assert send_tor(client, 4242, people["bd"], draft=False).status_code == 404
    assert client.get(f"{API}/inquiries/4242/requirement-movements", headers=auth(people["bd"])).status_code == 404
