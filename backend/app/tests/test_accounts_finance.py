"""Finance & Accounting — the accounting rules the module promises
(docs/02-modules/finance/FINANCE_STANDARDS_PLAN.md): FY voucher numbering,
balance carry-forward, maker-checker, GST split, bill-wise settlement,
notes, cash control, GST set-off order, depreciation, closing stock,
year-end close, and statements that balance."""
import importlib.util
from datetime import date
from pathlib import Path

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.company import Company
from app.modules.crm.models.organization import Organization
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.gl_balance import GLBalance
from app.modules.accounts.models.settings import AccountDetermination, GSTRate
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts import service, reports
from app.modules.accounts.services import gst, vouchers, notes, gst_returns, assets, inventory, closing, outstanding
from app.modules.accounts.services.balances import account_balance, rebuild_gl_balances

VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"


def _load_migration(name: str):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def gstin_for(state: str, pan: str = "AAACP1234C") -> str:
    """A GSTIN with a correct check character."""
    body = f"{state}{pan}1Z"
    for ch in gst._CHARSET:
        if gst.gstin_checksum_ok(body + ch):
            return body + ch
    raise AssertionError("no checksum")


# ── fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
def books(db):
    """Chart of accounts exactly as the migrations seed it, a Maharashtra
    company, two finance users, a bank, a cash box, vendors and customers."""
    seed = _load_migration("f2a3b4c5d6e7_seed_standard_chart_of_accounts")
    upg = _load_migration("a8c3e5f7b9d1_accounts_standards_upgrade")
    groups = {}
    for code, name, parent, nature, head, gp, seq in upg.GROUPS:
        g = AccountGroup(code=code, name=name, parent_id=groups[parent].id if parent else None, nature=nature,
                         schedule_iii_head=head, affects_gross_profit=gp, sequence=seq, is_system=True)
        db.add(g)
        db.flush()
        groups[code] = g
    for code, name, _type, _sub, posting, control in seed.CHART_OF_ACCOUNTS:
        gcode = upg.LEDGER_GROUP.get(code) or upg.TYPE_FALLBACK[_type]
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=posting, is_control_account=control, status="active"))
    for code, name, gcode, control in upg.NEW_LEDGERS:
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=True, is_control_account=control, status="active"))
    for role in upg.LEDGER_ROLES:
        db.add(AccountDetermination(role=role))
    for rate, desc, active in upg.GST_RATES:
        db.add(GSTRate(rate=rate, description=desc, is_active=active))
    # Extra ledgers the tests need.
    db.add(GLAccount(code="1121", name="HDFC Current A/c", account_type="asset", group_id=groups["G-BANK"].id, is_posting_account=True))
    db.add(GLAccount(code="1111", name="Petty Cash", account_type="asset", group_id=groups["G-CASH"].id, is_posting_account=True))
    db.add(Company(name="Premnath Rail Tools", code="PRT", gstin=gstin_for("27")))
    maker = User(email="maker@premnathrail.com", name="Maker", role="user", is_active=True, assigned_apps=["accounts"], is_finance_manager=True)
    checker = User(email="checker@premnathrail.com", name="Checker", role="user", is_active=True, assigned_apps=["accounts"], is_finance_manager=True)
    db.add_all([maker, checker])
    db.flush()
    gl = {a.code: a for a in db.query(GLAccount).all()}
    bank = BankAccount(account_kind="bank", bank_name="HDFC", account_no="5010001", gl_account_id=gl["1121"].id)
    cash = BankAccount(account_kind="cash", bank_name="Petty Cash", gl_account_id=gl["1111"].id)
    v_local = Vendor(code="V-MH", name="Pune Steels", gstin=gstin_for("27", "AABCP5678D"), state="Maharashtra", payment_days=30)
    v_other = Vendor(code="V-GJ", name="Surat Hydraulics", gstin=gstin_for("24", "AABCS1111E"), state="Gujarat", payment_days=45)
    v_unreg = Vendor(code="V-UR", name="Local Transporter", state="Maharashtra", gst_registration_type="unregistered")
    c_local = Organization(name="Central Railway Workshop", gst_number=gstin_for("27", "AAAGC0001A"), state="Maharashtra", credit_days=30)
    c_other = Organization(name="Northern Railway", gst_number=gstin_for("07", "AAAGN0002B"), state="Delhi", credit_days=60)
    db.add_all([bank, cash, v_local, v_other, v_unreg, c_local, c_other])
    db.commit()
    return {"db": db, "gl": gl, "maker": maker, "checker": checker, "bank": bank, "cash": cash, "v_local": v_local,
            "v_other": v_other, "v_unreg": v_unreg, "c_local": c_local, "c_other": c_other}


def _jv(b, d, debit_code, credit_code, amount, **kw):
    gl = b["gl"]
    return service.post_journal_entry(b["db"], posting_date=d, created_by_id=b["maker"].id, lines=[
        {"gl_account_id": gl[debit_code].id, "debit_amount": amount, **kw.get("dr", {})},
        {"gl_account_id": gl[credit_code].id, "credit_amount": amount, **kw.get("cr", {})},
    ])


def _capital(b, amount=1_000_000, d=date(2026, 4, 1)):
    """Partners bring capital into the bank."""
    return _jv(b, d, "1121", "3000", amount)


# ── GSTIN, FY numbering, carry-forward ──────────────────────────────────

def test_gstin_check_digit_catches_typos():
    good = gstin_for("27")
    assert gst.validate_gstin(good.lower()) == good
    bad = good[:-1] + ("0" if good[-1] != "0" else "1")
    with pytest.raises(ValueError, match="check-digit"):
        gst.validate_gstin(bad)
    with pytest.raises(ValueError, match="format"):
        gst.validate_gstin("27ABC")


def test_voucher_numbers_run_per_type_per_financial_year(books):
    a = _jv(books, date(2026, 5, 1), "5200", "1121", 100)
    b = _jv(books, date(2027, 3, 31), "5200", "1121", 100)
    c = _jv(books, date(2027, 4, 1), "5200", "1121", 100)
    assert (a.entry_number, b.entry_number, c.entry_number) == ("JV/2026-27/0001", "JV/2026-27/0002", "JV/2027-28/0001")
    assert a.financial_year == "2026-27" and c.financial_year == "2027-28"


def test_balances_carry_forward_and_backdated_postings_roll_forward(books):
    db, gl = books["db"], books["gl"]
    _capital(books, 1000, date(2026, 9, 5))
    _jv(books, date(2026, 10, 5), "5200", "1121", 300)
    oct_bal = db.query(GLBalance).filter_by(gl_account_id=gl["1121"].id, accounting_period="2026-10").one()
    assert (oct_bal.opening_balance, oct_bal.closing_balance) == (1000, 700)
    # A back-dated August receipt must lift September's and October's balances too.
    _jv(books, date(2026, 8, 20), "1121", "4110", 50)
    db.refresh(oct_bal)
    assert (oct_bal.opening_balance, oct_bal.closing_balance) == (1050, 750)
    assert account_balance(db, gl["1121"].id, date(2026, 10, 31)) == 750
    rebuild_gl_balances(db)
    rebuilt = db.query(GLBalance).filter_by(gl_account_id=gl["1121"].id, accounting_period="2026-10").one()
    assert rebuilt.closing_balance == 750


def test_unbalanced_and_untagged_control_lines_are_refused(books):
    gl = books["gl"]
    with pytest.raises(ValueError, match="out of balance"):
        service.post_journal_entry(books["db"], posting_date=date(2026, 5, 1), lines=[
            {"gl_account_id": gl["5200"].id, "debit_amount": 100}, {"gl_account_id": gl["1121"].id, "credit_amount": 90}])
    with pytest.raises(ValueError, match="control account"):
        service.create_draft_journal(books["db"], posting_date=date(2026, 5, 1), posting_type="adjustment", lines=[
            {"gl_account_id": gl["2010"].id, "debit_amount": 100}, {"gl_account_id": gl["1121"].id, "credit_amount": 100}])


def test_manual_journal_is_maker_checker(books):
    gl = books["gl"]
    draft = service.create_draft_journal(books["db"], posting_date=date(2026, 6, 30), posting_type="accrual",
                                         auto_reverse_on=date(2026, 7, 1), created_by_id=books["maker"].id, lines=[
                                             {"gl_account_id": gl["5210"].id, "debit_amount": 5000},
                                             {"gl_account_id": gl["2070"].id, "credit_amount": 5000}])
    assert draft.status == "draft" and draft.entry_number.startswith("DRAFT-")
    with pytest.raises(PermissionError):
        service.post_draft_journal(books["db"], journal_entry_id=draft.id, posted_by_id=books["maker"].id)
    posted = service.post_draft_journal(books["db"], journal_entry_id=draft.id, posted_by_id=books["checker"].id)
    assert posted.entry_number == "JV/2026-27/0001"
    # The accrual reversed itself on 1-Jul: June carries the expense, the payable is gone by July.
    assert account_balance(books["db"], gl["2070"].id, date(2026, 6, 30)) == -5000
    assert account_balance(books["db"], gl["2070"].id, date(2026, 7, 1)) == 0


# ── Purchase ────────────────────────────────────────────────────────────

def _bill(b, vendor, number, amount, rate=18, d=date(2026, 7, 10), **kw):
    return service.create_vendor_invoice(
        b["db"], vendor_id=vendor.id, invoice_number=number, invoice_date=d, created_by_id=b["maker"].id,
        lines=[{"description": "Hydraulic hose", "hsn_sac_code": "4009", "quantity": 10, "rate": amount / 10, "gst_rate": rate}], **kw)


def test_purchase_gst_split_follows_place_of_supply(books):
    intra = _bill(books, books["v_local"], "PS/101", 10000)
    inter = _bill(books, books["v_other"], "SH/55", 10000)
    assert (intra.cgst_amount, intra.sgst_amount, intra.igst_amount, intra.invoice_total) == (900, 900, 0, 11800)
    assert (inter.cgst_amount, inter.sgst_amount, inter.igst_amount) == (0, 0, 1800)
    assert intra.due_date == date(2026, 8, 9)
    with pytest.raises(ValueError, match="already been recorded"):
        _bill(books, books["v_local"], "ps/101", 500)


def test_purchase_posting_is_maker_checker_and_hits_split_ledgers(books):
    db, gl = books["db"], books["gl"]
    bill = _bill(books, books["v_other"], "SH/56", 10000)
    with pytest.raises(PermissionError):
        service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["maker"].id)
    entry = service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["checker"].id)
    assert entry.entry_number == "PI/2026-27/0001"
    assert account_balance(db, gl["1153"].id, date(2026, 7, 31)) == 1800      # IGST input
    assert account_balance(db, gl["5001"].id, date(2026, 7, 31)) == 10000     # Purchases
    assert account_balance(db, gl["2010"].id, date(2026, 7, 31)) == -11800    # owed to vendor


def test_reverse_charge_tax_is_owed_to_government_not_vendor(books):
    db, gl = books["db"], books["gl"]
    with pytest.raises(ValueError, match="unregistered"):
        _bill(books, books["v_unreg"], "LT/1", 5000, rate=5)
    bill = _bill(books, books["v_unreg"], "LT/2", 5000, rate=5, is_reverse_charge=True)
    assert bill.invoice_total == 5000
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["checker"].id)
    assert account_balance(db, gl["2024"].id, date(2026, 7, 31)) == -250
    assert account_balance(db, gl["1151"].id, date(2026, 7, 31)) == 125


# ── Sales, notes ────────────────────────────────────────────────────────

def _sale(b, customer, amount, rate=18, d=date(2026, 7, 15)):
    inv = service.create_ar_transaction(b["db"], customer_id=customer.id, invoice_date=d, created_by_id=b["maker"].id,
                                        lines=[{"description": "Rail drill", "hsn_sac_code": "8467", "quantity": 1, "rate": amount, "gst_rate": rate}])
    service.post_customer_invoice(b["db"], ar_transaction_id=inv.id, created_by_id=b["checker"].id)
    return inv


def test_sales_invoice_is_numbered_only_when_issued(books):
    draft = service.create_ar_transaction(books["db"], customer_id=books["c_other"].id, invoice_date=date(2026, 7, 15),
                                          created_by_id=books["maker"].id,
                                          lines=[{"description": "Rail drill", "quantity": 2, "rate": 50000, "gst_rate": 18}])
    assert draft.invoice_number.startswith("DRAFT-") and draft.igst_amount == 18000
    service.cancel_ar_transaction(books["db"], ar_transaction_id=draft.id, reason="wrong customer", user_id=books["maker"].id)
    issued = _sale(books, books["c_local"], 100000)
    assert issued.invoice_number == "SI/2026-27/0001"  # the discarded draft left no gap
    assert (issued.cgst_amount, issued.sgst_amount, issued.total_amount) == (9000, 9000, 118000)
    with pytest.raises(ValueError, match="credit note"):
        service.cancel_ar_transaction(books["db"], ar_transaction_id=issued.id, reason="x", user_id=books["maker"].id)


def test_credit_note_reduces_invoice_and_output_gst(books):
    db, gl = books["db"], books["gl"]
    inv = _sale(books, books["c_local"], 100000)
    with pytest.raises(ValueError, match="original sales invoice"):
        notes.create_party_note(db, note_type="credit_note", note_date=date(2026, 7, 20), lines=[{"quantity": 1, "rate": 10}],
                                created_by_id=books["maker"].id)
    cn = notes.create_party_note(db, note_type="credit_note", note_date=date(2026, 7, 20), ar_transaction_id=inv.id,
                                 lines=[{"description": "Return 1 unit", "quantity": 1, "rate": 20000, "gst_rate": 18}],
                                 created_by_id=books["maker"].id)
    notes.post_party_note(db, party_note_id=cn.id, posted_by_id=books["checker"].id)
    db.refresh(inv)
    assert cn.note_number == "CN/2026-27/0001" and inv.amount_due == 118000 - 23600
    assert account_balance(db, gl["2021"].id, date(2026, 7, 31)) == -(9000 - 1800)
    with pytest.raises(ValueError, match="more than the invoice"):
        notes.create_party_note(db, note_type="credit_note", note_date=date(2026, 7, 21), ar_transaction_id=inv.id,
                                lines=[{"quantity": 1, "rate": 90000, "gst_rate": 18}], created_by_id=books["maker"].id)
    late = date(2027, 12, 1)
    with pytest.raises(ValueError, match="s.34"):
        notes.create_party_note(db, note_type="credit_note", note_date=late, ar_transaction_id=inv.id,
                                lines=[{"quantity": 1, "rate": 100, "gst_rate": 18}], created_by_id=books["maker"].id)


# ── Payments, receipts, contra, cash control ────────────────────────────

def test_payment_settles_bills_bill_wise_and_keeps_the_rest_as_advance(books):
    db = books["db"]
    _capital(books)
    b1 = _bill(books, books["v_local"], "PS/201", 10000)
    b2 = _bill(books, books["v_local"], "PS/202", 5000)
    for b in (b1, b2):
        service.post_vendor_invoice(db, vendor_invoice_id=b.id, created_by_id=books["checker"].id)
    pv = vouchers.create_voucher(db, payment_type="vendor", bank_account_id=books["bank"].id, amount=20000, payment_mode="neft",
                                 payment_date=date(2026, 8, 1), vendor_id=books["v_local"].id, created_by_id=books["checker"].id,
                                 allocations=[{"target_type": "vendor_invoice", "target_id": b1.id, "amount": 11800},
                                              {"target_type": "vendor_invoice", "target_id": b2.id, "amount": 2000}])
    db.refresh(b1); db.refresh(b2)
    assert pv.payment_number == "PV/2026-27/0001"
    assert (b1.payment_status, b2.payment_status, b2.amount_due, pv.unallocated_amount) == ("paid", "partial", 3900, 6200)
    vouchers.allocate(db, source_type="payment", source_id=pv.id, target_type="vendor_invoice", target_id=b2.id, amount=3900,
                      allocation_date=date(2026, 8, 2), created_by_id=books["checker"].id)
    summary = outstanding.party_outstanding(db, party_type="vendor")
    row = next(r for r in summary["rows"] if r["party_id"] == books["v_local"].id)
    assert row["outstanding"] == 0 and row["advances"] == 2300
    vouchers.cancel_voucher(db, payment_id=pv.id, reason="duplicate", user_id=books["checker"].id)
    db.refresh(b1)
    assert b1.amount_due == 11800 and b1.payment_status == "pending"


def test_cash_cannot_go_negative_and_contra_moves_money(books):
    db = books["db"]
    _capital(books, 50000)
    with pytest.raises(ValueError, match="negative"):
        vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["cash"].id, amount=500, payment_mode="cash",
                                payment_date=date(2026, 5, 2), created_by_id=books["maker"].id,
                                lines=[{"gl_account_id": books["gl"]["5230"].id, "amount": 500}])
    cv = vouchers.create_voucher(db, payment_type="contra", bank_account_id=books["bank"].id, counter_bank_account_id=books["cash"].id,
                                 amount=2000, payment_mode="cheque", cheque_number="000123", payment_date=date(2026, 5, 2),
                                 created_by_id=books["maker"].id)
    assert cv.payment_number == "CV/2026-27/0001"
    vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["cash"].id, amount=500, payment_mode="cash",
                            payment_date=date(2026, 5, 3), created_by_id=books["maker"].id,
                            lines=[{"gl_account_id": books["gl"]["5230"].id, "amount": 500}])
    assert service.bank_book_balance(db, books["cash"], date(2026, 5, 31)) == 1500
    with pytest.raises(ValueError, match="must be 'cash'"):
        vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["cash"].id, amount=10, payment_mode="neft",
                                payment_date=date(2026, 5, 3), created_by_id=books["maker"].id,
                                lines=[{"gl_account_id": books["gl"]["5230"].id, "amount": 10}])


def test_bank_reconciliation_uses_clearing_dates(books):
    db = books["db"]
    _capital(books, 100000, date(2026, 5, 1))
    pv = vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["bank"].id, amount=4000, payment_mode="cheque",
                                 cheque_number="111", payment_date=date(2026, 5, 28), created_by_id=books["maker"].id,
                                 lines=[{"gl_account_id": books["gl"]["5220"].id, "amount": 4000}])
    # Bank statement on 31-May still shows 1,00,000 — the cheque hasn't cleared.
    recon = service.create_bank_reconciliation(db, bank_account_id=books["bank"].id, statement_date=date(2026, 5, 31),
                                               statement_balance=100000, created_by_id=books["maker"].id)
    summary = service.compute_reconciliation_summary(db, recon.id)
    assert (recon.book_balance, summary["outstanding_cheques"], summary["difference"]) == (96000, 4000, 0)
    service.complete_bank_reconciliation(db, bank_reconciliation_id=recon.id, completed_by_id=books["maker"].id)
    recon2 = service.create_bank_reconciliation(db, bank_account_id=books["bank"].id, statement_date=date(2026, 6, 30),
                                                statement_balance=96000, created_by_id=books["maker"].id)
    service.mark_payments_reconciled(db, bank_reconciliation_id=recon2.id, payment_transaction_ids=[pv.id], cleared_date=date(2026, 6, 3))
    assert service.compute_reconciliation_summary(db, recon2.id)["difference"] == 0
    db.refresh(pv)
    assert pv.cleared_date == date(2026, 6, 3)
    # The May statement stays reconciled after June clears its outstanding cheque.
    assert service.compute_reconciliation_summary(db, recon.id)["outstanding_cheques"] == 4000
    assert service.compute_reconciliation_summary(db, recon.id)["difference"] == 0


def test_bank_reconciliation_counts_bank_charges_booked_during_it(books):
    db = books["db"]
    _capital(books, 100000, date(2026, 5, 1))
    # Statement shows a 250 bank charge we haven't booked yet.
    recon = service.create_bank_reconciliation(db, bank_account_id=books["bank"].id, statement_date=date(2026, 5, 31),
                                               statement_balance=99750, created_by_id=books["maker"].id)
    assert service.compute_reconciliation_summary(db, recon.id)["difference"] == -250
    charge = vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["bank"].id, amount=250, payment_mode="neft",
                                     payment_date=date(2026, 5, 31), created_by_id=books["maker"].id,
                                     lines=[{"gl_account_id": books["gl"]["5220"].id, "amount": 250}])
    service.mark_payments_reconciled(db, bank_reconciliation_id=recon.id, payment_transaction_ids=[charge.id])
    summary = service.compute_reconciliation_summary(db, recon.id)
    assert (summary["book_balance"], summary["difference"]) == (99750, 0)
    service.complete_bank_reconciliation(db, bank_reconciliation_id=recon.id, completed_by_id=books["maker"].id)
    assert recon.book_balance == 99750


def test_cancelled_voucher_cannot_be_ticked_as_cleared(books):
    db = books["db"]
    _capital(books, 100000, date(2026, 5, 1))
    pv = vouchers.create_voucher(db, payment_type="expense", bank_account_id=books["bank"].id, amount=1000, payment_mode="neft",
                                 payment_date=date(2026, 5, 10), created_by_id=books["maker"].id,
                                 lines=[{"gl_account_id": books["gl"]["5220"].id, "amount": 1000}])
    vouchers.cancel_voucher(db, payment_id=pv.id, reason="wrong account", user_id=books["checker"].id, cancel_date=date(2026, 5, 11))
    recon = service.create_bank_reconciliation(db, bank_account_id=books["bank"].id, statement_date=date(2026, 5, 31),
                                               statement_balance=100000, created_by_id=books["maker"].id)
    with pytest.raises(ValueError, match="cancelled"):
        service.mark_payments_reconciled(db, bank_reconciliation_id=recon.id, payment_transaction_ids=[pv.id])


# ── GST set-off ─────────────────────────────────────────────────────────

def test_gst_setoff_follows_rule_88a_order(books):
    db = books["db"]
    # Input: IGST 1,800 (Gujarat vendor) + CGST/SGST 450 each (local vendor).
    for v, no, amt in ((books["v_other"], "SH/1", 10000), (books["v_local"], "PS/1", 5000)):
        bill = _bill(books, v, no, amt, d=date(2026, 9, 5))
        service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["checker"].id)
    # Output: CGST/SGST 2,700 each (local sale).
    _sale(books, books["c_local"], 30000, d=date(2026, 9, 10))
    calc = gst_returns.compute_setoff(db, period="2026-09")
    steps = [(s["credit_of"], s["paid_against"], s["amount"]) for s in calc["utilisation"]]
    assert steps[0] == ("IGST", "CGST", 1800)          # IGST credit used first
    assert ("CGST", "CGST", 450) in steps and ("SGST", "SGST", 450) in steps
    assert calc["cash_payable"] == {"igst": 0, "cgst": 450, "sgst": 2250, "rcm": 0}
    gst_returns.post_setoff(db, period="2026-09", user_id=books["checker"].id)
    with pytest.raises(ValueError, match="already posted"):
        gst_returns.post_setoff(db, period="2026-09", user_id=books["checker"].id)
    # Reverse it and redo it — the reversal itself isn't a set-off.
    first = gst_returns._existing_setoff(db, "2026-09")
    service.reverse_journal_entry(db, journal_entry_id=first.id, reason="redo", reversed_by_id=books["checker"].id,
                                  reversal_date=first.posting_date)
    redo = gst_returns.post_setoff(db, period="2026-09", user_id=books["checker"].id)
    assert gst_returns._existing_setoff(db, "2026-09").id == redo.id
    r1 = gst_returns.gstr1(db, period="2026-09")
    assert len(r1["b2b"]) == 1 and r1["hsn_summary"][0]["hsn_sac"] == "8467"


# ── Fixed assets, closing stock, year end, statements ───────────────────

def test_slm_depreciation_is_pro_rata_and_disposal_books_the_gain(books):
    db, gl = books["db"], books["gl"]
    _capital(books)
    _jv(books, date(2026, 4, 1), "1010", "1121", 365000)  # the purchase itself (normally a purchase invoice)
    asset = assets.create_asset(db, created_by_id=books["maker"].id, data={
        "asset_code": "PM-001", "name": "CNC lathe", "asset_gl_account_id": gl["1010"].id, "purchase_date": date(2026, 4, 1),
        "put_to_use_date": date(2026, 4, 16), "cost": 365000, "residual_value": 0, "depreciation_method": "slm", "useful_life_months": 120})
    run = assets.run_depreciation(db, accounting_period="2026-04", created_by_id=books["checker"].id)
    assert run.total_amount == 1500.0                    # 36,500 a year x 15 days / 365
    with pytest.raises(ValueError, match="already been run"):
        assets.run_depreciation(db, accounting_period="2026-04", created_by_id=books["checker"].id)
    assets.dispose_asset(db, asset_id=asset.id, disposal_date=date(2026, 5, 10), proceeds=370000,
                         proceeds_gl_account_id=gl["1121"].id, user_id=books["checker"].id)
    # Book value 365000 - 1500 - 1000 (10 more days) = 362500 -> gain 7,500.
    assert account_balance(db, gl["4120"].id, date(2026, 5, 31)) == -7500
    assert account_balance(db, gl["1010"].id, date(2026, 5, 31)) == 0


def test_closing_stock_posts_and_reverses_next_day(books):
    from app.modules.store.models.item import StoreItem
    from app.modules.store.models.location import StoreLocation
    from app.modules.store.models.stock_balance import StoreStockBalance
    db, gl = books["db"], books["gl"]
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
    assert val.total_value == 8000
    inventory.post_valuation(db, valuation_id=val.id, posted_by_id=books["checker"].id)
    assert account_balance(db, gl["1140"].id, date(2026, 9, 30)) == 8000
    assert account_balance(db, gl["1140"].id, date(2026, 10, 1)) == 0  # opening stock of October


def test_statements_balance_and_year_end_moves_profit_to_reserves(books):
    db, gl = books["db"], books["gl"]
    _capital(books, 500000, date(2026, 4, 1))
    bill = _bill(books, books["v_local"], "PS/900", 100000, d=date(2026, 6, 1))
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=books["checker"].id)
    inv = _sale(books, books["c_other"], 250000, d=date(2026, 7, 1))
    vouchers.create_voucher(db, payment_type="customer", bank_account_id=books["bank"].id, amount=100000, payment_mode="rtgs",
                            payment_date=date(2026, 8, 1), customer_id=books["c_other"].id, created_by_id=books["maker"].id,
                            allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 100000}])
    _jv(books, date(2026, 9, 1), "5500", "1121", 2000)

    tb = reports.get_trial_balance(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    assert tb["is_balanced"]
    pl = reports.get_profit_and_loss(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    assert pl["profit_for_period"] == 250000 - 100000 - 2000
    bs = reports.get_balance_sheet(db, as_of=date(2027, 3, 31))
    assert bs["is_balanced"], bs["difference"]
    cf = reports.get_cash_flow(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))
    assert cf["difference"] == 0 and cf["closing_cash"] == 500000 + 100000 - 2000

    closing.close_financial_year(db, fy_code="2026-27", user_id=books["checker"].id)
    assert account_balance(db, gl["4000"].id, date(2027, 3, 31)) == 0
    assert account_balance(db, gl["3010"].id, date(2027, 3, 31)) == -148000
    assert reports.get_profit_and_loss(db, from_date=date(2026, 4, 1), to_date=date(2027, 3, 31))["profit_for_period"] == 148000
    assert reports.get_balance_sheet(db, as_of=date(2027, 3, 31))["is_balanced"]
    # Reopen, then close again: the reopen's reversal must not count as a close.
    closing.reopen_financial_year(db, fy_code="2026-27", reason="audit adjustment", user_id=books["checker"].id)
    assert closing.year_end_preview(db, fy_code="2026-27")["closing_entry"] is None
    closing.close_financial_year(db, fy_code="2026-27", user_id=books["checker"].id)
    assert account_balance(db, gl["3010"].id, date(2027, 3, 31)) == -148000


def test_opening_balances_must_balance_and_create_open_bills(books):
    from app.modules.accounts.services.opening import post_opening_balances
    db, gl = books["db"], books["gl"]
    with pytest.raises(ValueError, match="out of balance"):
        post_opening_balances(db, as_of=date(2026, 4, 1), created_by_id=books["maker"].id, customer_bills=[],
                              ledger_lines=[{"gl_account_id": gl["1121"].id, "debit_amount": 1000}],
                              vendor_bills=[{"vendor_id": books["v_local"].id, "bill_number": "OLD/1", "amount": 900}])
    db.rollback()
    entry = post_opening_balances(db, as_of=date(2026, 4, 1), created_by_id=books["maker"].id,
                                  ledger_lines=[{"gl_account_id": gl["1121"].id, "debit_amount": 1000},
                                                {"gl_account_id": gl["3000"].id, "credit_amount": 600}],
                                  vendor_bills=[{"vendor_id": books["v_local"].id, "bill_number": "OLD/1", "amount": 900}],
                                  customer_bills=[{"customer_id": books["c_local"].id, "invoice_number": "17", "amount": 500}])
    assert entry.entry_number == "OB/2026-27/0001"
    docs = outstanding.open_documents(db, party_type="vendor", party_id=books["v_local"].id)
    assert docs[0]["doc_number"] == "OLD/1" and docs[0]["amount_due"] == 900


def test_reversing_opening_voucher_releases_its_open_bills(books):
    from app.modules.accounts.services.opening import post_opening_balances, release_opening_documents
    db, gl = books["db"], books["gl"]
    kwargs = dict(as_of=date(2026, 4, 1), created_by_id=books["maker"].id,
                  ledger_lines=[{"gl_account_id": gl["1121"].id, "debit_amount": 1000},
                                {"gl_account_id": gl["3000"].id, "credit_amount": 600}],
                  vendor_bills=[{"vendor_id": books["v_local"].id, "bill_number": "OLD/1", "amount": 900}],
                  customer_bills=[{"customer_id": books["c_local"].id, "invoice_number": "17", "amount": 500}])
    entry = post_opening_balances(db, **kwargs)
    assert release_opening_documents(db, journal_entry_id=entry.id, reason="wrong figures") == 2
    service.reverse_journal_entry(db, journal_entry_id=entry.id, reason="wrong figures", reversed_by_id=books["checker"].id,
                                  reversal_date=date(2026, 4, 1))
    # No phantom dues left on the party ledgers…
    assert outstanding.open_documents(db, party_type="vendor", party_id=books["v_local"].id) == []
    assert outstanding.open_documents(db, party_type="customer", party_id=books["c_local"].id) == []
    # …and the corrected opening can reuse the same bill numbers.
    again = post_opening_balances(db, **kwargs)
    assert again.entry_number == "OB/2026-27/0002"
    docs = outstanding.open_documents(db, party_type="vendor", party_id=books["v_local"].id)
    assert [d["doc_number"] for d in docs] == ["OLD/1"]


# ── API wiring ──────────────────────────────────────────────────────────

def _headers(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}


def test_api_purchase_flow_and_maker_checker(client, books):
    maker, checker = _headers(books["maker"]), _headers(books["checker"])
    r = client.post("/api/v1/accounts/vendor-invoices", headers=maker, json={
        "vendor_id": books["v_other"].id, "invoice_number": "SH/API/1", "invoice_date": "2026-07-01",
        "lines": [{"description": "Valve", "hsn_sac_code": "8481", "quantity": 4, "rate": 2500, "gst_rate": 18}]})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invoice_type"] == "direct" and body["igst_amount"] == 1800 and body["lines"][0]["gl_account_code"] == "5001"
    own = client.post(f"/api/v1/accounts/vendor-invoices/{body['id']}/post", headers=maker)
    assert own.status_code == 403 and "another finance user" in own.json()["detail"]
    ok = client.post(f"/api/v1/accounts/vendor-invoices/{body['id']}/post", headers=checker)
    assert ok.status_code == 200 and ok.json()["journal_entry_number"] == "PI/2026-27/0001"
    bad = client.post("/api/v1/accounts/vendor-invoices", headers=maker, json={
        "vendor_id": books["v_other"].id, "invoice_number": "SH/API/2", "invoice_date": "2026-07-01",
        "lines": [{"description": "Valve", "quantity": 1, "rate": 100, "gst_rate": 28}]})
    assert bad.status_code == 400 and "isn't an active rate" in bad.json()["detail"]
    tb = client.get("/api/v1/accounts/reports/trial-balance", headers=maker, params={"from_date": "2026-04-01", "to_date": "2027-03-31"})
    assert tb.status_code == 200 and tb.json()["is_balanced"]
    setup = client.get("/api/v1/accounts/setup", headers=maker).json()
    assert setup["company_gst"]["state_code"] == "27" and setup["current_financial_year"]["code"]
