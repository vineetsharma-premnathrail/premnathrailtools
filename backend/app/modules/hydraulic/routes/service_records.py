from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic import access  # noqa: F401  (registers data scope / approval types)
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord, HYD_DOWNTIME_SERVICE_TYPES
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.schemas.service_record import (
    HydServiceRecordCancelPayload, HydServicePartResponse, HydServiceRecordResponse,
)
from app.modules.hydraulic.service import can_see_costs, get_system_or_404, systems_by_id, user_names, raise_retired
from app.modules.main.models.user import User
from app.modules.store.models.location import StoreLocation

router = APIRouter(
    prefix="/hydraulic/service-records", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

# Service records are retired (rule R5) and have no Permission Matrix tab of their own any more;
# the kept read / cancel / delete endpoints are gated on the Systems tab they belong to.
_CAN_EDIT = require_tab_action("hydraulic", "systems", "edit")
_OPEN = ("open", "in_progress")


def _shown(resps: list[HydServiceRecordResponse], user: User) -> list[HydServiceRecordResponse]:
    """Blank every amount for anyone without Hydraulic › BOM › Prices & costs."""
    if can_see_costs(user):
        return resps
    for r in resps:
        r.labour_cost = r.other_cost = r.parts_cost = r.total_cost = None
        for p in r.parts:
            p.unit_cost = p.line_cost = None
    return resps


def _to_responses(db: Session, records: list[HydServiceRecord]) -> list[HydServiceRecordResponse]:
    systems = systems_by_id(db, {r.system_id for r in records})
    plan_ids = {r.plan_id for r in records if r.plan_id}
    plans = {p.id: p for p in db.query(HydMaintenancePlan).filter(HydMaintenancePlan.id.in_(plan_ids)).all()} if plan_ids else {}
    spare_ids = {p.spare_part_id for r in records for p in r.parts}
    spares = {s.id: s for s in db.query(HydSparePart).filter(HydSparePart.id.in_(spare_ids)).all()} if spare_ids else {}
    loc_ids = {p.issued_location_id for r in records for p in r.parts if p.issued_location_id}
    locations = {loc.id: loc.name for loc in db.query(StoreLocation).filter(StoreLocation.id.in_(loc_ids)).all()} if loc_ids else {}
    names = user_names(db, {r.performed_by_id for r in records} | {r.completed_by_id for r in records})
    out = []
    for r in records:
        resp = HydServiceRecordResponse.model_validate(r)
        system, plan = systems.get(r.system_id), plans.get(r.plan_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.system_type = system.system_type if system else None
        resp.plan_number = plan.plan_number if plan else None
        resp.plan_title = plan.title if plan else None
        resp.performed_by_name = names.get(r.performed_by_id)
        resp.completed_by_name = names.get(r.completed_by_id)
        parts = []
        for p in r.parts:
            pr = HydServicePartResponse.model_validate(p)
            spare = spares.get(p.spare_part_id)
            if spare:
                pr.part_code, pr.part_name, pr.uom, pr.store_linked = spare.part_code, spare.name, spare.uom, bool(spare.store_item_id)
            pr.issued_location_name = locations.get(p.issued_location_id)
            pr.line_cost = round(p.unit_cost * p.quantity, 2)
            parts.append(pr)
        resp.parts = parts
        resp.parts_cost = round(sum(p.line_cost for p in parts), 2)
        resp.total_cost = round(resp.parts_cost + (r.labour_cost or 0) + (r.other_cost or 0), 2)
        out.append(resp)
    return out


def _get_or_404(db: Session, record_id: int, user: User, lock: bool = False) -> HydServiceRecord:
    q = db.query(HydServiceRecord).filter(HydServiceRecord.id == record_id, HydServiceRecord.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    rec = q.first()
    if not rec:
        raise HTTPException(status_code=404, detail=f"Service record #{record_id} not found (it may have been deleted).")
    ensure_in_scope(db, user, rec)
    return rec


def _require_open(rec: HydServiceRecord, action: str) -> None:
    if rec.status not in _OPEN:
        raise HTTPException(status_code=409, detail=f"{rec.record_number} is {rec.status} — only an open or in-progress service record can be {action}.")


def _release_system_if_clear(db: Session, system, excluding_record_id: int) -> None:
    """Puts an under-maintenance system back in service once no other open
    breakdown / corrective / overhaul job is holding it down."""
    if system.status != "under_maintenance":
        return
    still_down = db.query(HydServiceRecord).filter(
        HydServiceRecord.system_id == system.id, HydServiceRecord.id != excluding_record_id,
        HydServiceRecord.is_deleted == False,  # noqa: E712
        HydServiceRecord.status.in_(_OPEN), HydServiceRecord.service_type.in_(HYD_DOWNTIME_SERVICE_TYPES),
    ).first()
    if not still_down:
        system.status = "in_service"


@router.get("", response_model=list[HydServiceRecordResponse])
async def list_service_records(
    system_id: int | None = None,
    plan_id: int | None = None,
    service_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    query = apply_scope(db.query(HydServiceRecord).filter(HydServiceRecord.is_deleted == False), _tab, HydServiceRecord)  # noqa: E712
    if system_id:
        query = query.filter(HydServiceRecord.system_id == system_id)
    if plan_id:
        query = query.filter(HydServiceRecord.plan_id == plan_id)
    if service_type:
        query = query.filter(HydServiceRecord.service_type == service_type)
    if status_filter:
        query = query.filter(HydServiceRecord.status == status_filter)
    if date_from:
        query = query.filter(HydServiceRecord.service_date >= date_from)
    if date_to:
        query = query.filter(HydServiceRecord.service_date <= date_to)
    if search:
        like = f"%{search}%"
        query = query.filter(
            HydServiceRecord.record_number.ilike(like) | HydServiceRecord.reported_problem.ilike(like)
            | HydServiceRecord.work_done.ilike(like) | HydServiceRecord.external_agency.ilike(like)
        )
    return _shown(_to_responses(db, query.order_by(HydServiceRecord.service_date.desc(), HydServiceRecord.id.desc()).all()), _tab)


@router.post("", status_code=410)
async def create_service_record():
    """Retired (plan rule R5): service records are read-only. Use Service & Commissioning instead."""
    raise_retired("service records")


@router.get("/{record_id}", response_model=HydServiceRecordResponse)
async def get_service_record(
    record_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("hydraulic", "systems")),
):
    return _shown(_to_responses(db, [_get_or_404(db, record_id, user)]), user)[0]


@router.patch("/{record_id}", status_code=410)
async def update_service_record(record_id: int):
    """Retired (plan rule R5): service records are read-only. Use Service & Commissioning instead."""
    raise_retired("service records")


@router.post("/{record_id}/start", status_code=410)
async def start_service_record(record_id: int):
    """Retired (plan rule R5): service records are read-only. Use Service & Commissioning instead."""
    raise_retired("service records")


@router.post("/{record_id}/complete", status_code=410)
async def complete_service_record(record_id: int):
    """Retired (plan rule R5). Completion used to issue spares from Store
    stock outside the Store material-issue flow and bump system running
    hours. Neither may happen from this module any more."""
    raise_retired("service records")


@router.post("/{record_id}/cancel", response_model=HydServiceRecordResponse)
async def cancel_service_record(
    record_id: int,
    payload: HydServiceRecordCancelPayload,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    rec = _get_or_404(db, record_id, _perm, lock=True)
    _require_open(rec, "cancelled")
    rec.status = "cancelled"
    rec.cancel_reason = payload.reason.strip()
    system = get_system_or_404(db, rec.system_id)
    if rec.service_type in HYD_DOWNTIME_SERVICE_TYPES:
        _release_system_if_clear(db, system, rec.id)
    db.commit()
    db.refresh(rec)
    return _shown(_to_responses(db, [rec]), _perm)[0]


@router.delete("/{record_id}")
async def delete_service_record(
    record_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "systems", "delete")),
):
    # Retired (plan rule R5, HY-0): records are read-only history kept for the export.
    # Close an open legacy job with Cancel instead. The body below is unreachable until HY-4 removes it.
    raise_retired("service records")
    rec = _get_or_404(db, record_id, _perm)
    if rec.status == "completed":
        raise HTTPException(status_code=409, detail=f"{rec.record_number} is completed — it's part of the system's service history and can't be deleted.")
    if any(p.issued_location_id for p in rec.parts):
        raise HTTPException(status_code=409, detail=f"Stock has already been issued from Store against {rec.record_number}; return it in Store first.")
    if rec.status in _OPEN and rec.service_type in HYD_DOWNTIME_SERVICE_TYPES:
        # The open job was what held the system down; put it back in service if nothing else does.
        system = systems_by_id(db, {rec.system_id}).get(rec.system_id)
        if system:
            _release_system_if_clear(db, system, rec.id)
    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Service record {rec.record_number} deleted"}
