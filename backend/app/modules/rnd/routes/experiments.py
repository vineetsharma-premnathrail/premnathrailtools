from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.prototype import RndPrototype
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.models.experiment import (
    RndExperiment, RND_EXPERIMENT_TYPES, RND_EXPERIMENT_STATUSES, RND_EXPERIMENT_RESULTS,
)
from app.modules.rnd.schemas.experiment import RndExperimentCreate, RndExperimentUpdate, RndExperimentResponse
from app.modules.rnd.service import generate_experiment_number, user_names

router = APIRouter(
    prefix="/experiments", tags=["RnD Experiments"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "experiments"))],
)


def _to_response(db: Session, exp: RndExperiment) -> RndExperimentResponse:
    resp = RndExperimentResponse.model_validate(exp)
    project = db.query(RndProject).filter(RndProject.id == exp.project_id).first()
    if project:
        resp.project_number = project.project_number
        resp.project_title = project.title
    if exp.prototype_id:
        proto = db.query(RndPrototype).filter(RndPrototype.id == exp.prototype_id).first()
        if proto:
            resp.prototype_number = f"{proto.prototype_number} ({proto.version})"
    if exp.conducted_by_id:
        resp.conducted_by_name = user_names(db, [exp.conducted_by_id]).get(exp.conducted_by_id)
    return resp


def _get_or_404(db: Session, experiment_id: int) -> RndExperiment:
    exp = db.query(RndExperiment).filter(RndExperiment.is_deleted == False, RndExperiment.id == experiment_id).first()  # noqa: E712
    if not exp:
        raise HTTPException(status_code=404, detail=f"Experiment #{experiment_id} not found (it may have been deleted).")
    return exp


def _validate_links(db: Session, project_id: int | None, prototype_id: int | None) -> None:
    if project_id is not None:
        project = db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first()  # noqa: E712
        if not project:
            raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found — pick the project again from the list.")
    if prototype_id is not None:
        proto = db.query(RndPrototype).filter(RndPrototype.id == prototype_id, RndPrototype.is_deleted == False).first()  # noqa: E712
        if not proto:
            raise HTTPException(status_code=404, detail=f"Prototype #{prototype_id} not found — pick the prototype again from the list.")
        if project_id is not None and proto.project_id != project_id:
            raise HTTPException(
                status_code=400,
                detail=f"Prototype {proto.prototype_number} belongs to a different project. Pick a prototype from the selected project, or leave it blank.",
            )


def _validate_choices(experiment_type: str | None, status: str | None, result: str | None) -> None:
    if experiment_type and experiment_type not in RND_EXPERIMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid experiment type '{experiment_type}'. Valid types: {', '.join(RND_EXPERIMENT_TYPES)}.")
    if status and status not in RND_EXPERIMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'. Valid statuses: {', '.join(RND_EXPERIMENT_STATUSES)}.")
    if result and result not in RND_EXPERIMENT_RESULTS:
        raise HTTPException(status_code=400, detail=f"Invalid result '{result}'. Valid results: {', '.join(RND_EXPERIMENT_RESULTS)}.")


def _clean_parameters(params) -> list[dict]:
    rows = []
    for idx, p in enumerate(params or [], start=1):
        row = p if isinstance(p, dict) else p.model_dump()
        if not (row.get("parameter") or "").strip():
            raise HTTPException(status_code=400, detail=f"Test parameter row {idx} has no parameter name. Fill it in or remove the row.")
        if row.get("result") and row["result"] not in ("pass", "fail"):
            raise HTTPException(status_code=400, detail=f"Test parameter row {idx}: result must be Pass, Fail, or blank.")
        rows.append({**row, "parameter": row["parameter"].strip()})
    return rows


@router.get("", response_model=list[RndExperimentResponse])
async def list_experiments(
    project_id: int | None = None,
    prototype_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    result: str | None = None,
    experiment_type: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(RndExperiment).filter(RndExperiment.is_deleted == False)  # noqa: E712
    if project_id:
        query = query.filter(RndExperiment.project_id == project_id)
    if prototype_id:
        query = query.filter(RndExperiment.prototype_id == prototype_id)
    if status_filter:
        query = query.filter(RndExperiment.status == status_filter)
    if result:
        query = query.filter(RndExperiment.result == result)
    if experiment_type:
        query = query.filter(RndExperiment.experiment_type == experiment_type)
    if search:
        like = f"%{search}%"
        query = query.filter((RndExperiment.title.ilike(like)) | (RndExperiment.experiment_number.ilike(like)))
    return [_to_response(db, e) for e in query.order_by(RndExperiment.created_at.desc()).all()]


@router.post("", response_model=RndExperimentResponse)
async def create_experiment(
    payload: RndExperimentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Experiment title is required.")
    _validate_choices(payload.experiment_type, None, None)
    _validate_links(db, payload.project_id, payload.prototype_id)

    exp = RndExperiment(
        experiment_number=generate_experiment_number(db),
        project_id=payload.project_id,
        prototype_id=payload.prototype_id,
        title=payload.title.strip(),
        experiment_type=payload.experiment_type,
        objective=payload.objective,
        method=payload.method,
        experiment_date=payload.experiment_date,
        conducted_by_id=payload.conducted_by_id or user.id,
        parameters=_clean_parameters(payload.parameters),
        observations=payload.observations,
        conclusion=payload.conclusion,
        status="planned",
        created_by_id=user.id,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return _to_response(db, exp)


@router.get("/{experiment_id}", response_model=RndExperimentResponse)
async def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, experiment_id))


@router.patch("/{experiment_id}", response_model=RndExperimentResponse)
async def update_experiment(experiment_id: int, payload: RndExperimentUpdate, db: Session = Depends(get_db)):
    exp = _get_or_404(db, experiment_id)
    updates = payload.model_dump(exclude_unset=True)

    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Experiment title can't be empty.")
    _validate_choices(updates.get("experiment_type"), updates.get("status"), updates.get("result"))
    _validate_links(db, updates.get("project_id", exp.project_id), updates.get("prototype_id", exp.prototype_id))

    new_status = updates.get("status", exp.status)
    new_result = updates.get("result", exp.result)
    if new_status == "completed" and not new_result:
        raise HTTPException(
            status_code=400,
            detail="Set the overall Result (Pass / Fail / Inconclusive) before marking the experiment Completed.",
        )
    if "parameters" in updates:
        updates["parameters"] = _clean_parameters(updates["parameters"])

    if updates.get("project_id") is not None and updates["project_id"] != exp.project_id:
        # Documents attached to this experiment follow it to its new project.
        db.query(RndDocument).filter(RndDocument.experiment_id == exp.id).update(
            {RndDocument.project_id: updates["project_id"]}, synchronize_session=False,
        )
    for field, val in updates.items():
        setattr(exp, field, val)
    db.commit()
    db.refresh(exp)
    return _to_response(db, exp)


@router.delete("/{experiment_id}")
async def delete_experiment(experiment_id: int, db: Session = Depends(get_db)):
    exp = _get_or_404(db, experiment_id)
    exp.is_deleted = True
    exp.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{exp.experiment_number} deleted"}
