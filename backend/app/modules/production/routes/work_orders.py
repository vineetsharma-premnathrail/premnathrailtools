from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.data_scope import apply_scope
from app.core.permission_registry import can_feature
from app.core.permissions import ensure_can_delete, require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.modules.production.sensitive import mask_movement, mask_work_order, sees_costs
from app.modules.production import notify as prod_notify
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.models.branch import Branch
from app.modules.organization.services import approval_engine as engine
from app.modules.production.authz import WO_ENTITY, WO_KEY, ensure_not_pending, scope_path_record, submit_and_self_approve
from app.modules.production import costing
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import (
    ProductionWorkOrder, ProductionWorkOrderMaterial, ProductionWorkOrderOperation, ProductionTimeLog, ProductionOrderCostPosting,
    PRODUCTION_WORK_ORDER_PRIORITIES, PRODUCTION_WORK_ORDER_STATUSES, WORK_ORDER_REFERENCE_TYPE,
)
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.reports.job_card_pdf import build_job_card_pdf
from app.modules.production.schemas.work_order import (
    ProductionWorkOrderCreate, ProductionWorkOrderUpdate, ProductionWorkOrderResponse,
    ProductionWorkOrderIssuePayload, ProductionWorkOrderReceivePayload, ProductionWorkOrderCancelPayload,
    ProductionOperationCompletePayload, ProductionStockMovementResponse, ProductionWorkOrderCostingResponse,
    ProductionOperationJobWorkPayload, ProductionSubOrdersPayload, ProductionChangeFlagClearPayload, ProductionDependentOrder,
)
from app.modules.production import effectivity, explosion, routing_control
from app.modules.production.service import (
    generate_work_order_number, explode_bom, available_qty, outstanding_qty, work_order_costing,
    mark_started, project_label, reserve_materials, consume_reservation, release_reservations, reserved_by_line,
    check_rrv_link, rrv_log,
)
from app.modules.production.models.rrv_build import ProductionRrvBuild
from app.modules.production import order_project_links  # also registers the Order Project hooks / provider
from app.modules.sales.models.order_project import OrderProjectElement
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.services import production_gates
from app.modules.quality.services.first_article import check_production_release, FaiError
from app.modules.quality.services.lots import needs_inspection_on_receipt, create_lot_for_production_output, LotError, LOT_REFERENCE_TYPE
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import StoreStockTransaction
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.modules.store.services.project_stock import secure_issue_qty
from app.utils.notifications import notify_user

router = APIRouter(
    prefix="/production/work-orders", tags=["Production"],
    # Every /{wo_id}/… route checks the order against the caller's data scope.
    dependencies=[Depends(require_app_access("production")), Depends(scope_path_record(ProductionWorkOrder, "wo_id"))],
)

_EDITABLE_STATUSES = ("draft", "released", "in_progress")

SUPERVISOR_RULE = "production:work_orders.supervisor"  # core/assignee_rules.PICKERS

# Permission Matrix actions (opt-in per user — see can_perform).
_CAN_CREATE = require_tab_action("production", "work_orders", "create")
_CAN_EDIT = require_tab_action("production", "work_orders", "edit")
_CAN_DELETE = require_tab_action("production", "work_orders", "delete")
_CAN_RUN_FLOOR = require_feature_action("production", "shop_floor", "run_operations", "edit")
_EXECUTING_STATUSES = ("released", "in_progress")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _names(db: Session, model, ids: set, label) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {row.id: label(row) for row in db.query(model).filter(model.id.in_(ids)).all()}


def _to_responses(db: Session, orders: list[ProductionWorkOrder], detail: bool = False,
                  user: User | None = None) -> list[ProductionWorkOrderResponse]:
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
    sales_labels = routing_control.sales_order_labels(db, orders)
    parents = _names(db, ProductionWorkOrder, {o.parent_work_order_id for o in orders}, lambda w: w.wo_number)
    child_counts = routing_control.child_counts(db, [o.id for o in orders])
    element_rows = {el.id: el for el in db.query(OrderProjectElement).filter(OrderProjectElement.id.in_(
        {o.order_project_element_id for o in orders if o.order_project_element_id} or {-1})).all()}

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
        resp.sales_order_label = sales_labels.get(wo.id)
        resp.parent_wo_number = parents.get(wo.parent_work_order_id)
        resp.child_count = child_counts.get(wo.id, 0)
        el = element_rows.get(wo.order_project_element_id)
        if el is not None:
            resp.order_project_number = el.project.op_number
            resp.order_project_element_no, resp.order_project_element_label = el.element_no, el.label

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
            resp.shortage_count = sum(1 for m in resp.materials
                                      if m.item_category == "stock" and m.outstanding_qty > m.reserved_qty + m.available_qty + 1e-9)

            ws_names = _names(db, ProductionWorkstation, {op.workstation_id for op in wo.operations}, lambda w: f"{w.code} — {w.name}")
            inspections = {i.id: i for i in db.query(QualityInspection).filter(
                QualityInspection.id.in_({op.quality_inspection_id for op in wo.operations if op.quality_inspection_id}),
                QualityInspection.is_deleted == False,  # noqa: E712
            ).all()}
            gate_lots = {lot.id: lot for lot in db.query(QualityInspectionLot).filter(
                QualityInspectionLot.id.in_({op.quality_lot_id for op in wo.operations if op.quality_lot_id})).all()}
            ops_by_id = {op.id: op for op in wo.operations}
            hours: dict[int, float] = {}
            for log in db.query(ProductionTimeLog).filter(ProductionTimeLog.work_order_id == wo.id).all():
                hours[log.operation_id] = hours.get(log.operation_id, 0.0) + log.hours
            routing_control.decorate_operations(db, resp.operations)
            for op in resp.operations:
                op.workstation_name = ws_names.get(op.workstation_id)
                op.actual_hours = round(hours.get(op.id, 0.0), 2)
                # In-process lot (Phase 2) or the legacy free-text inspection.
                g = production_gates.gate_state(db, ops_by_id[op.id], lots=gate_lots, legacy=inspections)
                if g.requested:
                    op.inspection_number, op.inspection_status = g.number, g.status
        else:
            resp.materials, resp.operations = [], []
        out.append(resp)
    if user is not None and not sees_costs(user, "work_orders"):
        for resp in out:
            mask_work_order(resp)
    return out


def _to_response(db: Session, wo: ProductionWorkOrder, user: User | None = None) -> ProductionWorkOrderResponse:
    return _to_responses(db, [wo], detail=True, user=user)[0]


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


def _validate_refs(db: Session, data: dict, user: User, current_supervisor_id: int | None = None) -> None:
    if data.get("priority") and data["priority"] not in PRODUCTION_WORK_ORDER_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{data['priority']}'. Use one of: {', '.join(PRODUCTION_WORK_ORDER_PRIORITIES)}.")
    if data.get("erp_project_id") and not db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Machine / project #{data['erp_project_id']} not found in ERP")
    if data.get("branch_id") and not db.query(Branch).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found")
    for key, label in (("source_location_id", "Issue-from"), ("target_location_id", "Receive-into")):
        if data.get(key) and not db.query(StoreLocation).filter(StoreLocation.id == data[key]).first():
            raise HTTPException(status_code=404, detail=f"{label} store location #{data[key]} not found")
    if data.get("supervisor_id"):
        supervisor = db.query(User).filter(User.id == data["supervisor_id"], User.is_active == True).first()  # noqa: E712
        if not supervisor:
            raise HTTPException(status_code=404, detail=f"Supervisor user #{data['supervisor_id']} not found or inactive")
        # The role's assign-to rule (Role & Permissions › Production › Work Orders › Supervisor), on a change only.
        if supervisor.id != current_supervisor_id:
            assignee_rules.ensure_allowed(db, user, SUPERVISOR_RULE, supervisor)


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
    query = apply_scope(db.query(ProductionWorkOrder).filter(ProductionWorkOrder.is_deleted == False), _tab, ProductionWorkOrder)  # noqa: E712
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
    return _to_responses(db, query.order_by(ProductionWorkOrder.created_at.desc()).all(), user=_tab)


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
    effectivity.apply_due_effectivity(db, bom.product_item_id)
    db.refresh(bom)
    product = db.query(StoreItem).filter(StoreItem.id == bom.product_item_id).first()
    if product and product.status != "active":
        raise HTTPException(status_code=409, detail=f"Product {product.item_code} is {product.status} in the Store item master. Reactivate it in Store before building it.")
    inactive = [i.item_code for i in db.query(StoreItem).filter(
        StoreItem.id.in_([line.component_item_id for line in bom.items if line.component_item_id]), StoreItem.status != "active"
    ).all()]
    if inactive:
        raise HTTPException(status_code=409, detail=f"Component(s) {', '.join(inactive)} are no longer active in Store. Replace them in a new BOM version before raising a work order.")
    data = payload.model_dump()
    rrv_build_id, build_role = data.pop("rrv_build_id"), data.pop("build_role")
    parent_id = data.pop("parent_work_order_id", None)
    if parent_id:
        parent = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == parent_id, ProductionWorkOrder.is_deleted == False).first()  # noqa: E712
        if parent is None:
            raise HTTPException(status_code=404, detail=f"Parent work order #{parent_id} not found")
        data["parent_work_order_id"] = parent.id
        for key in ("erp_project_id", "sales_order_id", "sales_order_line_id", "branch_id"):
            data[key] = data.get(key) or getattr(parent, key)
        if not data.get("order_project_element_id"):
            order_project_links.inherit_element(data, parent)
    build = None
    if rrv_build_id:
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == rrv_build_id, ProductionRrvBuild.is_deleted == False).with_for_update().first()  # noqa: E712
        if not build:
            raise HTTPException(status_code=404, detail=f"RRV build #{rrv_build_id} not found")
        check_rrv_link(db, build, build_role or "sub_assembly")
        if data.get("erp_project_id") and build.erp_project_id and data["erp_project_id"] != build.erp_project_id:
            raise HTTPException(status_code=409, detail=f"This work order is for a different machine than {build.build_number}. Leave the machine blank to use the build's.")
        data["erp_project_id"] = data.get("erp_project_id") or build.erp_project_id
        data["sales_order_id"] = data.get("sales_order_id") or build.sales_order_id
        data["sales_order_line_id"] = data.get("sales_order_line_id") or build.sales_order_line_id
        build_el = order_project_links.resolve_build_element(db, build, persist=True)
        if build_el is not None:
            if data.get("order_project_element_id") and data["order_project_element_id"] != build_el.id:
                raise HTTPException(status_code=409, detail=f"{build.build_number} builds {build_el.element_no} ({build_el.label}), so its work "
                                                            "orders work for that element too. Clear the Order Project field to use the build's.")
            data["order_project_id"], data["order_project_element_id"] = build_el.order_project_id, build_el.id
    _validate_refs(db, data, user)
    _validate_dates(payload.planned_start_date, payload.planned_end_date)
    try:
        effectivity.check_bom_for_order(db, bom, payload.planned_start_date, data.get("erp_project_id"))
        routing_control.validate_sales_assignment(db, data, bom.product_item_id)
    except (effectivity.EffectivityError, routing_control.RoutingError) as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    order_project_links.apply_wo_element(db, data, bom.product_item_id)

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
    return _to_response(db, wo, user)


@router.get("/{wo_id}", response_model=ProductionWorkOrderResponse)
async def get_work_order(
    wo_id: int,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "work_orders")),
):
    return _to_response(db, _get_or_404(db, wo_id), _tab)


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
    if wo.status == "draft":
        ensure_not_pending(db, WO_ENTITY, wo.id, f"The release of {wo.wo_number}", "edited")
    updates = payload.model_dump(exclude_unset=True)
    if "priority" in updates and updates["priority"] is None:
        raise HTTPException(status_code=400, detail=f"Priority can't be empty — use one of: {', '.join(PRODUCTION_WORK_ORDER_PRIORITIES)}.")
    _validate_refs(db, updates, user, wo.supervisor_id)
    _validate_dates(updates.get("planned_start_date", wo.planned_start_date), updates.get("planned_end_date", wo.planned_end_date))
    if "sales_order_id" in updates or "sales_order_line_id" in updates:
        so_data = {"sales_order_id": updates.get("sales_order_id", wo.sales_order_id),
                   "sales_order_line_id": updates.get("sales_order_line_id", wo.sales_order_line_id)}
        if "sales_order_id" in updates and updates["sales_order_id"] is None:
            so_data["sales_order_line_id"] = None
        try:
            routing_control.validate_sales_assignment(db, so_data, wo.product_item_id)
        except routing_control.RoutingError as e:
            raise HTTPException(status_code=e.status, detail=str(e))
        updates.update(so_data)
    if {"sales_order_id", "sales_order_line_id", "order_project_id", "order_project_element_id"} & updates.keys():
        el_data = {k: updates.get(k, getattr(wo, k)) for k in
                   ("sales_order_id", "sales_order_line_id", "order_project_id", "order_project_element_id")}
        if "order_project_element_id" in updates and "order_project_id" not in updates:
            el_data["order_project_id"] = None  # the picked element names its own project
        if "sales_order_id" in updates and updates["sales_order_id"] is None and "order_project_element_id" not in updates:
            el_data["order_project_id"] = el_data["order_project_element_id"] = None  # clearing the order clears its element
        if wo.rrv_build_id:
            build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
            build_el = order_project_links.resolve_build_element(db, build) if build else None
            if build_el is not None and el_data["order_project_element_id"] != build_el.id:
                raise HTTPException(status_code=409, detail=f"{wo.wo_number} is part of {build.build_number}, which builds {build_el.element_no} "
                                                            f"({build_el.label}). Unlink it from the build first to work for another element.")
        order_project_links.apply_wo_element(db, el_data, wo.product_item_id)
        updates.update(el_data)
    if wo.rrv_build_id and "erp_project_id" in updates and updates["erp_project_id"] != wo.erp_project_id:
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
        if build and build.erp_project_id and updates["erp_project_id"] != build.erp_project_id:
            machine = project_label(db.query(Project).filter(Project.id == build.erp_project_id).first()) or f"#{build.erp_project_id}"
            raise HTTPException(
                status_code=409,
                detail=f"{wo.wo_number} is part of {build.build_number}, which is for machine {machine}. "
                       "Unlink it from the build first, or change the build's machine.",
            )

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
    return _to_response(db, wo, user)


@router.delete("/{wo_id}")
async def delete_work_order(wo_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    wo = _get_or_404(db, wo_id, lock=True)
    ensure_can_delete(user, wo, "production", "work_orders", what="work order")
    if wo.status != "draft":
        raise HTTPException(status_code=409, detail=f"Only a draft work order can be deleted — {wo.wo_number} is {wo.status.replace('_', ' ')}. Cancel it instead.")
    ensure_not_pending(db, WO_ENTITY, wo.id, f"The release of {wo.wo_number}", "deleted")
    wo.is_deleted = True
    wo.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Work order {wo.wo_number} deleted"}


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def _check_releasable(db: Session, wo: ProductionWorkOrder) -> None:
    _require_status(wo, ("draft",), "release it")
    if wo.rrv_build_id:
        build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == wo.rrv_build_id).first()
        if build and (build.is_deleted or build.status in ("cancelled", "handed_over")):
            state = "deleted" if build.is_deleted else build.status.replace("_", " ")
            raise HTTPException(
                status_code=409,
                detail=f"{build.build_number} is {state}, so no more material should be reserved for it. "
                       f"Cancel {wo.wo_number} instead, or raise a new work order against a build that is still in progress.",
            )
    missing = [label for key, label in (("source_location_id", "Issue materials from"), ("target_location_id", "Receive output into")) if not getattr(wo, key)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Set the '{' and '.join(missing)}' store location(s) on {wo.wo_number} before releasing it to the shop floor.")
    if not wo.operations:
        raise HTTPException(status_code=400, detail=f"{wo.wo_number} has no routing operations, so there is nothing for the shop floor to do. Add operations to the BOM and raise a new work order.")
    try:
        check_production_release(db, db.query(StoreItem).filter(StoreItem.id == wo.product_item_id).first(), wo.wo_number)
    except FaiError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _release(db: Session, wo: ProductionWorkOrder, user: User) -> None:
    """Draft → released: reserves the material at the source store and tells
    the supervisor. Runs when the release is approved."""
    _check_releasable(db, wo)
    wo.status = "released"
    try:
        short = reserve_materials(db, wo, user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=f"Couldn't reserve material for {wo.wo_number}: {e}")
    label = f"{wo.wo_number} ({wo.quantity_planned:g} × {_item_label(db, wo.product_item_id)})"
    if wo.supervisor_id and wo.supervisor_id != user.id:
        notify_user(
            db, user_id=wo.supervisor_id,
            title="Work Order Released",
            message=f"Work order {label} was released to the shop floor by {user.name or user.email}.",
            notification_type="work_order_released", entity_type="production_work_order", entity_id=wo.id,
        )
    # Role-based (core/events/production.py); the supervisor was told directly.
    prod_notify.fire(db, "wo_released", record=wo, entity_type="production_work_order", actor=user, skip={wo.supervisor_id},
                     title=f"Work order released: {wo.wo_number}",
                     message=f"Work order {label} was released to the shop floor by {user.name or user.email}.")
    if short:
        prod_notify.fire(db, "wo_material_short", record=wo, entity_type="production_work_order", actor=user,
                         title=f"Material short: {wo.wo_number}",
                         message=f"{wo.wo_number} was released but Store couldn't reserve all of its material: {', '.join(short[:10])}"
                                 f"{' …' if len(short) > 10 else ''}. Raise a PR / chase the GRN, then use 'Top Up Reservation'.")


def _release_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    if outcome != "approved":
        return  # rejected / returned / withdrawn: the order stays a draft
    wo = _get_or_404(db, req.entity_id, lock=True)
    _release(db, wo, actor)


engine.register_transaction(engine.TransactionType(
    key=WO_KEY, module_key="production", subtab_key="work_orders", label="Work order release",
    feature_key="release",  # inbox decides on Work Orders › Release to shop floor › Approve
    entity_type=WO_ENTITY, url="/dashboard/production/work-orders/{id}",
    description="A draft work order is released to the shop floor (its material gets reserved).",
    default_stages=[engine.StageDef("Work order approver", "permission", {"permission": "production:work_orders:approve"})],
    # As before: anyone holding Work Orders › Approve releases — including their own order.
    require_permission=True, allow_self_approval=True,
    on_decided=_release_decided,
))


@router.post("/{wo_id}/release", response_model=ProductionWorkOrderResponse)
async def release_work_order(
    wo_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
):
    """Submits the release through the central approval engine (workflow
    "production.work_order_release"). A work-order approver releases it in
    the same click; a user with only Edit sends it to the approvers."""
    if not (can_feature(user, "production", "work_orders", "release", "approve") or can_feature(user, "production", "work_orders", "release", "submit")):
        raise HTTPException(status_code=403, detail="You need 'Submit' (to submit) or 'Approve' (to release) on Production › Work Orders › "
                                                    "Release to shop floor. Ask an admin to grant it in Organization › Role & Permissions.")
    wo = _get_or_404(db, wo_id, lock=True)
    _check_releasable(db, wo)
    product = _item_label(db, wo.product_item_id)
    try:
        req = submit_and_self_approve(
            db, WO_KEY, entity_id=wo.id, requester=user, title=f"Release {wo.wo_number} ({wo.quantity_planned:g} × {product})",
            reference=wo.wo_number, branch_id=wo.branch_id, admin_note="Released directly by an admin",
        )
    except HTTPException:
        db.rollback()
        raise
    if req.status == "pending":
        prod_notify.fire(db, "wo_release_submitted", record=wo, entity_type="production_work_order", actor=user,
                         skip=prod_notify.pending_approver_ids(req), background_tasks=background_tasks,
                         title=f"Work order waiting for release: {wo.wo_number}",
                         message=f"{user.name or user.email} submitted {wo.wo_number} ({wo.quantity_planned:g} × {product}) for release. "
                                 "Approve it in the Approval inbox or on the work order.")
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


@router.post("/{wo_id}/complete", response_model=ProductionWorkOrderResponse)
async def complete_work_order(
    wo_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "lifecycle", "approve")),
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
    prod_notify.fire(db, "wo_completed", record=wo, entity_type="production_work_order", actor=user, skip={wo.created_by_id},
                     background_tasks=background_tasks, title=f"Work order completed: {wo.wo_number}",
                     message=f"Work order {wo.wo_number} was completed: {wo.quantity_completed:g} of {wo.quantity_planned:g} built, "
                             f"{wo.quantity_scrapped:g} scrapped. Return any unused material, then close it.")
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


@router.post("/{wo_id}/close", response_model=ProductionWorkOrderResponse)
async def close_work_order(wo_id: int, db: Session = Depends(get_db), _perm: User = Depends(require_feature_action("production", "work_orders", "lifecycle", "approve"))):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("completed",), "close it")
    wo.status = "closed"
    wo.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, _perm)


@router.post("/{wo_id}/cancel", response_model=ProductionWorkOrderResponse)
async def cancel_work_order(wo_id: int, payload: ProductionWorkOrderCancelPayload, db: Session = Depends(get_db), _perm: User = Depends(require_feature_action("production", "work_orders", "lifecycle", "cancel"))):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EDITABLE_STATUSES, "cancel it")
    if wo.status == "draft":
        ensure_not_pending(db, WO_ENTITY, wo.id, f"The release of {wo.wo_number}", "cancelled")
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
    return _to_response(db, wo, _perm)


# ---------------------------------------------------------------------------
# Store integration — material issue / return, finished-goods receipt
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/issue-materials", response_model=ProductionWorkOrderResponse)
async def issue_materials(
    wo_id: int,
    payload: ProductionWorkOrderIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "materials", "create")),
):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "issue material to it")
    location_id = payload.location_id or wo.source_location_id
    issue_location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first() if location_id else None
    if not issue_location:
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
            # Project stock (Store): use what is held for this WO's vehicle / lot,
            # respect what is held for other elements (409, or a Store Manager
            # override with a reason).
            secure_issue_qty(db, item_id=line.item_id, location_id=location_id, qty=line.quantity,
                             element_id=wo.order_project_element_id, user=user, location=issue_location,
                             override_reason=payload.project_stock_override_reason, document=f"work order {wo.wo_number}")
            txn = post_stock_transaction(
                db, item_id=line.item_id, location_id=location_id, transaction_type="issue", quantity=line.quantity,
                batch_number=line.batch_number, reference_type=WORK_ORDER_REFERENCE_TYPE, reference_number=wo.wo_number,
                transaction_date=date.today(), remarks=payload.remarks or f"Issued to work order {wo.wo_number}",
                created_by_id=user.id,
            )
            # Charge the order at the rate the stock left Store (CO line item).
            costing.record_material_issue(db, wo, txn, line.quantity, user.id)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't issue {_item_label(db, line.item_id)}: {e}")
        except HTTPException:
            db.rollback()
            raise
        material.issued_qty = round(material.issued_qty + line.quantity, 4)

    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


@router.post("/{wo_id}/reserve-materials", response_model=ProductionWorkOrderResponse)
async def reserve_work_order_materials(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "materials", "create")),
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
    return _to_response(db, wo, user)


@router.post("/{wo_id}/return-materials", response_model=ProductionWorkOrderResponse)
async def return_materials(
    wo_id: int,
    payload: ProductionWorkOrderIssuePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "materials", "edit")),
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
        # A return credits the order (and goes back into Store) at the rate
        # the order was charged for the item, not at today's average.
        rate, rate_source = costing.return_rate(db, wo, line.item_id)
        try:
            txn = post_stock_transaction(
                db, item_id=line.item_id, location_id=location_id, transaction_type="return_in", quantity=line.quantity,
                batch_number=line.batch_number, reference_type=WORK_ORDER_REFERENCE_TYPE, reference_number=wo.wo_number,
                transaction_date=date.today(), remarks=payload.remarks or f"Returned unused from work order {wo.wo_number}",
                created_by_id=user.id, unit_cost=rate if rate > 0 else None, cost_source="issue_rate" if rate > 0 else None,
            )
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't return {_item_label(db, line.item_id)} to Store: {e}")
        costing.record_material_return(db, wo, txn, line.quantity, rate, rate_source, user.id)
        material.returned_qty = round(material.returned_qty + line.quantity, 4)

    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


@router.post("/{wo_id}/receive-output", response_model=ProductionWorkOrderResponse)
async def receive_output(
    wo_id: int,
    payload: ProductionWorkOrderReceivePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "output", "create")),
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
    ungated = [f"{op.sequence} {op.operation_name}" for op in wo.operations
               if op.requires_inspection and not production_gates.gate_state(db, op).passed]
    if ungated:
        raise HTTPException(
            status_code=409,
            detail=f"Quality hasn't accepted the in-process inspection for operation(s) {', '.join(ungated)} yet. "
                   "Request the inspection from the Operations tab and have Quality make the usage decision before receiving output.",
        )

    # GR 101 at actual cost: the receipt carries its share of what the order
    # has actually consumed (material issued net of returns + labour booked),
    # not the product's current average. The receipt that completes the
    # order takes all of the remaining cost, so nothing stays as WIP.
    unit_cost, receipt_value = costing.receipt_cost(db, wo, payload.quantity)
    priced = unit_cost if unit_cost > 0 else None
    if needs_inspection_on_receipt(db, product, "final"):
        # Final inspection: FG goes to QUALITY stock under a final inspection
        # lot; the lot's usage decision releases it to FREE (or BLOCKED + NCR).
        try:
            lot = create_lot_for_production_output(
                db, work_order=wo, item=product, quantity=payload.quantity, location_id=location_id,
                batch_number=payload.batch_number or wo.wo_number, user_id=user.id, unit_cost=priced,
            )
        except LotError as e:
            raise HTTPException(status_code=e.status, detail=str(e))
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't receive {wo.wo_number}'s output into Quality stock: {e}")
        txn = db.query(StoreStockTransaction).filter(
            StoreStockTransaction.reference_type == LOT_REFERENCE_TYPE, StoreStockTransaction.reference_number == lot.lot_number,
            StoreStockTransaction.transaction_type == "quality_in",
        ).order_by(StoreStockTransaction.id.desc()).first()
    else:
        try:
            txn = post_stock_transaction(
                db, item_id=wo.product_item_id, location_id=location_id, transaction_type="receipt", quantity=payload.quantity,
                batch_number=payload.batch_number or wo.wo_number, reference_type=WORK_ORDER_REFERENCE_TYPE,
                reference_number=wo.wo_number, transaction_date=date.today(),
                remarks=payload.remarks or f"Finished goods from work order {wo.wo_number}", created_by_id=user.id,
                unit_cost=priced, cost_source=costing.PRODUCTION_ACTUAL_COST_SOURCE if priced else None,
            )
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Can't receive {wo.wo_number}'s output into Store: {e}")
    if receipt_value > 0:
        costing.record_goods_receipt(db, wo, txn, payload.quantity, receipt_value, user.id)
    wo.quantity_completed = round(wo.quantity_completed + payload.quantity, 4)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


@router.get("/{wo_id}/stock-movements", response_model=list[ProductionStockMovementResponse])
async def list_stock_movements(
    wo_id: int,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "work_orders", "output", "view")),
):
    wo = _get_or_404(db, wo_id)
    # Inspection-controlled output is received into Quality stock under a
    # final-inspection lot, so its ledger rows reference the lot, not the WO.
    lot_numbers = [n for (n,) in db.query(QualityInspectionLot.lot_number).filter(
        QualityInspectionLot.source_type == "work_order", QualityInspectionLot.source_id == wo.id,
    ).all()]
    match = (StoreStockTransaction.reference_type == WORK_ORDER_REFERENCE_TYPE) & (StoreStockTransaction.reference_number == wo.wo_number)
    if lot_numbers:
        match = match | ((StoreStockTransaction.reference_type == LOT_REFERENCE_TYPE) & StoreStockTransaction.reference_number.in_(lot_numbers))
    rows = db.query(StoreStockTransaction).filter(match).order_by(StoreStockTransaction.id.desc()).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.item_id for r in rows})).all()} if rows else {}
    locations = _names(db, StoreLocation, {r.location_id for r in rows}, lambda loc: f"{loc.code} — {loc.name}")
    users = _names(db, User, {r.created_by_id for r in rows}, lambda u: u.name or u.email)
    postings = {p.stock_transaction_id: p for p in db.query(ProductionOrderCostPosting).filter(
        ProductionOrderCostPosting.work_order_id == wo.id, ProductionOrderCostPosting.stock_transaction_id.isnot(None),
    ).all()}
    out = [
        ProductionStockMovementResponse(
            id=r.id, transaction_type=r.transaction_type, item_id=r.item_id,
            item_code=items[r.item_id].item_code if r.item_id in items else None,
            item_name=items[r.item_id].item_name if r.item_id in items else None,
            location_name=locations.get(r.location_id), quantity=r.quantity, batch_number=r.batch_number,
            transaction_date=r.transaction_date, remarks=r.remarks, created_by_name=users.get(r.created_by_id),
            order_unit_cost=postings[r.id].unit_cost if r.id in postings else None,
            order_value=postings[r.id].amount if r.id in postings else None,
        )
        for r in rows
    ]
    if not sees_costs(_tab, "work_orders"):
        for m in out:
            mask_movement(m)
    return out


@router.get("/{wo_id}/job-card")
async def download_job_card(
    wo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "job_card", "print")),
):
    """Printable A4 traveler for the shop floor: pick list + routing with
    blank columns for operators to fill in by hand."""
    resp = _to_response(db, _get_or_404(db, wo_id), user)
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
            # Control key "print" off: the step isn't on the traveller.
            "operations": [
                {"sequence": o.sequence, "name": o.operation_name + (" [EXTERNAL]" if o.control_key == "external" else ""),
                 "workstation": (f"Job work: {o.vendor_name}" if o.control_key == "external" else o.workstation_name),
                 "planned_hours": o.planned_hours, "quality_gate": o.requires_inspection, "instructions": o.instructions}
                for o in resp.operations if o.print_on_job_card
            ],
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Couldn't build the job card PDF: {e}")
    return Response(
        content=pdf.getvalue(), media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="Job-Card-{resp.wo_number}.pdf"'},
    )


@router.get("/{wo_id}/costing", response_model=ProductionWorkOrderCostingResponse)
async def get_costing(
    wo_id: int,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "work_orders", "costs", "view")),
):
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
    held = production_gates.start_problem(db, wo, op) or routing_control.start_problem(db, wo, op)
    if held:
        raise HTTPException(status_code=409, detail=held)
    ensure_workstation_available(db, op)
    op.status = "in_progress"
    op.started_at = datetime.now(timezone.utc)
    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, _perm)


@router.post("/{wo_id}/operations/{op_id}/complete", response_model=ProductionWorkOrderResponse)
async def complete_operation(wo_id: int, op_id: int, payload: ProductionOperationCompletePayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_RUN_FLOOR)):
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, _EXECUTING_STATUSES, "complete its operations")
    op = _get_operation(wo, op_id)
    if op.status == "completed":
        raise HTTPException(status_code=409, detail=f"Operation {op.sequence} {op.operation_name} is already completed.")
    if op.status == "pending":
        # Completing straight from pending also starts the step, so the same
        # hold behind an earlier undecided/rejected quality gate applies.
        held = production_gates.start_problem(db, wo, op)
        if held:
            raise HTTPException(status_code=409, detail=held)
    gate_problem = production_gates.completion_problem(db, op) or routing_control.completion_problem(db, wo, op, payload.no_yield_reason)
    if gate_problem:
        raise HTTPException(status_code=409, detail=gate_problem)
    routing_control.on_complete(wo, op, payload.no_yield_reason)
    if op.started_at is None:
        op.started_at = datetime.now(timezone.utc)
    op.status = "completed"
    op.completed_at = datetime.now(timezone.utc)
    if payload.remarks:
        op.remarks = payload.remarks
    mark_started(wo)
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, _perm)


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
    # Phase 2: the gate is an in-process inspection lot (Quality → Inspection
    # Lots / My Inspections notifies the inspectors). Next operation is held
    # until the lot is decided.
    try:
        production_gates.request_gate_lot(db, wo, op, user)
    except (production_gates.GateError, LotError) as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)


# ---------------------------------------------------------------------------
# CA01 external operations, CS11 dependent orders, CC01 change flags
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/operations/{op_id}/job-work", response_model=ProductionWorkOrderResponse)
async def link_operation_job_work(
    wo_id: int, op_id: int, payload: ProductionOperationJobWorkPayload,
    db: Session = Depends(get_db), _perm: User = Depends(require_feature_action("production", "shop_floor", "job_work", "edit")),
):
    """Ties an external (subcontracted) step to the Store job-work challan its
    material went out on. The step can start once linked and be confirmed
    once the material is back (Material Return / Job Work Receipt)."""
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("draft", *_EXECUTING_STATUSES), "link job work to it")
    op = _get_operation(wo, op_id)
    try:
        routing_control.link_job_work(db, wo, op, payload.issue_id)
    except routing_control.RoutingError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, _perm)


@router.post("/{wo_id}/sub-orders", response_model=list[ProductionDependentOrder])
async def create_sub_orders(
    wo_id: int, payload: ProductionSubOrdersPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(require_feature_action("production", "work_orders", "sub_orders", "create")),
):
    """CS11 -> CO01: draft dependent work orders for every make item
    (sub-assembly with its own valid BOM) in this order's tree."""
    wo = _get_or_404(db, wo_id, lock=True)
    _require_status(wo, ("draft", *_EXECUTING_STATUSES), "explode sub-assemblies for it")
    created = explosion.create_dependent_orders(db, wo, user, payload.levels, payload.net_free_stock)
    if not created and not explosion.dependent_tree(db, wo):
        db.rollback()
        raise HTTPException(status_code=409, detail=f"{wo.wo_number} has no sub-assemblies to build: no component of its BOM has its own active "
                                                    "Production BOM (or free stock already covers them). Buy items are planned by MRP / reorder.")
    db.commit()
    return _dependents(db, wo)


def _dependents(db: Session, wo: ProductionWorkOrder) -> list[ProductionDependentOrder]:
    tree = explosion.dependent_tree(db, wo)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({c.product_item_id for _, c in tree})).all()} if tree else {}
    return [ProductionDependentOrder(
        id=c.id, wo_number=c.wo_number, product_item_id=c.product_item_id,
        product_code=items[c.product_item_id].item_code if c.product_item_id in items else None,
        product_name=items[c.product_item_id].item_name if c.product_item_id in items else None,
        quantity_planned=c.quantity_planned, status=c.status, level=level, parent_work_order_id=c.parent_work_order_id,
    ) for level, c in tree]


@router.get("/{wo_id}/dependents", response_model=list[ProductionDependentOrder])
async def list_dependents(
    wo_id: int, db: Session = Depends(get_db),
    _tab: User = Depends(require_feature_action("production", "work_orders", "sub_orders", "view")),
):
    return _dependents(db, _get_or_404(db, wo_id))


@router.post("/{wo_id}/clear-change-flag", response_model=ProductionWorkOrderResponse)
async def clear_change_flag(
    wo_id: int, payload: ProductionChangeFlagClearPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    """Production records what it did about an engineering change on this
    open order (rework / use-up / re-raise) and clears the flag."""
    wo = _get_or_404(db, wo_id, lock=True)
    if not wo.change_flag or wo.change_flag_cleared_at:
        raise HTTPException(status_code=409, detail=f"{wo.wo_number} has no open engineering-change flag to clear.")
    wo.change_flag_cleared_at = datetime.now(timezone.utc)
    wo.change_flag_cleared_by_id = user.id
    wo.change_flag_resolution = payload.resolution.strip()
    db.commit()
    db.refresh(wo)
    return _to_response(db, wo, user)
