from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.scope import apply_scope, ensure_in_scope
from app.modules.rnd.models.project import (
    RndProject, RND_PROJECT_TYPES, RND_PROJECT_PRIORITIES, RND_PROJECT_STATUSES,
)
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype
from app.modules.production.models.bom import ProductionBom
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.requirement_work import RndRequirementProjectLink
from app.modules.rnd.models.feasibility import (
    RndFeasibilityStudy, RND_FEASIBILITY_RATINGS, RND_FEASIBILITY_RECOMMENDATIONS,
)
from app.modules.rnd.schemas.project import (
    RndProjectCreate, RndProjectUpdate, RndProjectStagePayload, RndProjectResponse, RndProjectDetailResponse,
    RndProjectMember, RndProjectExperimentSummary, RndProjectPrototypeSummary,
)
from app.modules.rnd.services import project_origin
from app.modules.rnd.schemas.feasibility import RndFeasibilityStudyUpdate, RndFeasibilityStudyResponse
from app.modules.rnd.service import (
    generate_project_number, hide_costs, project_actual_cost, prototype_bom_cost, check_stage_gate, user_names, STAGE_LABELS,
)

router = APIRouter(
    prefix="/projects", tags=["RnD Projects"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "projects"))],
)


_CAN_CREATE = require_tab_action("rnd", "projects", "create")
_CAN_EDIT = require_tab_action("rnd", "projects", "edit")
_CAN_DELETE = require_tab_action("rnd", "projects", "delete")
# Approve is checked inline (not as a route dependency) because it only applies
# to some calls: stage moves into Handover/Closed and Go/No-Go recommendation changes.
_CAN_APPROVE = require_tab_action("rnd", "projects", "approve")

# Columns that are NOT NULL on rnd_projects — an explicit null in a PATCH would
# otherwise reach the DB and come back as a raw IntegrityError 500.
_NON_NULLABLE_UPDATE_FIELDS = {
    "project_type": "Project type",
    "priority": "Priority",
    "status": "Status",
    "handover_specs_final": "Handover checklist 'Specs final'",
    "handover_bom_approved": "Handover checklist 'BOM approved'",
    "handover_process_documented": "Handover checklist 'Process documented'",
    "handover_quality_standards": "Handover checklist 'Quality standards'",
}


def _validate_choices(project_type: str | None, priority: str | None, status: str | None) -> None:
    if project_type and project_type not in RND_PROJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid project type '{project_type}'. Valid types: {', '.join(RND_PROJECT_TYPES)}.")
    if priority and priority not in RND_PROJECT_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{priority}'. Valid priorities: {', '.join(RND_PROJECT_PRIORITIES)}.")
    if status and status not in RND_PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'. Valid statuses: {', '.join(RND_PROJECT_STATUSES)}.")


def _lead_list(project: RndProject) -> list[int]:
    """Lead ids for a project — falls back to lead_id for rows saved before lead_ids existed."""
    ids = list(project.lead_ids or [])
    return ids or ([project.lead_id] if project.lead_id else [])


def _validate_users(db: Session, lead_ids: list[int] | None, member_ids: list[int] | None) -> None:
    ids = {i for i in [*(lead_ids or []), *(member_ids or [])] if i}
    if not ids:
        return
    found = {u.id for u in db.query(User.id).filter(User.id.in_(ids)).all()}
    missing = ids - found
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"User(s) #{', #'.join(str(m) for m in sorted(missing))} not found — pick the project lead/team again from the list.",
        )


TEAM_RULE_KEY = "rnd:projects.team"  # core/assignee_rules.PICKERS


def _ensure_team_pickable(db: Session, user: User, ids: list[int] | None, previous: list[int] | None = None) -> None:
    """The role's assign-to rule (Role & Permissions › R&D › Prototype / Research ›
    Project lead & team) for every lead / member being ADDED — people already on
    the project stay even if the rule wouldn't let this user pick them now, and
    adding yourself is never refused."""
    added = {i for i in (ids or []) if i} - set(previous or []) - {user.id}
    if not added:
        return
    for u in db.query(User).filter(User.id.in_(added)).order_by(User.id).all():
        assignee_rules.ensure_allowed(db, user, TEAM_RULE_KEY, u)


def _validate_dates(start, target) -> None:
    if start and target and target < start:
        raise HTTPException(status_code=400, detail="Target end date can't be before the start date.")


def _to_response(db: Session, project: RndProject, schema=RndProjectResponse):
    resp = schema.model_validate(project)
    member_ids = list(project.team_member_ids or [])
    lead_ids = _lead_list(project)
    names = user_names(db, [*lead_ids, *member_ids])
    resp.lead_ids = lead_ids
    resp.leads = [RndProjectMember(id=i, name=names[i]) for i in lead_ids if i in names]
    resp.lead_name = ", ".join(m.name for m in resp.leads) or None
    resp.team_members = [RndProjectMember(id=i, name=names[i]) for i in member_ids if i in names]
    resp.actual_cost = project_actual_cost(db, project.id)
    resp.experiment_count = db.query(func.count(RndExperiment.id)).filter(
        RndExperiment.project_id == project.id, RndExperiment.is_deleted == False  # noqa: E712
    ).scalar() or 0
    resp.prototype_count = db.query(func.count(RndPrototype.id)).filter(
        RndPrototype.project_id == project.id, RndPrototype.is_deleted == False  # noqa: E712
    ).scalar() or 0
    resp.linked_requirements = _linked_requirements(db, project.id)
    for key, val in project_origin.display(db, project).items():
        setattr(resp, key, val)
    return resp


def _linked_requirements(db: Session, project_id: int) -> list[dict]:
    """CRM requirements the R&D head linked to this project (R&D › Requirements)."""
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender
    links = db.query(RndRequirementProjectLink).filter(RndRequirementProjectLink.project_id == project_id).order_by(RndRequirementProjectLink.id).all()
    out = []
    for link in links:
        model = Inquiry if link.source == "inquiry" else Tender
        rec = db.query(model).filter(model.id == link.record_id, model.is_deleted == False).first()  # noqa: E712
        if rec:
            out.append({"source": link.source, "record_id": rec.id,
                        "ref": rec.technical_offer_number or rec.universal_id,
                        "title": rec.product if link.source == "inquiry" else rec.tender_name})
    return out


def _get_or_404(db: Session, project_id: int, user: User | None = None) -> RndProject:
    project = db.query(RndProject).filter(RndProject.is_deleted == False, RndProject.id == project_id).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted).")
    if user is not None:
        ensure_in_scope(db, user, project)
    return project


@router.get("", response_model=list[RndProjectResponse])
async def list_projects(
    stage: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    project_type: str | None = None,
    origin: str | None = Query(None, description="An origin key, or 'not_recorded' for projects saved before origin existed"),
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    query = db.query(RndProject).filter(RndProject.is_deleted == False)  # noqa: E712
    query = apply_scope(query, user, RndProject)
    if origin == "not_recorded":
        query = query.filter(RndProject.origin.is_(None))
    elif origin:
        query = query.filter(RndProject.origin == origin)
    if stage:
        query = query.filter(RndProject.stage == stage)
    if status_filter:
        query = query.filter(RndProject.status == status_filter)
    if priority:
        query = query.filter(RndProject.priority == priority)
    if project_type:
        query = query.filter(RndProject.project_type == project_type)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (RndProject.title.ilike(like)) | (RndProject.project_number.ilike(like)) | (RndProject.objective.ilike(like))
        )
    out = [_to_response(db, p) for p in query.order_by(RndProject.created_at.desc()).all()]
    if hide_costs(user):  # R&D › Prototypes › BOM costs
        for r in out:
            r.actual_cost = None
    return out


@router.get("/source-options")
async def source_options(
    kind: str = Query(..., description="product | inquiry | tender | quality_complaint | ncr | service_request"),
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    """Picker options for a project's origin: [{id, label, sub}] (max 20), only records the user may see."""
    return project_origin.source_options(db, user, kind, q)


@router.post("", response_model=RndProjectResponse, dependencies=[Depends(_CAN_CREATE)])
async def create_project(
    payload: RndProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Project title is required.")
    if not payload.objective.strip():
        raise HTTPException(status_code=400, detail="Project objective is required — describe what this R&D project should achieve.")
    _validate_choices(payload.project_type, payload.priority, None)
    lead_ids = list(dict.fromkeys(i for i in (payload.lead_ids if payload.lead_ids is not None else [payload.lead_id]) if i))
    _validate_users(db, lead_ids, payload.team_member_ids)
    _ensure_team_pickable(db, user, [*lead_ids, *payload.team_member_ids])
    _validate_dates(payload.start_date, payload.target_end_date)
    origin = project_origin.resolve(db, user, payload.model_dump(include=set(project_origin.ORIGIN_FIELDS)),
                                    creating=True, attachment_count=payload.attachment_count)

    project = RndProject(
        project_number=generate_project_number(db),
        title=payload.title.strip(),
        priority=payload.priority,
        objective=payload.objective.strip(),
        scope=payload.scope,
        lead_id=lead_ids[0] if lead_ids else None,
        lead_ids=lead_ids,
        team_member_ids=[i for i in dict.fromkeys(payload.team_member_ids) if i not in lead_ids],
        start_date=payload.start_date,
        target_end_date=payload.target_end_date,
        budget_amount=payload.budget_amount,
        remarks=payload.remarks,
        stage="initiation",
        status="active",
        created_by_id=user.id,
        **origin,
    )
    db.add(project)
    db.flush()
    project_origin.link_requirement(db, user, project)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.get("/{project_id}", response_model=RndProjectDetailResponse)
async def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    project = _get_or_404(db, project_id, user=user)
    resp = _to_response(db, project, RndProjectDetailResponse)

    experiments = db.query(RndExperiment).filter(
        RndExperiment.project_id == project.id, RndExperiment.is_deleted == False  # noqa: E712
    ).order_by(RndExperiment.created_at.desc()).all()
    resp.experiments = [
        RndProjectExperimentSummary(
            id=e.id, experiment_number=e.experiment_number, title=e.title,
            status=e.status, result=e.result, experiment_date=e.experiment_date,
        ) for e in experiments
    ]
    prototypes = db.query(RndPrototype).filter(
        RndPrototype.project_id == project.id, RndPrototype.is_deleted == False  # noqa: E712
    ).order_by(RndPrototype.created_at.desc()).all()
    bom_ids = [p.production_bom_id for p in prototypes if p.production_bom_id]
    released = {
        b.id: f"{b.bom_number} (v{b.version})"
        for b in db.query(ProductionBom).filter(ProductionBom.id.in_(bom_ids), ProductionBom.is_deleted == False).all()  # noqa: E712
    } if bom_ids else {}
    resp.prototypes = [
        RndProjectPrototypeSummary(
            id=p.id, prototype_number=p.prototype_number, name=p.name,
            version=p.version, status=p.status, bom_cost=prototype_bom_cost(p),
            production_bom_id=p.production_bom_id if p.production_bom_id in released else None,
            production_bom_number=released.get(p.production_bom_id),
        ) for p in prototypes
    ]
    study = db.query(RndFeasibilityStudy).filter(RndFeasibilityStudy.project_id == project.id).first()
    resp.has_feasibility = study is not None
    resp.feasibility_recommendation = study.recommendation if study else None
    if hide_costs(user):  # R&D › Prototypes › BOM costs
        resp.actual_cost = None
        for p in resp.prototypes:
            p.bom_cost = None
    return resp


@router.patch("/{project_id}", response_model=RndProjectResponse, dependencies=[Depends(_CAN_EDIT)])
async def update_project(project_id: int, payload: RndProjectUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    project = _get_or_404(db, project_id, user=user)
    updates = payload.model_dump(exclude_unset=True)

    for key, label in _NON_NULLABLE_UPDATE_FIELDS.items():
        if key in updates and updates[key] is None:
            raise HTTPException(status_code=400, detail=f"{label} can't be blank — pick a value.")
    if "team_member_ids" in updates and updates["team_member_ids"] is None:
        updates["team_member_ids"] = []

    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Project title can't be empty.")
    if "objective" in updates and not (updates["objective"] or "").strip():
        raise HTTPException(status_code=400, detail="Project objective can't be empty.")
    _validate_choices(updates.get("project_type"), updates.get("priority"), updates.get("status"))
    if "lead_ids" in updates:
        updates["lead_ids"] = list(dict.fromkeys(i for i in (updates["lead_ids"] or []) if i))
        updates["lead_id"] = updates["lead_ids"][0] if updates["lead_ids"] else None
    elif "lead_id" in updates:
        updates["lead_ids"] = [updates["lead_id"]] if updates["lead_id"] else []
    _validate_users(db, updates.get("lead_ids"), updates.get("team_member_ids"))
    _ensure_team_pickable(db, user, [*(updates.get("lead_ids") or []), *(updates.get("team_member_ids") or [])],
                          previous=[*_lead_list(project), *(project.team_member_ids or [])])
    _validate_dates(updates.get("start_date", project.start_date), updates.get("target_end_date", project.target_end_date))
    if "team_member_ids" in updates and updates["team_member_ids"] is not None:
        updates["team_member_ids"] = list(dict.fromkeys(updates["team_member_ids"]))
    if project_origin.origin_touched(updates):
        merged = {f: updates.get(f, getattr(project, f)) for f in project_origin.ORIGIN_FIELDS}
        updates.update(project_origin.resolve(db, user, merged, creating=False))
    elif project.origin and "project_type" in updates:
        updates.pop("project_type")  # kept in sync from the origin

    for field, val in updates.items():
        setattr(project, field, val)
    db.flush()
    project_origin.link_requirement(db, user, project)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.post("/{project_id}/stage", response_model=RndProjectResponse, dependencies=[Depends(_CAN_EDIT)])
async def change_stage(
    project_id: int,
    payload: RndProjectStagePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    project = _get_or_404(db, project_id, user=user)
    if payload.stage in ("handover", "closed"):
        _CAN_APPROVE(user)  # moving to Handover/Closed is a sign-off, not a plain edit
    if payload.stage == project.stage:
        raise HTTPException(status_code=400, detail=f"Project is already in the {STAGE_LABELS.get(project.stage, project.stage)} stage.")
    reason = check_stage_gate(db, project, payload.stage)
    if reason:
        raise HTTPException(status_code=400, detail=reason)

    project.stage = payload.stage
    if payload.stage == "handover" and project.handed_over_at is None:
        project.handed_over_at = datetime.now(timezone.utc)
    if payload.stage == "closed" and project.actual_end_date is None:
        project.actual_end_date = datetime.now(timezone.utc).date()
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.delete("/{project_id}")
async def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    project = _get_or_404(db, project_id, user=user)
    ensure_can_delete(user, project, "rnd", "projects", what="R&D project")
    exp_count = db.query(func.count(RndExperiment.id)).filter(
        RndExperiment.project_id == project.id, RndExperiment.is_deleted == False  # noqa: E712
    ).scalar() or 0
    proto_count = db.query(func.count(RndPrototype.id)).filter(
        RndPrototype.project_id == project.id, RndPrototype.is_deleted == False  # noqa: E712
    ).scalar() or 0
    doc_count = db.query(func.count(RndDocument.id)).filter(
        RndDocument.project_id == project.id, RndDocument.is_deleted == False  # noqa: E712
    ).scalar() or 0
    if exp_count or proto_count or doc_count:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Can't delete {project.project_number}: it still has {exp_count} experiment(s), "
                f"{proto_count} prototype(s) and {doc_count} attachment(s)/document(s). Delete those first — attachments are in the project's Attachments section."
            ),
        )
    # Soft delete — R&D records are retained for audit; the delete itself is
    # logged by app/core/audit.py.
    project.is_deleted = True
    project.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{project.project_number} deleted"}


# ---------------------------------------------------------------------------
# Feasibility study (one per project)
# ---------------------------------------------------------------------------

def _feasibility_response(db: Session, study: RndFeasibilityStudy) -> RndFeasibilityStudyResponse:
    resp = RndFeasibilityStudyResponse.model_validate(study)
    if study.reviewed_by_id:
        resp.reviewed_by_name = user_names(db, [study.reviewed_by_id]).get(study.reviewed_by_id)
    parts = [study.material_cost, study.labour_cost, study.overhead_cost]
    if any(p is not None for p in parts):
        unit = round(sum(p or 0 for p in parts), 2)
        resp.estimated_unit_cost = unit
        if study.target_selling_price:
            resp.estimated_margin_pct = round((study.target_selling_price - unit) / study.target_selling_price * 100, 1)
    return resp


@router.get("/{project_id}/feasibility", response_model=RndFeasibilityStudyResponse | None)
async def get_feasibility(project_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    _get_or_404(db, project_id, user=user)
    study = db.query(RndFeasibilityStudy).filter(RndFeasibilityStudy.project_id == project_id).first()
    return _feasibility_response(db, study) if study else None


@router.put("/{project_id}/feasibility", response_model=RndFeasibilityStudyResponse, dependencies=[Depends(_CAN_EDIT)])
async def upsert_feasibility(
    project_id: int,
    payload: RndFeasibilityStudyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    _get_or_404(db, project_id, user=user)
    data = payload.model_dump(exclude_unset=True)
    for key in ("costing_rating", "sourcing_rating", "process_rating", "quality_rating"):
        if data.get(key) and data[key] not in RND_FEASIBILITY_RATINGS:
            raise HTTPException(status_code=400, detail=f"Invalid {key.replace('_', ' ')} '{data[key]}'. Valid ratings: {', '.join(RND_FEASIBILITY_RATINGS)}.")
    if data.get("recommendation") and data["recommendation"] not in RND_FEASIBILITY_RECOMMENDATIONS:
        raise HTTPException(status_code=400, detail=f"Invalid recommendation '{data['recommendation']}'. Valid values: {', '.join(RND_FEASIBILITY_RECOMMENDATIONS)}.")
    for key in ("material_cost", "labour_cost", "overhead_cost", "target_selling_price"):
        if data.get(key) is not None and data[key] < 0:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be negative.")

    study = db.query(RndFeasibilityStudy).filter(RndFeasibilityStudy.project_id == project_id).first()
    if not study:
        study = RndFeasibilityStudy(project_id=project_id)
        db.add(study)
    previous_recommendation = study.recommendation
    if "recommendation" in data and data["recommendation"] != previous_recommendation:
        _CAN_APPROVE(user)  # the Go/No-Go call stamps reviewed_by — it's an approval
    for field, val in data.items():
        setattr(study, field, val)
    if study.recommendation and study.recommendation != previous_recommendation:
        study.reviewed_by_id = user.id
        study.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(study)
    return _feasibility_response(db, study)
