from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord, HYD_MAINTENANCE_TYPES
from app.modules.hydraulic.schemas.maintenance import (
    HydMaintenancePlanCreate, HydMaintenancePlanUpdate, HydMaintenancePlanResponse,
)
from app.modules.hydraulic.service import (
    generate_plan_number, check_choice, check_user, get_system_or_404, systems_by_id, user_names,
    compute_next_due_date, plan_due_state,
)
from app.modules.main.models.user import User

router = APIRouter(
    prefix="/hydraulic/maintenance-plans", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_DUE_ORDER = {"overdue": 0, "due_soon": 1, "ok": 2, "inactive": 3}


def to_plan_responses(db: Session, plans: list[HydMaintenancePlan]) -> list[HydMaintenancePlanResponse]:
    systems = systems_by_id(db, {p.system_id for p in plans})
    names = user_names(db, {p.assigned_to_id for p in plans})
    ids = [p.id for p in plans]
    open_records = dict(db.query(HydServiceRecord.plan_id, HydServiceRecord.id).filter(
        HydServiceRecord.plan_id.in_(ids), HydServiceRecord.is_deleted == False,  # noqa: E712
        HydServiceRecord.status.in_(("open", "in_progress")),
    ).all()) if ids else {}
    out = []
    for p in plans:
        resp = HydMaintenancePlanResponse.model_validate(p)
        system = systems.get(p.system_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.system_type = system.system_type if system else None
        resp.system_running_hours = system.running_hours if system else None
        resp.assigned_to_name = names.get(p.assigned_to_id)
        state = plan_due_state(p, system.running_hours if system else None)
        resp.due_status, resp.days_to_due, resp.next_due_hours = state["due_status"], state["days_to_due"], state["next_due_hours"]
        resp.open_service_record_id = open_records.get(p.id)
        out.append(resp)
    return out


def _get_or_404(db: Session, plan_id: int) -> HydMaintenancePlan:
    plan = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.id == plan_id, HydMaintenancePlan.is_deleted == False).first()  # noqa: E712
    if not plan:
        raise HTTPException(status_code=404, detail=f"Maintenance plan #{plan_id} not found (it may have been deleted).")
    return plan


def _validate(db: Session, data: dict) -> None:
    check_choice(data.get("maintenance_type"), HYD_MAINTENANCE_TYPES, "maintenance type")
    check_user(db, data.get("assigned_to_id"), "Assigned to")
    if not data.get("frequency_days") and not data.get("frequency_hours"):
        raise HTTPException(status_code=400, detail="Set how often the task repeats — every N days, every N running hours, or both.")


@router.get("", response_model=list[HydMaintenancePlanResponse])
async def list_plans(
    system_id: int | None = None,
    system_type: str | None = None,
    maintenance_type: str | None = None,
    due_status: str | None = None,
    include_inactive: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "maintenance")),
):
    query = db.query(HydMaintenancePlan).filter(HydMaintenancePlan.is_deleted == False)  # noqa: E712
    if system_id:
        query = query.filter(HydMaintenancePlan.system_id == system_id)
    if maintenance_type:
        query = query.filter(HydMaintenancePlan.maintenance_type == maintenance_type)
    if not include_inactive:
        query = query.filter(HydMaintenancePlan.is_active == True)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(HydMaintenancePlan.plan_number.ilike(like) | HydMaintenancePlan.title.ilike(like))
    rows = to_plan_responses(db, query.all())
    if system_type:
        rows = [r for r in rows if r.system_type == system_type]
    if due_status:
        rows = [r for r in rows if r.due_status == due_status]
    # Most urgent first, then by due date.
    return sorted(rows, key=lambda r: (_DUE_ORDER.get(r.due_status, 9), r.next_due_date or datetime.max.date(), r.id))


@router.post("", response_model=HydMaintenancePlanResponse)
async def create_plan(
    payload: HydMaintenancePlanCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "maintenance", "create")),
):
    data = payload.model_dump()
    system = get_system_or_404(db, data["system_id"])
    _validate(db, data)
    if data.get("frequency_hours") and data.get("last_done_hours") is None:
        # Start counting hours from where the system is today.
        data["last_done_hours"] = system.running_hours
    plan = HydMaintenancePlan(**data, plan_number=generate_plan_number(db), created_by_id=user.id)
    plan.next_due_date = compute_next_due_date(plan)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return to_plan_responses(db, [plan])[0]


@router.get("/{plan_id}", response_model=HydMaintenancePlanResponse)
async def get_plan(plan_id: int, db: Session = Depends(get_db)):
    return to_plan_responses(db, [_get_or_404(db, plan_id)])[0]


@router.patch("/{plan_id}", response_model=HydMaintenancePlanResponse)
async def update_plan(
    plan_id: int,
    payload: HydMaintenancePlanUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "maintenance", "edit")),
):
    plan = _get_or_404(db, plan_id)
    updates = payload.model_dump(exclude_unset=True)
    merged = {"frequency_days": plan.frequency_days, "frequency_hours": plan.frequency_hours, **updates}
    _validate(db, merged)
    for field, val in updates.items():
        setattr(plan, field, val)
    plan.next_due_date = compute_next_due_date(plan)
    db.commit()
    db.refresh(plan)
    return to_plan_responses(db, [plan])[0]


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "maintenance", "delete")),
):
    plan = _get_or_404(db, plan_id)
    plan.is_deleted = True
    plan.is_active = False
    plan.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Maintenance plan {plan.plan_number} deleted"}
