"""Dynamic workforce form — field rules (SAP "screen modification" for the HR
master, coded instead of admin-configured).

One form serves office staff, factory / workshop labour, housekeeping and
contract labour. Which fields show and which are mandatory depends on the
record itself (worker category, employment type, status, probation status,
portal access), so the rules live here once:

- the frontend fetches them (GET /hr/employees/form-rules) and shows / stars
  fields live as HR fills the form;
- the backend enforces them on save (services/employees.finalize_record), so
  an API caller can't skip a mandatory field.

Worker category, employment type, designation, employment status and
probation status are five separate fields — each answers one question.

Each field documents why it exists, which process consumes it and who may
edit it, so the form explains itself (hint text) and an auditor can trace
every input to its use.

A condition is a list of clauses; a clause is {field: [allowed values]} and
matches when every field in it has one of its values. The condition is true
when ANY clause matches. None = always. Pseudo-fields in the context:
`has_login` (the record is linked to a portal account).

Required levels:
- required: blocks a normal save (a draft may skip it);
- complete: never blocks, but leaves the record "Incomplete" until filled —
  for paperwork that legitimately arrives after joining.
"""
from __future__ import annotations

from datetime import date

from app.modules.hr.models.employee_profile import (
    ATTENDANCE_POLICIES, CLEARANCE_STATUSES, EMPLOYMENT_STATUSES, PROBATION_STATUSES, VERIFICATION_STATUSES, WORKER_TYPES,
)

NON_OFFICE = ["factory", "housekeeping", "contract", "other"]
SHOP_FLOOR = ["factory", "housekeeping", "contract"]
DIRECT = ["office", "factory", "housekeeping", "other"]   # on our own rolls
NO_LOGIN = {"has_login": [False]}
PORTAL = {"has_login": [False], "portal_access": [True]}
CONTRACT_PERIOD = [{"employment_type": ["fixed_term", "contract"]}, {"worker_type": ["contract"]}]
CONTRACTOR = [{"worker_type": ["contract", "housekeeping", "other"]}]

# Employment types the form offers (older records may also hold intern / consultant).
FORM_EMPLOYMENT_TYPES = {"permanent": "Permanent", "fixed_term": "Fixed-term", "contract": "Contractual", "trainee": "Trainee / Apprentice"}
EMERGENCY_RELATIONS = ("Spouse", "Father", "Mother", "Brother", "Sister", "Son", "Daughter", "Guardian", "Friend", "Other")

SECTIONS = {
    "classification": "Workforce Information",
    "organization": "Employment & Organisation",
    "personal": "Contact & Personal Information",
    "access": "Portal Access",
    "contractor": "Contractor Details",
    "documents": "Documents",
    "compliance": "Statutory & Compliance",
    "exit": "Exit",
    "admin": "HR Administration",
}

HR = "HR (Employees: create / edit)"

FIELDS: list[dict] = [
    # ── 1. workforce information
    dict(key="employee_code", label="Workforce ID", section="classification",
         why="Unique ID on punch cards, rosters and statutory registers. Left blank, the next WF- number is assigned.",
         used_by="Punch / roster CSV import, registers, search."),
    dict(key="full_name", label="Full Name", section="classification", visible=[NO_LOGIN], required=[NO_LOGIN],
         why="Name as on Aadhaar. Account holders take their name from the portal account.",
         used_by="Every HR list, register and document."),
    dict(key="worker_type", label="Worker Category", section="classification", required=None,
         why="Who the person is to the company — decides which fields, documents and workflows apply.",
         used_by="This form's rules, employee list filter, headcount."),
    dict(key="employment_type", label="Employment Type", section="classification", required=None,
         why="Terms of employment — permanent, fixed-term, contractual. Fixed-term and contractual need contract dates.",
         used_by="Contract-expiry checks, headcount, documents required."),
    dict(key="designation_id", label="Designation", section="classification", required=None,
         why="Job title; may carry a default grade.", used_by="Directory, documents, headcount, approvals."),
    dict(key="employment_status", label="Employment Status", section="classification", required=None,
         why="Where the person is in the lifecycle; 'Exited' removes them from active headcount.",
         used_by="Headcount, attendance, exit handling, portal sign-in block for exited staff."),
    dict(key="date_of_joining", label="Date of Joining", section="classification", required=None,
         why="Start of service — tenure, probation, leave accrual and gratuity eligibility count from it.",
         used_by="Leave accrual, probation, service registers."),
    # ── 2. employment & organisation
    dict(key="branch_id", label="Plant / Site", section="organization", required=[{"worker_type": NON_OFFICE}],
         why="Which plant they work at — sets the holiday calendar, working days and HR data access. For contract labour it is the assigned site.",
         used_by="Attendance calendar, headcount by plant, HR data scope."),
    dict(key="department_id", label="Department", section="organization", required=[{"worker_type": ["office", "factory"]}],
         why="Reporting structure and department-head approvals.",
         used_by="Headcount, approvals routing, HR data scope."),
    dict(key="grade_id", label="Grade", section="organization", why="Pay band / entitlement level.", used_by="Travel & expense entitlements."),
    dict(key="reporting_manager_id", label="Reporting Manager / Supervisor", section="organization",
         required=[{"worker_type": SHOP_FLOOR}],
         why="Shop-floor and contract staff need a named internal supervisor who answers for their attendance and safety.",
         used_by="Approvals (leave, overtime), HR data scope 'assigned'."),
    dict(key="work_location", label="Work Location", section="organization", required=None,
         why="Where on site they work — needed for emergency evacuation and housekeeping/security allocation.",
         used_by="Emergency roll-call, site allocation."),
    dict(key="probation_status", label="Probation Status", section="organization", required=None,
         why="Probation is separate from employment type and status: a permanent employee can be on probation.",
         used_by="Probation reminders, HR > Lifecycle confirmation."),
    dict(key="probation_end_date", label="Probation End Date", section="organization",
         visible=[{"probation_status": ["on_probation"]}], required=[{"probation_status": ["on_probation"]}],
         why="HR is reminded to confirm or extend before it ends.", used_by="Probation reminders, dashboard."),
    dict(key="confirmation_date", label="Confirmation Date", section="organization",
         visible=[{"probation_status": ["confirmed"]}], required=[{"probation_status": ["confirmed"]}],
         why="When probation ended and the person was confirmed.", used_by="Service record."),
    dict(key="contract_start_date", label="Contract Start Date", section="organization", visible=CONTRACT_PERIOD, required=CONTRACT_PERIOD,
         why="Start of the fixed-term contract, or of deployment under the contractor's agreement.",
         used_by="Contract-validity checks."),
    dict(key="contract_end_date", label="Contract End Date", section="organization", visible=CONTRACT_PERIOD, required=CONTRACT_PERIOD,
         why="Nobody should work past their contract — the list flags expired contracts.",
         used_by="Contract-expiry flag on the employee list."),
    dict(key="shift_id", label="Shift", section="organization", required=[{"worker_type": SHOP_FLOOR}],
         why="Shop-floor attendance is judged against a shift (late-coming, overtime after shift hours).",
         used_by="Time evaluation, rosters, overtime."),
    dict(key="weekly_off", label="Weekly Off", section="organization",
         why="Staggered weekly offs (Factories Act s.52). Blank = the plant's working days.",
         used_by="Attendance calendar (weekly-off days)."),
    dict(key="attendance_policy", label="Attendance Policy", section="organization",
         why="How attendance is captured for this person. Recorded now; the attendance screens will use it in a later step.",
         used_by="(planned) Attendance capture."),
    dict(key="ot_eligible", label="Overtime Eligible", section="organization",
         why="Workers get overtime at twice the wage (Factories Act s.59); managerial staff usually don't.",
         used_by="Overtime claims and HR overtime generation — refused when 'No'."),
    # ── 3. contact & personal
    dict(key="personal_phone", label="Mobile Number", section="personal", required=[NO_LOGIN, {"worker_type": NON_OFFICE}],
         why="How to reach someone without a work email or portal login.", used_by="Emergency contact, shift changes."),
    dict(key="personal_email", label="Personal Email", section="personal", why="Contact after exit (F&F, documents).", used_by="Exit communication."),
    dict(key="date_of_birth", label="Date of Birth", section="personal", required=[{"worker_type": NON_OFFICE}],
         why="Age proof — the Factories Act bars children under 14 and needs a fitness certificate for 15–18 year olds on the shop floor.",
         used_by="Age check on save, Register of Adult Workers."),
    dict(key="gender", label="Gender", section="personal",
         why="Leave entitlements (maternity) and night-shift rules for women (Factories Act s.66).", used_by="Leave eligibility, statutory registers."),
    dict(key="blood_group", label="Blood Group", section="personal", why="First aid after an accident.", used_by="Safety incidents."),
    dict(key="marital_status", label="Marital Status", section="personal", why="Nomination and leave rules.", used_by="Statutory forms."),
    dict(key="current_address", label="Current Address", section="personal", complete=[{"worker_type": NON_OFFICE}],
         why="Local address for emergencies and police verification.", used_by="Emergency contact, verification."),
    dict(key="permanent_address", label="Permanent Address", section="personal", why="Statutory forms (PF / ESIC nomination).", used_by="Statutory forms."),
    dict(key="emergency_contact_name", label="Emergency Contact Name", section="personal", required=[{"worker_type": SHOP_FLOOR}],
         why="Who to call after a shop-floor accident.", used_by="Safety incidents."),
    dict(key="emergency_contact_relation", label="Emergency Contact Relationship", section="personal", required=[{"worker_type": SHOP_FLOOR}],
         why="Who the contact is to the employee.", used_by="Safety incidents."),
    dict(key="emergency_contact_phone", label="Emergency Contact Phone", section="personal", required=[{"worker_type": SHOP_FLOOR}],
         why="Who to call after a shop-floor accident.", used_by="Safety incidents."),
    # ── 4. portal access (only for records without an account yet)
    dict(key="portal_access", label="Portal Access", section="access", visible=[NO_LOGIN],
         why="Whether this person signs in to the portal. No = an HR-only record without login.",
         used_by="Linking the HR record to a portal account."),
    dict(key="work_email", label="Work Email", section="access", visible=[PORTAL], required=[PORTAL],
         why="The company (Microsoft) email they sign in with. The record links to that account — now if it exists, else at first sign-in.",
         used_by="Portal account linking, sign-in."),
    dict(key="portal_role_id", label="Application Role", section="access", visible=[PORTAL], required=[PORTAL],
         why="What they may do in the portal once linked — a role from Organization › Role & Permissions.",
         used_by="Permissions of the linked account."),
    # ── 5. contractor
    dict(key="contractor_name", label="Contractor Company", section="contractor", visible=CONTRACTOR, required=[{"worker_type": ["contract"]}],
         why="The labour contractor they come through. Under the CLRA Act, 1970 we pay their wages and PF/ESI if the contractor doesn't. Leave blank if on our own rolls.",
         used_by="Register of contractors, contractor compliance."),
    dict(key="contractor_worker_id", label="Contractor Worker ID", section="contractor", visible=CONTRACTOR,
         why="The ID on the contractor's own muster roll, to match their wage register.", used_by="Contractor wage-register check."),
    dict(key="contractor_contact_person", label="Contractor Contact Person", section="contractor", visible=CONTRACTOR,
         why="Who at the contractor answers for this worker.", used_by="Escalations."),
    dict(key="contractor_contact_phone", label="Contractor Contact Number", section="contractor", visible=CONTRACTOR,
         complete=[{"worker_type": ["contract"]}], why="Reach the contractor about absence, misconduct or an accident.", used_by="Escalations."),
    dict(key="contractor_agreement_ref", label="Agreement / Work Order Ref.", section="contractor", visible=CONTRACTOR,
         required=[{"worker_type": ["contract"]}],
         why="The agreement this worker is deployed under — needed to verify the contractor's licence and wage compliance.",
         used_by="Contractor compliance."),
    dict(key="contractor_verification", label="Contractor Verification", section="contractor", visible=CONTRACTOR,
         complete=[{"worker_type": ["contract"]}],
         why="HR's check of the contractor's papers for this worker (licence, PF/ESI cover). Pending keeps the record Incomplete.",
         used_by="Contractor compliance, record status."),
    # ── 6. documents (uploads — see DOCUMENTS)
    dict(key="documents", label="Documents", section="documents",
         why="Scanned copies of the joining paperwork, each verified by HR. A required document not uploaded and verified leaves the record Incomplete.",
         used_by="Record status, audits, statutory inspections."),
    # ── 7. statutory & compliance
    dict(key="pan_number", label="PAN", section="compliance", why="Income tax (TDS) — payroll in ADP uses it.", used_by="ADP payroll (reference)."),
    dict(key="aadhaar_last4", label="Aadhaar (last 4)", section="compliance", why="Identity check without storing the full number.", used_by="Identity verification."),
    dict(key="uan_number", label="UAN / PF Number", section="compliance",
         why="Provident Fund. For contract labour, HR checks the contractor actually deposits PF against this UAN.", used_by="PF compliance."),
    dict(key="esic_number", label="ESIC Number", section="compliance", why="ESI health cover for workers under the wage ceiling.", used_by="ESI compliance."),
    dict(key="safety_induction_status", label="Safety Induction", section="compliance", visible=[{"worker_type": NON_OFFICE}],
         required=[{"worker_type": SHOP_FLOOR}],
         why="Nobody goes on the shop floor before safety induction. Pending keeps the record Incomplete.", used_by="Safety compliance, record status."),
    dict(key="safety_induction_date", label="Induction Date", section="compliance", visible=[{"safety_induction_status": ["completed"]}],
         required=[{"safety_induction_status": ["completed"]}], why="When the induction was done.", used_by="Safety records."),
    dict(key="medical_clearance_status", label="Medical Clearance", section="compliance", visible=[{"worker_type": NON_OFFICE}],
         required=[{"worker_type": SHOP_FLOOR}],
         why="Pre-employment medical for shop-floor work; mandatory for 15–18 year olds (Factories Act s.69). Pending keeps the record Incomplete.",
         used_by="Age check, safety, record status."),
    dict(key="medical_fitness_date", label="Clearance Date", section="compliance", visible=[{"medical_clearance_status": ["cleared"]}],
         required=[{"medical_clearance_status": ["cleared"]}], why="Date on the fitness certificate.", used_by="Age check, safety records."),
    # ── exit
    dict(key="date_of_exit", label="Last Working Day", section="exit", visible=[{"employment_status": ["notice", "exited"]}],
         required=[{"employment_status": ["exited"]}],
         why="Ends service — stops attendance and counts towards F&F and gratuity.", used_by="Headcount, exit."),
    dict(key="exit_reason", label="Exit Reason", section="exit", visible=[{"employment_status": ["notice", "exited"]}],
         required=[{"employment_status": ["exited"]}],
         why="Attrition analysis and the service certificate.", used_by="Attrition reports."),
    dict(key="exit_clearance_done", label="Clearance Complete", section="exit",
         visible=[{"employment_status": ["notice", "exited"], "has_login": [False]}],
         required=[{"employment_status": ["exited"], "has_login": [False]}],
         why="Tools, PPE, ID card / gate pass returned and dues settled. Account holders clear through HR > Lifecycle instead.",
         used_by="Exit."),
    # ── admin
    dict(key="notes", label="HR Internal Notes", section="admin", why="Internal HR notes — never shown to the employee.", used_by="HR only."),
]
for _f in FIELDS:
    _f.setdefault("visible", None)
    _f.setdefault("required", [])
    _f.setdefault("complete", [])
    _f.setdefault("edit", HR)

FIELDS_BY_KEY = {f["key"]: f for f in FIELDS}

# Document types (user_documents.checklist_key). Several files per type are allowed.
DOCUMENTS = {
    "photo": "Employee Photo", "identity_proof": "Identity Proof", "address_proof": "Address Proof", "resume": "Resume / CV",
    "appointment_letter": "Appointment Letter", "employment_contract": "Signed Employment Contract",
    "education": "Education Certificates", "pan": "PAN Document", "uan_pf": "UAN / PF Documents", "esic": "ESIC Documents",
    "medical": "Medical Fitness Certificate", "safety_training": "Safety Training Certificate", "police": "Police Verification",
    "bank": "Bank Details", "contractor_agreement": "Contractor Agreement", "work_order": "Work Order", "other": "Other Documents",
}
# Document type recorded on the file (same vocabulary as the Documents tab).
CHECKLIST_DOCUMENT_TYPES = {
    "photo": "Photograph", "identity_proof": "ID Proof", "address_proof": "Address Proof", "resume": "Resume / CV",
    "appointment_letter": "Appointment Letter", "employment_contract": "Employment Contract", "education": "Educational Certificate",
    "pan": "PAN Card", "uan_pf": "PF Documents", "esic": "ESIC Documents", "medical": "Medical Certificate",
    "safety_training": "Safety Training Certificate", "police": "Police Verification", "bank": "Bank Details",
    "contractor_agreement": "Contractor Agreement", "work_order": "Work Order", "other": "Other",
}
# Statutory / identity papers: hidden from the employee's own My HR view.
SENSITIVE_DOCUMENTS = {"identity_proof", "pan", "uan_pf", "esic", "bank", "medical", "police"}
# When a document is required (same condition language as the fields).
REQUIRED_DOCUMENTS: dict[str, list[dict] | None] = {
    "photo": None,
    "identity_proof": None,
    "address_proof": None,
    "appointment_letter": [{"worker_type": DIRECT}],
    "employment_contract": [{"worker_type": DIRECT, "employment_type": ["fixed_term", "contract"]}],
    "education": [{"worker_type": ["office"]}],
    "pan": [{"worker_type": ["office"]}],
    "medical": [{"worker_type": SHOP_FLOOR}],
    "safety_training": [{"worker_type": ["factory", "contract"]}],
    "police": [{"worker_type": ["housekeeping", "contract"]}],
    "contractor_agreement": [{"worker_type": ["contract"]}],
    "work_order": [{"worker_type": ["contract"]}],
}
# Sensible starting values for a new record, per worker type.
DEFAULTS = {
    "office": {"attendance_policy": "self", "ot_eligible": False, "portal_access": True, "employment_type": "permanent"},
    "factory": {"attendance_policy": "biometric", "ot_eligible": True, "portal_access": False, "employment_type": "permanent",
                "safety_induction_status": "pending", "medical_clearance_status": "pending"},
    "housekeeping": {"attendance_policy": "supervisor", "ot_eligible": True, "portal_access": False, "employment_type": "permanent",
                     "safety_induction_status": "pending", "medical_clearance_status": "pending"},
    "contract": {"attendance_policy": "biometric", "ot_eligible": True, "portal_access": False, "employment_type": "contract",
                 "safety_induction_status": "pending", "medical_clearance_status": "pending", "contractor_verification": "pending"},
    "other": {"attendance_policy": "supervisor", "ot_eligible": True, "portal_access": False, "employment_type": "permanent"},
}


def matches(cond: list[dict] | None, ctx: dict) -> bool:
    if cond is None:
        return True
    return any(all(ctx.get(k) in vals for k, vals in clause.items()) for clause in cond)


def context(profile, has_login: bool) -> dict:
    return {
        "worker_type": profile.worker_type or "office", "employment_type": profile.employment_type,
        "employment_status": profile.employment_status, "portal_access": bool(profile.portal_access),
        "probation_status": profile.probation_status or "not_applicable",
        "safety_induction_status": profile.safety_induction_status, "medical_clearance_status": profile.medical_clearance_status,
        "has_login": has_login,
    }


def _blank(v) -> bool:
    return v is None or v is False or (isinstance(v, str) and not v.strip()) or (isinstance(v, (list, dict)) and not v)


def _value(profile, key: str, user=None):
    # Account holders keep these two on the User row (single source of truth).
    if user is not None and key in ("date_of_joining", "reporting_manager_id"):
        return getattr(user, key)
    if key == "documents":
        return True  # documents are checked by missing_documents
    return getattr(profile, key)


def applies(cond: list[dict] | None, ctx: dict) -> bool:
    """A required/complete condition: None = always, [] = never."""
    return cond is None or (bool(cond) and matches(cond, ctx))


def missing(profile, has_login: bool, level: str, user=None) -> list[str]:
    """Labels of fields that are visible, required at `level` ('required' or
    'complete') and empty."""
    ctx = context(profile, has_login)
    return [
        f["label"] for f in FIELDS
        if matches(f["visible"], ctx) and applies(f[level], ctx) and _blank(_value(profile, f["key"], user))
    ]


def required_document_keys(profile, has_login: bool) -> list[str]:
    ctx = context(profile, has_login)
    return [k for k, cond in REQUIRED_DOCUMENTS.items() if matches(cond, ctx)]


def missing_documents(profile, has_login: bool, uploaded: dict[str, str]) -> list[str]:
    """Required documents not yet uploaded AND verified. `uploaded` = document
    type → best verification status of its files (verified > pending > rejected)."""
    out = []
    for k in required_document_keys(profile, has_login):
        state = uploaded.get(k)
        if state != "verified":
            out.append(f"{DOCUMENTS[k]} ({'not uploaded' if state is None else 'awaiting verification' if state == 'pending' else 'rejected'})")
    return out


def pending_checks(profile, has_login: bool) -> list[str]:
    """Statuses that are filled in but still Pending."""
    ctx = context(profile, has_login)
    out = []
    for key in ("safety_induction_status", "medical_clearance_status", "contractor_verification"):
        f = FIELDS_BY_KEY[key]
        val = getattr(profile, key)
        if matches(f["visible"], ctx) and val == "pending":
            out.append(f"{f['label']} (pending)")
        if key == "contractor_verification" and matches(f["visible"], ctx) and val == "rejected":
            out.append(f"{f['label']} (rejected)")
    return out


def record_status(profile, has_login: bool, user=None, uploaded: dict[str, str] | None = None) -> tuple[str, list[str]]:
    """('draft' | 'incomplete' | 'complete', what is missing)."""
    gaps = (missing(profile, has_login, "required", user) + missing(profile, has_login, "complete", user)
            + pending_checks(profile, has_login) + missing_documents(profile, has_login, uploaded or {}))
    if profile.is_draft:
        return "draft", gaps
    return ("incomplete" if gaps else "complete"), gaps


def age_problem(profile, today: date) -> str | None:
    """Factories Act: under 14 can't be employed; 15–18 needs a medical fitness certificate."""
    dob = profile.date_of_birth
    if not dob or (profile.worker_type or "office") == "office":
        return None
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age < 14:
        return (f"{profile.full_name or 'This person'} is {age} years old. Children under 14 can't be employed in a factory "
                "(Factories Act s.67, Child Labour Act). Check the date of birth.")
    if age < 18 and not (profile.medical_clearance_status == "cleared" and profile.medical_fitness_date):
        return (f"{profile.full_name or 'This person'} is {age} — an adolescent. They need a certificate of fitness from a "
                "certifying surgeon before shop-floor work (Factories Act s.68–69). Set Medical Clearance to Cleared with its date.")
    return None


def rules_payload(roles: list[dict] | None = None) -> dict:
    """Everything the form needs, for GET /hr/employees/form-rules."""
    return {
        "sections": SECTIONS,
        "fields": FIELDS,
        "worker_types": WORKER_TYPES,
        "employment_types": FORM_EMPLOYMENT_TYPES,
        "employment_statuses": list(EMPLOYMENT_STATUSES),
        "probation_statuses": PROBATION_STATUSES,
        "clearance_statuses": CLEARANCE_STATUSES,
        "verification_statuses": VERIFICATION_STATUSES,
        "emergency_relations": list(EMERGENCY_RELATIONS),
        "attendance_policies": ATTENDANCE_POLICIES,
        "documents": DOCUMENTS,
        "sensitive_documents": sorted(SENSITIVE_DOCUMENTS),
        "required_documents": REQUIRED_DOCUMENTS,
        "defaults": DEFAULTS,
        "roles": roles or [],
    }
