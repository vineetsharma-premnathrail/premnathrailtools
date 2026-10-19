"""Hydraulic & Pneumatic features (module › tab › feature). See
permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Documents (system / component / circuit / test files) were open to every
Hydraulic user for viewing and needed the parent tab's Edit to add or
remove; the per-tab Documents features keep that. Someone without the
parent tab's View (who can't open that page anyway) keeps today's read-only
access to its files. The cost switch lives on the BOM tab but blanks costs
everywhere in the module (BOMs, Component Master, component lookups,
retired service records / spares, dashboard) for people who hold BOM › View
without it; people without BOM › View keep seeing the costs they saw before."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features


def _documents(what: str) -> tuple:
    return _feature("documents", "Documents", "subtab", {"view": "view", "create": "edit", "delete": "edit"},
                    f"The {what} documents panel: see / open the files, upload (create) and delete them.")


register_features(
    "hydraulic", "systems",
    _documents("system"),
    _feature("owner", "System owner", "action", {"view": "view", "create": "create", "edit": "edit"},
             "Name the engineer who owns a system when creating it (create) and hand it over to another owner (edit)."),
)

register_features("hydraulic", "components", _documents("component (datasheets & drawings)"))

register_features(
    "hydraulic", "circuits",
    _documents("circuit drawing"),
    _feature("revisions", "Revision history", "section", {"view": "view", "create": "edit"},
             "The circuit's revision history block, and raising a new revision of an approved circuit (create)."),
    _feature("submit_review", "Submit for review", "action", {"view": "view", "submit": "edit"},
             "Send a draft circuit to the circuit approvers for review."),
)

register_features(
    "hydraulic", "bom",
    _feature("revise", "Raise new revision", "action", {"view": "view", "create": "edit"},
             "Copy a released BOM into its next revision as a new draft."),
    _feature("costs", "Prices & costs", "sensitive", {"view": "view"},
             "Unit costs, line costs and BOM totals across Hydraulic & Pneumatic (BOMs, Component Master, service records, spares). "
             "Without it the amounts are blanked, and a component's unit cost can't be entered or changed."),
)

register_features(
    "hydraulic", "testing",
    _documents("test certificate & report"),
    _feature("retest", "Raise re-test", "action", {"view": "view", "create": "create"},
             "Raise a re-test from a completed test."),
    _feature("tester", "Tester", "action", {"view": "view", "create": "create", "edit": "edit"},
             "Name who carries out a test when planning it (create) and change the tester while it's open (edit)."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("hydraulic", "systems",
                 ("owner", "Set owner to", "Who this role may name as a hydraulic / pneumatic system's owner, when creating or editing it."))
register_pickers("hydraulic", "testing",
                 ("tester", "Assign tester", "Who this role may name as the tester of a planned or open test (Tested by)."))
