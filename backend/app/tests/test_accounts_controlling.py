"""Controlling (CO): account-assignment checks at posting (OKB9-like),
internal orders on every voucher line, KSB1 cost-centre line items, cost
centre x ledger actuals, and KOB1 plan / actual / commitment per order."""
from datetime import date

import pytest

from app.modules.accounts import service, reports
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.journal_entry import JournalEntryLine
from app.modules.accounts.services import controlling, vouchers
from app.modules.main.models.user import User
from app.modules.organization.models.cost_center import CostCenter
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.tests.test_accounts_finance import books, _jv, _capital, _headers  # noqa: F401  (fixture)


@pytest.fixture
def co(books):
    db = books["db"]
    plant = CostCenter(code="CC-PLANT", name="Plant", status="active")
    db.add(plant)
    db.flush()
    maint = CostCenter(code="CC-MAINT", name="Maintenance", status="active", parent_cost_center_id=plant.id)
    old = CostCenter(code="CC-OLD", name="Old shop", status="inactive")
    dated = CostCenter(code="CC-DATED", name="Project shop", status="active",
                       effective_from=date(2026, 4, 1), effective_to=date(2026, 6, 30))
    db.add_all([maint, old, dated])
    db.flush()
    io = InternalOrder(code="IO-ROOF", name="Roof repair", order_type="maintenance", status="open",
                       budgeted_amount=50000, cost_center_id=maint.id,
                       start_date=date(2026, 4, 1), end_date=date(2027, 3, 31))
    db.add(io)
    gl = books["gl"]
    gl["5200"].cost_object_required = True   # Rent: an overhead
    db.commit()
    _capital(books)
    return {**books, "plant": plant, "maint": maint, "old": old, "dated": dated, "io": io}


# ── account assignment ──────────────────────────────────────────────────

def test_inactive_or_out_of_date_cost_centre_is_refused(co):
    with pytest.raises(ValueError, match="CC-OLD.*inactive"):
        _jv(co, date(2026, 7, 1), "5230", "1121", 100, dr={"cost_center_id": co["old"].id})
    with pytest.raises(ValueError, match="CC-DATED.*valid 01-Apr-2026 to 30-Jun-2026"):
        _jv(co, date(2026, 7, 1), "5230", "1121", 100, dr={"cost_center_id": co["dated"].id})
    assert _jv(co, date(2026, 6, 30), "5230", "1121", 100, dr={"cost_center_id": co["dated"].id})


def test_completed_or_closed_order_blocks_postings_but_reversal_still_works(co):
    db = co["db"]
    entry = _jv(co, date(2026, 7, 1), "5220", "1121", 1000, dr={"internal_order_id": co["io"].id})
    line = db.query(JournalEntryLine).filter_by(journal_entry_id=entry.id, line_number=1).one()
    assert line.cost_center_id == co["maint"].id      # the order's cost centre is defaulted
    co["io"].status = "completed"
    db.commit()
    with pytest.raises(ValueError, match="IO-ROOF.*Completed.*In progress"):
        _jv(co, date(2026, 7, 2), "5220", "1121", 10, dr={"internal_order_id": co["io"].id})
    co["io"].status = "closed"
    db.commit()
    with pytest.raises(ValueError, match="Partner"):
        _jv(co, date(2026, 7, 2), "5220", "1121", 10, dr={"internal_order_id": co["io"].id})
    rev = service.reverse_journal_entry(db, journal_entry_id=entry.id, reason="wrong order", reversed_by_id=co["checker"].id,
                                        reversal_date=date(2026, 7, 3))
    assert rev.status == "posted"


def test_order_dates_are_enforced(co):
    with pytest.raises(ValueError, match="runs 01-Apr-2026 to 31-Mar-2027"):
        _jv(co, date(2027, 4, 5), "5220", "1121", 10, dr={"internal_order_id": co["io"].id})


def test_cost_object_required_on_manual_journal_and_ledger_default(co):
    db, gl = co["db"], co["gl"]
    with pytest.raises(ValueError, match="5200 — Rent.*needs a cost centre or an internal order"):
        _jv(co, date(2026, 7, 1), "5200", "1121", 500)
    # Not enforced on system postings (e.g. a transfer), and not on other ledgers.
    service.post_journal_entry(db, posting_date=date(2026, 7, 1), posting_type="transfer", lines=[
        {"gl_account_id": gl["5200"].id, "debit_amount": 5}, {"gl_account_id": gl["1121"].id, "credit_amount": 5}])
    _jv(co, date(2026, 7, 1), "5230", "1121", 5)
    # OKB9: the ledger's default cost centre fills a blank line.
    gl["5200"].default_cost_center_id = co["plant"].id
    db.commit()
    entry = _jv(co, date(2026, 7, 1), "5200", "1121", 500)
    assert db.query(JournalEntryLine).filter_by(journal_entry_id=entry.id, line_number=1).one().cost_center_id == co["plant"].id


def test_draft_journal_is_rechecked_when_posted(co):
    db, gl = co["db"], co["gl"]
    draft = service.create_draft_journal(db, posting_date=date(2026, 7, 1), created_by_id=co["maker"].id, lines=[
        {"gl_account_id": gl["5220"].id, "debit_amount": 10, "internal_order_id": co["io"].id},
        {"gl_account_id": gl["1121"].id, "credit_amount": 10}])
    co["io"].status = "completed"
    db.commit()
    with pytest.raises(ValueError, match="IO-ROOF"):
        service.post_draft_journal(db, journal_entry_id=draft.id, posted_by_id=co["checker"].id)


def test_expense_payment_and_purchase_invoice_carry_the_order(co):
    db, gl = co["db"], co["gl"]
    pay = vouchers.create_voucher(db, payment_type="expense", bank_account_id=co["bank"].id, amount=300, payment_mode="neft",
                                  payment_date=date(2026, 7, 5), created_by_id=co["maker"].id,
                                  lines=[{"gl_account_id": gl["5220"].id, "amount": 300, "internal_order_id": co["io"].id}])
    assert pay.lines[0].internal_order_id == co["io"].id
    jl = db.query(JournalEntryLine).filter_by(journal_entry_id=pay.journal_entry_id, gl_account_id=gl["5220"].id).one()
    assert (jl.internal_order_id, jl.cost_center_id) == (co["io"].id, co["maint"].id)
    with pytest.raises(ValueError, match="Rent.*cost centre"):
        vouchers.create_voucher(db, payment_type="expense", bank_account_id=co["bank"].id, amount=10, payment_mode="neft",
                                payment_date=date(2026, 7, 5), created_by_id=co["maker"].id,
                                lines=[{"gl_account_id": gl["5200"].id, "amount": 10}])
    db.rollback()

    with pytest.raises(ValueError, match="Line 1: ledger '5200 — Rent'"):
        service.create_vendor_invoice(db, vendor_id=co["v_local"].id, invoice_number="R/1", invoice_date=date(2026, 7, 10),
                                      created_by_id=co["maker"].id,
                                      lines=[{"description": "Rent", "quantity": 1, "rate": 1000, "gst_rate": 18, "gl_account_id": gl["5200"].id}])
    bill = service.create_vendor_invoice(
        db, vendor_id=co["v_local"].id, invoice_number="R/2", invoice_date=date(2026, 7, 10), created_by_id=co["maker"].id,
        lines=[{"description": "Roofing sheets", "quantity": 2, "rate": 1000, "gst_rate": 18, "gl_account_id": gl["5220"].id,
                "internal_order_id": co["io"].id}])
    assert bill.lines[0].internal_order_id == co["io"].id
    entry = service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=co["checker"].id)
    jl = db.query(JournalEntryLine).filter_by(journal_entry_id=entry.id, gl_account_id=gl["5220"].id).one()
    assert jl.internal_order_id == co["io"].id and jl.debit_amount == 2000


# ── reports ─────────────────────────────────────────────────────────────

def test_ksb1_line_items_roll_up_sub_centres_and_cc_x_gl_actuals(co):
    db = co["db"]
    _jv(co, date(2026, 7, 1), "5200", "1121", 400, dr={"cost_center_id": co["plant"].id})
    _jv(co, date(2026, 7, 2), "5220", "1121", 250, dr={"cost_center_id": co["maint"].id})
    _jv(co, date(2026, 7, 3), "5230", "1121", 70)   # no cost centre
    own = controlling.cost_object_line_items(db, object_type="cost_center", object_id=co["plant"].id,
                                             from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    assert [r["debit_amount"] for r in own["rows"]] == [400]
    tree = controlling.cost_object_line_items(db, object_type="cost_center", object_id=co["plant"].id, include_children=True,
                                              from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    assert [r["running_total"] for r in tree["rows"]] == [400, 650] and tree["rows"][1]["entry_number"].startswith("JV/")

    matrix = controlling.cost_center_actuals(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    by_gl = {r["gl_account_code"]: r for r in matrix["rows"]}
    assert by_gl["5200"]["amounts"] == {str(co["plant"].id): 400}
    assert by_gl["5230"]["unassigned"] == 70 and matrix["unassigned_total"] == 70
    assert matrix["grand_total"] == 650
    scoped = controlling.cost_center_actuals(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31), cost_center_id=co["plant"].id)
    assert scoped["grand_total"] == 650 and scoped["unassigned_total"] == 0


def test_kob1_plan_actual_commitment_and_life_to_date_variance(co):
    db, io = co["db"], co["io"]
    _jv(co, date(2026, 5, 1), "5220", "1121", 10000, dr={"internal_order_id": io.id})
    _jv(co, date(2026, 8, 1), "5220", "1121", 5000, dr={"internal_order_id": io.id})
    issued = P2PPurchaseOrder(po_number="PO-1", po_date=date(2026, 8, 2), status="issued", vendor_name="Pune Steels", internal_order_id=io.id)
    draft = P2PPurchaseOrder(po_number="PO-2", po_date=date(2026, 8, 2), status="draft", internal_order_id=io.id)
    db.add_all([issued, draft])
    db.flush()
    db.add_all([P2PPurchaseOrderItem(purchase_order_id=issued.id, item_name="Sheet", quantity=4, unit_price=2500),
                P2PPurchaseOrderItem(purchase_order_id=draft.id, item_name="Paint", quantity=1, unit_price=999)])
    db.commit()
    rep = controlling.internal_order_report(db, internal_order_id=io.id)
    s = rep["summary"]
    assert (s["actual_amount"], s["commitment_amount"], s["available_amount"]) == (15000, 10000, 25000)
    assert [c["po_number"] for c in rep["commitments"]] == ["PO-1"]
    assert rep["by_ledger"][0]["amount"] == 15000 and len(rep["line_items"]["rows"]) == 2
    # Variance analysis: an order's actual is life to date even for a narrow range.
    va = reports.get_variance_analysis(db, from_date=date(2026, 8, 1), to_date=date(2026, 8, 31))
    row = next(r for r in va["rows"] if r["type"] == "internal_order")
    assert row["actual_amount"] == 15000 and row["commitment_amount"] == 10000 and row["id"] == io.id


# ── API: status workflow, reports, PATCH guard ──────────────────────────

def test_api_order_status_workflow_and_partner_reopen(client, co):
    db, io = co["db"], co["io"]
    h = _headers(co["maker"])
    base = f"/api/v1/accounts/internal-orders/{io.id}"
    r = client.patch(base, headers=h, json={"status": "closed"})
    assert r.status_code == 400 and "status buttons" in r.json()["detail"]
    r = client.post(f"{base}/status", headers=h, json={"status": "closed"})
    assert r.status_code == 400 and "In progress" in r.json()["detail"]
    for target in ("in_progress", "completed", "closed"):
        r = client.post(f"{base}/status", headers=h, json={"status": target})
        assert r.status_code == 200 and r.json()["status"] == target, r.text
    r = client.post(f"{base}/status", headers=h, json={"status": "in_progress"})
    assert r.status_code == 400 and "reason" in r.json()["detail"]

    partner = User(email="partner@premnathrail.com", name="Partner", role="user", is_active=True,
                   assigned_apps=["accounts"], is_partner=True)
    db.add(partner)
    db.commit()
    r = client.post(f"{base}/status", headers=h, json={"status": "in_progress", "reason": "late invoice"})
    assert r.status_code == 202, r.text
    db.expire_all()
    assert db.get(InternalOrder, io.id).status == "closed"

    rep = client.get(f"/api/v1/accounts/reports/internal-orders/{io.id}", headers=h)
    assert rep.status_code == 200 and rep.json()["summary"]["status"] == "closed"
    cc = client.get("/api/v1/accounts/reports/cost-center-actuals", headers=h, params={"from_date": "2026-04-01", "to_date": "2027-03-31"})
    assert cc.status_code == 200
    li = client.get("/api/v1/accounts/reports/cost-center-line-items", headers=h, params={"cost_center_id": co["plant"].id, "include_children": True})
    assert li.status_code == 200 and li.json()["code"] == "CC-PLANT"


def test_api_partner_reopens_at_once(client, co):
    db, io = co["db"], co["io"]
    io.status = "closed"
    partner = User(email="p2@premnathrail.com", name="Partner Two", role="user", is_active=True,
                   assigned_apps=["accounts"], is_partner=True)
    db.add(partner)
    db.commit()
    r = client.post(f"/api/v1/accounts/internal-orders/{io.id}/status", headers=_headers(partner),
                    json={"status": "in_progress", "reason": "warranty claim cost"})
    assert r.status_code == 200 and r.json()["status"] == "in_progress", r.text


def test_api_journal_list_filters_by_cost_object(client, co):
    _jv(co, date(2026, 7, 1), "5220", "1121", 100, dr={"cost_center_id": co["maint"].id})
    _jv(co, date(2026, 7, 1), "5220", "1121", 100, dr={"internal_order_id": co["io"].id})
    h = _headers(co["maker"])
    by_cc = client.get("/api/v1/accounts/journal-entries", headers=h, params={"cost_center_id": co["plant"].id, "include_sub_cost_centers": True})
    assert by_cc.status_code == 200 and len(by_cc.json()) == 2     # the order's line defaulted to CC-MAINT
    by_io = client.get("/api/v1/accounts/journal-entries", headers=h, params={"internal_order_id": co["io"].id})
    assert len(by_io.json()) == 1


def test_new_overhead_ledger_requires_cost_object_by_default(client, co):
    db = co["db"]
    from app.modules.accounts.models.account_group import AccountGroup
    ie = db.query(AccountGroup).filter_by(code="G-IE").one()
    pur = db.query(AccountGroup).filter_by(code="G-PUR").one()
    h = _headers(co["maker"])
    a = client.post("/api/v1/accounts/gl-accounts", headers=h, json={"code": "5240", "name": "Security", "group_id": ie.id})
    b = client.post("/api/v1/accounts/gl-accounts", headers=h, json={"code": "5002", "name": "Purchases - imports", "group_id": pur.id})
    assert a.status_code == 201 and a.json()["cost_object_required"] is True
    assert b.status_code == 201 and b.json()["cost_object_required"] is False
    bad = client.patch(f"/api/v1/accounts/gl-accounts/{co['gl']['1121'].id}", headers=h, json={"cost_object_required": True})
    assert bad.status_code == 400 and "P&L ledger" in bad.json()["detail"]
