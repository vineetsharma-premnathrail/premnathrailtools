"""Quality features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Quality's own authority checks (services/access.py —
Quality engineer = ncr:edit, head = ncr:approve, can_decide_lot …) and the
approval engine still apply: a feature is an extra role-level gate on top."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

_COSTS_HINT = "Without it the amounts are blanked on screen and in the API."

register_features(
    "quality", "ncr",
    _feature("disposition", "Disposition", "action", {"view": "view", "submit": "edit", "approve": "view", "reject": "view"},
             "Propose a disposition (submit — a Quality engineer / head) and sign / reject a pending disposition approval "
             "(approve / reject — only the approver roles the NCR asks for: engineer, head, Design, Purchase, Partner)."),
    _feature("action_verify", "Action & verification", "action", {"view": "view", "edit": "edit"},
             "Record that the disposition action was carried out and verify the NCR (a Quality engineer / head)."),
    _feature("closure", "Close & cancel", "action", {"view": "view", "approve": "approve", "cancel": "approve"},
             "Close an NCR with its cost of non-quality (approve) and cancel an NCR (cancel) — a Quality head."),
    _feature("costs", "Cost of non-quality", "sensitive", {"view": "view"},
             "The NCR's estimated value and material / rework / other cost of non-quality. " + _COSTS_HINT),
)

register_features(
    "quality", "inspection_lots",
    _feature("results", "Inspection results", "action", {"view": "view", "edit": "edit", "submit": "edit"},
             "Record results characteristic by characteristic (edit) and submit them for the usage decision (submit)."),
    _feature("usage_decision", "Usage decision", "action", {"view": "view", "approve": "approve"},
             "Take the usage decision on a lot (accept / reject / partial / deviation) — releases or blocks the stock."),
    _feature("assign", "Assign inspector", "action", {"view": "view", "create": "create", "edit": "edit"},
             "Pick the inspector of a lot: when raising a manual lot (create) and assign / reassign it later (edit)."),
    _feature("photos", "Photos", "section", {"view": "view", "create": "edit", "delete": "edit"},
             "The lot's photo evidence: see, add (create) and remove (delete) photos."),
)

register_features(
    "quality", "capa",
    _feature("owner", "CAPA owner", "section", {"view": "view", "create": "create", "edit": "edit"},
             "The owner (champion) of a CAPA: pick one on a new CAPA (create) and change it (edit)."),
    _feature("team", "D1 — Team", "section", {"view": "view", "edit": "edit"},
             "The 8D team block: see and change the CAPA team."),
    _feature("actions", "D5 / D7 — Actions", "section", {"view": "view", "create": "edit", "cancel": "edit"},
             "Corrective / preventive actions: add an action (create) and cancel one (cancel). The action owner marks it done."),
    _feature("effectiveness", "D8 — Effectiveness & closure", "action", {"view": "view", "approve": "approve"},
             "Record the D8 effectiveness verdict (closes or reopens the 8D) and reopen a closed CAPA — a Quality head."),
)

register_features(
    "quality", "first_article",
    _feature("decision", "First-article decision", "action", {"view": "view", "approve": "approve", "reject": "approve"},
             "Approve or reject a first article — releases the item / revision / vendor for regular supply."),
)

register_features(
    "quality", "masters",
    _feature("calibration", "Gauge calibration", "action", {"view": "view", "create": "edit"},
             "See a gauge's calibration history and record a calibration (create)."),
)

register_features(
    "quality", "complaints",
    _feature("owner", "Complaint owner", "section", {"view": "view", "create": "create", "edit": "edit"},
             "The owner investigating a customer complaint: set on a new complaint (create), on edit or when starting the investigation (edit)."),
    _feature("costs", "Cost of the complaint", "sensitive", {"view": "view"},
             "Replacement / travel / rework / other cost and the total of a customer complaint. "
             "Editing the costs needs Complaints › Edit and this switch. " + _COSTS_HINT),
)

register_features(
    "quality", "supplier_quality",
    _feature("audits", "Vendor audits", "section", {"view": "view", "create": "create", "edit": "edit"},
             "Vendor audits: see them, schedule one with its auditor (create) and record the result (edit)."),
)

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("quality", "inspection_lots",
                 ("assign", "Assign inspector", "Who this role may make the inspector of a lot — on a manual lot or when assigning / reassigning it."))
register_pickers("quality", "capa",
                 ("owner", "Set CAPA owner", "Who this role may make the owner of a CAPA, on a new CAPA or when changing the owner."),
                 ("team", "Add CAPA team members", "Who this role may add to a CAPA's D1 8D team."),
                 ("actions", "Set CAPA action owner", "Who this role may give a D5 / D7 corrective or preventive action to."))
register_pickers("quality", "complaints",
                 ("owner", "Set complaint owner", "Who this role may make the owner of a customer complaint — on create, edit or Start investigation."))
register_pickers("quality", "supplier_quality",
                 ("audits", "Assign vendor auditor", "Who this role may pick as the auditor when scheduling a vendor audit."))
