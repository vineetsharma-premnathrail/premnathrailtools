"""CRM → Sales handoff (Sales plan §6.1): the by-source lookup behind the CRM
chip, and confirming a sales order closing its source inquiry / tender as
ordered through crm.services.won.mark_won."""
from types import SimpleNamespace

from app.modules.crm.models.organization import Organization
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.won import mark_won
from app.modules.main.models.audit_log import AuditLog
from app.tests.test_sales import BASE, confirm, create_order, hdr, make_user, setup_customer, setup_people


def test_by_source_lookup(client, db):
    maker, head, director, _ = setup_people(db)
    _, inq, _ = setup_customer(db)
    crm_user = make_user(db, "crm@premnathrail.com", apps=("crm",))
    outsider = make_user(db, "store@premnathrail.com", apps=("store",))

    # Nothing yet → order is null.
    r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(crm_user))
    assert r.status_code == 200, r.text
    assert r.json() == {"order": None, "can_raise": True}

    so = create_order(client, db, maker, inq)
    for user in (crm_user, maker):
        r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(user))
        assert r.status_code == 200, r.text
        assert r.json()["order"]["id"] == so["id"]
        assert r.json()["order"]["display_number"] == f"Draft #{so['id']}"
        assert r.json()["order"]["status"] == "draft"

    # Users without the sales or crm app can't read it.
    r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(outsider))
    assert r.status_code == 403

    # A cancelled draft no longer counts as the live order.
    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Raised by mistake"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(crm_user))
    assert r.json()["order"] is None


def test_confirm_marks_inquiry_won(client, db):
    maker, head, director, _ = setup_people(db)
    _, inq, _ = setup_customer(db)
    so = create_order(client, db, maker, inq)

    db.refresh(inq)
    assert inq.status != "Closed - Ordered"  # a draft doesn't close the inquiry

    done = confirm(client, db, so, maker, head, director)
    db.expire_all()
    db.refresh(inq)
    assert inq.status == "Closed - Ordered"
    assert inq.current_stage == "Order Received"
    log = db.query(CrmStageLog).filter(CrmStageLog.related_module == "inquiry", CrmStageLog.related_id == inq.id).all()
    assert any(done["so_number"] in (l.notes or "") for l in log)
    audit = db.query(AuditLog).filter(AuditLog.entity_type == "inquiry", AuditLog.entity_id == inq.id,
                                      AuditLog.action == "sales_order_confirmed").one()
    assert audit.new_value == "Closed - Ordered"

    r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(maker))
    assert r.json()["order"]["display_number"] == done["so_number"]
    assert r.json()["order"]["status"] == "confirmed"


def test_order_only_once_order_received(client, db):
    maker, _, _, _ = setup_people(db)
    org, inq, quot = setup_customer(db)
    # A quotation the customer accepted is enough, whatever the inquiry status (owner, 2026-10-28).
    inq.current_stage, inq.status = "Quotation Sent", "Quotation Sent"
    db.commit()
    assert client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker)).status_code == 200
    r = client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(maker))
    assert r.json()["can_raise"] is True
    assert any(s["id"] == inq.id and s["accepted_quotation"] == quot.quot_number
               for s in client.get(f"{BASE}/orders/sources", params={"kind": "inquiry"}, headers=hdr(maker)).json())
    # No accepted quotation (still with the customer), or closed as not ordered → refused.
    quot.status = "sent"
    db.commit()
    for stage, status in (("Quotation Sent", "Quotation Sent"), ("Order Received", "Closed - Not Ordered")):
        inq.current_stage, inq.status = stage, status
        db.commit()
        r = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker))
        assert r.status_code == 422, r.text
        assert "accept" in r.json()["detail"]
    assert client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(maker)).json()["can_raise"] is False
    assert all(s["id"] != inq.id for s in client.get(f"{BASE}/orders/sources", params={"kind": "inquiry"}, headers=hdr(maker)).json())

    t = Tender(universal_id="TND-SO-01", org_id=org.id, status="Negotiation")
    db.add(t)
    db.commit()
    r = client.get(f"{BASE}/orders/prefill", params={"tender": t.id}, headers=hdr(maker))
    assert r.status_code == 422 and "LOA / Order Received" in r.json()["detail"]
    t.status = "LOA / Order Received"
    db.commit()
    assert client.get(f"{BASE}/orders/prefill", params={"tender": t.id}, headers=hdr(maker)).status_code == 200


def test_mark_won_tender_and_idempotent(db):
    org = Organization(name="RVNL", state="Delhi", city="Delhi")
    db.add(org)
    db.commit()
    t = Tender(universal_id="TND-TEST-01", org_id=org.id)
    db.add(t)
    db.commit()
    actor = SimpleNamespace(id=None, name="Tester", email="t@premnathrail.com")
    so = SimpleNamespace(id=1, so_number="SO/26-27/0009", source_inquiry_id=None, source_tender_id=t.id)

    assert mark_won(db, so, actor) == "tender"
    db.commit()
    db.refresh(t)
    assert t.status == "Closed – Ordered" and t.current_stage == "Awarded / Lost"
    # Second call is a no-op (no duplicate timeline entry).
    assert mark_won(db, so, actor) is None
    assert mark_won(db, SimpleNamespace(id=2, so_number=None, source_inquiry_id=None, source_tender_id=None), actor) is None
    # A deleted source is skipped silently.
    t.is_deleted = True
    t.status = "Negotiation"
    db.commit()
    assert mark_won(db, so, actor) is None
