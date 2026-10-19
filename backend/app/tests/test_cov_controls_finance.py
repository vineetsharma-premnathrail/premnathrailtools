"""ERP review controls for Finance (docs/erp-review/05-summary-and-roadmap.md):

  C-04  financial control       — AP 3-way match on GRN qty x PO price,
                                  approved PO, cumulative cap
  C-05  segregation of duties   — whoever records / posts a vendor invoice
                                  can't also pay it; posting and paying need
                                  a finance role

A control the code does NOT enforce yet keeps its test, marked
xfail(strict=True) with the reason "OPEN: C-0x ...".
"""
import importlib.util
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.main.models.user import User
from app.modules.organization.models.company import Company
from app.modules.accounts.models.account_group import AccountGroup
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.settings import AccountDetermination, GSTRate
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts import service
from app.modules.accounts.services import gst
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem

VERSIONS = Path(__file__).resolve().parents[2] / "alembic" / "versions"
PAY = "/api/v1/accounts/payments"
VI = "/api/v1/accounts/vendor-invoices"


def _load_migration(name):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _gstin(state, pan="AAACP1234C"):
    body = f"{state}{pan}1Z"
    return next(body + ch for ch in gst._CHARSET if gst.gstin_checksum_ok(body + ch))


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.fixture
def books(db):
    """Seeded chart of accounts, a Maharashtra company, a bank, a vendor and
    three accounts users: maker + checker (Finance Managers) and a clerk
    with only the `accounts` app."""
    seed = _load_migration("f2a3b4c5d6e7_seed_standard_chart_of_accounts")
    upg = _load_migration("a8c3e5f7b9d1_accounts_standards_upgrade")
    groups = {}
    for code, name, parent, nature, head, gp, seqn in upg.GROUPS:
        g = AccountGroup(code=code, name=name, parent_id=groups[parent].id if parent else None, nature=nature,
                         schedule_iii_head=head, affects_gross_profit=gp, sequence=seqn, is_system=True)
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
    db.add(GLAccount(code="1121", name="HDFC Current A/c", account_type="asset", group_id=groups["G-BANK"].id, is_posting_account=True))
    db.add(Company(name="Premnath Rail Tools", code="PRT", gstin=_gstin("27")))
    mk = lambda email, fm: User(email=email, name=email.split("@")[0], role="user", is_active=True,  # noqa: E731
                                assigned_apps=["accounts"], is_finance_manager=fm)
    maker, checker, clerk = mk("cov.maker@premnathrail.com", True), mk("cov.checker@premnathrail.com", True), mk("cov.clerk@premnathrail.com", False)
    db.add_all([maker, checker, clerk])
    # A Partner, so vendor payments can be sent for approval (Finance approver
    # -> Partner). No Finance app, so it never becomes a Finance approver slot.
    db.add(User(email="cov.partner@premnathrail.com", name="cov.partner", role="user", is_active=True,
                assigned_apps=[], is_partner=True))
    db.flush()
    gl = {a.code: a for a in db.query(GLAccount).all()}
    bank = BankAccount(account_kind="bank", bank_name="HDFC", account_no="5010001", gl_account_id=gl["1121"].id)
    vendor = Vendor(code="V-MH", name="Pune Steels", gstin=_gstin("27", "AABCP5678D"), state="Maharashtra", payment_days=30)
    db.add_all([bank, vendor])
    db.commit()
    # Capital in the bank so payments have funds.
    service.post_journal_entry(db, posting_date=date(2026, 4, 1), created_by_id=maker.id, lines=[
        {"gl_account_id": gl["1121"].id, "debit_amount": 1_000_000},
        {"gl_account_id": gl["3000"].id, "credit_amount": 1_000_000},
    ])
    db.commit()
    return {"db": db, "gl": gl, "maker": maker, "checker": checker, "clerk": clerk, "bank": bank, "vendor": vendor}


def _bill(b, number, amount=10000, by="maker"):
    inv = service.create_vendor_invoice(
        b["db"], vendor_id=b["vendor"].id, invoice_number=number, invoice_date=date(2026, 7, 10), created_by_id=b[by].id,
        lines=[{"description": "Hydraulic hose", "hsn_sac_code": "4009", "quantity": 10, "rate": amount / 10, "gst_rate": 18}])
    b["db"].commit()
    return inv


def _post(b, inv, by="checker"):
    service.post_vendor_invoice(b["db"], vendor_invoice_id=inv.id, created_by_id=b[by].id)
    b["db"].commit()
    b["db"].refresh(inv)


def _pay(client, b, inv, user, amount=100):
    return client.post(f"{PAY}/pay-invoice", json={
        "vendor_invoice_id": inv.id, "bank_account_id": b["bank"].id, "amount": amount,
        "payment_mode": "neft", "payment_date": "2026-08-01",
    }, headers=_h(user))


# ── C-04: 3-way match (PO price x GRN accepted qty) ─────────────────────────

def _approved_po_with_grn(db, *, ordered=10, price=100.0, accepted=4, approved=True, number="1"):
    """A legacy-chain PR whose PO cleared Purchase Head / Director / Partner,
    one priced PO line, and a completed GRN accepting `accepted` units."""
    now = datetime.now(timezone.utc)
    pr = P2PRequest(p2p_number=f"P2P-RAW-2026-C{number}", category_code="RAW", request_date=date(2026, 6, 1),
                    status="po_approved" if approved else "po_raised")
    if approved:
        pr.purchase_head_approved_at = pr.director_approved_at = pr.partner_approved_at = now
    db.add(pr)
    db.flush()
    po = P2PPurchaseOrder(po_number=f"PO-C04-{number}", p2p_request_id=pr.id, vendor_name="Pune Steels", status="issued",
                          po_date=date(2026, 6, 2), total_value=ordered * price)
    db.add(po)
    db.flush()
    line = P2PPurchaseOrderItem(purchase_order_id=po.id, item_name="Hydraulic hose", quantity=ordered, unit_price=price)
    db.add(line)
    db.flush()
    if accepted:
        grn = P2PGoodsReceipt(grn_number=f"GRN-C04-{number}", purchase_order_id=po.id, status="completed", received_date=date(2026, 7, 1))
        db.add(grn)
        db.flush()
        db.add(P2PGoodsReceiptItem(goods_receipt_id=grn.id, po_item_id=line.id, item_name="Hydraulic hose", ordered_quantity=ordered,
                                   received_quantity=accepted, accepted_quantity=accepted, quality_status="passed"))
    db.commit()
    return po


def _po_bill(b, po, number, qty, rate):
    inv = service.create_vendor_invoice(
        b["db"], purchase_order_id=po.id, invoice_number=number, invoice_date=date(2026, 7, 10), created_by_id=b["maker"].id,
        lines=[{"description": "Hydraulic hose", "hsn_sac_code": "4009", "quantity": qty, "rate": rate, "gst_rate": 18}])
    b["db"].commit()
    return inv


def test_c04_invoice_matching_grn_qty_times_po_price_is_matched(books):
    po = _approved_po_with_grn(books["db"], number="1")
    inv = _po_bill(books, po, "INV-C04-1", qty=4, rate=100)
    assert inv.matching_status == "matched"
    assert (inv.qty_po, inv.qty_gr) == (10, 4)


def test_c04_invoice_above_grn_qty_is_held_as_variance_and_cannot_post(books):
    """10 units billed, 4 accepted: within the PO value but above GRN qty x PO price."""
    po = _approved_po_with_grn(books["db"], number="2")
    inv = _po_bill(books, po, "INV-C04-2", qty=10, rate=100)
    assert inv.matching_status == "variance"
    with pytest.raises(ValueError, match="variance approval"):
        service.post_vendor_invoice(books["db"], vendor_invoice_id=inv.id, created_by_id=books["checker"].id)


def test_c04_invoice_above_po_price_is_held_as_variance(books):
    po = _approved_po_with_grn(books["db"], number="3")
    inv = _po_bill(books, po, "INV-C04-3", qty=4, rate=200)  # 800 vs 4 x 100 received
    assert inv.matching_status == "variance"
    assert inv.invoice_amount == 800.0  # 4 accepted x PO price 100 = 400 is the matched value


def test_c04_invoice_over_po_value_is_refused_outright(books):
    po = _approved_po_with_grn(books["db"], accepted=10, number="4")
    with pytest.raises(ValueError, match="above the approved PO value"):
        _po_bill(books, po, "INV-C04-4", qty=12, rate=100)
    assert books["db"].query(VendorInvoice).filter_by(invoice_number="INV-C04-4").count() == 0


def test_c04_cumulative_invoicing_is_capped_at_po_value(books):
    po = _approved_po_with_grn(books["db"], accepted=10, number="5")
    _po_bill(books, po, "INV-C04-5a", qty=10, rate=100)
    with pytest.raises(ValueError, match="above the approved PO value"):
        _po_bill(books, po, "INV-C04-5b", qty=1, rate=100)


def test_c04_invoice_line_must_reference_a_line_of_its_own_po(books):
    po = _approved_po_with_grn(books["db"], number="7")
    other = _approved_po_with_grn(books["db"], number="8")
    with pytest.raises(ValueError, match="is not on PO"):
        service.create_vendor_invoice(
            books["db"], purchase_order_id=po.id, invoice_number="INV-C04-7", invoice_date=date(2026, 7, 10),
            created_by_id=books["maker"].id,
            lines=[{"description": "Hydraulic hose", "quantity": 4, "rate": 100, "gst_rate": 18, "po_item_id": other.items[0].id}])
    books["db"].rollback()
    inv = service.create_vendor_invoice(
        books["db"], purchase_order_id=po.id, invoice_number="INV-C04-7", invoice_date=date(2026, 7, 10),
        created_by_id=books["maker"].id,
        lines=[{"description": "Hydraulic hose", "quantity": 4, "rate": 100, "gst_rate": 18, "po_item_id": po.items[0].id}])
    assert inv.lines[0].po_item_id == po.items[0].id


def test_c04_no_invoice_before_goods_are_accepted(books):
    po = _approved_po_with_grn(books["db"], accepted=0, number="6")
    with pytest.raises(ValueError, match="No goods have been accepted"):
        _po_bill(books, po, "INV-C04-6", qty=1, rate=100)


def test_c04_no_invoice_against_unapproved_po(books):
    po = _approved_po_with_grn(books["db"], approved=False, number="7")
    with pytest.raises(ValueError, match="hasn't completed"):
        _po_bill(books, po, "INV-C04-7", qty=4, rate=100)


def test_c04_variance_cannot_be_approved_by_invoice_maker(books, client):
    po = _approved_po_with_grn(books["db"], number="8")
    inv = _po_bill(books, po, "INV-C04-8", qty=10, rate=100)
    own = client.post(f"{VI}/{inv.id}/approve-variance", json={"note": "ok"}, headers=_h(books["maker"]))
    assert own.status_code == 403
    clerk = client.post(f"{VI}/{inv.id}/approve-variance", json={"note": "ok"}, headers=_h(books["clerk"]))
    assert clerk.status_code == 403  # not a Finance Manager
    ok = client.post(f"{VI}/{inv.id}/approve-variance", json={"note": "short-shipped, balance due"}, headers=_h(books["checker"]))
    assert ok.status_code == 200 and ok.json()["matching_status"] == "approved_variance"


# ── C-05: maker != checker on post and pay ──────────────────────────────────

def test_c05_invoice_maker_cannot_post_it(books, client):
    inv = _bill(books, "PS/C05-1")
    r = client.post(f"{VI}/{inv.id}/post", headers=_h(books["maker"]))
    assert r.status_code == 403
    books["db"].refresh(inv)
    assert inv.status == "pending"


def test_c05_invoice_maker_cannot_pay_it(books, client):
    inv = _bill(books, "PS/C05-2")
    _post(books, inv)
    assert _pay(client, books, inv, books["maker"]).status_code == 403
    voucher = client.post(PAY, json={
        "payment_type": "vendor", "bank_account_id": books["bank"].id, "amount": 100, "payment_mode": "neft",
        "payment_date": "2026-08-01", "vendor_id": books["vendor"].id,
        "allocations": [{"target_type": "vendor_invoice", "target_id": inv.id, "amount": 100}],
    }, headers=_h(books["maker"]))
    assert voucher.status_code == 403
    books["db"].refresh(inv)
    assert inv.amount_due == inv.invoice_total


def test_c05_independent_user_can_pay(books, client):
    """Baseline: a third Finance Manager (neither maker nor poster) can pay."""
    db = books["db"]
    payer = User(email="cov.payer@premnathrail.com", name="payer", role="user", is_active=True,
                 assigned_apps=["accounts"], is_finance_manager=True)
    db.add(payer)
    db.commit()
    inv = _bill(books, "PS/C05-3")
    _post(books, inv)
    r = _pay(client, books, inv, payer)
    assert r.status_code == 201, r.text


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-05 the user who POSTED the invoice can also pay it — "
    "app/modules/accounts/service.py:747 post_payment only checks invoice.created_by_id, not the poster "
    "(journal entry created_by/posted_by); app/modules/accounts/routes/payments.py:121-125 likewise"))
def test_c05_invoice_poster_cannot_pay_it(books, client):
    inv = _bill(books, "PS/C05-4")
    _post(books, inv, by="checker")
    r = _pay(client, books, inv, books["checker"])
    assert r.status_code == 403


# FIXED: C-05 allocate_route now refuses a payment allocation against a vendor
# invoice the same user recorded (routes/payments.py allocate_route).
def test_c05_invoice_maker_cannot_settle_it_via_advance_allocation(books, client):
    inv = _bill(books, "PS/C05-5")
    _post(books, inv)
    adv = client.post(PAY, json={
        "payment_type": "vendor", "bank_account_id": books["bank"].id, "amount": 500, "payment_mode": "neft",
        "payment_date": "2026-08-01", "vendor_id": books["vendor"].id, "allocations": [],
    }, headers=_h(books["maker"]))
    assert adv.status_code == 201, adv.text
    r = client.post(f"{PAY}/allocate", json={
        "source_type": "payment", "source_id": adv.json()["id"], "allocation_date": "2026-08-02",
        "allocations": [{"target_type": "vendor_invoice", "target_id": inv.id, "amount": 500}],
    }, headers=_h(books["maker"]))
    assert r.status_code == 403


@pytest.mark.xfail(strict=True, reason=(
    "OPEN: C-05 no role gate on posting/paying — any `accounts` app user can post a vendor invoice and pay it: "
    "app/modules/accounts/routes/vendor_invoices.py:145-150 and routes/payments.py:118,142 depend only on "
    "require_app_access('accounts'), no require_finance_manager"))
def test_c05_posting_and_paying_need_a_finance_role(books, client):
    inv = _bill(books, "PS/C05-6", by="maker")
    posted = client.post(f"{VI}/{inv.id}/post", headers=_h(books["clerk"]))
    assert posted.status_code == 403
    _post(books, inv, by="checker")
    paid = _pay(client, books, inv, books["clerk"])
    assert paid.status_code == 403
