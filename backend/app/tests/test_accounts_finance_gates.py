"""Finance control gates: journal reversal (Finance Manager only, no
document/system/reversal entries), maker-checker on advance-then-allocate,
derived 'overdue' sales status, period-close guards, and the audit trail
on finance masters."""
from datetime import date

import pytest

from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts import service
from app.modules.accounts.models.inventory_valuation import InventoryValuation
from app.modules.accounts.services import vouchers
from app.tests.test_accounts_finance import books, _jv, _capital, _bill, _sale, _headers  # noqa: F401  (books is a fixture)


@pytest.fixture
def clerk(books):
    db = books["db"]
    u = User(email="clerk@premnathrail.com", name="Clerk", role="user", is_active=True, assigned_apps=["accounts"], is_finance_manager=False)
    db.add(u)
    db.commit()
    return u


def _reverse(client, user, je_id):
    return client.post(f"/api/v1/accounts/journal-entries/{je_id}/reverse", headers=_headers(user),
                       json={"reason": "wrong ledger", "reversal_date": date.today().isoformat()})


def test_reversal_is_finance_manager_only_and_a_reversal_cannot_be_reversed(client, books, clerk):
    _capital(books)
    je = _jv(books, date(2026, 8, 1), "5500", "1121", 1000)
    books["db"].commit()
    denied = _reverse(client, clerk, je.id)
    assert denied.status_code == 403 and "Finance Manager" in denied.json()["detail"]
    ok = _reverse(client, books["checker"], je.id)
    assert ok.status_code == 200, ok.text
    again = _reverse(client, books["checker"], ok.json()["id"])
    assert again.status_code == 400 and "itself a reversal" in again.json()["detail"]


def test_service_refuses_to_reverse_a_reversal(books):
    db = books["db"]
    _capital(books)
    je = _jv(books, date(2026, 8, 1), "5500", "1121", 1000)
    rev = service.reverse_journal_entry(db, journal_entry_id=je.id, reason="oops", reversed_by_id=books["checker"].id)
    with pytest.raises(ValueError, match="itself a reversal"):
        service.reverse_journal_entry(db, journal_entry_id=rev.id, reason="undo", reversed_by_id=books["checker"].id)


@pytest.mark.parametrize("kw, expect", [
    ({"posting_type": "depreciation", "reference_document_type": "depreciation_run", "reference_document_id": 1}, "reverse the depreciation run"),
    ({"posting_type": "year_end"}, "Year-end > Reopen"),
    ({"posting_type": "closing_stock"}, "closing-stock valuation"),
])
def test_document_and_system_journals_cannot_be_reversed_from_journals(client, books, kw, expect):
    db, gl = books["db"], books["gl"]
    _capital(books)
    je = service.post_journal_entry(db, posting_date=date(2026, 8, 1), created_by_id=books["maker"].id, lines=[
        {"gl_account_id": gl["5500"].id, "debit_amount": 500},
        {"gl_account_id": gl["1121"].id, "credit_amount": 500},
    ], **kw)
    db.commit()
    r = _reverse(client, books["checker"], je.id)
    assert r.status_code == 400 and expect in r.json()["detail"], r.text
    db.refresh(je)
    assert je.status == "posted"


def test_bill_maker_cannot_settle_it_by_allocating_an_advance(client, books):
    db = books["db"]
    _capital(books)
    bill = _bill(books, books["v_local"], "PS/ADV/1", 10000)  # booked by maker
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["checker"].id)
    advance = vouchers.create_voucher(db, payment_type="vendor", bank_account_id=books["bank"].id, amount=5000, payment_mode="neft",
                                      payment_date=date(2026, 8, 1), vendor_id=books["v_local"].id, created_by_id=books["maker"].id)
    db.commit()
    payload = {"source_type": "payment", "source_id": advance.id, "allocation_date": "2026-08-02",
               "allocations": [{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 5000}]}
    own = client.post("/api/v1/accounts/payments/allocate", headers=_headers(books["maker"]), json=payload)
    assert own.status_code == 403 and "PS/ADV/1" in own.json()["detail"]
    ok = client.post("/api/v1/accounts/payments/allocate", headers=_headers(books["checker"]), json=payload)
    assert ok.status_code == 200, ok.text


def test_overdue_filter_is_derived_from_due_date(client, books):
    inv = _sale(books, books["c_local"], 10000, d=date(2026, 7, 15))  # 30 credit days -> due mid-Aug, long past
    books["db"].commit()
    r = client.get("/api/v1/accounts/ar-transactions", headers=_headers(books["maker"]), params={"collection_status": "overdue"})
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["id"] for x in rows] == [inv.id] and rows[0]["collection_status"] == "overdue"


def test_period_close_refuses_unfinished_month_and_draft_valuation(books):
    db = books["db"]
    this_month = date.today().strftime("%Y-%m")
    with pytest.raises(ValueError, match="hasn't ended yet"):
        service.close_period(db, accounting_period=this_month, closed_by_id=books["checker"].id, notes=None)
    db.add(InventoryValuation(accounting_period="2026-08", valuation_date=date(2026, 8, 31), status="draft"))
    db.flush()
    with pytest.raises(ValueError, match="closing-stock valuation is still a draft"):
        service.close_period(db, accounting_period="2026-08", closed_by_id=books["checker"].id, notes=None)
    pc = service.close_period(db, accounting_period="2026-07", closed_by_id=books["checker"].id, notes=None)
    assert pc.status == "closed"


def test_vendor_bank_change_is_audited(client, books):
    v = books["v_local"]
    r = client.patch(f"/api/v1/accounts/vendors/{v.id}", headers=_headers(books["checker"]),
                     json={"bank_account_no": "999988887777", "ifsc_code": "HDFC0001234"})
    assert r.status_code == 200, r.text
    rows = books["db"].query(AuditLog).filter(AuditLog.entity_type == "vendor", AuditLog.entity_id == v.id).all()
    assert rows, "vendor edit left no audit trail"


def test_posted_closing_stock_valuation_can_be_cancelled_and_both_dates_net_to_zero(books):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_balance import StoreStockBalance
    from app.modules.accounts.services import inventory
    from app.modules.accounts.services.balances import account_balance
    db, gl = books["db"], books["gl"]
    item = StoreItem(item_code="RM-0002", item_name="Steel plate", uom="KG", moving_average_cost=50, category="Raw")
    loc = StoreLocation(name="Main", code="MAIN")
    db.add_all([item, loc])
    db.flush()
    db.add(StoreStockBalance(item_id=item.id, location_id=loc.id, on_hand_qty=10))
    # Closing stock is rebuilt from the ledger as at period end (MB5B) — seed the receipt row too.
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    db.add(StoreStockTransaction(item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=10,
                                 transaction_date=date(2026, 9, 1)))
    db.commit()
    val = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    inventory.post_valuation(db, valuation_id=val.id, posted_by_id=books["checker"].id)
    assert account_balance(db, gl["1140"].id, date(2026, 9, 30)) == 500
    inventory.cancel_valuation(db, valuation_id=val.id, user_id=books["checker"].id, reason="recount")
    assert val.status == "cancelled"
    assert account_balance(db, gl["1140"].id, date(2026, 9, 30)) == 0
    assert account_balance(db, gl["1140"].id, date(2026, 10, 1)) == 0


def test_pending_filter_excludes_rows_shown_as_overdue(client, books):
    _sale(books, books["c_local"], 10000, d=date(2026, 7, 15))  # past due -> shown as 'overdue'
    books["db"].commit()
    r = client.get("/api/v1/accounts/ar-transactions", headers=_headers(books["maker"]), params={"collection_status": "pending"})
    assert r.status_code == 200, r.text
    assert all(x["collection_status"] == "pending" for x in r.json())
    assert not any(x["collection_status"] == "overdue" for x in r.json())
