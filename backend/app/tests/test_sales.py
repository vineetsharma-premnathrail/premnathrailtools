"""
Tests for the Sales module, Phase 1 (backend/app/modules/sales): SO
numbering, the status machine, approval routing by value × deviation with
four-eyes, delivery rows (one per vehicle), the RRV build link, amendments,
LD maths, DP extensions and permission 403s. The headline scenario is the
plan's Phase 1 exit criterion.
"""
from datetime import date, timedelta

from app.auth.jwt_handler import create_access_token
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.organization.services import approval_engine as engine
from app.modules.sales import service as svc
from app.modules.sales.models.attachment import SalesAttachment
from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule

BASE = "/api/v1/sales"
TODAY = date.today()


def make_user(db, email, apps=("sales",), role="user", **flags):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=list(apps), **flags)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def hdr(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def setup_people(db, partner=False):
    # Order Projects sit in Project Management (2026-10-23) — maker and Sales Head follow the project there.
    maker = make_user(db, "maker@premnathrail.com", apps=("sales", "projects"))
    head = make_user(db, "head@premnathrail.com", apps=("sales", "projects"))
    director = make_user(db, "director@premnathrail.com", is_director=True)
    db.add(ModuleSetting(module_key="sales", key="sales_head_id", value=head.id))
    p = make_user(db, "partner@premnathrail.com", is_partner=True) if partner else None
    db.commit()
    return maker, head, director, p


def setup_customer(db, qty=3, price=5000000.0):
    org = Organization(name="Central Railway", gst_number="27AAAGC1234F1Z5", state="Maharashtra", city="Mumbai")
    db.add(org)
    db.commit()
    inq = Inquiry(universal_id=f"INQ-{org.id}-01", org_id=org.id, product="RRV-10T", quantity=qty, current_stage="Order Received")
    db.add(inq)
    db.commit()
    from datetime import datetime, timezone
    q = Quotation(inquiry_id=inq.id, quot_number="QT-1-01-r1", customer_response="Accepted", status="accepted", payment_terms="20% advance, 80% on delivery",
                  created_at=datetime.now(timezone.utc))
    db.add(q)
    db.commit()
    db.add(QuotationLineItem(quotation_id=q.id, description="Rail cum Road Vehicle 10T", model_number="RRV-10T",
                             quantity=qty, unit_price=price, gst_percent=18))
    db.commit()
    return org, inq, q


def payload_from_prefill(client, h, inq, due=None):
    r = client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=h)
    assert r.status_code == 200, r.text
    p = r.json()
    due = due or TODAY + timedelta(days=120)
    qty = int(p["lines"][0]["quantity"])
    body = {k: p[k] for k in ("customer_id", "customer_contact_id", "source_type", "source_inquiry_id", "source_quotation_id",
                              "ld_applicable", "ld_rate_percent", "ld_rate_period", "ld_basis", "ld_max_percent",
                              "warranty_months_from_delivery", "warranty_months_from_commissioning", "warranty_rule")}
    body.update({
        "customer_po_number": "CR/PO/2026/771", "customer_po_date": str(TODAY), "lines": p["lines"],
        "schedule": [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(due + timedelta(days=30 * i))} for i in range(qty)],
        "billing_plan": [{"milestone_type": "advance", "percent": 20}, {"milestone_type": "delivery", "percent": 80}],
    })
    return body


def attach_po(db, so_id):
    db.add(SalesAttachment(entity_type="sales_order", entity_id=so_id, doc_type="customer_po", filename="po.pdf"))
    db.commit()


def create_order(client, db, maker, inq, **over):
    body = payload_from_prefill(client, hdr(maker), inq)
    body.update(over)
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 200, r.text
    return r.json()


def confirm(client, db, so, maker, head, director):
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 200, r.text
    if r.json()["status"] == "pending_approval":
        r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(director))
        assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    return r.json()


def make_build(db, n, status="planned", target=None):
    b = ProductionRrvBuild(build_number=f"RRV-2026-{n:04d}", rrv_model="RRV-10T", status=status, target_handover_date=target)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


# ---------------------------------------------------------------------------

def test_exit_criterion_flow(client, db):
    """Won inquiry for 3 RRVs → SO/<FY>/0001 approved by Sales Head + Director
    (maker ≠ approver proven) → 3 builds carry the customer id and PO → an
    amendment moving vehicle 3 by four weeks changes the backlog and LD forecast."""
    maker, head, director, _ = setup_people(db)
    org, inq, q = setup_customer(db)
    so = create_order(client, db, maker, inq)
    assert so["status"] == "draft" and so["so_number"] is None and so["display_number"] == f"Draft #{so['id']}"
    assert so["source_quotation_number"] == "QT-1-01-r1"
    assert len(so["schedules"]) == 3 and all(r["quantity"] == 1 for r in so["schedules"])
    assert so["taxable_total"] == 15000000 and so["grand_total"] == 17700000

    # Submit blocked until the PO document is attached — every problem listed.
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422 and any("Attach the customer's PO" in m for m in r.json()["detail"])
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200, r.text
    # Central approval engine: ₹1.77 Cr > ₹50 L → Sales Head then Director.
    assert r.json()["approval_via_engine"] is True and r.json()["status"] == "pending_approval"
    assert r.json()["approval_stage"] == "Sales Head" and r.json()["required_approval_level"] is None
    req = engine.latest_request(db, "sales_order", so["id"])
    assert sorted({s.stage_name for s in req.steps}) == ["Director", "Sales Head"]

    # Four-eyes: the maker can't approve; the Director can't jump the Sales Head.
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(maker))
    assert r.status_code == 403
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(director))
    assert r.status_code == 403 and "Sales Head" in r.json()["detail"]
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "pending_approval" and r.json()["approval_stage"] == "Director"
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 403  # a Sales Head who isn't a Director can't take the Director step
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(director))
    assert r.status_code == 200, r.text
    so = r.json()
    fy = svc.derived_fy_code(TODAY) if hasattr(svc, "derived_fy_code") else None
    assert so["status"] == "confirmed" and so["so_number"].startswith("SO/") and so["so_number"].endswith("/0001")
    if fy:
        assert fy in so["so_number"]
    st = client.get(f"/api/v1/approvals/entity/sales_order/{so['id']}", headers=hdr(maker)).json()["current"]
    assert st["status"] == "approved"
    assert [(s["stage_name"], s["decided_by_id"]) for s in st["steps"]] == [("Sales Head", head.id), ("Director", director.id)]

    # Confirmation plans a build per vehicle (production/order_project_links.py),
    # linked through the Sales link — each carries customer id + PO.
    rows = sorted(so["schedules"], key=lambda r: r["sequence"])
    db.expire_all()
    builds = [db.query(ProductionRrvBuild).filter(ProductionRrvBuild.sales_schedule_id == row["id"]).one() for row in rows]
    assert all(b.status == "planned" and b.order_project_element_id for b in builds)
    for b in builds:
        db.refresh(b)
        assert b.customer_id == org.id and b.customer_po_number == "CR/PO/2026/771" and b.sales_order_id == so["id"]
        assert b.order_reference == so["so_number"] and b.sales_schedule_id is not None
    # A build can't sit on two vehicles.
    r = client.post(f"{BASE}/schedule/{rows[0]['id']}/link-build", json={"build_id": builds[1].id}, headers=hdr(maker))
    assert r.status_code == 409

    # Vehicle 3's build is forecast two weeks past its due date → LD forecast.
    v3 = rows[2]
    due3 = date.fromisoformat(v3["current_delivery_date"])
    builds[2].target_handover_date = due3 + timedelta(days=14)
    db.commit()
    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    v3d = next(r for r in detail["schedules"] if r["id"] == v3["id"])
    assert v3d["committed_date"] == str(due3 + timedelta(days=14))
    assert v3d["ld_forecast_periods"] == 2 and v3d["ld_forecast_amount"] == 50000.0  # 0.5% × 2 wk × ₹50 L
    assert v3d["risk"] == "at_risk"
    backlog_before = {b["month"]: b["units"] for b in client.get(f"{BASE}/reports/backlog", headers=hdr(maker)).json()}

    # Customer amendment: vehicle 3 moves by four weeks.
    r = client.post(f"{BASE}/orders/{so['id']}/amendments", json={"reason": "Customer letter: consignee site not ready",
                                                                  "customer_amendment_ref": "CR/AMD/1"}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    a = r.json()
    sched = a["proposed"]["schedule"]
    for x in sched:
        if x["id"] == v3["id"]:
            x["contract_delivery_date"] = str(due3 + timedelta(days=28))
    r = client.patch(f"{BASE}/amendments/{a['id']}", json={"schedule": sched}, headers=hdr(maker))
    assert r.status_code == 200, r.text
    assert any(c["field"] == "contract_delivery_date" for c in r.json()["changes"]) and r.json()["value_change"] == 0
    r = client.post(f"{BASE}/amendments/{a['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200 and r.json()["approval_via_engine"] and r.json()["approval_stage"] == "Sales Head"
    r = client.post(f"{BASE}/amendments/{a['id']}/approve", json={}, headers=hdr(maker))
    assert r.status_code == 403
    r = client.post(f"{BASE}/amendments/{a['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text

    detail = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()
    assert detail["amendment_no"] == 1
    v3d = next(r for r in detail["schedules"] if r["id"] == v3["id"])
    assert v3d["contract_delivery_date"] == v3d["current_delivery_date"] == str(due3 + timedelta(days=28))
    assert v3d["ld_forecast_amount"] == 0 and v3d["rrv_build_id"] == builds[2].id
    backlog_after = {b["month"]: b["units"] for b in client.get(f"{BASE}/reports/backlog", headers=hdr(maker)).json()}
    old_m, new_m = due3.strftime("%Y-%m"), (due3 + timedelta(days=28)).strftime("%Y-%m")
    if old_m != new_m:
        assert backlog_after.get(old_m, 0) == backlog_before[old_m] - 1
        assert backlog_after[new_m] == backlog_before.get(new_m, 0) + 1
    exposure = client.get(f"{BASE}/reports/ld-exposure", headers=hdr(maker)).json()
    assert sum(e["ld_forecast"] for e in exposure) == 0

    # Build starting moves the order into execution.
    builds[0].status = "in_progress"
    db.commit()
    r = client.post(f"{BASE}/orders/{so['id']}/hold", json={"reason": "Customer asked to pause"}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["status"] == "on_hold"
    r = client.post(f"{BASE}/orders/{so['id']}/resume", headers=hdr(maker))
    assert r.status_code == 200 and r.json()["status"] == "in_execution"

    # OA Word document target + PDF.
    r = client.post(f"{BASE}/orders/{so['id']}/issue-oa", headers=hdr(maker))
    assert r.status_code == 200 and r.json()["oa_issued_at"]
    r = client.get(f"{BASE}/orders/{so['id']}/oa.pdf", headers=hdr(maker))
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_numbering_is_sequential_per_fy(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq1, _ = setup_customer(db, qty=1, price=1000000)
    so1 = confirm(client, db, create_order(client, db, maker, inq1), maker, head, director)
    inq2 = Inquiry(universal_id="INQ-X-02", org_id=_org.id, product="RRV", quantity=1, current_stage="Order Received")
    db.add(inq2)
    db.commit()
    body = payload_from_prefill(client, hdr(maker), inq2)
    body["customer_po_number"] = "CR/PO/2026/999"
    body["lines"] = [{"line_number": 1, "line_type": "rrv", "description": "RRV", "quantity": 1, "unit_price": 1000000, "gst_rate": 18}]
    body["schedule"] = [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=90))}]
    so2 = client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json()
    so2 = confirm(client, db, so2, maker, head, director)
    n1, n2 = so1["so_number"], so2["so_number"]
    assert n1.rsplit("/", 1)[0] == n2.rsplit("/", 1)[0]
    assert int(n2.rsplit("/", 1)[1]) == int(n1.rsplit("/", 1)[1]) + 1
    # Low value + standard terms → Sales Head alone would have been enough; we
    # still proved a Director step is skipped when not required:
    assert [s.stage_name for s in engine.latest_request(db, "sales_order", so1["id"]).steps] == ["Sales Head"]


def test_approval_by_value_and_deviation(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=3000000)  # ₹35.4 L incl. GST → Sales Head only
    so = create_order(client, db, maker, inq)
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert [s.stage_name for s in engine.latest_request(db, "sales_order", so["id"]).steps] == ["Sales Head"]
    r = client.post(f"{BASE}/orders/{so['id']}/return", json={"reason": "Add LD cap 5%"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "draft"
    # Uncapped LD is a deviation → Partner, whatever the value; no Partner set up → 422 with the fix.
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"ld_max_percent": None}, headers=hdr(maker))
    assert r.status_code == 200 and r.json()["ld_max_percent"] is None
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422 and any("Partner" in m for m in r.json()["detail"])
    partner = make_user(db, "partner2@premnathrail.com", is_partner=True)
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 200 and r.json()["deviation_flags"] == ["ld_uncapped"]
    req = engine.latest_request(db, "sales_order", so["id"])
    assert req.revision == 2 and [s.stage_name for s in req.steps] == [
        "Sales Head", "Director — non-standard terms", "Partner — non-standard terms"]
    for u in (head, director):
        assert client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(u)).status_code == 200
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(partner))
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    # Reject path on another order: rejected is final (cancelled).
    inq2 = Inquiry(universal_id="INQ-R-01", org_id=_org.id, product="RRV", quantity=1, current_stage="Order Received")
    db.add(inq2)
    db.commit()
    body = payload_from_prefill(client, hdr(maker), inq2)
    body["customer_po_number"] = "PO-REJ"
    body["lines"] = [{"line_number": 1, "line_type": "rrv", "description": "RRV", "quantity": 1, "unit_price": 100000, "gst_rate": 18}]
    body["schedule"] = [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=60))}]
    so2 = client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json()
    attach_po(db, so2["id"])
    client.post(f"{BASE}/orders/{so2['id']}/submit", headers=hdr(maker))
    assert client.post(f"{BASE}/orders/{so2['id']}/reject", json={"reason": ""}, headers=hdr(head)).status_code == 422
    r = client.post(f"{BASE}/orders/{so2['id']}/reject", json={"reason": "Price below cost"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"


def test_admin_stand_in_needs_comment(client, db):
    maker, head, director, _ = setup_people(db)
    admin = make_user(db, "admin@premnathrail.com", role="admin")
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = create_order(client, db, maker, inq)
    attach_po(db, so["id"])
    client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(admin))
    assert r.status_code == 422 and "stand in" in r.json()["detail"]
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={"comment": "Sales Head on leave"}, headers=hdr(admin))
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert engine.latest_request(db, "sales_order", so["id"]).steps[0].via == "admin"


def test_status_machine_guards(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = create_order(client, db, maker, inq)
    # No generic status edit: status isn't in the update schema, and approve on a draft is a 409.
    r = client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(head))
    assert r.status_code == 409 and "Draft" in r.json()["detail"]
    so = confirm(client, db, so, maker, head, director)
    r = client.patch(f"{BASE}/orders/{so['id']}", json={"freight_terms": "Paid"}, headers=hdr(maker))
    assert r.status_code == 409 and "amendment" in r.json()["detail"]
    r = client.put(f"{BASE}/orders/{so['id']}/billing-plan", json=[{"milestone_type": "delivery", "percent": 100}], headers=hdr(maker))
    assert r.status_code == 409
    assert client.delete(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).status_code == 409
    r = client.post(f"{BASE}/orders/{so['id']}/short-close", json={"reason": "x"}, headers=hdr(head))
    assert r.status_code == 409  # confirmed (nothing started) is cancelled, not short-closed
    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Customer withdrew"}, headers=hdr(maker))
    assert r.status_code == 403 and "Sales Head" in r.json()["detail"]
    b = make_build(db, 9)
    client.post(f"{BASE}/schedule/{so['schedules'][0]['id']}/link-build", json={"build_id": b.id}, headers=hdr(maker))
    r = client.post(f"{BASE}/orders/{so['id']}/cancel", json={"reason": "Customer withdrew"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    db.refresh(b)
    assert b.sales_schedule_id is None and b.sales_order_id is None  # planned build released


def test_billing_plan_and_delivery_rows(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=2, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    body["billing_plan"] = [{"milestone_type": "advance", "percent": 10}, {"milestone_type": "delivery", "percent": 80}]
    body["schedule"] = [{"line_number": 1, "quantity": 2, "contract_delivery_date": str(TODAY + timedelta(days=60))}]
    so = client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json()
    attach_po(db, so["id"])
    r = client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert r.status_code == 422
    msgs = r.json()["detail"]
    assert any("adds up to 90%" in m and "10% is not scheduled" in m for m in msgs)
    assert any("exactly 1 vehicle" in m for m in msgs)
    # Fixing both lets it through; billing amounts follow the grand total.
    r = client.put(f"{BASE}/orders/{so['id']}/billing-plan", json=[{"milestone_type": "advance", "percent": 10},
                                                                  {"milestone_type": "delivery", "percent": 90}], headers=hdr(maker))
    assert r.status_code == 200 and r.json()["billing_lines"][1]["amount"] == round(r.json()["grand_total"] * 0.9, 2)
    r = client.put(f"{BASE}/orders/{so['id']}/schedule", json=[
        {"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=60)), "consignee_name": "Sr DME Mumbai"},
        {"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY + timedelta(days=90)), "consignee_name": "Sr DME Pune"},
    ], headers=hdr(maker))
    assert r.status_code == 200 and [s["sequence"] for s in r.json()["schedules"]] == [1, 2]
    assert client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker)).status_code == 200


def test_duplicate_source_and_po(client, db):
    maker, head, director, _ = setup_people(db)
    org, inq, _ = setup_customer(db, qty=1, price=1000000)
    so = create_order(client, db, maker, inq)
    body = payload_from_prefill(client, hdr(maker), inq)
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 409 and so["display_number"] in r.json()["detail"]
    assert client.get(f"{BASE}/orders/prefill", params={"inquiry": inq.id}, headers=hdr(maker)).json()["existing_order"]["id"] == so["id"]
    confirm(client, db, so, maker, head, director)
    # Same customer PO on a second (direct) order → 409 at submit.
    body.update({"source_type": "direct", "source_inquiry_id": None, "source_quotation_id": None})
    so2 = client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json()
    attach_po(db, so2["id"])
    r = client.post(f"{BASE}/orders/{so2['id']}/submit", headers=hdr(maker))
    assert r.status_code == 409 and "already on SO/" in r.json()["detail"]


def test_ld_maths():
    so = SalesOrder(ld_applicable=True, ld_rate_percent=0.5, ld_rate_period="week", ld_basis="delayed_value", ld_max_percent=10,
                    price_basis="for_destination", taxable_total=36000000)
    from app.modules.sales.models.order import SalesOrderLine
    line = SalesOrderLine(id=1, quantity=3, taxable_amount=36000000)
    so.lines = [line]
    due = date(2026, 12, 1)
    row = SalesOrderSchedule(so_line_id=1, quantity=1, current_delivery_date=due, status="open", ld_waived=False)
    # Plan example: ₹1.2 Cr vehicle, 17 days late, 0.5%/week → 3 weeks → 1.5% → ₹1.8 L.
    assert svc.ld_for(so, row, due + timedelta(days=17)) == (3, 180000.0)
    assert svc.ld_for(so, row, due + timedelta(days=8)) == (2, 120000.0)  # part-week counts
    assert svc.ld_for(so, row, due) == (0, 0.0)
    assert svc.ld_for(so, row, due + timedelta(days=7 * 40)) == (40, 1200000.0)  # capped at 10% of ₹1.2 Cr
    so.ld_max_percent = None
    assert svc.ld_for(so, row, due + timedelta(days=7 * 40))[1] == 2400000.0  # uncapped
    so.ld_rate_period = "day"
    assert svc.ld_for(so, row, due + timedelta(days=3))[0] == 3
    row.ld_waived = True
    assert svc.ld_for(so, row, due + timedelta(days=30)) == (0, 0.0)
    # Ex-works reckons from dispatch, FOR destination from POD.
    row.ld_waived, so.ld_rate_period = False, "week"
    row.dispatched_on, row.delivered_on = due, due + timedelta(days=10)
    assert svc.reckoning_date(so, row) == due + timedelta(days=10)
    so.price_basis = "ex_works"
    assert svc.reckoning_date(so, row) == due


def test_dp_extension_without_ld(client, db):
    maker, head, director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    body = payload_from_prefill(client, hdr(maker), inq)
    body["schedule"] = [{"line_number": 1, "quantity": 1, "contract_delivery_date": str(TODAY - timedelta(days=10))}]
    so = confirm(client, db, client.post(f"{BASE}/orders", json=body, headers=hdr(maker)).json(), maker, head, director)
    row = so["schedules"][0]
    assert row["risk"] == "overdue" and row["ld_amount"] > 0
    new_date = TODAY + timedelta(days=30)
    r = client.post(f"{BASE}/orders/{so['id']}/extensions", json={"schedule_ids": [row["id"]], "requested_new_date": str(new_date),
                                                                  "reason_category": "customer_cause", "reason": "Drawing approval late"},
                    headers=hdr(maker))
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    r = client.post(f"{BASE}/extensions/{eid}/grant", json={"granted_new_date": str(new_date), "with_ld": False, "customer_letter_ref": ""},
                    headers=hdr(head))
    assert r.status_code == 422
    r = client.post(f"{BASE}/extensions/{eid}/grant", json={"granted_new_date": str(new_date), "with_ld": False,
                                                            "customer_letter_ref": "CR/DPX/12"}, headers=hdr(head))
    assert r.status_code == 200 and r.json()["status"] == "granted"
    row = client.get(f"{BASE}/orders/{so['id']}", headers=hdr(maker)).json()["schedules"][0]
    assert row["current_delivery_date"] == str(new_date) and row["contract_delivery_date"] == str(TODAY - timedelta(days=10))
    assert row["ld_waived"] is True and row["ld_amount"] == 0
    # The daily job runs clean and is idempotent.
    from app.tasks.sales_scheduler import run_for
    assert run_for(db)["orders"] == 1
    run_for(db)


def test_permission_403s(client, db):
    maker, head, director, _ = setup_people(db)
    outsider = make_user(db, "crm@premnathrail.com", apps=("crm",))
    viewer = make_user(db, "viewer@premnathrail.com", granular_permissions=["sales:orders:view", "sales:delivery:view"])
    _org, inq, _ = setup_customer(db, qty=1, price=1000000)
    assert client.get(f"{BASE}/orders", headers=hdr(outsider)).status_code == 403
    assert client.get(f"{BASE}/dashboard", headers=hdr(outsider)).status_code == 403
    assert client.get(f"{BASE}/orders/by-source", params={"inquiry": inq.id}, headers=hdr(outsider)).status_code == 200  # CRM chip
    assert client.get(f"{BASE}/orders", headers=hdr(viewer)).status_code == 200
    body = payload_from_prefill(client, hdr(maker), inq)
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(viewer))
    assert r.status_code == 403 and "Permission Matrix" in r.json()["detail"]
    so = create_order(client, db, maker, inq)
    attach_po(db, so["id"])
    client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker))
    assert client.post(f"{BASE}/orders/{so['id']}/approve", json={}, headers=hdr(viewer)).status_code == 403
    assert client.get(f"{BASE}/dashboard", headers=hdr(viewer)).status_code == 403  # no dashboard:view grant
    assert client.put(f"{BASE}/settings", json={"values": {"standard_ld_max_percent": 1}}, headers=hdr(maker)).status_code == 403
    # The amount limits moved to Organization › Approval Workflows — no longer a Sales setting.
    admin = make_user(db, "adm@premnathrail.com", role="admin")
    r = client.put(f"{BASE}/settings", json={"values": {"approval_limit_director": 1}}, headers=hdr(admin))
    assert r.status_code == 422 and "not a Sales setting" in r.json()["detail"]


def test_engine_routed_order_waiting_reminds_the_current_approver(client, db):
    from datetime import datetime, timezone
    from app.modules.main.models.notification import Notification
    from app.tasks.sales_scheduler import APPROVAL_REMINDER, run_for
    maker, head, _director, _ = setup_people(db)
    _org, inq, _ = setup_customer(db, qty=1, price=3000000)  # Sales Head only
    so = create_order(client, db, maker, inq)
    attach_po(db, so["id"])
    assert client.post(f"{BASE}/orders/{so['id']}/submit", headers=hdr(maker)).status_code == 200
    row = db.get(SalesOrder, so["id"])
    row.submitted_at = datetime.now(timezone.utc) - timedelta(days=3)
    db.commit()
    run_for(db)
    sent = db.query(Notification).filter(Notification.notification_type == APPROVAL_REMINDER,
                                         Notification.entity_id == so["id"]).all()
    assert [n.user_id for n in sent] == [head.id]
    assert "Sales Head" in sent[0].message


def test_line_with_unknown_product_is_refused(client, db):
    maker, head, director, _ = setup_people(db)
    org, inq, q = setup_customer(db, qty=1)
    body = payload_from_prefill(client, hdr(maker), inq)
    body["lines"][0]["crm_product_id"] = 999999
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 422 and "product #999999" in r.text
    body["lines"][0].pop("crm_product_id")
    body["lines"][0]["product_item_id"] = 888888
    r = client.post(f"{BASE}/orders", json=body, headers=hdr(maker))
    assert r.status_code == 422 and "stock item #888888" in r.text


def test_invoiced_milestone_carried_unchanged_by_amendment(client, db):
    """An amendment proposal carries every milestone; an invoiced one passed back
    unchanged must not block it — only a real change to it is refused."""
    maker, head, director, _ = setup_people(db)
    org, inq, q = setup_customer(db, qty=1)
    so = confirm(client, db, create_order(client, db, maker, inq), maker, head, director)
    order = db.query(SalesOrder).filter(SalesOrder.id == so["id"]).first()
    adv = next(b for b in order.billing_lines if b.milestone_type == "advance")
    adv.status = "invoiced"
    db.commit()
    plan = [svc.billing_dict(b) for b in order.billing_lines]
    svc.apply_billing(db, order, [dict(x) for x in plan])  # unchanged: fine
    assert adv.status == "invoiced" and float(adv.percent) == 20
    changed = [dict(x, percent=30) if x["id"] == adv.id else dict(x, percent=70) for x in plan]
    import pytest
    with pytest.raises(svc.SalesError) as e:
        svc.apply_billing(db, order, changed)
    assert e.value.status_code == 409 and "percent" in str(e.value.detail)
    db.rollback()


def test_order_customer_must_match_source_inquiry(client, db):
    maker, head, director, _ = setup_people(db)
    org, inq, q = setup_customer(db, qty=1)
    other = Organization(name="Western Railway", gst_number="27AAAGW1234F1Z5", state="Maharashtra")
    db.add(other)
    db.commit()
    body = payload_from_prefill(client, hdr(maker), inq)
    r = client.post(f"{BASE}/orders", json={**body, "customer_id": other.id, "customer_contact_id": None}, headers=hdr(maker))
    assert r.status_code == 422 and "must be the same" in r.json()["detail"]
    r = client.post(f"{BASE}/orders", json={**body, "sales_owner_id": 987654}, headers=hdr(maker))
    assert r.status_code == 422 and "Sales owner" in r.json()["detail"]
