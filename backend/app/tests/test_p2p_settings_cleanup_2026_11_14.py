"""Procurement › Settings clean-up (owner, 2026-11-14): no approval-chain card,
no notification rules, and the invoice match tolerances live in Finance ›
Settings. A tolerance saved under the old Procurement setting keeps applying
until Finance saves its own value."""
from app.core.notify_rules import fire_rule
from app.modules.accounts.services.po_match import tolerances
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.notification import Notification
from app.tests.test_p2p_requests import auth_header, make_user


def test_procurement_settings_have_only_terms_and_rfq(client, db):
    admin = make_user(db, "clean.admin@premnathrail.com", role="admin")
    body = client.get("/api/v1/p2p/settings", headers=auth_header(admin)).json()
    assert {g["key"] for g in body["groups"]} == {"terms", "rfq"}
    keys = {s["key"] for s in body["specs"]}
    assert not [k for k in keys if k.startswith("notify_") or k.startswith("invoice_")]


def test_finance_settings_carry_the_invoice_match_tolerances(client, db):
    admin = make_user(db, "clean.fin@premnathrail.com", role="admin")
    body = client.get("/api/v1/accounts/settings", headers=auth_header(admin)).json()
    specs = {s["key"]: s for s in body["specs"]}
    for k in ("invoice_qty_tolerance_pct", "invoice_price_tolerance_pct", "invoice_price_tolerance_abs"):
        assert specs[k]["group"] == "invoice_match"
    assert tolerances(db) == {"qty_tol_pct": 2.0, "price_tol_pct": 1.0, "price_tol_abs": 500.0}


def test_old_procurement_tolerance_applies_until_finance_saves_one(db):
    db.add(ModuleSetting(module_key="p2p", key="invoice_qty_tolerance_pct", value=5))
    db.commit()
    assert tolerances(db)["qty_tol_pct"] == 5.0
    db.add(ModuleSetting(module_key="accounts", key="invoice_qty_tolerance_pct", value=3))
    db.commit()
    assert tolerances(db)["qty_tol_pct"] == 3.0


def test_removed_procurement_rules_send_nothing_and_do_not_fail(db):
    actor = make_user(db, "clean.actor@premnathrail.com", assigned_apps=("p2p",))
    other = make_user(db, "clean.other@premnathrail.com", assigned_apps=("p2p",))
    # An old enabled rule row left in the database is no longer read.
    db.add(ModuleSetting(module_key="p2p", key="notify_pr_create_enabled", value=True))
    db.add(ModuleSetting(module_key="p2p", key="notify_pr_create_users", value=[other.id]))
    db.add(ModuleSetting(module_key="p2p", key="notify_pr_create_channels", value=["bell"]))
    db.commit()
    fire_rule(db, None, "p2p", "pr_create", "New Purchase Requisition", "x", "p2p_request", 1, actor)
    fire_rule(db, None, "no_such_module", "pr_create", "t", "m", "p2p_request", 1, actor)
    db.commit()
    assert db.query(Notification).filter(Notification.user_id == other.id).count() == 0
