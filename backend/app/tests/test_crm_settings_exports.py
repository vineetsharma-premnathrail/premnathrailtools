"""CRM → Settings notification rules (organization / inquiry / tender /
discussion) and the Organizations + Inquiries & Tenders Excel exports."""
import io
from datetime import datetime, timezone

from openpyxl import load_workbook

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User


def make_user(db, email, role="user", apps=("crm",)):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def rule(client, admin, event, users):
    r = client.put("/api/v1/crm/settings", json={"values": {f"notify_{event}_enabled": True, f"notify_{event}_users": [u.id for u in users]}}, headers=auth(admin))
    assert r.status_code == 200, r.text


def test_rules_notify_selected_people_only(client, db):
    admin = make_user(db, "crmset_admin@premnathrail.com", role="admin")
    bd = make_user(db, "crmset_bd@premnathrail.com")
    watcher = make_user(db, "crmset_watch@premnathrail.com")
    for ev in ("organization_create", "inquiry_create", "tender_create"):
        rule(client, admin, ev, [watcher])

    org = client.post("/api/v1/crm/organizations", json={"org_scope": "domestic", "name": "Rule Test Org", "org_type": "Customer"}, headers=auth(bd))
    assert org.status_code == 201, org.text
    oid = org.json()["id"]
    contact = client.post(f"/api/v1/crm/organizations/{oid}/contacts", json={"name": "SSE"}, headers=auth(bd)).json()
    r = client.post("/api/v1/crm/inquiries", json={"org_id": oid, "org_contact_id": contact["id"], "lead_source": "Direct", "product": "Drill"}, headers=auth(bd))
    assert r.status_code == 201, r.text
    r = client.post("/api/v1/crm/tenders", json={"org_id": oid, "tender_name": "Track machine", "lead_source": "Direct"}, headers=auth(bd))
    assert r.status_code == 201, r.text

    types = sorted(t for (t,) in db.query(Notification.notification_type).filter(Notification.user_id == watcher.id, Notification.notification_type.like("crm_rule_%")))
    assert types == ["crm_rule_inquiry_create", "crm_rule_organization_create", "crm_rule_tender_create"]
    assert db.query(Notification).filter(Notification.user_id == bd.id, Notification.notification_type.like("crm_rule_%")).count() == 0


def test_discussion_notification_rule_is_gone(client, db):
    """Discussion was removed (2026-10-30): its notification rule can no longer be set."""
    admin = make_user(db, "crmset_admin2@premnathrail.com", role="admin")
    r = client.put("/api/v1/crm/settings", json={"values": {"notify_discussion_message_enabled": True}}, headers=auth(admin))
    assert r.status_code == 422, r.text
    from app.modules.crm.settings import NOTIFY_EVENTS
    assert "discussion_message" not in NOTIFY_EVENTS


def test_exports(client, db):
    admin = make_user(db, "crmexp_admin@premnathrail.com", role="admin")
    o1 = Organization(name="Alpha Rail", created_at=datetime(2026, 1, 5, 6, tzinfo=timezone.utc))
    o2 = Organization(name="Beta Works", created_at=datetime(2026, 3, 5, 6, tzinfo=timezone.utc))
    db.add_all([o1, o2])
    db.flush()
    i1 = Inquiry(universal_id="INQ-X1", org_id=o1.id, lead_source="Direct", created_at=datetime(2026, 1, 6, 6, tzinfo=timezone.utc))
    t1 = Tender(universal_id="TND-X1", org_id=o2.id, tender_name="Bridge", created_at=datetime(2026, 3, 6, 6, tzinfo=timezone.utc))
    db.add_all([i1, t1])
    db.commit()

    def sheets(resp):
        assert resp.status_code == 200, resp.text
        wb = load_workbook(io.BytesIO(resp.content))
        return {ws.title: [r[0] for r in ws.iter_rows(min_row=2, values_only=True) if r[0] is not None] for ws in wb.worksheets}

    h = auth(admin)
    def org_names(resp):
        assert resp.status_code == 200, resp.text
        return [row[1] for row in load_workbook(io.BytesIO(resp.content)).active.iter_rows(min_row=2, values_only=True)]

    assert org_names(client.get("/api/v1/crm/exports/organizations", headers=h)) == ["Alpha Rail", "Beta Works"]
    assert org_names(client.get("/api/v1/crm/exports/organizations", params={"ids": str(o2.id)}, headers=h)) == ["Beta Works"]
    r = client.get("/api/v1/crm/exports/organizations", params={"date_from": "2026-03-01", "date_to": "2026-03-31"}, headers=h)
    wb = load_workbook(io.BytesIO(r.content))
    assert [row[1] for row in wb.active.iter_rows(min_row=2, values_only=True)] == ["Beta Works"]

    both = sheets(client.get("/api/v1/crm/exports/inquiries-tenders", headers=h))
    assert both == {"Inquiries": ["INQ-X1"], "Tenders": ["TND-X1"]}
    only_jan = sheets(client.get("/api/v1/crm/exports/inquiries-tenders", params={"date_from": "2026-01-01", "date_to": "2026-01-31"}, headers=h))
    assert only_jan == {"Inquiries": ["INQ-X1"], "Tenders": []}
    picked = sheets(client.get("/api/v1/crm/exports/inquiries-tenders", params={"tender_ids": str(t1.id)}, headers=h))
    assert picked == {"Tenders": ["TND-X1"]}
    assert client.get("/api/v1/crm/exports/inquiries-tenders", params={"date_from": "2026-05-01", "date_to": "2026-01-01"}, headers=h).status_code == 422
