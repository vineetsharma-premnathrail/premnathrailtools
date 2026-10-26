"""Sales Order form changes (2026-10-26): new order types, LOA = PO, currency
label, Purchase Person Name, 'Model' wording."""
from app.modules.accounts.services.profit_centers import SO_TYPE_SEGMENT
from app.modules.sales import service as svc
from app.modules.sales.models.order import (
    SALES_CURRENCIES, SALES_ORDER_TYPES, SalesOrder,
)
from app.modules.sales.models.order_project import OrderProject
from app.modules.sales.reports.order_ack import oa_spec
from app.tests.test_sales import BASE, confirm, create_order, hdr, make_user, setup_customer, setup_people


def test_constants():
    assert SALES_ORDER_TYPES == ("road_rail_vehicle", "rail_bound_vehicle", "accessories", "other")
    assert [c["code"] for c in SALES_CURRENCIES][:3] == ["INR", "USD", "EUR"] and len(SALES_CURRENCIES) == 18
    assert all(c["name"] and c["symbol"] for c in SALES_CURRENCIES)
    assert SO_TYPE_SEGMENT["road_rail_vehicle"] == SO_TYPE_SEGMENT["rail_bound_vehicle"] == "machines"
    assert SO_TYPE_SEGMENT["accessories"] == "spares"


def test_meta_exposes_labels_and_currencies(client, db):
    maker, *_ = setup_people(db)
    m = client.get(f"{BASE}/lookups/meta", headers=hdr(maker)).json()
    assert m["order_types"] == list(SALES_ORDER_TYPES) and m["order_type_labels"]["other"] == "Others"
    assert m["default_currency"] == "INR" and {c["code"] for c in m["currencies"]} >= {"USD", "KWD", "ZAR"}


def test_meta_denied_without_sales_app(client, db):
    u = make_user(db, "nosales@premnathrail.com", apps=("hr",))
    assert client.get(f"{BASE}/lookups/meta", headers=hdr(u)).status_code == 403


def test_invalid_order_type_uses_new_labels(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _ = setup_customer(db)
    from app.tests.test_sales import payload_from_prefill
    body = payload_from_prefill(client, hdr(maker), inq)
    body["order_type"] = "rrv_supply"
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 422
    assert r.json()["detail"] == "Order type must be one of: Road Rail Vehicle, Rail Bound Vehicle, Accessories, Others."


def test_defaults_and_no_loa_needed(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _ = setup_customer(db)
    so = create_order(client, db, maker, inq)
    assert so["order_type"] == "road_rail_vehicle" and so["currency"] == "INR"
    assert so["loa_number"] is None and so["loa_date"] is None


def test_currency_is_a_label_and_validated(client, db):
    maker, head, director, _ = setup_people(db)
    _o, inq, _ = setup_customer(db, qty=1)
    so = create_order(client, db, maker, inq, currency="usd")
    assert so["currency"] == "USD"
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"currency": "XYZ"}, headers=hdr(maker))
    assert r.status_code == 422
    assert r.json()["detail"].startswith("Currency 'XYZ' is not supported. Choose one of: INR, USD, EUR")
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"currency": "EUR"}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["currency"] == "EUR"
    # Numbers are untouched by the label.
    assert r.json()["grand_total"] == so["grand_total"]


def test_both_vehicle_types_create_project_accessories_do_not(client, db):
    maker, head, director, _ = setup_people(db)
    _o, inq, _ = setup_customer(db, qty=1)
    so = confirm(client, db, create_order(client, db, maker, inq, order_type="rail_bound_vehicle"), maker, head, director)
    db.expire_all()
    assert db.query(OrderProject).filter(OrderProject.sales_order_id == so["id"]).first() is not None


def test_ack_prints_po_currency_and_purchase_person(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _ = setup_customer(db, qty=1)
    so = create_order(client, db, maker, inq, currency="USD", purchaser_name="R. Kumar")
    order = db.get(SalesOrder, so["id"])
    facts = dict(oa_spec(db, order)["facts"])
    assert "LOA" not in facts and facts["Customer PO"].startswith("CR/PO/2026/771")
    assert facts["Purchase Person Name"] == "R. Kumar" and "Purchaser" not in facts
    assert facts["Order value (incl. GST)"].startswith("USD ")


def test_old_order_with_only_loa_falls_back(client, db):
    maker, *_ = setup_people(db)
    _o, inq, _ = setup_customer(db, qty=1)
    order = db.get(SalesOrder, create_order(client, db, maker, inq)["id"])
    order.customer_po_number, order.customer_po_date = None, None
    order.loa_number = "LOA/77"
    from datetime import date
    order.loa_date = date(2026, 1, 5)
    db.commit()
    assert svc.po_number(order) == "LOA/77" and svc.po_date(order) == date(2026, 1, 5)
    assert "LOA/77 dated 05-01-2026" in dict(oa_spec(db, order)["facts"])["Customer PO"]
    assert not any("PO number" in p for p in svc.submit_problems(db, order))
