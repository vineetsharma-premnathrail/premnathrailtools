from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.maintenance import (
    HydMaintenancePlan, HydServiceRecord, HydServicePart,
    HYD_SERVICE_TYPES, HYD_DOWNTIME_SERVICE_TYPES, HYD_SERVICE_REFERENCE_TYPE,
)
from app.modules.hydraulic.models.spare_part import HydSparePart
from app.modules.hydraulic.schemas.service_record import (
    HydServiceRecordCreate, HydServiceRecordUpdate, HydServiceRecordCompletePayload, HydServiceRecordCancelPayload,
    HydServicePartResponse, HydServiceRecordResponse,
)
from app.modules.hydraulic.service import (
    generate_service_number, check_choice, check_user, get_system_or_404, systems_by_id, user_names,
    mark_plan_done, spare_unit_cost,
)
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.services.stock_ledger import post_stock_transaction

router = APIRouter(
    prefix="/hydraulic/service-records", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_CAN_EDIT = require_tab_action("hydraulic", "service_records", "edit")
_OPEN = ("open", "in_progress")


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


def _get_or_404(db: Session, record_id: int, lock: bool = False) -> HydServiceRecord:
    q = db.query(HydServiceRecord).filter(HydServiceRecord.id == record_id, HydServiceRecord.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    rec = q.first()
    if not rec:
        raise HTTPException(status_code=404, detail=f"Service record #{record_id} not found (it may have been deleted).")
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


def _build_parts(db: Session, lines: list[dict]) -> list[HydServicePart]:
    ids = {line["spare_part_id"] for line in lines}
    spares = {s.id: s for s in db.query(HydSparePart).filter(HydSparePart.id.in_(ids), HydSparePart.is_deleted == False).all()} if ids else {}  # noqa: E712
    missing = ids - set(spares)
    if missing:
        raise HTTPException(status_code=404, detail=f"Spare part(s) #{', #'.join(str(i) for i in sorted(missing))} not found — they may have been deleted. Remove those lines and pick again.")
    item_ids = {s.store_item_id for s in spares.values() if s.store_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    return [
        HydServicePart(
            spare_part_id=line["spare_part_id"], quantity=line["quantity"], remarks=line.get("remarks"),
            unit_cost=spare_unit_cost(spares[line["spare_part_id"]], items.get(spares[line["spare_part_id"]].store_item_id)),
        )
        for line in lines
    ]


def _validate(db: Session, data: dict, system_id: int) -> None:
    check_choice(data.get("service_type"), HYD_SERVICE_TYPES, "service type")
    check_user(db, data.get("performed_by_id"), "Performed by")
    if data.get("plan_id"):
        plan = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.id == data["plan_id"], HydMaintenancePlan.is_deleted == False).first()  # noqa: E712
        if not plan:
            raise HTTPException(status_code=404, detail=f"Maintenance plan #{data['plan_id']} not found (it may have been deleted).")
        if plan.system_id != system_id:
            raise HTTPException(status_code=400, detail=f"Maintenance plan {plan.plan_number} is for a different system — pick a plan belonging to this system.")


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
    _tab: User = Depends(require_tab_access("hydraulic", "service_records")),
):
    query = db.query(HydServiceRecord).filter(HydServiceRecord.is_deleted == False)  # noqa: E712
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
    return _to_responses(db, query.order_by(HydServiceRecord.service_date.desc(), HydServiceRecord.id.desc()).all())


@router.post("", response_model=HydServiceRecordResponse)
async def create_service_record(
    payload: HydServiceRecordCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "service_records", "create")),
):
    data = payload.model_dump()
    system = get_system_or_404(db, data["system_id"])
    _validate(db, data, system.id)
    if data.get("plan_id"):
        already = db.query(HydServiceRecord).filter(
            HydServiceRecord.plan_id == data["plan_id"], HydServiceRecord.is_deleted == False,  # noqa: E712
            HydServiceRecord.status.in_(_OPEN),
        ).first()
        if already:
            raise HTTPException(status_code=409, detail=f"{already.record_number} is already open for this maintenance plan — complete or cancel it before raising another.")
        plan = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.id == data["plan_id"]).first()
        if not data.get("checklist") and plan.checklist:
            data["checklist"] = plan.checklist
    parts = data.pop("parts")
    rec = HydServiceRecord(**data, record_number=generate_service_number(db), status="open", created_by_id=user.id)
    rec.parts = _build_parts(db, parts)
    # A breakdown / corrective job takes the system out of service while it's open.
    if rec.service_type in HYD_DOWNTIME_SERVICE_TYPES and system.status in ("in_service", "commissioned"):
        system.status = "under_maintenance"
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _to_responses(db, [rec])[0]


@router.get("/{record_id}", response_model=HydServiceRecordResponse)
async def get_service_record(record_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, record_id)])[0]


@router.patch("/{record_id}", response_model=HydServiceRecordResponse)
async def update_service_record(
    record_id: int,
    payload: HydServiceRecordUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    rec = _get_or_404(db, record_id, lock=True)
    _require_open(rec, "edited")
    updates = payload.model_dump(exclude_unset=True)
    _validate(db, updates, rec.system_id)
    parts = updates.pop("parts", None)
    was_downtime = rec.service_type in HYD_DOWNTIME_SERVICE_TYPES
    for field, val in updates.items():
        setattr(rec, field, val)
    if parts is not None:
        rec.parts = _build_parts(db, parts)
    is_downtime = rec.service_type in HYD_DOWNTIME_SERVICE_TYPES
    if was_downtime != is_downtime:
        system = get_system_or_404(db, rec.system_id)
        if is_downtime and system.status in ("in_service", "commissioned"):
            system.status = "under_maintenance"
        elif not is_downtime:
            _release_system_if_clear(db, system, rec.id)
    db.commit()
    db.refresh(rec)
    return _to_responses(db, [rec])[0]


@router.post("/{record_id}/start", response_model=HydServiceRecordResponse)
async def start_service_record(record_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    rec = _get_or_404(db, record_id, lock=True)
    if rec.status != "open":
        raise HTTPException(status_code=409, detail=f"{rec.record_number} is {rec.status.replace('_', ' ')}, not open.")
    rec.status = "in_progress"
    rec.performed_by_id = rec.performed_by_id or user.id
    db.commit()
    db.refresh(rec)
    return _to_responses(db, [rec])[0]


@router.post("/{record_id}/complete", response_model=HydServiceRecordResponse)
async def complete_service_record(
    record_id: int,
    payload: HydServiceRecordCompletePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    rec = _get_or_404(db, record_id, lock=True)
    _require_open(rec, "completed")
    if payload.work_done:
        rec.work_done = payload.work_done
    if not (rec.work_done or "").strip():
        raise HTTPException(status_code=400, detail="Describe the work done before completing the service record.")
    done_on = payload.completed_on or date.today()
    if done_on < rec.service_date:
        raise HTTPException(status_code=400, detail=f"Completion date {done_on.strftime('%d-%m-%Y')} is before the service date {rec.service_date.strftime('%d-%m-%Y')}.")

    if payload.issue_from_location_id:
        location = db.query(StoreLocation).filter(StoreLocation.id == payload.issue_from_location_id).first()
        if not location:
            raise HTTPException(status_code=404, detail=f"Store location #{payload.issue_from_location_id} not found — pick the location again.")
        spares = {s.id: s for s in db.query(HydSparePart).filter(HydSparePart.id.in_({p.spare_part_id for p in rec.parts})).all()}
        for part in rec.parts:
            spare = spares.get(part.spare_part_id)
            if not spare or not spare.store_item_id or part.issued_location_id:
                continue
            try:
                post_stock_transaction(
                    db, item_id=spare.store_item_id, location_id=location.id, transaction_type="issue", quantity=part.quantity,
                    reference_type=HYD_SERVICE_REFERENCE_TYPE, reference_number=rec.record_number, transaction_date=done_on,
                    remarks=f"Issued for service {rec.record_number}", created_by_id=user.id,
                )
            except ValueError as e:
                db.rollback()
                raise HTTPException(status_code=409, detail=f"Can't issue {spare.part_code} ({spare.name}) from {location.name}: {e}. "
                                                            "Pick a location that has the stock, or complete without issuing from Store.")
            part.issued_location_id = location.id

    rec.status = "completed"
    rec.completed_on = done_on
    rec.completed_by_id = user.id
    rec.completed_at = datetime.now(timezone.utc)
    system = get_system_or_404(db, rec.system_id)
    if rec.running_hours is not None and rec.running_hours > (system.running_hours or 0):
        system.running_hours = rec.running_hours
    _release_system_if_clear(db, system, rec.id)
    if rec.plan_id:
        plan = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.id == rec.plan_id).first()
        if plan:
            mark_plan_done(plan, done_on, rec.running_hours if rec.running_hours is not None else system.running_hours)
    db.commit()
    db.refresh(rec)
    return _to_responses(db, [rec])[0]


@router.post("/{record_id}/cancel", response_model=HydServiceRecordResponse)
async def cancel_service_record(
    record_id: int,
    payload: HydServiceRecordCancelPayload,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    rec = _get_or_404(db, record_id, lock=True)
    _require_open(rec, "cancelled")
    rec.status = "cancelled"
    rec.cancel_reason = payload.reason.strip()
    system = get_system_or_404(db, rec.system_id)
    if rec.service_type in HYD_DOWNTIME_SERVICE_TYPES:
        _release_system_if_clear(db, system, rec.id)
    db.commit()
    db.refresh(rec)
    return _to_responses(db, [rec])[0]


@router.delete("/{record_id}")
async def delete_service_record(
    record_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "service_records", "delete")),
):
    rec = _get_or_404(db, record_id)
    if rec.status == "completed":
        raise HTTPException(status_code=409, detail=f"{rec.record_number} is completed — it's part of the system's service history and can't be deleted.")
    if any(p.issued_location_id for p in rec.parts):
        raise HTTPException(status_code=409, detail=f"Stock has already been issued from Store against {rec.record_number}; return it in Store first.")
    rec.is_deleted = True
    rec.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Service record {rec.record_number} deleted"}
