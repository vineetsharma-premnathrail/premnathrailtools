"""Regression tests for the 2026-11-04 security audit fixes: NaN/Infinity bodies,
audit-log masking of identity/bank numbers, fail-closed weak SECRET_KEY."""
import pytest
from pydantic import ValidationError

from app.auth.jwt_handler import create_access_token
from app.core.audit import _is_sensitive, mask_value
from app.core.config import Settings
from app.modules.main.models.user import User


def _header(db):
    user = User(email="nanguard@premnathrail.com", name="nan", role="user", is_active=True,
                assigned_apps=["erp"], erp_permissions=[])
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_bare_nan_or_infinity_in_json_body_is_refused(client, db, token):
    body = ('{"quantity": %s}' % token).encode()
    r = client.post("/api/v1/erp/projects", content=body, headers=_header(db))
    assert r.status_code == 422
    assert "NaN or Infinity" in r.json()["detail"]


@pytest.mark.parametrize("ctype,body", [
    ("Application/JSON", b'{"quantity": NaN}'),
    ("application/problem+json", b'{"quantity": Infinity}'),
    ("application/json", b'{"quantity": 1e999}'),
    (None, b'{"quantity": NaN}'),
])
def test_nan_guard_covers_odd_content_types_and_exponent_overflow(client, db, ctype, body):
    headers = _header(db)
    if ctype is None:
        headers.pop("Content-Type")
    else:
        headers["Content-Type"] = ctype
    r = client.put("/api/v1/erp/projects/1", content=body, headers=headers)
    assert r.status_code == 422
    assert "NaN or Infinity" in r.json()["detail"]


def test_audit_masks_only_text_values():
    from app.core.audit import _safe
    assert _safe("must_change_password", False) is False
    assert _safe("pan_number", "ABCDE1234F") == "••••234F"


def test_nan_text_inside_a_string_is_not_blocked(client, db):
    r = client.post("/api/v1/erp/projects", content=b'{"name": "NaN Infinity corp"}', headers=_header(db))
    assert "NaN or Infinity" not in str(r.json())


def test_identity_and_bank_numbers_are_masked_for_audit():
    for key in ("pan_number", "uan_number", "esic_number", "aadhaar_last4", "bank_account_no", "account_no", "hashed_password", "pan"):
        assert _is_sensitive(key), key
    for key in ("company_name", "expand_flag", "bank_name", "quantity", "panel_count"):
        assert not _is_sensitive(key), key
    assert mask_value("ABCDE1234F") == "••••234F"
    assert mask_value("12") == "••••"
    assert mask_value(None) is None


def test_weak_secret_with_public_url_refuses_to_start():
    with pytest.raises(ValidationError):
        Settings(SECRET_KEY="...", FRONTEND_URL="https://erp.example.com", environment="development")
    with pytest.raises(ValidationError):
        Settings(SECRET_KEY="short", environment="production")


def test_weak_secret_on_localhost_still_starts_for_development():
    s = Settings(SECRET_KEY="...", FRONTEND_URL="http://localhost:3000",
                 ALLOWED_ORIGINS="http://localhost:3000", environment="development")
    assert s.environment == "development"
