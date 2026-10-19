"""Permit-to-work rules (SAP WCM) shared by routes/permits.py and the work
order status machine in routes/work_orders.py:

  * a job with permit_required can't START without an ACTIVE permit
    (issued and accepted at site, inside its validity);
  * no job can COMPLETE while one of its permits is still issued / active —
    the permit must be closed with the isolation removed (or cancelled)."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.maintenance.models.permit import (
    MaintenanceWorkPermit, MAINTENANCE_PERMIT_LIVE_STATUSES, MAINTENANCE_PERMIT_TYPE_LABELS,
)
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder

PERMIT_ENTITY = "maintenance_work_permit"


def generate_permit_number(db: Session) -> str:
    from app.modules.maintenance.service import _next_yearly
    return _next_yearly(db, MaintenanceWorkPermit.permit_number, "PTW")


def permits_for(db: Session, wo_id: int) -> list[MaintenanceWorkPermit]:
    return db.query(MaintenanceWorkPermit).filter(MaintenanceWorkPermit.work_order_id == wo_id).order_by(MaintenanceWorkPermit.id).all()


def is_expired(permit: MaintenanceWorkPermit, now=None) -> bool:
    from app.modules.maintenance.service import _aware, now_utc
    return _aware(permit.valid_to) < (now or now_utc())


def active_permit(db: Session, wo_id: int) -> MaintenanceWorkPermit | None:
    for p in reversed(permits_for(db, wo_id)):
        if p.status == "active" and not is_expired(p):
            return p
    return None


def open_permits(db: Session, wo_id: int) -> list[MaintenanceWorkPermit]:
    return [p for p in permits_for(db, wo_id) if p.status in MAINTENANCE_PERMIT_LIVE_STATUSES]


def ensure_can_start(db: Session, wo: MaintenanceWorkOrder) -> None:
    if not wo.permit_required or active_permit(db, wo.id) is not None:
        return
    live = open_permits(db, wo.id)
    issued = [p for p in live if p.status == "issued"]
    expired = [p for p in live if p.status == "active" and is_expired(p)]
    if issued:
        hint = (f"Permit {issued[0].permit_number} is issued but not accepted yet — the technician accepts it at site "
                "(Permit card › Accept) once the isolation is in place.")
    elif expired:
        hint = (f"Permit {expired[0].permit_number} expired at {expired[0].valid_to:%d-%m-%Y %H:%M} — close it and issue "
                "a new one.")
    else:
        hint = "Issue the permit first (Permit card › Issue permit), then have the technician accept it."
    raise HTTPException(status_code=409, detail=f"Can't start {wo.wo_number}: it needs an active permit-to-work. {hint}")


def ensure_can_complete(db: Session, wo: MaintenanceWorkOrder) -> None:
    live = open_permits(db, wo.id)
    if live:
        names = ", ".join(f"{p.permit_number} ({MAINTENANCE_PERMIT_TYPE_LABELS.get(p.permit_type, p.permit_type)})" for p in live)
        raise HTTPException(
            status_code=409,
            detail=f"Can't complete {wo.wo_number}: permit {names} is still open. Close it — confirm the isolation is "
                   "removed and the area is handed back — before completing the job.",
        )


def permit_default(db: Session, criticality: str | None) -> bool:
    from app.modules.maintenance.settings import permit_required_default
    try:
        return permit_required_default(db, criticality)
    except Exception:  # noqa: BLE001 — settings framework unavailable: old behaviour
        return False
