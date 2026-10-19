"""Assign-to rules per role (core/assignee_rules.py): who a role's members may
pick in an "Assign to" field."""
import pytest
from fastapi import HTTPException

from app.core.assignee_rules import allowed_ids, clean_rules, ensure_allowed
from app.modules.main.models.role import Role
from app.modules.main.models.user import User

KEY = "rnd:requirements.tasks"


def _user(db, email, **kw):
    u = User(email=email, name=email.split("@")[0].title(), role="user", is_active=True, granular_permissions=[], **kw)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _role(db, name, rules=None, permissions=("rnd:requirements:view",)):
    r = Role(name=name, permissions=list(permissions), assignee_rules=rules or {})
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def test_no_rule_means_no_restriction(db):
    u = _user(db, "a@premnathrail.com")
    u.roles = [_role(db, "R&D Engineer")]
    db.commit()
    assert allowed_ids(db, u, KEY) is None


def test_self_and_team(db):
    boss = _user(db, "boss@premnathrail.com")
    mid = _user(db, "mid@premnathrail.com", reporting_manager_id=boss.id)
    low = _user(db, "low@premnathrail.com", reporting_manager_id=mid.id)
    other = _user(db, "other@premnathrail.com")
    boss.roles = [_role(db, "Lead", {KEY: {"mode": "team"}})]
    mid.roles = [_role(db, "Solo", {KEY: {"mode": "self"}})]
    db.commit()
    assert allowed_ids(db, boss, KEY) == {boss.id, mid.id, low.id}
    assert allowed_ids(db, mid, KEY) == {mid.id}
    with pytest.raises(HTTPException) as e:
        ensure_allowed(db, boss, KEY, other)
    assert e.value.status_code == 403


def test_custom_users_and_roles_union_and_unrelated_role_ignored(db):
    a = _user(db, "a@premnathrail.com")
    b = _user(db, "b@premnathrail.com")
    c = _user(db, "c@premnathrail.com")
    tagged = _role(db, "Designers", permissions=("design:*:view",))
    c.roles = [tagged]
    # A role that doesn't open R&D requirements doesn't lift the restriction.
    a.roles = [_role(db, "Picker", {KEY: {"mode": "custom", "users": [b.id], "roles": [tagged.id]}}), tagged]
    db.commit()
    # a holds Designers too, so a is in it; the Designers role itself (no R&D) adds no "no rule".
    assert allowed_ids(db, a, KEY) == {a.id, b.id, c.id}


def test_any_relevant_role_without_rule_lifts_restriction(db):
    a = _user(db, "a@premnathrail.com")
    a.roles = [_role(db, "Narrow", {KEY: {"mode": "self"}}), _role(db, "Wide")]
    db.commit()
    assert allowed_ids(db, a, KEY) is None


def test_clean_rules_rejects_bad_input():
    with pytest.raises(ValueError):
        clean_rules({"nope:x.y": {"mode": "self"}})
    with pytest.raises(ValueError):
        clean_rules({KEY: {"mode": "custom"}})
    assert clean_rules({KEY: {"mode": "team", "users": [1]}}) == {KEY: {"mode": "team"}}


def test_every_picker_belongs_to_a_declared_feature():
    from app.core.assignee_rules import PICKERS
    from app.core.permission_registry import MODULES
    assert "rnd:requirements.tasks" in PICKERS
    for key in PICKERS:
        mk, tabfeat = key.split(":", 1)
        tab, _, fk = tabfeat.partition(".")
        assert fk in MODULES.get(mk, {}).get("features", {}).get(tab, {}),             f"{key}: declare feature '{fk}' on {mk} › {tab} in core/features/{mk}.py first"
