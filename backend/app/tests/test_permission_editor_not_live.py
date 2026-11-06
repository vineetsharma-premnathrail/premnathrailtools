"""Not-live tabs stay in the Role editor catalog (grouped), so saving a role never strips their grants."""
from app.core.permission_registry import MODULES, NOT_LIVE_GROUP, NOT_LIVE_TABS, editor_modules


def test_not_live_tabs_are_grouped_not_removed():
    mods = editor_modules()
    for mk, hidden in NOT_LIVE_TABS.items():
        assert set(mods[mk]["actions"]) == set(MODULES[mk]["actions"])  # nothing removed
        assert set(mods[mk]["subtabs"]) == set(MODULES[mk]["subtabs"])
        for tab in hidden:
            assert mods[mk]["groups"][tab] == NOT_LIVE_GROUP
        keys = list(mods[mk]["subtabs"])
        assert all(keys.index(t) > max(keys.index(k) for k in keys if k not in hidden) for t in hidden)  # live tabs first


def test_registry_itself_is_untouched():
    for mk, hidden in NOT_LIVE_TABS.items():
        assert not any(MODULES[mk].get("groups", {}).get(t) == NOT_LIVE_GROUP for t in hidden)
