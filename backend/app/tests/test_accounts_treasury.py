"""FI treasury (docs/erp-review/sap-gap-analysis.json, key "fi"):

  FF67 / FEBAN  bank statement upload (coded bank templates), auto-match on
                UTR / cheque / amount+date, manual match, booking bank
                charges from unmatched lines, feeding the BRS
  FF7A / FF7B   13-week cash position (AR, AP, PO commitments, payment
                runs, planned items, bank balances)
  BG register   PBG / ABG / EMD issued & received, approval (Finance ->
                Partner), margin / commission / release / invoke postings,
                expiry reminders
"""
from datetime import date, timedelta

import pytest

from app.modules.accounts import service
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.bank_guarantee import BankGuarantee
from app.modules.accounts.models.bank_statement import BankStatementLine
from app.modules.accounts.models.cash_forecast_item import CashForecastItem
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.settings import AccountDetermination
from app.modules.accounts.services import bank_statements, cash_position, guarantees, vouchers
from app.modules.accounts.services.bank_statement_formats import parse_statement
from app.modules.accounts.services.balances import account_balance
from app.modules.main.models.notification import Notification
from app.modules.main.models.user import User
from app.auth.jwt_handler import create_access_token
from app.tests.test_accounts_finance import (  # noqa: F401 — `books` is a fixture
    books, _capital, _sale, _bill, _load_migration,
)

MIG = "4815a1529592_fi_treasury_bank_statements_cash_position_guarantees"
BG = "/api/v1/accounts/bank-guarantees"
APPR = "/api/v1/approvals"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def tr(books):
    db = books["db"]
    groups = {g.code: g for g in db.query(AccountGroup).all()}
    mig = _load_migration(MIG)
    for code, name, gcode, control, role in mig.NEW_LEDGERS:
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=True, is_control_account=control, status="active"))
        db.add(AccountDetermination(role=role))
    for role in mig.EXTRA_ROLES:
        db.add(AccountDetermination(role=role))
    # The payment-differences ledgers (bank charges 5510) the statement booking uses.
    for code, name, gcode, control, role in _load_migration("80d6cf71a66d_fi_payment_differences_advances_payment_runs").NEW_LEDGERS:
        if not db.query(GLAccount).filter_by(code=code).first():
            db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                             is_posting_account=True, is_control_account=control, status="active"))
    db.commit()
    books["gl"] = {a.code: a for a in db.query(GLAccount).all()}
    _capital(books)
    db.commit()
    return books


def _expense(b, amount, d, **kw):
    return vouchers.create_voucher(b["db"], payment_type="expense", bank_account_id=b["bank"].id, amount=amount,
                                   payment_mode=kw.pop("mode", "neft"), payment_date=d, created_by_id=b["checker"].id,
                                   lines=[{"gl_account_id": b["gl"]["5200"].id, "amount": amount}], **kw)


def _receipt(b, amount, d):
    return vouchers.create_voucher(b["db"], payment_type="other_receipt", bank_account_id=b["bank"].id, amount=amount,
                                   payment_mode="neft", payment_date=d, created_by_id=b["checker"].id,
                                   lines=[{"gl_account_id": b["gl"]["4100"].id, "amount": amount}])


STATEMENT_CSV = (
    "Account statement HDFC 5010001\n"
    "Period: 01-08-2026 to 31-08-2026\n"
    "\n"
    "Date,Description,Reference,Cheque No,Debit,Credit,Balance\n"
    "11/08/2026,NEFT-HDFCN52026081500123-PUNE RENT,,,\"5,000.00\",,\"9,95,000.00\"\n"
    "15/08/2026,BY TRANSFER RAILWAY,,,,7000,1002000\n"
    "16/08/2026,CHQ PAID,,456,3000,,999000\n"
    "31/08/2026,SERVICE CHARGES INCL GST,,,118,,998882\n"
    "Closing balance,,,,,,998882\n"
)


def _recon(b, balance=998882):
    r = service.create_bank_reconciliation(b["db"], bank_account_id=b["bank"].id, statement_date=date(2026, 8, 31),
                                           statement_balance=balance, created_by_id=b["checker"].id)
    b["db"].commit()
    return r


# ── FF67: statement import and matching ─────────────────────────────────

def test_statement_import_auto_match_book_and_complete(tr):
    db = tr["db"]
    e1 = _expense(tr, 5000, date(2026, 8, 10), reference_no="HDFCN52026081500123")
    e2 = _expense(tr, 3000, date(2026, 8, 12), mode="cheque", cheque_number="000456")
    r1 = _receipt(tr, 7000, date(2026, 8, 14))
    db.commit()
    recon = _recon(tr)

    stmt, warnings = bank_statements.import_statement(db, bank_reconciliation_id=recon.id, content=STATEMENT_CSV.encode(),
                                                      file_name="aug.csv", format_key="generic", uploaded_by_id=tr["checker"].id)
    assert stmt.line_count == 4 and stmt.closing_balance == 998882 and warnings == []
    stats = bank_statements.auto_match(db, bank_reconciliation_id=recon.id, user_id=tr["checker"].id)
    db.commit()
    assert (stats["utr"], stats["cheque"], stats["amount_date"]) == (1, 1, 1)
    lines = {l.amount: l for l in db.query(BankStatementLine).all()}
    assert lines[5000].match_method == "utr" and lines[3000].match_method == "cheque" and lines[7000].match_method == "amount_date"
    for p in (e1, e2, r1):
        db.refresh(p)
        assert p.reconciliation_status == "reconciled"
    assert e1.cleared_date == date(2026, 8, 11)

    # The bank charge isn't in the books: completion is refused until it is booked.
    with pytest.raises(ValueError, match="still unmatched"):
        service.complete_bank_reconciliation(db, bank_reconciliation_id=recon.id, completed_by_id=tr["checker"].id)
    db.rollback()
    v = bank_statements.book_line(db, line_id=lines[118].id, kind="bank_charges", gl_account_id=None, cost_center_id=None,
                                  narration=None, user_id=tr["checker"].id)
    db.commit()
    assert v.payment_number.startswith("PV/") and v.reconciliation_status == "reconciled"
    assert account_balance(db, tr["gl"]["5510"].id, date(2026, 8, 31)) == 118
    done = service.complete_bank_reconciliation(db, bank_reconciliation_id=recon.id, completed_by_id=tr["checker"].id)
    assert done.status == "completed"


def test_statement_rules_duplicates_dates_manual_match_unmatch(tr):
    db = tr["db"]
    e1 = _expense(tr, 5000, date(2026, 8, 10))
    e2 = _expense(tr, 3000, date(2026, 8, 12))
    db.commit()
    recon = _recon(tr, balance=992000)
    csv = "Date,Narration,Debit,Credit\n11/08/2026,PAYMENT A,8000,\n"
    bank_statements.import_statement(db, bank_reconciliation_id=recon.id, content=csv.encode(), file_name="a.csv",
                                     format_key="generic", uploaded_by_id=None)
    db.commit()
    with pytest.raises(ValueError, match="already imported"):
        bank_statements.import_statement(db, bank_reconciliation_id=recon.id, content=csv.encode(), file_name="a.csv",
                                         format_key="generic", uploaded_by_id=None)
    db.rollback()
    with pytest.raises(ValueError, match="after this reconciliation's statement date"):
        bank_statements.import_statement(db, bank_reconciliation_id=recon.id, content=b"Date,Narration,Debit,Credit\n02/09/2026,X,1,\n",
                                         file_name="b.csv", format_key="generic", uploaded_by_id=None)
    db.rollback()
    line = db.query(BankStatementLine).one()
    # One bulk bank debit of 8,000 = two vouchers; e2 is dated after the value date though.
    with pytest.raises(ValueError, match="after the line's value date"):
        bank_statements.match_line(db, line_id=line.id, payment_ids=[e1.id, e2.id], user_id=None)
    db.rollback()
    with pytest.raises(ValueError, match="add up to 5,000.00"):
        bank_statements.match_line(db, line_id=line.id, payment_ids=[e1.id], user_id=None)
    db.rollback()
    # Line moved to a later date by the bank: now both vouchers fit.
    line.value_date = date(2026, 8, 13)
    db.commit()
    bank_statements.match_line(db, line_id=line.id, payment_ids=[e1.id, e2.id], user_id=tr["checker"].id)
    db.commit()
    assert line.match_status == "matched" and len(line.matched_payments) == 2
    bank_statements.unmatch_line(db, line_id=line.id)
    db.commit()
    db.refresh(e1)
    assert line.match_status == "unmatched" and e1.reconciliation_status == "pending" and e1.cleared_date is None


def test_bank_templates_preamble_drcr_and_bad_rows():
    hdfc = ("HDFC BANK Ltd.\nStatement of account\n"
            "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n"
            "05/08/26,NEFT CR-SBIN0001-CENTRAL RAILWAY,SBIN426217000123,05/08/26,,250000.00,1250000.00\n")
    [l] = parse_statement(hdfc.encode(), "hdfc.csv", "hdfc")
    assert (l.value_date, l.credit, l.reference) == (date(2026, 8, 5), 250000, "SBIN426217000123")
    drcr = "Txn Date,Particulars,Amount,Dr/Cr\n01-08-2026,ATM,500,DR\n02-08-2026,INTEREST,12.5,CR\n"
    a, b = parse_statement(drcr.encode(), "x.csv", "generic")
    assert (a.debit, a.credit, b.debit, b.credit) == (500, 0, 0, 12.5)
    with pytest.raises(ValueError, match="isn't a date"):
        parse_statement(b"Date,Narration,Debit,Credit\n99/99/2026,X,1,\n", "x.csv", "generic")
    with pytest.raises(ValueError, match="No header row"):
        parse_statement(b"foo,bar\n1,2\n", "x.csv", "sbi")


# ── FF7A / FF7B: cash position ──────────────────────────────────────────

def test_cash_position_weekly_buckets(tr):
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    db = tr["db"]
    _sale(tr, tr["c_local"], 100000)                    # 118,000 due 14-Aug (30 days)
    bill = _bill(tr, tr["v_local"], "PS/9", 10000)      # 11,800 due 09-Aug
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=tr["checker"].id)
    po = P2PPurchaseOrder(po_number="PO-1", po_date=date(2026, 7, 1), status="issued", vendor_id=tr["v_local"].id,
                          vendor_name="Pune Steels", expected_delivery=date(2026, 7, 25))
    po.items = [P2PPurchaseOrderItem(item_name="Steel", quantity=10, unit_price=1000, tax_rate=18)]
    db.add(po)
    db.add(CashForecastItem(direction="outflow", category="salaries", description="Salaries", amount=50000,
                            expected_date=date(2026, 7, 31), recurrence="monthly", is_active=True))
    db.commit()

    cp = cash_position.get_cash_position(db, weeks=13, as_of=date(2026, 7, 20))
    assert cp["opening_balance"] == 1_000_000 and len(cp["weeks"]) == 13
    assert cp["weeks"][0]["start"] == date(2026, 7, 20)
    rows = {r["category"]: r for r in cp["rows"]}
    assert rows["ar_open"]["weeks"][3] == 118000            # 14-Aug -> week 4
    assert rows["ap_open"]["weeks"][2] == 11800             # 09-Aug -> week 3
    assert rows["po_commitments"]["weeks"][5] == 11800      # 25-Jul + 30 payment days = 24-Aug -> week 6
    assert rows["planned_out"]["weeks"][1] == 50000 and rows["planned_out"]["total"] == 150000  # Jul, Aug, Sep
    last = cp["columns"][-1]["closing_balance"]
    assert last == 1_000_000 + 118000 - 11800 - 11800 - 150000


# ── Bank guarantee register ──────────────────────────────────────────────

@pytest.fixture
def partner(tr):
    u = User(email="partner@premnathrail.com", name="Partner", role="user", is_active=True, assigned_apps=["accounts"], is_partner=True)
    tr["db"].add(u)
    tr["db"].commit()
    return u


def _decide(client, user, entity_id):
    st = client.get(f"{APPR}/entity/{guarantees.ET_GUARANTEE}/{entity_id}", headers=_h(user)).json()
    return client.post(f"{APPR}/requests/{st['current']['id']}/decide", headers=_h(user), json={"decision": "approve"})


def test_pbg_lifecycle_approval_margin_extend_release(tr, partner, client, monkeypatch):
    db, gl = tr["db"], tr["gl"]
    r = client.post(BG, headers=_h(tr["checker"]), json={
        "direction": "issued", "instrument_type": "pbg", "bank_account_id": tr["bank"].id, "customer_id": tr["c_local"].id,
        "counterparty_name": "PCMM, Central Railway", "amount": 500000, "margin_percent": 10,
        "expiry_date": "2027-03-31", "claim_expiry_date": "2027-06-30", "purpose": "PBG 5% of LOA"})
    assert r.status_code == 201, r.text
    bg = r.json()
    assert bg["status"] == "draft" and bg["margin_amount"] == 50000 and bg["bg_number"].startswith("BG/")
    # Not approved yet: can't be marked issued.
    assert client.post(f"{BG}/{bg['id']}/issue", headers=_h(tr["checker"]),
                       json={"instrument_number": "X", "issue_date": "2026-08-01"}).status_code == 400
    assert client.post(f"{BG}/{bg['id']}/submit", headers=_h(tr["checker"])).json()["status"] == "submitted"
    assert _decide(client, tr["checker"], bg["id"]).status_code == 403          # maker can't approve
    assert _decide(client, tr["maker"], bg["id"]).status_code == 200
    assert _decide(client, partner, bg["id"]).status_code == 200
    assert client.get(f"{BG}/{bg['id']}", headers=_h(tr["checker"])).json()["status"] == "approved"

    ok = client.post(f"{BG}/{bg['id']}/issue", headers=_h(tr["checker"]),
                     json={"instrument_number": "0123BG26000045", "issue_date": "2026-08-01"})
    assert ok.json()["status"] == "active"
    assert client.post(f"{BG}/{bg['id']}/margin", headers=_h(tr["checker"]), json={"posting_date": "2026-08-01"}).status_code == 200
    assert client.post(f"{BG}/{bg['id']}/commission", headers=_h(tr["checker"]),
                       json={"posting_date": "2026-08-01", "amount": 2950}).status_code == 200
    assert account_balance(db, gl["1185"].id, date(2026, 8, 31)) == 50000
    assert account_balance(db, gl["5515"].id, date(2026, 8, 31)) == 2950
    assert account_balance(db, gl["1121"].id, date(2026, 8, 31)) == 1_000_000 - 52950

    bad = client.post(f"{BG}/{bg['id']}/extend", headers=_h(tr["checker"]),
                      json={"new_expiry_date": "2027-01-31", "amendment_date": "2026-12-01", "reason": "x"})
    assert bad.status_code == 400 and "must be after" in bad.json()["detail"]
    ext = client.post(f"{BG}/{bg['id']}/extend", headers=_h(tr["checker"]),
                      json={"new_expiry_date": "2027-09-30", "amendment_date": "2027-03-01", "reason": "DP extended by RDSO letter 12"}).json()
    assert ext["expiry_date"] == "2027-09-30" and ext["claim_expiry_date"] == "2027-12-30"  # claim period kept (91 days)

    rel = client.post(f"{BG}/{bg['id']}/release", headers=_h(tr["checker"]),
                      json={"release_date": "2027-12-31", "reason": "Original BG returned by Central Railway"}).json()
    assert rel["status"] == "released" and rel["margin_status"] == "released"
    assert account_balance(db, gl["1185"].id, date(2027, 12, 31)) == 0
    kinds = [e["event_type"] for e in rel["events"]]
    assert kinds[:4] == ["created", "submitted", "approved", "issued"] and "margin_released" in kinds


def test_invoked_emd_deposit_and_received_abg(tr, client):
    db, gl = tr["db"], tr["gl"]
    emd = guarantees.create(db, {"direction": "issued", "instrument_type": "emd", "instrument_form": "deposit",
                                 "bank_account_id": tr["bank"].id, "counterparty_name": "Northern Railway tender 45",
                                 "amount": 20000}, tr["checker"])
    emd.status = "active"  # approved & issued
    guarantees.place_margin(db, emd, posting_date=date(2026, 8, 1), payment_mode="neft", reference_no=None, user=tr["checker"])
    db.commit()
    assert emd.margin_amount == 20000 and account_balance(db, gl["1186"].id, date(2026, 8, 31)) == 20000
    # EMD forfeited for 15,000: taken from the deposit, the remaining 5,000 comes back.
    guarantees.invoke(db, emd, invoke_date=date(2026, 9, 1), amount=15000, reason="Bidder withdrew offer", gl_account_id=None,
                      payment_mode="neft", reference_no=None, user=tr["checker"])
    db.commit()
    assert emd.status == "invoked" and emd.margin_status == "consumed"
    assert account_balance(db, gl["1186"].id, date(2026, 9, 30)) == 0
    assert account_balance(db, gl["5660"].id, date(2026, 9, 30)) == 15000

    with pytest.raises(ValueError, match="issuing bank|issued the instrument"):
        guarantees.create(db, {"direction": "received", "instrument_type": "abg", "vendor_id": tr["v_local"].id,
                               "amount": 100000, "expiry_date": date(2027, 1, 31)}, tr["checker"])
    db.rollback()
    abg = guarantees.create(db, {"direction": "received", "instrument_type": "abg", "vendor_id": tr["v_local"].id,
                                 "issuing_bank_name": "Bank of Baroda", "amount": 100000, "expiry_date": date(2027, 1, 31)},
                            tr["checker"])
    assert abg.status == "active" and abg.margin_amount == 0
    with pytest.raises(ValueError, match="Pick our bank account"):
        guarantees.invoke(db, abg, invoke_date=date(2026, 9, 2), amount=100000, reason="Supplier failed to deliver",
                          gl_account_id=None, payment_mode="neft", reference_no=None, user=tr["checker"])


def test_expiry_reminders_bell_and_teams(tr, monkeypatch):
    from app.tasks import bank_guarantee_reminders as task
    from app.utils import notifications
    sent = []
    monkeypatch.setattr(notifications, "_notify_teams", lambda user, title, message: sent.append(user.id))
    db = tr["db"]
    exp = date(2026, 12, 31)
    bg = guarantees.create(db, {"direction": "received", "instrument_type": "pbg", "vendor_id": tr["v_local"].id,
                                "issuing_bank_name": "SBI", "amount": 50000, "expiry_date": exp}, tr["maker"])
    db.commit()
    assert task.run_bank_guarantee_reminders(db, today=exp - timedelta(days=20))["sent"] == 0
    stats = task.run_bank_guarantee_reminders(db, today=exp - timedelta(days=15))
    assert stats["sent"] >= 1 and sent
    n = db.query(Notification).filter_by(entity_type=guarantees.ET_GUARANTEE, entity_id=bg.id).first()
    assert "15 days left" in n.message
    # Same day again: deduplicated.
    assert task.run_bank_guarantee_reminders(db, today=exp - timedelta(days=15))["sent"] == 0
    assert db.query(BankGuarantee).count() == 1 and db.query(PaymentTransaction).count() == 0
