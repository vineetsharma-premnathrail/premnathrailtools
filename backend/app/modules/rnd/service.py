"""Plain-function helpers for the R&D module — project / experiment /
prototype number generation, the project stage gates, and prototype cost
roll-ups. Mirrors app/modules/quality/service.py's number-generation pattern."""
from datetime import date
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.rnd.models.project import RndProject, RND_PROJECT_STAGES
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype, RndPrototypeBomItem
from app.modules.rnd.models.feasibility import RndFeasibilityStudy


def _lock_number_series(db: Session, prefix: str) -> None:
    """Serializes concurrent number generation for a given prefix via a
    transaction-scoped Postgres advisory lock — see quality/service.py for
    the full rationale. Skipped on other dialects — the SQLite test database
    has no advisory locks and no concurrent writers."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})


def _next_number(db: Session, column, code: str) -> str:
    """<CODE>-[YEAR]-[NNNN], sequence scoped per year."""
    prefix = f"{code}-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}"
    return f"{prefix}0001"


def generate_project_number(db: Session) -> str:
    return _next_number(db, RndProject.project_number, "RND")


def generate_experiment_number(db: Session) -> str:
    return _next_number(db, RndExperiment.experiment_number, "EXP")


def generate_prototype_number(db: Session) -> str:
    return _next_number(db, RndPrototype.prototype_number, "PRT")


def user_names(db: Session, ids) -> dict[int, str]:
    """id -> display name for a batch of user ids (None/missing ids skipped)."""
    from app.modules.main.models.user import User

    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(wanted)).all()}


def prototype_bom_cost(prototype: RndPrototype) -> float:
    return round(sum((i.quantity or 0) * (i.unit_cost or 0) for i in prototype.bom_items), 2)


def project_actual_cost(db: Session, project_id: int) -> float:
    """Actual R&D spend = sum of every live prototype's BOM cost."""
    total = (
        db.query(func.coalesce(func.sum(RndPrototypeBomItem.quantity * func.coalesce(RndPrototypeBomItem.unit_cost, 0)), 0))
        .join(RndPrototype, RndPrototype.id == RndPrototypeBomItem.prototype_id)
        .filter(RndPrototype.project_id == project_id, RndPrototype.is_deleted == False)  # noqa: E712
        .scalar()
    )
    return round(float(total or 0), 2)


STAGE_LABELS = {
    "initiation": "Initiation",
    "research": "Research",
    "development": "Development",
    "feasibility": "Feasibility",
    "handover": "Handover to Production",
    "closed": "Closed",
}


def check_stage_gate(db: Session, project: RndProject, target: str) -> str | None:
    """Returns a user-facing reason the project can't move to `target`, or
    None if the move is allowed. Moving backwards is always allowed; only
    the two forward gates from the SAP R&D workflow are enforced."""
    if target not in RND_PROJECT_STAGES:
        return f"Unknown stage '{target}'. Valid stages: {', '.join(RND_PROJECT_STAGES)}."
    if project.status == "cancelled":
        return "This project is cancelled. Set its status back to Active before changing the stage."

    going_forward = RND_PROJECT_STAGES.index(target) > RND_PROJECT_STAGES.index(project.stage)
    if not going_forward:
        return None

    if RND_PROJECT_STAGES.index(target) >= RND_PROJECT_STAGES.index("handover"):
        study = db.query(RndFeasibilityStudy).filter(RndFeasibilityStudy.project_id == project.id).first()
        if not study or not study.recommendation:
            return (
                "Can't move to Handover yet: the feasibility study has no recommendation. "
                "Open the Feasibility section on this project, fill it in, and set a Go or Conditional Go recommendation."
            )
        if study.recommendation == "no_go":
            return (
                "Can't move to Handover: the feasibility study recommends No-Go. "
                "Revise the study (or put the project On Hold / Cancel it) instead."
            )

    if target == "closed":
        missing = [
            label for flag, label in (
                (project.handover_specs_final, "Final product specs"),
                (project.handover_bom_approved, "Approved BOM & routing"),
                (project.handover_process_documented, "Process documentation"),
                (project.handover_quality_standards, "Quality standards"),
            ) if not flag
        ]
        if missing:
            return (
                "Can't close the project: the Handover checklist is incomplete — still unticked: "
                f"{', '.join(missing)}. Tick them in the Handover to Production section and save first."
            )
    return None
