"""SD gaps (docs/erp-review/sap-gap-analysis.json "sd"): dispatch / delivery /
commissioning against the SO schedule (VL01N/PGI/POD), the AR invoice raised
from a billing milestone with qty / amount caps (VF01) and the billing due
list (VF04)."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts import service as acc
from app.modules.accounts.services import billing, notes
from app.modules.main.models.user import User
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.sales import delivery as dlv
from app.modules.sales import service as svc
from app.modules.sales.models.delivery import SalesInvoiceLink
from app.modules.sales.models.order import SalesOrder, SalesOrderLine, SalesOrderSchedule, SalesBillingPlanLine
from app.tests.test_accounts_finance import books  # noqa: F401  (fixture)

TODAY = svc.today_ist()
D0 = TODAY - timedelta(days=20)


def make_so(db, customer, *, qty=2, price=1_000_000.0, plan=(("advance", 20), ("delivery", 70), ("commissioning", 10)),
            line_type="rrv", item_id=None):
    so = SalesOrder(status="confirmed", so_number=f"SO/T/{customer.id:04d}", customer_id=customer.id, customer_name=customer.name,
                    customer_gstin=customer.gst_number, place_of_supply_state_code=customer.gst_number[:2],
                    customer_po_number="CR/PO/9", customer_po_date=D0 - timedelta(days=60), price_basis="for_destination",
                    ld_applicable=True, ld_rate_percent=0.5, ld_rate_period="week", ld_basis="delayed_value", ld_max_percent=10,
                    warranty_rule="from_delivery", warranty_months_from_delivery=12,
                    confirmed_at=datetime.now(timezone.utc) - timedelta(days=50))
    so.lines.append(SalesOrderLine(line_number=1, line_type=line_type, description="Rail cum Road Vehicle 10T", hsn_sac_code="8604",
                                   quantity=qty, unit_price=price, gst_rate=18, product_item_id=item_id))
    db.add(so)
    db.flush()
    rows = qty if line_type == "rrv" else 1
    for i in range(rows):
        so.schedules.append(SalesOrderSchedule(so_line_id=so.lines[0].id, sequence=i + 1, quantity=1 if line_type == "rrv" else qty,
                                               contract_delivery_date=D0 - timedelta(days=14), current_delivery_date=D0 - timedelta(days=14),
                                               status="open", consignee_name="Sr DME, Kurla"))
    for i, (t, pct) in enumerate(plan, start=1):
        so.billing_lines.append(SalesBillingPlanLine(sequence=i, milestone_type=t, percent=pct, status="not_due"))
    db.flush()
    svc.recompute_totals(so)
    svc.refresh_order(db, so)
    db.commit()
    return so


def _b(so, t):
    return next(b for b in so.billing_lines if b.milestone_type == t)


def _post(b, inv):
    acc.post_customer_invoice(b["db"], ar_transaction_id=inv.id, created_by_id=b["checker"].id)
    b["db"].commit()


def test_delivery_moves_status_freezes_ld_and_sets_warranty(books):
    db = books["db"]
    so = make_so(db, books["c_local"])
    assert _b(so, "advance").status == "due" and _b(so, "delivery").status == "not_due"
    r1, r2 = so.schedules
    dlv.mark_delivered(db, so, r1, on=D0, reference="R-NOTE/1", user=books["maker"])
    db.commit()
    assert (r1.dispatched_on, r1.delivered_on, r1.status) == (D0, D0, "delivered")
    assert r1.qty_delivered == 1 and so.lines[0].qty_delivered == 1 and so.lines[0].qty_dispatched == 1
    assert so.status == "partially_delivered"
    assert r1.warranty_start == D0 and r1.warranty_end == dlv.add_months(D0, 12)
    # LD frozen at the POD date (2 weeks late), while vehicle 2 keeps accruing.
    assert r1.ld_weeks == 2
    assert svc.ld_accrued(so, r1, TODAY + timedelta(days=60))[0] == 2
    assert svc.ld_accrued(so, r2, TODAY + timedelta(days=60))[0] > 2
    assert _b(so, "delivery").status == "due"
    with pytest.raises(svc.SalesError, match="already fully delivered"):
        dlv.mark_delivered(db, so, r1, on=D0, reference="again", user=books["maker"])
    with pytest.raises(svc.SalesError, match="future"):
        dlv.mark_delivered(db, so, r2, on=TODAY + timedelta(days=1), reference="x", user=books["maker"])
    dlv.mark_delivered(db, so, r2, on=D0 + timedelta(days=2), reference="R-NOTE/2", user=books["maker"])
    assert so.status == "delivered"
    with pytest.raises(svc.SalesError, match="before the delivery"):
        dlv.mark_commissioned(db, so, r1, on=D0 - timedelta(days=1), reference="CC", user=books["maker"])
    dlv.mark_commissioned(db, so, r1, on=D0 + timedelta(days=5), reference="CC/1", user=books["maker"])
    assert r1.status == "commissioned" and _b(so, "commissioning").status == "due"


def test_spares_dispatch_is_partial_and_capped_at_order_quantity(books):
    db = books["db"]
    so = make_so(db, books["c_local"], qty=10, price=1000, line_type="spares", item_id=None, plan=(("dispatch", 100),))
    row = so.schedules[0]
    issue = SimpleNamespace(id=None, challan_number="DC-11", issue_number="MI-1", issue_date=D0, erp_project_id=None)
    dlv.on_store_dispatch(db, issue, [{"item_id": 1, "quantity": 4, "sales_schedule_id": row.id}], sales_order_id=so.id,
                          user=books["maker"])
    assert row.qty_dispatched == 4 and row.dispatched_on is None and so.lines[0].qty_dispatched == 4
    assert so.status == "in_execution"
    with pytest.raises(svc.SalesError, match="only 6 of 10"):
        dlv.on_store_dispatch(db, issue, [{"item_id": 1, "quantity": 7, "sales_schedule_id": row.id}], sales_order_id=so.id,
                              user=books["maker"])
    # Spares POD needs a dispatch first; a partial POD makes the order partially delivered.
    dlv.mark_delivered(db, so, row, on=D0, reference="POD-1", quantity=3, user=books["maker"])
    assert row.qty_delivered == 3 and so.status == "partially_delivered"
    with pytest.raises(svc.SalesError, match="1 is dispatched and not yet delivered"):
        dlv.mark_delivered(db, so, row, on=D0, reference="POD-2", quantity=2, user=books["maker"])
    # Delivery-linked billing caps at what reached the event: 4 dispatched units.
    inv = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "dispatch").id, invoice_date=TODAY,
                                         created_by_id=books["maker"].id)
    assert inv.invoice_amount == 4000 and inv.reference_type == "sales_order" and inv.customer_po_number == "CR/PO/9"
    with pytest.raises(ValueError, match="nothing to bill|Nothing to bill"):
        billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "dispatch").id, invoice_date=TODAY,
                                       created_by_id=books["maker"].id)


def test_milestone_invoice_copies_order_caps_and_reverses_on_cancel(books):
    db = books["db"]
    so = make_so(db, books["c_other"])  # interstate customer -> IGST
    adv = _b(so, "advance")
    inv = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=adv.id, invoice_date=TODAY,
                                         created_by_id=books["maker"].id)
    db.refresh(inv)
    assert inv.invoice_amount == 400000 and inv.igst_amount == 72000 and inv.is_interstate
    assert inv.customer_gstin == books["c_other"].gst_number
    ln = db.query(acc.ARTransactionLine).filter_by(ar_transaction_id=inv.id).one()
    assert (ln.hsn_sac_code, float(ln.gst_rate), float(ln.quantity), float(ln.rate)) == ("8604", 18.0, 2.0, 200000.0)
    # A draft reserves the milestone: a second invoice is refused.
    with pytest.raises(ValueError, match="draft invoice is waiting"):
        billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=adv.id, invoice_date=TODAY, created_by_id=books["maker"].id)
    assert adv.invoiced_amount == 0  # posted only
    acc.cancel_ar_transaction(db, ar_transaction_id=inv.id, reason="wrong date", user_id=books["maker"].id)
    db.commit()
    inv2 = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=adv.id, invoice_date=TODAY,
                                          created_by_id=books["maker"].id)
    _post(books, inv2)
    db.refresh(so)
    adv = _b(so, "advance")
    assert adv.status == "invoiced" and abs(adv.invoiced_amount - adv.amount) < 1
    assert abs(so.lines[0].qty_invoiced - 0.4) < 1e-6  # 20% of 2 vehicles, value-equivalent
    # Not due yet: nothing delivered.
    with pytest.raises(ValueError, match="Nothing to bill|isn't due"):
        billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "delivery").id, invoice_date=TODAY,
                                       created_by_id=books["maker"].id)
    # Milestone fixed once invoiced: an amendment can't change it.
    with pytest.raises(svc.SalesError, match="already"):
        svc.apply_billing(db, so, [{"id": adv.id, "milestone_type": "advance", "percent": 25},
                                   {"id": _b(so, "delivery").id, "milestone_type": "delivery", "percent": 65},
                                   {"id": _b(so, "commissioning").id, "milestone_type": "commissioning", "percent": 10}])
    # A credit note against the invoice reverses the billed amount.
    cn = notes.create_party_note(db, note_type="credit_note", note_date=TODAY, ar_transaction_id=inv2.id,
                                 lines=[{"description": "Rate difference", "quantity": 1, "rate": 100000, "gst_rate": 18}],
                                 created_by_id=books["maker"].id)
    notes.post_party_note(db, party_note_id=cn.id, posted_by_id=books["checker"].id)
    db.commit()
    db.refresh(so)
    assert _b(so, "advance").status == "due" and abs(_b(so, "advance").invoiced_amount - 354000) < 1


def test_delivery_milestone_bills_per_vehicle_and_reversal_is_guarded(books):
    db = books["db"]
    so = make_so(db, books["c_local"])
    r1, r2 = so.schedules
    dlv.mark_delivered(db, so, r1, on=D0, reference="RN-1", user=books["maker"])
    db.commit()
    views = {v["milestone_type"]: v for v in billing.milestone_views(db, so)}
    assert views["delivery"]["due_amount"] == 826000.0  # 70% of 1 vehicle incl. GST
    assert [r["schedule_id"] for r in views["delivery"]["rows"]] == [r1.id]
    with pytest.raises(ValueError, match="hasn't reached delivery"):
        billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "delivery").id, schedule_ids=[r2.id],
                                       invoice_date=TODAY, created_by_id=books["maker"].id)
    inv = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "delivery").id, invoice_date=TODAY,
                                         created_by_id=books["maker"].id)
    db.commit()
    assert inv.invoice_amount == 700000
    link = db.query(SalesInvoiceLink).filter_by(ar_transaction_id=inv.id).one()
    assert link.schedule_id == r1.id and link.quantity == 1
    admin = User(email="adm@premnathrail.com", name="Admin", role="admin", is_active=True)
    db.add(admin)
    db.commit()
    ev = [e for e in dlv.events_of(db, so.id, r1.id) if e.event == "delivery"][0]
    with pytest.raises(svc.SalesError, match="already invoiced"):
        dlv.reverse_event(db, so, ev, reason="typo", user=admin)
    acc.cancel_ar_transaction(db, ar_transaction_id=inv.id, reason="re-issue", user_id=books["maker"].id)
    dispatch = [e for e in dlv.events_of(db, so.id, r1.id) if e.event == "dispatch"][0]
    with pytest.raises(svc.SalesError, match="Reverse the delivery"):
        dlv.reverse_event(db, so, dispatch, reason="typo", user=admin)
    dlv.reverse_event(db, so, ev, reason="wrong vehicle", user=admin)
    assert r1.delivered_on is None and r1.status == "dispatched" and so.status == "in_execution"
    assert _b(so, "delivery").status == "not_due"


def test_rrv_handover_books_dispatch_delivery_commissioning(books):
    db = books["db"]
    so = make_so(db, books["c_local"], qty=1, plan=(("advance", 10), ("delivery", 90)))
    row = so.schedules[0]
    build = ProductionRrvBuild(build_number="RRV-T-1", rrv_model="RRV-10T", status="completed", handover_date=D0,
                               commissioning_date=D0 + timedelta(days=3), handed_over_to_name="SSE Kurla")
    db.add(build)
    db.commit()
    row.rrv_build_id = build.id
    db.commit()
    dlv.on_rrv_handover(db, build)
    db.commit()
    assert (row.dispatched_on, row.delivered_on, row.commissioned_on) == (D0, D0, D0 + timedelta(days=3))
    assert row.status == "commissioned" and so.status == "delivered"
    assert _b(so, "delivery").status == "due"
    dlv.on_rrv_handover(db, build)  # idempotent
    assert len([e for e in dlv.events_of(db, so.id) if e.reversed_at is None]) == 3


def test_api_billing_due_mark_delivered_and_invoice_from_so(client, books):
    db = books["db"]
    so = make_so(db, books["c_local"], plan=(("advance", 20), ("drawing_approval", 10), ("delivery", 70)))
    user = User(email="sd@premnathrail.com", name="SD User", role="user", is_active=True, assigned_apps=["sales", "accounts"])
    db.add(user)
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}
    due = client.get("/api/v1/sales/billing-due", headers=h)
    assert due.status_code == 200, due.text
    assert [v["milestone_type"] for v in due.json()] == ["advance"]
    # Drawing approval is marked due by hand; delivery can't be.
    bid = _b(so, "drawing_approval").id
    r = client.post(f"/api/v1/sales/billing/{bid}/mark-due", json={"on": str(D0), "reference": "DRG/APP/1"}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "due", r.text
    r = client.post(f"/api/v1/sales/billing/{_b(so, 'delivery').id}/mark-due", json={"on": str(D0)}, headers=h)
    assert r.status_code == 409 and "falls due by itself" in r.json()["detail"]
    r = client.post(f"/api/v1/sales/billing/{bid}/request-invoice", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "invoice_requested"
    # Mark delivered (POD) from Sales.
    r = client.post(f"/api/v1/sales/schedule/{so.schedules[0].id}/confirm-delivery",
                    json={"delivered_on": str(D0), "reference": "RN-77"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "partially_delivered" and r.json()["schedules"][0]["delivery_reference"] == "RN-77"
    r = client.post(f"/api/v1/sales/schedule/{so.schedules[1].id}/confirm-delivery", json={"delivered_on": str(D0), "reference": " "}, headers=h)
    assert r.status_code == 422 and "delivery reference" in r.json()["detail"]
    events = client.get(f"/api/v1/sales/orders/{so.id}/delivery-events", headers=h).json()
    assert [e["event"] for e in events] == ["dispatch", "delivery"]
    # Finance: create the invoice from the SO milestone.
    r = client.post("/api/v1/accounts/sales-billing/invoices", json={"so_id": so.id, "billing_plan_line_id": bid,
                                                                      "invoice_date": str(TODAY)}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["invoice_amount"] == 200000 and r.json()["reference_type"] == "sales_order"
    picker = client.get("/api/v1/accounts/sales-billing/orders", headers=h).json()
    assert picker[0]["so_id"] == so.id and picker[0]["due_amount"] > 0
    # Closing is refused while milestones are not invoiced.
    nobody = User(email="nob@premnathrail.com", name="Nobody", role="user", is_active=True, assigned_apps=["erp"])
    db.add(nobody)
    db.commit()
    hn = {"Authorization": f"Bearer {create_access_token({'sub': str(nobody.id), 'email': nobody.email, 'role': nobody.role})}"}
    assert client.get("/api/v1/sales/billing-due", headers=hn).status_code == 403
    assert billing.open_billing_problems(db, so)
