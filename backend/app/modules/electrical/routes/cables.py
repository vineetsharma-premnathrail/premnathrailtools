from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature
from app.core.permissions import require_app_access, require_feature_action
from app.db.session import get_db
from app.modules.electrical.models.cable import ElectricalCable, ELECTRICAL_CABLE_STATUSES
from app.modules.electrical.schemas.cable import (
    ElectricalCableCreate, ElectricalCableUpdate, ElectricalCableBulkStatusPayload, ElectricalCableResponse,
)
from app.modules.electrical.service import ELECTRICAL_APP, ensure_job_view, get_job_or_404, require_working
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/electrical/jobs/{job_id}/cables", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)
# Any Electrical user — record-level access is the job's data scope.
_VIEWER = require_app_access(ELECTRICAL_APP)

# Electrical › RRV Electrical Jobs › Cables (app/core/features/electrical.py).
_CAN_CREATE = require_feature_action("electrical", "jobs", "cables", "create")
_CAN_EDIT = require_feature_action("electrical", "jobs", "cables", "edit")
_CAN_DELETE = require_feature_action("electrical", "jobs", "cables", "delete")


def _get_cable(db: Session, job_id: int, cable_id: int) -> ElectricalCable:
    cable = db.query(ElectricalCable).filter(
        ElectricalCable.id == cable_id, ElectricalCable.job_id == job_id, ElectricalCable.is_deleted == False  # noqa: E712
    ).first()
    if not cable:
        raise HTTPException(status_code=404, detail=f"Cable #{cable_id} not found on this job (it may have been deleted).")
    return cable


def _check_status(status: str | None) -> None:
    if status and status not in ELECTRICAL_CABLE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid cable status '{status}'. Use one of: {', '.join(ELECTRICAL_CABLE_STATUSES)}.")


def _validate(db: Session, job_id: int, data: dict, current_id: int | None = None) -> None:
    _check_status(data.get("status"))
    if data.get("cable_tag"):
        data["cable_tag"] = data["cable_tag"].strip().upper()
        clash = db.query(ElectricalCable).filter(
            ElectricalCable.job_id == job_id, func.upper(ElectricalCable.cable_tag) == data["cable_tag"],
            ElectricalCable.is_deleted == False,  # noqa: E712
        )
        if current_id:
            clash = clash.filter(ElectricalCable.id != current_id)
        if clash.first():
            raise HTTPException(status_code=409, detail=f"Cable tag '{data['cable_tag']}' is already in this job's cable schedule. Use a different tag.")


@router.get("", response_model=list[ElectricalCableResponse])
async def list_cables(job_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    ensure_job_view(user, can_feature(user, "electrical", "jobs", "cables", "view"), "cables")
    get_job_or_404(db, job_id, user=user)
    return db.query(ElectricalCable).filter(
        ElectricalCable.job_id == job_id, ElectricalCable.is_deleted == False  # noqa: E712
    ).order_by(ElectricalCable.cable_tag).all()


@router.post("", response_model=ElectricalCableResponse)
async def create_cable(job_id: int, payload: ElectricalCableCreate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_CREATE)):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its cable schedule")
    data = payload.model_dump()
    _validate(db, job_id, data)
    cable = ElectricalCable(**data, job_id=job_id)
    db.add(cable)
    db.commit()
    db.refresh(cable)
    return cable


@router.post("/bulk-status", response_model=list[ElectricalCableResponse])
async def bulk_update_status(job_id: int, payload: ElectricalCableBulkStatusPayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    """Moves several cables to one installation status at once — how the
    floor records a harness going in."""
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its cable schedule")
    _check_status(payload.status)
    cables = db.query(ElectricalCable).filter(
        ElectricalCable.job_id == job_id, ElectricalCable.id.in_(payload.cable_ids), ElectricalCable.is_deleted == False  # noqa: E712
    ).all()
    missing = set(payload.cable_ids) - {c.id for c in cables}
    if missing:
        raise HTTPException(status_code=404, detail=f"{len(missing)} of the selected cables aren't on this job any more. Refresh the page and select again.")
    for c in cables:
        c.status = payload.status
    db.commit()
    return db.query(ElectricalCable).filter(
        ElectricalCable.job_id == job_id, ElectricalCable.is_deleted == False  # noqa: E712
    ).order_by(ElectricalCable.cable_tag).all()


@router.patch("/{cable_id}", response_model=ElectricalCableResponse)
async def update_cable(job_id: int, cable_id: int, payload: ElectricalCableUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its cable schedule")
    cable = _get_cable(db, job_id, cable_id)
    updates = payload.model_dump(exclude_unset=True)
    _validate(db, job_id, updates, current_id=cable.id)
    for field, val in updates.items():
        setattr(cable, field, val)
    db.commit()
    db.refresh(cable)
    return cable


@router.delete("/{cable_id}")
async def delete_cable(job_id: int, cable_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_DELETE)):
    job = get_job_or_404(db, job_id, lock=True, user=_perm)
    require_working(job, "change its cable schedule")
    cable = _get_cable(db, job_id, cable_id)
    cable.is_deleted = True
    cable.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Cable {cable.cable_tag} deleted"}
