"""Incoming design work and the designer's day:

- Design requests (BD technical requirements, R&D hand-overs, internal),
  with revisable requirements and the "changed since your review" flag.
- Design WBS elements from Project Management, with the evidence Design has
  released for them (read-only on the PM side — PM tables aren't changed).
- My Work: my PM tasks, each linked to the drawing/BOM it produces, so a
  task shows "ready to close" once its deliverable is released."""
from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.design.access import head_ids, is_head, next_number, require_team, year_prefix
from app.modules.design.bom_service import bom_display_status, released_bom_revision
from app.modules.design.models.bom import DesignBom
from app.modules.design.models.document import DesignDocument
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.request import (
    DesignRequest, DesignRequirementRevision, DesignTaskDeliverable, DESIGN_REQUEST_ACTIVE_STATUSES,
    DESIGN_REQUEST_PRIORITIES, DESIGN_REQUEST_SOURCES,
)
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.schemas.request import (
    DesignMilestoneEvidence, DesignRequestCreate, DesignRequestDeliverable, DesignRequestDetail, DesignRequestResponse,
    DesignRequestRevisePayload, DesignRequestStatusPayload, DesignRequestUpdate, DesignRequestWaitingPayload,
    DesignRequirementRevisionResponse, DesignTaskDeliverableCreate, DesignWorkTask,
)
from app.modules.design.service import (
    add_event, display_status, ensure_assignee_rule, get_workflow_user, is_admin, notify, released_revision, user_name, users_by_id, utcnow,
)
from app.modules.erp.models.project import Project
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.design.events import notify_design_event
from app.modules.design.features import ensure_design_feature, gate_actions, has
from app.modules.design.order_project_links import clean_op_link, fill_op_labels
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PM_TASK_OPEN_STATUSES

router = APIRouter(prefix="/design", tags=["Design"], dependencies=[Depends(require_app_access("design"))])

_NOTIFY_ENTITY = "design_request"
# "Assign to" rule for the lead designer (core/features/design.py).
LEAD_RULE = "design:project_work.request_progress"
_PHRASE = {"open": "open", "accepted": "accepted", "in_progress": "in progress", "on_hold": "on hold", "completed": "completed", "cancelled": "cancelled"}


def design_department_ids(db: Session) -> list[int]:
    """Departments whose WBS elements are Design's: the department master's
    'Design' department(s), matched by name or code."""
    return [d.id for d in db.query(Department).filter(
        func.lower(Department.name).like("%design%") | func.lower(Department.code).like("%design%") | (func.lower(Department.code) == "dsn")
    ).all()]


def _get(db: Session, request_id: int, lock: bool = False, user: User | None = None) -> DesignRequest:
    if lock:
        db.query(DesignRequest.id).filter(DesignRequest.id == request_id).with_for_update().first()
    req = db.query(DesignRequest).populate_existing().filter(DesignRequest.id == request_id, DesignRequest.is_deleted == False).first()  # noqa: E712
    if not req:
        raise HTTPException(status_code=404, detail=f"Design request #{request_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, req)
    return req


def _deliverables_for(db: Session, request_ids: list[int]) -> dict[int, list[DesignRequestDeliverable]]:
    out: dict[int, list[DesignRequestDeliverable]] = {}
    if not request_ids:
        return out
    for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(
        DesignDocument.design_request_id.in_(request_ids), DesignDocument.is_deleted == False  # noqa: E712
    ).order_by(DesignDocument.doc_number).all():
        rel = released_revision(d)
        out.setdefault(d.design_request_id, []).append(DesignRequestDeliverable(
            kind="document", id=d.id, number=d.doc_number, title=d.title, status=display_status(d),
            released_revision_label=rel.revision_label if rel else None,
        ))
    for b in db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(
        DesignBom.design_request_id.in_(request_ids), DesignBom.is_deleted == False  # noqa: E712
    ).order_by(DesignBom.bom_number).all():
        rel = released_bom_revision(b)
        out.setdefault(b.design_request_id, []).append(DesignRequestDeliverable(
            kind="bom", id=b.id, number=b.bom_number, title=b.title, status=bom_display_status(b),
            released_revision_label=rel.revision_label if rel else None,
        ))
    return out


def _responses(db: Session, reqs: list[DesignRequest], cls=DesignRequestResponse) -> list:
    users = users_by_id(db, {u for r in reqs for u in (r.lead_designer_id, r.requested_by_id)})
    def load(model, ids):
        ids = {i for i in ids if i}
        return {o.id: o for o in db.query(model).filter(model.id.in_(ids)).all()} if ids else {}

    orgs = {k: o.name for k, o in load(Organization, {r.customer_id for r in reqs}).items()}
    pms = load(PmProject, {r.pm_project_id for r in reqs})
    mss = load(PmProjectMilestone, {r.pm_milestone_id for r in reqs})
    machines = load(Project, {r.erp_project_id for r in reqs})
    deliverables = _deliverables_for(db, [r.id for r in reqs])
    today = date.today()
    out = []
    for r in reqs:
        resp = cls.model_validate(r)
        resp.customer_name = orgs.get(r.customer_id)
        pm = pms.get(r.pm_project_id)
        resp.pm_project_label = f"{pm.project_code} — {pm.name}" if pm else None
        ms = mss.get(r.pm_milestone_id)
        resp.pm_milestone_label = ms.title if ms else None
        resp.erp_project_label = machine_label(machines.get(r.erp_project_id))
        resp.lead_designer_name = user_name(users.get(r.lead_designer_id))
        resp.requested_by_name = user_name(users.get(r.requested_by_id))
        resp.changed_since_review = r.status in DESIGN_REQUEST_ACTIVE_STATUSES and r.requirement_revision > r.reviewed_revision and r.requirement_revision > 0
        resp.is_overdue = bool(r.due_date and r.due_date < today and r.status in DESIGN_REQUEST_ACTIVE_STATUSES)
        items = deliverables.get(r.id, [])
        resp.document_count = len(items)
        resp.released_count = sum(1 for d in items if d.released_revision_label)
        out.append(resp)
    fill_op_labels(db, reqs, out)
    return out


def _allowed(db: Session, user: User, req: DesignRequest) -> list[str]:
    head = is_head(db, user)
    owner = user.id in (req.requested_by_id, req.lead_designer_id)
    out = ["comment"]
    active = req.status in DESIGN_REQUEST_ACTIVE_STATUSES
    if active and (head or user.id == req.requested_by_id):
        out += ["edit", "revise"]
    if active and (head or owner):
        out.append("set_waiting")
    if active and req.requirement_revision > req.reviewed_revision and (head or user.id == req.lead_designer_id):
        out.append("acknowledge")
    if head:
        if req.status == "open":
            out.append("accept")
        if req.status == "accepted":
            out.append("start")
        if req.status in ("open", "accepted", "in_progress"):
            out.append("hold")
        if req.status == "on_hold":
            out.append("resume")
        if req.status in ("accepted", "in_progress"):
            out.append("complete")
        if active:
            out.append("cancel")
        if req.status in ("completed", "cancelled"):
            out.append("reopen")
    elif req.status == "in_progress" and user.id == req.lead_designer_id:
        out.append("complete")
    return out


def _detail(db: Session, req: DesignRequest, user: User) -> DesignRequestDetail:
    req = _get(db, req.id)
    resp: DesignRequestDetail = _responses(db, [req], DesignRequestDetail)[0]
    hist = db.query(DesignRequirementRevision).filter(DesignRequirementRevision.request_id == req.id).order_by(DesignRequirementRevision.revision.desc()).all()
    users = users_by_id(db, {h.revised_by_id for h in hist})
    resp.history = []
    for h in hist:
        hr = DesignRequirementRevisionResponse.model_validate(h)
        hr.revised_by_name = user_name(users.get(h.revised_by_id))
        resp.history.append(hr)
    resp.deliverables = _deliverables_for(db, [req.id]).get(req.id, [])
    events = db.query(DesignEvent).filter(DesignEvent.request_id == req.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        resp.events.append(er)
    if not has(user, "project_work", "timeline"):
        resp.events = []
    if not has(user, "project_work", "deliverables"):
        resp.deliverables = []
    if not has(user, "project_work", "technical_requirement"):
        resp.history, resp.requirement = [], ""
    resp.allowed_actions = gate_actions(user, "project_work", _allowed(db, user, req))
    return resp


def _crm_reference(db: Session, crm_source: str | None, record_id: int | None) -> tuple[str | None, int | None]:
    """(label, customer org id) of the linked inquiry/tender."""
    if not crm_source or not record_id:
        return None, None
    if crm_source == "inquiry":
        row = db.query(Inquiry).filter(Inquiry.id == record_id, Inquiry.is_deleted == False).first()  # noqa: E712
        if not row:
            raise HTTPException(status_code=400, detail=f"CRM inquiry #{record_id} wasn't found. Pick another inquiry or leave it blank.")
        return f"Inquiry {row.universal_id}", row.org_id
    if crm_source == "tender":
        row = db.query(Tender).filter(Tender.id == record_id, Tender.is_deleted == False).first()  # noqa: E712
        if not row:
            raise HTTPException(status_code=400, detail=f"CRM tender #{record_id} wasn't found. Pick another tender or leave it blank.")
        return f"Tender {row.tender_number or row.universal_id}" + (f" — {row.tender_name}" if row.tender_name else ""), row.org_id
    raise HTTPException(status_code=400, detail="The CRM reference must be an inquiry or a tender.")


def _validate(db: Session, values: dict) -> None:
    if values.get("source") is not None and values["source"] not in DESIGN_REQUEST_SOURCES:
        raise HTTPException(status_code=400, detail=f"'{values['source']}' isn't a valid source. Choose one of: {', '.join(DESIGN_REQUEST_SOURCES)}.")
    if values.get("priority") is not None and values["priority"] not in DESIGN_REQUEST_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"'{values['priority']}' isn't a valid priority. Choose one of: {', '.join(DESIGN_REQUEST_PRIORITIES)}.")
    if values.get("customer_id") and not db.query(Organization.id).filter(Organization.id == values["customer_id"]).first():
        raise HTTPException(status_code=400, detail=f"Customer #{values['customer_id']} wasn't found in CRM organizations.")
    if values.get("pm_milestone_id"):
        ms = db.query(PmProjectMilestone).filter(PmProjectMilestone.id == values["pm_milestone_id"]).first()
        if not ms:
            raise HTTPException(status_code=400, detail=f"WBS #{values['pm_milestone_id']} wasn't found in Project Management.")
        if not values.get("pm_project_id"):
            raise HTTPException(status_code=400, detail="A WBS was picked without its project — pick the project first, then its WBS (or clear the WBS).")
        if ms.project_id != values["pm_project_id"]:
            raise HTTPException(
                status_code=400,
                detail="That WBS belongs to a different project — pick a WBS of the selected project, or clear the WBS.",
            )
    if values.get("lead_designer_id"):
        get_workflow_user(db, values["lead_designer_id"], "lead designer")


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

@router.get("/requests", response_model=list[DesignRequestResponse])
async def list_requests(
    status_filter: str | None = Query(None, alias="status"),
    source: str | None = None,
    waiting_on: str | None = None,
    mine: bool = False,
    pm_project_id: int | None = None,
    order_project_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("design", "project_work")),
):
    query = db.query(DesignRequest).filter(DesignRequest.is_deleted == False)  # noqa: E712
    query = apply_scope(query, user, DesignRequest)
    if status_filter:
        query = query.filter(DesignRequest.status.in_(status_filter.split(",")))
    if source:
        query = query.filter(DesignRequest.source.in_(source.split(",")))
    if waiting_on:
        query = query.filter(DesignRequest.waiting_on == waiting_on)
    if mine:
        query = query.filter((DesignRequest.lead_designer_id == user.id) | (DesignRequest.requested_by_id == user.id))
    if pm_project_id:
        query = query.filter(DesignRequest.pm_project_id == pm_project_id)
    if order_project_id:
        query = query.filter(DesignRequest.order_project_id == order_project_id)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(DesignRequest.request_number.ilike(like) | DesignRequest.title.ilike(like) | DesignRequest.crm_reference.ilike(like))
    rows = _responses(db, query.limit(2000).all())
    # Waiting on Design first, then by due date (no date last), newest first.
    rows.sort(key=lambda r: (
        r.status not in DESIGN_REQUEST_ACTIVE_STATUSES, r.waiting_on != "design", r.due_date or date.max,
        -(r.id or 0),
    ))
    return rows


@router.post("/requests", response_model=DesignRequestDetail, status_code=201)
async def create_request(payload: DesignRequestCreate, background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Anyone with the Design app (BD included) can bring work to Design."""
    values = payload.model_dump()
    _validate(db, values)
    ensure_assignee_rule(db, user, LEAD_RULE, payload.lead_designer_id)
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id)
    reference, org_id = _crm_reference(db, payload.crm_source, payload.crm_record_id)
    link = {k: values.get(k) for k in ("order_project_id", "order_project_element_id")}
    clean_op_link(db, link)
    if link["order_project_id"] and not (payload.customer_id or org_id):
        from app.modules.projects.models.project import PmProject
        org_id = db.get(PmProject, link["order_project_id"]).customer_id
    req = DesignRequest(
        request_number=next_number(db, DesignRequest.request_number, year_prefix("DRQ")), title=payload.title.strip(),
        source=payload.source, crm_source=payload.crm_source if payload.crm_record_id else None,
        crm_record_id=payload.crm_record_id, crm_reference=reference, customer_id=payload.customer_id or org_id,
        pm_project_id=payload.pm_project_id, pm_milestone_id=payload.pm_milestone_id, erp_project_id=payload.erp_project_id,
        requirement=payload.requirement.strip(), requirement_revision=0, reviewed_revision=-1, priority=payload.priority,
        due_date=payload.due_date, status="open", waiting_on="design", lead_designer_id=payload.lead_designer_id,
        requested_by_id=user.id, **link,
    )
    db.add(req)
    db.flush()
    db.add(DesignRequirementRevision(request_id=req.id, revision=0, requirement=req.requirement, change_note="Original requirement", revised_by_id=user.id))
    add_event(db, "request_created", user, request_id=req.id)
    for uid in head_ids(db):
        notify(db, uid, user, f"New design request: {req.request_number}",
               f"{user_name(user)} raised {req.request_number} ({req.title})" + (f", due {req.due_date:%d-%m-%Y}" if req.due_date else "") + ".",
               "design_request_new", _NOTIFY_ENTITY, req.id)
    notify(db, req.lead_designer_id, user, f"Design request assigned: {req.request_number}",
           f"You're the lead designer on {req.request_number} ({req.title}).", "design_request_assigned", _NOTIFY_ENTITY, req.id)
    notify_design_event(
        db, background_tasks, "request_raised", req, entity_type=_NOTIFY_ENTITY, actor=user,
        title=f"New design request: {req.request_number}",
        message=f"{user_name(user)} raised {req.request_number} ({req.title})" + (f", due {req.due_date:%d-%m-%Y}" if req.due_date else "")
                + " — it waits to be accepted by Design.",
        skip={*head_ids(db), req.lead_designer_id},
    )
    db.commit()
    return _detail(db, req, user)


@router.get("/requests/{request_id}", response_model=DesignRequestDetail)
async def get_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    return _detail(db, _get(db, request_id, user=user), user)


@router.patch("/requests/{request_id}", response_model=DesignRequestDetail)
async def update_request(request_id: int, payload: DesignRequestUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    req = _get(db, request_id, lock=True, user=user)
    if "edit" not in _allowed(db, user, req):
        raise HTTPException(status_code=403, detail=f"Only the Design head or the person who raised {req.request_number} can edit it while it's active.")
    changes = payload.model_dump(exclude_unset=True)
    # Validate against the resulting project + milestone pair, so changing
    # only the project can't leave a milestone from another project behind.
    _validate(db, {
        **changes, "pm_project_id": changes.get("pm_project_id", req.pm_project_id),
        "pm_milestone_id": changes.get("pm_milestone_id", req.pm_milestone_id),
    })
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id")})
    clean_op_link(db, changes, current_project_id=req.order_project_id, current_element_id=req.order_project_element_id)
    ensure_assignee_rule(db, user, LEAD_RULE, changes.get("lead_designer_id"), req.lead_designer_id)
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title can't be empty.")
    if "priority" in changes and not changes["priority"]:
        changes.pop("priority")
    old_lead = req.lead_designer_id
    for key, value in changes.items():
        setattr(req, key, value.strip() if key == "title" else value)
    add_event(db, "request_updated", user, request_id=req.id)
    if req.lead_designer_id and req.lead_designer_id != old_lead:
        notify(db, req.lead_designer_id, user, f"Design request assigned: {req.request_number}",
               f"You're now the lead designer on {req.request_number} ({req.title}).", "design_request_assigned", _NOTIFY_ENTITY, req.id)
    db.commit()
    return _detail(db, req, user)


@router.post("/requests/{request_id}/revise", response_model=DesignRequestDetail)
async def revise_requirement(request_id: int, payload: DesignRequestRevisePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "project_work", "technical_requirement", "edit")
    req = _get(db, request_id, lock=True, user=user)
    if "revise" not in _allowed(db, user, req):
        raise HTTPException(status_code=403, detail=f"Only the person who raised {req.request_number} or the Design head can revise its requirement, and only while it's active.")
    text = payload.requirement.strip()
    if text == req.requirement:
        raise HTTPException(status_code=400, detail="The requirement text hasn't changed — edit it before saving a new revision.")
    req.requirement_revision += 1
    req.requirement, req.requirement_revised_at = text, utcnow()
    db.add(DesignRequirementRevision(request_id=req.id, revision=req.requirement_revision, requirement=text,
                                     change_note=payload.change_note.strip(), revised_by_id=user.id))
    add_event(db, "requirement_revised", user, request_id=req.id, comment=f"Rev {req.requirement_revision}: {payload.change_note.strip()}")
    for uid in {req.lead_designer_id, *head_ids(db)}:
        notify(db, uid, user, f"Requirement revised: {req.request_number}",
               f"{user_name(user)} revised the technical requirement of {req.request_number} (rev {req.requirement_revision}): "
               f"{payload.change_note.strip()[:200]}. Review it before continuing the design.",
               "design_requirement_revised", _NOTIFY_ENTITY, req.id)
    db.commit()
    return _detail(db, req, user)


@router.post("/requests/{request_id}/acknowledge", response_model=DesignRequestDetail)
async def acknowledge_requirement(request_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "project_work", "technical_requirement", "approve")
    req = _get(db, request_id, lock=True, user=user)
    if "acknowledge" not in _allowed(db, user, req):
        raise HTTPException(status_code=403, detail=f"Only the lead designer of {req.request_number} or the Design head confirms they've reviewed the requirement.")
    req.reviewed_revision, req.reviewed_at = req.requirement_revision, utcnow()
    add_event(db, "requirement_reviewed", user, request_id=req.id, comment=f"Reviewed rev {req.requirement_revision}")
    db.commit()
    return _detail(db, req, user)


def _status_before_hold(db: Session, req: DesignRequest) -> str:
    """Resume puts a held request back where it was — a request held while
    still open goes back to open (it was never accepted, so it must not jump
    to in progress without being accepted with a lead designer). Replays the
    request's status events to find the state that was put on hold."""
    state, before_hold = "open", None
    for (action,) in db.query(DesignEvent.action).filter(
        DesignEvent.request_id == req.id,
        DesignEvent.action.in_(("request_accept", "request_start", "request_reopen", "request_hold", "request_resume")),
    ).order_by(DesignEvent.id.asc()).all():
        if action == "request_accept":
            state = "accepted"
        elif action in ("request_start", "request_reopen"):
            state = "in_progress"
        elif action == "request_hold":
            before_hold, state = state, "on_hold"
        elif action == "request_resume":
            state = before_hold
    # No hold on record (held before events were kept): the old behaviour.
    return before_hold if before_hold in ("open", "accepted", "in_progress") else "in_progress"


@router.post("/requests/{request_id}/status", response_model=DesignRequestDetail)
async def change_status(request_id: int, payload: DesignRequestStatusPayload, background_tasks: BackgroundTasks,
                        db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    req = _get(db, request_id, lock=True, user=user)
    action = payload.action
    if action == "accept":
        ensure_design_feature(user, "project_work", "request_progress", "approve")
    elif action == "cancel":
        ensure_design_feature(user, "project_work", "request_progress", "cancel")
    else:
        ensure_design_feature(user, "project_work", "request_progress", "edit")
    if action not in _allowed(db, user, req):
        raise HTTPException(status_code=409, detail=f"{req.request_number} is {_PHRASE.get(req.status, req.status)} — you can't '{action}' it now (only the Design head moves requests, the lead designer may complete one).")
    reason = (payload.reason or "").strip() or None
    if action in ("hold", "cancel", "reopen") and not reason:
        raise HTTPException(status_code=400, detail=f"Give a reason to {action} {req.request_number}.")
    if action == "accept":
        require_team(db, user, "accept requests")
        if not req.lead_designer_id:
            raise HTTPException(status_code=400, detail=f"Assign a lead designer to {req.request_number} before accepting it.")
        req.status = "accepted"
    elif action == "start":
        req.status = "in_progress"
    elif action == "hold":
        req.status = "on_hold"
    elif action == "resume":
        req.status = _status_before_hold(db, req)
    elif action == "complete":
        req.status, req.closed_at = "completed", utcnow()
    elif action == "cancel":
        req.status, req.closed_at = "cancelled", utcnow()
    elif action == "reopen":
        req.status, req.closed_at = "in_progress", None
    req.close_reason = reason if action in ("cancel", "hold", "reopen") else req.close_reason
    add_event(db, f"request_{action}", user, request_id=req.id, comment=reason)
    notify(db, req.requested_by_id, user, f"{req.request_number} is {_PHRASE.get(req.status, req.status)}",
           f"{user_name(user)} marked {req.request_number} ({req.title}) {_PHRASE.get(req.status, req.status)}" + (f": {reason}" if reason else "."),
           "design_request_status", _NOTIFY_ENTITY, req.id)
    if action == "accept":
        notify(db, req.lead_designer_id, user, f"Design request accepted: {req.request_number}",
               f"{req.request_number} ({req.title}) is accepted with you as lead designer.", "design_request_assigned", _NOTIFY_ENTITY, req.id)
        notify_design_event(
            db, background_tasks, "request_accepted", req, entity_type=_NOTIFY_ENTITY, actor=user,
            title=f"Design request accepted: {req.request_number}",
            message=f"{user_name(user)} accepted {req.request_number} ({req.title}).",
            skip={req.requested_by_id, req.lead_designer_id},
        )
    db.commit()
    return _detail(db, req, user)


@router.post("/requests/{request_id}/waiting", response_model=DesignRequestDetail)
async def set_waiting(request_id: int, payload: DesignRequestWaitingPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "project_work", "request_progress", "edit")
    req = _get(db, request_id, lock=True, user=user)
    if "set_waiting" not in _allowed(db, user, req):
        raise HTTPException(status_code=403, detail="Only the Design head, the lead designer or the requester can change who this request is waiting on.")
    if payload.waiting_on not in ("design", "requester"):
        raise HTTPException(status_code=400, detail="It's waiting either on Design or on the requester.")
    note = (payload.note or "").strip() or None
    if payload.waiting_on == "requester" and not note:
        raise HTTPException(status_code=400, detail="Say what Design is waiting for from the requester.")
    req.waiting_on, req.waiting_note = payload.waiting_on, note
    add_event(db, "waiting_on_" + payload.waiting_on, user, request_id=req.id, comment=note)
    if payload.waiting_on == "requester":
        notify(db, req.requested_by_id, user, f"Design needs input: {req.request_number}",
               f"Design is waiting on you for {req.request_number}: {note}", "design_request_waiting", _NOTIFY_ENTITY, req.id)
    else:
        notify(db, req.lead_designer_id, user, f"Input received: {req.request_number}",
               f"{req.request_number} is back with Design" + (f": {note}" if note else "."), "design_request_waiting", _NOTIFY_ENTITY, req.id)
    db.commit()
    return _detail(db, req, user)


@router.post("/requests/{request_id}/comments", response_model=DesignRequestDetail)
async def comment_request(request_id: int, payload: DesignCommentPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "project_work", "timeline", "create")
    req = _get(db, request_id, user=user)
    add_event(db, "comment", user, request_id=req.id, comment=payload.comment)
    db.commit()
    return _detail(db, req, user)


# ---------------------------------------------------------------------------
# Milestones (read-only view of PM) + evidence
# ---------------------------------------------------------------------------

def _evidence(db: Session, ms: PmProjectMilestone, project: PmProject | None) -> DesignMilestoneEvidence:
    req_ids = [r for (r,) in db.query(DesignRequest.id).filter(DesignRequest.pm_milestone_id == ms.id, DesignRequest.is_deleted == False).all()]  # noqa: E712
    task_ids = [t for (t,) in db.query(PmProjectTask.id).filter(PmProjectTask.milestone_id == ms.id).all()]
    links = db.query(DesignTaskDeliverable).filter(DesignTaskDeliverable.pm_task_id.in_(task_ids)).all() if task_ids else []
    doc_q = db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.is_deleted == False)  # noqa: E712
    doc_ids = {lk.document_id for lk in links if lk.document_id}
    docs = doc_q.filter(DesignDocument.id.in_(doc_ids) | DesignDocument.design_request_id.in_(req_ids or [0])).all() if (doc_ids or req_ids) else []
    bom_ids = {lk.bom_id for lk in links if lk.bom_id}
    boms = db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(
        DesignBom.is_deleted == False, DesignBom.id.in_(bom_ids) | DesignBom.design_request_id.in_(req_ids or [0])  # noqa: E712
    ).all() if (bom_ids or req_ids) else []
    out = DesignMilestoneEvidence(
        milestone_id=ms.id, milestone_title=ms.title, target_date=ms.target_date, status=ms.status,
        project_label=f"{project.project_code} — {project.name}" if project else None,
    )
    for d in docs:
        rel = released_revision(d)
        row = DesignRequestDeliverable(kind="document", id=d.id, number=d.doc_number, title=d.title, status=display_status(d),
                                       released_revision_label=rel.revision_label if rel else None)
        (out.released_documents if rel else out.pending_documents).append(row)
        if any(r.status == "approved" and not r.is_deleted for r in d.revisions):
            out.customer_approvals_pending += 1
    for b in boms:
        rel = released_bom_revision(b)
        row = DesignRequestDeliverable(kind="bom", id=b.id, number=b.bom_number, title=b.title, status=bom_display_status(b),
                                       released_revision_label=rel.revision_label if rel else None)
        (out.released_boms if rel else out.pending_documents).append(row)
    return out


@router.get("/milestones", response_model=list[DesignMilestoneEvidence])
async def design_milestones(include_closed: bool = False, db: Session = Depends(get_db), _user: User = Depends(require_app_access("design"))):
    """Project WBS elements owned by the Design department, with what Design
    has released for each — the evidence for the WBS submission."""
    dept_ids = design_department_ids(db)
    if not dept_ids:
        return []
    q = db.query(PmProjectMilestone).filter(PmProjectMilestone.department_id.in_(dept_ids))
    if not include_closed:
        q = q.filter(PmProjectMilestone.status.notin_(("achieved", "cancelled")))
    mss = q.order_by(PmProjectMilestone.target_date).limit(500).all()
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_({m.project_id for m in mss})).all()} if mss else {}
    return [_evidence(db, m, projects.get(m.project_id)) for m in mss]


@router.get("/milestones/{milestone_id}/evidence", response_model=DesignMilestoneEvidence)
async def milestone_evidence(milestone_id: int, db: Session = Depends(get_db), _user: User = Depends(require_app_access("design"))):
    ms = db.query(PmProjectMilestone).filter(PmProjectMilestone.id == milestone_id).first()
    if not ms:
        raise HTTPException(status_code=404, detail=f"WBS #{milestone_id} not found in Project Management.")
    if ms.department_id not in design_department_ids(db):
        # Same boundary as GET /design/milestones: only WBS elements owned by a Design department.
        raise HTTPException(
            status_code=404,
            detail=f"WBS #{milestone_id} isn't owned by the Design department, so Design has no evidence for it. "
                   "Open it from Project Management instead, or ask the project manager to assign it to Design.",
        )
    return _evidence(db, ms, db.query(PmProject).filter(PmProject.id == ms.project_id).first())


# ---------------------------------------------------------------------------
# My Work: PM tasks ↔ deliverables
# ---------------------------------------------------------------------------

def _deliverable_rows(db: Session, links: list[DesignTaskDeliverable]) -> dict[int, DesignRequestDeliverable]:
    doc_ids = {lk.document_id for lk in links if lk.document_id}
    bom_ids = {lk.bom_id for lk in links if lk.bom_id}
    docs = {d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()} if doc_ids else {}
    boms = {b.id: b for b in db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(DesignBom.id.in_(bom_ids)).all()} if bom_ids else {}
    out = {}
    for lk in links:
        if lk.document_id and lk.document_id in docs:
            d = docs[lk.document_id]
            rel = released_revision(d)
            out[lk.id] = DesignRequestDeliverable(kind="document", id=d.id, number=d.doc_number, title=d.title,
                                                  status=display_status(d), released_revision_label=rel.revision_label if rel else None)
        elif lk.bom_id and lk.bom_id in boms:
            b = boms[lk.bom_id]
            rel = released_bom_revision(b)
            out[lk.id] = DesignRequestDeliverable(kind="bom", id=b.id, number=b.bom_number, title=b.title,
                                                  status=bom_display_status(b), released_revision_label=rel.revision_label if rel else None)
    return out


@router.get("/my-work", response_model=list[DesignWorkTask])
async def my_work(include_done: bool = False, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    q = db.query(PmProjectTask).filter(PmProjectTask.assignee_id == user.id)
    if not include_done:
        q = q.filter(PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES))
    tasks = q.order_by(PmProjectTask.due_date.is_(None), PmProjectTask.due_date).limit(500).all()
    if not tasks:
        return []
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_({t.project_id for t in tasks})).all()}
    mss = {m.id: m for m in db.query(PmProjectMilestone).filter(PmProjectMilestone.id.in_({t.milestone_id for t in tasks} - {None})).all()}
    links = db.query(DesignTaskDeliverable).filter(DesignTaskDeliverable.pm_task_id.in_([t.id for t in tasks])).all()
    rows = _deliverable_rows(db, links)
    changed_projects = {
        p for (p,) in db.query(DesignRequest.pm_project_id).filter(
            DesignRequest.pm_project_id.in_(projects), DesignRequest.status.in_(DESIGN_REQUEST_ACTIVE_STATUSES),
            DesignRequest.requirement_revision > DesignRequest.reviewed_revision, DesignRequest.requirement_revision > 0,
            DesignRequest.is_deleted == False,  # noqa: E712
        ).all()
    }
    today = date.today()
    out = []
    for t in tasks:
        p, m = projects.get(t.project_id), mss.get(t.milestone_id)
        mine = [lk for lk in links if lk.pm_task_id == t.id]
        dels = [rows[lk.id] for lk in mine if lk.id in rows]
        out.append(DesignWorkTask(
            task_id=t.id, title=t.title, status=t.status, priority=t.priority, due_date=t.due_date, project_id=t.project_id,
            project_label=f"{p.project_code} — {p.name}" if p else None, milestone_id=t.milestone_id,
            milestone_title=m.title if m else None,
            is_overdue=bool(t.due_date and t.due_date < today and t.status in PM_TASK_OPEN_STATUSES),
            deliverables=dels, ready_to_close=bool(dels) and all(d.released_revision_label for d in dels) and t.status in PM_TASK_OPEN_STATUSES,
            requirement_changed=t.project_id in changed_projects, link_ids=[lk.id for lk in mine if lk.id in rows],
        ))
    return out


@router.post("/task-deliverables", status_code=201)
async def link_deliverable(payload: DesignTaskDeliverableCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    task = db.query(PmProjectTask).filter(PmProjectTask.id == payload.pm_task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task #{payload.pm_task_id} wasn't found in Project Management.")
    if not (task.assignee_id == user.id or is_head(db, user) or is_admin(user)):
        raise HTTPException(status_code=403, detail="Only the task's assignee or the Design head can link its deliverable.")
    if bool(payload.document_id) == bool(payload.bom_id):
        raise HTTPException(status_code=400, detail="Link either a drawing or a BOM — exactly one.")
    target_doc = db.query(DesignDocument).filter(DesignDocument.id == payload.document_id, DesignDocument.is_deleted == False).first() if payload.document_id else None  # noqa: E712
    if payload.document_id and not target_doc:
        raise HTTPException(status_code=400, detail=f"Drawing #{payload.document_id} wasn't found.")
    target_bom = db.query(DesignBom).filter(DesignBom.id == payload.bom_id, DesignBom.is_deleted == False).first() if payload.bom_id else None  # noqa: E712
    if payload.bom_id and not target_bom:
        raise HTTPException(status_code=400, detail=f"BOM #{payload.bom_id} wasn't found.")
    ensure_in_scope(db, user, target_doc or target_bom)
    dup = db.query(DesignTaskDeliverable.id).filter(
        DesignTaskDeliverable.pm_task_id == task.id,
        (DesignTaskDeliverable.document_id == payload.document_id) if payload.document_id else (DesignTaskDeliverable.bom_id == payload.bom_id),
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail="That deliverable is already linked to this task.")
    link = DesignTaskDeliverable(pm_task_id=task.id, document_id=payload.document_id, bom_id=payload.bom_id, created_by_id=user.id)
    db.add(link)
    db.commit()
    return {"id": link.id}


@router.delete("/task-deliverables/{link_id}")
async def unlink_deliverable(link_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    link = db.query(DesignTaskDeliverable).filter(DesignTaskDeliverable.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="That link no longer exists.")
    task = db.query(PmProjectTask).filter(PmProjectTask.id == link.pm_task_id).first()
    if not ((task and task.assignee_id == user.id) or is_head(db, user) or is_admin(user)):
        raise HTTPException(status_code=403, detail="Only the task's assignee or the Design head can unlink its deliverable.")
    db.delete(link)
    db.commit()
    return {"message": "Unlinked"}
