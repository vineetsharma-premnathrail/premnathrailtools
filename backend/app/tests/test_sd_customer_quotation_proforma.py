"""SD wave 2 (CRM / Sales): customer master tax data, the SO consignee,
quotation document status + release on the central approval engine, quotation
expiry, opportunity owners / lost reasons / win-loss + forecast, and the
proforma invoice for an advance milestone."""
from datetime import date, datetime, timedelta, timezone

from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.crm.models.organization import Organization
from app.modules.crm.services import quotation_status as qs
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.organization.models.company import Company
from app.modules.organization.services import approval_engine as engine
from app.modules.sales.models.order import SalesOrder
from app.tests.quote_lines import LINE_REF, quote_product  # noqa: F401 — autouse fixture
from app.tests.test_accounts_finance import gstin_for
from app.tests.test_sales import BASE, confirm, create_order, hdr, make_user, setup_customer, setup_people

CRM = "/api/v1/crm"
ITEM = {"description": "RRV 10T", "model_number": "RRV-10T", "quantity": 1, "unit_price": 1000000, "gst_percent": 18, **LINE_REF}


# ---------------------------------------------------------------- customer master

def test_org_pan_and_gst_state_derived_and_checked(client, db):
    admin = make_user(db, "sd.admin@premnathrail.com", apps=("crm",), role="admin")
    gstin = gstin_for("27", "AAACR1234C")
    r = client.post(f"{CRM}/organizations", json={"org_scope": "domestic", "name": "Central Railway HQ", "org_type": "Railway", "gst_number": gstin}, headers=hdr(admin))
    assert r.status_code == 201, r.text
    assert (r.json()["pan"], r.json()["gst_state_code"]) == ("AAACR1234C", "27")
    org_id = r.json()["id"]

    bad = client.patch(f"{CRM}/organizations/{org_id}", json={"pan": "AAACX9999X"}, headers=hdr(admin))
    assert bad.status_code == 422 and "doesn't match GSTIN" in bad.json()["detail"]
    bad = client.patch(f"{CRM}/organizations/{org_id}", json={"pan": "12345"}, headers=hdr(admin))
    assert bad.status_code == 422 and "10 characters" in bad.json()["detail"]
    # Unregistered customer: the state name gives the GST state (place of supply).
    r = client.post(f"{CRM}/organizations", json={"org_scope": "domestic", "name": "Workshop X", "org_type": "Private", "state": "Delhi"}, headers=hdr(admin))
    assert r.json()["gst_state_code"] == "07"


def test_so_consignee_typed_on_the_delivery_row(client, db):
    # The customer Addresses tab was removed: the consignee (name, address,
    # GSTIN) is typed on the SO delivery schedule row itself.
    maker, head, director, _ = setup_people(db)
    org, inq, _q = setup_customer(db, qty=1, price=1000000)
    shed = gstin_for("09", "AAAGC1234F")
    so = create_order(client, db, maker, inq)
    body = [{"id": so["schedules"][0]["id"], "line_number": 1, "quantity": 1, "consignee_name": "ELS Ghaziabad",
             "consignee_address": "Loco Shed Rd, Ghaziabad", "consignee_gstin": shed,
             "contract_delivery_date": so["schedules"][0]["contract_delivery_date"]}]
    r = client.put(f"{BASE}/orders/{so['id']}/schedule", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    row = r.json()["schedules"][0]
    assert (row["consignee_name"], row["consignee_address"], row["consignee_gstin"]) == ("ELS Ghaziabad", "Loco Shed Rd, Ghaziabad", shed)


def test_place_of_supply_defaults_from_customer_gst_state(db):
    from app.modules.sales import service as svc
    org = Organization(name="Unregistered Buyer", state="Delhi", gst_state_code="07")
    db.add(org)
    db.commit()
    so = SalesOrder(customer_id=org.id, status="draft")
    svc.snapshot_customer(db, so)
    assert so.place_of_supply_state_code == "07"


# ---------------------------------------------------------------- quotation status

def _people(db):
    owner = make_user(db, "q.owner@premnathrail.com", apps=("crm",))
    head = make_user(db, "q.head@premnathrail.com", apps=("crm", "sales"))
    director = make_user(db, "q.dir@premnathrail.com", apps=("crm", "sales"), is_director=True)
    partner = make_user(db, "q.partner@premnathrail.com", apps=("crm", "sales"), is_partner=True)
    db.add(ModuleSetting(module_key="sales", key="sales_head_id", value=head.id))
    db.commit()
    return owner, head, director, partner


def _inq(db, owner, n=1):
    org = Organization(name=f"Customer {n}")
    db.add(org)
    db.flush()
    inq = Inquiry(universal_id=f"PRT-INQ-2026-07{n:02d}", org_id=org.id, created_by_id=owner.id)
    db.add(inq)
    db.commit()
    return inq


def _quote(client, inq, owner, **extra):
    r = client.post(f"{CRM}/inquiries/{inq.id}/quotations",
                    json={"items": [ITEM], "quote_date": str(date.today()), **extra}, headers=hdr(owner))
    assert r.status_code == 201, r.text
    return r.json()


def _act(client, inq, q, action, user, **body):
    return client.post(f"{CRM}/inquiries/{inq.id}/quotations/{q['id']}/{action}", json=body, headers=hdr(user))


def test_quotation_draft_approve_send_accept_and_prefill(client, db):
    owner, head, _d, _p = _people(db)
    inq = _inq(db, owner)
    q = _quote(client, inq, owner, customer_response="Accepted")
    assert q["status"] == "draft" and q["customer_response"] == qs.AWAITING  # never created as accepted
    assert _act(client, inq, q, "send", owner).status_code == 409  # not approved yet

    r = _act(client, inq, q, "submit", owner)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["status_view"]["approval_stage"] == "Sales Head"
    # The creator can't approve; the Sales Head can.
    assert _act(client, inq, q, "approve", owner).status_code == 403
    # Revising while waiting for approval is refused.
    assert client.patch(f"{CRM}/inquiries/{inq.id}/quotations/{q['id']}", json={"delivery_time": "6 weeks"},
                        headers=hdr(owner)).status_code == 409
    r = _act(client, inq, q, "approve", head)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["approved_by_id"] == head.id

    r = _act(client, inq, q, "send", owner)
    assert r.status_code == 200 and r.json()["status"] == "sent" and r.json()["valid_until"]  # default validity filled
    assert _act(client, inq, q, "lost", owner).status_code == 422  # a reason is required
    r = _act(client, inq, q, "accept", owner)
    assert r.json()["status"] == "accepted" and r.json()["customer_response"] == "Accepted"

    # Sales prefill takes the quotation by status.
    db.get(Inquiry, inq.id).current_stage = "Order Received"
    db.commit()
    sales_maker = make_user(db, "q.sales@premnathrail.com", apps=("sales",))
    p = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(sales_maker)).json()
    assert p["source_quotation_id"] == q["id"] and "accepted" in p["note"]


def test_quotation_return_and_revision_back_to_draft(client, db):
    owner, head, _d, _p = _people(db)
    inq = _inq(db, owner, 2)
    q = _quote(client, inq, owner)
    _act(client, inq, q, "submit", owner)
    assert _act(client, inq, q, "return", head).status_code == 422  # return needs a reason
    r = _act(client, inq, q, "return", head, comment="Check the GST rate")
    assert r.json()["status"] == "draft" and "Check the GST rate" in r.json()["status_comment"]

    _act(client, inq, q, "submit", owner)
    _act(client, inq, q, "approve", head)
    _act(client, inq, q, "send", owner)
    # Once approved and sent the quotation is finalised — a new price is a new quotation.
    rev = client.patch(f"{CRM}/inquiries/{inq.id}/quotations/{q['id']}", json={"items": [{**ITEM, "unit_price": 950000}]},
                       headers=hdr(owner))
    assert rev.status_code == 409 and "Create Quote" in rev.json()["detail"]


def test_discount_and_value_escalate_to_director_and_partner(client, db):
    owner, head, director, partner = _people(db)
    inq = _inq(db, owner, 3)
    q = _quote(client, inq, owner, discount=15, discount_type="percent")
    _act(client, inq, q, "submit", owner)
    req = engine.latest_request(db, qs.APPROVAL_ENTITY, q["id"])
    assert [s.stage_name for s in req.steps] == ["Sales Head", "Director"]

    big = _quote(client, inq, owner, items=[{**ITEM, "unit_price": 30000000}])
    r = _act(client, inq, big, "submit", owner)
    assert r.status_code == 200, r.text
    req = engine.latest_request(db, qs.APPROVAL_ENTITY, big["id"])
    assert [s.stage_name for s in req.steps] == ["Sales Head", "Director", "Partner"]
    for u in (head, director, partner):
        assert _act(client, inq, big, "approve", u).status_code == 200
    assert db.get(Quotation, big["id"]).status == "approved"


def test_auto_approve_limit_and_expiry(client, db):
    owner, *_ = _people(db)
    db.add(ModuleSetting(module_key="sales", key="quotation_auto_approve_value", value=5000000))
    db.commit()
    inq = _inq(db, owner, 4)
    q = _quote(client, inq, owner)
    r = _act(client, inq, q, "submit", owner)
    assert r.json()["status"] == "approved"  # within the no-approval limit
    _act(client, inq, q, "send", owner)
    row = db.get(Quotation, q["id"])
    row.valid_until = date.today() - timedelta(days=1)
    db.commit()
    listed = client.get(f"{CRM}/inquiries/{inq.id}/quotations", headers=hdr(owner)).json()
    assert listed[0]["status"] == "expired" and listed[0]["customer_response"] == "Expired"


def test_submit_without_approver_explains(client, db):
    owner = make_user(db, "q.solo@premnathrail.com", apps=("crm",))
    inq = _inq(db, owner, 5)
    q = _quote(client, inq, owner)
    r = _act(client, inq, q, "submit", owner)
    assert r.status_code == 422 and "Sales Head" in r.json()["detail"]
    assert db.get(Quotation, q["id"]).status == "draft"


# ---------------------------------------------------------------- opportunity

def test_lost_needs_reason_competitor_and_owner_is_a_user(client, db):
    owner = make_user(db, "o.owner@premnathrail.com", apps=("crm",))
    bd = make_user(db, "o.bd@premnathrail.com", apps=("crm",))
    outsider = make_user(db, "o.out@premnathrail.com", apps=("store",))
    inq = _inq(db, owner, 6)
    url = f"{CRM}/inquiries/{inq.id}"
    # BD owner = the creator and can't be changed (owner rule 2026-10-24) — not to anyone.
    for other in (outsider, bd):
        r = client.patch(url, json={"bd_owner_id": other.id}, headers=hdr(owner))
        assert r.status_code == 422 and "can't be changed" in r.json()["detail"]
    r = client.patch(url, json={"expected_value": 1000000, "probability": 40}, headers=hdr(owner))
    assert r.status_code == 200
    assert client.patch(url, json={"probability": 140}, headers=hdr(owner)).status_code == 422

    lost = {"current_stage": "Closed – Not Ordered"}
    r = client.patch(url, json=lost, headers=hdr(owner))
    assert r.status_code == 422 and "lost reason" in r.json()["detail"]
    r = client.patch(url, json={**lost, "lost_reason_code": "competitor"}, headers=hdr(owner))
    assert r.status_code == 422 and "competitor" in r.json()["detail"]
    r = client.patch(url, json={**lost, "lost_reason_code": "competitor", "lost_to_competitor": "Rival Rail"}, headers=hdr(owner))
    assert r.status_code == 200, r.text
    assert r.json()["closed_at"]

    # Data scope by the owner FK: the BD owner sees it.
    assert client.get(url, headers=hdr(bd)).status_code == 200

    rep = client.get(f"{CRM}/opportunity/win-loss", headers=hdr(owner)).json()
    assert rep["lost"] == 1 and rep["by_competitor"][0]["competitor"] == "Rival Rail"
    assert rep["by_reason"][0]["code"] == "competitor"


def test_forecast_weights_open_pipeline(client, db):
    owner = make_user(db, "f.owner@premnathrail.com", apps=("crm",))
    inq = _inq(db, owner, 7)
    inq.expected_value, inq.probability, inq.expected_order_date = 2000000, 50, date(2026, 12, 15)
    db.commit()
    f = client.get(f"{CRM}/opportunity/forecast", headers=hdr(owner)).json()
    assert f["weighted_value"] == 1000000 and f["by_month"][0]["month"] == "2026-12"


# ---------------------------------------------------------------- proforma invoice

def test_proforma_for_advance_milestone(client, db):
    db.add(Company(name="Premnath Rail Tools", code="PRT", gstin=gstin_for("27")))
    db.commit()
    maker, head, director, _ = setup_people(db)
    _org, inq, _q = setup_customer(db, qty=1, price=1000000)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    adv = next(b for b in so["billing_lines"] if b["milestone_type"] == "advance")
    other = next(b for b in so["billing_lines"] if b["milestone_type"] != "advance")
    url = f"{BASE}/orders/{so['id']}/proforma"

    assert client.post(url, json={"billing_line_id": other["id"]}, headers=hdr(maker)).status_code == 422
    r = client.post(url, json={"billing_line_id": adv["id"]}, headers=hdr(maker))
    assert r.status_code == 201, r.text
    pi = r.json()
    assert pi["pi_number"].startswith("PI/") and not pi["interstate"]
    assert (pi["taxable_amount"], pi["cgst_amount"], pi["sgst_amount"], pi["total_amount"]) == (200000, 18000, 18000, 236000)
    dup = client.post(url, json={"billing_line_id": adv["id"]}, headers=hdr(maker))
    assert dup.status_code == 409 and pi["pi_number"] in dup.json()["detail"]

    # Finance lookup, then cancel (reason required) and re-issue with a new number.
    assert client.get(f"{BASE}/proforma", params={"so_id": so["id"], "status": "issued"}, headers=hdr(maker)).json()[0]["id"] == pi["id"]
    assert client.post(f"{BASE}/proforma/{pi['id']}/cancel", json={}, headers=hdr(maker)).status_code == 422
    c = client.post(f"{BASE}/proforma/{pi['id']}/cancel", json={"reason": "Wrong PO date"}, headers=hdr(maker))
    assert c.status_code == 200 and c.json()["status"] == "cancelled"
    again = client.post(url, json={"billing_line_id": adv["id"]}, headers=hdr(maker)).json()
    assert again["pi_number"] != pi["pi_number"]

    # Draft orders can't have a PI.
    from app.modules.sales.reports.proforma import pi_spec
    spec = pi_spec(db, db.get(__import__("app.modules.sales.models.proforma", fromlist=["x"]).SalesProformaInvoice, again["id"]),
                   db.get(SalesOrder, so["id"]))
    assert spec["title"] == "PROFORMA INVOICE" and spec["number"] == again["pi_number"]
