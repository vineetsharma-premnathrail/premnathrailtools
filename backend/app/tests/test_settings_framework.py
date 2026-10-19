"""Shared settings framework (app/core/settings_framework.py): typed coercion,
code defaults, validate-all-then-write, audit trail, explicit edit grant and
the generated router."""
import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core import settings_framework as sf
from app.core.settings_framework import ModuleSettingsDef, SettingSpec
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user

MOD = "testmod"


@pytest.fixture(autouse=True)
def _throwaway_modules_in_registry(monkeypatch):
    """The throwaway modules these tests register settings for must exist in
    the permission registry and app list too — access is derived from
    registry grants now (deny by default)."""
    from app.core import permission_registry as pr
    from app.modules.main.models import user as user_model

    for key in (MOD, "ordmod"):
        monkeypatch.setitem(pr.MODULES, key, pr._module(key.title(), ("settings", "Settings", pr.SETTINGS)))
    monkeypatch.setattr(user_model, "AVAILABLE_APPS", user_model.AVAILABLE_APPS | {MOD, "ordmod"})


def _cross(values: dict) -> None:
    if values["warn_days"] > values["lead_days"]:
        raise ValueError("Warning days can't be more than lead days — lower the warning days.")


@pytest.fixture(autouse=True)
def _register():
    sf.register_module_settings(ModuleSettingsDef(
        module_key=MOD, label="Test module", app_key=None,
        groups={"general": "General", "people": "People"},
        specs={
            "lead_days": SettingSpec("lead_days", "general", "PM lead days", "int", 7, min=0, max=365),
            "warn_days": SettingSpec("warn_days", "general", "Warning days", "int", 2, min=0),
            "limit": SettingSpec("limit", "general", "Scrap limit", "decimal", 5000.0, min=0),
            "enabled": SettingSpec("enabled", "general", "Reminders on", "bool", True),
            "prefix": SettingSpec("prefix", "general", "Number prefix", "prefix", "TM"),
            "mode": SettingSpec("mode", "general", "Mode", "select", "a", options=[("a", "Alpha"), ("b", "Beta")]),
            "tags": SettingSpec("tags", "general", "Tags", "json_list", []),
            "remind_days": SettingSpec("remind_days", "general", "Reminder days", "json_list", [30, 7, 1]),
            "approver": SettingSpec("approver", "people", "Approver", "user", None),
            "frozen": SettingSpec("frozen", "general", "Frozen", "int", 1, locked=True),
        },
        cross_validate=_cross,
    ))
    yield
    sf._REGISTRY.pop(MOD, None)


def _user(db, email, role="user", grants=(), apps=(MOD,)):
    u = User(email=email, name=email.split("@")[0], role=role, is_active=True,
             assigned_apps=list(apps), granular_permissions=list(grants))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_defaults_when_unset(db):
    assert sf.get_setting(db, MOD, "lead_days") == 7
    data = sf.get_all(db, MOD)
    assert data["values"]["prefix"] == "TM"
    assert all(data["is_default"].values())
    with pytest.raises(KeyError):
        sf.get_setting(db, MOD, "nope")
    with pytest.raises(KeyError):
        sf.get_def("unknown_module")


def test_coerce_rules(db):
    spec = sf.get_def(MOD).specs["lead_days"]
    assert sf.coerce(spec, "2.0", db) == 2
    with pytest.raises(ValueError, match="whole number between 0 and 365"):
        sf.coerce(spec, "2.5", db)
    with pytest.raises(ValueError, match="between 0 and 365 — enter a number in that range"):
        sf.coerce(spec, 400, db)
    with pytest.raises(ValueError, match="is required — enter a number"):
        sf.coerce(spec, "", db)
    with pytest.raises(ValueError, match="is required"):
        sf.coerce(spec, None, db)
    defn = sf.get_def(MOD)
    with pytest.raises(ValueError, match="Alpha, Beta"):
        sf.coerce(defn.specs["mode"], "z", db)
    with pytest.raises(ValueError, match="Yes or No"):
        sf.coerce(defn.specs["enabled"], "true", db)
    assert sf.coerce(defn.specs["prefix"], " ab-1 ", db) == "AB-1"
    with pytest.raises(ValueError, match="1–10 letters"):
        sf.coerce(defn.specs["prefix"], "TOO LONG PREFIX", db)
    with pytest.raises(ValueError, match="plain values"):
        sf.coerce(defn.specs["tags"], [["x"]], db)


def test_user_spec_requires_active_user_with_app(db):
    spec = sf.get_def(MOD).specs["approver"]
    ok = _user(db, "ok@x.com")
    no_app = _user(db, "noapp@x.com", apps=())
    gone = _user(db, "gone@x.com")
    gone.is_active = False
    db.commit()
    assert sf.coerce(spec, ok.id, db, app_key=MOD) == ok.id
    with pytest.raises(ValueError, match="no access"):
        sf.coerce(spec, no_app.id, db, app_key=MOD)
    with pytest.raises(ValueError, match="deactivated"):
        sf.coerce(spec, gone.id, db, app_key=MOD)
    with pytest.raises(ValueError, match="does not exist"):
        sf.coerce(spec, 9999, db, app_key=MOD)


def test_one_bad_value_saves_nothing(db):
    admin = _user(db, "admin@x.com", role="admin")
    with pytest.raises(ValueError, match="PM lead days"):
        sf.save(db, MOD, {"prefix": "NEW", "lead_days": "abc"}, admin)
    assert db.query(ModuleSetting).count() == 0
    with pytest.raises(ValueError, match="not a Test module setting"):
        sf.save(db, MOD, {"bogus": 1}, admin)
    with pytest.raises(ValueError, match="locked"):
        sf.save(db, MOD, {"frozen": 2}, admin)
    with pytest.raises(ValueError, match="Warning days can't be more"):
        sf.save(db, MOD, {"warn_days": 10}, admin)
    assert db.query(ModuleSetting).count() == 0
    assert db.query(AuditLog).count() == 0


def test_save_audits_and_default_deletes_row(db):
    admin = _user(db, "admin@x.com", role="admin")
    data = sf.save(db, MOD, {"lead_days": "30", "mode": "b"}, admin)
    assert data["values"]["lead_days"] == 30
    assert data["is_default"]["lead_days"] is False
    assert data["meta"]["lead_days"]["updated_by_name"] == "admin"
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "module_setting").all()
    summaries = {l.summary for l in logs}
    assert "PM lead days: 7 → 30" in summaries
    assert "Mode: Alpha → Beta" in summaries
    assert all(l.module_key == MOD for l in logs)

    # unchanged value → no new audit row
    sf.save(db, MOD, {"lead_days": 30}, admin)
    assert db.query(AuditLog).count() == 2

    # back to the code default → row removed, default live again
    sf.save(db, MOD, {"lead_days": 7}, admin)
    assert db.query(ModuleSetting).filter_by(key="lead_days").count() == 0
    assert sf.get_all(db, MOD)["is_default"]["lead_days"] is True
    assert db.query(AuditLog).count() == 3


def test_reset_restores_default(db):
    admin = _user(db, "admin@x.com", role="admin")
    sf.save(db, MOD, {"limit": 100}, admin)
    assert sf.get_setting(db, MOD, "limit") == 100
    sf.reset(db, MOD, "limit", admin)
    assert sf.get_setting(db, MOD, "limit") == 5000.0
    assert db.query(AuditLog).filter(AuditLog.action == "reset").one().summary == "Scrap limit reset to default (5000)"


def test_can_edit_settings(db):
    plain = _user(db, "plain@x.com")
    admin = _user(db, "admin@x.com", role="admin")
    granted = _user(db, "head@x.com", grants=[f"{MOD}:settings:edit"])
    assert sf.can_edit_settings(plain, MOD) is False
    assert sf.can_edit_settings(admin, MOD) is True
    assert sf.can_edit_settings(granted, MOD) is True


def _client(db, user):
    # "testmod" is not in AVAILABLE_APPS, so admins wouldn't get it from
    # get_apps(); this mirrors require_app_access for a throwaway module.
    def _access(u: User = Depends(get_current_user)) -> User:
        if u.role != "admin" and MOD not in (u.assigned_apps or []):
            raise HTTPException(status_code=403, detail=f"Access to '{MOD}' module required")
        return u

    app = FastAPI()
    app.include_router(sf.make_settings_router(MOD, app_access_dep=_access), prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_router(db):
    plain = _user(db, "plain@x.com")
    r = _client(db, plain).get(f"/api/v1/{MOD}/settings")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["can_edit"] is False
    assert body["is_default"]["lead_days"] is True
    mode = next(s for s in body["specs"] if s["key"] == "mode")
    assert mode["options"] == [{"value": "a", "label": "Alpha"}, {"value": "b", "label": "Beta"}]
    assert {"key": "general", "label": "General"} in body["groups"]

    r = _client(db, plain).put(f"/api/v1/{MOD}/settings", json={"values": {"lead_days": 10}})
    assert r.status_code == 403
    assert "Settings → Edit" in r.json()["detail"]

    admin = _user(db, "admin@x.com", role="admin")
    c = _client(db, admin)
    r = c.put(f"/api/v1/{MOD}/settings", json={"values": {"lead_days": 2.5}})
    assert r.status_code == 422
    assert "whole number" in r.json()["detail"]
    r = c.put(f"/api/v1/{MOD}/settings", json={"values": {"lead_days": 10}})
    assert r.status_code == 200 and r.json()["values"]["lead_days"] == 10
    r = c.post(f"/api/v1/{MOD}/settings/reset/lead_days")
    assert r.status_code == 200 and r.json()["is_default"]["lead_days"] is True

    no_app = _user(db, "noapp@x.com", apps=())
    assert _client(db, no_app).get(f"/api/v1/{MOD}/settings").status_code == 403


def test_numeric_json_list_keeps_numbers(db):
    defn = sf.get_def(MOD)
    spec = defn.specs["remind_days"]
    assert sf.coerce(spec, ["30", " 7 ", 1, ""], db) == [30, 7, 1]
    with pytest.raises(ValueError, match='"x" is not a number — enter numbers separated by commas'):
        sf.coerce(spec, ["30", "x"], db)
    with pytest.raises(ValueError, match="whole number"):
        sf.coerce(spec, ["2.5"], db)
    # Text lists stay text.
    assert sf.coerce(defn.specs["tags"], ["a", " 5 "], db) == ["a", "5"]
    admin = _user(db, "nl@x.com", role="admin")
    sf.save(db, MOD, {"remind_days": ["14", "3"]}, admin)
    assert sf.get_setting(db, MOD, "remind_days") == [14, 3]


def test_router_concurrent_insert_returns_409(db, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    def _boom(*a, **k):
        raise IntegrityError("INSERT", {}, Exception("uq_module_settings_key"))

    monkeypatch.setattr(sf, "save", _boom)
    monkeypatch.setattr(sf, "reset", _boom)
    c = _client(db, _user(db, "race@x.com", role="admin"))
    r = c.put(f"/api/v1/{MOD}/settings", json={"values": {"lead_days": 10}})
    assert r.status_code == 409 and "reload the page and save again" in r.json()["detail"]
    r = c.post(f"/api/v1/{MOD}/settings/reset/lead_days")
    assert r.status_code == 409


def test_duplicate_company_wide_row_rejected(db):
    from sqlalchemy.exc import IntegrityError

    db.add(ModuleSetting(module_key=MOD, key="lead_days", branch_id=None, value=10))
    db.commit()
    db.add(ModuleSetting(module_key=MOD, key="lead_days", branch_id=None, value=11))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_set_values_ignore_order(db):
    sf.register_module_settings(ModuleSettingsDef(
        module_key="ordmod", label="Order module", groups={"g": "G"},
        specs={
            "kinds": SettingSpec("kinds", "g", "Kinds", "multi_select", ["a", "c"],
                                 options=[("a", "A"), ("b", "B"), ("c", "C")]),
            "approvers": SettingSpec("approvers", "g", "Approvers", "users", []),
        },
    ))
    try:
        admin = _user(db, "ord@x.com", role="admin")
        u1 = _user(db, "u1@x.com", apps=("ordmod",))
        u2 = _user(db, "u2@x.com", apps=("ordmod",))
        spec = sf.get_def("ordmod").specs["kinds"]
        assert sf.coerce(spec, ["c", "b", "a"], db) == ["a", "b", "c"]
        # Same set as the default in another order: still the default, no row, no audit.
        sf.save(db, "ordmod", {"kinds": ["c", "a"]}, admin)
        assert sf.get_all(db, "ordmod")["is_default"]["kinds"] is True
        sf.save(db, "ordmod", {"approvers": [u1.id, u2.id]}, admin)
        n_audit = db.query(AuditLog).filter(AuditLog.module_key == "ordmod").count()
        assert n_audit == 1
        sf.save(db, "ordmod", {"approvers": [u2.id, u1.id]}, admin)
        assert db.query(AuditLog).filter(AuditLog.module_key == "ordmod").count() == n_audit
        assert sf.get_setting(db, "ordmod", "approvers") == [u1.id, u2.id]
    finally:
        sf._REGISTRY.pop("ordmod", None)


def test_default_router_checks_def_app_key(db):
    # Settings key differs from the app key: access is checked on app_key.
    router = sf.make_settings_router("altset")  # built before the def registers
    sf.register_module_settings(ModuleSettingsDef(
        module_key="altset", label="Alt", app_key="maintenance", groups={"g": "G"},
        specs={"n": SettingSpec("n", "g", "N", "int", 1)},
    ))
    try:
        def client(user):
            app = FastAPI()
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[get_current_user] = lambda: user
            return TestClient(app)

        ok = _user(db, "m@x.com", apps=("maintenance",))
        assert client(ok).get("/api/v1/altset/settings").status_code == 200
        wrong = _user(db, "w@x.com", apps=("altset",))
        r = client(wrong).get("/api/v1/altset/settings")
        assert r.status_code == 403 and "Alt module" in r.json()["detail"]
    finally:
        sf._REGISTRY.pop("altset", None)
