"""Finance AR/AP SAP gaps (docs/erp-review/sap-gap-analysis.json, key "fi"):

  F-28/F-32  receipt / payment with payment differences (LD, penalty, bank
             charges, short payment...) and JV clearing of open items
  F-29/F-48  customer / supplier down payments on their own advance ledgers,
             cleared against the later invoice (F-39 / F-54)
  F110       vendor payments held for approval (Finance approver -> Partner)
             and payment runs (proposal -> approval -> execution -> bank file)
"""
from datetime import date

import pytest

from app.modules.accounts import access, reports
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.payment_transaction import PaymentTransaction, PaymentAllocation
from app.modules.accounts.models.settlement_adjustment import SettlementAdjustment
from app.modules.accounts.services import vouchers, outstanding, payment_runs
from app.modules.accounts.services.balances import account_balance, party_balance
from app.modules.main.models.user import User
from app.tests.test_accounts_finance import (  # noqa: F401 — `books` is a fixture
    books, _capital, _sale, _bill, _load_migration,
)
from app.auth.jwt_handler import create_access_token
from app.modules.accounts import service

MIG = "80d6cf71a66d_fi_payment_differences_advances_payment_runs"
PAY = "/api/v1/accounts/payments"
APPR = "/api/v1/approvals"


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def fi(books):
    """books + the ledgers this migration seeds (advance and deduction ledgers)."""
    db = books["db"]
    groups = {g.code: g for g in db.query(AccountGroup).all()}
    for code, name, gcode, control, _role in _load_migration(MIG).NEW_LEDGERS:
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=True, is_control_account=control, status="active"))
    db.commit()
    books["gl"] = {a.code: a for a in db.query(GLAccount).all()}
    _capital(books)
    db.commit()
    return books


def _receipt(b, customer, amount, **kw):
    return vouchers.create_voucher(b["db"], payment_type="customer", bank_account_id=b["bank"].id, amount=amount,
                                   payment_mode="neft", payment_date=kw.pop("d", date(2026, 8, 1)), customer_id=customer.id,
                                   created_by_id=b["checker"].id, **kw)


def _posted_bill(b, number="PS/1", amount=10000):
    bill = _bill(b, b["v_local"], number, amount)
    service.post_vendor_invoice(b["db"], vendor_invoice_id=bill.id, created_by_id=b["checker"].id)
    b["db"].commit()
    return bill


def _bal(b, code, on=date(2026, 9, 30)):
    return account_balance(b["db"], b["gl"][code].id, on)


# ── F-28: receipt with LD deduction ─────────────────────────────────────

def test_receipt_with_ld_deduction_settles_invoice_in_full(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 100000)  # 118,000 incl. GST
    r = _receipt(fi, cust, 112000,
                 allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 112000}],
                 deductions=[{"target_id": inv.id, "reason": "ld_deduction", "amount": 5900},
                             {"target_id": inv.id, "reason": "bank_charges", "amount": 100}])
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 0 and inv.collection_status == "collected"
    assert r.payment_number.startswith("RV/") and r.unallocated_amount == 0
    assert _bal(fi, "5620") == 5900 and _bal(fi, "5510") == 100
    assert _bal(fi, "1121") == 1_000_000 + 112000
    # Open items agree with the party balance: nothing open, balance zero.
    assert party_balance(db, as_of=date(2026, 9, 30), customer_id=cust.id) == 0
    assert outstanding.open_documents(db, party_type="customer", party_id=cust.id) == []
    kinds = {a.source_type for a in db.query(PaymentAllocation).filter_by(target_id=inv.id).all()}
    assert kinds == {"payment", "adjustment"}


def test_deduction_rules(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000)  # 11,800
    db.commit()
    with pytest.raises(ValueError, match="credit"):
        _receipt(fi, cust, 1000, deductions=[{"target_id": inv.id, "reason": "rate_difference", "amount": 100}])
    db.rollback()
    with pytest.raises(ValueError, match="cash settled plus deductions"):
        _receipt(fi, cust, 11000, allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 11000}],
                 deductions=[{"target_id": inv.id, "reason": "short_payment", "amount": 900}])
    db.rollback()
    with pytest.raises(ValueError, match="pick the ledger"):
        _receipt(fi, cust, 1000, deductions=[{"target_id": inv.id, "reason": "other", "amount": 10}])
    db.rollback()
    with pytest.raises(ValueError, match="belongs to a bill"):
        _receipt(fi, cust, 1000, deductions=[{"target_id": None, "reason": "penalty", "amount": 10}])


def test_cancelling_receipt_releases_deductions(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000)
    r = _receipt(fi, cust, 11000, allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 11000}],
                 deductions=[{"target_id": inv.id, "reason": "penalty", "amount": 800}])
    db.commit()
    vouchers.cancel_voucher(db, payment_id=r.id, reason="cheque bounced", user_id=fi["checker"].id, cancel_date=date(2026, 8, 2))
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 11800
    assert {d.status for d in db.query(SettlementAdjustment).all()} == {"cancelled"}
    assert _bal(fi, "5621") == 0


def test_vendor_payment_with_ld_recovered(fi):
    db = fi["db"]
    bill = _posted_bill(fi, amount=10000)  # 11,800
    vouchers.create_voucher(db, payment_type="vendor", bank_account_id=fi["bank"].id, amount=11300, payment_mode="neft",
                            payment_date=date(2026, 8, 1), vendor_id=fi["v_local"].id, created_by_id=fi["checker"].id,
                            allocations=[{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 11300}],
                            deductions=[{"target_id": bill.id, "reason": "ld_deduction", "amount": 500}])
    db.commit()
    db.refresh(bill)
    assert bill.amount_due == 0
    assert _bal(fi, "4130") == -500  # income (credit)


def test_standalone_write_off_of_residual(fi):
    db, cust = fi["db"], fi["c_local"]
    inv = _sale(fi, cust, 10000)
    _receipt(fi, cust, 11799.5, allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 11799.5}])
    adj = vouchers.write_off(db, target_type="ar_transaction", target_id=inv.id, amount=0.5, reason="rounding",
                             write_off_date=date(2026, 8, 2), created_by_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 0 and adj.journal_entry_id
    vouchers.cancel_write_off(db, adjustment_id=adj.id, reason="posted in error", user_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 0.5


# ── JV clears open items ─────────────────────────────────────────────────

def test_manual_jv_against_customer_clears_invoice(fi):
    db, cust, gl = fi["db"], fi["c_local"], fi["gl"]
    inv = _sale(fi, cust, 10000)
    je = service.post_journal_entry(db, posting_date=date(2026, 8, 5), created_by_id=fi["maker"].id, lines=[
        {"gl_account_id": gl["5600"].id, "debit_amount": 1800},
        {"gl_account_id": gl["1130"].id, "credit_amount": 1800, "customer_id": cust.id},
    ])
    db.commit()
    credits = outstanding.open_credits(db, party_type="customer", party_id=cust.id)
    jc = [c for c in credits if c["source_type"] == "journal"]
    assert len(jc) == 1 and jc[0]["available"] == 1800
    vouchers.allocate(db, source_type="journal", source_id=jc[0]["id"], target_type="ar_transaction", target_id=inv.id,
                      amount=1800, allocation_date=date(2026, 8, 5), created_by_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 10000
    # Open items == party balance.
    assert party_balance(db, as_of=date(2026, 9, 30), customer_id=cust.id) == 10000
    assert outstanding.open_credits(db, party_type="customer", party_id=cust.id) == []
    with pytest.raises(ValueError, match="allocated against open bills"):
        service.reverse_journal_entry(db, journal_entry_id=je.id, reason="oops", reversed_by_id=fi["checker"].id,
                                      reversal_date=date(2026, 8, 6))


# ── Down payments ────────────────────────────────────────────────────────

def test_customer_advance_held_on_advance_ledger_and_cleared(fi):
    db, cust = fi["db"], fi["c_local"]
    with pytest.raises(ValueError, match="on account"):
        _receipt(fi, cust, 50000, is_advance=True)
    db.rollback()
    adv = _receipt(fi, cust, 50000, is_advance=True, advance_reason="Advance against LOA 12/2026", d=date(2026, 7, 1))
    db.commit()
    assert _bal(fi, "2080") == -50000 and _bal(fi, "1130") == 0
    bs = reports.get_balance_sheet(db, as_of=date(2026, 7, 31))
    heads = {h["head"]: h for s in bs["sections"] for sub in s["subsections"] for h in sub["heads"]}
    assert any(l["code"] == "2080" and l["amount"] == 50000 for l in heads["other_current_liabilities"]["ledgers"])
    assert bs["is_balanced"]

    inv = _sale(fi, cust, 100000)  # 118,000
    credits = outstanding.open_credits(db, party_type="customer", party_id=cust.id)
    assert credits[0]["source_type"] == "advance" and credits[0]["available"] == 50000
    alloc = vouchers.allocate(db, source_type="advance", source_id=adv.id, target_type="ar_transaction", target_id=inv.id,
                              amount=50000, allocation_date=date(2026, 7, 20), created_by_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 68000 and alloc.journal_entry_id
    assert _bal(fi, "2080") == 0 and _bal(fi, "1130") == 68000
    assert party_balance(db, as_of=date(2026, 9, 30), customer_id=cust.id) == 68000
    assert outstanding.open_advances(db, party_type="customer") == []
    # Removing the adjustment reverses its clearing JV.
    vouchers.remove_allocation(db, allocation_id=alloc.id, user_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 118000 and _bal(fi, "2080", date.today()) == -50000
    assert db.get(JournalEntry, alloc.journal_entry_id).status == "reversed"


def test_supplier_advance_and_no_allocation_on_advance(fi):
    db = fi["db"]
    with pytest.raises(ValueError, match="doesn't settle bills"):
        vouchers.create_voucher(db, payment_type="vendor", bank_account_id=fi["bank"].id, amount=100, payment_mode="neft",
                                payment_date=date(2026, 8, 1), vendor_id=fi["v_local"].id, created_by_id=fi["checker"].id,
                                is_advance=True, advance_reason="x",
                                allocations=[{"target_type": "vendor_invoice", "target_id": 1, "amount": 1}])
    db.rollback()
    adv = vouchers.create_voucher(db, payment_type="vendor", bank_account_id=fi["bank"].id, amount=5000, payment_mode="neft",
                                  payment_date=date(2026, 7, 1), vendor_id=fi["v_local"].id, created_by_id=fi["checker"].id,
                                  is_advance=True, advance_reason="Mobilisation advance")
    db.commit()
    assert _bal(fi, "1170") == 5000
    bill = _posted_bill(fi, amount=10000)
    vouchers.allocate(db, source_type="payment", source_id=adv.id, target_type="vendor_invoice", target_id=bill.id,
                      amount=5000, allocation_date=date(2026, 7, 15), created_by_id=fi["checker"].id)
    db.commit()
    db.refresh(bill)
    assert bill.amount_due == 6800 and _bal(fi, "1170") == 0


# ── Payment approval + payment runs (routes) ─────────────────────────────

@pytest.fixture
def partner(fi):
    u = User(email="partner@premnathrail.com", name="Partner", role="user", is_active=True, assigned_apps=["accounts"],
             is_partner=True)
    fi["db"].add(u)
    fi["db"].commit()
    return u


def _decide(client, user, entity_type, entity_id, decision="approve", comment=None):
    st = client.get(f"{APPR}/entity/{entity_type}/{entity_id}", headers=_h(user)).json()
    return client.post(f"{APPR}/requests/{st['current']['id']}/decide", headers=_h(user),
                       json={"decision": decision, "comment": comment})


def test_vendor_payment_waits_for_finance_and_partner_approval(fi, partner, client):
    db = fi["db"]
    bill = _bill(fi, fi["v_local"], "PS/APP", 10000)  # recorded by maker
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=fi["checker"].id)
    db.commit()
    r = client.post(PAY, headers=_h(fi["checker"]), json={
        "payment_type": "vendor", "bank_account_id": fi["bank"].id, "amount": 11800, "payment_mode": "neft",
        "payment_date": "2026-08-01", "vendor_id": fi["v_local"].id,
        "allocations": [{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 11800}]})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "pending_approval" and p["journal_entry_id"] is None and p["approval_status"] == "pending"
    db.refresh(bill)
    assert bill.amount_due == 11800  # nothing settled yet
    # The recorder can't approve their own payment.
    assert _decide(client, fi["checker"], access.ET_PAYMENT, p["id"]).status_code == 403
    assert _decide(client, fi["maker"], access.ET_PAYMENT, p["id"]).status_code == 200
    mid = client.get(f"{PAY}/{p['id']}", headers=_h(fi["checker"])).json()
    assert mid["status"] == "pending_approval" and "Partner" in (mid["approval_stage"] or "")
    assert _decide(client, partner, access.ET_PAYMENT, p["id"]).status_code == 200
    out = client.get(f"{PAY}/{p['id']}", headers=_h(fi["checker"])).json()
    assert out["status"] == "posted" and out["payment_number"].startswith("PV/")
    db.expire_all()
    assert db.get(type(bill), bill.id).amount_due == 0


def test_rejected_payment_posts_nothing(fi, partner, client):
    db = fi["db"]
    r = client.post(PAY, headers=_h(fi["checker"]), json={
        "payment_type": "vendor", "bank_account_id": fi["bank"].id, "amount": 500, "payment_mode": "neft",
        "payment_date": "2026-08-01", "vendor_id": fi["v_local"].id})
    pid = r.json()["id"]
    assert _decide(client, fi["maker"], access.ET_PAYMENT, pid, "reject", "duplicate of PV raised by Purchase").status_code == 200
    p = db.get(PaymentTransaction, pid)
    db.refresh(p)
    assert p.status == "rejected" and p.journal_entry_id is None


def test_receipt_writeoff_over_limit_needs_approval(fi, partner, client):
    cust = fi["c_local"]
    inv = _sale(fi, cust, 100000)
    fi["db"].commit()
    body = {"payment_type": "customer", "bank_account_id": fi["bank"].id, "amount": 110000, "payment_mode": "neft",
            "payment_date": "2026-08-01", "customer_id": cust.id,
            "allocations": [{"target_type": "ar_transaction", "target_id": inv.id, "amount": 110000}],
            "deductions": [{"target_id": inv.id, "reason": "ld_deduction", "amount": 8000}]}
    r = client.post(PAY, headers=_h(fi["checker"]), json=body)
    assert r.status_code == 201 and r.json()["status"] == "pending_approval", r.text
    # A small bank charge alone posts at once.
    inv2 = _sale(fi, cust, 1000)
    fi["db"].commit()
    r2 = client.post(PAY, headers=_h(fi["checker"]), json={**body, "amount": 1150,
                     "allocations": [{"target_type": "ar_transaction", "target_id": inv2.id, "amount": 1150}],
                     "deductions": [{"target_id": inv2.id, "reason": "bank_charges", "amount": 30}]})
    assert r2.status_code == 201 and r2.json()["status"] == "posted", r2.text


def test_payment_run_proposal_approval_execution_and_bank_file(fi, partner, client):
    db = fi["db"]
    v = fi["v_local"]
    v.bank_account_no, v.ifsc_code = "123456789", "HDFC0000123"
    db.commit()
    b1 = _bill(fi, v, "PS/R1", 10000)
    b2 = _bill(fi, v, "PS/R2", 5000)
    for b in (b1, b2):
        service.post_vendor_invoice(db, vendor_invoice_id=b.id, created_by_id=fi["checker"].id)
    db.commit()
    b2.payment_block, b2.payment_block_reason = True, "short supply"
    db.commit()
    r = client.post("/api/v1/accounts/payment-proposals", headers=_h(fi["checker"]), json={
        "pay_by_date": "2026-12-31", "bank_account_id": fi["bank"].id, "payment_mode": "neft"})
    assert r.status_code == 201, r.text
    pp = r.json()
    lines = {l["invoice_number"]: l for l in pp["lines"]}
    assert lines["PS/R2"]["excluded"] and "short supply" in lines["PS/R2"]["exclusion_reason"]
    assert pp["total_amount"] == 11800
    # A second run can't propose the same bill again.
    r_again = client.post("/api/v1/accounts/payment-proposals", headers=_h(fi["checker"]), json={
        "pay_by_date": "2026-12-31", "bank_account_id": fi["bank"].id, "payment_mode": "neft", "vendor_ids": [v.id]})
    assert all(l["invoice_number"] != "PS/R1" or l["excluded"] for l in r_again.json().get("lines", [])) or r_again.status_code == 400
    s = client.post(f"/api/v1/accounts/payment-proposals/{pp['id']}/submit", headers=_h(fi["checker"]))
    assert s.status_code == 200 and s.json()["status"] == "submitted", s.text
    assert client.post(f"/api/v1/accounts/payment-proposals/{pp['id']}/execute", headers=_h(fi["checker"]), json={}).status_code == 400
    assert _decide(client, fi["maker"], access.ET_PAYMENT_RUN, pp["id"]).status_code == 200
    assert _decide(client, partner, access.ET_PAYMENT_RUN, pp["id"]).status_code == 200
    # The maker of PS/R1 can't execute (pay) it; the checker can.
    assert client.post(f"/api/v1/accounts/payment-proposals/{pp['id']}/execute", headers=_h(fi["maker"]),
                       json={"payment_date": "2026-08-10"}).status_code == 403
    ex = client.post(f"/api/v1/accounts/payment-proposals/{pp['id']}/execute", headers=_h(fi["checker"]),
                     json={"payment_date": "2026-08-10"})
    assert ex.status_code == 200 and ex.json()["status"] == "executed", ex.text
    db.expire_all()
    assert db.get(type(b1), b1.id).amount_due == 0 and db.get(type(b2), b2.id).amount_due == 5900
    f = client.get(f"/api/v1/accounts/payment-proposals/{pp['id']}/bank-file", headers=_h(fi["checker"]))
    assert f.status_code == 200 and "HDFC0000123" in f.text and "11800.00" in f.text


def test_payment_block_endpoint_requires_reason(fi, client):
    bill = _posted_bill(fi)
    url = f"/api/v1/accounts/vendor-invoices/{bill.id}/payment-block"
    assert client.patch(url, headers=_h(fi["checker"]), json={"payment_block": True}).status_code == 400
    ok = client.patch(url, headers=_h(fi["checker"]), json={"payment_block": True, "reason": "NCR open"})
    assert ok.status_code == 200 and ok.json()["payment_block"] is True
    with pytest.raises(ValueError, match="blocked for payment"):
        vouchers.create_voucher(fi["db"], payment_type="vendor", bank_account_id=fi["bank"].id, amount=100, payment_mode="neft",
                                payment_date=date(2026, 8, 1), vendor_id=fi["v_local"].id, created_by_id=fi["checker"].id,
                                allocations=[{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 100}])


# ── SO advance milestone recovered against the later invoice (SD hook) ──

def test_so_advance_is_recovered_on_milestone_invoice(fi):
    from app.tests.test_sales_delivery_billing import make_so, _b, D0, TODAY
    from app.modules.sales import delivery as dlv
    from app.modules.accounts.services import billing
    db, cust = fi["db"], fi["c_local"]
    so = make_so(db, cust, plan=(("advance", 20), ("delivery", 80)))
    _b(so, "delivery").recovers_advance_percent = 20
    db.commit()
    adv = _receipt(fi, cust, 472000, is_advance=True, sales_order_id=so.id, d=D0)
    db.commit()
    assert adv.sales_order_id == so.id and _bal(fi, "2080", TODAY) == -472000
    r1 = so.schedules[0]
    dlv.mark_delivered(db, so, r1, on=D0, reference="RN-1", user=fi["maker"])
    db.commit()
    inv = billing.create_invoice_from_so(db, so_id=so.id, billing_plan_line_id=_b(so, "delivery").id, invoice_date=TODAY,
                                         created_by_id=fi["maker"].id)
    service.post_customer_invoice(db, ar_transaction_id=inv.id, created_by_id=fi["checker"].id)
    db.commit()
    db.refresh(inv)
    db.refresh(adv)
    recovered = round(inv.total_amount * 0.20, 2)
    assert adv.unallocated_amount == round(472000 - recovered, 2)
    assert inv.amount_due == round(inv.total_amount - recovered, 2)
    assert _bal(fi, "2080", TODAY) == -round(472000 - recovered, 2)
    # Customer pays the rest -> the invoice is settled and Sales sees it.
    _receipt(fi, cust, inv.amount_due, d=TODAY,
             allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": inv.amount_due}])
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 0
