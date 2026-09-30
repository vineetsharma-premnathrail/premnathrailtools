from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderMaterial, ProductionWorkOrderOperation, ProductionTimeLog,
    PRODUCTION_WORK_ORDER_PRIORITIES, PRODUCTION_WORK_ORDER_STATUSES, WORK_ORDER_REFERENCE_TYPE,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.reports.job_card_pdf import build_job_card_pdf
from app.modules.production.schemas.work_order import (
    ProductionWorkOrderCreate, ProductionWorkOrderUpdate, ProductionWorkOrderResponse,
    ProductionWorkOrderIssuePayload, ProductionWorkOrderReceivePayload, ProductionWorkOrderCancelPayload,
    ProductionOperationCompletePayload, ProductionStockMovementResponse, ProductionWorkOrderCostingResponse,
)
from app.modules.production.service import (
    generate_work_order_number, explode_bom, available_qty, outstanding_qty, work_order_costing,
    mark_started, project_label, reserve_materials, consume_reservation, release_reservations, reserved_by_line,
    check_rrv_link, rrv_log,
)
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.service import generate_inspection_number
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.utils.notifications import notify_user, broadcast_notification

router = APIRouter(
    prefix="/production/work-orders", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)

_EDITABLE_STATUSES = ("draft", "released", "in_progress")

# Permission Matrix actions (opt-in per user — see can_perform).
_CAN_CREATE = require_tab_action("production", "work_orders", "create")
_CAN_EDIT = require_tab_action("production", "work_orders", "edit")
_CAN_DELETE = require_tab_action("production", "work_orders", "delete")
_CAN_APPROVE = require_tab_action("production", "work_orders", "approve")
_CAN_RUN_FLOOR = require_tab_action("production", "shop_floor", "edit")
_EXECUTING_STATUSES = ("released", "in_progress")
_PASSED_INSPECTION = ("passed", "conditionally_passed")
_OPEN_INSPECTION = ("pending", "in_progress")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _names(db: Session, model, ids: set, label) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {row.id: label(row) for row in db.query(model).filter(model.id.in_(ids)).all()}


def _to_responses(db: Session, orders: list[ProductionWorkOrder], detail: bool = False) -> list[ProductionWorkOrderResponse]:
    today = date.today()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(
        {o.product_item_id for o in orders} | ({m.item_id for o in orders for m in o.materials} if detail else set())
    )).all()} if orders else {}
    boms = {b.id: b for b in db.query(ProductionBom).filter(ProductionBom.id.in_({o.bom_id for o in orders})).all()} if orders else {}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({o.erp_project_id for o in orders if o.erp_project_id})).all()}
    users = _names(db, User, {o.supervisor_id for o in orders} | {o.created_by_id for o in orders}, lambda u: u.name or u.email)
    branches = _names(db, Branch, {o.branch_id for o in orders}, lambda b: b.name)
    locations = _names(db, StoreLocation, {o.source_location_id for o in orders} | {o.target_location_id for o in orders}, lambda loc: f"{loc.code} — {loc.name}")
    builds = _names(db, ProductionRrvBuild, {o.rrv_build_id for o in orders}, lambda b: b.build_number)

    out = []
    for wo in orders:
        resp = ProductionWorkOrderResponse.model_validate(wo)
        product = items.get(wo.product_item_id)
        if product:
            resp.product_code, resp.product_name, resp.product_uom = product.item_code, product.item_name, product.uom
        bom = boms.get(wo.bom_id)
        if bom:
            resp.bom_number, resp.bom_version = bom.bom_number, bom.version
        resp.project_label = project_label(projects.get(wo.erp_project_id))
        resp.rrv_build_number = builds.get(wo.rrv_build_id)
        resp.branch_name = branches.get(wo.branch_id)
        resp.source_location_name = locations.get(wo.source_location_id)
        resp.target_location_name = locations.get(wo.target_location_id)
        resp.supervisor_name = users.get(wo.supervisor_id)
        resp.created_by_name = users.get(wo.created_by_id)
        resp.progress_percent = round(min(wo.quantity_completed / wo.quantity_planned * 100, 100), 1) if wo.quantity_planned else 0.0
        resp.is_overdue = bool(wo.planned_end_date and wo.planned_end_date < today and wo.status in ("draft", *_EXECUTING_STATUSES))

        if detail:
            avail = available_qty(db, [m.item_id for m in wo.materials], wo.source_location_id) if wo.source_location_id else {}
            held = reserved_by_line(db, wo.materials)
            for line in resp.materials:
                item = items.get(line.item_id)
                if item:
                    line.item_code, line.item_name, line.uom = item.item_code, item.item_name, item.uom
                source = next(m for m in wo.materials if m.id == line.id)
                line.outstanding_qty = outstanding_qty(source)
                line.available_qty = round(max(avail.get(line.item_id, 0.0), 0.0), 4)
                line.reserved_qty = round(held.get(line.id, 0.0), 4)
            resp.shortage_count = sum(1 for m in resp.materials if m.outstanding_qty > m.reserved_qty + m.available_qty + 1e-9)

            ws_names = _names(db, ProductionWorkstation, {op.workstation_id for op in wo.operations}, lambda w: f"{w.code} — {w.name}")
            inspections = {i.id: i for i in db.query(QualityInspection).filter(
                QualityInspection.id.in_({op.quality_inspection_id for op in wo.operations if op.quality_inspection_id}),
                QualityInspection.is_deleted == False,  # noqa: E712
            ).all()}
            hours: dict[int, float] = {}
            for log in db.query(ProductionTimeLog).filter(ProductionTimeLog.work_order_id == wo.id).all():
                hours[log.operation_id] = hours.get(log.operation_id, 0.0) + log.hours
            for op in resp.operations:
                op.workstation_name = ws_names.get(op.workstation_id)
                op.actual_hours = round(hours.get(op.id, 0.0), 2)
                insp = inspections.get(op.quality_inspection_id)
                if insp:
                    op.inspection_number, op.inspection_status = insp.inspection_number, insp.status
        else:
            resp.materials, resp.operations = [], []
        out.append(resp)
    return out


def _to_response(db: Session, wo: ProductionWorkOrder) -> ProductionWorkOrderResponse:
    return _to_responses(db, [wo], detail=True)[0]


def _get_or_404(db: Session, wo_id: int, lock: bool = False) -> ProductionWorkOrder:
    """`lock=True` for anything that changes the order: holds the row until
    commit so two people issuing, receiving or booking against the same work
    order at once are serialized instead of both reading the old totals."""
    query = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.id == wo_id  # noqa: E712
    )
    wo = (query.with_for_update() if lock else query).first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Work order #{wo_id} not found")
    return wo


def _get_operation(wo: ProductionWorkOrder, op_id: int) -> ProductionWorkOrderOperation:
    op = next((o for o in wo.operations if o.id == op_id), None)
    if not op:
        raise HTTPException(status_code=404, detail=f"Operation #{op_id} is not part of work order {wo.wo_number}")
    return op


def _require_status(wo: ProductionWorkOrder, allowed: tuple[str, ...], action: str) -> None:
    if wo.status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Work order {wo.wo_number} is {wo.status.replace('_', ' ')}, so you can't {action}. "
                   f"This is only allowed while it is {' or '.join(s.replace('_', ' ') for s in allowed)}.",
        )


def _validate_refs(db: Session, data: dict) -> None:
    if data.get("priority") and data["priority"] not in PRODUCTION_WORK_ORDER_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{data['priority']}'. Use one of: {', '.join(PRODUCTION_WORK_ORDER_PRIORITIES)}.")
    if data.get("erp_project_id") and not db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Machine / project #{data['erp_project_id']} not found in ERP")
    if data.get("branch_id") and not db.query(Branch).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found")
    for key, label in (("source_location_id", "Issue-from"), ("target_location_id", "Receive-into")):
        if data.get(key) and not db.query(StoreLocation).filter(StoreLocation.id == data[key]).first():
            raise HTTPException(status_code=404, detail=f"{label} store location #{data[key]} not found")
    if data.get("supervisor_id") and not db.query(User).filter(User.id == data["supervisor_id"], User.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Supervisor user #{data['supervisor_id']} not found or inactive")


def ensure_workstation_available(db: Session, op: ProductionWorkOrderOperation) -> None:
    ws = db.query(ProductionWorkstation).filter(ProductionWorkstation.id == op.workstation_id).first() if op.workstation_id else None
    if ws and ws.is_deleted:
        raise HTTPException(
            status_code=409,
            detail=f"Workstation {ws.code} has been deleted, so operation {op.sequence} {op.operation_name} has nowhere to run. "
                   "Raise the work order again from a BOM version that routes this step to an existing workstation.",
        )
    if ws and ws.status != "active":
        raise HTTPException(
            status_code=409,
            detail=f"Workstation {ws.code} is {ws.status.replace('_', ' ')}, so operation {op.sequence} {op.operation_name} can't run on it. "
                   "Set the workstation back to active once it's available.",
        )


def _validate_dates(start: date | None, end: date | None) -> None:
    if start and end and end < start:
        raise HTTPException(status_code=400, detail=f"Planned end date ({end:%d-%m-%Y}) is before the planned start date ({start:%d-%m-%Y}).")


def _item_label(db: Session, item_id: int) -> str:
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    return f"{item.item_code} ({item.item_name})" if item else f"item #{item_id}"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ProductionWorkOrderResponse])
async def list_work_orders(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    erp_project_id: int | None = None,
    product_item_id: int | None = None,
    overdue: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "work_orders")),
):
    query = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.is_deleted == False)  # noqa: E712
    if status_filter:
        statuses = [s for s in status_filter.split(",") if s]
        bad = [s for s in statuses if s not in PRODUCTION_WORK_ORDER_STATUSES]
        if bad:
            raise HTTPException(status_code=400, detail=f"Invalid status filter '{', '.join(bad)}'")
        query = query.filter(ProductionWorkOrder.status.in_(statuses))
    if priority:
        query = query.filter(ProductionWorkOrder.priority == priority)
    if erp_project_id:
        query = query.filter(ProductionWorkOrder.erp_project_id == erp_project_id)
    if product_item_id:
        query = query.filter(ProductionWorkOrder.product_item_id == product_item_id)
    if overdue:
        query = query.filter(
            ProductionWorkOrder.planned_end_date < date.today(),
            ProductionWorkOrder.status.in_(("draft", *_EXECUTING_STATUSES)),
        )
    if search:
        like = f"%{search}%"
        query = query.join(StoreItem, StoreItem.id == ProductionWorkOrder.product_item_id).filter(
            (ProductionWorkOrder.wo_number.ilike(like)) | (StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like))
        )
    return _to_responses(db, query.order_by(ProductionWorkOrder.created_at.desc()).all())


@router.post("", response_model=ProductionWorkOrderResponse)
async def create_work_order(
    payload: ProductionWorkOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_CREATE),
):
    bom = db.query(ProductionBom).filter(ProductionBom.id == payload.bom_id, ProductionBom.is_deleted == False).first()  # noqa: E712
    if not bom:
        raise HTTPException(status_code=404, detail=f"BOM #{payload.bom_id} not found")
    if bom.status != "active":
        raise HTTPException(status_code=409, detail=f"BOM {bom.bom_number} v{bom.version} is {bom.status}. Work orders can only be raised from an active BOM — activate it first.")
    product = db.query(StoreItem).filter(StoreItem.id == bom.product_item_id).first()
    if product and product.status != "active":
        raise HTTPException(status_code=409, detail=f"Product {product.item_code} is {product.status} in the Store item master. Reactivate it in Store before building it.")
    inactive = [i.item_code for i in db.query(StoreItem).filter(
        StoreItem.id.in_([line.component_item_id for line in bom.items]), StoreItem.status != "active"
    ).all()]
    if inactive:
        raise HTTPException(status_code=409, detail=f"Component(s) {', '.join(inactive)} are no longer active in Store. Replace them in a new BOM version before raising a work order.")
    data = payload.model_dump()
    rrv_build_id, build_role = data.pop("rrv_build_id"), data.pop("build_role")
    build = None
    if rrv_build_id:
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == rrv_build_id, ProductionRrvBuild.is_deleted == False).with_for_update().first()  # noqa: E712
        if not build:
            raise HTTPException(status_code=404, detail=f"RRV build #{rrv_build_id} not found")
        check_rrv_link(db, build, build_role or "sub_assembly")
        if data.get("erp_project_id") and build.erp_project_id and data["erp_project_id"] != build.erp_project_id:
            raise HTTPException(status_code=409, detail=f"This work order is for a different machine than {build.build_number}. Leave the machine blank to use the build's.")
        data["erp_project_id"] = data.get("erp_project_id") or build.erp_project_id
    _validate_refs(db, data)
    _validate_dates(payload.planned_start_date, payload.planned_end_date)

    materials, operations = explode_bom(bom, payload.quantity_planned)
    wo = ProductionWorkOrder(
        wo_number=generate_work_order_number(db),
        product_item_id=bom.product_item_id,
        status="draft",
        created_by_id=user.id,
        rrv_build_id=build.id if build else None,
        build_role=(build_role or "sub_assembly") if build else None,
        **data,
    )
    wo.materials = materials
    wo.operations = operations
    db.add(wo)
    if build:
        db.flush()
        rrv_log(db, build.id, "work_order_linked", user, f"{wo.wo_number} raised as {wo.build_role.replace('_', '-')}")
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.get("/{wo_id}", response_model=ProductionWorkOrderResponse)
async def get_work_order(wo_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, wo_id))


@router.patch("/{wo_id}", response_model=ProductionWorkOrderResponse)
async def update_work_order(
    wo_id: int,
    payload: ProductionWorkOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EDITABLE_STATUSES, "edit it")
    updates = payload.model_dump(exclude_unset=True)
    _validate_refs(db, updates)
    _validate_dates(updates.get("planned_start_date", wo.planned_start_date), updates.get("planned_end_date", wo.planned_end_date))

    new_qty = updates.pop("quantity_planned", None)
    if new_qty is not None and new_qty != wo.quantity_planned:
        if wo.status != "draft":
            raise HTTPException(
                status_code=409,
                detail=f"The planned quantity of {wo.wo_number} is locked once it's released, because material and hours were planned against it. "
                       "Raise a second work order for the extra units instead.",
            )
        bom = db.query(ProductionBom).filter(ProductionBom.id == wo.bom_id).first()
        materials, operations = explode_bom(bom, new_qty)
        wo.quantity_planned = new_qty
        wo.materials = materials
        wo.operations = operations

    source_changed = "source_location_id" in updates and updates["source_location_id"] != wo.source_location_id
    for field, val in updates.items():
        setattr(wo, field, val)
    if source_changed and wo.status in _EXECUTING_STATUSES:
        release_reservations(db, wo)
        try:
            reserve_materials(db, wo, user.id)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Couldn't move the reservations to the new location: {e}")
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.delete("/{wo_id}")
async def delete_work_order(wo_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_DELETE)):
    wo = _get_or_404(db, wo_id, lock=True)
    if wo.status != "draft":
        raise HTTPException(status_code=409, detail=f"Only a draft work order can be deleted — {wo.wo_number} is {wo.status.replace('_', ' ')}. Cancel it instead.")
    wo.is_deleted = True
    wo.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Work order {wo.wo_number} deleted"}


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/release", response_model=ProductionWorkOrderResponse)
async def release_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_APPROVE),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("draft",), "release it")
    missing = [label for key, label in (("source_location_id", "Issue materials from"), ("target_location_id", "Receive output into")) if not getattr(wo, key)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Set the '{' and '.join(missing)}' store location(s) on {wo.wo_number} before releasing it to the shop floor.")
    if not wo.operations:
        raise HTTPException(status_code=400, detail=f"{wo.wo_number} has no routing operations, so there is nothing for the shop floor to do. Add operations to the BOM and raise a new work order.")
    wo.status = "released"
    try:
        reserve_materials(db, wo, user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Couldn't reserve material for {wo.wo_number}: {e}")
    if wo.supervisor_id and wo.supervisor_id != user.id:
        notify_user(
            db, user_id=wo.supervisor_id,
            title="Work Order Released",
            message=f"Work order {wo.wo_number} ({wo.quantity_planned:g} × {_item_label(db, wo.product_item_id)}) was released to the shop floor by {user.name or user.email}.",
            notification_type="work_order_released", entity_type="production_work_order", entity_id=wo.id,
        )
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/complete", response_model=ProductionWorkOrderResponse)
async def complete_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_APPROVE),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("in_progress",), "complete it")
    pending = [f"{op.sequence} {op.operation_name}" for op in wo.operations if op.status != "completed"]
    if pending:
        raise HTTPException(status_code=409, detail=f"Operation(s) {', '.join(pending)} are not completed yet. Complete every operation before completing {wo.wo_number}.")
    if wo.quantity_completed <= 0:
        raise HTTPException(status_code=409, detail=f"No finished goods have been received into Store for {wo.wo_number}. Use 'Receive Output' first.")
    wo.status = "completed"
    wo.actual_end_at = datetime.now(timezone.utc)
    release_reservations(db, wo)
    if wo.created_by_id and wo.created_by_id != user.id:
        notify_user(
            db, user_id=wo.created_by_id,
            title="Work Order Completed",
            message=f"Work order {wo.wo_number} was completed: {wo.quantity_completed:g} of {wo.quantity_planned:g} built, {wo.quantity_scrapped:g} scrapped.",
            notification_type="work_order_completed", entity_type="production_work_order", entity_id=wo.id,
        )
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/close", response_model=ProductionWorkOrderResponse)
async def close_work_order(wo_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_APPROVE)):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("completed",), "close it")
    wo.status = "closed"
    wo.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/cancel", response_model=ProductionWorkOrderResponse)
async def cancel_work_order(wo_id: int, payload: ProductionWorkOrderCancelPayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_APPROVE)):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EDITABLE_STATUSES, "cancel it")
    still_issued = [
        f"{_item_label(db, m.item_id)} × {m.issued_qty - m.returned_qty:g}"
        for m in wo.materials if m.issued_qty - m.returned_qty > 0
    ]
    if still_issued:
        raise HTTPException(status_code=409, detail=f"Material is still issued to {wo.wo_number}: {'; '.join(still_issued)}. Return it to Store before cancelling.")
    if wo.quantity_completed > 0:
        raise HTTPException(status_code=409, detail=f"{wo.quantity_completed:g} finished unit(s) were already received for {wo.wo_number}. Complete the order instead of cancelling it.")
    release_reservations(db, wo)
    wo.status = "cancelled"
    wo.cancel_reason = payload.reason.strip()
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


# ---------------------------------------------------------------------------
# Store integration — material issue / return, finished-goods receipt
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/issue-materials", response_model=ProductionWorkOrderResponse)
async def issue_materials(
    wo_id: int,
    payload: ProductionWorkOrderIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "issue material to it")
    location_id = payload.location_id or wo.source_location_id
    if not location_id or not db.query(StoreLocation).filter(StoreLocation.id == location_id).first():
        raise HTTPException(status_code=400, detail="Choose the store location to issue from — this work order has no issue-from location set.")

    lines_by_item = {m.item_id: m for m in wo.materials}
    for line in payload.lines:
        material = lines_by_item.get(line.item_id)
        if material is None:
            # An item that wasn't on the BOM (a substitute, or extra consumables).
            if not db.query(StoreItem).filter(StoreItem.id == line.item_id).first():
                raise HTTPException(status_code=404, detail=f"Item #{line.item_id} not found in the Store item master")
            material = ProductionWorkOrderMaterial(item_id=line.item_id, required_qty=0.0, remarks="Extra issue (not on BOM)")
            wo.materials.append(material)
            lines_by_item[line.item_id] = material
        try:
            consume_reservation(db, material, line.quantity, location_id)
            post_stock_transaction(
                db, item_id=line.item_id, location_id=location_id, transaction_type="issue", quantity=line.quantity,
                batch_number=line.batch_number, reference_type=WORK_ORDER_REFERENCE_TYPE, reference_number=wo.wo_number,
                transaction_date=date.today(), remarks=payload.remarks or f"Issued to work order {wo.wo_number}",
                created_by_id=user.id,
            )
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't issue {_item_label(db, line.item_id)}: {e}")
        material.issued_qty = round(material.issued_qty + line.quantity, 4)

    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/reserve-materials", response_model=ProductionWorkOrderResponse)
async def reserve_work_order_materials(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    """Re-try holding stock for lines that were short at release — e.g.
    after a GRN brought the missing material in."""
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "reserve material for it")
    try:
        reserve_materials(db, wo, user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Couldn't reserve material for {wo.wo_number}: {e}")
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/return-materials", response_model=ProductionWorkOrderResponse)
async def return_materials(
    wo_id: int,
    payload: ProductionWorkOrderIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, (*_EXECUTING_STATUSES, "completed"), "return material from it")
    location_id = payload.location_id or wo.source_location_id
    if not location_id or not db.query(StoreLocation).filter(StoreLocation.id == location_id).first():
        raise HTTPException(status_code=400, detail="Choose the store location to return material into.")

    lines_by_item = {m.item_id: m for m in wo.materials}
    for line in payload.lines:
        material = lines_by_item.get(line.item_id)
        net = (material.issued_qty - material.returned_qty) if material else 0.0
        if material is None or line.quantity > net + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"Can't return {line.quantity:g} of {_item_label(db, line.item_id)} — only {net:g} is currently issued to {wo.wo_number}.",
            )
        post_stock_transaction(
            db, item_id=line.item_id, location_id=location_id, transaction_type="return_in", quantity=line.quantity,
            batch_number=line.batch_number, reference_type=WORK_ORDER_REFERENCE_TYPE, reference_number=wo.wo_number,
            transaction_date=date.today(), remarks=payload.remarks or f"Returned unused from work order {wo.wo_number}",
            created_by_id=user.id,
        )
        material.returned_qty = round(material.returned_qty + line.quantity, 4)

    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/receive-output", response_model=ProductionWorkOrderResponse)
async def receive_output(
    wo_id: int,
    payload: ProductionWorkOrderReceivePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_EDIT),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("in_progress",), "receive finished goods for it")
    location_id = payload.location_id or wo.target_location_id
    if not location_id or not db.query(StoreLocation).filter(StoreLocation.id == location_id).first():
        raise HTTPException(status_code=400, detail="Choose the store location to receive finished goods into.")

    product = db.query(StoreItem).filter(StoreItem.id == wo.product_item_id).first()
    if product and product.serial_controlled:
        if payload.quantity != int(payload.quantity):
            raise HTTPException(status_code=400, detail=f"{product.item_code} is serial-numbered in Store, so output is received in whole units — {payload.quantity:g} isn't one.")
        if payload.quantity == 1 and not (payload.batch_number or "").strip():
            raise HTTPException(status_code=400, detail=f"{product.item_code} is serial-numbered — enter the unit's serial number in the Batch / Serial field.")
    remaining = round(wo.quantity_planned - wo.quantity_completed, 4)
    if payload.quantity > remaining + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"Only {remaining:g} unit(s) of {wo.wo_number} are still to be received ({wo.quantity_completed:g} of {wo.quantity_planned:g} done). "
                   "Raise a second work order for any extra units.",
        )

    # Quality gate: every inspection-controlled step must have a passed
    # inspection before anything built on this order goes into stock.
    ungated = []
    inspection_ids = {op.quality_inspection_id for op in wo.operations if op.quality_inspection_id}
    statuses = {i.id: i.status for i in db.query(QualityInspection).filter(QualityInspection.id.in_(inspection_ids), QualityInspection.is_deleted == False).all()}  # noqa: E712 if inspection_ids else {}
    for op in wo.operations:
        if op.requires_inspection and statuses.get(op.quality_inspection_id) not in _PASSED_INSPECTION:
            ungated.append(f"{op.sequence} {op.operation_name}")
    if ungated:
        raise HTTPException(
            status_code=409,
            detail=f"Quality hasn't passed the inspection for operation(s) {', '.join(ungated)} yet. "
                   "Request the inspection from the Operations tab and have Quality mark it passed before receiving output.",
        )

    post_stock_transaction(
        db, item_id=wo.product_item_id, location_id=location_id, transaction_type="receipt", quantity=payload.quantity,
        batch_number=payload.batch_number or wo.wo_number, reference_type=WORK_ORDER_REFERENCE_TYPE,
        reference_number=wo.wo_number, transaction_date=date.today(),
        remarks=payload.remarks or f"Finished goods from work order {wo.wo_number}", created_by_id=user.id,
    )
    wo.quantity_completed = round(wo.quantity_completed + payload.quantity, 4)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.get("/{wo_id}/stock-movements", response_model=list[ProductionStockMovementResponse])
async def list_stock_movements(wo_id: int, db: Session = Depends(get_db)):
    wo = _get_or_404(db, wo_id)
    rows = db.query(StoreStockTransaction).filter(
        StoreStockTransaction.reference_type == WORK_ORDER_REFERENCE_TYPE,
        StoreStockTransaction.reference_number == wo.wo_number,
    ).order_by(StoreStockTransaction.id.desc()).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.item_id for r in rows})).all()} if rows else {}
    locations = _names(db, StoreLocation, {r.location_id for r in rows}, lambda loc: f"{loc.code} — {loc.name}")
    users = _names(db, User, {r.created_by_id for r in rows}, lambda u: u.name or u.email)
    return [
        ProductionStockMovementResponse(
            id=r.id, transaction_type=r.transaction_type, item_id=r.item_id,
            item_code=items[r.item_id].item_code if r.item_id in items else None,
            item_name=items[r.item_id].item_name if r.item_id in items else None,
            location_name=locations.get(r.location_id), quantity=r.quantity, batch_number=r.batch_number,
            transaction_date=r.transaction_date, remarks=r.remarks, created_by_name=users.get(r.created_by_id),
        )
        for r in rows
    ]


@router.get("/{wo_id}/job-card")
async def download_job_card(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_tab_action("production", "work_orders", "print")),
):
    """Printable A4 traveler for the shop floor: pick list + routing with
    blank columns for operators to fill in by hand."""
    resp = _to_response(db, _get_or_404(db, wo_id))
    # Plain "to" — the built-in PDF font has no arrow glyph.
    planned = " to ".join(d.strftime("%d-%m-%Y") if d else "—" for d in (resp.planned_start_date, resp.planned_end_date))
    try:
        pdf = build_job_card_pdf({
            "wo_number": resp.wo_number, "status": resp.status.replace("_", " ").title(), "priority": resp.priority.title(),
            "product": f"{resp.product_code} — {resp.product_name}", "quantity": resp.quantity_planned, "uom": resp.product_uom,
            "bom": f"{resp.bom_number} v{resp.bom_version}", "project": resp.project_label, "planned": planned,
            "supervisor": resp.supervisor_name, "source_location": resp.source_location_name,
            "target_location": resp.target_location_name, "remarks": resp.remarks,
            "printed_at": datetime.now().strftime("%d-%m-%Y %H:%M"), "printed_by": user.name or user.email,
            "materials": [
                {"code": m.item_code, "name": m.item_name, "uom": m.uom, "required": m.required_qty, "issued": m.issued_qty - m.returned_qty}
                for m in resp.materials
            ],
            "operations": [
                {"sequence": o.sequence, "name": o.operation_name, "workstation": o.workstation_name,
                 "planned_hours": o.planned_hours, "quality_gate": o.requires_inspection, "instructions": o.instructions}
                for o in resp.operations
            ],
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't build the job card PDF: {e}")
    return Response(
        content=pdf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="Job-Card-{resp.wo_number}.pdf"'},
    )


@router.get("/{wo_id}/costing", response_model=ProductionWorkOrderCostingResponse)
async def get_costing(wo_id: int, db: Session = Depends(get_db)):
    return work_order_costing(db, _get_or_404(db, wo_id))


# ---------------------------------------------------------------------------
# Operations — start / complete / quality inspection gate
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/operations/{op_id}/start", response_model=ProductionWorkOrderResponse)
async def start_operation(wo_id: int, op_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_RUN_FLOOR)):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "start its operations")
    op = _get_operation(wo, op_id)
    if op.status != "pending":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is already {op.status.replace('_', ' ')}.")
    ensure_workstation_available(db, op)
    op.status = "in_progress"
    op.started_at = datetime.now(timezone.utc)
    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/operations/{op_id}/complete", response_model=ProductionWorkOrderResponse)
async def complete_operation(wo_id: int, op_id: int, payload: ProductionOperationCompletePayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_RUN_FLOOR)):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "complete its operations")
    op = _get_operation(wo, op_id)
    if op.status == "completed":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is already completed.")
    if op.requires_inspection:
        # A deleted inspection no longer counts as a sign-off.
        insp = db.query(QualityInspection).filter(
            QualityInspection.id == op.quality_inspection_id, QualityInspection.is_deleted == False  # noqa: E712
        ).first() if op.quality_inspection_id else None
        if not insp:
            raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is a quality gate. Click 'Request Inspection' and have Quality pass it before completing this step.")
        if insp.status not in _PASSED_INSPECTION:
            hint = ("Rework the parts, then request a fresh inspection." if insp.status == "failed"
                    else "Wait for Quality to finish it.")
            raise HTTPException(status_code=409, detail=f"Inspection {insp.inspection_number} for operation {op.sequence} {op.operation_name} is {insp.status.replace('_', ' ')}. {hint}")
    if op.started_at is None:
        op.started_at = datetime.now(timezone.utc)
    op.status = "completed"
    op.completed_at = datetime.now(timezone.utc)
    if payload.remarks:
        op.remarks = payload.remarks
    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)


@router.post("/{wo_id}/operations/{op_id}/request-inspection", response_model=ProductionWorkOrderResponse)
async def request_inspection(
    wo_id: int, op_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_RUN_FLOOR),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "request inspections for it")
    op = _get_operation(wo, op_id)
    if op.status == "completed":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is already completed.")
    if op.quality_inspection_id:
        current = db.query(QualityInspection).filter(QualityInspection.id == op.quality_inspection_id).first()
        # A failed inspection can be re-requested after rework; anything else is still live.
        if current and not current.is_deleted and current.status != "failed":
            raise HTTPException(status_code=409, detail=f"Inspection {current.inspection_number} is already {current.status.replace('_', ' ')} for this operation.")

    is_final = op.sequence == max(o.sequence for o in wo.operations)
    inspection_type = "final" if is_final else "in_process"
    product = db.query(StoreItem).filter(StoreItem.id == wo.product_item_id).first()
    project = db.query(Project).filter(Project.id == wo.erp_project_id).first() if wo.erp_project_id else None
    inspection = QualityInspection(
        inspection_number=generate_inspection_number(db, "FIN" if is_final else "PROC"),
        inspection_type=inspection_type,
        item_name=product.item_name if product else f"Item #{wo.product_item_id}",
        item_code=product.item_code if product else None,
        batch_number=wo.wo_number,
        quantity_inspected=op.qty_good or wo.quantity_planned,
        project_label=f"{wo.wo_number} · Op {op.sequence} {op.operation_name}" + (f" · {project.serial_number}" if project else ""),
        inspection_date=date.today(),
        status="pending",
        remarks=f"Requested from Production by {user.name or user.email} for work order {wo.wo_number}, operation {op.sequence} {op.operation_name}.",
    )
    db.add(inspection)
    db.flush()
    op.quality_inspection_id = inspection.id
    broadcast_notification(
        db,
        title=f"{'Final' if is_final else 'In-Process'} Inspection Requested",
        message=f"{wo.wo_number} · operation {op.sequence} {op.operation_name} is waiting for inspection {inspection.inspection_number}.",
        notification_type="production_inspection_requested", entity_type="quality_inspection", entity_id=inspection.id,
        exclude_user_id=user.id, app_name="quality",
    )
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo)
