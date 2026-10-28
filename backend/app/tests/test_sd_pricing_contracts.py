"""SD pricing conditions (VK11–VK13), product master merge (COMMPR01) and
customer AMC / CMC service contracts (VA41–VA43): price defaulting with a
reasoned override on SO / quotation / service invoice lines, minimum-price
deviation, exact-only product mapping + mapping screen + product order book,
contract approval, entitlement on SR creation, periodic AR billing,
renewal and reminders."""
import importlib.util
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.product import Product as CrmProduct
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_contract import ServiceContract
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.notification import Notification
from app.modules.organization.services import approval_engine as engine
from app.modules.products.models.price_condition import ProductPriceCondition
from app.modules.products.models.product import FinishedProduct
from app.modules.sales.models.order import SalesOrderLine
from app.tests.test_accounts_finance import books, gstin_for  # noqa: F401  (fixture)
from app.tests.test_erp_service_sap_gaps import hdr, mk_machine, mk_sr, mk_user
from app.tests.test_sales import BASE as SALES, attach_po, payload_from_prefill, setup_customer, setup_people

import pytest
from app.modules.erp import contracts as _contracts


@pytest.fixture(autouse=True)
def _contracts_live(request, monkeypatch):
    """Service contracts ship as 'Upcoming' (SERVICE_CONTRACTS_ENABLED=False);
    these tests exercise the built feature, so switch it on for them."""
    if "upcoming" not in request.node.name:
        monkeypatch.setattr(_contracts, "SERVICE_CONTRACTS_ENABLED", True)
    from app.modules.erp import billing as _billing
    monkeypatch.setattr(_billing, "SERVICE_BILLING_ENABLED", True)


def test_contracts_are_upcoming_and_refuse_new_ones():
    from app.modules.erp.contracts import ensure_contracts_enabled
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ensure_contracts_enabled()
    assert exc.value.status_code == 409 and "upcoming" in exc.value.detail

PC = "/api/v1/products/price-conditions"
SC = "/api/v1/erp/service-contracts"
SR = "/api/v1/erp/service-requests"
TODAY = date.today()


def _product(db, code="RRV-10T", name="Rail cum Road Vehicle 10T", model="RRV-10T", **kw):
    p = FinishedProduct(code=code, name=name, product_type="vehicle", model_number=model, hsn_code="87099000", **kw)
    db.add(p)
    db.commit()
    return p


def _cond(client, admin, **body):
    body.setdefault("valid_from", str(TODAY - timedelta(days=30)))
    return client.post(PC, json=body, headers=hdr(admin))


# ── Pricing conditions ──────────────────────────────────────────────────────

def test_price_conditions_resolve_customer_beats_list_and_overlap_refused(client, db):
    admin = mk_user(db, "pc_admin@premnathrail.com", apps=("sales", "products"))
    org = Organization(name="Konkan Railway")
    db.add(org)
    db.commit()
    p = _product(db)
    assert _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, amount=1000, min_price=900).status_code == 201
    # Same key, overlapping validity → 409 with the fix.
    r = _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, amount=1100)
    assert r.status_code == 409 and "valid to" in r.json()["detail"]
    assert _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, customer_id=org.id, amount=950).status_code == 201
    assert _cond(client, admin, condition_type="discount", item_kind="any", customer_id=org.id, percent=5).status_code == 201
    assert _cond(client, admin, condition_type="freight", item_kind="any", freight_basis="percent", percent=2).status_code == 201
    # Validation messages.
    assert _cond(client, admin, condition_type="discount", item_kind="any", percent=5).status_code == 422  # no customer
    assert _cond(client, admin, condition_type="price", item_kind="any", amount=5).status_code == 422
    assert _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, customer_id=org.id, amount=10,
                 min_price=20, valid_from=str(TODAY + timedelta(days=400))).status_code == 422

    r = client.get(f"{PC}/resolve", params={"product_id": p.id, "customer_id": org.id}, headers=hdr(admin)).json()
    assert r["price"] == 950 and r["price_source"] == "customer" and r["list_price"] == 1000 and r["min_price"] == 900
    assert r["discount_percent"] == 5 and r["freight"]["basis"] == "percent"
    other = client.get(f"{PC}/resolve", params={"product_id": p.id}, headers=hdr(admin)).json()
    assert other["price"] == 1000 and other["discount_percent"] == 0
    # Before the validity window there is no price.
    old = client.get(f"{PC}/resolve", params={"product_id": p.id, "on": str(TODAY - timedelta(days=60))}, headers=hdr(admin)).json()
    assert old["price"] is None
    # Maintaining needs Sales › Pricing; a Products-only user can read but not create.
    viewer = mk_user(db, "pc_view@premnathrail.com", role="user", apps=("products",))
    assert client.get(PC, headers=hdr(viewer)).status_code == 200
    assert _cond(client, viewer, condition_type="price", item_kind="product", product_id=p.id, amount=1,
                 valid_from=str(TODAY + timedelta(days=500))).status_code == 403


def test_so_line_defaults_price_override_needs_reason_and_min_price_is_deviation(client, db):
    maker, head, director, _ = setup_people(db, partner=True)
    org, inq, _q = setup_customer(db, qty=1, price=3000000)
    p = _product(db, code="RRV-X", name="RRV X", model="RRV-X")
    admin = mk_user(db, "pc_admin2@premnathrail.com", apps=("sales",))
    assert _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, amount=2500000, min_price=2400000).status_code == 201
    body = payload_from_prefill(client, hdr(maker), inq)
    body["lines"] = [{"line_number": 1, "line_type": "rrv", "description": "RRV X", "product_id": p.id, "quantity": 1,
                      "unit_price": 0, "gst_rate": 18}]
    r = client.post(f"{SALES}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    so = r.json()
    ln = so["lines"][0]
    assert ln["unit_price"] == 2500000 and ln["list_price"] == 2500000 and ln["hsn_sac_code"] == "87099000"

    # Typed price below list without a reason → 422; with reason → saved.
    line = {**body["lines"][0], "id": ln["id"], "unit_price": 2300000}
    r = client.put(f"{SALES}/orders/{so['id']}/lines", json=[line], headers=hdr(maker))
    assert r.status_code == 422 and "reason" in r.json()["detail"]
    r = client.put(f"{SALES}/orders/{so['id']}/lines", json=[{**line, "price_override_reason": "Matching L1 bid"}], headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert r.json()["lines"][0]["price_override_reason"] == "Matching L1 bid"
    # Net below the minimum price is a deviation at submit.
    attach_po(db, so["id"])
    r = client.post(f"{SALES}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert "price_below_list" in r.json()["deviation_flags"]


def test_freight_and_quotation_line_override(client, db):
    org = Organization(name="Eastern Railway")
    db.add(org)
    db.commit()
    admin = mk_user(db, "pc_admin3@premnathrail.com", apps=("sales", "crm"))
    p = _product(db, code="SPL-1", name="Scissor Lift", model="SL-1")
    _cond(client, admin, condition_type="price", item_kind="product", product_id=p.id, amount=500)
    inq = Inquiry(universal_id="INQ-PC-1", org_id=org.id, product="Scissor Lift", quantity=1)
    db.add(inq)
    db.commit()
    assert db.get(Inquiry, inq.id).product_id == p.id  # exact name → auto-linked on save
    q = Quotation(inquiry_id=inq.id, quot_number="QT-PC-1", created_at=datetime.now(timezone.utc))
    db.add(q)
    db.commit()
    db.add(QuotationLineItem(quotation_id=q.id, description="Scissor Lift", model_number="SL-1", quantity=1, unit_price=500))
    db.commit()
    li = db.query(QuotationLineItem).filter(QuotationLineItem.quotation_id == q.id).one()
    assert li.product_id == p.id and li.list_price == 500
    import pytest
    from fastapi import HTTPException
    db.add(QuotationLineItem(quotation_id=q.id, description="Scissor Lift", model_number="SL-1", quantity=1, unit_price=450))
    with pytest.raises(HTTPException) as e:
        db.commit()
    assert "reason" in e.value.detail
    db.rollback()
    db.add(QuotationLineItem(quotation_id=q.id, description="Scissor Lift", model_number="SL-1", quantity=1, unit_price=450,
                             price_override_reason="Repeat customer"))
    db.commit()


# ── Product master merge ────────────────────────────────────────────────────

def test_migration_maps_exact_only_and_mapping_screen_assigns(client, db):
    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "cb6d3cd292f9_sd_pricing_product_merge_service_contracts.py"
    spec = importlib.util.spec_from_file_location("mig_cb6d", path)
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    from sqlalchemy import event
    from sqlalchemy.orm import Session
    from app.modules.products import linking
    # Rows written before the merge: switch the auto-link off while seeding.
    event.remove(Session, "before_flush", linking._auto_link_products)
    try:
        p1 = _product(db, code="TW-1", name="Tower Wagon", model="TW-8")
        _product(db, code="TW-2", name="Tower Wagon", model="TW-9")       # same name, other model
        exact = CrmProduct(name="tower wagon ", model_number="TW-8")
        near = CrmProduct(name="Tower Wagn", model_number=None)
        ambiguous = CrmProduct(name="Tower Wagon")                        # two products by name → unmapped
        db.add_all([exact, near, ambiguous])
        org = Organization(name="NFR")
        db.add(org)
        db.commit()
        i1 = Inquiry(universal_id="INQ-M-1", org_id=org.id, product="TW-1")
        i2 = Inquiry(universal_id="INQ-M-2", org_id=org.id, product="Towr wagon")
        db.add_all([i1, i2])
        db.commit()
    finally:
        event.listen(Session, "before_flush", linking._auto_link_products)
    mig.op = SimpleNamespace(get_bind=lambda: db.connection())
    mig._backfill_products()
    db.expire_all()
    assert db.get(CrmProduct, exact.id).product_id == p1.id
    assert db.get(CrmProduct, near.id).product_id is None
    assert db.get(CrmProduct, ambiguous.id).product_id is None
    assert db.get(Inquiry, i1.id).product_id == p1.id
    assert db.get(Inquiry, i2.id).product_id is None



def test_product_order_book_and_quotation_history(client, db):
    maker, head, director, _ = setup_people(db)
    org, inq, q = setup_customer(db, qty=2, price=1000000)
    p = _product(db)  # code RRV-10T = the quotation line's model number
    admin = mk_user(db, "ob_admin@premnathrail.com", apps=("products", "sales", "crm"))
    # Quotation lines now carry the product picked on the line (no Mapping screen since 2026-10-28).
    from app.modules.crm.models.inquiry import QuotationLineItem
    db.query(QuotationLineItem).filter(QuotationLineItem.quotation_id == q.id).update({"product_id": p.id})
    db.commit()
    body = payload_from_prefill(client, hdr(maker), inq)
    so = client.post(f"{SALES}/orders", json=body, headers=hdr(maker)).json()
    assert db.query(SalesOrderLine).filter(SalesOrderLine.so_id == so["id"]).first().product_id == p.id
    ob = client.get(f"/api/v1/products/{p.id}/order-book", headers=hdr(admin)).json()
    assert ob["rows"][0]["so_id"] == so["id"] and ob["rows"][0]["quantity"] == 2
    qh = client.get(f"/api/v1/products/{p.id}/quotation-history", headers=hdr(admin)).json()
    assert qh["quotations"][0]["quotation_id"] == q.id and qh["quotations"][0]["unit_price"] == 1000000
    prod_only = mk_user(db, "ob_prod@premnathrail.com", role="user", apps=("products",))
    r = client.get(f"/api/v1/products/{p.id}/order-book", headers=hdr(prod_only))
    assert r.status_code == 403 and "Sales" in r.json()["detail"]


# ── Service contracts ───────────────────────────────────────────────────────

def _contract_setup(client, db, customer, start=None, **over):
    admin = mk_user(db, f"sc_admin{db.query(ServiceContract).count()}@premnathrail.com", apps=("erp", "accounts"))
    m = mk_machine(db, f"SC-M-{customer.id}-{db.query(Project).count()}", customer_id=customer.id, site_state="Maharashtra",
                   warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))
    start = start or TODAY - timedelta(days=10)
    body = {"contract_type": "amc", "customer_id": customer.id, "start_date": str(start),
            "end_date": str(start + timedelta(days=364)), "contract_value": 120000, "billing_frequency": "quarterly",
            "visits_included": 2, "sla_response_hours": 24, "sla_resolution_hours": 72, "machine_ids": [m.id], **over}
    r = client.post(SC, json=body, headers=hdr(admin))
    assert r.status_code == 201, r.text
    return admin, m, r.json()


def _approve(client, db, admin, c):
    approver = mk_user(db, f"sc_appr{c['id']}@premnathrail.com", role="user", apps=("erp",))
    approver.granular_permissions = ["erp:service_contracts:view", "erp:service_contracts:approve"]
    partner = mk_user(db, f"sc_partner{c['id']}@premnathrail.com", role="user", apps=("erp",), )
    partner.is_partner = True
    partner.granular_permissions = ["erp:service_contracts:view", "erp:service_contracts:approve"]
    db.commit()
    r = client.post(f"{SC}/{c['id']}/submit", headers=hdr(admin))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending_approval"
    req = engine.latest_request(db, "erp_service_contract", c["id"])
    assert list(dict.fromkeys(s.stage_name for s in req.steps)) == ["Service contract approvers", "Partner (final approval)"]
    engine.decide(db, req.id, approver, "approve")
    engine.decide(db, req.id, partner, "approve")
    db.commit()
    return client.get(f"{SC}/{c['id']}", headers=hdr(admin)).json()


def test_contract_billing_plan_approval_and_entitlement_on_sr(client, books):
    db = books["db"]
    cust = books["c_local"]
    admin, m, c = _contract_setup(client, db, cust)
    assert len(c["billing_lines"]) == 4 and sum(b["amount"] for b in c["billing_lines"]) == 120000
    assert c["contract_number"].startswith("SC/")
    # A machine of another customer is refused.
    other = mk_machine(db, "SC-OTHER", customer_id=books["c_other"].id)
    r = client.patch(f"{SC}/{c['id']}", json={"machine_ids": [m.id, other.id]}, headers=hdr(admin))
    assert r.status_code == 422 and "don't belong" in r.json()["detail"]

    c = _approve(client, db, admin, c)
    assert c["status"] == "active"
    assert db.get(Project, m.id).amc_status == "active"

    # Out of warranty but on AMC → SR is free, linked, SLA copied.
    sr1 = mk_sr(client, admin, m).json()
    assert sr1["warranty_status"] == "amc" and sr1["is_chargeable"] is False
    assert sr1["service_contract_id"] == c["id"] and sr1["sla_response_hours"] == 24
    sr2 = mk_sr(client, admin, m).json()
    assert sr2["service_contract_id"] == c["id"]
    # Two included visits used → the third is chargeable and not linked.
    sr3 = mk_sr(client, admin, m).json()
    assert sr3["service_contract_id"] is None and sr3["is_chargeable"] is True
    ent = client.get(f"{SC}/entitlement", params={"project_id": m.id}, headers=hdr(admin)).json()["entitlement"]
    assert ent["covered"] is False and "visits are used" in ent["reason"]

    # Overlapping second contract on the same machine is refused at submit.
    dup = client.post(SC, json={"contract_type": "cmc", "customer_id": cust.id, "start_date": str(TODAY),
                                "end_date": str(TODAY + timedelta(days=100)), "contract_value": 5000, "machine_ids": [m.id]},
                      headers=hdr(admin)).json()
    r = client.post(f"{SC}/{dup['id']}/submit", headers=hdr(admin))
    assert r.status_code == 409 and "already on" in r.json()["detail"]

    # Bill the first quarter → AR draft invoice with SAC and GST.
    b1 = c["billing_lines"][0]
    r = client.post(f"{SC}/{c['id']}/billing/{b1['id']}/invoice", json={"invoice_date": str(TODAY)}, headers=hdr(admin))
    assert r.status_code == 200, r.text
    line = r.json()["billing_lines"][0]
    assert line["status"] == "invoiced" and line["invoice_number"]
    txn = db.get(ARTransaction, line["ar_transaction_id"])
    assert txn.reference_type == "service_contract" and float(txn.invoice_amount) == 30000
    assert float(txn.cgst_amount) == 2700 and txn.customer_id == cust.id
    assert client.post(f"{SC}/{c['id']}/billing/{b1['id']}/invoice", json={}, headers=hdr(admin)).status_code == 409
    # Finance cancels the draft → the period is free to bill again.
    txn.status = "cancelled"
    db.commit()
    got = client.get(f"{SC}/{c['id']}", headers=hdr(admin)).json()
    assert got["billing_lines"][0]["status"] == "planned" and got["billing_lines"][0]["ar_transaction_id"] is None


def test_amc_sr_billing_skips_covered_labour_and_uses_rate_list(client, books):
    db = books["db"]
    cust = books["c_local"]
    admin, m, c = _contract_setup(client, db, cust, visits_included=0)
    _approve(client, db, admin, c)
    sales_admin = mk_user(db, "rate_admin@premnathrail.com", apps=("sales",))
    assert _cond(client, sales_admin, condition_type="price", item_kind="service", service_code="visit", amount=1500).status_code == 201
    # Spares used on an AMC visit: marked chargeable with a reason → labour lines are left out.
    sr = mk_sr(client, admin, m, is_chargeable=True, chargeable_reason="Spares are not covered by the AMC").json()
    assert sr["service_contract_id"] == c["id"] and sr["is_chargeable"] is True
    client.patch(f"{SR}/{sr['id']}", json={"service_cost": 5000, "miscellaneous_cost": 200, "status": "work_completed"}, headers=hdr(admin))
    preview = client.get(f"{SR}/{sr['id']}/invoice", headers=hdr(admin)).json()
    descs = [l["description"] for l in preview["preview_lines"]]
    assert all("labour" not in d.lower() for d in descs) and any("Other service" in d for d in descs)

    # Out-of-contract machine, no labour typed → visit charge from the rate list.
    m2 = mk_machine(db, "SC-RATE", customer_id=cust.id, warranty_start_date=date(2020, 1, 1), warranty_end_date=date(2021, 1, 1))
    sr2 = mk_sr(client, admin, m2).json()
    client.patch(f"{SR}/{sr2['id']}", json={"status": "work_completed"}, headers=hdr(admin))
    preview = client.get(f"{SR}/{sr2['id']}/invoice", headers=hdr(admin)).json()
    assert any("Visit charge" in l["description"] and l["rate"] == 1500 for l in preview["preview_lines"])


def test_renewal_cancel_and_daily_job(client, books):
    db = books["db"]
    cust = books["c_local"]
    start = TODAY - timedelta(days=334)  # ends in exactly 30 days → today's reminder
    admin, m, c = _contract_setup(client, db, cust, start=start, billing_frequency="upfront")
    c = _approve(client, db, admin, c)
    assert c["days_to_expiry"] == 30
    from app.tasks.erp_contract_scheduler import run_contract_jobs
    end = date.fromisoformat(c["end_date"])
    stats = run_contract_jobs(db, today=end - timedelta(days=30))
    assert stats["reminders"] >= 1 and stats["invoiced"] == 1  # the upfront line was due at the start
    n = db.query(Notification).filter(Notification.entity_type == "erp_service_contract", Notification.entity_id == c["id"]).count()
    assert n >= 1
    assert run_contract_jobs(db, today=end - timedelta(days=30))["reminders"] == 0  # once a day

    r = client.post(f"{SC}/{c['id']}/renew", headers=hdr(admin))
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["status"] == "draft" and new["renewed_from_id"] == c["id"]
    assert new["start_date"] == str(end + timedelta(days=1)) and [x["project_id"] for x in new["machines"]] == [m.id]
    assert client.post(f"{SC}/{c['id']}/renew", headers=hdr(admin)).status_code == 409

    # Past the end → expired, the machine's AMC mirror follows.
    run_contract_jobs(db, today=end + timedelta(days=1))
    db.expire_all()
    assert db.get(ServiceContract, c["id"]).status == "expired"
    assert db.get(Project, m.id).amc_status == "expired"

    # Cancelling needs a reason.
    assert client.post(f"{SC}/{new['id']}/cancel", json={"reason": " "}, headers=hdr(admin)).status_code == 422
    r = client.post(f"{SC}/{new['id']}/cancel", json={"reason": "Customer declined renewal"}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_service_contract_tab_is_deny_by_default(client, db):
    u = mk_user(db, "sc_noperm@premnathrail.com", role="user", apps=())
    u.granular_permissions = ["erp:service_requests:view"]
    db.commit()
    assert client.get(SC, headers=hdr(u)).status_code == 403
    assert db.query(ServiceRequest).count() == 0
