"""Unit tests for app.modules.main.models.User — no HTTP layer involved."""
import pytest
from sqlalchemy.exc import IntegrityError

from app.modules.main.models.user import User, AVAILABLE_APPS


def test_get_apps_admin_gets_everything_regardless_of_assignment():
    user = User(email="a@x.com", name="A", role="admin", assigned_apps=["erp"])
    assert user.get_apps() == sorted(AVAILABLE_APPS)


def test_get_apps_regular_user_gets_only_assigned():
    user = User(email="a@x.com", name="A", role="user", assigned_apps=["crm", "rnd"])
    assert user.get_apps() == ["crm", "rnd"]


def test_get_apps_regular_user_with_no_assignment_gets_none():
    user = User(email="a@x.com", name="A", role="user", assigned_apps=[])
    assert user.get_apps() == []


def test_get_apps_regular_user_assigned_apps_none_defaults_to_empty():
    user = User(email="a@x.com", name="A", role="user", assigned_apps=None)
    assert user.get_apps() == []


def test_legacy_security_fields_default_to_inert_values(db):
    """hashed_password/must_change_password/encrypted_graph_refresh_token are
    dormant (see security note on the model) — confirm they default to
    values that can't accidentally look like an active local-auth record."""
    user = User(email="new@x.com", name="New")
    db.add(user)
    db.commit()
    db.refresh(user)

    assert user.hashed_password is None
    assert user.must_change_password is False
    assert user.encrypted_graph_refresh_token is None


def test_email_uniqueness_enforced(db):
    db.add(User(email="dup@x.com", name="One"))
    db.commit()

    db.add(User(email="dup@x.com", name="Two"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_azure_id_uniqueness_enforced(db):
    db.add(User(email="one@x.com", name="One", azure_id="az-1"))
    db.commit()

    db.add(User(email="two@x.com", name="Two", azure_id="az-1"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
