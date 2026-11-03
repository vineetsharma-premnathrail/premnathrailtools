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
from app.core.visibility import register_visibility
from app.modules.hydraulic.models.system import HYD_SYSTEM_TYPES
from app.modules.hydraulic.models.testing import HYD_TEST_TYPES


def _documents(what: str) -> tuple:
    return _feature("documents", "Documents", "section", {"view": "view", "create": "edit", "delete": "edit"},
                    f"The {what} documents panel: see / open the files, upload (create) and delete them.")


register_features(
    "hydraulic", "systems",
    _documents("system"),
    _feature("owner", "System owner", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the Owner picker of a system (new system, hand-over). Setting it still needs Create / Edit on Systems."),
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
    _feature("tester", "Tester", "picker", {"view": "view"},
             "Only carries the role's 'Assign to' rule for the Tested by picker of a test (planning it, changing the tester while it's open). Setting it still needs Create / Edit on Testing."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("hydraulic", "systems",
                 ("owner", "Set owner to", "Who this role may name as a hydraulic / pneumatic system's owner, when creating or editing it."))
register_pickers("hydraulic", "testing",
                 ("tester", "Assign tester", "Who this role may name as the tester of a planned or open test (Tested by)."))


# UI visibility per role (core/visibility.py): what a member of a role sees on
# the Systems and Testing & Inspection screens. System type / test type values
# are the coded ones (never retyped); a value a role does not allow is also
# refused by the server (routes/systems.py, routes/testing.py). Sections that
# hold a required field are locked. Number / status / result columns and the
# BOM costs are never offered here.
def _words(value: str) -> str:
    """'pressure_test' -> 'Pressure Test', 'cleanliness_test' -> 'Cleanliness Test'."""
    return " ".join(w.upper() if w == "iso" else w.capitalize() for w in value.split("_"))


register_visibility(
    "hydraulic", "systems",
    label="Systems — form, page & list",
    screens=(("form", "New System form"), ("detail", "System page"), ("list", "Systems list")),
    sections=(
        # New / Edit System form (components/hydraulic/SystemForm)
        ("system", "System", "Type, name, application and status.", True, "form"),
        ("project_ownership", "Project & Ownership", "Project / unit, ERP project, loco / machine serial, plant and owner.", False, "form"),
        ("design_parameters", "Design Parameters", "Pressures, flow, reservoir, power, fluid, filtration, cleanliness and temperatures.", False, "form"),
        ("description", "Description", "Free-text description of the system.", False, "form"),
        ("remarks", "Remarks", "Free-text remarks on the system.", False, "form"),
        # System page (dashboard/hydraulic/systems/[id])
        ("detail_summary", "System summary", "Number, name, type, status and owner.", True, "detail"),
        ("detail_where_used", "Where it is used", "Application, project, ERP project, plant and loco / machine serial.", False, "detail"),
        ("detail_parameters", "Design parameters", "Pressures, flow, reservoir, power, fluid, filtration, cleanliness and temperatures.", False, "detail"),
        ("detail_remarks", "Remarks", "The system's remarks.", False, "detail"),
        ("detail_circuits", "Circuits", "The circuit drawings of this system.", False, "detail"),
        ("detail_boms", "Bills of Material", "The BOMs of this system (costs stay behind Prices & costs).", False, "detail"),
        ("detail_tests", "Tests", "The tests recorded on this system.", False, "detail"),
        ("detail_documents", "System Documents",
         "The documents panel. Access is still set by the Documents feature; this only hides the panel on screen.", False, "detail"),
    ),
    options=(
        ("system_type", "Type", {v: v.capitalize() for v in HYD_SYSTEM_TYPES},
         "Hydraulic / Pneumatic on the New System form (the type can't change later). A value not allowed here is also refused by the server.", "form"),
    ),
    tables=(
        ("systems", "Systems list", {"type": "Type", "application": "Application", "project": "Project",
                                     "working_pressure": "Working Pressure"}, "list"),
    ),
)

register_visibility(
    "hydraulic", "testing",
    label="Testing & Inspection — form, page & list",
    screens=(("form", "New Test form"), ("detail", "Test page"), ("list", "Tests list")),
    sections=(
        # New / Edit Test form (components/hydraulic/TestForm)
        ("test", "Test", "Title, test type, medium and test date.", True, "form"),
        ("subject", "What Is Tested", "The system and / or component under test and its serial number.", True, "form"),
        ("conditions", "Conditions", "Test standard, pressure, hold time, medium and temperatures.", False, "form"),
        ("people", "People", "Tested by and witnessed by.", False, "form"),
        ("readings", "Readings", "The reading rows (parameter, limits, measured value, result).", False, "form"),
        ("notes", "Notes", "Observations and remarks.", False, "form"),
        # Test page (dashboard/hydraulic/testing/[id]), the read-only record of a completed test
        ("detail_summary", "Test summary", "Number, title, status, result, type, medium and date.", True, "detail"),
        ("detail_subject", "What was tested", "Component serial number and test standard.", False, "detail"),
        ("detail_conditions", "Test conditions", "Pressure, hold time, medium and temperatures.", False, "detail"),
        ("detail_people", "People", "Tested by, witnessed by and completed by.", False, "detail"),
        ("detail_notes", "Notes", "Observations and remarks.", False, "detail"),
        ("detail_readings", "Readings", "The readings table with limits, measured values and results.", False, "detail"),
        ("detail_documents", "Test Certificates & Reports",
         "The documents panel. Access is still set by the Documents feature; this only hides the panel on screen.", False, "detail"),
    ),
    options=(
        ("test_type", "Test Type", {v: _words(v) for v in HYD_TEST_TYPES},
         "The test types a member may plan or record. A value not allowed here is also refused by the server. "
         "A re-test keeps the type of the test it repeats.", "form"),
        ("system_type", "Medium", {v: v.capitalize() for v in HYD_SYSTEM_TYPES},
         "Hydraulic / Pneumatic on the New Test form (the medium follows the system once saved).", "form"),
    ),
    tables=(
        ("tests", "Tests list", {"test_type": "Test Type", "subject": "Subject", "date": "Date",
                                 "test_pressure": "Test Pressure", "failed_readings": "Failed Readings"}, "list"),
    ),
)
