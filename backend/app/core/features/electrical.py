"""Electrical features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had.

The RRV electrical job page opens for anyone with Electrical access (data
scope still applies). These features only narrow it for people who hold
Electrical › RRV Electrical Jobs › View; someone reaching a job from another
Electrical tab (Testing, Troubleshooting, Drawings, Purchase) without Jobs ›
View keeps today's read-only view of it. Tests, Troubleshooting, Drawings and
the BOM's PR link also stay open through their own tabs' grants, as before."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

register_features(
    "electrical", "jobs",
    _feature("lead_engineer", "Lead engineer", "action", {"view": "view", "create": "create", "edit": "edit"},
             "Name a job's lead engineer when creating it (create) and hand the job over to another lead engineer (edit)."),
    _feature("stages", "Stages", "subtab", {"view": "view", "edit": "edit"},
             "The Stages sub-tab of a job: see the stage list, and plan / start / complete / mark not applicable / reopen stages."),
    _feature("requirement", "Electrical requirement", "section", {"view": "view", "edit": "edit"},
             "The Electrical Requirement block (system voltage, battery, alternator, standards, customer spec, requirement notes): see it and change it."),
    _feature("bom", "BOM", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "edit", "submit": "submit", "approve": "approve",
    }, "The BOM sub-tab: see, add, change and delete BOM lines, submit a component selection for approval and approve it directly. "
       "Purchase Requirements editors can still link a PR to a line."),
    _feature("panels", "Panels", "subtab", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "The Panels sub-tab: see, add, change (incl. assembly status) and delete the job's panels."),
    _feature("cables", "Cables", "subtab", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "The Cables sub-tab: see the cable schedule, add, change, bulk-update status and delete cables."),
    _feature("drawings", "Drawings", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "edit", "submit": "edit",
    }, "The Drawings sub-tab: see drawings, add drawings and revisions, upload files, submit revisions for approval, discard / delete. "
       "Approving needs Electrical › Drawings › Approve; Drawings › View also shows them."),
    _feature("tests", "Tests", "subtab", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "The Tests sub-tab: see, record, change and delete factory / commissioning tests. Electrical › Testing grants also allow it."),
    _feature("issues", "Troubleshooting", "subtab", {"view": "view", "create": "edit", "edit": "edit", "delete": "edit"},
             "The Troubleshooting sub-tab: see, raise, change, resolve / close / reopen and delete issues. Electrical › Troubleshooting grants also allow it."),
    _feature("handover", "QC & Handover", "subtab", {"view": "view", "edit": "edit", "submit": "edit"},
             "The QC & Handover sub-tab: see it, save commissioning / handover details, and request the final QC inspection in Quality (submit)."),
    _feature("documents", "Documents", "subtab", {"view": "view", "create": "edit", "delete": "edit"},
             "The Documents sub-tab: see and open job documents, upload (create) and delete them."),
    _feature("job_status", "Hold, resume, cancel & close", "action", {"view": "view", "edit": "edit", "cancel": "edit"},
             "Put a job on hold, resume it and close it (edit), and cancel it (cancel)."),
    _feature("costs", "BOM costs", "sensitive", {"view": "view"},
             "Estimated unit costs of BOM lines and the job's BOM cost total (job page and Purchase Requirements). "
             "Without it the costs are blanked and can't be entered or changed."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("electrical", "jobs",
                 ("lead_engineer", "Assign lead engineer", "Who this role may make lead engineer of an RRV electrical job, when creating or editing it."),
                 ("stages", "Assign stages to", "Who this role may make owner of a job stage on the Stages sub-tab."),
                 ("issues", "Assign issues to", "Who this role may assign a troubleshooting issue to, when logging or editing it."))
