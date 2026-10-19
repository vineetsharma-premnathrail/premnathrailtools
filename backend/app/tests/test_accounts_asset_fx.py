"""FI asset accounting + foreign currency (docs/erp-review/sap-gap-analysis.json, key "fi"):

  ABZON / F-90  asset capitalised from a posted purchase-invoice line; AIBU
                capital internal order settled into an asset; register vs
                ledger reconciliation
  ABAVN/ABAON   partial retirement by % / quantity, sale with a GST invoice
                through the asset-sale clearing ledger, gain / loss
  Sec 32        Income-tax block depreciation (half rate < 180 days) and the
                deferred-tax difference
  FX            document currency + rate on bills, invoices and vouchers,
                realised gain / loss on settlement, F.05 revaluation with
                auto-reversal
"""
from datetime import date

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.accounts import service
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.asset_accounting import ITAssetBlock, ITBlockBalance
from app.modules.accounts.models.fx import Currency
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.services import assets, asset_accounting, tax_depreciation, fx, vouchers
from app.modules.accounts.services.balances import account_balance, party_balance
from app.modules.crm.models.organization import Organization
from app.tests.test_accounts_finance import books, _capital, _jv, _load_migration  # noqa: F401 — `books` is a fixture

MIG = "cfbe9f919704_fi_asset_accounting_and_foreign_currency"


@pytest.fixture
def af(books):
    db = books["db"]
    mig = _load_migration(MIG)
    groups = {g.code: g for g in db.query(AccountGroup).all()}
    for code, name, gcode, control, _role in mig.NEW_LEDGERS:
        db.add(GLAccount(code=code, name=name, account_type=groups[gcode].nature, group_id=groups[gcode].id,
                         is_posting_account=True, is_control_account=control, status="active"))
    for code, name, rate in mig.IT_BLOCKS:
        db.add(ITAssetBlock(code=code, name=name, rate_pct=rate, is_active=True))
    db.add(Currency(code="USD", name="US Dollar", symbol="$", is_active=True))
    v_us = Vendor(code="V-US", name="Ohio Hydraulics Inc", state="Other Country", payment_days=60)
    c_us = Organization(name="Gulf Rail LLC", state="Other Country", credit_days=45)
    db.add_all([v_us, c_us])
    db.commit()
    books["gl"] = {a.code: a for a in db.query(GLAccount).all()}
    books["v_us"], books["c_us"] = v_us, c_us
    _capital(books)
    db.commit()
    return books


def _bal(b, code, on=date(2027, 3, 31)):
    return account_balance(b["db"], b["gl"][code].id, on)


def _asset_bill(b, number="PS/CAP/1", amount=500000, ledger="1010", d=date(2026, 5, 2)):
    bill = service.create_vendor_invoice(
        b["db"], vendor_id=b["v_local"].id, invoice_number=number, invoice_date=d, created_by_id=b["maker"].id,
        lines=[{"description": "Radial drilling machine", "hsn_sac_code": "8459", "quantity": 1, "rate": amount,
                "gst_rate": 18, "gl_account_id": b["gl"][ledger].id}])
    service.post_vendor_invoice(b["db"], vendor_invoice_id=bill.id, created_by_id=b["checker"].id)
    b["db"].commit()
    return bill


def _master(code="PM-101", **kw):
    return {"asset_code": code, "name": kw.pop("name", "Radial drill"), "depreciation_method": "slm",
            "useful_life_months": 120, **kw}


# ── ABZON / F-90 ────────────────────────────────────────────────────────

def test_purchase_line_on_asset_ledger_waits_and_is_capitalised_at_its_value(af):
    db = af["db"]
    bill = _asset_bill(af)
    queue = asset_accounting.capitalisation_queue(db)["invoice_lines"]
    assert len(queue) == 1 and queue[0]["remaining"] == 500000 and queue[0]["on_asset_ledger"]
    line_id = queue[0]["vendor_invoice_line_id"]
    rec = asset_accounting.reconciliation(db, as_of=date(2026, 5, 31))
    row = next(r for r in rec["rows"] if r["gl_account_id"] == af["gl"]["1010"].id)
    assert row["difference"] == 500000 and row["awaiting_capitalisation"] == 500000 and row["unexplained"] == 0

    with pytest.raises(ValueError, match="left to capitalise"):
        asset_accounting.create_asset_from_invoice_line(db, vendor_invoice_line_id=line_id, data=_master(cost=600000), user_id=af["maker"].id)
    db.rollback()
    with pytest.raises(ValueError, match="same ledger"):
        asset_accounting.create_asset_from_invoice_line(db, vendor_invoice_line_id=line_id,
                                                        data=_master(asset_gl_account_id=af["gl"]["1020"].id), user_id=af["maker"].id)
    db.rollback()
    a = asset_accounting.create_asset_from_invoice_line(db, vendor_invoice_line_id=line_id, data=_master(), user_id=af["maker"].id)
    db.commit()
    assert (a.cost, a.vendor_invoice_id, a.purchase_date, a.asset_gl_account_id) == (500000, bill.id, date(2026, 5, 2), af["gl"]["1010"].id)
    assert a.capitalisation_journal_entry_id is None  # the bill already debited the asset ledger
    assert asset_accounting.capitalisation_queue(db)["invoice_lines"] == []
    rec = asset_accounting.reconciliation(db, as_of=date(2026, 5, 31))
    assert rec["is_reconciled"]


def test_reconciliation_flags_a_ledger_posting_with_no_register_entry(af):
    db = af["db"]
    _jv(af, date(2026, 5, 5), "1020", "1121", 12000)  # furniture bought by a journal, never registered
    rec = asset_accounting.reconciliation(db, as_of=date(2026, 5, 31))
    row = next(r for r in rec["rows"] if r["gl_account_id"] == af["gl"]["1020"].id)
    assert not row["ok"] and row["unexplained"] == 12000 and not rec["is_reconciled"]


def test_capital_order_spend_is_settled_into_an_asset(af):
    db, gl = af["db"], af["gl"]
    io = InternalOrder(code="CAP-01", name="New paint shop", order_type="capital", status="in_progress")
    db.add(io)
    db.commit()
    _jv(af, date(2026, 6, 1), "1040", "1121", 80000, dr={"internal_order_id": io.id})
    _jv(af, date(2026, 6, 2), "5010", "1121", 20000, dr={"internal_order_id": io.id})
    db.commit()
    queue = asset_accounting.capitalisation_queue(db)["capital_orders"]
    assert queue[0]["spend_to_settle"] == 100000
    with pytest.raises(ValueError, match="between 0.01 and 100,000.00"):
        asset_accounting.settle_internal_order(db, internal_order_id=io.id, settlement_date=date(2026, 6, 30), amount=150000,
                                               data=_master("PS-01", asset_gl_account_id=gl["1010"].id), user_id=af["maker"].id)
    db.rollback()
    a = asset_accounting.settle_internal_order(db, internal_order_id=io.id, settlement_date=date(2026, 6, 30), amount=60000,
                                               data=_master("PS-01", asset_gl_account_id=gl["1010"].id), user_id=af["maker"].id)
    db.commit()
    assert a.cost == 60000 and a.internal_order_id == io.id and a.capitalisation_journal_entry_id
    assert _bal(af, "1010", date(2026, 6, 30)) == 60000
    # 60% of each ledger the order was charged to is credited back.
    assert _bal(af, "1040", date(2026, 6, 30)) == 32000 and _bal(af, "5010", date(2026, 6, 30)) == 8000
    assert asset_accounting.capitalisation_queue(db)["capital_orders"][0]["spend_to_settle"] == 40000


# ── ABAVN / ABAON ───────────────────────────────────────────────────────

def _register(af, code="PM-201", cost=365000, qty=1, d=date(2026, 4, 1), **kw):
    _jv(af, d, "1010", "1121", cost)
    a = assets.create_asset(af["db"], created_by_id=af["maker"].id, data={
        "asset_code": code, "name": "Rail profile grinder", "asset_gl_account_id": af["gl"]["1010"].id, "purchase_date": d,
        "put_to_use_date": d, "cost": cost, "residual_value": 0, "depreciation_method": "slm", "useful_life_months": 120,
        "quantity": qty, **kw})
    af["db"].commit()
    return a


def test_partial_sale_by_quantity_posts_gain_and_raises_gst_invoice(af):
    db, gl = af["db"], af["gl"]
    a = _register(af, qty=4)
    r = asset_accounting.retire_asset(db, asset_id=a.id, retirement_date=date(2026, 6, 29), retirement_type="sale", retire_quantity=1,
                                      sale_value=100000, customer_id=af["c_local"].id, gst_rate=18, hsn_sac_code="8460",
                                      reason="One grinder head sold to a sister workshop", user_id=af["checker"].id)
    db.commit()
    # 36,500 a year x 90 days = 9,000 catch-up; 1/4 retired.
    assert (r.catch_up_depreciation, r.retired_cost, r.retired_accumulated_depreciation) == (9000, 91250, 2250)
    assert r.gain_loss == 100000 - (91250 - 2250) == 11000
    db.refresh(a)
    assert (a.cost, a.accumulated_depreciation, a.quantity, a.status) == (273750, 6750, 3, "active")
    assert _bal(af, "4120", date(2026, 6, 30)) == -11000
    assert _bal(af, "1190", date(2026, 6, 30)) == 100000          # sale value waits on the clearing ledger
    inv = r.ar_transaction_id and db.get(service.ARTransaction, r.ar_transaction_id)
    assert inv.status == "pending" and inv.total_amount == 118000 and inv.lines[0].gl_account_id == gl["1190"].id
    service.post_customer_invoice(db, ar_transaction_id=inv.id, created_by_id=af["maker"].id)  # maker-checker: other user
    db.commit()
    assert _bal(af, "1190", date(2026, 6, 30)) == 0 and _bal(af, "2021", date(2026, 6, 30)) == -9000
    assert asset_accounting.reconciliation(db, as_of=date(2026, 6, 30))["is_reconciled"]
    # Later depreciation charges only the remaining 3/4.
    run = assets.run_depreciation(db, accounting_period="2026-07", created_by_id=af["checker"].id)
    assert run.total_amount == round(273750 / 10 * 32 / 365, 2)  # 30-Jun (after the retirement day) + July


def test_full_scrap_and_retirement_rules(af):
    db = af["db"]
    a = _register(af, code="PM-202", cost=100000)
    with pytest.raises(ValueError, match="customer"):
        asset_accounting.retire_asset(db, asset_id=a.id, retirement_date=date(2026, 5, 31), retirement_type="sale", sale_value=1,
                                      gst_rate=18, reason="x", user_id=af["checker"].id)
    db.rollback()
    with pytest.raises(ValueError, match="Scrap has no sale value"):
        asset_accounting.retire_asset(db, asset_id=a.id, retirement_date=date(2026, 5, 31), retirement_type="scrap", sale_value=10,
                                      reason="x", user_id=af["checker"].id)
    db.rollback()
    r = asset_accounting.retire_asset(db, asset_id=a.id, retirement_date=date(2026, 5, 31), retirement_type="scrap",
                                      reason="Burnt in a short circuit", user_id=af["checker"].id)
    db.commit()
    db.refresh(a)
    assert a.status == "disposed" and r.retire_percent == 100 and r.gain_loss == -(100000 - r.catch_up_depreciation)
    assert _bal(af, "1010", date(2026, 5, 31)) == 0


def test_dispose_refuses_a_control_ledger_as_proceeds(af):
    db = af["db"]
    a = _register(af, code="PM-203", cost=50000)
    with pytest.raises(ValueError, match="control ledger"):
        assets.dispose_asset(db, asset_id=a.id, disposal_date=date(2026, 5, 1), proceeds=1000,
                             proceeds_gl_account_id=af["gl"]["1130"].id, user_id=af["checker"].id)


# ── Income-tax depreciation + deferred tax ──────────────────────────────

def test_it_block_schedule_half_rate_and_sale_deduction(af):
    db = af["db"]
    block = db.query(ITAssetBlock).filter_by(code="PM-GEN").one()
    db.add(ITBlockBalance(block_id=block.id, fy_code="2026-27", opening_wdv=100000))
    db.commit()
    big = _register(af, code="PM-301", cost=200000, d=date(2026, 5, 1), it_block_id=block.id)
    _register(af, code="PM-302", cost=40000, d=date(2027, 1, 15), it_block_id=block.id)   # 76 days -> half rate
    asset_accounting.retire_asset(db, asset_id=big.id, retirement_date=date(2026, 12, 31), retirement_type="sale", retire_percent=10,
                                  sale_value=30000, customer_id=af["c_local"].id, gst_rate=18, reason="Spare unit sold",
                                  user_id=af["checker"].id)
    db.commit()
    s = tax_depreciation.it_depreciation_schedule(db, fy_code="2026-27")
    row = next(r for r in s["blocks"] if r["block_code"] == "PM-GEN")
    assert (row["opening_wdv"], row["additions_full_rate"], row["additions_half_rate"], row["deductions"]) == (100000, 200000, 40000, 30000)
    assert row["depreciation"] == 270000 * 0.15 + 40000 * 0.075 == 43500
    assert row["closing_wdv"] == 310000 - 43500
    nxt = tax_depreciation.it_depreciation_schedule(db, fy_code="2027-28")
    assert next(r for r in nxt["blocks"] if r["block_code"] == "PM-GEN")["opening_wdv"] == 266500

    dt = tax_depreciation.deferred_tax(db, fy_code="2026-27", tax_rate_pct=25.168)
    drow = next(r for r in dt["rows"] if r["block_code"] == "PM-GEN")
    assert drow["tax_wdv"] == 266500
    assert drow["difference"] == round(drow["book_wdv"] - 266500, 2)
    assert drow["deferred_tax"] == round(drow["difference"] * 0.25168, 2)


# ── foreign currency ────────────────────────────────────────────────────

def test_import_bill_paid_at_higher_rate_books_realised_loss(af):
    db = af["db"]
    fx.set_rate(db, currency="USD", rate_date=date(2026, 7, 1), rate=83)
    bill = service.create_vendor_invoice(db, vendor_id=af["v_us"].id, invoice_number="OH-77", invoice_date=date(2026, 7, 10),
                                         created_by_id=af["maker"].id, currency="USD",
                                         lines=[{"description": "Servo valve", "quantity": 4, "rate": 250, "gst_rate": 0}])
    assert (bill.currency, bill.exchange_rate, bill.amount_fc, bill.invoice_total) == ("USD", 83, 1000, 83000)
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=af["checker"].id)
    db.commit()
    p = vouchers.create_voucher(db, payment_type="vendor", bank_account_id=af["bank"].id, amount=0, payment_mode="neft",
                                payment_date=date(2026, 8, 20), vendor_id=af["v_us"].id, created_by_id=af["checker"].id,
                                currency="USD", exchange_rate=85, amount_fc=600,
                                allocations=[{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 51000}])
    db.commit()
    db.refresh(bill)
    assert p.amount == 51000 and bill.amount_due == 83000 - 49800 and bill.amount_due_fc == 400
    assert _bal(af, "5650", date(2026, 8, 31)) == 1200
    p2 = vouchers.create_voucher(db, payment_type="vendor", bank_account_id=af["bank"].id, amount=0, payment_mode="neft",
                                 payment_date=date(2026, 9, 5), vendor_id=af["v_us"].id, created_by_id=af["checker"].id,
                                 currency="USD", exchange_rate=82, amount_fc=400,
                                 allocations=[{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 32800}])
    db.commit()
    db.refresh(bill)
    assert bill.amount_due == 0 and bill.amount_due_fc == 0
    assert _bal(af, "4150", date(2026, 9, 30)) == -400        # 400 x (83 - 82) gain
    assert party_balance(db, as_of=date(2026, 9, 30), vendor_id=af["v_us"].id) == 0
    # Cancelling the second payment undoes its exchange gain too.
    vouchers.cancel_voucher(db, payment_id=p2.id, reason="wrong rate", user_id=af["checker"].id, cancel_date=date(2026, 9, 6))
    db.commit()
    db.refresh(bill)
    assert bill.amount_due == 33200 and bill.amount_due_fc == 400 and _bal(af, "4150") == 0


def test_inr_voucher_cannot_settle_a_foreign_bill(af):
    db = af["db"]
    bill = service.create_vendor_invoice(db, vendor_id=af["v_us"].id, invoice_number="OH-78", invoice_date=date(2026, 7, 10),
                                         created_by_id=af["maker"].id, currency="USD", exchange_rate=83,
                                         lines=[{"description": "Seal kit", "quantity": 1, "rate": 100, "gst_rate": 0}])
    service.post_vendor_invoice(db, vendor_invoice_id=bill.id, created_by_id=af["checker"].id)
    db.commit()
    with pytest.raises(ValueError, match="same currency"):
        vouchers.create_voucher(db, payment_type="vendor", bank_account_id=af["bank"].id, amount=8300, payment_mode="neft",
                                payment_date=date(2026, 8, 1), vendor_id=af["v_us"].id, created_by_id=af["checker"].id,
                                allocations=[{"target_type": "vendor_invoice", "target_id": bill.id, "amount": 8300}])
    db.rollback()
    with pytest.raises(ValueError, match="No bank exchange rate for USD"):
        service.create_vendor_invoice(db, vendor_id=af["v_us"].id, invoice_number="OH-79", invoice_date=date(2026, 7, 10),
                                      created_by_id=af["maker"].id, currency="USD",
                                      lines=[{"description": "Seal kit", "quantity": 1, "rate": 100, "gst_rate": 0}])


def test_export_invoice_revaluation_reverses_next_day_and_receipt_books_gain(af):
    db = af["db"]
    inv = service.create_ar_transaction(db, customer_id=af["c_us"].id, invoice_date=date(2026, 7, 15), created_by_id=af["maker"].id,
                                        currency="USD", exchange_rate=84, place_of_supply_state_code="96",
                                        lines=[{"description": "Rail drill", "hsn_sac_code": "8467", "quantity": 1, "rate": 500, "gst_rate": 0}])
    service.post_customer_invoice(db, ar_transaction_id=inv.id, created_by_id=af["checker"].id)
    db.commit()
    assert inv.total_amount == 42000 and inv.amount_fc == 500
    preview = fx.revaluation_preview(db, accounting_period="2026-07", rates={"USD": 86})
    assert preview["items"][0]["difference"] == 1000 and preview["total_gain"] == 1000
    run = fx.run_revaluation(db, accounting_period="2026-07", rates={"USD": 86}, user_id=af["checker"].id)
    db.commit()
    assert _bal(af, "4151", date(2026, 7, 31)) == -1000 and _bal(af, "4151", date(2026, 8, 1)) == 0
    with pytest.raises(ValueError, match="already posted"):
        fx.run_revaluation(db, accounting_period="2026-07", rates={"USD": 86}, user_id=af["checker"].id)
    db.rollback()
    fx.cancel_revaluation(db, revaluation_id=run.id, reason="wrong closing rate", user_id=af["checker"].id)
    db.commit()
    assert _bal(af, "4151", date(2026, 7, 31)) == 0
    vouchers.create_voucher(db, payment_type="customer", bank_account_id=af["bank"].id, amount=0, payment_mode="neft",
                            payment_date=date(2026, 8, 10), customer_id=af["c_us"].id, created_by_id=af["checker"].id,
                            currency="USD", exchange_rate=85, amount_fc=500,
                            allocations=[{"target_type": "ar_transaction", "target_id": inv.id, "amount": 42500}])
    db.commit()
    db.refresh(inv)
    assert inv.amount_due == 0 and _bal(af, "4150", date(2026, 8, 31)) == -500
    assert party_balance(db, as_of=date(2026, 8, 31), customer_id=af["c_us"].id) == 0


# ── API wiring ──────────────────────────────────────────────────────────

def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


def test_api_fx_and_asset_accounting_endpoints(client, af):
    h = _h(af["checker"])
    r = client.post("/api/v1/accounts/fx/rates", headers=h, json={"currency": "USD", "rate_date": "2026-07-01", "rate": 83.25})
    assert r.status_code == 201, r.text
    cur = client.get("/api/v1/accounts/fx/currencies", headers=h).json()
    assert cur[0]["code"] == "USD" and cur[0]["latest_rate"] == 83.25
    assert client.get("/api/v1/accounts/fx/rate", headers=h, params={"currency": "USD", "on": "2026-07-09"}).json()["rate"] == 83.25
    bad = client.get("/api/v1/accounts/fx/rate", headers=h, params={"currency": "XYZ", "on": "2026-07-09"})
    assert bad.status_code == 400 and "currency master" in bad.json()["detail"]
    assert client.get("/api/v1/accounts/asset-accounting/capitalisation-queue", headers=h).status_code == 200
    assert client.get("/api/v1/accounts/asset-accounting/reconciliation", headers=h).status_code == 200
    blocks = client.get("/api/v1/accounts/asset-accounting/it-blocks", headers=h).json()
    assert {b["code"] for b in blocks} >= {"PM-GEN", "PM-COMP"}
    s = client.get("/api/v1/accounts/asset-accounting/it-schedule", headers=h, params={"fy": "2026-27"})
    assert s.status_code == 200 and s.json()["fy_code"] == "2026-27"
    d = client.get("/api/v1/accounts/asset-accounting/deferred-tax", headers=h, params={"fy": "2026-27"})
    assert d.status_code == 200 and d.json()["tax_rate_pct"] == 25.168
