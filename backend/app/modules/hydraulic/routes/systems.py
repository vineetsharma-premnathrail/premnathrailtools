from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.design.order_project_links import clean_op_link, fill_op_labels
from app.modules.hydraulic import access  # noqa: F401  (registers data scope / approval types)
from app.modules.hydraulic.models.bom import HydBom
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.maintenance import HydMaintenancePlan, HydServiceRecord
from app.modules.hydraulic.models.system import HydSystem, HYD_SYSTEM_STATUSES
from app.modules.hydraulic.models.testing import HydTest
from app.modules.hydraulic.schemas.system import HydSystemCreate, HydSystemUpdate, HydSystemResponse
from app.modules.hydraulic.service import (
    generate_system_number, check_choice, check_system_type, check_user, ensure_assignee_rule, get_system_or_404, user_names,
    plan_due_state,
)

OWNER_RULE = "hydraulic:systems.owner"  # "Assign to" rule (core/features/hydraulic.py)
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production.service import project_label

router = APIRouter(
    prefix="/hydraulic/systems", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_OPEN_SERVICE = ("open", "in_progress")

# Retired under plan rule R5 (HY-0): hidden in the UI, rejected by the API, dropped in HY-4.
_RETIRED_SYSTEM_FIELDS = {"running_hours": "running hours", "commissioned_on": "commissioned on", "location": "location"}


def _reject_retired_fields(data: dict) -> None:
    """Empty values (None / "" / 0) are tolerated so old clients that send defaults still work."""
    sent = [label for field, label in _RETIRED_SYSTEM_FIELDS.items() if data.get(field) not in (None, "", 0)]
    if sent:
        raise HTTPException(
            status_code=422,
            detail=(f"Running hours and plant location are no longer tracked (rule R5: no monitoring of RRV systems) — "
                    f"remove {', '.join(sent)} from the request. Plant equipment maintenance now lives in the Maintenance "
                    "module; service history for a customer's RRV is in Service & Commissioning."),
        )


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
    fill_op_labels(db, systems, out)
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
    order_project_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    query = apply_scope(db.query(HydSystem).filter(HydSystem.is_deleted == False), _tab, HydSystem)  # noqa: E712
    if system_type:
        query = query.filter(HydSystem.system_type == system_type)
    if status_filter:
        query = query.filter(HydSystem.status == status_filter)
    if erp_project_id:
        query = query.filter(HydSystem.erp_project_id == erp_project_id)
    if order_project_id:
        query = query.filter(HydSystem.order_project_id == order_project_id)
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
    _reject_retired_fields(data)
    _validate(db, data)
    clean_op_link(db, data)
    ensure_assignee_rule(db, user, OWNER_RULE, data.get("owner_id"))
    system = HydSystem(**data, system_number=generate_system_number(db, data["system_type"]), created_by_id=user.id)
    db.add(system)
    db.commit()
    db.refresh(system)
    return _to_responses(db, [system])[0]


@router.get("/{system_id}", response_model=HydSystemResponse)
async def get_system(
    system_id: int, db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "systems")),
):
    system = get_system_or_404(db, system_id)
    ensure_in_scope(db, _tab, system)
    return _to_responses(db, [system])[0]


@router.patch("/{system_id}", response_model=HydSystemResponse)
async def update_system(
    system_id: int,
    payload: HydSystemUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "systems", "edit")),
):
    system = get_system_or_404(db, system_id)
    ensure_in_scope(db, _perm, system)
    updates = payload.model_dump(exclude_unset=True)
    _reject_retired_fields(updates)
    for field in _RETIRED_SYSTEM_FIELDS:  # empty values are ignored, never written — the columns are read-only now
        updates.pop(field, None)
    merged = {c: getattr(system, c) for c in ("working_pressure_bar", "max_pressure_bar", "operating_temp_min_c", "operating_temp_max_c")}
    merged.update(updates)
    _validate(db, merged)
    clean_op_link(db, updates, current_project_id=system.order_project_id, current_element_id=system.order_project_element_id)
    ensure_assignee_rule(db, _perm, OWNER_RULE, updates.get("owner_id"), system.owner_id)
    for field, val in updates.items():
        setattr(system, field, val)
    db.commit()
    db.refresh(system)
    return _to_responses(db, [system])[0]


@router.delete("/{system_id}")
async def delete_system(
    system_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "systems", "delete")),
):
    system = get_system_or_404(db, system_id)
    ensure_in_scope(db, user, system)
    ensure_can_delete(user, system, "hydraulic", "systems", what="hydraulic system")
    open_services = db.query(HydServiceRecord).filter(
        HydServiceRecord.system_id == system.id, HydServiceRecord.is_deleted == False,  # noqa: E712
        HydServiceRecord.status.in_(_OPEN_SERVICE),
    ).count()
    if open_services:
        raise HTTPException(
            status_code=409,
            detail=f"{system.system_number} has {open_services} open service record(s). They're listed on the system page "
                   "— open each one and Cancel it (hydraulic service records are retired and can no longer be completed), "
                   "or set the system to 'Decommissioned' instead of deleting it.",
        )
    # Soft delete — circuits, tests and service history keep pointing at it.
    system.is_deleted = True
    system.deleted_at = datetime.now(timezone.utc)
    db.query(HydMaintenancePlan).filter(HydMaintenancePlan.system_id == system.id).update({"is_active": False})
    db.commit()
    return {"message": f"System {system.system_number} deleted"}
