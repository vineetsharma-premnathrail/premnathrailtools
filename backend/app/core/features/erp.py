"""Service & Commissioning (erp) features (module › tab › feature). See
permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Record-level rules stay on top: SR changes are creator-only
(+ Service Requests › Edit), document deletes are uploader-only, a visit is
logged by its own engineer (others need SR › Edit), issuing a spare also
needs Store › Material Issues › Create, and the invoice needs SR edit rights
or Finance › Sales Invoices › Create."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features
from app.core.reporting.features import management_feature

register_features(
    "erp", "service_requests",
    _feature("rca", "Diagnostics & RCA", "subtab", {"view": "view", "edit": "edit"},
             "The Diagnostics & RCA tab: see the root cause, corrective and preventive actions; edit them (SR creator only)."),
    _feature("materials", "Materials", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "edit",
    }, "The Materials tab: see spare lines; add, change, mark received and remove lines and their photos (SR creator only)."),
    _feature("purchase_requisition", "Raise PR from SR", "action", {"view": "view", "create": "edit"},
             "Raise a purchase requisition to Purchase for the SR's spares (and attach its documents) from the Materials tab (SR creator only)."),
    _feature("spare_issue", "Issue / return spares from Store", "action", {
        "view": "view", "create": "view", "edit": "view",
    }, "See Store issues posted against the SR; issue a spare to site (create) and return unused quantity (edit). The user also needs Store › Material Issues › Create."),
    _feature("visits", "Visits", "subtab", {
        "view": "view", "create": "view", "edit": "view", "delete": "view", "print": "view",
    }, "Engineer visits on an SR: see, log, change, remove and print the field service report. Only the visiting engineer logs their own visit; others need Service Requests › Edit."),
    _feature("invoice", "Warranty & service invoice", "action", {"view": "view", "create": "view"},
             "The Warranty & Invoice card: see the warranty check and the Finance invoice, and raise the service invoice (needs SR edit rights or Finance › Sales Invoices › Create)."),
    _feature("attachments", "Attachments", "subtab", {"view": "view", "create": "edit", "delete": "edit"},
             "The Attachments tab of an SR: see / open files, upload and remove them (SR creator only)."),
    _feature("audit_trail", "Audit trail", "subtab", {"view": "view"},
             "The Audit Trail tab of an SR: every field change, status change and upload with who and when."),
    _feature("charges", "Charges, costs & billing amounts", "sensitive", {"view": "view"},
             "Money on service requests: service / transport / stay / misc charges, tax, total bill, spare prices and costs, "
             "visit expenses and invoice amounts (also the cost charts in Reports). Without it they are blanked and can't be changed."),
)

register_features(
    "erp", "service_contracts",
    _feature("billing_plan", "Billing plan & period invoices", "section", {"view": "view", "create": "edit"},
             "The billing plan of an AMC / CMC: see the billing periods and raise a period's sales invoice into Finance."),
    _feature("renew", "Renew contract", "action", {"view": "view", "create": "create"},
             "Renew an active or expired contract into a new draft for the next term."),
    _feature("service_requests", "Service requests on the contract", "section", {"view": "view"},
             "The list of service requests raised under a contract."),
)

# Reports tab: per-person figures (explicit-only, see core/reporting/features.py).
register_features("erp", "reports", management_feature())

# "Assign to" rules per role (core/assignee_rules.py).
register_pickers("erp", "service_requests",
                 ("visits", "Log visits for",
                  "Which engineers this role may log or plan a service visit for on an SR's Visits tab (their own visits are always allowed)."))

# UI visibility per role (core/visibility.py): what a member of a role sees on
# the New / Edit Service Request form and the Service Requests list. Service
# type and priority values are the coded ones (never retyped); a value a role
# does not allow is also refused by the server (routes/service_requests.py,
# routes/service_request_import.py). "Machine" and "Issue Information" hold
# required fields, so they are locked (always shown). Money stays behind the
# "Charges, costs & billing amounts" switch and is not offered here.
from app.core.priority import PRIORITY_LABELS  # noqa: E402
from app.core.visibility import register_visibility  # noqa: E402
from app.modules.erp.models.service_request import SR_PRIORITIES, SR_SERVICE_TYPE_LABELS  # noqa: E402

register_visibility(
    "erp", "service_requests",
    label="Service Requests — form, page & list",
    screens=(("form", "Service Request form"), ("detail", "Service Request page"), ("list", "Service Requests list")),
    sections=(
        # New / Edit Service Request form
        ("machine", "Machine", "Asset / vehicle (required), request date and site / location.", True, "form"),
        ("issue_information", "Issue Information", "Service type, priority and issue title (required), detailed description.", True, "form"),
        ("reported_by", "Reported By", "Company / client name, phone and e-mail of whoever reported the fault.", False, "form"),
        ("assignment_schedule", "Assignment & Schedule", "Engineer (read-only), expected attend / close dates and the initial status (Open when hidden).", False, "form"),
        ("notes", "Notes", "Free-text notes on the request.", False, "form"),
        ("attachments", "Attachments", "Files uploaded with the request.", False, "form"),
        # Service Request page (dashboard/erp/service-requests/[id]) › Overview tab. Visits, Diagnostics &
        # RCA, Materials, Attachments and Audit Trail are tabs opened by their own features.
        ("detail_summary", "Request summary", "Issue title, description, who reported it and the engineer — the header of the Overview tab.", True, "detail"),
        ("detail_workflow", "Status steps", "The status stepper (Open → … → Closed) used to move the request.", True, "detail"),
        ("detail_machine_site", "Machine & site", "The machine, its customer and site / location.", False, "detail"),
        ("detail_reported_by", "Reported by", "Name, phone and e-mail of whoever reported the fault.", False, "detail"),
        ("detail_assignment_dates", "Assignment & dates", "Engineer, opened, expected attend / close and closed dates.", False, "detail"),
        ("detail_service_notes", "Service notes", "The engineer's report notes.", False, "detail"),
        ("detail_status_card", "Status, Type & Priority card", "Where the status, service type and priority are changed.", True, "detail"),
        ("detail_billing", "Billing card", "Charges and payment status (amounts also need the Charges switch).", False, "detail"),
        ("detail_warranty_invoice", "Warranty & Invoice card", "The warranty check and the service invoice (also behind the Warranty & service invoice feature).", False, "detail"),
    ),
    options=(
        ("service_type", "Service Type", dict(SR_SERVICE_TYPE_LABELS),
         "Why the visit happens (Warranty, AMC, Paid Service …). A value not allowed here is also refused by the server.", "form"),
        ("priority", "Priority", {p: PRIORITY_LABELS[p] for p in SR_PRIORITIES},
         "Standard / Urgent on the service request form.", "form"),
    ),
    tables=(
        ("service_requests", "Service Requests list", {
            "machine_serial": "Machine Serial", "client_site": "Client & Site", "issue_summary": "Issue Summary",
            "priority": "Priority", "opening_date": "Opening Date", "closing_date": "Closing Date", "age": "Age",
            "warranty": "Warranty"}, "list"),
    ),
)
