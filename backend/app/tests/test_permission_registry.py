"""The Permission Matrix registry is the contract between route checks, the
role editor and the frontend: every literal (module, tab, action) a route
checks must be declared there, or the matrix can't grant it and the check
denies everyone but admins."""
import re
from pathlib import Path

from app.core.permission_registry import (
    ACTIONS, AUTHORITY_GRANTS, MODULES, all_permission_ids, expand_grants, is_valid_grant,
)

APP_DIR = Path(__file__).resolve().parents[1]

# require_tab_action("m", "t", "a") / can_perform(user, "m", "t", "a") /
# permission_id("m", "t", "a") / ensure_tab_action(user, "m", "t", "a")
_TRIPLE = re.compile(
    r"(?:require_tab_action|ensure_tab_action|can_perform|permission_id)\(\s*(?:[a-z_]+\s*,\s*)?"
    r"\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\""
)
# require_tab_access("m", "t") / can_view_tab(user, "m", "t")
_VIEW = re.compile(r"(?:require_tab_access|can_view_tab)\(\s*(?:[a-z_]+\s*,\s*)?\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\"")
# require_feature_action("m", "t", "f", "a") / ensure_feature_action(user, …) / can_feature(user, …) / feature_id(…)
_FEATURE = re.compile(
    r"(?:require_feature_action|ensure_feature_action|can_feature|feature_id)\(\s*(?:[a-z_]+\s*,\s*)?"
    r"\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\""
)
# ensure_can_delete(user, record, "m", "t"
_DELETE = re.compile(r"ensure_can_delete\(\s*[a-z_]+\s*,\s*[a-z_.\[\]0-9]+\s*,\s*\"([a-z_]+)\"\s*,\s*\"([a-z_]+)\"")


def _sources():
    for path in APP_DIR.rglob("*.py"):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        yield path, path.read_text(encoding="utf-8")


def test_every_literal_route_triple_is_declared():
    declared = all_permission_ids()
    missing = []
    for path, text in _sources():
        for m in _TRIPLE.finditer(text):
            pid = ":".join(m.groups())
            if pid not in declared:
                missing.append(f"{path.relative_to(APP_DIR)}: {pid}")
        for m in _VIEW.finditer(text):
            pid = f"{m.group(1)}:{m.group(2)}:view"
            if pid not in declared:
                missing.append(f"{path.relative_to(APP_DIR)}: {pid}")
        for m in _FEATURE.finditer(text):
            mk, tk, fk, a = m.groups()
            pid = f"{mk}:{tk}.{fk}:{a}"
            if pid not in declared:
                missing.append(f"{path.relative_to(APP_DIR)}: {pid}")
        for m in _DELETE.finditer(text):
            pid = f"{m.group(1)}:{m.group(2)}:delete"
            if pid not in declared:
                missing.append(f"{path.relative_to(APP_DIR)}: {pid}")
    assert not missing, "Undeclared permission ids (add them to permission_registry.MODULES):\n" + "\n".join(sorted(set(missing)))


def test_every_tab_has_view_and_known_actions_only():
    for mk, m in MODULES.items():
        assert set(m["subtabs"]) == set(m["actions"]), mk
        for tk, acts in m["actions"].items():
            assert "view" in acts, f"{mk}:{tk} has no view"
            assert set(acts) <= set(ACTIONS), f"{mk}:{tk}"
        assert set(m["groups"]) <= set(m["subtabs"]), mk


def test_authority_grants_exist():
    assert AUTHORITY_GRANTS <= all_permission_ids()


def test_quality_role_sets_are_declared():
    from app.modules.quality.services.access import QUALITY_ROLE_PERMISSION_SETS

    for spec in QUALITY_ROLE_PERMISSION_SETS.values():
        assert set(spec["grants"]) <= all_permission_ids(), spec["label"]


def test_wildcards_expand_against_the_registry():
    assert is_valid_grant("store:*:*") and is_valid_grant("store:*:view")
    assert not is_valid_grant("store:*:fly") and not is_valid_grant("nope:*:*") and not is_valid_grant("store:items:approve")
    view_all = expand_grants(["store:*:view"])
    assert {g for g in view_all if "." not in g.split(":")[1]} == {f"store:{t}:view" for t in MODULES["store"]["subtabs"]}
    # Features of every tab are viewable too.
    assert all(g.endswith(":view") for g in view_all)
    full = expand_grants(["accounts:*:*"])
    assert "accounts:journal_vouchers:approve" in full and "accounts:day_book:delete" not in full
    # Unknown / retired ids are dropped, not kept as dead grants.
    assert expand_grants(["hydraulic:spare_parts:view", "p2p:grn:view"]) == set()


def test_features_are_well_formed():
    for mk, m in MODULES.items():
        for tk, feats in m.get("features", {}).items():
            assert tk in m["actions"], f"{mk}:{tk} has features but is not a tab"
            for fk, f in feats.items():
                assert "view" in f["actions"], f"{mk}:{tk}.{fk} has no view"
                for a, legacy in f["inherit"].items():
                    if legacy is None:  # explicit-only: never inherited
                        continue
                    assert legacy in m["actions"][tk], f"{mk}:{tk}.{fk}:{a} inherits '{legacy}', which {mk}:{tk} does not have"


def test_feature_inheritance_keeps_current_access():
    from app.core import permission_registry as reg

    # A throw-away module, so real feature declarations never interfere.
    reg.MODULES["_t"] = reg._module("Test", ("issues", "Issues", reg.CRUD), ("items", "Items", reg.CRUD))
    try:
        reg.register_features("_t", "issues", reg._feature("pricing", "Prices", "sensitive", {"view": "view", "edit": "edit"}))
        # Uncustomised: the feature follows the tab.
        assert "_t:issues.pricing:view" in expand_grants(["_t:issues:view"])
        assert "_t:issues.pricing:edit" not in expand_grants(["_t:issues:view"])
        assert "_t:issues.pricing:edit" in expand_grants(["_t:issues:edit"])
        assert "_t:issues.pricing:edit" in expand_grants(["_t:*:*"])
        # Customised: only explicit feature ids count for that tab.
        custom = expand_grants(["_t:issues:edit", "_t:issues.pricing:view"])
        assert "_t:issues.pricing:view" in custom and "_t:issues.pricing:edit" not in custom
        # "Customised, none": the features stop following the tab.
        none = expand_grants(["_t:issues:edit", "_t:issues.*:none"])
        assert "_t:issues.pricing:view" not in none and "_t:issues:edit" in none
        assert is_valid_grant("_t:issues.*:none") and not is_valid_grant("_t:items.*:none")
        # A feature grant implies viewing the feature and its tab.
        assert {"_t:issues.pricing:view", "_t:issues:view"} <= expand_grants(["_t:issues.pricing:edit"])
        assert is_valid_grant("_t:issues.pricing:edit") and not is_valid_grant("_t:issues.pricing:approve")
        # Per role: one role's customisation does not switch off another's inheritance.
        both = reg.expand_grant_sources(["_t:issues:edit", "_t:issues.pricing:view"], ["_t:issues:edit"])
        assert "_t:issues.pricing:edit" in both
    finally:
        reg.MODULES.pop("_t", None)
        reg.FEATURES.pop("_t", None)


def test_explicit_only_feature_is_never_inherited_or_preset_granted():
    """R&D › Requirements › Technical Offer team replaced a hand-picked list:
    no preset (wildcards) and no tab inheritance may hand it out."""
    from app.core.permission_registry import expand_grants
    view, create = "rnd:requirements.offer_team:view", "rnd:requirements.offer_team:create"
    for preset in (["rnd:*:*"], ["rnd:*:view", "rnd:*:create", "rnd:*:edit"], ["rnd:requirements:view", "rnd:requirements:create"]):
        got = expand_grants(preset)
        assert view not in got and create not in got, preset
        assert "rnd:requirements.technical_offers:view" in got  # ordinary features still inherit
    ticked = expand_grants(["rnd:requirements:view", create])
    assert create in ticked and "rnd:requirements:view" in ticked
