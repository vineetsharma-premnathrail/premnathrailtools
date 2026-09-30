from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.system import HydSystem, HYD_SYSTEM_STATUSES
from app.modules.hydraulic.models.testing import HydTest
from app.modules.hydraulic.schemas.system import HydSystemCreate, HydSystemUpdate, HydSystemResponse
from app.modules.hydraulic.service import (
    generate_system_number, check_choice, check_system_type, check_user, get_system_or_404, user_names, plan_due_state,
)
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production.service import project_label

router = APIRouter(
    prefix="/hydraulic/systems", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_OPEN_SERVICE = ("open", "in_progress")


def _count_by_system(db: Session, model, system_ids: list[int], *filters) -> dict[int, int]:
    if not system_ids:
        return {}
    q = db.query(model.system_id, func.count(model.id)).filter(model.system_id.in_(system_ids), model.is_deleted == False, *filters)  # noqa: E712
    return dict(q.group_by(model.system_id).all())


def _to_responses(db: Session, systems: list[HydSystem]) -> list[HydSystemResponse]:
    ids = [s.id for s in systems]
    project_ids = {s.erp_project_id for s in systems if s.erp_project_id}
    branch_ids = {s.branch_id for s in systems if s.branch_id}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids)).all()} if project_ids else {}
    branches = {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_(branch_ids)).all()} if branch_ids else {}
    names = user_names(db, {s.owner_id for s in systems} | {s.created_by_id for s in systems})
    circuits = _count_by_system(db, HydCircuit, ids, HydCircuit.status != "superseded")
    boms = _count_by_system(db, HydBom, ids, HydBom.status != "obsolete")
    tests = _count_by_system(db, HydTest, ids)
    open_services = _count_by_system(db, HydServiceRecord, ids, HydServiceRecord.status.in_(_OPEN_SERVICE))
    overdue: dict[int, int] = {}
    if ids:
        by_id = {s.id: s for s in systems}
        for plan in db.query(HydMaintenancePlan).filter(
            HydMaintenancePlan.system_id.in_(ids), HydMaintenancePlan.is_deleted == False, HydMaintenancePlan.is_active == True,  # noqa: E712
        ).all():
            if plan_due_state(plan, by_id[plan.system_id].running_hours)["due_status"] == "overdue":
                overdue[plan.system_id] = overdue.get(plan.system_id, 0) + 1
    out = []
    for s in systems:
        resp = HydSystemResponse.model_validate(s)
        resp.project_label = project_label(projects.get(s.erp_project_id))
        resp.branch_name = branches.get(s.branch_id)
        resp.owner_name = names.get(s.owner_id)
        resp.created_by_name = names.get(s.created_by_id)
        resp.circuit_count = circuits.get(s.id, 0)
        resp.bom_count = boms.get(s.id, 0)
        resp.test_count = tests.get(s.id, 0)
        resp.open_service_count = open_services.get(s.id, 0)
        resp.overdue_plan_count = overdue.get(s.id, 0)
        out.append(resp)
    return out


def _validate(db: Session, data: dict) -> None:
    check_system_type(data.get("system_type"))
    check_choice(data.get("status"), HYD_SYSTEM_STATUSES, "status")
    if data.get("erp_project_id") and not db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Project #{data['erp_project_id']} not found (it may have been deleted) — pick the project again.")
    if data.get("branch_id") and not db.query(Branch).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found — pick the plant again.")
    check_user(db, data.get("owner_id"), "System owner")
    wp, mp = data.get("working_pressure_bar"), data.get("max_pressure_bar")
    if wp is not None and mp is not None and wp > mp:
        raise HTTPException(status_code=400, detail=f"Working pressure ({wp:g} bar) can't be higher than the maximum pressure ({mp:g} bar). Check both values.")
    tmin, tmax = data.get("operating_temp_min_c"), data.get("operating_temp_max_c")
    if tmin is not None and tmax is not None and tmin > tmax:
        raise HTTPException(status_code=400, detail="Minimum operating temperature is higher than the maximum — swap or correct them.")


@router.get("", response_model=list[HydSystemResponse])
async def list_systems(
    system_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    erp_project_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    query = db.query(HydSystem).filter(HydSystem.is_deleted == False)  # noqa: E712
    if system_type:
        query = query.filter(HydSystem.system_type == system_type)
    if status_filter:
        query = query.filter(HydSystem.status == status_filter)
    if erp_project_id:
        query = query.filter(HydSystem.erp_project_id == erp_project_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            HydSystem.system_number.ilike(like) | HydSystem.name.ilike(like)
            | HydSystem.application.ilike(like) | HydSystem.equipment_ref.ilike(like)
        )
    return _to_responses(db, query.order_by(HydSystem.id.desc()).all())


@router.post("", response_model=HydSystemResponse)
async def create_system(
    payload: HydSystemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "systems", "create")),
):
    data = payload.model_dump()
    _validate(db, data)
    system = HydSystem(**data, system_number=generate_system_number(db, data["system_type"]), created_by_id=user.id)
    db.add(system)
    db.commit()
    db.refresh(system)
    return _to_responses(db, [system])[0]


@router.get("/{system_id}", response_model=HydSystemResponse)
async def get_system(system_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [get_system_or_404(db, system_id)])[0]


@router.patch("/{system_id}", response_model=HydSystemResponse)
async def update_system(
    system_id: int,
    payload: HydSystemUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "systems", "edit")),
):
    system = get_system_or_404(db, system_id)
    updates = payload.model_dump(exclude_unset=True)
    merged = {c: getattr(system, c) for c in ("working_pressure_bar", "max_pressure_bar", "operating_temp_min_c", "operating_temp_max_c")}
    merged.update(updates)
    _validate(db, merged)
    for field, val in updates.items():
        setattr(system, field, val)
    db.commit()
    db.refresh(system)
    return _to_responses(db, [system])[0]


@router.delete("/{system_id}")
async def delete_system(
    system_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "systems", "delete")),
):
    system = get_system_or_404(db, system_id)
    open_services = db.query(HydServiceRecord).filter(
        HydServiceRecord.system_id == system.id, HydServiceRecord.is_deleted == False,  # noqa: E712
        HydServiceRecord.status.in_(_OPEN_SERVICE),
    ).count()
    if open_services:
        raise HTTPException(
            status_code=409,
            detail=f"{system.system_number} has {open_services} open service record(s). Complete or cancel them first, "
                   "or set the system to 'Decommissioned' instead of deleting it.",
        )
    # Soft delete — circuits, tests and service history keep pointing at it.
    system.is_deleted = True
    system.deleted_at = datetime.now(timezone.utc)
    db.query(HydMaintenancePlan).filter(HydMaintenancePlan.system_id == system.id).update({"is_active": False})
    db.commit()
    return {"message": f"System {system.system_number} deleted"}
