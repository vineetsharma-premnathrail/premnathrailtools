"""Finance: the role-matrix tick alone decides (owner, 2026-11-14 — "role ke
permission di hai fir bhi show nahi hota"). The per-user "Finance Manager"
flag is no longer an extra gate on any Finance button / route that has a
matrix grant; it may only be named as an approver in a workflow.

Users here are built the real way (no `assigned_apps`): their access is
exactly their extra grants (granular_permissions), deny by default."""
from datetime import date

import pytest

from app.modules.main.models.user import User
from app.modules.accounts import access
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.models.settings import AccountDetermination, GSTRate
from app.modules.organization.services import approval_engine as engine
from app.tests.test_accounts_finance import books, _jv, _capital, _headers  # noqa: F401  (books is a fixture)

GST = "/api/v1/accounts/gst-rates"
LEDGER_SETTINGS = "/api/v1/accounts/ledger-settings"


def _user(db, email: str, grants: list[str], *, fm: bool = False, role: str = "user") -> User:
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True, assigned_apps=[],
             granular_permissions=grants, is_finance_manager=fm)
    db.add(u)
    db.commit()
    return u


# ── GST rates (F1) ───────────────────────────────────────────────────────

def test_gst_rate_create_and_edit_need_only_the_grant(client, books):
    db = books["db"]
    u = _user(db, "gst.maker@premnathrail.com", ["accounts:gst_rates:view", "accounts:gst_rates:create", "accounts:gst_rates:edit"])
    r = client.post(GST, json={"rate": 7.5, "description": "Rough diamonds"}, headers=_headers(u))
    assert r.status_code == 201, r.text
    r = client.patch(f"{GST}/{r.json()['id']}", json={"description": "Rough & cut diamonds"}, headers=_headers(u))
    assert r.status_code == 200, r.text
    assert db.query(GSTRate).filter(GSTRate.rate == 7.5).one().description == "Rough & cut diamonds"


def test_gst_rate_without_the_grant_is_refused_with_a_clear_reason(client, books):
    db = books["db"]
    u = _user(db, "gst.viewer@premnathrail.com", ["accounts:gst_rates:view"])
    r = client.post(GST, json={"rate": 7.5}, headers=_headers(u))
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert "GST Rates" in detail and "Create" in detail


def test_finance_manager_flag_alone_no_longer_passes(client, books):
    db = books["db"]
    fm = _user(db, "flag.only@premnathrail.com", ["accounts:gst_rates:view", "accounts:ledger_settings:view"], fm=True)
    assert client.post(GST, json={"rate": 7.5}, headers=_headers(fm)).status_code == 403
    r = client.put(LEDGER_SETTINGS, json={"role": "ap_control", "gl_account_id": books["gl"]["2010"].id}, headers=_headers(fm))
    assert r.status_code == 403


def test_admin_still_maintains_gst_rates(client, books):
    admin = _user(books["db"], "fin.admin@premnathrail.com", [], role="admin")
    assert client.post(GST, json={"rate": 7.5}, headers=_headers(admin)).status_code == 201


# ── Ledger settings (F2) ─────────────────────────────────────────────────

def test_ledger_settings_edit_needs_only_the_grant(client, books):
    db, gl = books["db"], books["gl"]
    u = _user(db, "ledger.editor@premnathrail.com", ["accounts:ledger_settings:view", "accounts:ledger_settings:edit"])
    r = client.put(LEDGER_SETTINGS, json={"role": "ap_control", "gl_account_id": gl["2010"].id}, headers=_headers(u))
    assert r.status_code == 200, r.text
    assert db.query(AccountDetermination).filter(AccountDetermination.role == "ap_control").one().gl_account_id == gl["2010"].id

    viewer = _user(db, "ledger.viewer@premnathrail.com", ["accounts:ledger_settings:view"])
    r = client.put(LEDGER_SETTINGS, json={"role": "ap_control", "gl_account_id": None}, headers=_headers(viewer))
    assert r.status_code == 403 and "Ledger Settings" in r.json()["detail"]


# ── Journal reversal (F5) ────────────────────────────────────────────────

def test_journal_reversal_needs_only_the_reversal_grant(client, books):
    db = books["db"]
    _capital(books)
    je = _jv(books, date(2026, 8, 1), "5500", "1121", 1000)
    db.commit()
    body = {"reason": "wrong ledger", "reversal_date": date.today().isoformat()}
    no = _user(db, "jv.viewer@premnathrail.com", ["accounts:journal_vouchers:view"])
    r = client.post(f"/api/v1/accounts/journal-entries/{je.id}/reverse", json=body, headers=_headers(no))
    assert r.status_code == 403 and "Reverse posted journals" in r.json()["detail"]
    yes = _user(db, "jv.reverser@premnathrail.com", ["accounts:journal_vouchers:view", "accounts:journal_vouchers.reversal:cancel"])
    r = client.post(f"/api/v1/accounts/journal-entries/{je.id}/reverse", json=body, headers=_headers(yes))
    assert r.status_code == 200, r.text


# ── Period reopen (F11) ──────────────────────────────────────────────────

def test_period_reopen_is_the_period_close_approve_grant_not_admin(client, books):
    db = books["db"]
    db.add(PeriodClose(accounting_period="2026-06", status="closed"))
    db.commit()
    url = "/api/v1/accounts/period-close/2026-06/reopen"
    # An admin without the Approve grant can't (decision actions need a real grant, 2026-11-04).
    admin = _user(db, "pc.admin@premnathrail.com", [], role="admin")
    assert client.post(url, json={"reason": "late bill"}, headers=_headers(admin)).status_code == 403
    holder = _user(db, "pc.approver@premnathrail.com", ["accounts:period_close:view", "accounts:period_close:approve"])
    r = client.post(url, json={"reason": "late bill"}, headers=_headers(holder))
    assert r.status_code == 200, r.text
    assert db.query(PeriodClose).filter(PeriodClose.accounting_period == "2026-06").one().status == "open"


# ── Default approval stages (F6 / F7) ────────────────────────────────────

@pytest.mark.parametrize("key, perm", [
    (access.KEY_PERIOD_CLOSE, "accounts:period_close:approve"),
    (access.KEY_DEPRECIATION, "accounts:depreciation:approve"),
    (access.KEY_YEAR_END, "accounts:year_end_close:approve"),
])
def test_period_end_default_stage_is_the_approve_grant(key, perm):
    stages = engine.get_type(key).default_stages
    assert [(s.approver_rule, s.rule_config) for s in stages] == [("permission", {"permission": perm})]


def test_variance_default_stage_is_the_variance_feature_grant():
    first = engine.get_type(access.KEY_VENDOR_INVOICE).default_stages[0]
    assert first.approver_rule == "permission"
    assert first.rule_config == {"permission": "accounts:purchase_invoices.variance_approval:approve"}
    assert first.conditions == [{"field": "has_variance", "op": "true"}]


def test_period_close_goes_to_grant_holders_not_flag_holders(client, books):
    db = books["db"]
    flag_only = _user(db, "pc.flag@premnathrail.com", ["accounts:period_close:view"], fm=True)
    holder = _user(db, "pc.holder@premnathrail.com", ["accounts:period_close:view", "accounts:period_close:approve"])
    requester = _user(db, "pc.req@premnathrail.com", ["accounts:period_close:view", "accounts:period_close:approve"])
    req = engine.submit(db, access.KEY_PERIOD_CLOSE, entity_id=202606, requester=requester, title="Close 2026-06",
                        reference="2026-06", amount=None, context={"period": "2026-06"})
    approvers = {s.approver_id for s in req.steps}
    assert holder.id in approvers and flag_only.id not in approvers


def test_stored_flag_stages_are_migrated_to_the_grant(db):
    from app.modules.accounts.migrations import migrate_finance_flag_stages
    from app.modules.organization.models.approval import ApprovalWorkflow

    wf = engine.ensure_workflow(db, access.KEY_PERIOD_CLOSE)
    st = wf.stages[0]
    st.name, st.approver_rule, st.rule_config = "Finance Manager", "user_flag", {"flag": "is_finance_manager"}
    custom = engine.ensure_workflow(db, access.KEY_YEAR_END)
    custom.stages[0].name, custom.stages[0].approver_rule = "CFO sign-off", "user_flag"
    custom.stages[0].rule_config = {"flag": "is_finance_manager"}
    db.commit()

    assert migrate_finance_flag_stages(db.connection()) == 1
    db.commit()
    db.expire_all()
    pc = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == access.KEY_PERIOD_CLOSE).one().stages[0]
    assert (pc.name, pc.approver_rule, pc.rule_config) == ("Period close approver", "permission",
                                                           {"permission": "accounts:period_close:approve"})
    ye = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == access.KEY_YEAR_END).one().stages[0]
    assert ye.approver_rule == "user_flag"  # an admin's own stage is left alone
    assert migrate_finance_flag_stages(db.connection()) == 0  # idempotent
