"""Production features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

Costs are a sensitive switch per tab (the framework keeps features under a
tab, and a Work Orders-only role must keep seeing work-order costing without
the BOM tab): bom / work_orders / rrv_builds / reports each carry "costs"."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features
from app.core.priority import PRIORITY_LABELS
from app.core.visibility import register_visibility
from app.modules.production.models.bom import PRODUCTION_BOM_ITEM_CATEGORIES, PRODUCTION_CONFIRMATION_TYPES, PRODUCTION_CONTROL_KEYS
from app.modules.production.models.mrp import PLANNED_ORDER_PROCUREMENT

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
    _feature("supervisor", "Supervisor", "picker", {"view": "view", "create": "create", "edit": "edit"},
             "Carries the 'Set work-order supervisor' Assign-to rule: whom this role may make the supervisor of a work order "
             "(on a new order — also when converting a planned order — and on edit)."),
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
    _feature("build_manager", "Build manager", "picker", {"view": "view", "create": "create", "edit": "edit"},
             "Carries the 'Set build manager' Assign-to rule: whom this role may make the build manager of an RRV build "
             "(on a new build and on edit)."),
    # The Stages tab is the build page's home tab (always shown); this row only carries its Assign-to rule.
    _feature("stages", "Stages", "picker", {"view": "view", "edit": "edit"},
             "Carries the 'Assign build stages to' Assign-to rule: whom this role may assign a stage of an RRV build to. "
             "The Stages tab itself always shows on a build."),
    _feature("work_orders", "Work Orders & Material", "subtab", {"view": "view", "edit": "edit"},
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

# UI visibility per role (core/visibility.py): what a member of a role sees on
# the Production screens. Coded dropdown values are the module's own constants
# (never retyped); a value a role does not allow is also refused by the server
# (routes/work_orders.py, routes/boms.py, routes/mrp.py). Sections that hold a
# field needed to save the record are locked (always shown). Money columns are
# not offered here: they stay behind each tab's "costs" switch.
_BOM_CATEGORY_LABELS = {"stock": "Stock", "non_stock": "Non-stock", "text": "Text", "document": "Document"}
_CONTROL_KEY_LABELS = {"internal": "Internal", "external": "External (job work)"}
_CONFIRMATION_LABELS = {"required": "Required", "optional": "Optional", "none": "None (milestone)"}
_PROCUREMENT_LABELS = {"make": "Make", "buy": "Buy"}
assert set(_BOM_CATEGORY_LABELS) == set(PRODUCTION_BOM_ITEM_CATEGORIES)
assert set(_CONTROL_KEY_LABELS) == set(PRODUCTION_CONTROL_KEYS)
assert set(_CONFIRMATION_LABELS) == set(PRODUCTION_CONFIRMATION_TYPES)
assert set(_PROCUREMENT_LABELS) == set(PLANNED_ORDER_PROCUREMENT)

register_visibility(
    "production", "work_orders",
    label="Work Orders — form, page & list",
    screens=(("form", "New Work Order form"), ("detail", "Work order page"), ("list", "Work orders list")),
    sections=(
        # New Work Order form (dashboard/production/work-orders/new)
        ("what_to_build", "What to Build", "Product / active BOM, quantity and priority.", True, "form"),
        ("built_for", "Built For", "Machine / project, plant, sales order line and project unit.", False, "form"),
        ("schedule_responsibility", "Schedule & Responsibility", "Planned start / end dates and the supervisor.", False, "form"),
        ("store_locations", "Store Locations",
         "Issue-from and receive-into stores. Both are still needed before release — they can be set on the work order page.", False, "form"),
        ("remarks", "Remarks", "Free-text remarks on the order.", False, "form"),
        ("bom_preview", "BOM preview", "The components and operations the order will get, shown once a BOM is picked.", False, "form"),
        # Work order page (dashboard/production/work-orders/[id]) — the record card. The sub-tabs (Materials,
        # Operations, Output, Time logs, Costing) stay with their feature grants.
        ("detail_summary", "Order summary", "Product, quantity, BOM, machine, status, priority, dates and supervisor.", True, "detail"),
        ("detail_progress", "Progress", "Output received, scrapped quantity and actual start / end.", False, "detail"),
        ("detail_linked", "Linked records", "RRV build, sales order, project unit, parent / child orders.", False, "detail"),
        ("detail_store_locations", "Store locations", "Issue-from and receive-into stores of the order.", False, "detail"),
        ("detail_other", "Other details", "Plant, remarks and cancel reason.", False, "detail"),
    ),
    options=(
        ("priority", "Priority", dict(PRIORITY_LABELS),
         "Standard / Urgent on a new work order and when editing one. A value not allowed here is also refused by the server; "
         "sub-assembly orders inherit the parent's priority, so a restricted role can't raise them from a parent it may not pick.",
         "form"),
    ),
    tables=(
        ("work_orders", "Work orders list", {"project": "Machine / Project", "qty": "Qty", "progress": "Progress",
                                             "priority": "Priority", "planned_end": "Planned End"}, "list"),
        ("detail_materials", "Material requirement (Materials sub-tab)",
         {"issued": "Issued", "returned": "Returned", "reserved": "Reserved", "free": "Free"}, "detail"),
        ("detail_operations", "Routing operations (Operations sub-tab)",
         {"workstation": "Workstation", "hours": "Hours (actual / plan)", "good": "Good", "scrap": "Scrap", "quality": "Quality"}, "detail"),
    ),
)

register_visibility(
    "production", "bom",
    label="BOM & Routing — form, page & list",
    screens=(("form", "BOM form"), ("detail", "BOM page"), ("list", "BOM list")),
    sections=(
        # New / Edit BOM form (components/production/BomForm.tsx)
        ("product", "Product", "The product (Store item) and base quantity.", True, "form"),
        ("validity_change", "Validity & Change", "Valid from / to dates and the change number.", False, "form"),
        ("notes", "Notes", "Description and remarks.", False, "form"),
        ("components", "Components", "The component lines (category, item, quantity, scrap).", True, "form"),
        ("routing", "Routing Operations",
         "The routing operations block. A BOM saves without operations, but a work order needs at least one before release.", False, "form"),
        # BOM page (dashboard/production/bom/[id]). The Design link, discipline merges and explosion blocks
        # stay with their feature grants.
        ("detail_summary", "BOM summary", "Product, description, status, version, validity and work-order count.", True, "detail"),
        ("detail_quantity_change", "Quantity & change control", "Base quantity, change number and effectivity.", False, "detail"),
        ("detail_record", "Record", "Created by, activation and remarks.", False, "detail"),
        ("detail_components", "Components", "The component lines of the BOM.", True, "detail"),
        ("detail_routing", "Routing",
         "The routing operations. Who may see them is still set by the Routing feature; this only hides the block on screen.",
         False, "detail"),
    ),
    options=(
        ("item_category", "Component category", _BOM_CATEGORY_LABELS,
         "Stock / Non-stock / Text / Document on each component line. A category not allowed here is also refused by the server, "
         "on new lines and on lines whose category changed; 'Transfer from Design' is refused when it would bring in a category the role can't pick.",
         "form"),
        ("control_key", "Control key", _CONTROL_KEY_LABELS,
         "Internal / External (job work) on each routing operation; checked by the server on new and changed operations.", "form"),
        ("confirmation", "Confirmation", _CONFIRMATION_LABELS,
         "Required / Optional / None (milestone) on each routing operation; checked by the server on new and changed operations.", "form"),
    ),
    tables=(
        ("boms", "BOM list", {"version": "Version", "components": "Components", "operations": "Operations",
                              "work_orders": "Work Orders"}, "list"),
        ("detail_components", "Component lines on the BOM page",
         {"category": "Category", "uom": "UOM", "make_buy": "Make / Buy", "scrap": "Scrap %", "remarks": "Remarks"}, "detail"),
        ("detail_routing", "Routing operations on the BOM page",
         {"control_key": "Control key", "workstation": "Workstation / Vendor", "setup": "Setup hrs", "run": "Run hrs / unit",
          "confirmation": "Confirmation", "quality_gate": "Quality Gate", "print": "Print", "instructions": "Instructions"}, "detail"),
    ),
)

register_visibility(
    "production", "planning",
    label="Planning & MRP — pages & form",
    screens=(("planning", "Production Planning page"), ("mrp", "MRP & Planned Orders page"), ("form", "New planned order form")),
    sections=(
        # Production Planning page (dashboard/production/planning)
        ("material_requirements", "Material Requirements vs Stock", "Outstanding component demand of open work orders against Store stock.", False, "planning"),
        ("workstation_load", "Workstation Load", "Remaining planned hours per workstation.", False, "planning"),
        ("schedule", "Schedule", "Open work orders on their planned dates.", False, "planning"),
        # MRP & Planned Orders page (dashboard/production/planning/mrp)
        ("mrp_run", "MRP Run", "Plant, horizon and the Run MRP button. Running MRP is still the Run MRP feature; this only hides the block.", False, "mrp"),
        ("planned_orders", "Planned Orders", "The planned orders table and its actions.", True, "mrp"),
        ("mrp_list", "MRP List", "Level-by-level netting result of the last run.", False, "mrp"),
        ("exceptions", "Exceptions", "Exception messages of the last run.", False, "mrp"),
        ("run_log", "Run Log", "Every MRP run with its log.", False, "mrp"),
        # New planned order form (popup on the MRP page)
        ("item_quantity", "Item & Quantity", "Item, quantity, needed-by date and procurement.", True, "form"),
        ("form_remarks", "Remarks", "Free-text remarks on the planned order.", False, "form"),
    ),
    options=(
        ("procurement", "Procurement", _PROCUREMENT_LABELS,
         "Make / Buy on a manual planned order. 'From BOM' decides it from the item's active BOM, and the server refuses the "
         "result when the role may not pick it. MRP runs plan both kinds.", "form"),
    ),
    tables=(
        ("requirements", "Material requirements table",
         {"reserved": "Reserved", "free_stock": "Free Stock", "reorder_level": "Reorder Level", "for_work_orders": "For Work Orders"}, "planning"),
        ("planned_orders", "Planned orders table",
         {"type": "Type", "start": "Start", "finish": "Finish", "pegged": "For (pegged demand)"}, "mrp"),
        ("mrp_list", "MRP list table",
         {"level": "Level", "safety": "Safety", "receipts": "Receipts", "planned": "Planned"}, "mrp"),
    ),
)
