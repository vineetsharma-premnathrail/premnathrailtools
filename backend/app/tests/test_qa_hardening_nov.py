"""QA gap tests for the 2026-11-04/05 security hardening: real audit rows are
masked, NaN refused on PUT, production sid-less token, non-finite quantity."""
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from app.auth.jwt_handler import create_access_token
from app.core.config import settings
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.models.user_session import UserSession
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction


def _user(db, email="qahard@premnathrail.com"):
    u = User(email=email, name="QA Hard", role="user", is_active=True, assigned_apps=["erp"], erp_permissions=[])
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _rows(db, entity_type, entity_id):
    return db.query(AuditLog).filter(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id).order_by(AuditLog.id).all()


def _blob(rows):
    return " | ".join(f"{r.old_value} {r.new_value} {r.summary}" for r in rows)


def test_bank_account_number_change_is_masked_but_still_recorded(db):
    ba = BankAccount(account_kind="bank", bank_name="Test Bank", account_no="123456789012", status="active")
    db.add(ba)
    db.commit()
    assert ba.account_no == "123456789012"  # load current value, as a route would
    ba.account_no = "998877665544"
    db.commit()
    rows = _rows(db, "bank_account", ba.id)
    assert [r.action for r in rows] == ["created", "updated"]
    text = _blob(rows)
    assert "123456789012" not in text and "998877665544" not in text
    old, new = json.loads(rows[1].old_value), json.loads(rows[1].new_value)
    assert old["account_no"] == "••••9012" and new["account_no"] == "••••5544"
    assert "account_no" in rows[1].summary


def test_employee_pan_uan_change_is_masked_but_still_recorded(db):
    u = _user(db)
    p = HrEmployeeProfile(user_id=u.id, pan_number="ABCDE1234F", uan_number="100200300400")
    db.add(p)
    db.commit()
    assert p.pan_number == "ABCDE1234F"
    p.pan_number = "ZZZZZ9999Z"
    p.uan_number = "555666777888"
    db.commit()
    rows = _rows(db, "hr_employee_profile", p.id)
    assert rows and rows[-1].action == "updated"
    text = _blob(rows)
    for clear in ("ABCDE1234F", "ZZZZZ9999Z", "100200300400", "555666777888"):
        assert clear not in text, clear
    new = json.loads(rows[-1].new_value)
    assert new["pan_number"] == "••••999Z" and new["uan_number"] == "••••7888"
    assert "pan_number" in rows[-1].summary


def test_put_with_nan_is_refused(client, db):
    u = _user(db, "nanput@premnathrail.com")
    h = {"Authorization": "Bearer " + create_access_token({"sub": str(u.id), "email": u.email, "role": u.role}),
         "Content-Type": "application/json"}
    r = client.put("/api/v1/erp/projects/1", content=b'{"budget": NaN}', headers=h)
    assert r.status_code == 422 and "NaN or Infinity" in r.json()["detail"]


def test_production_rejects_sidless_token_but_accepts_session_token(client, db, monkeypatch):
    u = _user(db, "prodsid@premnathrail.com")
    sess = UserSession(user_id=u.id, token_hash="h" * 64, expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    db.add(sess)
    db.commit()
    db.refresh(sess)
    base = {"sub": str(u.id), "email": u.email, "role": u.role}
    no_sid = {"Authorization": "Bearer " + create_access_token(base)}
    with_sid = {"Authorization": "Bearer " + create_access_token({**base, "sid": sess.id})}

    monkeypatch.setattr(settings, "environment", "production")
    r = client.get("/api/v1/auth/me", headers=no_sid)
    assert r.status_code == 401 and "no session" in r.json()["detail"]
    assert client.get("/api/v1/auth/me", headers=with_sid).status_code != 401

    monkeypatch.setattr(settings, "environment", "development")
    assert client.get("/api/v1/auth/me", headers=no_sid).status_code == 200


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_stock_posting_refuses_non_finite_quantity(db, bad):
    item = StoreItem(item_code="NF-1", item_name="Bolt", uom="NOS")
    loc = StoreLocation(name="Main", code="MAIN")
    db.add_all([item, loc])
    db.commit()
    with pytest.raises(ValueError, match="finite"):
        post_stock_transaction(db, item_id=item.id, location_id=loc.id, transaction_type="receipt", quantity=bad,
                               transaction_date=date(2026, 11, 1))
