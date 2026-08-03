import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.calculation_history import CalculationHistory
from app.modules.rnd.models.tool_calculations import (
    BrakingCalculation, HydraulicCalculation, LoadDistributionCalculation, QmaxCalculation,
    SplineCalculation, TractiveEffortCalculation, VehiclePerformanceCalculation,
)

logger = logging.getLogger("rnd.history")

router = APIRouter(prefix="/history", tags=["RnD History"])

TOOL_LABELS = {
    "braking": "Braking",
    "hydraulic": "Hydraulic",
    "qmax": "Qmax",
    "load_distribution": "Load Distribution",
    "tractive_effort": "Tractive Effort",
    "vehicle_performance": "Vehicle Performance",
    "spline": "Spline",
}


class SaveHistoryRequest(BaseModel):
    tool_name: str
    inputs: dict[str, Any]
    results: dict[str, Any]
    calculation_name: str | None = None


class RenameHistoryRequest(BaseModel):
    name: str | None = None
    calculation_name: str | None = None


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def _f(value: Any) -> float | None:
    """Best-effort float parse — tool inputs arrive as a mix of numbers and
    raw strings depending on the frontend page, so this never raises."""
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _i(value: Any) -> int | None:
    f = _f(value)
    return int(f) if f is not None else None


def _snapshot_tool_calculation(
    db: Session, tool_name: str, user_id: int, calc_name: str | None, inputs: dict[str, Any], results: dict[str, Any],
) -> None:
    """Populate the tool-specific table alongside the generic history row.
    Best-effort: a snapshot failure (unexpected shape, missing field) must
    never block the primary calculation_history save."""
    try:
        row = None
        if tool_name == "braking":
            row = BrakingCalculation(
                user_id=user_id, calculation_name=calc_name,
                mass_kg=_f(inputs.get("mass_kg")), reaction_time=_f(inputs.get("reaction_time")),
                num_wheels=_i(inputs.get("num_wheels")), calc_mode=inputs.get("calc_mode"), mu=_f(inputs.get("mu")),
                rail_speed_input=inputs.get("rail_speed_input"), rail_gradient_input=inputs.get("rail_gradient_input"),
                rail_gradient_type=inputs.get("rail_gradient_type"),
                max_braking_force_n=_f(results.get("max_force")), gbr_percent=_f(results.get("gbr")),
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "hydraulic":
            pump_results = results.get("pump_results") or [{}]
            row = HydraulicCalculation(
                user_id=user_id, calculation_name=calc_name,
                calc_mode=inputs.get("calc_mode"), weight=_f(inputs.get("weight")), axles=_i(inputs.get("axles")),
                speed=_f(inputs.get("speed")), pressure=_f(inputs.get("pressure")),
                wheel_diameter=_f(inputs.get("wheel_diameter")), slope_percent=_f(inputs.get("slope_percent")),
                suggested_motor_cc=_f(results.get("suggested_motor_cc")),
                suggested_pump_cc=_f(pump_results[0].get("suggested_pump_disp_per_pump_cc")) if pump_results else None,
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "load_distribution":
            row = LoadDistributionCalculation(
                user_id=user_id, calculation_name=calc_name,
                config_type=inputs.get("config_type"), total_load=_f(inputs.get("total_load")),
                front_percent=_f(inputs.get("front_percent")), q1_percent=_f(inputs.get("q1_percent")),
                q3_percent=_f(inputs.get("q3_percent")),
                delta_q_ratio_pct=_f(results.get("delta_q_by_q")), status=results.get("status"),
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "qmax":
            row = QmaxCalculation(
                user_id=user_id, calculation_name=calc_name,
                d_mm=_f(inputs.get("d")), sigma_b=_f(results.get("sigma_b")), v_head=_f(inputs.get("v_head")),
                qmax_kn=_f(results.get("qmax_kn")), qmax_tonnes=_f(results.get("qmax_tonnes")),
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "spline":
            row = SplineCalculation(
                user_id=user_id, calculation_name=calc_name, doc_no=inputs.get("doc_no"),
                number_teeth=_i(inputs.get("number_teeth")), diametral_pitch=_f(inputs.get("diametral_pitch")),
                pressure_angle=_f(inputs.get("pressure_angle")), outer_diameter=_f(inputs.get("outer_diameter")),
                inner_diameter=_f(inputs.get("inner_diameter")), length_engagement=_f(inputs.get("length_engagement")),
                yield_strength=_f(inputs.get("yield_strength")), material_type=inputs.get("material_type"),
                safety_factor=_f(results.get("safety_factor")), verdict=results.get("verdict"),
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "tractive_effort":
            row = TractiveEffortCalculation(
                user_id=user_id, calculation_name=calc_name,
                mode=inputs.get("mode"), load=_f(inputs.get("load")), loco_weight=_f(inputs.get("loco_weight")),
                speed=_f(inputs.get("speed")), gradient=_f(inputs.get("gradient")), grad_type=inputs.get("grad_type"),
                curvature=_f(inputs.get("curvature")), curvature_unit=inputs.get("curvature_unit"),
                te_kg=_f(results.get("te")), power_hp=_f(results.get("power")), ohe_current_a=_f(results.get("ohe_current")),
                inputs_json=inputs, results_json=results,
            )
        elif tool_name == "vehicle_performance":
            snapshot = results.get("traction_snapshot") or {}
            row = VehiclePerformanceCalculation(
                user_id=user_id, calculation_name=calc_name,
                loco_gvw_kg=_f(inputs.get("loco_gvw")), max_speed_kmh=_f(inputs.get("max_speed")),
                num_axles=_i(inputs.get("num_axles")), rear_axle_ratio=_f(inputs.get("rear_axle_ratio")),
                shunting_load_t=_f(inputs.get("shunting_load")), peak_power_kw=_f(inputs.get("peak_power")),
                max_traction_n=_f(snapshot.get("max_traction_generated_n")),
                traction_no_slip_n=_f(snapshot.get("max_traction_slipping_n")),
                traction_status=snapshot.get("result_message"),
                inputs_json=inputs, results_json=results,
            )

        if row is not None:
            db.add(row)
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Per-tool snapshot skipped for %s: %s", tool_name, exc)


@router.post("/save")
async def save_history(
    body: SaveHistoryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    calc_name = body.calculation_name
    if not calc_name:
        count = (
            db.query(func.count(CalculationHistory.id))
            .filter(
                CalculationHistory.user_id == current_user.id,
                CalculationHistory.tool_name == body.tool_name,
            )
            .scalar()
        ) or 0
        label = TOOL_LABELS.get(body.tool_name, body.tool_name.replace("_", " ").title())
        calc_name = f"{label} #{count + 1}"

    record = CalculationHistory(
        user_id=current_user.id,
        tool_name=body.tool_name,
        calculation_name=calc_name,
        inputs_json=body.inputs,
        results_json=body.results,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    _snapshot_tool_calculation(db, body.tool_name, current_user.id, calc_name, body.inputs, body.results)

    return {"id": record.id, "calculation_name": record.calculation_name, "created_at": record.created_at}


@router.get("/list")
async def list_history(
    tool_name: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Returns the current user's own history."""
    query = db.query(CalculationHistory).filter(CalculationHistory.user_id == current_user.id)
    if tool_name:
        query = query.filter(CalculationHistory.tool_name == tool_name)
    records = query.order_by(CalculationHistory.created_at.desc()).limit(100).all()
    return [
        {
            "id": r.id,
            "tool_name": r.tool_name,
            "calculation_name": r.calculation_name,
            "created_at": r.created_at,
        }
        for r in records
    ]


@router.get("/admin/list")
async def admin_list_history(
    user_id: int | None = None,
    tool_name: str | None = None,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only: list all users' history, optionally filtered by user_id or tool_name."""
    query = db.query(CalculationHistory, User.name, User.email).outerjoin(
        User, User.id == CalculationHistory.user_id
    )
    if user_id:
        query = query.filter(CalculationHistory.user_id == user_id)
    if tool_name:
        query = query.filter(CalculationHistory.tool_name == tool_name)
    rows = query.order_by(CalculationHistory.created_at.desc()).limit(500).all()
    return [
        {
            "id": record.id,
            "user_id": record.user_id,
            "user_name": name or "Unknown",
            "user_email": email or "",
            "tool_name": record.tool_name,
            "calculation_name": record.calculation_name,
            "created_at": record.created_at,
        }
        for record, name, email in rows
    ]


@router.get("/admin/users")
async def admin_list_users_with_history(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only: list all users who have at least one saved calculation."""
    rows = (
        db.query(User.id, User.name, User.email)
        .filter(User.id.in_(db.query(CalculationHistory.user_id).distinct()))
        .order_by(User.name)
        .all()
    )
    return [{"id": r.id, "name": r.name, "email": r.email} for r in rows]


@router.get("/detail/{calc_id}")
async def get_history_detail(
    calc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(CalculationHistory).filter(CalculationHistory.id == calc_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="History record not found")
    if record.user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    return {
        "id": record.id,
        "tool_name": record.tool_name,
        "calculation_name": record.calculation_name,
        "inputs": record.inputs_json,
        "results": record.results_json,
        "created_at": record.created_at,
    }


@router.patch("/rename/{calc_id}")
@router.put("/rename/{calc_id}")
async def rename_history(
    calc_id: int,
    body: RenameHistoryRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(CalculationHistory).filter(CalculationHistory.id == calc_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="History record not found")
    if record.user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    new_name = body.calculation_name or body.name
    record.calculation_name = new_name
    db.commit()
    return {"id": record.id, "calculation_name": record.calculation_name}


@router.delete("/delete/{calc_id}")
async def delete_history(
    calc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.query(CalculationHistory).filter(CalculationHistory.id == calc_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="History record not found")
    if record.user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(record)
    db.commit()
    return {"message": "Deleted successfully"}
