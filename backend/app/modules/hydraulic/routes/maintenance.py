from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.hydraulic import access  # noqa: F401  (registers data scope / approval types)
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.schemas.maintenance import HydMaintenancePlanResponse
from app.modules.hydraulic.service import systems_by_id, user_names, plan_due_state, raise_retired
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


@router.get("", response_model=list[HydMaintenancePlanResponse])
async def list_plans(
    system_id: int | None = None,
    system_type: str | None = None,
    maintenance_type: str | None = None,
    due_status: str | None = None,
    include_inactive: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    query = apply_scope(db.query(HydMaintenancePlan).filter(HydMaintenancePlan.is_deleted == False), _tab, HydMaintenancePlan)  # noqa: E712
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


@router.post("", status_code=410)
async def create_plan():
    """Retired (plan rule R5) — maintenance plans are no longer raised here."""
    raise_retired("maintenance plans")


@router.get("/{plan_id}", response_model=HydMaintenancePlanResponse)
async def get_plan(
    plan_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("hydraulic", "systems")),
):
    plan = _get_or_404(db, plan_id)
    ensure_in_scope(db, user, plan)
    return to_plan_responses(db, [plan])[0]


@router.patch("/{plan_id}", status_code=410)
async def update_plan(plan_id: int):
    """Retired (plan rule R5) — existing plans are read-only."""
    raise_retired("maintenance plans")


@router.delete("/{plan_id}", status_code=410)
async def delete_plan(plan_id: int):
    """Retired (plan rule R5) — existing plans are read-only history, kept for the export."""
    raise_retired("maintenance plans")
