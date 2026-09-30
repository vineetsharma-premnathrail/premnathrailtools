from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.calculations import CALC_TYPES, CalculationError, calc_type_catalog, run_calculation
from app.modules.hydraulic.models.calculation import HydCalculation
from app.modules.hydraulic.schemas.calculation import (
    HydCalculationComputePayload, HydCalculationComputeResponse, HydCalculationCreate, HydCalculationUpdate,
    HydCalculationResponse,
)
from app.modules.hydraulic.service import generate_calc_number, get_system_or_404, systems_by_id, user_names
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/calculations", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)


def _to_responses(db: Session, calcs: list[HydCalculation]) -> list[HydCalculationResponse]:
    systems = systems_by_id(db, {c.system_id for c in calcs})
    names = user_names(db, {c.created_by_id for c in calcs})
    out = []
    for c in calcs:
        resp = HydCalculationResponse.model_validate(c)
        resp.calc_type_label = CALC_TYPES.get(c.calc_type, {}).get("label", c.calc_type)
        system = systems.get(c.system_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.created_by_name = names.get(c.created_by_id)
        out.append(resp)
    return out


def _get_or_404(db: Session, calc_id: int) -> HydCalculation:
    calc = db.query(HydCalculation).filter(HydCalculation.id == calc_id, HydCalculation.is_deleted == False).first()  # noqa: E712
    if not calc:
        raise HTTPException(status_code=404, detail=f"Calculation #{calc_id} not found (it may have been deleted).")
    return calc


def _compute(calc_type: str, inputs: dict) -> tuple[dict, dict]:
    try:
        return run_calculation(calc_type, inputs)
    except CalculationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/types")
async def list_calc_types():
    """Every calculation with its input fields, units and defaults — the
    calculator form is rendered from this."""
    return calc_type_catalog()


@router.post("/compute", response_model=HydCalculationComputeResponse)
async def compute(payload: HydCalculationComputePayload):
    """Runs a calculation without saving it (live calculator)."""
    clean, out = _compute(payload.calc_type, payload.inputs)
    return {"calc_type": payload.calc_type, "inputs": clean, "results": out["results"], "warnings": out["warnings"]}


@router.get("", response_model=list[HydCalculationResponse])
async def list_calculations(
    calc_type: str | None = None,
    system_type: str | None = None,
    system_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "calculations")),
):
    query = db.query(HydCalculation).filter(HydCalculation.is_deleted == False)  # noqa: E712
    if calc_type:
        query = query.filter(HydCalculation.calc_type == calc_type)
    if system_type:
        query = query.filter(HydCalculation.system_type == system_type)
    if system_id:
        query = query.filter(HydCalculation.system_id == system_id)
    if search:
        like = f"%{search}%"
        query = query.filter(HydCalculation.calc_number.ilike(like) | HydCalculation.title.ilike(like))
    return _to_responses(db, query.order_by(HydCalculation.id.desc()).all())


@router.post("", response_model=HydCalculationResponse)
async def save_calculation(
    payload: HydCalculationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "calculations", "create")),
):
    clean, out = _compute(payload.calc_type, payload.inputs)
    if payload.system_id:
        system = get_system_or_404(db, payload.system_id)
        if system.system_type != CALC_TYPES[payload.calc_type]["system_type"]:
            raise HTTPException(
                status_code=400,
                detail=f"{CALC_TYPES[payload.calc_type]['label']} is a {CALC_TYPES[payload.calc_type]['system_type']} calculation, "
                       f"but {system.system_number} is a {system.system_type} system. Pick a matching system or leave it blank.",
            )
    calc = HydCalculation(
        calc_number=generate_calc_number(db), title=payload.title.strip(), calc_type=payload.calc_type,
        system_type=CALC_TYPES[payload.calc_type]["system_type"], system_id=payload.system_id,
        inputs=clean, results=out, remarks=payload.remarks, created_by_id=user.id,
    )
    db.add(calc)
    db.commit()
    db.refresh(calc)
    return _to_responses(db, [calc])[0]


@router.get("/{calc_id}", response_model=HydCalculationResponse)
async def get_calculation(calc_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, calc_id)])[0]


@router.patch("/{calc_id}", response_model=HydCalculationResponse)
async def update_calculation(
    calc_id: int,
    payload: HydCalculationUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "calculations", "edit")),
):
    calc = _get_or_404(db, calc_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("system_id"):
        system = get_system_or_404(db, updates["system_id"])
        if system.system_type != calc.system_type:
            raise HTTPException(status_code=400, detail=f"This is a {calc.system_type} calculation; {system.system_number} is a {system.system_type} system.")
    for field, val in updates.items():
        setattr(calc, field, val)
    db.commit()
    db.refresh(calc)
    return _to_responses(db, [calc])[0]


@router.delete("/{calc_id}")
async def delete_calculation(
    calc_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "calculations", "delete")),
):
    calc = _get_or_404(db, calc_id)
    calc.is_deleted = True
    calc.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Calculation {calc.calc_number} deleted"}
