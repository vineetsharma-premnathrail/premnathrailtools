"""HR › Safety (EHS incidents) — rules shared by routes/safety.py.

Statutory reporting (Factories Act 1948):
- s.88: an accident causing death, or bodily injury that prevents the person
  from working for 48 hours or more immediately after it, must be reported
  to the Inspector (Form 18 under the state Factories Rules).
- s.88A: a dangerous occurrence must be reported whether or not anyone was
  hurt.
`is_reportable` applies these; HR can additionally flag any incident.

KPIs: LTIFR = lost-time injuries × 1,000,000 / man-hours worked;
severity rate = lost days × 1,000,000 / man-hours (man-hours from time
evaluation of the attendance register).

Closure goes through the central approval engine (type "hr.safety_closure"):
stage 1 the incident plant's head (plus HR › Safety approvers), stage 2 any
Partner for high / fatal severity. Rejection reopens the actions.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.modules.hr.models.safety import (
    ACTION_TYPES, INCIDENT_STATUSES, INCIDENT_TYPES, PERSON_OUTCOMES, PERSON_TYPES, SEVERITIES,
    HrSafetyIncident,
)
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine

CLOSURE_KEY = "hr.safety_closure"
ENTITY = "hr_safety_incident"
FORM18_ENTITY = "hr_safety_form18"
NOTIFY_TYPE = "hr_safety"
SAFETY_APPROVE_PERMISSION = "hr:safety:approve"

ROOT_CAUSE_CATEGORIES = {
    "unsafe_act": "Unsafe act", "unsafe_condition": "Unsafe condition", "machine_failure": "Machine / tool failure",
    "ppe": "PPE missing / not used", "procedure": "No / wrong procedure (SOP)", "training": "Training / competence",
    "housekeeping": "Housekeeping", "material_handling": "Material handling / lifting", "electrical": "Electrical",
    "other": "Other",
}
LTI_OUTCOMES = ("lost_time", "fatal")
OPEN_STATUSES = ("reported", "under_investigation", "actions_open", "closure_pending")


def incident_fy(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[2:]}"


def is_reportable(inc: HrSafetyIncident) -> bool:
    if inc.reportable_manual or inc.severity == "fatal" or inc.incident_type in ("fatality", "dangerous_occurrence"):
        return True
    return any(p.outcome == "fatal" or (p.outcome == "lost_time" and (p.lost_days or 0) >= 2) for p in inc.persons)


def reportable_reasons(inc: HrSafetyIncident) -> list[str]:
    out = []
    if inc.severity == "fatal" or inc.incident_type == "fatality" or any(p.outcome == "fatal" for p in inc.persons):
        out.append("Fatal accident — Factories Act s.88")
    if any(p.outcome == "lost_time" and (p.lost_days or 0) >= 2 for p in inc.persons):
        out.append("Injury keeping a person off work 48 hours or more — s.88")
    if inc.incident_type == "dangerous_occurrence":
        out.append("Dangerous occurrence — s.88A")
    if inc.reportable_manual and not out:
        out.append("Flagged reportable by HR")
    return out


def lost_days(inc: HrSafetyIncident) -> int:
    return sum(p.lost_days or 0 for p in inc.persons)


def lti_count(inc: HrSafetyIncident) -> int:
    return sum(1 for p in inc.persons if p.outcome in LTI_OUTCOMES)


def check_choice(value: str | None, allowed: dict, field: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(status_code=400, detail=f"'{value}' is not a valid {field}. Use one of: {', '.join(allowed)}.")


def ensure_open(inc: HrSafetyIncident, what: str = "changed") -> None:
    if inc.status == "closed":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} is closed, so it can't be {what}. "
                                                    "Raise a new incident if something new happened.")
    if inc.status == "closure_pending":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} is waiting for closure approval, so it can't be {what}. "
                                                    "Ask the approver to reject the closure if something must change.")


def bump_document(inc: HrSafetyIncident) -> None:
    """Facts on the Form 18 changed — the next Word draft is a new revision."""
    inc.document_revision = (inc.document_revision or 0) + 1


def closure_blockers(inc: HrSafetyIncident) -> list[str]:
    out = []
    if not inc.investigation_completed_at:
        out.append("the investigation isn't complete (root cause not recorded)")
    open_actions = [a for a in inc.actions if a.status == "open"]
    if open_actions:
        out.append(f"{len(open_actions)} CAPA action(s) are still open")
    if not any(a.status == "done" for a in inc.actions) and not (inc.no_action_reason or "").strip():
        out.append("no CAPA action was completed and no reason was given why none is needed")
    if is_reportable(inc) and not inc.form18_submitted_on:
        out.append("it is reportable to the Factories Inspector but the Form 18 submission date isn't recorded")
    for p in inc.persons:
        if p.outcome == "lost_time" and not p.return_to_work_date:
            out.append(f"{p.external_name or 'an injured person'} has lost time but no return-to-work date")
    return out


def _on_closure_decided(db: Session, areq, outcome: str, actor: User) -> None:
    inc = db.query(HrSafetyIncident).filter(HrSafetyIncident.id == areq.entity_id).with_for_update().populate_existing().first()
    if inc is None or inc.status != "closure_pending":
        return
    if outcome == "approved":
        inc.status = "closed"
        inc.closed_by_id = actor.id
        inc.closed_at = datetime.now(timezone.utc)
        record_audit(db, entity_type=ENTITY, entity_id=inc.id, action="closed", module_key="hr",
                     summary=f"Closed {inc.incident_no}", user_id=actor.id)
    else:
        inc.status = "actions_open"
        comment = engine_comment(areq, actor)
        record_audit(db, entity_type=ENTITY, entity_id=inc.id, action=f"closure_{outcome}", module_key="hr",
                     summary=f"Closure of {inc.incident_no} {outcome}" + (f": {comment}" if comment else ""), user_id=actor.id)


def engine_comment(areq, actor: User) -> str | None:
    from app.modules.hr.services.approvals import decision_comment

    return decision_comment(areq, actor)


engine.register_transaction(engine.TransactionType(
    key=CLOSURE_KEY, module_key="hr", subtab_key="safety", label="Safety incident closure", entity_type=ENTITY,
    url="/dashboard/hr/safety", description="Closing an accident / near-miss after its investigation and CAPA "
    "(HR › Safety). Default: the plant head (or an HR › Safety approver), then a Partner for high or fatal incidents.",
    context_fields={
        "severity": {"label": "Severity", "type": "choice", "choices": list(SEVERITIES)},
        "incident_type": {"label": "Incident type", "type": "choice", "choices": list(INCIDENT_TYPES)},
        "lost_days": {"label": "Lost days", "type": "number"},
        "reportable": {"label": "Reportable (Form 18)", "type": "bool"},
    },
    default_stages=[
        engine.StageDef("Plant head / EHS approver", "plant_head", {"plus_permission": [SAFETY_APPROVE_PERMISSION]}),
        engine.StageDef("Partner", "partner", {}, conditions=[{"field": "severity", "op": "in", "value": ["high", "fatal"]}],
                        skip_if_no_approver=True),
    ],
    on_decided=_on_closure_decided, require_permission=False, allow_self_approval=False,
))


# ── Form 18 (Word document of record) ────────────────────────────────────

def _name(db: Session, uid: int | None) -> str | None:
    if not uid:
        return None
    u = db.get(User, uid)
    return (u.name or u.email) if u else None


def _dt(v) -> str | None:
    if not v:
        return None
    from app.modules.hr.services.time_evaluation import as_ist

    return as_ist(v).strftime("%d-%m-%Y %H:%M") if isinstance(v, datetime) else v.strftime("%d-%m-%Y")


def form18_spec(db: Session, inc: HrSafetyIncident) -> dict:
    """Report of accident / dangerous occurrence (Factories Act s.88/88A,
    Form 18 of the state Factories Rules) — spec for quality/reports/render."""
    from app.modules.hr.models.employee_profile import HrEmployeeProfile
    from app.modules.organization.models.branch import Branch
    from app.modules.organization.models.branch_address import BranchAddress
    from app.modules.organization.models.company import Company

    branch = db.get(Branch, inc.branch_id) if inc.branch_id else None
    company = db.get(Company, branch.company_id) if branch and branch.company_id else db.query(Company).first()
    addr = None
    if branch:
        addr = (db.query(BranchAddress).filter(BranchAddress.branch_id == branch.id, BranchAddress.is_active.is_(True))
                .order_by(BranchAddress.is_primary.desc(), BranchAddress.id).first())
    address = ", ".join(x for x in ([addr.address_line1, addr.address_line2, addr.city, addr.district, addr.state, addr.pincode]
                                    if addr else []) if x) or None
    asset_txt = None
    if inc.asset_id:
        from app.modules.maintenance.models.asset import MaintenanceAsset

        a = db.get(MaintenanceAsset, inc.asset_id)
        asset_txt = f"{a.asset_code} {a.name}" if a else None
    persons = []
    for p in inc.persons:
        u = db.get(User, p.user_id) if p.user_id else None
        prof = db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == p.user_id).first() if p.user_id else None
        age = p.age
        if age is None and prof and prof.date_of_birth:
            occ = inc.occurred_at.date()
            dob = prof.date_of_birth
            age = occ.year - dob.year - ((occ.month, occ.day) < (dob.month, dob.day))
        name = (u.name if u else None) or p.external_name or "—"
        who = PERSON_TYPES.get(p.person_type, p.person_type) + (f" ({p.external_company})" if p.external_company else "")
        persons.append([
            name + (f" [{prof.employee_code}]" if prof and prof.employee_code else ""), who,
            (prof.gender.title() if prof and prof.gender else "—") + " / " + (str(age) if age is not None else "—"),
            p.occupation or (u.designation if u and getattr(u, "designation", None) else "—"),
            PERSON_OUTCOMES.get(p.outcome, p.outcome), ", ".join(x for x in (p.injury_nature, p.body_part) if x) or "—",
            str(p.lost_days or 0), _dt(p.return_to_work_date) or "—",
        ])
    witnesses = [[w.get("name") or _name(db, w.get("user_id")) or "—", w.get("statement") or ""] for w in (inc.witnesses or [])]
    reasons = reportable_reasons(inc)
    return {
        "title": "FORM 18 — REPORT OF ACCIDENT / DANGEROUS OCCURRENCE",
        "number": inc.incident_no + (f"-R{inc.document_revision}" if inc.document_revision else ""),
        "intro": "Notice under section 88 / 88A of the Factories Act, 1948 and the Factories Rules of the State, "
                 "to the Inspector of Factories.",
        "facts": [
            ("Name of the factory / occupier", (company.legal_name or company.name) if company else None),
            ("Plant", branch.name if branch else None), ("Address of the factory", address),
            ("Nature of industry", (company.industry or company.business_nature) if company else None),
            ("Date and time of the accident / occurrence", _dt(inc.occurred_at)),
            ("Place (shed / section / machine)", ", ".join(x for x in (inc.location_text, asset_txt) if x) or None),
            ("Type", INCIDENT_TYPES.get(inc.incident_type, inc.incident_type)), ("Severity", SEVERITIES.get(inc.severity)),
            ("Reported in the portal", f"{_dt(inc.reported_at)} by {_name(db, inc.reported_by_id) or '—'}"),
            ("Reportable because", "; ".join(reasons) or "Not reportable — kept in the accident register only"),
            ("Submitted to the Inspector on", _dt(inc.form18_submitted_on)), ("Inspector's reference", inc.authority_ref),
        ],
        "sections": [
            {"heading": "Persons injured / involved",
             "columns": ["Name", "Category", "Sex / age", "Occupation", "Outcome", "Nature of injury / body part", "Days lost", "Back at work"],
             "rows": persons, "widths": [1.3, 0.9, 0.7, 0.9, 0.8, 1.2, 0.5, 0.8], "empty": "Nobody was injured."},
            {"heading": "How the accident / occurrence happened", "columns": ["Description"], "rows": [[inc.description]], "widths": [7.1]},
            {"heading": "Immediate action taken (first aid, medical treatment, area made safe)", "columns": ["Action"],
             "rows": [[inc.immediate_action or "—"]], "widths": [7.1]},
            {"heading": "Witnesses", "columns": ["Name", "Statement"], "rows": witnesses, "widths": [2.0, 5.1], "empty": "No witnesses recorded."},
            {"heading": "Cause (investigation)", "columns": ["Root cause", "Contributing factors"],
             "rows": [[(ROOT_CAUSE_CATEGORIES.get(inc.root_cause_category or "", "") + (": " if inc.root_cause_category else "")
                        + (inc.root_cause or "Under investigation")), inc.contributing_factors or "—"]], "widths": [3.6, 3.5]},
            {"heading": "Corrective / preventive actions", "columns": ["#", "Type", "Action", "Owner", "Due", "Status"],
             "rows": [[str(i + 1), ACTION_TYPES.get(a.action_type, a.action_type), a.description, _name(db, a.owner_id) or "—",
                       _dt(a.due_date) or "—", a.status.title()] for i, a in enumerate(inc.actions)],
             "widths": [0.3, 0.9, 2.9, 1.3, 0.8, 0.9], "empty": "No actions recorded yet."},
        ],
        "statement": "I certify that the particulars above are correct to the best of my knowledge.",
        "remarks": None,
        "signatures": [("Prepared by (EHS / HR)", _name(db, inc.investigation_lead_id)), ("Manager", None), ("Occupier", None)],
    }


STATUS_LABELS = INCIDENT_STATUSES
