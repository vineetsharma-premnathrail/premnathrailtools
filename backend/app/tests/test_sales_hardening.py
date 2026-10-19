"""
Sales hardening (ERP review fixes): draft PATCH nulls / customer change /
trimming, month filter validation, amendments and DP extensions can't be
decided on a dead order (and are closed with it), reject cancels delivery
rows, attachment view / delete rules, the order-level LD cap on contract
value, and prefill never copying a rejected quotation.
"""
from datetime import date, datetime, timedelta, timezone

from app.modules.crm.models.inquiry import Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization
from app.modules.sales import service as svc
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.attachment import SalesAttachment
from app.modules.sales.models.extension import SalesDeliveryExtension
from app.modules.sales.models.order import SalesOrder
from app.tests.test_sales import (
    BASE, TODAY, make_user, hdr, setup_people, setup_customer, payload_from_prefill, create_order, confirm,
)


def _small_confirmed(client, db, maker, head, director, inq, due=None):
    body = payload_from_prefill(client, hdr(maker), inq)
    body["schedule"] = [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(due or TODAY + timedelta(days=90))}]
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    return confirm(client, db, r.json(), maker, head, director)


def _draft_amendment(client, so, maker, days=28):
    r = client.post(f"{BASE}/orders/{so['id']}/amendments", json={"reason": "Customer letter: site not ready"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    a = r.json()
    sched = a["proposed"]["schedule"]
    sched[0]["contract_delivery_date"] = str(date.fromisoformat(sched[0]["contract_delivery_date"]) + timedelta(days=days))
    r = client.patch(f"{BASE}/amendments/{a['id']}", json={"schedule": sched}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    return r.json()


def test_update_draft_nulls_customer_change_and_trim(client, db):
    maker, *_ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = create_order(client, db, maker, inq)
    assert so["place_of_supply_state_code"] == "27"

    for field, label in (("order_type", "Order type"), ("ld_applicable", "LD applicable"), ("pbg_required", "PBG required")):
        r = client.patch(f"{BASE}/orders/{so['id']}", json={field: None}, headers=hdr(maker))
        assert r.status_code == 422 and label in r.json()["detail"], r.text
    # A null currency is still just ignored (kept INR).
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"currency": None}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["currency"] == "INR"

    other = Organization(name="Northern Railway", gst_number="07AAAGN1234F1Z5", state="Delhi", city="New Delhi")
    db.add(other)
    db.commit()
    # Raised from an inquiry: the customer is that inquiry's organisation — it can't be swapped.
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_id": other.id}, headers=hdr(maker))
    assert r.status_code == 422 and "must be the same" in r.json()["detail"], r.text
    # A direct order's draft may change customer.
    from app.modules.sales.models.order import SalesOrder
    db.query(SalesOrder).filter(SalesOrder.id == so["id"]).update(
        {"source_type": "direct", "source_inquiry_id": None, "source_quotation_id": None})
    db.commit()
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_id": other.id, "customer_po_number": "  NR/PO/9  "}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["customer_name"] == "Northern Railway" and out["customer_gstin"] == "07AAAGN1234F1Z5"
    assert out["place_of_supply_state_code"] == "07"  # not the old customer's 27
    assert out["customer_contact_id"] is None
    assert out["customer_po_number"] == "NR/PO/9"


def test_month_filter_rejects_bad_month(client, db):
    maker, *_ = setup_people(db)
    for bad in ("2026-13", "2026-00", "oct"):
        r = client.get(f"{BASE}/orders", params={"month": bad}, headers=hdr(maker))
        assert r.status_code == 422 and "YYYY-MM" in r.json()["detail"], (bad, r.text)
    assert client.get(f"{BASE}/orders", params={"month": "2026-12"}, headers=hdr(maker)).status_code == 200


def test_prefill_skips_rejected_quotation(client, db):
    maker, *_ = setup_people(db)
    _org, inq, q = setup_customer(db, qty=2, price=4000000)
    q.customer_response, q.status = "Rejected", "lost"
    db.commit()
    r = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["source_quotation_id"] is None and p["lines"][0]["unit_price"] == 0 and "lost" in p["note"]

    q2 = Quotation(inquiry_id=inq.id, quot_number="QT-1-01-r2", customer_response="Negotiating", status="sent", created_at=datetime.now(timezone.utc))
    db.add(q2)
    db.commit()
    db.add(QuotationLineItem(quotation_id=q2.id, description="RRV 10T", model_number="RRV-10T", quantity=2, unit_price=3900000, gst_percent=18))
    q3 = Quotation(inquiry_id=inq.id, quot_number="QT-1-01-r3", customer_response="Rejected", status="lost", created_at=datetime.now(timezone.utc))
    db.add(q3)
    db.commit()
    p = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker)).json()
    assert p["source_quotation_id"] == q2.id and p["lines"][0]["unit_price"] == 3900000
    assert "QT-1-01-r2" in p["note"]


def test_reject_cancels_delivery_rows(client, db):
    maker, head, _director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    so = create_order(client, db, maker, inq)
    db.add(SalesAttachment(entity_type="sales_order", entity_id=so["id"], doc_type="customer_po", filename="po.pdf"))
    db.commit()
    assert client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker)).status_code == 200
    r = client.post(f"{BASE}/orders/{so['id']}/reject", json={"reason": "Price below cost"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert r.json()["schedules"] and all(s["status"] == "cancelled" for s in r.json()["schedules"])
    assert all(ln["qty_scheduled"] == 0 for ln in r.json()["lines"])


def test_cancel_closes_open_amendment_and_extension(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = _small_confirmed(client, db, maker, head, director, inq)
    a = _draft_amendment(client, so, maker)
    row = so["schedules"][0]
    r = client.post(f"{BASE}/orders/{so['id']}/extensions", json={
        "schedule_ids": [row["id"]], "requested_new_date": str(date.fromisoformat(row["current_delivery_date"]) + timedelta(days=30)),
        "reason_category": "customer_cause", "reason": "Drawing approval late"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    eid = r.json()["id"]

    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Customer withdrew"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
    assert "amendment 1 cancelled" in r.json()["cancel_reason"] and "DP-extension" in r.json()["cancel_reason"]
    assert db.get(SalesOrderAmendment, a["id"]).status == "cancelled"
    db.expire_all()
    e = db.get(SalesDeliveryExtension, eid)
    assert e.status == "refused" and "cancelled" in e.decision_remarks
    assert client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()["open_amendment_id"] is None


def test_amendment_and_extension_not_decided_on_dead_order(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = _small_confirmed(client, db, maker, head, director, inq)
    a = _draft_amendment(client, so, maker)
    r = client.post(f"{BASE}/amendments/{a['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    row = so["schedules"][0]
    r = client.post(f"{BASE}/orders/{so['id']}/extensions", json={
        "schedule_ids": [row["id"]], "requested_new_date": str(date.fromisoformat(row["current_delivery_date"]) + timedelta(days=30)),
        "reason_category": "customer_cause", "reason": "Drawing approval late"}, headers=hdr(maker))
    eid = r.json()["id"]
    # The order dies by a path that doesn't clean up (e.g. data fixed by hand): the decisions must still refuse.
    order = db.get(SalesOrder, so["id"])
    order.status = "short_closed"
    db.commit()

    r = client.post(f"{BASE}/amendments/{a['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 409 and "no longer open" in r.json()["detail"], r.text
    db.expire_all()
    assert db.get(SalesOrderAmendment, a["id"]).status == "pending_approval"
    assert db.get(SalesOrder, so["id"]).amendment_no == 0

    r = client.post(f"{BASE}/extensions/{eid}/grant", json={"granted_new_date": str(TODAY + timedelta(days=200)), "with_ld": False,
                                                            "customer_letter_ref": "CR/DPX/1"}, headers=hdr(head))
    assert r.status_code == 409 and "no longer applies" in r.json()["detail"]
    r = client.post(f"{BASE}/extensions/{eid}/refuse", json={"reason": "Customer said no"}, headers=hdr(head))
    assert r.status_code == 409


def test_attachment_view_and_delete_rules(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = _small_confirmed(client, db, maker, head, director, inq)
    a = _draft_amendment(client, so, maker)
    assert client.post(f"{BASE}/amendments/{a['id']}/submit", headers=hdr(maker)).status_code == 200
    r = client.post(f"{BASE}/amendments/{a['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text

    delivery_only = make_user(db, "planner@premnathrail.com", granular_permissions=["sales:delivery:view"])
    read_only = make_user(db, "reader@premnathrail.com", granular_permissions=["sales:orders:view"])
    po = SalesAttachment(entity_type="sales_order", entity_id=so["id"], doc_type="other", filename="note.pdf", created_by_id=read_only.id)
    letter = SalesAttachment(entity_type="sales_amendment", entity_id=a["id"], doc_type="other", filename="amd.pdf", created_by_id=maker.id)
    db.add_all([po, letter])
    db.commit()

    r = client.get(f"{BASE}/attachments", params={"entity_type": "sales_order", "entity_id": so["id"]}, headers=hdr(delivery_only))
    assert r.status_code == 403 and "Sales › Orders" in r.json()["detail"]
    assert client.get(f"{BASE}/attachments/{po.id}/content", headers=hdr(delivery_only)).status_code == 403
    assert client.get(f"{BASE}/attachments", params={"entity_type": "sales_order", "entity_id": so["id"]},
                      headers=hdr(read_only)).status_code == 200
    # The uploader without 'edit' can't delete.
    r = client.delete(f"{BASE}/attachments/{po.id}", headers=hdr(read_only))
    assert r.status_code == 403 and "edit" in r.json()["detail"]
    # The letter of an approved amendment is evidence.
    r = client.delete(f"{BASE}/attachments/{letter.id}", headers=hdr(maker))
    assert r.status_code == 409 and "corrected copy" in r.json()["detail"]


def test_ld_cap_on_contract_value_is_per_order():
    so = SalesOrder(ld_applicable=True, ld_max_percent=10, ld_basis="contract_value", taxable_total=1000)
    assert svc.order_ld_cap(so) == 100.0 and svc.clamp_order_ld(so, 300) == 100.0 and svc.clamp_order_ld(so, 40) == 40.0
    so.ld_basis = "delayed_value"
    assert svc.order_ld_cap(so) is None and svc.clamp_order_ld(so, 300) == 300.0
    so.ld_basis, so.ld_max_percent = "contract_value", None
    assert svc.order_ld_cap(so) is None


def test_ld_totals_respect_contract_cap(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=3, price=5000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    body.update({"ld_basis": "contract_value", "ld_max_percent": 1, "ld_rate_percent": 0.5, "ld_rate_period": "week"})
    body["schedule"] = [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY - timedelta(days=70))} for _ in range(3)]
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    so = confirm(client, db, r.json(), maker, head, director)
    cap = 0.01 * 15000000  # 1% of the ₹1.5 Cr contract
    assert all(s["ld_amount"] == cap for s in so["schedules"])  # each row alone hits the cap …
    assert so["ld_accrued"] == cap  # … but the order total can't exceed it
    rep = client.get(f"{BASE}/reports/ld-exposure", headers=hdr(maker)).json()
    assert next(d for d in rep if d["so_id"] == so["id"])["ld_accrued"] == cap
