from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.risk import PmRisk, PM_RISK_PROBABILITIES, PM_RISK_IMPACTS, PM_RISK_STATUSES
from app.modules.projects.schemas.risk import PmRiskCreate, PmRiskUpdate, PmRiskResponse

router = APIRouter(
    prefix="/projects/{project_id}/risks", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="risks",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_risk_or_404(db: Session, project_id: int, risk_id: int) -> PmRisk:
    risk = db.query(PmRisk).filter(
        PmRisk.id == risk_id, PmRisk.project_id == project_id
    ).first()
    if not risk:
        raise HTTPException(status_code=404, detail=f"Risk #{risk_id} not found on project #{project_id}")
    return risk


def _to_response(db: Session, risk: PmRisk) -> PmRiskResponse:
    resp = PmRiskResponse.model_validate(risk)
    resp.risk_score = risk.risk_score
    if risk.owner_id:
        owner = db.query(User).filter(User.id == risk.owner_id).first()
        if owner:
            resp.owner_name = owner.name or owner.email
    return resp


@router.get("", response_model=list[PmRiskResponse])
async def list_risks(
    project_id: int,
    status_filter: str | None = Query(None, alias="status"),
    probability: str | None = Query(None),
    impact: str | None = Query(None),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmRisk).filter(PmRisk.project_id == project_id)
    if status_filter:
        query = query.filter(PmRisk.status == status_filter)
    if probability:
        query = query.filter(PmRisk.probability == probability)
    if impact:
        query = query.filter(PmRisk.impact == impact)
    risks = query.order_by(PmRisk.id.asc()).all()
    return [_to_response(db, r) for r in risks]


@router.post("", response_model=PmRiskResponse)
async def create_risk(
    project_id: int,
    payload: PmRiskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.probability and payload.probability not in PM_RISK_PROBABILITIES:
        raise HTTPException(status_code=400, detail=f"Invalid probability '{payload.probability}'. Must be one of {PM_RISK_PROBABILITIES}.")
    if payload.impact and payload.impact not in PM_RISK_IMPACTS:
        raise HTTPException(status_code=400, detail=f"Invalid impact '{payload.impact}'. Must be one of {PM_RISK_IMPACTS}.")
    if payload.owner_id is not None:
        if not db.query(User).filter(User.id == payload.owner_id).first():
            raise HTTPException(status_code=404, detail=f"User #{payload.owner_id} not found")

    risk = PmRisk(
        project_id=project_id,
        title=payload.title,
        description=payload.description,
        probability=payload.probability or "medium",
        impact=payload.impact or "medium",
        status="identified",
        mitigation_plan=payload.mitigation_plan,
        owner_id=payload.owner_id,
    )
    db.add(risk)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Risk '{risk.title}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(risk)
    return _to_response(db, risk)


@router.patch("/{risk_id}", response_model=PmRiskResponse)
async def update_risk(
    project_id: int,
    risk_id: int,
    payload: PmRiskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    risk = _get_risk_or_404(db, project_id, risk_id)
    updates = payload.model_dump(exclude_unset=True)

    new_probability = updates.get("probability")
    if new_probability and new_probability not in PM_RISK_PROBABILITIES:
        raise HTTPException(status_code=400, detail=f"Invalid probability '{new_probability}'. Must be one of {PM_RISK_PROBABILITIES}.")
    new_impact = updates.get("impact")
    if new_impact and new_impact not in PM_RISK_IMPACTS:
        raise HTTPException(status_code=400, detail=f"Invalid impact '{new_impact}'. Must be one of {PM_RISK_IMPACTS}.")
    new_status = updates.get("status")
    if new_status and new_status not in PM_RISK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_RISK_STATUSES}.")
    if "owner_id" in updates and updates["owner_id"] is not None:
        if not db.query(User).filter(User.id == updates["owner_id"]).first():
            raise HTTPException(status_code=404, detail=f"User #{updates['owner_id']} not found")

    for field, val in updates.items():
        old_val = getattr(risk, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(risk, field, val)

    db.commit()
    db.refresh(risk)
    return _to_response(db, risk)


@router.delete("/{risk_id}")
async def delete_risk(
    project_id: int,
    risk_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    risk = _get_risk_or_404(db, project_id, risk_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Risk '{risk.title}' deleted by {user.name or user.email}.")
    db.delete(risk)
    db.commit()
    return {"message": "Risk deleted"}
