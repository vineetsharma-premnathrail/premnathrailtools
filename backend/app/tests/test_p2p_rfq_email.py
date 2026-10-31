"""Emailed RFQs (2026-10-22): pick vendors → the RFQ is emailed to each with
a quote-by date → the buyer records the replies as line quotations → the
comparison ranks L1; reminders the day before the date, the buyer told when
it passes; real reasons when a vendor can't be emailed."""
from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.notification import Notification
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.rfq_invite import RFQVendorInvite
from app.tasks.rfq_reminders import _send_rfq_reminders
from app.tests.p2p_workflow_helpers import master_item
from app.tests.test_p2p_requests import (  # noqa: F401 — _sqlite_number_series is an autouse fixture
    _approve_pr, _create_pr, _purchaser, _requester, _sqlite_number_series, auth_header,
)

RFQS = "/api/v1/p2p/rfqs"


@pytest.fixture
def mails(monkeypatch):
    sent = []

    async def fake(sender, subject, html, to_email, to_name, extra_attachments=None, sender_name="", reply_to=None):
        sent.append({"from": sender, "to": to_email, "subject": subject, "html": html, "reply_to": reply_to})
        return (False, "Graph error 550: mailbox unavailable") if to_email == "bounce@vendor.test" else (True, "")

    monkeypatch.setattr(settings, "SENDER_EMAIL", "erp@premnathrail.com")
    monkeypatch.setattr("app.modules.p2p.rfq_mail._send_graph_mail", fake)
    return sent


def _vendor(db, code, name, email):
    v = Vendor(code=code, name=name, status="active", gst_registration_type="unregistered", contact_email=email, contact_name=f"{name} Sales")
    db.add(v)
    db.commit()
    return v


@pytest.fixture
def rfq(client, db):
    a = master_item(db, "Hydraulic hose RFQ", code="RFQ-A", uom="Nos")
    requester = _requester(db, "rfqmail.req@premnathrail.com")
    pr = _create_pr(client, requester, items=[{"store_item_id": a.id, "quantity": 6, "project_inhouse": "Project"}])
    _approve_pr(client, pr)
    row = db.get(P2PRequest, pr["id"])
    buyer = _purchaser(db, "rfqmail.buyer@premnathrail.com")
    for it in row.items:
        it.fulfillment_status = "sent_to_procurement"
        it.buyer_id = buyer.id  # an RFQ is raised by the buyer of the lines
    db.commit()
    r = client.post(RFQS, json={"p2p_request_id": pr["id"]}, headers=auth_header(buyer))
    assert r.status_code == 200, r.text
    vs = [_vendor(db, f"V-RM{n}", f"Vendor {n}", f"v{n}@vendor.test") for n in (1, 2, 3)]
    return {"id": r.json()["id"], "buyer": buyer, "vendors": vs, "line": row.items[0].id, "pr": row}


def _h(s):
    return auth_header(s["buyer"])


def test_rfq_is_emailed_to_every_invited_vendor_and_quotes_rank_l1(client, db, rfq, mails):
    s = rfq
    due = (date.today() + timedelta(days=3)).isoformat()
    client.patch(f"{RFQS}/{s['id']}", json={"late_delivery_clause": "0.5% per week, max 10%"}, headers=_h(s))
    r = client.put(f"{RFQS}/{s['id']}/invites", json={"vendor_ids": [v.id for v in s["vendors"]], "quote_due_date": due,
                                                      "invite_message": "Urgent for site"}, headers=_h(s))
    assert r.status_code == 200, r.text
    assert len(r.json()["invites"]) == 3 and r.json()["invites"][0]["quote_status"] == "not_sent"

    sub = client.post(f"{RFQS}/{s['id']}/submit", headers=_h(s))
    assert sub.status_code == 200, sub.text
    assert sorted(m["to"] for m in mails) == ["v1@vendor.test", "v2@vendor.test", "v3@vendor.test"]
    m = mails[0]
    assert "Request for Quotation" in m["subject"] and "Hydraulic hose RFQ" in m["html"] and "0.5% per week" in m["html"]
    # Sent from the buyer's own mailbox, not the service mailbox.
    assert "Urgent for site" in m["html"] and m["from"] == "rfqmail.buyer@premnathrail.com"
    db.refresh(s["pr"])
    assert s["pr"].status == "vendor_quotations"

    rows = client.get(f"{RFQS}/{s['id']}/invites", headers=_h(s)).json()["invites"]
    assert {r["quote_status"] for r in rows} == {"waiting"}

    # Two vendors reply by email; the buyer records them.
    for v, price in ((s["vendors"][0], 120), (s["vendors"][1], 95)):
        q = client.post(f"{RFQS}/{s['id']}/line-quotations", headers=_h(s),
                        json={"vendor_id": v.id, "items": [{"pr_item_id": s["line"], "unit_price": price, "gst_rate": 18}]})
        assert q.status_code == 200, q.text
    rows = {r["vendor_id"]: r for r in client.get(f"{RFQS}/{s['id']}/invites", headers=_h(s)).json()["invites"]}
    assert rows[s["vendors"][0].id]["quote_status"] == "quoted" and rows[s["vendors"][2].id]["quote_status"] == "waiting"
    cmp = client.get(f"{RFQS}/{s['id']}/comparison", headers=_h(s)).json()
    l1 = next(c for c in cmp["lines"][0]["quotes"] if c["rank"] == "L1")
    assert l1["vendor_quotation_id"] == rows[s["vendors"][1].id]["vendor_quotation_id"]

    got = client.get(f"{RFQS}/{s['id']}", headers=_h(s)).json()
    assert got["invite_count"] == 3 and got["awarded_line_count"] == 0
    l1_item = next(i["id"] for q in client.get(f"{RFQS}/{s['id']}/line-quotations", headers=_h(s)).json()
                   if q["id"] == l1["vendor_quotation_id"] for i in q["items"])
    r = client.post(f"{RFQS}/{s['id']}/awards", headers=_h(s),
                    json={"awards": [{"pr_item_id": s["line"], "vendor_quotation_item_id": l1_item}]})
    assert r.status_code == 200, r.text
    got = client.get(f"{RFQS}/{s['id']}", headers=_h(s)).json()
    assert got["awarded_line_count"] == 1 and got["awarded_vendors"] == ["Vendor 2"] and got["other_quoted_vendors"] == ["Vendor 1"]

    # Remind reaches only the vendor who hasn't quoted.
    mails.clear()
    assert client.post(f"{RFQS}/{s['id']}/invites/remind", headers=_h(s)).status_code == 200
    assert [m["to"] for m in mails] == ["v3@vendor.test"] and mails[0]["subject"].startswith("Reminder:")


def test_vendor_without_email_or_too_few_vendors_get_real_reasons(client, db, rfq, mails):
    s = rfq
    no_mail = _vendor(db, "V-RM9", "Silent Traders", None)
    r = client.put(f"{RFQS}/{s['id']}/invites", json={"vendor_ids": [no_mail.id]}, headers=_h(s))
    assert r.status_code == 400 and "No email in the vendor master for Silent Traders" in r.json()["detail"]

    due = (date.today() + timedelta(days=2)).isoformat()
    client.patch(f"{RFQS}/{s['id']}", json={"late_delivery_clause": "As per company terms"}, headers=_h(s))
    client.put(f"{RFQS}/{s['id']}/invites", json={"vendor_ids": [s["vendors"][0].id], "quote_due_date": due}, headers=_h(s))
    r = client.post(f"{RFQS}/{s['id']}/submit", headers=_h(s))
    assert r.status_code == 400 and "at least 3" in r.json()["detail"]
    client.patch(f"{RFQS}/{s['id']}", json={"single_quotation_reason": "Sole OEM supplier"}, headers=_h(s))
    assert client.post(f"{RFQS}/{s['id']}/submit", headers=_h(s)).status_code == 200


def test_failed_email_is_recorded_and_resend_after_fixing_it(client, db, rfq, mails):
    s = rfq
    s["vendors"][2].contact_email = "bounce@vendor.test"
    db.commit()
    client.patch(f"{RFQS}/{s['id']}", json={"late_delivery_clause": "x"}, headers=_h(s))
    client.put(f"{RFQS}/{s['id']}/invites", json={"vendor_ids": [v.id for v in s["vendors"]],
                                                  "quote_due_date": date.today().isoformat()}, headers=_h(s))
    assert client.post(f"{RFQS}/{s['id']}/submit", headers=_h(s)).status_code == 200
    rows = {r["vendor_id"]: r for r in client.get(f"{RFQS}/{s['id']}/invites", headers=_h(s)).json()["invites"]}
    bad = rows[s["vendors"][2].id]
    assert bad["email_status"] == "failed" and "550" in bad["send_error"] and bad["quote_status"] == "not_sent"

    s["vendors"][2].contact_email = "v3new@vendor.test"
    db.commit()
    r = client.post(f"{RFQS}/{s['id']}/invites/{bad['id']}/resend", headers=_h(s))
    assert r.status_code == 200
    assert next(x for x in r.json()["invites"] if x["id"] == bad["id"])["email_status"] == "sent"


def test_daily_job_reminds_the_day_before_and_tells_the_buyer_after(client, db, rfq, mails):
    s = rfq
    client.patch(f"{RFQS}/{s['id']}", json={"late_delivery_clause": "x"}, headers=_h(s))
    client.put(f"{RFQS}/{s['id']}/invites", json={"vendor_ids": [v.id for v in s["vendors"]],
                                                  "quote_due_date": (date.today() + timedelta(days=1)).isoformat()}, headers=_h(s))
    client.post(f"{RFQS}/{s['id']}/submit", headers=_h(s))
    client.post(f"{RFQS}/{s['id']}/line-quotations", headers=_h(s),
                json={"vendor_id": s["vendors"][0].id, "items": [{"pr_item_id": s["line"], "unit_price": 10}]})
    mails.clear()
    _send_rfq_reminders(db)
    assert sorted(m["to"] for m in mails) == ["v2@vendor.test", "v3@vendor.test"]
    mails.clear()
    _send_rfq_reminders(db)  # once per vendor
    assert mails == []

    # The date passes: the buyer hears how many quoted, once.
    from app.modules.p2p.models.rfq import RFQ
    db.get(RFQ, s["id"]).quote_due_date = date.today() - timedelta(days=1)
    db.commit()
    _send_rfq_reminders(db)
    _send_rfq_reminders(db)
    notes = db.query(Notification).filter(Notification.notification_type == "rfq_quotes_due").all()
    assert len(notes) == 1 and "1 of 3 vendors quoted" in notes[0].message
    assert db.query(RFQVendorInvite).filter(RFQVendorInvite.reminder_sent_at.is_not(None)).count() == 2
