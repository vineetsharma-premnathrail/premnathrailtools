"""Quality › Gauges — test equipment register and calibration history
(QM-IM). Maintained under the Masters tab permissions; the list is also
readable by anyone who records inspection results (the gauge picker)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import require_app_access, require_feature_action, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.quality.models.gauge import QUALITY_GAUGE_STATUSES, QualityGauge
from app.modules.quality.services.gauges import GaugeError, calibration_state, record_calibration, usable_problem

router = APIRouter(prefix="/quality/gauges", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "masters", "create")
_CAN_EDIT = require_tab_action("quality", "masters", "edit")


def _can_read(user: User = Depends(get_current_user)) -> User:
    if not any(can_view_tab(user, "quality", tab) for tab in ("masters", "inspection_lots", "my_inspections", "in_process_inspection")):
        raise HTTPException(status_code=403, detail="You need the Masters or Inspection Lots tab in Quality to see the gauge register. "
                                                    "Ask an admin to grant it in Organization › Role & Permissions.")
    return user


class QualityGaugeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    gauge_type: str | None = None
    make: str | None = None
    serial_number: str | None = None
    measuring_range: str | None = None
    least_count: str | None = None
    location: str | None = None
    custodian_id: int | None = None
    calibration_interval_days: int = Field(365, ge=1, le=3650)
    last_calibrated_on: date | None = None
    next_due_on: date | None = None
    certificate_ref: str | None = None
    calibration_agency: str | None = None
    remarks: str | None = None


class QualityGaugeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    gauge_type: str | None = None
    make: str | None = None
    serial_number: str | None = None
    measuring_range: str | None = None
    least_count: str | None = None
    location: str | None = None
    custodian_id: int | None = None
    calibration_interval_days: int | None = Field(None, ge=1, le=3650)
    status: str | None = None
    remarks: str | None = None


class QualityGaugeCalibrationPayload(BaseModel):
    calibrated_on: date
    result: str = Field(pattern="^(pass|fail|adjusted)$")
    next_due_on: date | None = None
    agency: str | None = None
    certificate_ref: str | None = None
    error_found: float | None = None
    remarks: str | None = None


class QualityGaugeCalibrationResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    calibrated_on: date
    result: str
    next_due_on: date | None = None
    agency: str | None = None
    certificate_ref: str | None = None
    error_found: float | None = None
    remarks: str | None = None
    recorded_by_id: int | None = None


class QualityGaugeResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    code: str
    name: str
    gauge_type: str | None = None
    make: str | None = None
    serial_number: str | None = None
    measuring_range: str | None = None
    least_count: str | None = None
    location: str | None = None
    custodian_id: int | None = None
    status: str
    calibration_interval_days: int
    last_calibrated_on: date | None = None
    next_due_on: date | None = None
    certificate_ref: str | None = None
    calibration_agency: str | None = None
    remarks: str | None = None
    calibrations: list[QualityGaugeCalibrationResponse] = []
    # ok / due_soon / overdue / never_calibrated / blocked
    calibration_state: str = "ok"
    usable: bool = True
    blocked_reason: str | None = None


def _resp(g: QualityGauge, with_history: bool = False) -> QualityGaugeResponse:
    r = QualityGaugeResponse.model_validate(g)
    if not with_history:
        r.calibrations = []
    r.calibration_state = calibration_state(g)
    r.blocked_reason = usable_problem(g)
    r.usable = r.blocked_reason is None
    return r


def _get(db: Session, gauge_id: int) -> QualityGauge:
    g = db.query(QualityGauge).filter(QualityGauge.id == gauge_id, QualityGauge.is_deleted == False).first()  # noqa: E712
    if g is None:
        raise HTTPException(status_code=404, detail=f"Gauge #{gauge_id} not found")
    return g


@router.get("", response_model=list[QualityGaugeResponse])
async def list_gauges(
    status: str | None = None, gauge_type: str | None = None, usable_only: bool = False, search: str | None = None,
    db: Session = Depends(get_db), _user: User = Depends(_can_read),
):
    q = db.query(QualityGauge).filter(QualityGauge.is_deleted == False)  # noqa: E712
    if status:
        q = q.filter(QualityGauge.status == status)
    if gauge_type:
        q = q.filter(QualityGauge.gauge_type.ilike(f"%{gauge_type}%"))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(QualityGauge.code.ilike(like) | QualityGauge.name.ilike(like) | QualityGauge.serial_number.ilike(like))
    out = [_resp(g) for g in q.order_by(QualityGauge.code).all()]
    return [r for r in out if r.usable] if usable_only else out


@router.get("/{gauge_id}", response_model=QualityGaugeResponse)
async def get_gauge(gauge_id: int, db: Session = Depends(get_db), _user: User = Depends(_can_read)):
    # Calibration history follows the Masters › Gauge calibration switch for
    # roles that hold the Masters tab (inspectors pick gauges from other tabs).
    history = not can_view_tab(_user, "quality", "masters") or can_feature(_user, "quality", "masters", "calibration", "view")
    return _resp(_get(db, gauge_id), with_history=history)


@router.post("", response_model=QualityGaugeResponse, status_code=201)
async def create_gauge(payload: QualityGaugeCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    code = payload.code.strip().upper()
    if db.query(QualityGauge.id).filter(QualityGauge.code == code).first():
        raise HTTPException(status_code=409, detail=f"Gauge code {code} is already registered. Use a unique code (e.g. VC-012).")
    data = payload.model_dump()
    data["code"] = code
    if data.get("last_calibrated_on") and not data.get("next_due_on"):
        from datetime import timedelta
        data["next_due_on"] = data["last_calibrated_on"] + timedelta(days=payload.calibration_interval_days)
    if data.get("last_calibrated_on") and data.get("next_due_on") and data["next_due_on"] <= data["last_calibrated_on"]:
        raise HTTPException(status_code=400, detail="The next calibration due date must be after the last calibration date.")
    g = QualityGauge(**data, status="active", created_by_id=user.id)
    db.add(g)
    db.commit()
    db.refresh(g)
    return _resp(g, with_history=True)


@router.patch("/{gauge_id}", response_model=QualityGaugeResponse)
async def update_gauge(gauge_id: int, payload: QualityGaugeUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    g = _get(db, gauge_id)
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates:
        if updates["status"] not in QUALITY_GAUGE_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Use one of: {', '.join(QUALITY_GAUGE_STATUSES)}.")
        if updates["status"] == "active" and g.status == "out_of_calibration":
            raise HTTPException(status_code=409, detail=f"Gauge {g.code} is out of calibration — record a passing calibration to bring it back "
                                                        "into use; it can't just be switched back to active.")
    for k, v in updates.items():
        setattr(g, k, v)
    db.commit()
    db.refresh(g)
    return _resp(g, with_history=True)


@router.post("/{gauge_id}/calibrations", response_model=QualityGaugeResponse)
async def add_calibration(gauge_id: int, payload: QualityGaugeCalibrationPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("quality", "masters", "calibration", "create"))):
    g = _get(db, gauge_id)
    try:
        record_calibration(db, g, user_id=user.id, **payload.model_dump())
    except GaugeError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.refresh(g)
    return _resp(g, with_history=True)
