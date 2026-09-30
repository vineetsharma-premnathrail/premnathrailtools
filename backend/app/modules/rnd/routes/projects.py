from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.models.project import (
    RndProject, RND_PROJECT_TYPES, RND_PROJECT_PRIORITIES, RND_PROJECT_STATUSES,
)
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype
from app.modules.production.models.bom import ProductionBom
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.feasibility import (
    RndFeasibilityStudy, RND_FEASIBILITY_RATINGS, RND_FEASIBILITY_RECOMMENDATIONS,
)
from app.modules.rnd.schemas.project import (
    RndProjectCreate, RndProjectUpdate, RndProjectStagePayload, RndProjectResponse, RndProjectDetailResponse,
    RndProjectMember, RndProjectExperimentSummary, RndProjectPrototypeSummary,
)
from app.modules.rnd.schemas.feasibility import RndFeasibilityStudyUpdate, RndFeasibilityStudyResponse
from app.modules.rnd.service import (
    generate_project_number, project_actual_cost, prototype_bom_cost, check_stage_gate, user_names, STAGE_LABELS,
)

router = APIRouter(
    prefix="/projects", tags=["RnD Projects"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "projects"))],
)


def _validate_choices(project_type: str | None, priority: str | None, status: str | None) -> None:
    if project_type and project_type not in RND_PROJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid project type '{project_type}'. Valid types: {', '.join(RND_PROJECT_TYPES)}.")
    if priority and priority not in RND_PROJECT_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{priority}'. Valid priorities: {', '.join(RND_PROJECT_PRIORITIES)}.")
    if status and status not in RND_PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'. Valid statuses: {', '.join(RND_PROJECT_STATUSES)}.")


def _validate_users(db: Session, lead_id: int | None, member_ids: list[int] | None) -> None:
    ids = {i for i in [lead_id, *(member_ids or [])] if i}
    if not ids:
        return
    found = {u.id for u in db.query(User.id).filter(User.id.in_(ids)).all()}
    missing = ids - found
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"User(s) #{', #'.join(str(m) for m in sorted(missing))} not found — pick the project lead/team again from the list.",
        )


def _validate_dates(start, target) -> None:
    if start and target and target < start:
        raise HTTPException(status_code=400, detail="Target end date can't be before the start date.")


def _to_response(db: Session, project: RndProject, schema=RndProjectResponse):
    resp = schema.model_validate(project)
    member_ids = list(project.team_member_ids or [])
    names = user_names(db, [project.lead_id, *member_ids])
    resp.lead_name = names.get(project.lead_id) if project.lead_id else None
    resp.team_members = [RndProjectMember(id=i, name=names[i]) for i in member_ids if i in names]
    resp.actual_cost = project_actual_cost(db, project.id)
    resp.experiment_count = db.query(func.count(RndExperiment.id)).filter(
        RndExperiment.project_id == project.id, RndExperiment.is_deleted == False  # noqa: E712
    ).scalar() or 0
    resp.prototype_count = db.query(func.count(RndPrototype.id)).filter(
        RndPrototype.project_id == project.id, RndPrototype.is_deleted == False  # noqa: E712
    ).scalar() or 0
    return resp


def _get_or_404(db: Session, project_id: int) -> RndProject:
    project = db.query(RndProject).filter(RndProject.is_deleted == False, RndProject.id == project_id).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found (it may have been deleted).")
    return project


@router.get("", response_model=list[RndProjectResponse])
async def list_projects(
    stage: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    project_type: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(RndProject).filter(RndProject.is_deleted == False)  # noqa: E712
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
    return [_to_response(db, p) for p in query.order_by(RndProject.created_at.desc()).all()]


@router.post("", response_model=RndProjectResponse)
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
    _validate_users(db, payload.lead_id, payload.team_member_ids)
    _validate_dates(payload.start_date, payload.target_end_date)

    project = RndProject(
        project_number=generate_project_number(db),
        title=payload.title.strip(),
        project_type=payload.project_type,
        priority=payload.priority,
        objective=payload.objective.strip(),
        scope=payload.scope,
        lead_id=payload.lead_id,
        team_member_ids=list(dict.fromkeys(payload.team_member_ids)),
        start_date=payload.start_date,
        target_end_date=payload.target_end_date,
        budget_amount=payload.budget_amount,
        remarks=payload.remarks,
        stage="initiation",
        status="active",
        created_by_id=user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.get("/{project_id}", response_model=RndProjectDetailResponse)
async def get_project(project_id: int, db: Session = Depends(get_db)):
    project = _get_or_404(db, project_id)
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
    return resp


@router.patch("/{project_id}", response_model=RndProjectResponse)
async def update_project(project_id: int, payload: RndProjectUpdate, db: Session = Depends(get_db)):
    project = _get_or_404(db, project_id)
    updates = payload.model_dump(exclude_unset=True)

    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Project title can't be empty.")
    if "objective" in updates and not (updates["objective"] or "").strip():
        raise HTTPException(status_code=400, detail="Project objective can't be empty.")
    _validate_choices(updates.get("project_type"), updates.get("priority"), updates.get("status"))
    _validate_users(db, updates.get("lead_id"), updates.get("team_member_ids"))
    _validate_dates(updates.get("start_date", project.start_date), updates.get("target_end_date", project.target_end_date))
    if "team_member_ids" in updates and updates["team_member_ids"] is not None:
        updates["team_member_ids"] = list(dict.fromkeys(updates["team_member_ids"]))

    for field, val in updates.items():
        setattr(project, field, val)
    db.commit()
    db.refresh(project)
    return _to_response(db, project)


@router.post("/{project_id}/stage", response_model=RndProjectResponse)
async def change_stage(project_id: int, payload: RndProjectStagePayload, db: Session = Depends(get_db)):
    project = _get_or_404(db, project_id)
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
async def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = _get_or_404(db, project_id)
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
                f"{proto_count} prototype(s) and {doc_count} document(s). Delete those first, or set the project status to Cancelled instead."
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
async def get_feasibility(project_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, project_id)
    study = db.query(RndFeasibilityStudy).filter(RndFeasibilityStudy.project_id == project_id).first()
    return _feasibility_response(db, study) if study else None


@router.put("/{project_id}/feasibility", response_model=RndFeasibilityStudyResponse)
async def upsert_feasibility(
    project_id: int,
    payload: RndFeasibilityStudyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    _get_or_404(db, project_id)
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
    for field, val in data.items():
        setattr(study, field, val)
    if study.recommendation and study.recommendation != previous_recommendation:
        study.reviewed_by_id = user.id
        study.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(study)
    return _feasibility_response(db, study)
