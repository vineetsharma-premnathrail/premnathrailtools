"""HR & Administration features (module › tab › feature). See
permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Payroll lives in ADP — there is no salary or bank data in
the portal; the sensitive switch is the statutory identity numbers."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features

register_features(
    "hr", "employees",
    _feature("personal", "Personal details & contact", "section", {"view": "view", "create": "create", "edit": "edit"},
             "Gender, date of birth, blood group, marital status, personal email / phone, addresses and emergency contact on an "
             "employee record. Without 'view' these are blanked; without 'create' / 'edit' they can't be filled in when creating / editing a profile (left unchanged)."),
    _feature("statutory_ids", "Statutory IDs (PAN, Aadhaar, UAN, ESIC)", "sensitive", {"view": "view", "create": "create", "edit": "edit"},
             "PAN, the last 4 digits of Aadhaar, UAN (PF) and ESIC number. Without 'view' they are blanked in every employee "
             "record the role opens; without 'create' / 'edit' they can't be filled in when creating / editing a profile (left unchanged)."),
    _feature("hr_notes", "HR remarks", "section", {"view": "view"},
             "The internal HR remarks on an employee record (never shown to the employee). Without it they are hidden and "
             "a profile save leaves them unchanged."),
    _feature("assignment", "Assignment history", "subtab", {"view": "view", "create": "edit", "cancel": "edit"},
             "The dated org-assignment history (department, designation, grade, plant, cost center, manager): see it, "
             "record a dated change (transfer / promotion) and withdraw a future change."),
    _feature("documents", "Documents", "subtab", {
        "view": "view", "create": "edit", "approve": "edit", "delete": "delete", "export": "view",
    }, "Employee documents (joining papers, statutory and identity copies): list, upload, verify / reject, delete "
       "(only your own uploads) and download."),
    _feature("lifecycle", "Lifecycle sub-tab", "subtab", {"view": "view"},
             "The employee's joining / confirmation / transfer / exit events on the employee record."),
    _feature("leave", "Leave sub-tab", "subtab", {"view": "view"},
             "The employee's leave balances and requests on the employee record."),
    _feature("attendance", "Attendance sub-tab", "subtab", {"view": "view"},
             "The employee's monthly attendance calendar on the employee record."),
    _feature("assets", "Assets sub-tab", "subtab", {"view": "view"},
             "Company assets issued to / returned by the employee, on the employee record."),
)

register_features(
    "hr", "leave",
    _feature("balance_admin", "Allot & adjust leave balances", "action", {"view": "view", "create": "edit", "edit": "edit"},
             "Yearly allotment of leave balances (create) and manual credit / debit adjustments of one balance (edit)."),
)

register_features(
    "hr", "attendance",
    _feature("roster", "Shift roster", "subtab", {"view": "view", "edit": "edit", "import": "import"},
             "The shift roster grid: see it, set shifts / weekly offs and generate from a pattern (edit), import a roster CSV (import)."),
    _feature("punches", "Biometric punches", "subtab", {"view": "view", "import": "import"},
             "Raw biometric punch log: see punches, import a punch file and evaluate punches into attendance (import)."),
    _feature("periods", "Payroll periods", "subtab", {"view": "view", "create": "export", "cancel": "view", "export": "export"},
             "Lock a month's attendance for the ADP payroll cut-off (create), unlock it (cancel — Partners only, with a reason) "
             "and download the ADP export of a locked month (export)."),
)

register_features(
    "hr", "travel",
    _feature("complete_trip", "Mark trip completed", "action", {"view": "view", "edit": "edit"},
             "Close an approved travel request once the trip is over."),
    _feature("claim_payment", "Record claim payment", "action", {"view": "view", "edit": "edit"},
             "Mark an approved expense claim as paid (date, mode, reference). Nobody can mark their own claim paid."),
)

register_features(
    "hr", "visitors",
    _feature("gate_desk", "Gate check-in / check-out", "action", {"view": "view", "edit": "edit"},
             "Check a visitor in at the gate (ID verified, pass issued) and check them out when they leave."),
)

register_features(
    "hr", "safety",
    _feature("investigation", "Investigation", "section", {"view": "view"},
             "The Investigation block of an incident (lead, root cause, contributing factors). Starting / re-assigning "
             "the investigation still needs Safety › Edit; this row carries the 'Investigation lead' assign-to rule."),
    _feature("capa", "CAPA actions", "action", {"view": "view", "create": "edit", "edit": "edit", "cancel": "edit"},
             "Add, change and cancel corrective / preventive actions on an incident. The incident's investigation lead "
             "always can; an action's owner can always mark their own action done."),
    _feature("statutory", "Statutory reporting (Form 18)", "section", {"view": "view", "edit": "edit", "print": "print"},
             "The statutory block of an incident (reportable flag, Form 18 / authority intimation details): see it, "
             "fill it in (edit) and print the Form 18 PDF."),
)

register_features(
    "hr", "lifecycle",
    _feature("checklist", "Manage checklist items", "action", {"view": "view", "edit": "edit"},
             "Add, change (owner, due date, status) and remove checklist items on a lifecycle event as HR. A task owner "
             "can always tick off their own item."),
)

register_pickers("hr", "safety",
                 ("investigation", "Investigation lead", "Who this role may pick to lead a safety incident's investigation (Start / re-assign investigation)."),
                 ("capa", "CAPA action owner", "Who this role may give a corrective / preventive action on a safety incident to, or move it to."))
register_pickers("hr", "lifecycle",
                 ("checklist", "Checklist task owner", "Who this role may make owner of an onboarding / transfer / exit checklist item, or reassign it to."))
