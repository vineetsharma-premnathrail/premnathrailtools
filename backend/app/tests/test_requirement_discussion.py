"""CRM ↔ R&D requirement Discussion: shared thread, access per side, @mentions
notify, attachments are shared CRM documents, delete-own."""
from datetime import datetime, timezone

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.routes import requirement_discussion as disc_routes
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User

API = "/api/v1/requirement-discussion"


def make_user(db, email, apps):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True, assigned_apps=list(apps))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def make_inquiry(db, owner, sent=True):
    org = Organization(name="Disc Org", org_type="Customer")
    db.add(org)
    db.flush()
    inq = Inquiry(universal_id="INQ-DISC-1", org_id=org.id, created_by_id=owner.id, lead_source="Direct",
                  technical_offer_sent_at=datetime.now(timezone.utc) if sent else None)
    db.add(inq)
    db.commit()
    db.refresh(inq)
    return inq


def test_both_sides_share_one_thread_and_mentions_notify(client, db):
    bd = make_user(db, "disc_bd@premnathrail.com", ["crm"])
    eng = make_user(db, "disc_eng@premnathrail.com", ["rnd"])
    eng.department = "R&D"  # only R&D / Business Development people can be tagged
    db.commit()
    inq = make_inquiry(db, bd)

    r = client.post(f"{API}/inquiry/{inq.id}", data={"side": "crm", "body": "@disc_eng please check gauge", "mention_ids": str(eng.id)}, headers=auth(bd))
    assert r.status_code == 200, r.text
    assert r.json()["mentions"] == [{"id": eng.id, "name": "disc_eng"}]
    note = db.query(Notification).filter(Notification.user_id == eng.id).one()
    assert note.notification_type == "req_mention_rnd_inquiry" and note.entity_type == "rnd_req_inquiry"

    r = client.post(f"{API}/inquiry/{inq.id}", data={"side": "rnd", "body": "Checked — 1676 mm"}, headers=auth(eng))
    assert r.status_code == 200
    thread = client.get(f"{API}/inquiry/{inq.id}", params={"side": "crm"}, headers=auth(bd)).json()
    assert [(m["side"], m["body"]) for m in thread] == [("crm", "@disc_eng please check gauge"), ("rnd", "Checked — 1676 mm")]


def test_access_rules(client, db):
    bd = make_user(db, "disc_bd2@premnathrail.com", ["crm"])
    eng = make_user(db, "disc_eng2@premnathrail.com", ["rnd"])
    stranger = make_user(db, "disc_x@premnathrail.com", ["erp"])
    unsent = make_inquiry(db, bd, sent=False)
    # R&D can't see a requirement that was never sent to it
    assert client.get(f"{API}/inquiry/{unsent.id}", params={"side": "rnd"}, headers=auth(eng)).status_code == 404
    # R&D user can't pose as the CRM side
    assert client.get(f"{API}/inquiry/{unsent.id}", params={"side": "crm"}, headers=auth(eng)).status_code == 403
    # BD gets no discussion either until the Technical Requirement is sent to R&D
    assert client.get(f"{API}/inquiry/{unsent.id}", params={"side": "crm"}, headers=auth(bd)).status_code == 409
    assert client.post(f"{API}/inquiry/{unsent.id}", data={"side": "crm", "body": "x"}, headers=auth(bd)).status_code == 409
    unsent.technical_offer_sent_at = datetime.now(timezone.utc)
    db.commit()
    sent = unsent
    assert client.post(f"{API}/inquiry/{sent.id}", data={"side": "crm", "body": "x", "mention_ids": str(stranger.id)}, headers=auth(bd)).status_code == 422
    assert client.post(f"{API}/inquiry/{sent.id}", data={"side": "crm", "body": "  "}, headers=auth(bd)).status_code == 422


def test_attachment_is_shared_document_and_delete_own(client, db, monkeypatch):
    bd = make_user(db, "disc_bd3@premnathrail.com", ["crm"])
    eng = make_user(db, "disc_eng3@premnathrail.com", ["rnd"])
    inq = make_inquiry(db, bd)
    monkeypatch.setattr(settings, "SHAREPOINT_SITE_ID", "site")

    async def fake_upload(site, folder, f):
        return {"name": f.filename, "path": f"{folder}/{f.filename}", "size": 4}
    monkeypatch.setattr(disc_routes, "upload_file_to_sharepoint", fake_upload)

    r = client.post(f"{API}/inquiry/{inq.id}", data={"side": "rnd"}, files={"files": ("calc.pdf", b"%PDF", "application/pdf")}, headers=auth(eng))
    assert r.status_code == 200, r.text
    msg = r.json()
    assert msg["attachments"][0]["file_name"] == "calc.pdf"
    doc = db.get(CrmDocument, msg["attachments"][0]["id"])
    assert doc.shared_via_tor is True and doc.related_sub_module == "discussion"

    assert client.delete(f"{API}/comments/{msg['id']}", headers=auth(bd)).status_code == 403
    assert client.delete(f"{API}/comments/{msg['id']}", headers=auth(eng)).status_code == 200
    db.refresh(doc)
    assert doc.is_deleted is True
    assert client.get(f"{API}/inquiry/{inq.id}", params={"side": "rnd"}, headers=auth(eng)).json() == []


def test_bd_shares_client_and_internal_documents_of_the_record(client, db):
    bd = make_user(db, "disc_bd4@premnathrail.com", ["crm"])
    eng = make_user(db, "disc_eng4@premnathrail.com", ["rnd"])
    inq = make_inquiry(db, bd)

    def doc(folder, name, related_id=inq.id):
        d = CrmDocument(related_module="inquiry", related_id=related_id, folder_type=folder, file_name=name,
                        file_path=f"crm/{name}", sharepoint_path=f"crm/{name}", file_size=10, org_id=inq.org_id)
        db.add(d)
        db.commit()
        return d
    spec, note, other = doc("client", "spec.pdf"), doc("internal", "costing.xlsx"), doc("client", "elsewhere.pdf", related_id=inq.id + 99)

    r = client.post(f"{API}/inquiry/{inq.id}", data={"side": "crm", "document_ids": f"{spec.id},{note.id}"}, headers=auth(bd))
    assert r.status_code == 200, r.text
    shared = r.json()["attachments"]
    assert [a["file_name"] for a in shared] == ["spec.pdf", "costing.xlsx"]
    copy = db.get(CrmDocument, shared[0]["id"])
    # A pointer to the same file, opened to R&D; the original is left as it was.
    assert copy.id != spec.id and copy.sharepoint_path == spec.sharepoint_path and copy.shared_via_tor is True
    db.refresh(spec)
    assert spec.shared_via_tor is False and spec.is_deleted is False
    assert [m["attachments"][0]["file_name"] for m in client.get(f"{API}/inquiry/{inq.id}", params={"side": "rnd"}, headers=auth(eng)).json()] == ["spec.pdf"]

    # Another record's document, or R&D trying to pick from CRM documents, is refused.
    assert client.post(f"{API}/inquiry/{inq.id}", data={"side": "crm", "document_ids": str(other.id)}, headers=auth(bd)).status_code == 422
    assert client.post(f"{API}/inquiry/{inq.id}", data={"side": "rnd", "document_ids": str(spec.id)}, headers=auth(eng)).status_code == 403
