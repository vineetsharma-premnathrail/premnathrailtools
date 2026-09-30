from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.production.models.workstation import (
    ProductionWorkstation, PRODUCTION_WORKSTATION_TYPES, PRODUCTION_WORKSTATION_STATUSES,
)
from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation
from app.modules.production.schemas.workstation import (
    ProductionWorkstationCreate, ProductionWorkstationUpdate, ProductionWorkstationResponse,
)

router = APIRouter(
    prefix="/production/workstations", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_OPEN_WO_STATUSES = ("released", "in_progress")


def _open_operation_counts(db: Session, workstation_ids: list[int]) -> dict[int, int]:
    if not workstation_ids:
        return {}
    rows = db.query(ProductionWorkOrderOperation.workstation_id, func.count(ProductionWorkOrderOperation.id)).join(
        ProductionWorkOrder, ProductionWorkOrder.id == ProductionWorkOrderOperation.work_order_id
    ).filter(
        ProductionWorkOrderOperation.workstation_id.in_(workstation_ids),
        ProductionWorkOrderOperation.status != "completed",
        ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ProductionWorkOrder.status.in_(_OPEN_WO_STATUSES),
    ).group_by(ProductionWorkOrderOperation.workstation_id).all()
    return {ws_id: count for ws_id, count in rows}


def _to_responses(db: Session, workstations: list[ProductionWorkstation]) -> list[ProductionWorkstationResponse]:
    branch_ids = {w.branch_id for w in workstations if w.branch_id}
    dept_ids = {w.department_id for w in workstations if w.department_id}
    branches = {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_(branch_ids)).all()} if branch_ids else {}
    depts = {d.id: d.name for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()} if dept_ids else {}
    open_ops = _open_operation_counts(db, [w.id for w in workstations])
    out = []
    for w in workstations:
        resp = ProductionWorkstationResponse.model_validate(w)
        resp.branch_name = branches.get(w.branch_id)
        resp.department_name = depts.get(w.department_id)
        resp.open_operations = open_ops.get(w.id, 0)
        out.append(resp)
    return out


def _get_or_404(db: Session, workstation_id: int) -> ProductionWorkstation:
    ws = db.query(ProductionWorkstation).filter(
        ProductionWorkstation.is_deleted == False, ProductionWorkstation.id == workstation_id  # noqa: E712
    ).first()
    if not ws:
        raise HTTPException(status_code=404, detail=f"Workstation #{workstation_id} not found")
    return ws


def _validate(db: Session, data: dict, current_id: int | None = None) -> None:
    if data.get("workstation_type") and data["workstation_type"] not in PRODUCTION_WORKSTATION_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid workstation type '{data['workstation_type']}'. Use one of: {', '.join(PRODUCTION_WORKSTATION_TYPES)}.")
    if data.get("status") and data["status"] not in PRODUCTION_WORKSTATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{data['status']}'. Use one of: {', '.join(PRODUCTION_WORKSTATION_STATUSES)}.")
    if data.get("code"):
        data["code"] = data["code"].strip().upper()
        clash = db.query(ProductionWorkstation).filter(
            func.upper(ProductionWorkstation.code) == data["code"],
            ProductionWorkstation.is_deleted == False,  # noqa: E712
        )
        if current_id:
            clash = clash.filter(ProductionWorkstation.id != current_id)
        if clash.first():
            raise HTTPException(status_code=409, detail=f"Workstation code '{data['code']}' is already used by another workstation. Pick a different code.")
    if data.get("branch_id") and not db.query(Branch).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found")
    if data.get("department_id") and not db.query(Department).filter(Department.id == data["department_id"]).first():
        raise HTTPException(status_code=404, detail=f"Department #{data['department_id']} not found")


@router.get("", response_model=list[ProductionWorkstationResponse])
async def list_workstations(
    status_filter: str | None = Query(None, alias="status"),
    workstation_type: str | None = None,
    branch_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "workstations")),
):
    query = db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(ProductionWorkstation.status == status_filter)
    if workstation_type:
        query = query.filter(ProductionWorkstation.workstation_type == workstation_type)
    if branch_id:
        query = query.filter(ProductionWorkstation.branch_id == branch_id)
    if search:
        like = f"%{search}%"
        query = query.filter((ProductionWorkstation.code.ilike(like)) | (ProductionWorkstation.name.ilike(like)))
    return _to_responses(db, query.order_by(ProductionWorkstation.code).all())


@router.post("", response_model=ProductionWorkstationResponse)
async def create_workstation(
    payload: ProductionWorkstationCreate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("production", "workstations", "create")),
):
    data = payload.model_dump()
    _validate(db, data)
    ws = ProductionWorkstation(**data)
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return _to_responses(db, [ws])[0]


@router.get("/{workstation_id}", response_model=ProductionWorkstationResponse)
async def get_workstation(workstation_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, workstation_id)])[0]


@router.patch("/{workstation_id}", response_model=ProductionWorkstationResponse)
async def update_workstation(
    workstation_id: int,
    payload: ProductionWorkstationUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("production", "workstations", "edit")),
):
    ws = _get_or_404(db, workstation_id)
    updates = payload.model_dump(exclude_unset=True)
    _validate(db, updates, current_id=ws.id)
    for field, val in updates.items():
        setattr(ws, field, val)
    db.commit()
    db.refresh(ws)
    return _to_responses(db, [ws])[0]


@router.delete("/{workstation_id}")
async def delete_workstation(
    workstation_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("production", "workstations", "delete")),
):
    ws = _get_or_404(db, workstation_id)
    open_ops = _open_operation_counts(db, [ws.id]).get(ws.id, 0)
    if open_ops:
        raise HTTPException(
            status_code=409,
            detail=f"Workstation {ws.code} still has {open_ops} open operation(s) on released or in-progress work orders. "
                   "Finish or move those operations first, or set the workstation to 'inactive' instead of deleting it.",
        )
    # Soft delete — completed work orders and time logs still reference it.
    ws.is_deleted = True
    ws.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Workstation {ws.code} deleted"}
