from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.budget import PmBudgetLine, PmCostEntry
from app.modules.projects.schemas.budget import (
    PmBudgetLineCreate, PmBudgetLineUpdate, PmBudgetLineResponse,
    PmCostEntryCreate, PmCostEntryUpdate, PmCostEntryResponse,
)

router = APIRouter(
    prefix="/projects/{project_id}/budget", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="budget_cost",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_budget_line_or_404(db: Session, project_id: int, line_id: int) -> PmBudgetLine:
    line = db.query(PmBudgetLine).filter(
        PmBudgetLine.id == line_id, PmBudgetLine.project_id == project_id
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail=f"Budget line #{line_id} not found on project #{project_id}")
    return line


def _get_cost_entry_or_404(db: Session, project_id: int, entry_id: int) -> PmCostEntry:
    entry = db.query(PmCostEntry).filter(
        PmCostEntry.id == entry_id, PmCostEntry.project_id == project_id
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail=f"Cost entry #{entry_id} not found on project #{project_id}")
    return entry


def _spent_amount(db: Session, budget_line_id: int) -> float:
    total = db.query(func.sum(PmCostEntry.amount)).filter(PmCostEntry.budget_line_id == budget_line_id).scalar()
    return float(total) if total is not None else 0.0


def _line_to_response(db: Session, line: PmBudgetLine) -> PmBudgetLineResponse:
    resp = PmBudgetLineResponse.model_validate(line)
    resp.spent_amount = _spent_amount(db, line.id)
    resp.remaining_amount = line.budgeted_amount - resp.spent_amount
    return resp


def _entry_to_response(db: Session, entry: PmCostEntry) -> PmCostEntryResponse:
    resp = PmCostEntryResponse.model_validate(entry)
    if entry.recorded_by_id:
        recorder = db.query(User).filter(User.id == entry.recorded_by_id).first()
        if recorder:
            resp.recorded_by_name = recorder.name or recorder.email
    return resp


# ---------------------------------------------------------------------------
# Budget lines
# ---------------------------------------------------------------------------

@router.get("/lines", response_model=list[PmBudgetLineResponse])
async def list_budget_lines(project_id: int, db: Session = Depends(get_db)):
    _get_project_or_404(db, project_id)
    lines = db.query(PmBudgetLine).filter(PmBudgetLine.project_id == project_id).order_by(PmBudgetLine.id.asc()).all()
    return [_line_to_response(db, l) for l in lines]


@router.post("/lines", response_model=PmBudgetLineResponse)
async def create_budget_line(
    project_id: int,
    payload: PmBudgetLineCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    line = PmBudgetLine(
        project_id=project_id,
        category=payload.category,
        budgeted_amount=payload.budgeted_amount,
        notes=payload.notes,
    )
    db.add(line)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Budget line '{line.category}' created by {user.name or user.email}.")

    db.commit()
    db.refresh(line)
    return _line_to_response(db, line)


@router.patch("/lines/{line_id}", response_model=PmBudgetLineResponse)
async def update_budget_line(
    project_id: int,
    line_id: int,
    payload: PmBudgetLineUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    line = _get_budget_line_or_404(db, project_id, line_id)
    updates = payload.model_dump(exclude_unset=True)

    for field, val in updates.items():
        old_val = getattr(line, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(line, field, val)

    db.commit()
    db.refresh(line)
    return _line_to_response(db, line)


@router.delete("/lines/{line_id}")
async def delete_budget_line(
    project_id: int,
    line_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    line = _get_budget_line_or_404(db, project_id, line_id)

    entry_count = db.query(PmCostEntry).filter(PmCostEntry.budget_line_id == line_id).count()
    if entry_count:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete this budget line — {entry_count} cost entries are recorded against it.",
        )

    _write_audit(db, project_id, "deleted", user, summary=f"Budget line '{line.category}' deleted by {user.name or user.email}.")
    db.delete(line)
    db.commit()
    return {"message": "Budget line deleted"}


# ---------------------------------------------------------------------------
# Cost entries
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[PmCostEntryResponse])
async def list_cost_entries(
    project_id: int,
    budget_line_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmCostEntry).filter(PmCostEntry.project_id == project_id)
    if budget_line_id is not None:
        query = query.filter(PmCostEntry.budget_line_id == budget_line_id)
    entries = query.order_by(PmCostEntry.id.asc()).all()
    return [_entry_to_response(db, e) for e in entries]


@router.post("/entries", response_model=PmCostEntryResponse)
async def create_cost_entry(
    project_id: int,
    payload: PmCostEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.budget_line_id is not None:
        if not db.query(PmBudgetLine).filter(
            PmBudgetLine.id == payload.budget_line_id, PmBudgetLine.project_id == project_id
        ).first():
            raise HTTPException(status_code=404, detail=f"Budget line #{payload.budget_line_id} not found on project #{project_id}")

    entry = PmCostEntry(
        project_id=project_id,
        budget_line_id=payload.budget_line_id,
        amount=payload.amount,
        cost_date=payload.cost_date,
        description=payload.description,
        recorded_by_id=user.id,
    )
    db.add(entry)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Cost entry of {entry.amount} recorded by {user.name or user.email}.")

    db.commit()
    db.refresh(entry)
    return _entry_to_response(db, entry)


@router.patch("/entries/{entry_id}", response_model=PmCostEntryResponse)
async def update_cost_entry(
    project_id: int,
    entry_id: int,
    payload: PmCostEntryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    entry = _get_cost_entry_or_404(db, project_id, entry_id)
    updates = payload.model_dump(exclude_unset=True)

    if "budget_line_id" in updates and updates["budget_line_id"] is not None:
        if not db.query(PmBudgetLine).filter(
            PmBudgetLine.id == updates["budget_line_id"], PmBudgetLine.project_id == project_id
        ).first():
            raise HTTPException(status_code=404, detail=f"Budget line #{updates['budget_line_id']} not found on project #{project_id}")

    for field, val in updates.items():
        old_val = getattr(entry, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(entry, field, val)

    db.commit()
    db.refresh(entry)
    return _entry_to_response(db, entry)


@router.delete("/entries/{entry_id}")
async def delete_cost_entry(
    project_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    entry = _get_cost_entry_or_404(db, project_id, entry_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Cost entry of {entry.amount} deleted by {user.name or user.email}.")
    db.delete(entry)
    db.commit()
    return {"message": "Cost entry deleted"}
