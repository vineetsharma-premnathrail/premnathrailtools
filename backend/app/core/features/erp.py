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
    "erp", "projects",
    _feature("technical_specs", "Technical specs & operator", "subtab", {"view": "view"},
             "The Technical Specs tab of a machine: operator details, software version, options and engineering notes."),
    _feature("client_contacts", "Client & site contacts", "section", {"view": "view"},
             "The Client & Site block of a machine's Overview: customer contact names, phones, e-mails, GST and site address."),
    _feature("warranty", "Warranty & AMC", "section", {"view": "view"},
             "The Warranty & AMC block and the warranty status tile of a machine (warranty dates, terms, extended warranty, AMC)."),
    _feature("service_history", "Maintenance history", "subtab", {"view": "view"},
             "The Maintenance History tab of a machine: the service requests raised on it (opening one still needs Service Requests › View)."),
    _feature("production", "Production work orders", "subtab", {"view": "view"},
             "The Production tab of a machine: the production work orders that built it."),
    _feature("documents", "Uploaded documents", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete",
    }, "Uploaded files on a machine (Documents tab): see / open, upload, change who a private file is shared with, delete (own uploads only)."),
    _feature("letters", "Delivery letters & certificates", "action", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "delete", "print": "print",
    }, "Created documents on a machine (cover letter, delivery confirmation, guarantee certificate): see, create, edit, delete (own only), and download / edit in Word."),
    _feature("audit_trail", "Audit trail", "subtab", {"view": "view"},
             "The Audit Trail tab of a machine: who registered, edited, approved or uploaded what, and when."),
)

register_features(
    "erp", "service_requests",
    _feature("rca", "Diagnostics & RCA", "subtab", {"view": "view", "edit": "edit"},
             "The Diagnostics & RCA tab: see the root cause, corrective and preventive actions; edit them (SR creator only)."),
    _feature("materials", "Materials / spares", "subtab", {
        "view": "view", "create": "edit", "edit": "edit", "delete": "edit",
    }, "The Materials tab: see spare lines; add, change, mark received and remove lines and their photos (SR creator only)."),
    _feature("purchase_requisition", "Raise PR from SR", "action", {"view": "view", "create": "edit"},
             "Raise a purchase requisition to Purchase for the SR's spares (and attach its documents) from the Materials tab (SR creator only)."),
    _feature("spare_issue", "Issue / return spares from Store", "action", {
        "view": "view", "create": "view", "edit": "view",
    }, "See Store issues posted against the SR; issue a spare to site (create) and return unused quantity (edit). The user also needs Store › Material Issues › Create."),
    _feature("visits", "Service visits", "subtab", {
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
