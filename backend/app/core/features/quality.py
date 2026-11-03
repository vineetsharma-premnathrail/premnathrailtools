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
    _feature("assign", "Assign inspector", "picker", {"view": "view", "create": "create", "edit": "edit"},
             "Pick the inspector of a lot: when raising a manual lot (create) and assign / reassign it later (edit)."),
    _feature("photos", "Photos", "section", {"view": "view", "create": "edit", "delete": "edit"},
             "The lot's photo evidence: see, add (create) and remove (delete) photos."),
)

register_features(
    "quality", "capa",
    _feature("owner", "CAPA owner", "picker", {"view": "view", "create": "create", "edit": "edit"},
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
    _feature("calibration", "Gauges tab", "subtab", {"view": "view", "create": "edit"},
             "Shows the Gauges tab (next to Masters) with each gauge's calibration history, and lets the role record a calibration (create)."),
)

register_features(
    "quality", "complaints",
    _feature("owner", "Complaint owner", "picker", {"view": "view", "create": "create", "edit": "edit"},
             "The owner investigating a customer complaint: set on a new complaint (create), on edit or when starting the investigation (edit)."),
    _feature("costs", "Cost of the complaint", "sensitive", {"view": "view"},
             "Replacement / travel / rework / other cost and the total of a customer complaint. "
             "Editing the costs needs Complaints › Edit and this switch. " + _COSTS_HINT),
)

register_features(
    "quality", "supplier_quality",
    _feature("audits", "Vendor audits", "subtab", {"view": "view", "create": "create", "edit": "edit"},
             "The Vendor audits sub-tab of Supplier Quality: see it, schedule an audit with its auditor (create) and record the result (edit)."),
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

# ---------------------------------------------------------------------------
# UI visibility per role (core/visibility.py): what a member of a role sees on
# the Quality forms, record pages and lists. Only CODED dropdowns are offered
# (severity, CAPA type, complaint source, manual lot type) — never the
# Settings master lists (NCR sources, defect codes, agencies, complaint
# categories), which are data. A value a role does not allow is also refused
# by the server (routes/ncr.py, capa.py, complaints.py, inspection_lots.py,
# inspection_calls.py). Sections that hold a required field, and the workflow
# blocks a record needs to move on (disposition, results, decision …), are
# locked. Money (NCR cost of non-quality, complaint cost) is never offered
# here: it stays behind the "costs" sensitive switch above.
# ---------------------------------------------------------------------------
from app.core.visibility import register_visibility
from app.modules.quality.models.capa import QUALITY_CAPA_ACTION_TYPES
from app.modules.quality.models.customer_complaint import QUALITY_COMPLAINT_SEVERITIES, QUALITY_COMPLAINT_SOURCE_LABELS
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPE_LABELS
from app.modules.quality.models.ncr import QUALITY_NCR_SEVERITIES

SEVERITY_LABELS = {v: v.capitalize() for v in QUALITY_NCR_SEVERITIES}
COMPLAINT_SEVERITY_LABELS = {v: v.capitalize() for v in QUALITY_COMPLAINT_SEVERITIES}
CAPA_ACTION_TYPE_LABELS = {v: v.capitalize() for v in QUALITY_CAPA_ACTION_TYPES}
# Lots a person raises by hand (routes/inspection_lots.py refuses incoming and
# first-article: the GRN and the FAI record create those).
QUALITY_MANUAL_LOT_TYPES = ("stock_reinspection", "sales_return", "in_process", "job_work", "final", "third_party")
MANUAL_LOT_TYPE_LABELS = {t: QUALITY_INSPECTION_TYPE_LABELS[t] for t in QUALITY_MANUAL_LOT_TYPES}

_APPROVAL_HINT = "Hiding it only removes the card; approvers still decide from My Approvals."

register_visibility(
    "quality", "ncr",
    label="Non-Conformance (NCR) — form, page & list",
    screens=(("form", "Raise NCR form"), ("detail", "NCR page"), ("list", "NCR list")),
    sections=(
        ("non_conformance", "Non-conformance", "Source, severity, item, quantity, defect and the description (required).", True, "form"),
        ("stock", "Stock", "Block the quantity in a store while the NCR is open.", False, "form"),
        ("detail_summary", "NCR summary", "Number, item, description, status, severity, quantity and who raised it.", True, "detail"),
        ("detail_origin", "Where it came from", "Source, reference document, inspection lot, vendor and batch.", False, "detail"),
        ("detail_defect_stock", "Defect & stock", "Defect code, blocked stock and root cause (the estimated value stays behind the Cost switch).", False, "detail"),
        ("detail_capa", "CAPA links", "The CAPAs raised against this NCR.", False, "detail"),
        ("detail_disposition", "Disposition", "The proposed disposition and the Propose button — the NCR can't move on without it.", True, "detail"),
        ("detail_approval", "Disposition approval", "The approval card of the proposed disposition. " + _APPROVAL_HINT, False, "detail"),
        ("detail_deviation_doc", "Deviation approval document", "The concession record generated for use-as-is / repair dispositions.", False, "detail"),
        ("detail_action", "Action", "Recording that the disposition was carried out.", True, "detail"),
        ("detail_verification", "Verification", "Verifying the action.", True, "detail"),
        ("detail_closure", "Closure", "Closing the NCR (cost of non-quality stays behind the Cost switch).", True, "detail"),
    ),
    options=(
        ("severity", "Severity", SEVERITY_LABELS, "Minor / Major / Critical on the Raise NCR form. Auto-raised NCRs keep the severity the inspection gives them, "
         "so NCRs raised automatically are not limited by this list.", "form"),
    ),
    tables=(
        ("ncrs", "NCR list", {"item": "Item", "qty": "Qty", "severity": "Severity", "source": "Source",
                              "disposition": "Disposition", "ncr_date": "NCR date"}, "list"),
    ),
)

register_visibility(
    "quality", "inspection_lots",
    label="Inspection Lots — form, page & list",
    screens=(("form", "New Manual Lot form"), ("detail", "Inspection lot page"), ("list", "Inspection lots list")),
    sections=(
        ("lot", "Lot", "Inspection type, item (required), quantity (required), batch, vendor, reference and project.", True, "form"),
        ("stock", "Stock", "Hold stock in Quality and the store it comes from (required while Hold stock is ticked).", True, "form"),
        ("remarks", "Remarks", "Free-text remarks on the lot.", False, "form"),
        ("detail_summary", "Lot summary", "Number, item, quantity, inspection type, source, status and lot date.", True, "detail"),
        ("detail_material", "Material", "Vendor, batch / serial and where the stock is held.", False, "detail"),
        ("detail_inspection", "Inspection", "Inspection plan, sample size, first article and production gate links.", False, "detail"),
        ("detail_controls", "Sampling, inspector & actions", "Sampling state, inspector, test certificate and the Start / Close / Cancel buttons.", True, "detail"),
        ("detail_results", "Results", "The characteristics grid where results are recorded and submitted.", True, "detail"),
        ("detail_photos", "Photos", "Photo evidence. Access is still set by the Photos feature; this only hides the block on screen.", False, "detail"),
        ("detail_usage_decision", "Usage decision", "The Record usage decision step.", True, "detail"),
        ("detail_decision", "Decision", "The recorded decision, quantities and the NCRs it raised.", False, "detail"),
        ("detail_documents", "Documents", "Inspection report and test certificate documents.", False, "detail"),
    ),
    options=(
        ("inspection_type", "Inspection type", MANUAL_LOT_TYPE_LABELS,
         "The kinds of lot this role may raise by hand. Incoming lots come from the GRN and first articles from the FAI record, so they are not listed.", "form"),
    ),
    tables=(
        ("lots", "Inspection lots list", {"item": "Item", "qty": "Qty", "type": "Type", "source": "Source",
                                          "assigned": "Assigned", "age": "Age", "decision": "Decision"}, "list"),
        ("detail_results", "Results grid on the lot page",
         {"classification": "Class", "spec": "Spec", "sample": "Sample n / Ac / Re", "gauge": "Gauge", "remarks": "Remarks"}, "detail"),
    ),
)

register_visibility(
    "quality", "inspection_calls",
    label="Customer / Third-party Inspection Calls — form, page & list",
    screens=(("form", "New Inspection Call form"), ("detail", "Inspection call page"), ("list", "Inspection calls list")),
    sections=(
        ("order", "Order", "Project unit, ERP machine / order or the customer order reference (one is required) and the customer.", True, "form"),
        ("material", "Material offered", "Item (required), quantity (required), batch and our final inspection lot.", True, "form"),
        ("call", "Call", "Agency (required), dates and the inspector.", True, "form"),
        ("remarks", "Remarks", "Free-text remarks on the call.", False, "form"),
        ("detail_summary", "Call summary", "Number, item, quantity, agency, status, dates and the Schedule / Cancel buttons.", True, "detail"),
        ("detail_order", "Order", "Order reference, machine / contract, customer and sales order.", False, "detail"),
        ("detail_inspection", "Inspection", "Agency, inspector, batch, our final lot and remarks.", False, "detail"),
        ("detail_result", "Result", "The recorded result and the Record result step.", True, "detail"),
        ("detail_certificate", "Agency certificate", "The certificate file attached to the call.", False, "detail"),
    ),
    tables=(
        ("calls", "Inspection calls list", {"agency": "Agency", "order": "Order / contract", "item": "Item", "qty": "Qty",
                                            "call_date": "Call date", "inspector": "Inspector", "certificate": "Certificate"}, "list"),
    ),
)

register_visibility(
    "quality", "capa",
    label="CAPA (8D) — form, page & list",
    screens=(("form", "New CAPA form"), ("detail", "CAPA page"), ("list", "CAPA list")),
    sections=(
        ("problem", "Problem", "Title (required), type, severity, item, defect, vendor, audit reference and the D2 description.", True, "form"),
        ("owner", "D1 — Owner", "CAPA owner (champion) and target date.", False, "form"),
        ("linked_ncrs", "Linked NCRs", "NCRs linked when the CAPA is raised.", False, "form"),
        ("detail_summary", "CAPA summary", "Number, title, status, severity, owner, dates and the 8D step bar.", True, "detail"),
        ("detail_concerns", "What it concerns", "Item, vendor, defect, audit reference and the customer complaint.", False, "detail"),
        ("detail_approval", "D8 approval", "The D8 effectiveness approval card. " + _APPROVAL_HINT, False, "detail"),
        ("detail_team", "D1 — Team", "Owner and the 8D team. Access is still set by the D1 — Team feature; this only hides the block on screen.", False, "detail"),
        ("detail_problem", "D2 — Problem & linked NCRs", "The problem statement and NCR links (part of Save D2–D4).", True, "detail"),
        ("detail_containment", "D3 — Containment", "Containment actions.", False, "detail"),
        ("detail_root_cause", "D4 — Root cause", "Method, why-why / fishbone, root cause and the Save / mark root cause found buttons.", True, "detail"),
        ("detail_actions", "D5 / D7 — Actions", "Corrective / preventive actions, D6 evidence and the Start / All done buttons.", True, "detail"),
        ("detail_effectiveness", "D8 — Effectiveness & closure", "The effectiveness verdict, closure and reopen.", True, "detail"),
        ("detail_report", "8D report", "The generated 8D report document.", False, "detail"),
    ),
    options=(
        ("action_type", "Type", CAPA_ACTION_TYPE_LABELS, "Corrective / Preventive on the New CAPA form.", "form"),
        ("severity", "Severity", SEVERITY_LABELS, "Minor / Major / Critical on the New CAPA form. Auto-raised CAPAs keep the NCR's severity.", "form"),
    ),
    tables=(
        ("capas", "CAPA list", {"title": "Title", "raised_for": "Raised for", "severity": "Severity", "owner": "Owner",
                                "open_actions": "Open actions", "opened": "Opened"}, "list"),
    ),
)

register_visibility(
    "quality", "complaints",
    label="Customer Complaints — form, page & list",
    screens=(("form", "Log Complaint form"), ("detail", "Complaint page"), ("list", "Complaints list")),
    sections=(
        ("origin", "Where it came from", "Source, reference, date, machine / order, customer (required) and contact.", True, "form"),
        ("failure", "What failed", "Item, serial / batch, quantity, category, defect, severity and the description (required).", True, "form"),
        ("photos", "Photos", "Photos uploaded with the complaint.", False, "form"),
        ("detail_summary", "Complaint summary", "Number, customer, description, status, severity, owner, dates and the Start investigation / Not valid buttons.", True, "detail"),
        ("detail_customer", "Customer", "Contact person, machine / order and how it came in.", False, "detail"),
        ("detail_failed", "What failed", "Item, serial / batch, quantity, category, defect and the repeat link.", False, "detail"),
        ("detail_photos", "Photos", "The complaint's photos and Add photos.", False, "detail"),
        ("detail_approval", "Close / reject approval", "The close / reject approval card. " + _APPROVAL_HINT, False, "detail"),
        ("detail_investigation", "Investigation", "The NCR and CAPA raised for the complaint.", False, "detail"),
        ("detail_traceability", "Traceability & containment", "Same-batch stock, deliveries, inspection history and the containment notes.", False, "detail"),
        ("detail_response", "Customer response", "Recording the response sent and the customer's acceptance.", True, "detail"),
        ("detail_closure", "Closure", "Closing the complaint (cost stays behind the Cost switch).", True, "detail"),
    ),
    options=(
        ("source", "Source", dict(QUALITY_COMPLAINT_SOURCE_LABELS), "How the complaint came in, on the Log Complaint form.", "form"),
        ("severity", "Severity", COMPLAINT_SEVERITY_LABELS, "Minor / Major / Critical on the Log Complaint form.", "form"),
    ),
    tables=(
        ("complaints", "Complaints list", {"customer": "Customer", "item": "Item / serial-batch", "severity": "Severity",
                                           "ncr_capa": "NCR / CAPA", "response": "Response", "date": "Date"}, "list"),
    ),
)
