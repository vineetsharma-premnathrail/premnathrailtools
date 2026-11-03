"""HR & Administration features (module › tab › feature). See
permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had. Payroll lives in ADP — there is no salary or bank data in
the portal; the sensitive switch is the statutory identity numbers."""
from app.core.assignee_rules import register_pickers
from app.core.permission_registry import _feature, register_features
from app.core.visibility import VISIBILITY, register_visibility
from app.modules.hr.models.employee_profile import ATTENDANCE_POLICIES, WORKER_TYPES
from app.modules.hr.models.leave import LEAVE_SESSIONS
from app.modules.hr.services.workforce_rules import FORM_EMPLOYMENT_TYPES, SECTIONS as WORKFORCE_SECTIONS

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
    _feature("time_evaluation", "Time evaluation page", "subtab", {"view": "view"},
             "The Time evaluation & overtime page (link on Attendance): worked hours per employee and month and the "
             "overtime requests. Its ADP export needs Attendance › Export, raising overtime needs Attendance › Edit. "
             "Each employee's own time view (My HR) is not affected."),
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
    _feature("investigation", "Investigation", "picker", {"view": "view"},
             "Carries only the 'Investigation lead' assign-to rule: who this role may make the lead when starting or "
             "re-assigning an incident's investigation (that itself needs Safety › Edit)."),
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

# UI visibility per role (core/visibility.py): what a member of a role sees on the
# Add / Edit Employee form and the Employees list, and on the leave screens.
# Section keys are the workforce form's own section keys
# (services/workforce_rules.SECTIONS); dropdown values are the coded ones (never
# retyped) and a value a role does not allow is also refused by the server
# (routes/employees.py, routes/leave.py). Sections that hold a field the rule
# table can make required are locked (always shown). Hiding is on screen only —
# statutory IDs and personal data are blanked by the "Statutory IDs" / "Personal
# details" features, not here.
_ON_SCREEN = " Hiding is on screen only; the data stays on the record."
register_visibility(
    "hr", "employees",
    label="Employees — form, page & list",
    screens=(("form", "Add / Edit Employee form"), ("detail", "Employee page"), ("list", "Employees list")),
    sections=(
        # Add / Edit Employee form (components/hr/employee/EmployeeProfileForm.tsx)
        ("classification", WORKFORCE_SECTIONS["classification"], "Workforce ID, name, worker category, employment type, designation, status, joining date.", True, "form"),
        ("organization", WORKFORCE_SECTIONS["organization"], "Plant, department, grade, manager, probation, contract dates, shift, attendance policy.", True, "form"),
        ("personal", WORKFORCE_SECTIONS["personal"], "Mobile, personal email, date of birth, addresses, emergency contact — required for workshop and contract staff.", True, "form"),
        ("access", WORKFORCE_SECTIONS["access"], "Portal access, work email and application role of a record without an account.", True, "form"),
        ("contractor", WORKFORCE_SECTIONS["contractor"], "Contractor company and worker details — required for contract labour.", True, "form"),
        ("statutory_ids", "Statutory IDs (PAN, Aadhaar, UAN, ESIC)",
         "The PAN / Aadhaar / UAN / ESIC row inside Statutory & Compliance." + _ON_SCREEN
         + " To blank the numbers for a role, use the 'Statutory IDs' feature switch instead.", False, "form"),
        ("compliance", WORKFORCE_SECTIONS["compliance"], "Safety induction and medical clearance — required for shop-floor staff.", True, "form"),
        ("documents", WORKFORCE_SECTIONS["documents"], "The joining-documents checklist on the form (the record's Documents sub-tab still shows them)." + _ON_SCREEN, False, "form"),
        ("exit", WORKFORCE_SECTIONS["exit"], "Last working day and exit reason — required once the status is Exited.", True, "form"),
        ("admin", WORKFORCE_SECTIONS["admin"], "HR remarks and the 'HR owns department / designation / manager / plant' switch." + _ON_SCREEN, False, "form"),
        # Employee page (dashboard/hr/employees/[id], Profile tab). The 'Personal details' / 'Statutory IDs' /
        # 'HR remarks' features still decide who gets the data at all; this only hides a block on screen.
        ("detail_header", "Employee header", "Name, status, designation · department · plant, workforce ID, joining date and manager.", True, "detail"),
        ("detail_employment", "Employment", "Worker category, employment type, grade, work location, shift, probation, contract period.", True, "detail"),
        ("detail_exit", "Exit", "Last working day, exit reason and clearance (shown once the person has left)." + _ON_SCREEN, False, "detail"),
        ("detail_attendance", "Attendance setup", "Attendance policy, weekly off and overtime eligibility." + _ON_SCREEN, False, "detail"),
        ("detail_contractor", "Contractor", "Contractor company, worker ID, contact, agreement and verification." + _ON_SCREEN, False, "detail"),
        ("detail_personal", "Contact & personal details", "Work and personal contact, date of birth, addresses." + _ON_SCREEN
         + " Access is still set by the 'Personal details' feature.", False, "detail"),
        ("detail_emergency", "Emergency contact", "Emergency contact name, relationship and phone." + _ON_SCREEN, False, "detail"),
        ("detail_compliance", "Statutory IDs & compliance", "PAN, Aadhaar (last 4), UAN, ESIC, safety induction and medical clearance." + _ON_SCREEN
         + " Access to the numbers is still set by the 'Statutory IDs' feature.", False, "detail"),
        ("detail_hr_notes", "HR notes & account", "Portal account, org-field ownership, HR remarks, created / updated." + _ON_SCREEN, False, "detail"),
    ),
    options=(
        ("worker_type", "Worker Category", dict(WORKER_TYPES),
         "Who the person is to the company. A category not allowed here is also refused by the server.", "form"),
        ("employment_type", "Employment Type", dict(FORM_EMPLOYMENT_TYPES),
         "Terms of employment offered on the form (older records may hold Intern / Consultant).", "form"),
        ("attendance_policy", "Attendance Policy", dict(ATTENDANCE_POLICIES),
         "How the person's attendance is captured.", "form"),
    ),
    tables=(
        ("employees", "Employees list", {"department": "Department", "designation": "Designation", "plant": "Plant",
                                         "manager": "Manager", "joined": "Joined"}, "list"),
    ),
)

register_visibility(
    "hr", "leave",
    label="Leave — apply form & lists",
    screens=(("form", "Apply for leave form"), ("list", "Leave lists (requests, balances)")),
    sections=(
        ("employee", "Employee", "Who the leave is applied for (HR 'apply on behalf').", True, "form"),
        ("leave", "Leave", "Leave type, dates and half-day sessions.", True, "form"),
        ("details", "Details", "Reason (required) and contact during leave.", True, "form"),
        ("days_balance", "Days & Balance", "The live day count, balance and approver shown next to the form; policy errors still show in the form's error banner.", False, "form"),
        ("document", "Supporting Document", "Medical certificate and the like — required by some leave types after N days.", True, "form"),
    ),
    options=(
        ("session", "Half-day session", {"full": "Full day", "first_half": "First half", "second_half": "Second half"},
         "Sessions a role may pick for the first and last day. Keep 'Full day' allowed, or no multi-day leave could be applied.", "form"),
    ),
    tables=(
        ("requests", "Leave requests list", {"leave": "Leave (type & reason)", "days": "Days", "approver": "Approver / decision"}, "list"),
        ("balances", "Leave balances list", {"carried": "Carried", "allotted": "Allotted", "adjusted": "Adjusted",
                                             "used": "Used", "pending": "Pending"}, "list"),
    ),
)
assert set(VISIBILITY["hr:leave"]["options"]["session"]["values"]) == set(LEAVE_SESSIONS), "hr leave: session values drifted from LEAVE_SESSIONS"
