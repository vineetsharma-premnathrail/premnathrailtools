"""Measuring points (IK01-IK03) and measuring documents (IK11 / IK17) of a
plant asset.

    GET    /maintenance/assets/{id}/measuring-points
    POST   /maintenance/assets/{id}/measuring-points           Assets › Edit
    PATCH  /maintenance/measuring-points/{id}                  Assets › Edit
    GET    /maintenance/assets/{id}/readings?point_id=&main=   reading history (newest first)
    POST   /maintenance/assets/{id}/readings                   Assets › Edit or Work Orders › Edit

All validation (no backwards counter, limit breach → abnormality request,
counter-based PM trigger) is in maintenance/counters.py."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permission_registry import can_perform
from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.maintenance import access  # noqa: F401 — registers the maintenance data scopes
from app.modules.maintenance import counters
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.counters import MaintenanceMeasuringPoint, MaintenanceMeasurementDoc
from app.modules.maintenance.service import user_names

router = APIRouter(prefix="/maintenance", tags=["Maintenance"], dependencies=[Depends(require_app_access("maintenance"))])


class MeasuringPointPayload(BaseModel):
    name: str | None = None
    unit: str | None = None
    is_counter: bool | None = None
    lower_limit: float | None = None
    upper_limit: float | None = None
    target_value: float | None = None
    is_active: bool | None = None
    remarks: str | None = None


class ReadingPayload(BaseModel):
    reading: float
    measuring_point_id: int | None = None  # blank = the asset's main counter
    read_at: datetime | None = None
    source: str = "manual"
    remarks: str | None = None
    override_reason: str | None = None     # admin: counter reset / meter replaced


def _asset(db: Session, asset_id: int, user: User) -> MaintenanceAsset:
    a = db.query(MaintenanceAsset).filter(MaintenanceAsset.id == asset_id, MaintenanceAsset.is_deleted == False).first()  # noqa: E712
    if not a:
        raise HTTPException(status_code=404, detail=f"Asset #{asset_id} not found — it may have been deleted.")
    ensure_in_scope(db, user, a)
    return a


def _point_out(p: MaintenanceMeasuringPoint) -> dict:
    state = None
    if p.current_reading is not None:
        state = {"low": "below_limit", "high": "above_limit"}.get(counters.check_limits(p, p.current_reading) or "", "ok")
    return {
        "id": p.id, "asset_id": p.asset_id, "name": p.name, "unit": p.unit, "is_counter": p.is_counter,
        "lower_limit": p.lower_limit, "upper_limit": p.upper_limit, "target_value": p.target_value,
        "current_reading": p.current_reading, "last_read_at": p.last_read_at, "is_active": p.is_active,
        "remarks": p.remarks, "limit_state": state,
    }


def _doc_out(d: MaintenanceMeasurementDoc, names: dict, points: dict, extra: dict | None = None) -> dict:
    p = points.get(d.measuring_point_id)
    return {
        "id": d.id, "asset_id": d.asset_id, "measuring_point_id": d.measuring_point_id,
        "point_name": p.name if p else "Main counter", "unit": p.unit if p else None,
        "reading": d.reading, "previous_reading": d.previous_reading, "difference": d.difference,
        "read_at": d.read_at, "read_by_id": d.read_by_id, "read_by_name": names.get(d.read_by_id), "source": d.source,
        "work_order_id": d.work_order_id, "limit_breach": d.limit_breach, "request_id": d.request_id,
        "override_reason": d.override_reason, "remarks": d.remarks, **(extra or {}),
    }


def _validate_point(data: dict, partial: bool) -> None:
    if not partial or "name" in data:
        if not (data.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Measuring point name is required (e.g. 'Hydraulic oil temperature').")
    if not partial or "unit" in data:
        if not (data.get("unit") or "").strip():
            raise HTTPException(status_code=400, detail="Unit is required (e.g. °C, bar, mm/s, hours).")
    lo, hi = data.get("lower_limit"), data.get("upper_limit")
    if lo is not None and hi is not None and lo >= hi:
        raise HTTPException(status_code=400, detail=f"Lower limit ({lo:g}) must be below the upper limit ({hi:g}).")


@router.get("/assets/{asset_id}/measuring-points")
async def list_points(asset_id: int, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("maintenance", "assets", "readings", "view"))):
    a = _asset(db, asset_id, user)
    pts = db.query(MaintenanceMeasuringPoint).filter(MaintenanceMeasuringPoint.asset_id == a.id).order_by(MaintenanceMeasuringPoint.id).all()
    return {"main_counter": {"meter_unit": a.meter_unit, "current_reading": a.current_meter_reading,
                             "updated_at": a.meter_updated_at},
            "points": [_point_out(p) for p in pts]}


@router.post("/assets/{asset_id}/measuring-points", status_code=201)
async def create_point(asset_id: int, payload: MeasuringPointPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "assets", "readings", "edit"))):
    a = _asset(db, asset_id, user)
    data = payload.model_dump()
    _validate_point(data, partial=False)
    if db.query(MaintenanceMeasuringPoint.id).filter(
        MaintenanceMeasuringPoint.asset_id == a.id, MaintenanceMeasuringPoint.name.ilike(data["name"].strip()),
    ).first():
        raise HTTPException(status_code=409, detail=f"{a.asset_code} already has a measuring point named '{data['name'].strip()}'.")
    p = MaintenanceMeasuringPoint(
        asset_id=a.id, name=data["name"].strip(), unit=data["unit"].strip(), is_counter=bool(data.get("is_counter")),
        lower_limit=data.get("lower_limit"), upper_limit=data.get("upper_limit"), target_value=data.get("target_value"),
        is_active=True if data.get("is_active") is None else data["is_active"], remarks=(data.get("remarks") or "").strip() or None,
        created_by_id=user.id,
    )
    db.add(p)
    db.commit()
    return _point_out(p)


@router.patch("/measuring-points/{point_id}")
async def update_point(point_id: int, payload: MeasuringPointPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "assets", "readings", "edit"))):
    p = db.get(MaintenanceMeasuringPoint, point_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Measuring point #{point_id} not found.")
    _asset(db, p.asset_id, user)
    data = payload.model_dump(exclude_unset=True)
    merged = {"lower_limit": p.lower_limit, "upper_limit": p.upper_limit, **data}
    _validate_point(merged, partial=True)
    if "is_counter" in data and data["is_counter"] != p.is_counter and p.current_reading is not None:
        raise HTTPException(status_code=409, detail=f"'{p.name}' already has readings, so it can't switch between counter and condition point. Add a new point instead.")
    for k, v in data.items():
        if k in ("name", "unit") and v is not None:
            v = v.strip()
        setattr(p, k, v)
    db.commit()
    return _point_out(p)


@router.get("/assets/{asset_id}/readings")
async def list_readings(
    asset_id: int, point_id: int | None = None, main: bool = False, limit: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db), user: User = Depends(require_feature_action("maintenance", "assets", "readings", "view")),
):
    a = _asset(db, asset_id, user)
    q = db.query(MaintenanceMeasurementDoc).filter(MaintenanceMeasurementDoc.asset_id == a.id)
    if point_id:
        q = q.filter(MaintenanceMeasurementDoc.measuring_point_id == point_id)
    elif main:
        q = q.filter(MaintenanceMeasurementDoc.measuring_point_id.is_(None))
    docs = q.order_by(MaintenanceMeasurementDoc.read_at.desc(), MaintenanceMeasurementDoc.id.desc()).limit(limit).all()
    points = {p.id: p for p in db.query(MaintenanceMeasuringPoint).filter(MaintenanceMeasuringPoint.asset_id == a.id).all()}
    names = user_names(db, [d.read_by_id for d in docs])
    return [_doc_out(d, names, points) for d in docs]


@router.post("/assets/{asset_id}/readings", status_code=201)
async def post_reading(asset_id: int, payload: ReadingPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "assets", "readings", "create"))):
    if not (can_perform(user, "maintenance", "assets", "edit") or can_perform(user, "maintenance", "work_orders", "edit")):
        raise HTTPException(
            status_code=403,
            detail="Entering readings needs Maintenance › Assets › Edit or Maintenance › Work Orders › Edit. Ask an admin to add it to your role.",
        )
    a = _asset(db, asset_id, user)
    point = None
    if payload.measuring_point_id:
        point = db.get(MaintenanceMeasuringPoint, payload.measuring_point_id)
        if not point or point.asset_id != a.id:
            raise HTTPException(status_code=404, detail=f"Measuring point #{payload.measuring_point_id} isn't on {a.asset_code}.")
    if payload.source == "wo_completion":
        raise HTTPException(status_code=400, detail="Completion readings are entered when completing the work order.")
    result = counters.post_reading(
        db, a, payload.reading, user, point=point, read_at=payload.read_at, source=payload.source,
        remarks=payload.remarks, override_reason=payload.override_reason,
    )
    db.commit()
    req = result["request"]
    names = user_names(db, [user.id])
    points = {point.id: point} if point else {}
    return _doc_out(result["doc"], names, points, {
        "request_number": req.request_number if req is not None else None,
        "generated_work_orders": [{"id": w.id, "wo_number": w.wo_number} for w in result["generated"]],
    })
