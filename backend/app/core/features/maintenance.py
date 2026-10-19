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
             "Acknowledge a breakdown request (approve) or reject it with a reason. Converting it to a work order needs Work Orders › Create."),
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
    _feature("history", "Maintenance history", "section", {"view": "view"},
             "An asset's history of requests and work orders."),
    _feature("readings", "Meter readings & measuring points", "section", {"view": "view", "create": "view", "edit": "edit"},
             "Measuring points and readings of an asset: see them, record a reading (also needs Assets › Edit or Work Orders › Edit), set up / change measuring points (edit)."),
    _feature("spare_parts", "Spare parts list", "section", {"view": "view", "edit": "edit"},
             "The asset's spare parts list (which Store items fit it): see and change it."),
    _feature("documents", "Documents", "section", {"view": "view", "create": "view", "delete": "view"},
             "Files on an asset (manuals, certificates, photos): see / open, upload, delete (uploader only)."),
)

register_features(
    "maintenance", "schedule",
    _feature("default_assignee", "Default technician", "section", {"view": "view", "create": "create", "edit": "edit"},
             "The default technician of a PM plan (its jobs are raised as Assigned to them): set on a new plan (create) or on edit."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("maintenance", "work_orders",
                 ("assign", "Assign technician", "Who this role may assign a maintenance work order to — on a new job, Assign / Reassign, and converting a breakdown request."),
                 ("labour", "Log labour for technician", "Whose time this role may log on a job (Labour › Technician)."))
register_pickers("maintenance", "schedule",
                 ("default_assignee", "Set PM default technician", "Who this role may make the default technician of a PM plan."))
