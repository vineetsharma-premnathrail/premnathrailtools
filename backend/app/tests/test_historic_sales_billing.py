"""Finance billing of HISTORIC sales orders (accounts/services/billing.py and
accounts/routes/sales_billing.py).

Sales Orders were retired on 2026-10-30 (no way to create or approve one), but
confirmed orders that already exist stay billable until they are closed. These
tests build the order from the models only (tests/_so_project_helpers.py) and
cover the kept path: milestone invoice from an order, caps, reversal on cancel
or credit note, per-vehicle delivery billing, and the permission gate of the
bill-from-order endpoints."""
from datetime import timedelta

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts import service as acc
from app.modules.accounts.services import billing, notes
from app.modules.main.models.user import User
from app.modules.sales.models.delivery import SalesInvoiceLink
from app.tests._so_project_helpers import TODAY, deliver_row, make_billing_order
from app.tests.test_accounts_finance import books  # noqa: F401  (fixture)

D0 = TODAY - timedelta(days=20)


def _b(so, t):
    return next(b for b in so.billing_lines if b.milestone_type == t)


def _post(b, inv):
    acc.post_customer_invoice(b["db"], ar_transaction_id=inv.id, created_by_id=b["checker"].id)
    b["db"].commit()


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def test_new_order_advance_is_due_and_delivery_is_not(books):
    so = make_billing_order(books["db"], books["c_local"])
    assert _b(so, "advance").status == "due" and _b(so, "delivery").status == "not_due"
    assert _b(so, "advance").amount == 472000  # 20% of 2 vehicles incl. 18% GST


def test_milestone_invoice_copies_order_caps_and_reverses_on_cancel(books):
    db = books["db"]
    so = make_billing_order(db, books["c_other"])  # interstate customer -> IGST
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
    # A credit note against the invoice reverses the billed amount.
    cn = notes.create_party_note(db, note_type="credit_note", note_date=TODAY, ar_transaction_id=inv2.id,
                                 lines=[{"description": "Rate difference", "quantity": 1, "rate": 100000, "gst_rate": 18}],
                                 created_by_id=books["maker"].id)
    notes.post_party_note(db, party_note_id=cn.id, posted_by_id=books["checker"].id)
    db.commit()
    db.refresh(so)
    assert _b(so, "advance").status == "due" and abs(_b(so, "advance").invoiced_amount - 354000) < 1


def test_delivery_milestone_bills_per_vehicle(books):
    db = books["db"]
    so = make_billing_order(db, books["c_local"])
    r1, r2 = so.schedules
    deliver_row(db, so, r1, D0, reference="RN-1")
    assert so.status == "partially_delivered" and _b(so, "delivery").status == "due"
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
    # Cancelling the invoice frees the vehicle to be billed again.
    acc.cancel_ar_transaction(db, ar_transaction_id=inv.id, reason="re-issue", user_id=books["maker"].id)
    db.commit()
    db.refresh(so)
    assert {v["milestone_type"]: v for v in billing.milestone_views(db, so)}["delivery"]["due_amount"] == 826000.0


def test_spares_dispatch_billing_caps_at_what_was_dispatched(books):
    db = books["db"]
    so = make_billing_order(db, books["c_local"], qty=10, price=1000, line_type="spares", plan=(("dispatch", 100),))
    row = so.schedules[0]
    deliver_row(db, so, row, D0, reference="DC-11", quantity=4, dispatch_only=True)
    inv = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "dispatch").id, invoice_date=TODAY,
                                         created_by_id=books["maker"].id)
    assert inv.invoice_amount == 4000 and inv.reference_type == "sales_order" and inv.customer_po_number == "CR/PO/9"
    with pytest.raises(ValueError, match="nothing to bill|Nothing to bill"):
        billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "dispatch").id, invoice_date=TODAY,
                                       created_by_id=books["maker"].id)


def test_closing_is_blocked_while_milestones_are_not_invoiced(books):
    db = books["db"]
    so = make_billing_order(db, books["c_local"])
    assert billing.open_billing_problems(db, so)


def test_bill_from_order_endpoints_need_the_feature_and_invoice_a_milestone(client, books):
    db = books["db"]
    so = make_billing_order(db, books["c_local"], plan=(("advance", 20), ("drawing_approval", 10), ("delivery", 70)))
    admin = User(email="fin.admin@premnathrail.com", name="Fin Admin", role="admin", is_active=True)
    nobody = User(email="nob@premnathrail.com", name="Nobody", role="user", is_active=True, assigned_apps=["erp"])
    db.add_all([admin, nobody])
    db.commit()

    # Permission denied: no Finance grant -> every bill-from-order endpoint refuses.
    assert client.get("/api/v1/accounts/sales-billing/orders", headers=_h(nobody)).status_code == 403
    assert client.get(f"/api/v1/accounts/sales-billing/orders/{so.id}", headers=_h(nobody)).status_code == 403
    r = client.post("/api/v1/accounts/sales-billing/invoices", headers=_h(nobody), json={
        "so_id": so.id, "billing_plan_line_id": _b(so, "advance").id, "invoice_date": str(TODAY)})
    assert r.status_code == 403

    # Allowed: the picker lists the order with something due; the milestone becomes a draft invoice.
    picker = client.get("/api/v1/accounts/sales-billing/orders", headers=_h(admin)).json()
    assert picker[0]["so_id"] == so.id and picker[0]["due_amount"] > 0
    detail = client.get(f"/api/v1/accounts/sales-billing/orders/{so.id}", headers=_h(admin))
    assert detail.status_code == 200
    assert {m["milestone_type"] for m in detail.json()["milestones"]} == {"advance", "drawing_approval", "delivery"}
    r = client.post("/api/v1/accounts/sales-billing/invoices", headers=_h(admin), json={
        "so_id": so.id, "billing_plan_line_id": _b(so, "advance").id, "invoice_date": str(TODAY)})
    assert r.status_code == 201, r.text
    assert r.json()["invoice_amount"] == 400000 and r.json()["reference_type"] == "sales_order"  # 20% advance of 2 vehicles
    # An unknown order says so with the real reason.
    r = client.get("/api/v1/accounts/sales-billing/orders/999999", headers=_h(admin))
    assert r.status_code == 404 and "no longer exists" in r.json()["detail"]


def test_sales_billing_due_list_is_gone(client, books):
    admin = User(email="fin.admin2@premnathrail.com", name="Fin Admin", role="admin", is_active=True)
    books["db"].add(admin)
    books["db"].commit()
    r = client.get("/api/v1/sales/billing-due", headers=_h(admin))
    assert r.status_code == 410 and "Sales Orders were removed" in r.json()["detail"]
