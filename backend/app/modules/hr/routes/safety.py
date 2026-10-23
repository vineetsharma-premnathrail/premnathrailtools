"""HR & Administration › Safety — EHS incident register (SAP EHS CBIH).

Who may do what (HR Permission Matrix tab "safety", deny by default):
- Report an incident: any employee with My HR (hr:me:create) or hr:safety:create.
- See the register / stats: hr:safety:view (data scope: own + assigned by
  default, plant / organization when the role says so). People on the
  incident (reporter, investigation lead, CAPA owners, injured employees)
  always see it.
- Edit, start the investigation, add CAPA, record Form 18 submission,
  submit closure: hr:safety:edit (the investigation lead too, for the
  investigation and CAPA).
- Complete a CAPA action: its owner, or hr:safety:edit.
- Close: central approval engine (hr.safety_closure — plant head / HR › Safety
  approvers, then a Partner for high / fatal incidents).
- Form 18 Word document: view = see the incident, generate / edit = hr:safety:edit;
  PDF = hr:safety:print. Register CSV: hr:safety:export.
"""
import csv
import io
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.core import assignee_rules
from app.core.audit import record_audit
from app.core.config import settings
from app.core.data_scope import apply_scope, ensure_in_scope, in_scope
from app.core.permission_registry import can_feature, can_perform, is_admin_user
from app.core.permissions import ensure_can_delete, ensure_feature_action, ensure_tab_action
from app.core.sequential_id import next_sequential_id
from app.db.session import get_db
from app.modules.hr.models.safety import (
    ACTION_TYPES, INCIDENT_STATUSES, INCIDENT_TYPES, PERSON_OUTCOMES, PERSON_TYPES, SEVERITIES,
    HrSafetyAction, HrSafetyAttachment, HrSafetyIncident, HrSafetyIncidentPerson,
)
from app.modules.hr.schemas.safety import (
    HrSafetyActionCompletePayload, HrSafetyActionPayload, HrSafetyActionResponse, HrSafetyActionUpdate,
    HrSafetyAttachmentResponse, HrSafetyIncidentClosePayload, HrSafetyIncidentCreate,
    HrSafetyIncidentInvestigatePayload, HrSafetyIncidentInvestigationPayload, HrSafetyIncidentResponse,
    HrSafetyIncidentStatutoryPayload, HrSafetyIncidentUpdate, HrSafetyPersonPayload, HrSafetyPersonResponse,
)
from app.modules.hr.services import safety as svc
from app.modules.hr.services.admin_common import require_active_user, require_branch, require_sharepoint
from app.modules.hr.services.calendar import IST, now_ist, today_ist
from app.modules.hr.services.lookup import branch_names, department_names, profiles_by_user, users_by_id
from app.modules.hr.services.time_evaluation import as_ist, man_minutes
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.services import approval_engine as engine
from app.utils.notifications import notify_user

try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover
    managed_documents = None

router = APIRouter(prefix="/hr/safety", tags=["HR"])

MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
TAB = "safety"
# "Assign to" rules (Role & Permissions › the feature's row) for the lead and CAPA owner pickers.
LEAD_RULE_KEY = "hr:safety.investigation"
CAPA_RULE_KEY = "hr:safety.capa"


# ─────────────────────────────── access ───────────────────────────────
def _can(user: User, action: str) -> bool:
    return can_perform(user, "hr", TAB, action)


def _party_ids(inc: HrSafetyIncident) -> set[int]:
    ids = {inc.reported_by_id, inc.created_by_id, inc.investigation_lead_id}
    ids |= {a.owner_id for a in inc.actions}
    ids |= {p.user_id for p in inc.persons}
    return {i for i in ids if i}


def _manager(db: Session, user: User, inc: HrSafetyIncident) -> bool:
    """hr:safety:edit with the incident inside the user's HR data access."""
    return _can(user, "edit") and in_scope(db, user, inc)


def _ensure_view(db: Session, user: User, inc: HrSafetyIncident) -> None:
    if user.id in _party_ids(inc):
        return
    ensure_tab_action(user, "hr", TAB, "view")
    ensure_in_scope(db, user, inc)


def _ensure_manage(db: Session, user: User, inc: HrSafetyIncident, *, allow_lead: bool = False) -> None:
    if allow_lead and inc.investigation_lead_id and user.id == inc.investigation_lead_id:
        return
    if not _can(user, "edit"):
        lead = " or be its investigation lead" if allow_lead else ""
        raise HTTPException(status_code=403, detail=(
            f"You need 'Edit' on HR & Administration › Safety{lead} to do this on {inc.incident_no}. "
            "Ask an admin to add it to your role in Organization › Role & Permissions."))
    ensure_in_scope(db, user, inc)


def _ensure_capa(user: User, inc: HrSafetyIncident, action: str) -> None:
    """Safety › CAPA actions feature, on top of _ensure_manage. The incident's
    investigation lead is exempt (record-level rule: the lead runs the CAPA)."""
    if inc.investigation_lead_id and user.id == inc.investigation_lead_id:
        return
    ensure_feature_action(user, "hr", "safety", "capa", action)


def _ensure_reporter(user: User) -> None:
    if not (_can(user, "create") or can_perform(user, "hr", "me", "create")):
        raise HTTPException(status_code=403, detail=(
            "Reporting an incident needs 'Create' on My HR or 'Create' on HR & Administration › Safety. "
            "Ask an admin to add My HR to your role in Organization › Role & Permissions."))


def _load(db: Session, incident_id: int, lock: bool = False) -> HrSafetyIncident:
    q = db.query(HrSafetyIncident).options(
        selectinload(HrSafetyIncident.persons), selectinload(HrSafetyIncident.actions),
        selectinload(HrSafetyIncident.attachments),
    ).filter(HrSafetyIncident.id == incident_id)
    inc = q.with_for_update().populate_existing().first() if lock else q.first()
    if inc is None:
        raise HTTPException(status_code=404, detail=f"Safety incident #{incident_id} doesn't exist. Open it again from HR › Safety — it may have been deleted.")
    return inc


# ─────────────────────────────── response ───────────────────────────────
def _out(db: Session, inc: HrSafetyIncident, viewer: User) -> HrSafetyIncidentResponse:
    uids = [inc.reported_by_id, inc.investigation_lead_id, inc.closed_by_id]
    uids += [a.owner_id for a in inc.actions] + [a.completed_by_id for a in inc.actions]
    uids += [p.user_id for p in inc.persons] + [a.uploaded_by_id for a in inc.attachments]
    users = users_by_id(db, uids)
    profiles = profiles_by_user(db, [p.user_id for p in inc.persons])
    name = lambda uid: (users[uid].name or users[uid].email) if uid in users else None  # noqa: E731
    today = today_ist()
    manager = _manager(db, viewer, inc)
    is_lead = bool(inc.investigation_lead_id) and viewer.id == inc.investigation_lead_id
    open_state = inc.status not in ("closed", "closure_pending")
    persons = [HrSafetyPersonResponse.model_validate(p).model_copy(update={
        "display_name": name(p.user_id) or p.external_name,
        "employee_code": profiles[p.user_id].employee_code if p.user_id in profiles else None,
    }) for p in inc.persons]
    actions = [HrSafetyActionResponse.model_validate(a).model_copy(update={
        "owner_name": name(a.owner_id), "completed_by_name": name(a.completed_by_id),
        "is_overdue": a.status == "open" and a.due_date < today,
        "can_complete": a.status == "open" and open_state and (viewer.id == a.owner_id or manager or is_lead),
    }) for a in inc.actions]
    atts = [HrSafetyAttachmentResponse.model_validate(a).model_copy(update={"uploaded_by_name": name(a.uploaded_by_id)})
            for a in inc.attachments]
    asset_label = project_label = None
    if inc.asset_id:
        from app.modules.maintenance.models.asset import MaintenanceAsset
        a = db.get(MaintenanceAsset, inc.asset_id)
        asset_label = f"{a.asset_code} — {a.name}" if a else None
    if inc.erp_project_id:
        from app.modules.erp.models.project import Project as ErpProject
        p = db.get(ErpProject, inc.erp_project_id)
        project_label = f"{p.serial_number} — {getattr(p, 'client_company', None) or p.model_name or ''}".rstrip(" —") if p else None
    blockers = svc.closure_blockers(inc) if inc.status in ("under_investigation", "actions_open") else []
    return HrSafetyIncidentResponse.model_validate(inc).model_copy(update={
        "persons": persons, "actions": actions, "attachments": atts,
        "branch_name": branch_names(db).get(inc.branch_id or 0), "department_name": department_names(db).get(inc.department_id or 0),
        "reported_by_name": name(inc.reported_by_id), "investigation_lead_name": name(inc.investigation_lead_id),
        "closed_by_name": name(inc.closed_by_id), "asset_label": asset_label, "erp_project_label": project_label,
        "reportable": svc.is_reportable(inc), "reportable_reasons": svc.reportable_reasons(inc),
        "lost_days": svc.lost_days(inc), "lti_count": svc.lti_count(inc),
        "injured_count": sum(1 for p in inc.persons if p.outcome != "no_injury"),
        "open_actions": sum(1 for a in inc.actions if a.status == "open"),
        "overdue_actions": sum(1 for a in actions if a.is_overdue),
        "closure_blockers": blockers,
        "can_edit": manager and open_state,
        "can_investigate": (manager or is_lead) and inc.status in ("under_investigation", "actions_open"),
        "can_submit_closure": (manager or is_lead) and inc.status in ("under_investigation", "actions_open") and not blockers,
        "can_withdraw_closure": (manager or is_lead) and inc.status == "closure_pending",
        "can_delete": inc.status == "reported" and _can(viewer, "delete") and (is_admin_user(viewer) or inc.created_by_id == viewer.id),
        "can_print": can_feature(viewer, "hr", "safety", "statutory", "print"),
    })


def _summary_row(inc: HrSafetyIncident, branches: dict, users: dict) -> dict:
    lead = users.get(inc.investigation_lead_id or 0)
    rep = users.get(inc.reported_by_id or 0)
    return {
        "id": inc.id, "incident_no": inc.incident_no, "title": inc.title, "incident_type": inc.incident_type,
        "severity": inc.severity, "status": inc.status, "branch_id": inc.branch_id,
        "branch_name": branches.get(inc.branch_id or 0), "location_text": inc.location_text,
        "occurred_at": inc.occurred_at, "reported_by_name": rep.name if rep else None,
        "investigation_lead_name": lead.name if lead else None,
        "injured_count": sum(1 for p in inc.persons if p.outcome != "no_injury"),
        "lost_days": svc.lost_days(inc), "lti_count": svc.lti_count(inc), "reportable": svc.is_reportable(inc),
        "form18_submitted_on": inc.form18_submitted_on,
        "open_actions": sum(1 for a in inc.actions if a.status == "open"),
        "overdue_actions": sum(1 for a in inc.actions if a.status == "open" and a.due_date < today_ist()),
    }


# ─────────────────────────────── validation ───────────────────────────────
def _check_core(db: Session, data: dict) -> None:
    svc.check_choice(data.get("incident_type"), INCIDENT_TYPES, "incident type")
    svc.check_choice(data.get("severity"), SEVERITIES, "severity")
    require_branch(db, data.get("branch_id"))
    occ = data.get("occurred_at")
    if occ is not None and as_ist(occ) > now_ist():
        raise HTTPException(status_code=400, detail="The date and time it happened is in the future. Enter when the incident actually occurred.")
    if data.get("asset_id"):
        from app.modules.maintenance.models.asset import MaintenanceAsset
        if db.get(MaintenanceAsset, data["asset_id"]) is None:
            raise HTTPException(status_code=404, detail=f"Machine / equipment #{data['asset_id']} doesn't exist. Pick it from the list again, or leave it blank.")
    if data.get("erp_project_id"):
        from app.modules.erp.models.project import Project as ErpProject
        if db.get(ErpProject, data["erp_project_id"]) is None:
            raise HTTPException(status_code=404, detail=f"Customer machine #{data['erp_project_id']} doesn't exist. Pick it from the list again, or leave it blank.")
    if data.get("department_id"):
        from app.modules.organization.models.department import Department
        if db.get(Department, data["department_id"]) is None:
            raise HTTPException(status_code=404, detail=f"Department #{data['department_id']} doesn't exist. Pick it from the list again.")


def _check_person(db: Session, p: HrSafetyPersonPayload) -> None:
    svc.check_choice(p.person_type, PERSON_TYPES, "person category")
    svc.check_choice(p.outcome, PERSON_OUTCOMES, "injury outcome")
    if p.person_type == "employee":
        if not p.user_id:
            raise HTTPException(status_code=400, detail="Pick the employee who was involved, or change the category to Contractor worker / Visitor and type their name.")
        target = db.get(User, p.user_id)
        if target is None:
            raise HTTPException(status_code=404, detail=f"Employee (user #{p.user_id}) doesn't exist. Pick them from the list again.")
    elif not (p.external_name or "").strip():
        raise HTTPException(status_code=400, detail=f"Type the name of the {PERSON_TYPES[p.person_type].lower()} who was involved.")
    if p.outcome == "lost_time" and p.lost_days < 1:
        raise HTTPException(status_code=400, detail="A lost-time injury needs the number of days lost (at least 1). Use 'Medical treatment' if the person came back the same or next shift.")
    if p.outcome != "lost_time" and p.lost_days:
        raise HTTPException(status_code=400, detail="Days lost is only for a lost-time injury — set the outcome to 'Lost time' or the days to 0.")
    if p.return_to_work_date and p.return_to_work_date > today_ist():
        raise HTTPException(status_code=400, detail="The return-to-work date is in the future. Record it once the person is back at work.")


def _check_fatal_consistency(inc: HrSafetyIncident) -> None:
    if any(p.outcome == "fatal" for p in inc.persons) and inc.severity != "fatal":
        raise HTTPException(status_code=400, detail="A person is recorded as fatal but the incident severity isn't 'Fatal'. Set the severity to Fatal.")


def _person_row(p: HrSafetyPersonPayload) -> dict:
    d = p.model_dump()
    if p.person_type == "employee":
        d["external_name"] = None
        d["external_company"] = None
    else:
        d["user_id"] = None
        d["external_name"] = (p.external_name or "").strip()
    return d


def _witnesses(items) -> list[dict]:
    out = []
    for w in items or []:
        name = (w.name or "").strip()
        if not name and not w.user_id:
            raise HTTPException(status_code=400, detail="Every witness needs a name or an employee picked.")
        out.append({"user_id": w.user_id, "name": name or None, "statement": (w.statement or "").strip() or None})
    return out


# ─────────────────────────────── notifications (bell) ───────────────────────────────
def _alert_new(db: Session, inc: HrSafetyIncident, actor: User, background_tasks=None) -> None:
    from app.modules.organization.models.branch import Branch

    targets: set[int] = set(engine.permission_holders(db, "hr:safety:edit"))
    branch = db.get(Branch, inc.branch_id) if inc.branch_id else None
    if branch and branch.head_user_id:
        targets.add(branch.head_user_id)
    if inc.severity in ("high", "fatal"):
        targets |= {u.id for u in db.query(User.id).filter(User.is_partner.is_(True), User.is_active.is_(True)).all()}
    targets.discard(actor.id)
    label = INCIDENT_TYPES.get(inc.incident_type, inc.incident_type)
    title = f"{'URGENT — ' if inc.severity in ('high', 'fatal') else ''}Safety incident {inc.incident_no}"
    message = (f"{label} ({SEVERITIES[inc.severity]}) at {branch.name if branch else 'site'}"
               f"{' — ' + inc.location_text if inc.location_text else ''}: {inc.title}. Reported by {actor.name}.")
    for uid in targets:
        notify_user(db, uid, title, message, svc.NOTIFY_TYPE, svc.ENTITY, inc.id)
    # Role event for everyone else whose role subscribed (EHS, plant heads …).
    from app.modules.hr.services import role_events
    role_events.fire(db, background_tasks, "safety_incident_reported", title=title, message=message,
                     entity_type=svc.ENTITY, entity_id=inc.id, actor=actor,
                     can_open=role_events.record_opener(db, inc), skip=targets)


# ─────────────────────────────── meta / lists ───────────────────────────────
@router.get("/meta")
async def safety_meta(db: Session = Depends(get_db), _user: User = Depends(get_current_user)):
    from app.modules.erp.models.project import Project as ErpProject
    from app.modules.maintenance.models.asset import MaintenanceAsset
    from app.modules.organization.models.department import Department

    assets = db.query(MaintenanceAsset.id, MaintenanceAsset.asset_code, MaintenanceAsset.name).order_by(MaintenanceAsset.asset_code).limit(3000).all()
    projects = db.query(ErpProject.id, ErpProject.serial_number, ErpProject.model_name).order_by(ErpProject.id.desc()).limit(3000).all()
    return {
        "incident_types": [{"value": k, "label": v} for k, v in INCIDENT_TYPES.items()],
        "severities": [{"value": k, "label": v} for k, v in SEVERITIES.items()],
        "statuses": [{"value": k, "label": v} for k, v in INCIDENT_STATUSES.items()],
        "person_types": [{"value": k, "label": v} for k, v in PERSON_TYPES.items()],
        "outcomes": [{"value": k, "label": v} for k, v in PERSON_OUTCOMES.items()],
        "action_types": [{"value": k, "label": v} for k, v in ACTION_TYPES.items()],
        "root_cause_categories": [{"value": k, "label": v} for k, v in svc.ROOT_CAUSE_CATEGORIES.items()],
        "branches": [{"id": k, "name": v} for k, v in sorted(branch_names(db).items(), key=lambda kv: kv[1])],
        "departments": [{"id": d.id, "name": d.name, "branch_id": d.branch_id} for d in db.query(Department).order_by(Department.name).all()],
        "employees": [{"id": u.id, "name": u.name, "email": u.email}
                      for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all()],
        "assets": [{"id": a.id, "label": f"{a.asset_code} — {a.name}"} for a in assets],
        "projects": [{"id": p.id, "label": f"{p.serial_number}{' — ' + p.model_name if p.model_name else ''}"} for p in projects],
    }


def _apply_filters(q, status, incident_type, severity, branch_id, search, date_from, date_to, open_only):
    if status:
        svc.check_choice(status, INCIDENT_STATUSES, "status")
        q = q.filter(HrSafetyIncident.status == status)
    elif open_only:
        q = q.filter(HrSafetyIncident.status.in_(svc.OPEN_STATUSES))
    if incident_type:
        svc.check_choice(incident_type, INCIDENT_TYPES, "incident type")
        q = q.filter(HrSafetyIncident.incident_type == incident_type)
    if severity:
        svc.check_choice(severity, SEVERITIES, "severity")
        q = q.filter(HrSafetyIncident.severity == severity)
    if branch_id:
        q = q.filter(HrSafetyIncident.branch_id == branch_id)
    if date_from:
        q = q.filter(HrSafetyIncident.occurred_at >= datetime.combine(date_from, time.min).replace(tzinfo=IST))
    if date_to:
        q = q.filter(HrSafetyIncident.occurred_at <= datetime.combine(date_to, time.max).replace(tzinfo=IST))
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(or_(HrSafetyIncident.incident_no.ilike(like), HrSafetyIncident.title.ilike(like),
                         HrSafetyIncident.location_text.ilike(like)))
    return q


def _rows(db: Session, q) -> list[dict]:
    incs = q.options(selectinload(HrSafetyIncident.persons), selectinload(HrSafetyIncident.actions)) \
        .order_by(HrSafetyIncident.occurred_at.desc(), HrSafetyIncident.id.desc()).limit(2000).all()
    branches = branch_names(db)
    users = users_by_id(db, [i.reported_by_id for i in incs] + [i.investigation_lead_id for i in incs])
    return [_summary_row(i, branches, users) for i in incs]


@router.get("/incidents")
async def list_incidents(
    status: str | None = Query(None), incident_type: str | None = Query(None), severity: str | None = Query(None),
    branch_id: int | None = Query(None), q: str | None = Query(None), date_from: date | None = Query(None),
    date_to: date | None = Query(None), open_only: bool = Query(False),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    ensure_tab_action(user, "hr", TAB, "view")
    query = apply_scope(db.query(HrSafetyIncident), user, HrSafetyIncident, db)
    return _rows(db, _apply_filters(query, status, incident_type, severity, branch_id, q, date_from, date_to, open_only))


@router.get("/incidents/mine")
async def my_incidents(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Incidents I reported, investigate, own a CAPA on, or was involved in (My HR)."""
    ensure_tab_action(user, "hr", "me", "view")
    q = db.query(HrSafetyIncident).filter(or_(
        HrSafetyIncident.reported_by_id == user.id, HrSafetyIncident.created_by_id == user.id,
        HrSafetyIncident.investigation_lead_id == user.id,
        HrSafetyIncident.id.in_(select(HrSafetyAction.incident_id).where(HrSafetyAction.owner_id == user.id)),
        HrSafetyIncident.id.in_(select(HrSafetyIncidentPerson.incident_id).where(HrSafetyIncidentPerson.user_id == user.id)),
    ))
    return _rows(db, q)


@router.get("/actions/mine")
async def my_actions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (db.query(HrSafetyAction, HrSafetyIncident).join(HrSafetyIncident, HrSafetyIncident.id == HrSafetyAction.incident_id)
            .filter(HrSafetyAction.owner_id == user.id, HrSafetyAction.status == "open")
            .order_by(HrSafetyAction.due_date.asc()).all())
    today = today_ist()
    return [{"id": a.id, "incident_id": i.id, "incident_no": i.incident_no, "incident_title": i.title,
             "action_type": a.action_type, "description": a.description, "due_date": a.due_date,
             "is_overdue": a.due_date < today} for a, i in rows]


# ─────────────────────────────── create / read / update ───────────────────────────────
@router.post("/incidents", response_model=HrSafetyIncidentResponse)
async def create_incident(payload: HrSafetyIncidentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user),
                          background_tasks: BackgroundTasks = None):
    _ensure_reporter(user)
    data = payload.model_dump(exclude={"persons", "witnesses"})
    _check_core(db, data)
    for p in payload.persons:
        _check_person(db, p)
    occurred = as_ist(payload.occurred_at)
    fy = svc.incident_fy(occurred.date())
    inc = HrSafetyIncident(
        incident_no=next_sequential_id(db, prefix=f"INC-{fy}-", column=HrSafetyIncident.incident_no),
        **{**data, "title": payload.title.strip(), "description": payload.description.strip(), "occurred_at": occurred},
    )
    if inc.branch_id is None:
        inc.branch_id = user.branch_id
    inc.status = "reported"
    inc.reported_at = now_ist()
    inc.reported_by_id = user.id
    inc.created_by_id = user.id
    inc.witnesses = _witnesses(payload.witnesses)
    inc.persons = [HrSafetyIncidentPerson(**_person_row(p)) for p in payload.persons]
    _check_fatal_consistency(inc)
    db.add(inc)
    db.flush()
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="reported", module_key="hr",
                 summary=f"Reported {inc.incident_no}: {INCIDENT_TYPES[inc.incident_type]} ({SEVERITIES[inc.severity]}) — {inc.title}",
                 user_id=user.id)
    _alert_new(db, inc, user, background_tasks)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.get("/incidents/{incident_id}", response_model=HrSafetyIncidentResponse)
async def get_incident(incident_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id)
    _ensure_view(db, user, inc)
    return _out(db, inc, user)


@router.patch("/incidents/{incident_id}", response_model=HrSafetyIncidentResponse)
async def update_incident(incident_id: int, payload: HrSafetyIncidentUpdate, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc)
    svc.ensure_open(inc)
    data = payload.model_dump(exclude_unset=True, exclude={"witnesses"})
    for required in ("title", "incident_type", "severity", "occurred_at", "description"):
        if required in data and data[required] is None:
            raise HTTPException(status_code=400, detail=f"{required.replace('_', ' ').capitalize()} can't be blank.")
    _check_core(db, data)
    if "occurred_at" in data:
        data["occurred_at"] = as_ist(data["occurred_at"])
    for k, v in data.items():
        setattr(inc, k, v.strip() if isinstance(v, str) and k in ("title", "description") else v)
    if payload.witnesses is not None:
        inc.witnesses = _witnesses(payload.witnesses)
    _check_fatal_consistency(inc)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.delete("/incidents/{incident_id}")
async def delete_incident(incident_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    ensure_can_delete(user, inc, "hr", TAB, "incident")
    ensure_in_scope(db, user, inc)
    if inc.status != "reported":
        raise HTTPException(status_code=409, detail=(
            f"{inc.incident_no} is already {INCIDENT_STATUSES[inc.status].lower()}, so it stays in the accident register. "
            "Only an incident that is still 'Reported' (e.g. raised by mistake) can be deleted."))
    if inc.attachments:
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} has {len(inc.attachments)} attachment(s). Remove them first, then delete the incident.")
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="deleted", module_key="hr",
                 summary=f"Deleted {inc.incident_no} ({inc.title})", user_id=user.id)
    db.delete(inc)
    db.commit()
    return {"deleted": True}


# ─────────────────────────────── persons ───────────────────────────────
@router.post("/incidents/{incident_id}/persons", response_model=HrSafetyIncidentResponse)
async def add_person(incident_id: int, payload: HrSafetyPersonPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    svc.ensure_open(inc)
    _check_person(db, payload)
    inc.persons.append(HrSafetyIncidentPerson(**_person_row(payload)))
    _check_fatal_consistency(inc)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


def _person(inc: HrSafetyIncident, person_id: int) -> HrSafetyIncidentPerson:
    for p in inc.persons:
        if p.id == person_id:
            return p
    raise HTTPException(status_code=404, detail=f"That person isn't on {inc.incident_no} any more. Refresh the page.")


@router.put("/incidents/{incident_id}/persons/{person_id}", response_model=HrSafetyIncidentResponse)
async def update_person(incident_id: int, person_id: int, payload: HrSafetyPersonPayload, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    svc.ensure_open(inc)
    _check_person(db, payload)
    p = _person(inc, person_id)
    for k, v in _person_row(payload).items():
        setattr(p, k, v)
    _check_fatal_consistency(inc)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.delete("/incidents/{incident_id}/persons/{person_id}", response_model=HrSafetyIncidentResponse)
async def remove_person(incident_id: int, person_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    svc.ensure_open(inc)
    inc.persons.remove(_person(inc, person_id))
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


# ─────────────────────────────── investigation ───────────────────────────────
@router.post("/incidents/{incident_id}/start-investigation", response_model=HrSafetyIncidentResponse)
async def start_investigation(incident_id: int, payload: HrSafetyIncidentInvestigatePayload, db: Session = Depends(get_db),
                              user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc)
    svc.ensure_open(inc, "re-assigned")
    lead = require_active_user(db, payload.investigation_lead_id, "investigation lead")
    changed = inc.investigation_lead_id != lead.id
    if changed:
        assignee_rules.ensure_allowed(db, user, LEAD_RULE_KEY, lead)
    inc.investigation_lead_id = lead.id
    if inc.status == "reported":
        inc.status = "under_investigation"
        inc.investigation_started_at = datetime.now(timezone.utc)
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="investigation_started", module_key="hr",
                 summary=f"Investigation of {inc.incident_no} led by {lead.name}", user_id=user.id)
    if changed and lead.id != user.id:
        notify_user(db, lead.id, f"Investigate safety incident {inc.incident_no}",
                    f"{user.name} asked you to lead the investigation of {inc.incident_no}: {inc.title}. Record the root cause and CAPA actions in HR › Safety.",
                    svc.NOTIFY_TYPE, svc.ENTITY, inc.id)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.put("/incidents/{incident_id}/investigation", response_model=HrSafetyIncidentResponse)
async def save_investigation(incident_id: int, payload: HrSafetyIncidentInvestigationPayload, db: Session = Depends(get_db),
                             user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    svc.ensure_open(inc)
    if inc.status == "reported":
        raise HTTPException(status_code=409, detail=f"Start the investigation of {inc.incident_no} first (pick the investigation lead).")
    svc.check_choice(payload.root_cause_category, svc.ROOT_CAUSE_CATEGORIES, "root-cause category")
    for k in ("root_cause", "root_cause_category", "contributing_factors", "no_action_reason"):
        v = getattr(payload, k)
        setattr(inc, k, (v.strip() or None) if isinstance(v, str) else v)
    if payload.complete:
        missing = [label for label, v in (("root cause", inc.root_cause), ("root-cause category", inc.root_cause_category)) if not v]
        if missing:
            raise HTTPException(status_code=400, detail=f"Record the {' and '.join(missing)} before completing the investigation.")
        if not inc.actions and not inc.no_action_reason:
            raise HTTPException(status_code=400, detail=(
                "Add at least one corrective / preventive action, or say why none is needed, before completing the investigation."))
        inc.investigation_completed_at = inc.investigation_completed_at or datetime.now(timezone.utc)
        inc.status = "actions_open"
        record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="investigation_completed", module_key="hr",
                     summary=f"Investigation of {inc.incident_no} completed — root cause: {inc.root_cause[:200]}", user_id=user.id)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


# ─────────────────────────────── CAPA ───────────────────────────────
def _action(inc: HrSafetyIncident, action_id: int) -> HrSafetyAction:
    for a in inc.actions:
        if a.id == action_id:
            return a
    raise HTTPException(status_code=404, detail=f"That action isn't on {inc.incident_no} any more. Refresh the page.")


def _notify_owner(db: Session, inc: HrSafetyIncident, a: HrSafetyAction, actor: User) -> None:
    if a.owner_id != actor.id:
        notify_user(db, a.owner_id, f"Safety action assigned — {inc.incident_no}",
                    f"{actor.name} assigned you a {ACTION_TYPES[a.action_type].lower()} action on {inc.incident_no}, due "
                    f"{a.due_date:%d-%m-%Y}: {a.description[:200]}", svc.NOTIFY_TYPE, svc.ENTITY, inc.id)
    # Role event (EHS supervisors tracking CAPA); the owner got the direct notice.
    from app.modules.hr.services import role_events
    owner = db.get(User, a.owner_id)
    role_events.fire(
        db, None, "capa_assigned", title=f"CAPA assigned on {inc.incident_no}",
        message=(f"{actor.name} gave {owner.name if owner else 'an owner'} a {ACTION_TYPES[a.action_type].lower()} action on "
                 f"{inc.incident_no} ({inc.title}), due {a.due_date:%d-%m-%Y}: {a.description[:200]}"),
        entity_type=svc.ENTITY, entity_id=inc.id, actor=actor, can_open=role_events.record_opener(db, inc), skip={a.owner_id},
    )


@router.post("/incidents/{incident_id}/actions", response_model=HrSafetyIncidentResponse)
async def add_action(incident_id: int, payload: HrSafetyActionPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    _ensure_capa(user, inc, "create")
    svc.ensure_open(inc)
    if inc.status == "reported":
        raise HTTPException(status_code=409, detail=f"Start the investigation of {inc.incident_no} first — CAPA actions come out of the investigation.")
    svc.check_choice(payload.action_type, ACTION_TYPES, "action type")
    assignee_rules.ensure_allowed(db, user, CAPA_RULE_KEY, require_active_user(db, payload.owner_id, "action owner"))
    if payload.due_date < today_ist():
        raise HTTPException(status_code=400, detail="The due date is in the past. Give the owner a realistic future date.")
    a = HrSafetyAction(action_type=payload.action_type, description=payload.description.strip(), owner_id=payload.owner_id,
                       due_date=payload.due_date, status="open", created_by_id=user.id)
    inc.actions.append(a)
    db.flush()
    _notify_owner(db, inc, a, user)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.patch("/incidents/{incident_id}/actions/{action_id}", response_model=HrSafetyIncidentResponse)
async def update_action(incident_id: int, action_id: int, payload: HrSafetyActionUpdate, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    _ensure_capa(user, inc, "edit")
    svc.ensure_open(inc)
    a = _action(inc, action_id)
    if a.status != "open":
        raise HTTPException(status_code=409, detail=f"This action is already {a.status}, so it can't be changed.")
    data = payload.model_dump(exclude_unset=True)
    svc.check_choice(data.get("action_type"), ACTION_TYPES, "action type")
    if data.get("owner_id"):
        owner = require_active_user(db, data["owner_id"], "action owner")
        if owner.id != a.owner_id:
            assignee_rules.ensure_allowed(db, user, CAPA_RULE_KEY, owner)
    if data.get("due_date") and data["due_date"] < today_ist():
        raise HTTPException(status_code=400, detail="The new due date is in the past. Pick today or a later date.")
    owner_changed = data.get("owner_id") and data["owner_id"] != a.owner_id
    for k, v in data.items():
        if v is not None:
            setattr(a, k, v.strip() if isinstance(v, str) and k == "description" else v)
    if owner_changed:
        _notify_owner(db, inc, a, user)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.post("/incidents/{incident_id}/actions/{action_id}/complete", response_model=HrSafetyIncidentResponse)
async def complete_action(incident_id: int, action_id: int, payload: HrSafetyActionCompletePayload, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    a = _action(inc, action_id)
    if user.id != a.owner_id:
        _ensure_manage(db, user, inc, allow_lead=True)
    svc.ensure_open(inc, "updated")
    if a.status != "open":
        raise HTTPException(status_code=409, detail=f"This action is already {a.status}.")
    done_on = payload.completed_on or today_ist()
    if done_on > today_ist():
        raise HTTPException(status_code=400, detail="The completion date is in the future. Mark the action done once it is actually done.")
    a.status = "done"
    a.completion_remarks = payload.remarks.strip()
    a.completed_on = done_on
    a.completed_by_id = user.id
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="capa_done", module_key="hr",
                 summary=f"CAPA on {inc.incident_no} done: {a.description[:120]}", user_id=user.id)
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.post("/incidents/{incident_id}/actions/{action_id}/cancel", response_model=HrSafetyIncidentResponse)
async def cancel_action(incident_id: int, action_id: int, payload: HrSafetyActionCompletePayload, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    _ensure_capa(user, inc, "cancel")
    svc.ensure_open(inc)
    a = _action(inc, action_id)
    if a.status != "open":
        raise HTTPException(status_code=409, detail=f"This action is already {a.status}.")
    a.status = "cancelled"
    a.completion_remarks = f"Cancelled: {payload.remarks.strip()}"
    a.completed_by_id = user.id
    svc.bump_document(inc)
    db.commit()
    return _out(db, _load(db, inc.id), user)


# ─────────────────────────────── statutory / closure ───────────────────────────────
@router.put("/incidents/{incident_id}/statutory", response_model=HrSafetyIncidentResponse)
async def save_statutory(incident_id: int, payload: HrSafetyIncidentStatutoryPayload, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc)
    ensure_feature_action(user, "hr", "safety", "statutory", "edit")
    if inc.status == "closed":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} is closed, so its statutory details can't be changed.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("form18_submitted_on"):
        if data["form18_submitted_on"] > today_ist():
            raise HTTPException(status_code=400, detail="The Form 18 submission date is in the future. Enter the date it was actually sent to the Inspector.")
        if data["form18_submitted_on"] < as_ist(inc.occurred_at).date():
            raise HTTPException(status_code=400, detail="Form 18 can't have been submitted before the incident happened. Check the date.")
    # reportable_manual only ADDS an incident to the statutory set; the s.88 /
    # 88A criteria (svc.is_reportable) still apply when it is off.
    for k, v in data.items():
        if k == "reportable_manual" and v is None:
            continue
        setattr(inc, k, v.strip() if isinstance(v, str) else v)
    svc.bump_document(inc)
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="statutory_updated", module_key="hr",
                 summary=f"{inc.incident_no} statutory details: Form 18 {inc.form18_submitted_on or 'not submitted'}"
                         + (f", ref {inc.authority_ref}" if inc.authority_ref else ""), user_id=user.id)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.post("/incidents/{incident_id}/submit-closure", response_model=HrSafetyIncidentResponse)
async def submit_closure(incident_id: int, payload: HrSafetyIncidentClosePayload, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    if inc.status not in ("under_investigation", "actions_open"):
        raise HTTPException(status_code=409, detail=(
            f"{inc.incident_no} is {INCIDENT_STATUSES[inc.status].lower()} — closure can be asked for once it has been "
            "investigated and its actions are done."))
    blockers = svc.closure_blockers(inc)
    if blockers:
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} can't be closed yet: " + "; ".join(blockers) + ".")
    inc.status = "closure_pending"
    inc.closure_remarks = payload.remarks.strip()
    inc.closure_submitted_by_id = user.id
    db.flush()
    engine.submit(
        db, svc.CLOSURE_KEY, entity_id=inc.id, requester=user,
        title=f"Close safety incident {inc.incident_no} — {inc.title}", reference=inc.incident_no,
        context={"severity": inc.severity, "incident_type": inc.incident_type, "lost_days": svc.lost_days(inc),
                 "reportable": svc.is_reportable(inc)},
        branch_id=inc.branch_id,
    )
    record_audit(db, entity_type=svc.ENTITY, entity_id=inc.id, action="closure_submitted", module_key="hr",
                 summary=f"Closure of {inc.incident_no} submitted for approval: {inc.closure_remarks}", user_id=user.id)
    db.commit()
    return _out(db, _load(db, inc.id), user)


@router.post("/incidents/{incident_id}/withdraw-closure", response_model=HrSafetyIncidentResponse)
async def withdraw_closure(incident_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    inc = _load(db, incident_id, lock=True)
    _ensure_manage(db, user, inc, allow_lead=True)
    if inc.status != "closure_pending":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} isn't waiting for closure approval.")
    req = engine.latest_request(db, svc.ENTITY, inc.id)
    if req is not None and req.status == "pending":
        engine.cancel(db, req.id, user, "Closure withdrawn", force=True)
    if inc.status == "closure_pending":
        inc.status = "actions_open"
    db.commit()
    return _out(db, _load(db, inc.id), user)


# ─────────────────────────────── attachments ───────────────────────────────
@router.post("/incidents/{incident_id}/attachments", response_model=HrSafetyIncidentResponse)
async def upload_attachment(incident_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                            user: User = Depends(get_current_user)):
    from app.utils.sharepoint import upload_file_to_sharepoint

    inc = _load(db, incident_id, lock=True)
    if user.id not in {inc.reported_by_id, inc.investigation_lead_id}:
        _ensure_manage(db, user, inc)
    if inc.status == "closed":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} is closed, so no more files can be added.")
    site_id = require_sharepoint(settings.SHAREPOINT_SITE_ID)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"'{file.filename}' is empty. Choose the file again.")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail=f"'{file.filename}' is {len(content) / 1024 / 1024:.1f} MB; files can be at most 15 MB. Compress the photo or split the scan.")
    await file.seek(0)
    result = await upload_file_to_sharepoint(site_id, f"{settings.SHAREPOINT_FOLDER}/hr/safety/{inc.incident_no}", file)
    inc.attachments.append(HrSafetyAttachment(filename=result.get("name") or file.filename or "file", sharepoint_path=result["path"],
                                              sharepoint_url=result.get("webUrl"), size_bytes=len(content), uploaded_by_id=user.id))
    db.commit()
    return _out(db, _load(db, inc.id), user)


def _attachment(inc: HrSafetyIncident, att_id: int) -> HrSafetyAttachment:
    for a in inc.attachments:
        if a.id == att_id:
            return a
    raise HTTPException(status_code=404, detail=f"That file isn't on {inc.incident_no} any more. Refresh the page.")


@router.get("/incidents/{incident_id}/attachments/{att_id}")
async def get_attachment(incident_id: int, att_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.utils.sharepoint import download_file_content

    inc = _load(db, incident_id)
    _ensure_view(db, user, inc)
    att = _attachment(inc, att_id)
    content, content_type = await download_file_content(require_sharepoint(settings.SHAREPOINT_SITE_ID), att.sharepoint_path)
    return Response(content=content, media_type=content_type,
                    headers={"Content-Disposition": f'inline; filename="{att.filename.replace(chr(34), "")}"'})


@router.delete("/incidents/{incident_id}/attachments/{att_id}", response_model=HrSafetyIncidentResponse)
async def delete_attachment(incident_id: int, att_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.utils.sharepoint import delete_file_from_sharepoint

    inc = _load(db, incident_id, lock=True)
    att = _attachment(inc, att_id)
    if att.uploaded_by_id != user.id:
        _ensure_manage(db, user, inc)
    if inc.status == "closed":
        raise HTTPException(status_code=409, detail=f"{inc.incident_no} is closed — its files are part of the record and can't be removed.")
    path = att.sharepoint_path
    inc.attachments.remove(att)
    db.commit()
    if settings.SHAREPOINT_SITE_ID:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, path)
        except Exception:  # noqa: BLE001 — the record is gone; an orphaned file is harmless
            pass
    return _out(db, _load(db, inc.id), user)


# ─────────────────────────────── register / stats ───────────────────────────────
def _period(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = today_ist()
    start = date_from or date(today.year if today.month >= 4 else today.year - 1, 4, 1)
    end = date_to or today
    if end < start:
        raise HTTPException(status_code=400, detail="'To' date is before 'from' date. Swap them and try again.")
    return start, end


def _register_rows(db: Session, user: User, start: date, end: date, branch_id: int | None, reportable_only: bool) -> list[dict]:
    q = apply_scope(db.query(HrSafetyIncident), user, HrSafetyIncident, db)
    q = _apply_filters(q, None, None, None, branch_id, None, start, end, False)
    incs = q.options(selectinload(HrSafetyIncident.persons)).order_by(HrSafetyIncident.occurred_at.asc()).all()
    users = users_by_id(db, [p.user_id for i in incs for p in i.persons])
    branches = branch_names(db)
    out = []
    for i in incs:
        if reportable_only and not svc.is_reportable(i):
            continue
        injured = [p for p in i.persons if p.outcome != "no_injury"]
        out.append({
            "id": i.id, "incident_no": i.incident_no, "occurred_at": i.occurred_at, "branch_name": branches.get(i.branch_id or 0),
            "location_text": i.location_text, "incident_type": i.incident_type, "severity": i.severity, "title": i.title,
            "persons": "; ".join(((users[p.user_id].name if p.user_id in users else None) or p.external_name or "—")
                                 + f" ({PERSON_OUTCOMES.get(p.outcome, p.outcome)})" for p in injured),
            "injuries": "; ".join(x for x in (", ".join(y for y in (p.injury_nature, p.body_part) if y) for p in injured) if x),
            "lost_days": svc.lost_days(i), "reportable": svc.is_reportable(i), "form18_submitted_on": i.form18_submitted_on,
            "authority_ref": i.authority_ref, "status": i.status,
        })
    return out


@router.get("/register")
async def accident_register(date_from: date | None = Query(None), date_to: date | None = Query(None),
                            branch_id: int | None = Query(None), reportable_only: bool = Query(False),
                            db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Register of accidents and dangerous occurrences (Factories Rules Form 26 layout)."""
    ensure_tab_action(user, "hr", TAB, "view")
    start, end = _period(date_from, date_to)
    return {"from_date": start, "to_date": end, "items": _register_rows(db, user, start, end, branch_id, reportable_only)}


@router.get("/register/export")
async def export_register(date_from: date | None = Query(None), date_to: date | None = Query(None),
                          branch_id: int | None = Query(None), reportable_only: bool = Query(False),
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ensure_tab_action(user, "hr", TAB, "export")
    start, end = _period(date_from, date_to)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Incident no", "Date & time", "Plant", "Place", "Type", "Severity", "Description", "Persons injured",
                "Nature of injury", "Days lost", "Reportable (Form 18)", "Form 18 sent on", "Inspector ref", "Status"])
    for r in _register_rows(db, user, start, end, branch_id, reportable_only):
        w.writerow([r["incident_no"], as_ist(r["occurred_at"]).strftime("%d-%m-%Y %H:%M"), r["branch_name"] or "", r["location_text"] or "",
                    INCIDENT_TYPES.get(r["incident_type"]), SEVERITIES.get(r["severity"]), r["title"], r["persons"], r["injuries"],
                    r["lost_days"], "Yes" if r["reportable"] else "No",
                    r["form18_submitted_on"].strftime("%d-%m-%Y") if r["form18_submitted_on"] else "", r["authority_ref"] or "",
                    INCIDENT_STATUSES.get(r["status"])])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="accident_register_{start}_{end}.csv"'})


@router.get("/stats")
async def safety_stats(date_from: date | None = Query(None), date_to: date | None = Query(None),
                       branch_id: int | None = Query(None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ensure_tab_action(user, "hr", TAB, "view")
    start, end = _period(date_from, date_to)
    q = _apply_filters(apply_scope(db.query(HrSafetyIncident), user, HrSafetyIncident, db),
                       None, None, None, branch_id, None, start, end, False)
    incs = q.options(selectinload(HrSafetyIncident.persons), selectinload(HrSafetyIncident.actions)).all()
    by_type = {k: 0 for k in INCIDENT_TYPES}
    by_sev = {k: 0 for k in SEVERITIES}
    for i in incs:
        by_type[i.incident_type] = by_type.get(i.incident_type, 0) + 1
        by_sev[i.severity] = by_sev.get(i.severity, 0) + 1
    lti = sum(svc.lti_count(i) for i in incs)
    days_lost = sum(svc.lost_days(i) for i in incs)
    hours = man_minutes(db, start, end, branch_id) / 60
    today = today_ist()
    return {
        "from_date": start, "to_date": end, "total": len(incs), "by_type": by_type, "by_severity": by_sev,
        "open": sum(1 for i in incs if i.status in svc.OPEN_STATUSES),
        "lti": lti, "lost_days": days_lost, "fatalities": sum(1 for i in incs for p in i.persons if p.outcome == "fatal"),
        "man_hours": round(hours, 1),
        "ltifr": round(lti * 1_000_000 / hours, 2) if hours else None,
        "severity_rate": round(days_lost * 1_000_000 / hours, 2) if hours else None,
        "overdue_actions": sum(1 for i in incs for a in i.actions if a.status == "open" and a.due_date < today),
        "form18_pending": sum(1 for i in incs if svc.is_reportable(i) and not i.form18_submitted_on),
    }


# ─────────────────────────────── Form 18 document ───────────────────────────────
def _form18_target(db: Session, entity_id: int, user: User, modify: bool):
    from app.modules.quality.reports.render import render_docx

    inc = _load(db, entity_id)
    _ensure_view(db, user, inc)
    # Same gate as the Form 18 PDF (print) and the statutory details (edit) —
    # being a party to the incident isn't enough to open or edit the form.
    ensure_feature_action(user, "hr", "safety", "statutory", "edit" if modify else "print")
    if modify:
        _ensure_manage(db, user, inc, allow_lead=True)
    spec = svc.form18_spec(db, inc)
    return managed_documents.DocumentTarget(
        entity_id=inc.id, revision=inc.document_revision or 0, title=f"Form 18 {inc.incident_no}",
        folder=managed_documents.sharepoint_folder("HR", "Safety", inc.incident_no),
        filename_stem=managed_documents.safe_filename(f"Form18-{spec['number']}"),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(entity_type=svc.FORM18_ENTITY, app="hr", load=_form18_target))


@router.get("/incidents/{incident_id}/form18.pdf")
async def form18_pdf(incident_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.modules.quality.reports.render import render_pdf

    inc = _load(db, incident_id)
    _ensure_view(db, user, inc)
    ensure_feature_action(user, "hr", "safety", "statutory", "print")
    spec = svc.form18_spec(db, inc)

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {now_ist():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the Form 18 PDF: {e}")

    pdf = (await managed_documents.pdf_of_record(db, svc.FORM18_ENTITY, inc.id, inc.document_revision or 0, render=render)
           if managed_documents else render())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="Form18-{inc.incident_no}.pdf"'})
