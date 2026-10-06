"""Quality masters: inspection characteristics, defect codes, disposition
codes, simple master lists, and the (read-only) ISO 2859-1 sampling tables.
Masters are retired (is_active=false), never deleted."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.characteristic import (
    QualityCharacteristic, QUALITY_CHARACTERISTIC_TYPES, QUALITY_CHARACTERISTIC_CLASSES,
)
from app.modules.quality.models.masters import (
    QualityDefectCode, QualityDispositionCode, QualityMasterValue,
    QUALITY_DEFECT_CATEGORIES, QUALITY_DISPOSITION_TYPES, QUALITY_DISPOSITION_TYPE_LABELS, QUALITY_MASTER_LISTS,
)
from app.modules.quality.models.sampling import QualityAqlPlan, QualitySampleSizeCode
from app.modules.quality.schemas.masters import (
    QualityCharacteristicCreate, QualityCharacteristicUpdate, QualityCharacteristicResponse,
    QualityDefectCodeCreate, QualityDefectCodeUpdate, QualityDefectCodeResponse,
    QualityDispositionCodeCreate, QualityDispositionCodeUpdate, QualityDispositionCodeResponse,
    QualityMasterValueCreate, QualityMasterValueUpdate, QualityMasterValueResponse,
    QualityAqlPlanResponse, QualitySampleSizeCodeResponse, QualitySamplingCalcResponse,
)
from app.modules.quality.services import access
from app.modules.quality.services.sampling import ensure_sampling_tables, aql_plan
from app.modules.quality.services.settings import ensure_master_lists

router = APIRouter(prefix="/quality/masters", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "masters", "create")
_CAN_EDIT = require_tab_action("quality", "masters", "edit")

# Seeded on first use so a fresh database has a working starting set.
_DEFAULT_DISPOSITION_CODES = [
    ("UAI", "Use as is", "use_as_is"), ("RWK", "Rework", "rework"), ("REP", "Repair", "repair"),
    ("RTV", "Return to vendor", "return_to_vendor"), ("SCR", "Scrap", "scrap"),
]


def ensure_disposition_codes(db: Session) -> None:
    if db.query(QualityDispositionCode.id).first() is None:
        for code, name, t in _DEFAULT_DISPOSITION_CODES:
            db.add(QualityDispositionCode(code=code, name=name, disposition_type=t))
        db.flush()


def _norm_code(code: str) -> str:
    c = (code or "").strip().upper()
    if not c or len(c) > 30:
        raise HTTPException(status_code=422, detail="Code is required (up to 30 characters).")
    return c


def _dup(db: Session, model, code: str, label: str) -> None:
    if db.query(model.id).filter(func.upper(model.code) == code).first():
        raise HTTPException(status_code=409, detail=f"{label} code '{code}' already exists — codes are unique; edit or reactivate the existing one.")


# --- meta -------------------------------------------------------------------

@router.get("/meta")
async def masters_meta(db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return {
        "characteristic_types": list(QUALITY_CHARACTERISTIC_TYPES),
        "classifications": list(QUALITY_CHARACTERISTIC_CLASSES),
        "defect_categories": list(QUALITY_DEFECT_CATEGORIES),
        "disposition_types": [{"value": t, "label": QUALITY_DISPOSITION_TYPE_LABELS[t]} for t in QUALITY_DISPOSITION_TYPES],
        "master_lists": [{"key": k, "label": v} for k, v in QUALITY_MASTER_LISTS.items()],
        "authority": {
            "is_quality_head": access.is_quality_head(user), "is_quality_engineer": access.is_quality_engineer(user),
            "can_decide_lot": access.can_decide_lot(user), "can_approve_plan": access.can_approve_plan(user),
            "can_edit_settings": access.can_edit_settings(user), "is_design": access.is_design_authority(user),
            "is_purchase": access.is_purchase_authority(user), "is_partner": access.is_partner(user),
        },
    }


# --- characteristics --------------------------------------------------------

@router.get("/characteristics", response_model=list[QualityCharacteristicResponse])
async def list_characteristics(include_inactive: bool = False, search: str | None = None, db: Session = Depends(get_db)):
    q = db.query(QualityCharacteristic)
    if not include_inactive:
        q = q.filter(QualityCharacteristic.is_active.is_(True))
    if search:
        like = f"%{search}%"
        q = q.filter(QualityCharacteristic.code.ilike(like) | QualityCharacteristic.name.ilike(like))
    return q.order_by(QualityCharacteristic.code).all()


def _validate_char(data: dict) -> None:
    if "char_type" in data and data["char_type"] not in QUALITY_CHARACTERISTIC_TYPES:
        raise HTTPException(status_code=422, detail="Type must be 'variable' (measured value) or 'attribute' (pass/fail).")
    if data.get("classification") is not None and data["classification"] not in QUALITY_CHARACTERISTIC_CLASSES:
        raise HTTPException(status_code=422, detail="Classification must be critical, major or minor.")
    if "name" in data and not (data["name"] or "").strip():
        raise HTTPException(status_code=422, detail="Characteristic name is required.")


@router.post("/characteristics", response_model=QualityCharacteristicResponse)
async def create_characteristic(payload: QualityCharacteristicCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    data = payload.model_dump()
    data["code"] = _norm_code(data["code"])
    _validate_char(data)
    _dup(db, QualityCharacteristic, data["code"], "Characteristic")
    ch = QualityCharacteristic(**data, created_by_id=user.id)
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.patch("/characteristics/{char_id}", response_model=QualityCharacteristicResponse)
async def update_characteristic(char_id: int, payload: QualityCharacteristicUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    ch = db.query(QualityCharacteristic).filter(QualityCharacteristic.id == char_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail=f"Characteristic #{char_id} not found")
    data = payload.model_dump(exclude_unset=True)
    _validate_char(data)
    for k, v in data.items():
        setattr(ch, k, v)
    db.commit()
    db.refresh(ch)
    return ch


# --- defect codes -----------------------------------------------------------

@router.get("/defect-codes", response_model=list[QualityDefectCodeResponse])
async def list_defect_codes(include_inactive: bool = False, db: Session = Depends(get_db)):
    q = db.query(QualityDefectCode)
    if not include_inactive:
        q = q.filter(QualityDefectCode.is_active.is_(True))
    return q.order_by(QualityDefectCode.category, QualityDefectCode.code).all()


@router.post("/defect-codes", response_model=QualityDefectCodeResponse)
async def create_defect_code(payload: QualityDefectCodeCreate, db: Session = Depends(get_db), _user: User = Depends(_CAN_CREATE)):
    data = payload.model_dump()
    data["code"] = _norm_code(data["code"])
    if data["category"] not in QUALITY_DEFECT_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Category must be one of: {', '.join(QUALITY_DEFECT_CATEGORIES)}.")
    if not data["name"].strip():
        raise HTTPException(status_code=422, detail="Defect name is required.")
    _dup(db, QualityDefectCode, data["code"], "Defect")
    row = QualityDefectCode(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/defect-codes/{row_id}", response_model=QualityDefectCodeResponse)
async def update_defect_code(row_id: int, payload: QualityDefectCodeUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    row = db.query(QualityDefectCode).filter(QualityDefectCode.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Defect code #{row_id} not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("category") is not None and data["category"] not in QUALITY_DEFECT_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Category must be one of: {', '.join(QUALITY_DEFECT_CATEGORIES)}.")
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


# --- disposition codes ------------------------------------------------------

@router.get("/disposition-codes", response_model=list[QualityDispositionCodeResponse])
async def list_disposition_codes(include_inactive: bool = False, db: Session = Depends(get_db)):
    ensure_disposition_codes(db)
    db.commit()
    q = db.query(QualityDispositionCode)
    if not include_inactive:
        q = q.filter(QualityDispositionCode.is_active.is_(True))
    return q.order_by(QualityDispositionCode.code).all()


@router.post("/disposition-codes", response_model=QualityDispositionCodeResponse)
async def create_disposition_code(payload: QualityDispositionCodeCreate, db: Session = Depends(get_db), _user: User = Depends(_CAN_CREATE)):
    data = payload.model_dump()
    data["code"] = _norm_code(data["code"])
    if data["disposition_type"] not in QUALITY_DISPOSITION_TYPES:
        raise HTTPException(status_code=422, detail="Disposition type must be use as is, rework, repair, return to vendor or scrap.")
    if not data["name"].strip():
        raise HTTPException(status_code=422, detail="Disposition name is required.")
    _dup(db, QualityDispositionCode, data["code"], "Disposition")
    row = QualityDispositionCode(**data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/disposition-codes/{row_id}", response_model=QualityDispositionCodeResponse)
async def update_disposition_code(row_id: int, payload: QualityDispositionCodeUpdate, db: Session = Depends(get_db), _user: User = Depends(_CAN_EDIT)):
    row = db.query(QualityDispositionCode).filter(QualityDispositionCode.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Disposition code #{row_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


# --- simple master lists (edited from Settings: Quality head / admin) ------

@router.get("/values", response_model=list[QualityMasterValueResponse])
async def list_master_values(list_key: str | None = Query(None), include_inactive: bool = False, db: Session = Depends(get_db)):
    ensure_master_lists(db)
    db.commit()
    q = db.query(QualityMasterValue)
    if list_key:
        q = q.filter(QualityMasterValue.list_key == list_key)
    if not include_inactive:
        q = q.filter(QualityMasterValue.is_active.is_(True))
    return q.order_by(QualityMasterValue.list_key, QualityMasterValue.sort_order, QualityMasterValue.label).all()


def _require_settings_editor(user: User) -> None:
    if not access.can_edit_settings(user):
        raise HTTPException(status_code=403, detail="Only a Quality head or an admin can change Quality settings and master lists.")


@router.post("/values", response_model=QualityMasterValueResponse)
async def create_master_value(payload: QualityMasterValueCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    _require_settings_editor(user)
    if payload.list_key not in QUALITY_MASTER_LISTS:
        raise HTTPException(status_code=422, detail=f"Unknown list '{payload.list_key}'.")
    value = (payload.value or "").strip().lower().replace(" ", "_")
    if not value or not payload.label.strip():
        raise HTTPException(status_code=422, detail="Value and label are required.")
    if db.query(QualityMasterValue.id).filter(QualityMasterValue.list_key == payload.list_key, QualityMasterValue.value == value).first():
        raise HTTPException(status_code=409, detail=f"'{value}' already exists in {QUALITY_MASTER_LISTS[payload.list_key]} — reactivate it instead.")
    last = db.query(func.max(QualityMasterValue.sort_order)).filter(QualityMasterValue.list_key == payload.list_key).scalar() or 0
    row = QualityMasterValue(list_key=payload.list_key, value=value, label=payload.label.strip(), sort_order=last + 10)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/values/{row_id}", response_model=QualityMasterValueResponse)
async def update_master_value(row_id: int, payload: QualityMasterValueUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    _require_settings_editor(user)
    row = db.query(QualityMasterValue).filter(QualityMasterValue.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Master value #{row_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


# --- sampling tables --------------------------------------------------------

@router.get("/sampling/code-letters", response_model=list[QualitySampleSizeCodeResponse])
async def list_code_letters(db: Session = Depends(get_db)):
    ensure_sampling_tables(db)
    db.commit()
    return db.query(QualitySampleSizeCode).order_by(QualitySampleSizeCode.inspection_level, QualitySampleSizeCode.lot_size_min).all()


@router.get("/sampling/aql-plans", response_model=list[QualityAqlPlanResponse])
async def list_aql_plans(severity: str = "normal", db: Session = Depends(get_db)):
    ensure_sampling_tables(db)
    db.commit()
    return db.query(QualityAqlPlan).filter(QualityAqlPlan.severity == severity).order_by(QualityAqlPlan.code_letter, QualityAqlPlan.aql).all()


@router.get("/sampling/calculate", response_model=QualitySamplingCalcResponse)
async def calculate_sample(lot_size: float, aql: float, level: str = "II", severity: str = "normal", db: Session = Depends(get_db)):
    if lot_size <= 0:
        raise HTTPException(status_code=422, detail="Lot size must be greater than zero.")
    try:
        r = aql_plan(db, lot_size, aql, level, severity)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    return QualitySamplingCalcResponse(**r.__dict__)


# --- lookups for Quality users who may not have Store access ----------------

@router.get("/items")
async def lookup_items(search: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    from app.modules.store.models.item import StoreItem
    q = db.query(StoreItem).filter(StoreItem.status == "active")
    if search:
        like = f"%{search}%"
        q = q.filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like))
    return [{"id": i.id, "item_code": i.item_code, "item_name": i.item_name, "uom": i.uom,
             "inspection_on_receipt": i.inspection_on_receipt, "test_certificate_required": i.test_certificate_required}
            for i in q.order_by(StoreItem.item_name).limit(min(limit, 200)).all()]


@router.get("/locations")
async def lookup_locations(db: Session = Depends(get_db)):
    from app.modules.store.models.location import StoreLocation
    return [{"id": l.id, "code": l.code, "name": l.name}
            for l in db.query(StoreLocation).filter(StoreLocation.is_active.isnot(False)).order_by(StoreLocation.name).all()]
