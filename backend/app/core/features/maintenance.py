"""Maintenance features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record-level rules stay on top: a permit is accepted by the
job's assignee (others need Work Orders › Edit) and never by its issuer, a
file is deleted only by its uploader, a reading needs Assets › Edit or
Work Orders › Edit, issuing a spare also needs Store › Material Issues ›
Create, and close-out may go through the approval engine."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

register_features(
    "maintenance", "requests",
    _feature("triage", "Acknowledge / reject requests", "action", {"view": "view", "approve": "edit", "reject": "edit"},
             "Acknowledge a breakdown request (approve) or reject it with a reason. Converting it to a work order needs Work Orders › Create. "
             "Requests › Edit only carries this (and older roles inherit it from there)."),
)

register_features(
    "maintenance", "work_orders",
    _feature("assign", "Assign technician", "action", {"view": "view", "edit": "edit"},
             "Assign or reassign the technician of a work order."),
    _feature("checklist", "Checklist", "section", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "The job checklist: see it, add checks, record results and remove lines."),
    _feature("spares", "Spares", "section", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "Spares on a job: see them, plan / issue from Store (create), return unused (edit), remove a planned line. Issuing also needs Store › Material Issues › Create."),
    _feature("labour", "Labour", "section", {"view": "view", "create": "edit", "delete": "edit"},
             "Labour on a job: see time logged, log time, delete an entry."),
    _feature("permits", "Work permits (PTW / LOTO)", "section", {
        "view": "view", "create": "approve", "approve": "view", "edit": "edit", "cancel": "approve", "print": "view",
    }, "Permits to work: see, issue (create), accept at site (approve — the job's assignee, others need Work Orders › Edit), close (edit), cancel, and print / edit the permit document."),
    _feature("purchase", "Outside purchase (PR)", "section", {"view": "view", "create": "edit"},
             "Purchase requisitions raised from a job for parts or outside service: see them and raise a new PR."),
    _feature("documents", "Service reports & photos", "section", {"view": "view", "create": "view", "delete": "view"},
             "Files on a work order: see / open, upload, delete (uploader only)."),
    _feature("close_out", "Verify, close, reopen & cancel", "action", {
        "view": "view", "approve": "approve", "reject": "reject", "edit": "approve", "cancel": "approve",
    }, "Close-out authority on a work order: verify & close (approve) or send back (reject) the close-out, reopen a completed job (edit), cancel a job."),
    _feature("costs", "Maintenance costs", "sensitive", {"view": "view"},
             "Money on work orders and assets: spare costs, labour rates and cost, outside-service cost, job totals and an asset's total maintenance cost. "
             "Without it they are blanked and can't be entered."),
)

register_features(
    "maintenance", "assets",
    # Tabs of the asset page (dashboard/maintenance/assets/[id]).
    _feature("history", "History", "subtab", {"view": "view"},
             "The History tab of an asset: its requests and work orders."),
    _feature("pm_plans", "PM Plans tab", "subtab", {"view": "view"},
             "The PM Plans tab of an asset: the preventive maintenance plans on it. Opening / adding a plan still needs PM Schedule."),
    _feature("spare_parts", "Spares", "subtab", {"view": "view", "edit": "edit"},
             "The Spares tab of an asset (its bill of spares — which Store items fit it): see and change it."),
    _feature("readings", "Counters & Readings", "subtab", {"view": "view", "create": "view", "edit": "edit"},
             "The Counters & Readings tab of an asset: see measuring points and readings, record a reading (also needs Assets › Edit or "
             "Work Orders › Edit), set up / change measuring points (edit)."),
    _feature("documents", "Documents", "subtab", {"view": "view", "create": "view", "delete": "view"},
             "The Documents tab of an asset (manuals, certificates, photos): see / open, upload, delete (uploader only)."),
    # The AMC & Warranty nav tab used to ride on Assets › View / Export (matrix cleanup 2026-11-03).
    _feature("contracts", "AMC & Warranty tab", "subtab", {"view": "view", "export": "export"},
             "The AMC & Warranty page: AMC contracts and warranties of every asset with their expiry (view) and its Excel download (export)."),
)

register_features(
    "maintenance", "schedule",
    _feature("default_assignee", "Default technician", "picker", {"view": "view", "create": "create", "edit": "edit"},
             "Carries the 'Set PM default technician' Assign-to rule: whom this role may make the default technician of a PM plan "
             "(its jobs are raised as Assigned to them)."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("maintenance", "work_orders",
                 ("assign", "Assign technician", "Who this role may assign a maintenance work order to — on a new job, Assign / Reassign, and converting a breakdown request."),
                 ("labour", "Log labour for technician", "Whose time this role may log on a job (Labour › Technician)."))
register_pickers("maintenance", "schedule",
                 ("default_assignee", "Set PM default technician", "Who this role may make the default technician of a PM plan."))

# UI visibility per role (core/visibility.py): what a member of a role sees on the
# Report-a-Problem form, the request page and the requests list, and on the New Work
# Order form, the work order page and the work orders list. Coded values come from the
# model tuples (the labels below are asserted against them, never retyped loosely); a
# value a role does not allow is also refused by the server (routes/requests.py,
# routes/work_orders.py). Sections that hold a required field are locked. Money
# (costs) is not offered here: it stays behind the "Maintenance costs" switch.
from app.core.priority import PRIORITY_LABELS  # noqa: E402
from app.core.visibility import register_visibility  # noqa: E402
from app.modules.maintenance.models.request import MAINTENANCE_REQUEST_TYPES  # noqa: E402
from app.modules.maintenance.models.work_order import MAINTENANCE_FAILURE_CATEGORIES, MAINTENANCE_WO_TYPES  # noqa: E402

MAINTENANCE_REQUEST_TYPE_LABELS = {
    "breakdown": "Breakdown", "abnormality": "Abnormality (still running)", "improvement": "Improvement", "safety": "Safety",
}
MAINTENANCE_WO_TYPE_LABELS = {
    "breakdown": "Breakdown", "preventive": "Preventive", "corrective": "Corrective", "calibration": "Calibration",
    "improvement": "Improvement", "inspection": "Inspection",
}
MAINTENANCE_FAILURE_CATEGORY_LABELS = {
    "mechanical": "Mechanical", "electrical": "Electrical", "hydraulic": "Hydraulic", "pneumatic": "Pneumatic",
    "lubrication": "Lubrication", "electronic_control": "Electronic / Control", "wear_and_tear": "Wear & Tear",
    "operator_error": "Operator Error", "external": "External (power, supply…)", "other": "Other",
}
# The label maps must name exactly the coded values (a new value in the model needs a label here).
assert tuple(MAINTENANCE_REQUEST_TYPE_LABELS) == MAINTENANCE_REQUEST_TYPES
assert tuple(MAINTENANCE_WO_TYPE_LABELS) == MAINTENANCE_WO_TYPES
assert tuple(MAINTENANCE_FAILURE_CATEGORY_LABELS) == MAINTENANCE_FAILURE_CATEGORIES

register_visibility(
    "maintenance", "requests",
    label="Maintenance Requests — form, page & list",
    screens=(("form", "Report a Problem form"), ("detail", "Request page"), ("list", "Requests list")),
    sections=(
        # Report a Problem form (dashboard/maintenance/requests/new)
        ("machine", "Machine", "The machine / equipment with the problem and the 'Machine is stopped' switch.", True, "form"),
        ("problem", "Problem", "Type, when it happened, priority and what is wrong.", True, "form"),
        ("photos", "Photos", "Photos of the fault attached while raising the request.", False, "form"),
        # Request page (dashboard/maintenance/requests/[id])
        ("detail_summary", "Request summary", "Number, status, type, machine, problem text, priority, when and who raised it.", True, "detail"),
        ("detail_problem", "Problem details", "Asset, criticality, plant, type, who acknowledged it and any rejection reason.", False, "detail"),
        ("detail_work_order", "Work order", "The work order raised from the request: technician, downtime, root cause, action taken, confirmation.", False, "detail"),
        ("detail_files", "Photos & Files", "Files attached to the request.", False, "detail"),
    ),
    options=(
        ("request_type", "Type", MAINTENANCE_REQUEST_TYPE_LABELS,
         "Breakdown / Abnormality / Improvement / Safety. A value not allowed here is also refused by the server.", "form"),
        ("priority", "Priority", dict(PRIORITY_LABELS),
         "Standard / Urgent. With a restriction the form no longer offers 'Auto (from criticality)': the requester picks an allowed value.", "form"),
    ),
    tables=(
        ("requests", "Requests list", {"asset": "Asset", "type": "Type", "problem": "Problem", "priority": "Priority",
                                       "reported": "Reported", "raised_by": "Raised By", "work_order": "Work Order"}, "list"),
    ),
)

register_visibility(
    "maintenance", "work_orders",
    label="Work Orders — form, page & list",
    screens=(("form", "New Work Order form"), ("detail", "Work order page"), ("list", "Work orders list")),
    sections=(
        # New Work Order form (dashboard/maintenance/work-orders/new)
        ("job", "Job", "Asset, type, priority, title, instructions and the machine-down switch.", True, "form"),
        ("planning", "Planning", "Technician, planned start / end and estimated hours.", False, "form"),
        ("checklist", "Checklist", "Checklist lines typed while creating the job.", False, "form"),
        # Work order page (dashboard/maintenance/work-orders/[id])
        ("detail_summary", "Job summary", "Number, status, title, instructions, priority, type, technician and downtime.", True, "detail"),
        ("detail_asset_source", "Asset & Source", "The asset, its plant and the request / PM plan the job came from.", False, "detail"),
        ("detail_schedule", "Schedule & Time", "Planned dates, estimated hours, start / finish and downtime.", False, "detail"),
        ("detail_failure_analysis", "Failure Analysis", "Failure category, root cause and action taken (shown once recorded).", False, "detail"),
        ("detail_checklist", "Checklist",
         "The job checklist card. Access is still set by the Checklist feature; this only hides the card on screen.", False, "detail"),
        ("detail_spares", "Spares",
         "The spares card. Access is still set by the Spares feature; this only hides the card on screen.", False, "detail"),
        ("detail_labour", "Labour",
         "The labour card. Access is still set by the Labour feature; this only hides the card on screen.", False, "detail"),
        ("detail_documents", "Service Reports & Photos",
         "Files on the job. Access is still set by the Service reports & photos feature; this only hides the card on screen.", False, "detail"),
    ),
    options=(
        ("wo_type", "Type", MAINTENANCE_WO_TYPE_LABELS,
         "Work order type on the New Work Order form and when a request is turned into a job. Jobs raised by PM plans keep the plan's type.", "form"),
        ("priority", "Priority", dict(PRIORITY_LABELS), "Standard / Urgent on the New Work Order form and the Create Work Order popup.", "form"),
        ("failure_category", "Failure Category", MAINTENANCE_FAILURE_CATEGORY_LABELS,
         "Failure category entered when a job is completed or its details are edited.", "detail"),
    ),
    tables=(
        ("work_orders", "Work orders list", {"asset": "Asset", "title": "Title", "type": "Type", "priority": "Priority",
                                             "technician": "Technician", "planned": "Planned", "downtime": "Downtime"}, "list"),
    ),
)
