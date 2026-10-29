"""New / draft Sales Order form rules (2026-10-28): "PO received on" required and
checked, warranty = applies (months from each vehicle's handover) or not applicable,
Terms & conditions picked from the saved lists (Payment Terms / Quote
Conditions / Notes, as on the CRM quotation)."""
from datetime import date, datetime, timedelta, timezone

from app.modules.sales import service as svc
from app.modules.sales.delivery import warranty_dates
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule
from app.modules.sales.routes.orders import terms_text
from app.tests.test_sales import BASE, TODAY, attach_po, hdr, make_user, payload_from_prefill, setup_customer, setup_people


def _body(client, maker, inq, **over):
    body = payload_from_prefill(client, hdr(maker), inq)
    body["customer_po_received_date"] = str(TODAY)
    body.update(over)
    return body


def _create(client, maker, inq, **over):
    r = client.post(f"{BASE}/orders", json=_body(client, maker, inq, **over), headers=hdr(maker))
    assert r.status_code == 200, r.text
    return r.json()


def test_po_received_date_required_and_checked_on_create(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _q = setup_customer(db)
    body = _body(client, maker, inq)
    body.pop("customer_po_received_date")
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 422 and "PO / LOA was received" in r.json()["detail"]

    r = client.post(f"{BASE}/orders", json=_body(client, maker, inq, customer_po_received_date=str(TODAY + timedelta(days=3))), headers=hdr(maker))
    assert r.status_code == 422 and "in the future" in r.json()["detail"]

    r = client.post(f"{BASE}/orders", json=_body(client, maker, inq, customer_po_date=str(TODAY),
                                                 customer_po_received_date=str(TODAY - timedelta(days=2))), headers=hdr(maker))
    assert r.status_code == 422 and "before the PO date" in r.json()["detail"]

    so = _create(client, maker, inq)
    assert so["customer_po_received_date"] == str(TODAY)


def test_draft_edit_checks_received_date_and_submit_needs_it(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _q = setup_customer(db)
    so = _create(client, maker, inq)
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"customer_po_received_date": str(TODAY + timedelta(days=1))}, headers=hdr(maker))
    assert r.status_code == 422 and "in the future" in r.json()["detail"]
    # Blank in a draft is allowed; submit then asks for it.
    assert client.patch(f"{BASE}/orders/{so['id']}", json={"customer_po_received_date": None}, headers=hdr(maker)).status_code == 200
    db.expire_all()
    problems = svc.submit_problems(db, db.get(SalesOrder, so["id"]))
    assert any("PO / LOA was received" in p for p in problems)


def test_warranty_not_applicable_and_from_handover(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _q = setup_customer(db)
    so = _create(client, maker, inq, warranty_rule="not_applicable", warranty_months_from_delivery=24, warranty_months_from_commissioning=12)
    assert so["warranty_rule"] == "not_applicable"
    assert so["warranty_months_from_delivery"] is None and so["warranty_months_from_commissioning"] is None
    attach_po(db, so["id"])
    db.expire_all()
    order = db.get(SalesOrder, so["id"])
    assert not [p for p in svc.submit_problems(db, order) if "arranty" in p]

    # Applies, but no months → a clear problem; with months → fine.
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"warranty_rule": "from_delivery", "warranty_months_from_delivery": None}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    db.expire_all()
    order = db.get(SalesOrder, so["id"])
    assert any("warranty period in months" in p for p in svc.submit_problems(db, order))
    client.patch(f"{BASE}/orders/{so['id']}", json={"warranty_months_from_delivery": 24}, headers=hdr(maker))
    db.expire_all()
    order = db.get(SalesOrder, so["id"])
    assert not [p for p in svc.submit_problems(db, order) if "arranty" in p]

    # Unknown rule values are still refused.
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"warranty_rule": "forever"}, headers=hdr(maker))
    assert r.status_code == 422 and "Warranty rule" in r.json()["detail"]


def test_warranty_dates_follow_handover_or_stay_empty():
    handed = date(2026, 3, 15)
    so = SalesOrder(warranty_rule="from_delivery", warranty_months_from_delivery=24)
    row = SalesOrderSchedule(delivered_on=handed, commissioned_on=None)
    assert warranty_dates(so, row) == (handed, date(2028, 3, 15))
    so.warranty_rule, so.warranty_months_from_delivery = "not_applicable", None
    assert warranty_dates(so, row) == (None, None)
    # Older rules keep working.
    so.warranty_rule, so.warranty_months_from_delivery, so.warranty_months_from_commissioning = "earlier_of", 30, 24
    row.commissioned_on = date(2026, 4, 1)
    assert warranty_dates(so, row) == (handed, date(2028, 4, 1))


def test_terms_are_picked_from_saved_lists_not_copied_from_the_quotation(client, db):
    from app.modules.crm.models.payment_term import PaymentTerm
    maker, *_ = setup_people(db)
    _org, inq, accepted = setup_customer(db)
    accepted.quote_conditions, accepted.notes = "Prices ex-works.", "Validity 90 days."
    db.add_all([PaymentTerm(label="Advance 20 / 80", description="20% advance, 80% against delivery", created_at=datetime.now(timezone.utc)),
                PaymentTerm(label="Old term", description="x", is_deleted=True, created_at=datetime.now(timezone.utc))])
    db.commit()
    # The quotation's terms are no longer copied into a new order.
    p = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker)).json()
    assert "special_conditions" not in p and "payment_terms_label" not in p and "delivery_terms_text" not in p
    # Sales users pick from the saved Payment Terms (deleted ones hidden).
    r = client.get("/api/v1/sales/lookups/payment-terms", headers=hdr(maker))
    assert r.status_code == 200 and [t["label"] for t in r.json()] == ["Advance 20 / 80"]
    outsider = make_user(db, "outsider@premnathrail.com", apps=("hr",))
    assert client.get("/api/v1/sales/lookups/payment-terms", headers=hdr(outsider)).status_code == 403


def test_terms_text_skips_empty_blocks():
    assert terms_text("30 days credit", None, "") == "Payment Terms: 30 days credit"
    assert terms_text(None, None, None) == ""
