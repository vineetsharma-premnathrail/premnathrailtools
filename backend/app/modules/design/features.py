"""Role-level feature gates for Design (declared in core/features/design.py).

The detail pages show buttons from the server's `allowed_actions`, so each
record type maps its allowed action names to the feature action that must
also be held: record-level rules decide first (who may act on this record
now), then the role's feature grant is applied on top.

Keep current access: the feature gate applies only to users who hold the
tab's View. Someone without the tab (a change-board voter, an ECN
acknowledger, a named checker reaching a record from a notification or a
cross-link) keeps exactly the pre-feature behaviour — only the record-level
rules apply to them."""
from app.core.permission_registry import all_permission_ids, can_feature, can_view_tab, feature_id
from app.core.permissions import ensure_feature_action

# tab -> allowed action name -> (feature, feature action)
ACTION_FEATURES: dict[str, dict[str, tuple[str, str]]] = {
    "documents": {
        "submit": ("check_release", "submit"), "review": ("check_release", "approve"),
        "approve": ("check_release", "approve"), "release": ("check_release", "approve"),
        "recall": ("check_release", "cancel"),
        "new_revision": ("revisions", "create"), "edit_revision": ("revisions", "edit"),
        "discard_revision": ("revisions", "delete"),
        "manage_files": ("files", "create"),
        "obsolete": ("obsolete", "cancel"), "reactivate": ("obsolete", "cancel"),
        "comment": ("timeline", "create"),
    },
    "boms": {
        "submit": ("check_release", "submit"), "review": ("check_release", "approve"),
        "approve": ("check_release", "approve"), "recall": ("check_release", "cancel"),
        "new_revision": ("revisions", "create"), "edit_revision": ("revisions", "edit"),
        "discard_revision": ("revisions", "delete"),
        "export": ("explosion", "export"),
        "obsolete": ("obsolete", "cancel"), "reactivate": ("obsolete", "cancel"),
        "comment": ("timeline", "create"),
    },
    # ECR (change request) detail
    "ecr": {
        "impact": ("ecr_impact", "edit"), "vote": ("ecr_vote", "submit"),
        "decide": ("ecr_decision", "approve"), "reopen": ("ecr_decision", "approve"),
        "create_ecn": ("ecr_to_ecn", "create"),
    },
    # ECN (change notice) detail
    "ecn": {
        "edit_effectivity": ("ecn_effectivity", "edit"), "implement": ("ecn_release", "approve"),
        "acknowledge": ("ecn_acknowledge", "submit"),
    },
    "reviews": {
        "edit": ("customer_submissions", "edit"), "delete": ("customer_submissions", "edit"),
        "send": ("customer_submissions", "submit"), "cancel": ("customer_submissions", "cancel"),
        "record_response": ("customer_response", "edit"), "upload_letter": ("customer_response", "edit"),
    },
    "project_work": {
        "revise": ("technical_requirement", "edit"), "acknowledge": ("technical_requirement", "approve"),
        "accept": ("request_progress", "approve"), "start": ("request_progress", "edit"),
        "hold": ("request_progress", "edit"), "resume": ("request_progress", "edit"),
        "complete": ("request_progress", "edit"), "reopen": ("request_progress", "edit"),
        "set_waiting": ("request_progress", "edit"), "cancel": ("request_progress", "cancel"),
        "comment": ("timeline", "create"),
    },
}
_TAB = {"ecr": "change_notices", "ecn": "change_notices"}


def _check_declared() -> None:
    declared = all_permission_ids()
    for key, mapping in ACTION_FEATURES.items():
        for feature, action in mapping.values():
            fid = feature_id("design", _TAB.get(key, key), feature, action)
            assert fid in declared, f"design feature {fid} is not declared in core/features/design.py"


_check_declared()


_DECLARED: set[str] | None = None


def _declared(tab: str, feature: str, action: str) -> None:
    global _DECLARED
    if _DECLARED is None:
        _DECLARED = all_permission_ids()
    fid = feature_id("design", tab, feature, action)
    if fid not in _DECLARED:
        raise RuntimeError(f"Design feature {fid} is not declared in core/features/design.py — declare it there.")


def gated(user, tab: str) -> bool:
    """True when the feature gate applies: the user holds the tab's View."""
    return can_view_tab(user, "design", tab)


def gate_actions(user, key: str, actions: list[str]) -> list[str]:
    """`actions` minus those whose feature the user's roles don't grant
    (unchanged for a user without the tab — see the module docstring)."""
    mapping = ACTION_FEATURES[key]
    tab = _TAB.get(key, key)
    if not gated(user, tab):
        return actions
    return [a for a in actions if a not in mapping or can_feature(user, "design", tab, *mapping[a])]


def has(user, tab: str, feature: str, action: str = "view") -> bool:
    """May `user` see / do this feature? Always True without the tab's View."""
    _declared(tab, feature, action)
    return not gated(user, tab) or can_feature(user, "design", tab, feature, action)


def ensure_design_feature(user, tab: str, feature: str, action: str) -> None:
    """403 (with the real reason) when the user holds the tab but their role
    doesn't grant this feature action; no-op without the tab's View."""
    _declared(tab, feature, action)
    if gated(user, tab):
        ensure_feature_action(user, "design", tab, feature, action)
