"""R&D Experiments & Tests and Prototypes (builds + BOM + release to production) were
removed on 2026-11-17. Prototype / Research projects and the R&D task type
'prototype' stay. Proves: the routes are gone, the permission registry no longer
offers the tabs / features, and the grants migration rewrites old grants."""
import importlib.util
from pathlib import Path

import pytest

from app.auth.jwt_handler import create_access_token
from app.core.permission_registry import MODULES
from app.modules.main.models.user import User
from app.modules.rnd import service

BASE = "/api/v1/rnd"
MIGRATION = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "b7e2d4f6a8c1_drop_rnd_experiments_prototypes.py"


@pytest.fixture(scope="module")
def mig():
    spec = importlib.util.spec_from_file_location("drop_rnd_experiments_prototypes", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _user(db, email, grants=None):
    u = User(email=email, name=email.split("@")[0], role="user", is_active=True,
             assigned_apps=["rnd"], granular_permissions=list(grants or []))
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _h(u):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(u.id), 'email': u.email, 'role': u.role})}"}


@pytest.mark.parametrize("method,path", [
    ("get", "/experiments"), ("post", "/experiments"), ("get", "/experiments/1"),
    ("get", "/prototypes"), ("post", "/prototypes"), ("get", "/prototypes/1"),
    ("post", "/prototypes/1/release-to-production"), ("get", "/lookups/store-items"),
])
def test_removed_routes_are_gone(client, db, method, path):
    u = _user(db, f"gone-{method}-{abs(hash(path))}@premnathrail.com")
    r = getattr(client, method)(f"{BASE}{path}", headers=_h(u), **({"json": {}} if method == "post" else {}))
    assert r.status_code in (404, 405), (path, r.status_code, r.text)


def test_registry_no_longer_offers_removed_tabs_and_features():
    rnd = MODULES["rnd"]
    assert "experiments" not in rnd["subtabs"] and "prototypes" not in rnd["subtabs"]
    features = rnd.get("features", {})
    assert "experiments" not in features and "prototypes" not in features
    assert "costs" in features["projects"] and "team" in features["projects"]


def test_removed_service_helpers_are_gone():
    for name in ("generate_experiment_number", "generate_prototype_number", "prototype_bom_cost", "project_actual_cost"):
        assert not hasattr(service, name), name


def test_dashboard_keys(client, db):
    u = _user(db, "dash-keys@premnathrail.com", ["rnd:dashboard:view"])
    r = client.get(f"{BASE}/dashboard", headers=_h(u))
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"requirements", "projects", "recent_projects"}


def test_hide_costs_follows_projects_costs_switch(db):
    # A role "customised" for the projects tab holds some projects.* feature id, so its features
    # stop following the tab and only the explicit ones count (permission_registry FEATURES rules).
    hidden = _user(db, "hc-none@premnathrail.com", ["rnd:projects:view", "rnd:projects.team:view"])
    costs = _user(db, "hc-costs@premnathrail.com", ["rnd:projects:view", "rnd:projects.team:view", "rnd:projects.costs:view"])
    editor = _user(db, "hc-edit@premnathrail.com", ["rnd:projects:view", "rnd:projects:edit", "rnd:projects.team:view"])
    old_switch = _user(db, "hc-old@premnathrail.com", ["rnd:projects:view", "rnd:projects.team:view", "rnd:prototypes.costs:view"])
    assert service.hide_costs(hidden) is True
    assert service.hide_costs(costs) is False
    assert service.hide_costs(editor) is False  # editing a project implies seeing its budget
    assert service.hide_costs(old_switch) is True  # the old grant means nothing until the migration rewrites it


def test_uncustomised_projects_role_inherits_budget_view(db):
    # Keep-current-access rule: a role that never customised the projects tab follows the tab's View.
    plain = _user(db, "hc-plain@premnathrail.com", ["rnd:projects:view"])
    assert service.hide_costs(plain) is False


def test_rewrite_grants_always_drops_removed_tabs(mig):
    old = ["rnd:projects:view", "rnd:experiments:view", "rnd:experiments:create", "rnd:experiments.conducted_by:view",
           "rnd:prototypes:view", "rnd:prototypes:edit", "rnd:prototypes.release_production:approve",
           "crm:inquiries:view", "rnd:tasks:view"]
    new = mig.rewrite_grants(old)
    # Projects tab is uncustomised: no costs grant is added (it already inherits the projects View).
    assert new == ["rnd:projects:view", "crm:inquiries:view", "rnd:tasks:view"]
    assert not any(g.startswith(("rnd:experiments", "rnd:prototypes")) for g in new)


def test_rewrite_grants_costs_only_added_for_customised_projects_tab(mig):
    # Explicit old costs switch but projects tab not customised: dropped, nothing added.
    assert mig.rewrite_grants(["rnd:prototypes.costs:view"]) == []
    assert mig.rewrite_grants(["rnd:projects:view", "rnd:projects:edit", "rnd:prototypes.costs:view"]) == [
        "rnd:projects:view", "rnd:projects:edit"]
    # Customised projects tab + Prototypes View on an uncustomised Prototypes tab: saw the costs -> carried over.
    assert mig.rewrite_grants(["rnd:projects:view", "rnd:projects.tasks:view", "rnd:prototypes:view"]) == [
        "rnd:projects:view", "rnd:projects.tasks:view", "rnd:projects.costs:view"]
    # Customised projects tab + explicit old costs switch -> carried over.
    assert mig.rewrite_grants(["rnd:projects:view", "rnd:projects.team:view", "rnd:prototypes.costs:view"]) == [
        "rnd:projects:view", "rnd:projects.team:view", "rnd:projects.costs:view"]


def test_rewrite_grants_does_not_carry_costs_when_prototypes_tab_was_customised_without_it(mig):
    # Prototypes tab customised (some rnd:prototypes.<feature>) but no costs switch: the role never saw costs.
    got = mig.rewrite_grants(["rnd:projects:view", "rnd:projects.tasks:view", "rnd:prototypes:view",
                              "rnd:prototypes.release_production:view"])
    assert got == ["rnd:projects:view", "rnd:projects.tasks:view"]
    # Only an edit-style costs action does not count as the view switch.
    assert mig.rewrite_grants(["rnd:projects.team:view", "rnd:prototypes.costs:edit"]) == ["rnd:projects.team:view"]


def test_rewrite_grants_is_idempotent_and_leaves_clean_lists_alone(mig):
    clean = ["rnd:projects:view", "rnd:projects.costs:view", "rnd:tasks:create"]
    assert mig.rewrite_grants(clean) is None
    assert mig.rewrite_grants([]) is None
    assert mig.rewrite_grants(None) is None
    assert mig.rewrite_grants(["rnd:*:*"]) is None
    # Already holds a costs grant: never added twice.
    got = mig.rewrite_grants(["rnd:projects.team:view", "rnd:projects.costs:view", "rnd:prototypes.costs:view"])
    assert got == ["rnd:projects.team:view", "rnd:projects.costs:view"]
    assert mig.rewrite_grants(got) is None
    # Second run over a first run's output is a no-op.
    first = mig.rewrite_grants(["rnd:projects:view", "rnd:projects.tasks:view", "rnd:prototypes:view"])
    assert mig.rewrite_grants(first) is None
