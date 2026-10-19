"""GL posting idempotency (migration b7d3f1a9c2e4): the database refuses a
second live posting of the same thing, reversals keep working, and a refused
posting rolls back cleanly. Single-session checks on SQLite — the real
two-transaction races are in test_gl_posting_concurrency_pg.py."""
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.modules.accounts import service
from app.modules.accounts.models.fixed_asset import DepreciationRun
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.services import inventory
from app.tests.test_cov_controls_finance import _bill, _post, books  # noqa: F401 — `books` is a fixture


def _je(b, *, ref=None, ref_id=None, posting_type="adjustment", d=date(2026, 7, 1), amount=100, **kw):
    gl = b["gl"]
    return service.post_journal_entry(
        b["db"], posting_date=d, posting_type=posting_type, created_by_id=b["maker"].id,
        reference_document_type=ref, reference_document_id=ref_id, lines=[
            {"gl_account_id": gl["5200"].id, "debit_amount": amount},
            {"gl_account_id": gl["1121"].id, "credit_amount": amount},
        ], **kw)


def _originals(db, ref, ref_id):
    return db.query(JournalEntry).filter_by(reference_document_type=ref, reference_document_id=ref_id,
                                            reverses_journal_entry_id=None).all()


# ── one live original per document ──────────────────────────────────────

def test_posted_invoice_cannot_get_a_second_journal(books):
    db = books["db"]
    inv = _bill(books, "PS/100")
    _post(books, inv)
    # A path that skips the status check (or races it) hits the index.
    with pytest.raises(ValueError, match="vendor invoice has already been posted"):
        _je(books, ref="vendor_invoice", ref_id=inv.id)
    db.rollback()
    assert len(_originals(db, "vendor_invoice", inv.id)) == 1
    # The normal path still answers with the business reason.
    with pytest.raises(ValueError, match="current status: 'posted'"):
        service.post_vendor_invoice(db, vendor_invoice_id=inv.id, created_by_id=books["checker"].id)


def test_refused_duplicate_rolls_back_everything(books):
    db, gl = books["db"], books["gl"]
    first = _je(books, ref="vendor_invoice", ref_id=9001, amount=500)
    db.commit()
    bank_before = db.query(GLBalance).filter_by(gl_account_id=gl["1121"].id, accounting_period="2026-07").one().closing_balance
    count_before = db.query(JournalEntry).count()
    with pytest.raises(ValueError):
        _je(books, ref="vendor_invoice", ref_id=9001, amount=500)
    db.rollback()
    assert db.query(JournalEntry).count() == count_before
    bank_after = db.query(GLBalance).filter_by(gl_account_id=gl["1121"].id, accounting_period="2026-07").one().closing_balance
    assert bank_after == bank_before
    # No voucher number was burnt by the refused attempt.
    nxt = _je(books, amount=1)
    assert int(nxt.entry_number.rsplit("/", 1)[1]) == int(first.entry_number.rsplit("/", 1)[1]) + 1


# ── reversals ───────────────────────────────────────────────────────────

def test_reversal_is_linked_at_insert_and_happens_once(books):
    db = books["db"]
    orig = _je(books, ref="vendor_invoice", ref_id=9002)
    rev = service.reverse_journal_entry(db, journal_entry_id=orig.id, reason="Wrong vendor", reversed_by_id=books["checker"].id)
    db.commit()
    assert rev.reverses_journal_entry_id == orig.id and orig.status == "reversed"
    assert rev.reference_document_type == "vendor_invoice" and rev.reference_document_id == 9002
    # Sequential second attempt: the status check.
    with pytest.raises(ValueError, match="Only a posted journal entry can be reversed"):
        service.reverse_journal_entry(db, journal_entry_id=orig.id, reason="again", reversed_by_id=books["checker"].id)
    # A second live reversal row: the index.
    with pytest.raises(ValueError, match="already been reversed"):
        _je(books, reverses_journal_entry_id=orig.id)
    db.rollback()


def test_reversed_original_frees_the_document_slot(books):
    """Remedy for a double posting is to reverse the extra voucher — so a
    reversed original no longer occupies the document's slot."""
    db = books["db"]
    orig = _je(books, ref="vendor_invoice", ref_id=9003)
    service.reverse_journal_entry(db, journal_entry_id=orig.id, reason="Re-do", reversed_by_id=books["checker"].id)
    again = _je(books, ref="vendor_invoice", ref_id=9003)
    db.commit()
    assert again.status == "posted"
    live = [e for e in _originals(db, "vendor_invoice", 9003) if e.status == "posted"]
    assert [e.id for e in live] == [again.id]


def test_accrual_auto_reversal_still_posts(books):
    db = books["db"]
    acc = _je(books, posting_type="accrual", d=date(2026, 7, 31), auto_reverse_on=date(2026, 8, 1))
    db.commit()
    rev = db.query(JournalEntry).filter_by(reverses_journal_entry_id=acc.id).one()
    assert acc.status == "reversed" and rev.posting_date == date(2026, 8, 1)


# ── period-end processes ────────────────────────────────────────────────

@pytest.mark.parametrize("posting_type,d,match", [
    ("opening", date(2026, 4, 1), "Opening balances were already posted"),
    ("gst_setoff", date(2026, 7, 31), "GST set-off for 2026-07 is already posted"),
    ("year_end", date(2027, 3, 31), "has already been closed"),
])
def test_one_live_process_posting(books, posting_type, d, match):
    db = books["db"]
    first = _je(books, posting_type=posting_type, d=d)
    db.commit()
    with pytest.raises(ValueError, match=match):
        _je(books, posting_type=posting_type, d=d)
    db.rollback()
    # Reversing the first one allows a fresh posting (re-run after a correction).
    service.reverse_journal_entry(db, journal_entry_id=first.id, reason="Redo", reversed_by_id=books["checker"].id,
                                  reversal_date=d)
    assert _je(books, posting_type=posting_type, d=d).status == "posted"
    db.commit()


def test_one_posted_depreciation_run_per_period(books):
    db = books["db"]
    db.add(DepreciationRun(accounting_period="2026-07", run_date=date(2026, 7, 31), status="posted"))
    db.commit()
    db.add(DepreciationRun(accounting_period="2026-07", run_date=date(2026, 7, 31), status="posted"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    db.add(DepreciationRun(accounting_period="2026-07", run_date=date(2026, 7, 31), status="reversed"))
    db.commit()


# ── closing stock: the one legitimate second original ───────────────────

def test_closing_stock_cancellation_is_tagged_apart(books):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_balance import StoreStockBalance
    db = books["db"]
    item = StoreItem(item_code="RM-0001", item_name="Steel bar", uom="KG", moving_average_cost=80, category="Raw")
    loc = StoreLocation(name="Main", code="MAIN")
    db.add_all([item, loc])
    db.flush()
    db.add(StoreStockBalance(item_id=item.id, location_id=loc.id, on_hand_qty=100))
    # Closing stock is rebuilt from the ledger as at period end (MB5B) — seed the receipt row too.
    from app.modules.store.models.stock_transaction import StoreStockTransaction
    db.add(StoreStockTransaction(item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=100,
                                 transaction_date=date(2026, 9, 1)))
    db.commit()
    val = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    inventory.post_valuation(db, valuation_id=val.id, posted_by_id=books["checker"].id)
    inventory.cancel_valuation(db, valuation_id=val.id, user_id=books["checker"].id, reason="Wrong rates")
    db.commit()
    assert len(_originals(db, "inventory_valuation", val.id)) == 1
    assert len(_originals(db, inventory.CANCEL_REFERENCE, val.id)) == 1
    # A fresh valuation for the same month posts normally.
    val2 = inventory.create_valuation(db, accounting_period="2026-09", created_by_id=books["maker"].id)
    inventory.post_valuation(db, valuation_id=val2.id, posted_by_id=books["checker"].id)
    db.commit()
