"""Country prices and prices in every currency (owner 2026-10-28).

Customer price > country price > list price; a price may be in any active
currency; /convert shows a price in every active currency at Finance's rate."""
from datetime import date

from app.modules.accounts.models.fx import Currency, ExchangeRate
from app.modules.crm.models.organization import Organization
from app.modules.products import pricing
from app.modules.products.models.product import FinishedProduct
from app.tests.test_erp_service_sap_gaps import hdr, mk_user

PC = "/api/v1/products/price-conditions"


def _setup(db):
    p = FinishedProduct(code="RRV-PX", name="RRV price test", product_type="vehicle")
    india = Organization(name="Central Railway", country="India")
    bd = Organization(name="Bangladesh Railway", country="Bangladesh")
    db.add_all([p, india, bd, Currency(code="USD", name="US Dollar", symbol="$"), Currency(code="EUR", name="Euro", symbol="€")])
    db.add(ExchangeRate(currency="USD", rate_date=date(2026, 1, 1), rate_type="bank", rate=80))
    db.commit()
    return p, india, bd


def test_country_price_sits_between_customer_and_list(client, db):
    p, india, bd = _setup(db)
    admin = mk_user(db, "price_admin@premnathrail.com", apps=("sales", "products"))
    base = {"condition_type": "price", "item_kind": "product", "product_id": p.id, "valid_from": "2026-01-01"}
    assert client.post(PC, json={**base, "amount": 5000000}, headers=hdr(admin)).status_code == 201
    r = client.post(PC, json={**base, "amount": 62000, "currency": "USD", "country": "Bangladesh"}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    assert r.json()["country"] == "Bangladesh" and r.json()["currency"] == "USD"
    # A product price for one customer → refused: products are priced by country (owner, 2026-10-29).
    r = client.post(PC, json={**base, "amount": 1, "customer_id": bd.id}, headers=hdr(admin))
    assert r.status_code == 422 and "priced by country" in r.json()["detail"]
    # A currency missing from Finance's currency master → refused with where to add it.
    r = client.post(PC, json={**base, "amount": 1, "currency": "JPY", "country": "Japan"}, headers=hdr(admin))
    assert r.status_code == 422 and "Currencies & FX" in r.json()["detail"]

    on = date(2026, 6, 1)
    assert pricing.resolve(db, product_id=p.id, customer_id=india.id, on=on)["price_source"] == "list"
    bd_price = pricing.resolve(db, product_id=p.id, customer_id=bd.id, on=on)
    assert bd_price["price_source"] == "country" and bd_price["price"] == 62000 and bd_price["currency"] == "USD"


def test_price_converts_into_every_active_currency(client, db):
    _setup(db)
    admin = mk_user(db, "fx_admin@premnathrail.com", apps=("sales", "products"))
    r = client.get(f"{PC}/convert", params={"amount": 8000000, "currency": "INR"}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    rows = {x["currency"]: x for x in r.json()["rows"]}
    assert rows["INR"]["amount"] == 8000000
    assert rows["USD"]["amount"] == 100000 and rows["USD"]["rate"] == 80
    # No EUR rate yet: no amount, and it says where to enter the rate.
    assert rows["EUR"]["amount"] is None and "Currencies & FX" in rows["EUR"]["note"]
