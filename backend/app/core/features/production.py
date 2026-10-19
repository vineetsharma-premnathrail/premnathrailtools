"""Production features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Costs are a sensitive switch per tab (the framework keeps features under a
tab, and a Work Orders-only role must keep seeing work-order costing without
the BOM tab): bom / work_orders / rrv_builds / reports each carry "costs"."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

_COSTS_HINT = ("Standard / actual costs, unit costs, order values and variances. Without it the figures are "
               "blanked on screen and in the API — quantities, routing and status stay visible.")

register_features(
    "production", "bom",
    _feature("routing", "Routing", "section", {"view": "view"},
             "The routing operations block of a BOM (sequence, workstation / vendor, hours, quality gates, instructions)."),
    _feature("design_link", "Design BOM link", "section", {"view": "view", "create": "create"},
             "Compare a Production BOM with its Design BOM revision (view) and take a released Design BOM revision "
             "into a draft Production BOM / refresh from Design (create)."),
    _feature("discipline_merge", "Electrical & hydraulic merge", "action", {"view": "view", "create": "edit", "delete": "edit"},
             "See the electrical / hydraulic BOMs merged into a BOM, merge another one into a draft (create) and take a merge back out (delete)."),
    _feature("explosion", "Multi-level explosion", "section", {"view": "view"},
             "The indented explosion through every sub-assembly's own BOM, with cumulative quantities."),
    _feature("lifecycle", "Activate, obsolete & new versions", "action", {
        "view": "view", "submit": "edit", "approve": "approve", "create": "create",
    }, "Submit a draft BOM for activation (submit), activate it directly / mark an active BOM obsolete (approve) "
       "and start a new version (create). The BOM-activation approval workflow still decides who approves."),
    _feature("costs", "BOM costs", "sensitive", {"view": "view"}, _COSTS_HINT),
)

register_features(
    "production", "work_orders",
    _feature("materials", "Materials", "subtab", {"view": "view", "create": "edit", "edit": "edit"},
             "The Materials sub-tab: see the material requirement, issue from Store / top up the reservation (create) "
             "and return unused material (edit)."),
    _feature("operations", "Operations", "subtab", {"view": "view"},
             "The Operations sub-tab of a work order. Starting / completing operations is Shop Floor › Run operations."),
    _feature("output", "Output & stock", "subtab", {"view": "view", "create": "edit"},
             "The Output & Stock sub-tab: Store ledger movements of the order (view) and receiving finished goods into Store (create)."),
    _feature("time_logs", "Time logs", "subtab", {"view": "view"},
             "The Time Logs sub-tab: hours booked against the order's operations."),
    _feature("sub_orders", "Sub-assembly orders", "section", {"view": "view", "create": "create"},
             "The dependent-orders block: see the sub-assembly work orders of an order and raise them from its BOM (create)."),
    _feature("release", "Release to shop floor", "action", {"view": "view", "submit": "edit", "approve": "approve"},
             "Submit a draft work order for release (submit) or release it directly as a work-order approver (approve)."),
    _feature("lifecycle", "Complete, close & cancel", "action", {"view": "view", "approve": "approve", "cancel": "approve"},
             "Complete and close a work order (approve) and cancel a released one (cancel)."),
    _feature("job_card", "Job card", "action", {"view": "view", "print": "print"},
             "Print the work order's job card (PDF)."),
    _feature("supervisor", "Supervisor", "section", {"view": "view", "create": "create", "edit": "edit"},
             "The supervisor of a work order: see who it is, set one on a new order (create — also when converting a "
             "planned order) and change it (edit)."),
    _feature("costs", "Work-order costing", "sensitive", {"view": "view"},
             "The Costing sub-tab and the order values on stock movements. " + _COSTS_HINT),
)

register_features(
    "production", "shop_floor",
    _feature("run_operations", "Run operations", "action", {"view": "view", "edit": "edit"},
             "Start and complete work-order operations, book time against them and request the Quality gate inspection "
             "(from the Shop Floor board and the work order's Operations sub-tab)."),
    _feature("job_work", "Link job-work challan", "action", {"view": "view", "edit": "edit"},
             "Link a Store job-work challan to an external (subcontracted) operation."),
)

register_features(
    "production", "rrv_builds",
    _feature("build_manager", "Build manager", "section", {"view": "view", "create": "create", "edit": "edit"},
             "The build manager of an RRV build: see who it is, pick one on a new build (create) and change it (edit)."),
    _feature("stages", "Stage plan", "section", {"view": "view", "edit": "edit"},
             "The stage plan of a build: see each stage's assignee and planned dates, change them (edit)."),
    _feature("work_orders", "Work orders & consumption", "subtab", {"view": "view", "edit": "edit"},
             "The Work Orders sub-tab of a build: linked work orders and material consumption (view); link / unlink work orders (edit)."),
    _feature("tests", "Tests", "subtab", {"view": "view", "create": "edit", "delete": "edit"},
             "The Tests sub-tab: required tests and test history (view), record a test (create), remove a recorded test (delete)."),
    _feature("rework", "Rework", "subtab", {"view": "view", "create": "edit", "edit": "edit", "approve": "edit", "reject": "edit", "cancel": "edit"},
             "The Rework sub-tab: raise rework (create), start / mark it done (edit), verify it (approve) or reject the "
             "verification (reject), cancel it (cancel — still only the build manager / a production manager)."),
    _feature("handover", "Handover", "subtab", {"view": "view", "edit": "edit", "print": "print"},
             "The Handover sub-tab: handover details (edit) and the handover certificate — PDF (print), Word document (edit)."),
    _feature("timeline", "Timeline", "subtab", {"view": "view"},
             "The Timeline sub-tab: every event recorded on the build."),
    _feature("costs", "Consumption values", "sensitive", {"view": "view"},
             "Unit costs and consumed values in the build's material consumption. " + _COSTS_HINT),
)

register_features(
    "production", "planning",
    _feature("mrp_run", "Run MRP", "action", {"view": "view", "edit": "edit"},
             "Run material requirements planning (MRP) for a horizon."),
    _feature("planned_orders", "Planned orders", "action", {"view": "view", "create": "create", "edit": "edit", "delete": "edit"},
             "Add a manual planned order (create), change / firm one (edit) and delete one (delete)."),
    _feature("convert_wo", "Convert to work order", "action", {"view": "view", "create": "edit"},
             "Turn a planned production order into a draft work order (also needs Work Orders › Create)."),
    _feature("convert_pr", "Convert to purchase requisition", "action", {"view": "view", "create": "edit"},
             "Turn planned purchase orders into a purchase requisition (also needs Procurement › Purchase Requisitions › Create)."),
)

register_features(
    "production", "reports",
    _feature("costs", "Cost & WIP reports", "sensitive", {"view": "view"},
             "The work-order cost / variance table and the WIP valuation. Without it only output, scrap and utilisation show."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("production", "work_orders",
                 ("supervisor", "Set work-order supervisor", "Who this role may make the supervisor of a work order — on create, edit and when converting a planned order."))
register_pickers("production", "shop_floor",
                 ("run_operations", "Book time for operator", "Whose hours this role may book on an operation (Shop Floor › Log time — the Operator field)."))
register_pickers("production", "rrv_builds",
                 ("build_manager", "Set build manager", "Who this role may make the build manager of an RRV build, on a new build or when editing one."),
                 ("stages", "Assign build stages to", "Who this role may assign a build stage to (the stage plan of an RRV build)."),
                 ("rework", "Assign rework to", "Who this role may give a rework order to — raised on the Rework tab or from a failed test."))
