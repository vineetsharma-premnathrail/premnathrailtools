"""MRP (SAP PP-MRP) endpoints — /production/mrp.

  POST   /run                                MD01N run for a plant (run log in the response)
  GET    /runs, /runs/{id}                   run log / MD05 MRP list (per-item results)
  GET    /exceptions                         MD06 collective exception list
  GET    /parameters                         the coded MRP parameters
  GET    /stock-requirements/{item_id}       MD04 stock / requirements list (live)
  GET    /planned-orders                     planned orders
  POST   /planned-orders                     MD11 create (manual, firmed)
  PATCH  /planned-orders/{id}                MD12 change / firm / unfirm
  DELETE /planned-orders/{id}                delete an open planned order
  POST   /planned-orders/{id}/convert-to-work-order   make → draft work order (create_work_order)
  POST   /planned-orders/convert-to-requisition       buy → PR lines with store_item_id (create_p2p_request)

Access: Production › Planning — 'view' to read, 'create' for MD11,
'edit' to run MRP, change, firm, delete and convert. Converting also needs
the target document's own permission (Work Orders › Create, or Procurement ›
Purchase Requisitions › Create)."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action, require_app_access, require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.production import mrp as engine
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.mrp import (
    MRP_EXCEPTION_LABELS, PLANNED_ORDER_PROCUREMENT, ProductionMrpException, ProductionMrpRun, ProductionPlannedOrder,
)
from app.modules.production.schemas.mrp import (
    ProductionMrpExceptionResponse, ProductionMrpRunCreate, ProductionMrpRunDetail, ProductionMrpRunResponse,
    ProductionPlannedOrderBulkPayload, ProductionPlannedOrderConvertPrPayload, ProductionPlannedOrderConvertWoPayload,
    ProductionPlannedOrderCreate, ProductionPlannedOrderResponse, ProductionPlannedOrderUpdate,
)
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/production/mrp", tags=["Production"], dependencies=[Depends(require_app_access("production"))])

_CAN_VIEW = require_tab_access("production", "planning")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _raise(exc: engine.MrpError):
    raise HTTPException(status_code=exc.status_code, detail=exc.message)


def _branch_names(db: Session, ids: set) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {b.id: f"{b.code} — {b.name}" for b in db.query(Branch).filter(Branch.id.in_(ids)).all()} if ids else {}


def _user_names(db: Session, ids: set) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


# P2P category suggested from the Item Master (the requester can override it).
_CATEGORY_RULES = (
    ("ELE", ("electric", "cable", "wire", "plc", "sensor", "motor", "panel")),
    ("PNH", ("hydraul", "pneumat", "cylinder", "valve", "hose")),
    ("JOB", ("job work", "jobwork")),
    ("HWC", ("hardware", "consum", "fastener", "bolt", "nut", "washer")),
    ("RAW", ("raw", "steel", "plate", "sheet", "bar", "pipe", "casting", "forging")),
)


def suggest_category(item: StoreItem | None) -> str:
    text = " ".join(filter(None, (item.category, item.subcategory, item.item_type))).lower().replace("_", " ") if item else ""
    for code, words in _CATEGORY_RULES:
        if any(w in text for w in words):
            return code
    return "OTH"


def _po_responses(db: Session, orders: list[ProductionPlannedOrder]) -> list[ProductionPlannedOrderResponse]:
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.item_id for o in orders} or {-1})).all()}
    boms = {b.id: b.bom_number for b in db.query(ProductionBom).filter(ProductionBom.id.in_({o.bom_id for o in orders if o.bom_id} or {-1})).all()}
    runs = {r.id: r.run_number for r in db.query(ProductionMrpRun).filter(ProductionMrpRun.id.in_({o.run_id for o in orders if o.run_id} or {-1})).all()}
    parents = {p.id: p.order_number for p in db.query(ProductionPlannedOrder).filter(
        ProductionPlannedOrder.id.in_({o.parent_planned_order_id for o in orders if o.parent_planned_order_id} or {-1})).all()}
    branches = _branch_names(db, {o.branch_id for o in orders})
    from app.modules.production.order_project_links import element_labels, project_labels
    op_labels = element_labels(db, {o.order_project_element_id for o in orders})
    # Project-level orders (a project without units): the project itself.
    proj_only = project_labels(db, {o.order_project_id for o in orders if o.order_project_id and not o.order_project_element_id})
    today = date.today()
    out = []
    for o in orders:
        r = ProductionPlannedOrderResponse.model_validate(o)
        item = items.get(o.item_id)
        r.item_code, r.item_name, r.uom = (item.item_code, item.item_name, item.uom) if item else (None, None, None)
        r.bom_number = boms.get(o.bom_id)
        r.run_number = runs.get(o.run_id)
        r.parent_order_number = parents.get(o.parent_planned_order_id)
        r.branch_name = branches.get(o.branch_id)
        r.start_in_past = o.status == "open" and o.start_date < today
        r.suggested_category_code = suggest_category(item) if o.procurement == "buy" else None
        r.order_project_label = (op_labels[o.order_project_element_id][0] if o.order_project_element_id in op_labels
                                 else proj_only.get(o.order_project_id) if not o.order_project_element_id else None)
        out.append(r)
    return out


def _run_response(db: Session, run: ProductionMrpRun, detail: bool = False):
    cls = ProductionMrpRunDetail if detail else ProductionMrpRunResponse
    r = cls.model_validate(run)
    r.branch_name = _branch_names(db, {run.branch_id}).get(run.branch_id) if run.branch_id else "Company-wide"
    r.run_by_name = _user_names(db, {run.run_by_id}).get(run.run_by_id)
    return r


def _get_order(db: Session, po_id: int, lock: bool = False) -> ProductionPlannedOrder:
    q = db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.id == po_id)
    if lock:
        q = q.with_for_update()
    po = q.first()
    if not po or po.status == "deleted":
        raise HTTPException(status_code=404, detail=f"Planned order #{po_id} not found — it may have been deleted by a later MRP run (only firmed orders survive a re-run).")
    return po


def _require_open(po: ProductionPlannedOrder, action: str) -> None:
    if po.status != "open":
        raise HTTPException(status_code=409, detail=f"Planned order {po.order_number} was already converted to {po.converted_number or 'a document'}, so it can't be {action}.")


def _validate_branch(db: Session, branch_id: int | None) -> None:
    if branch_id and not db.query(Branch).filter(Branch.id == branch_id).first():
        raise HTTPException(status_code=404, detail=f"Plant #{branch_id} not found in Organization › Branches.")


# ---------------------------------------------------------------------------
# Run (MD01N) / run log / MRP list / exceptions
# ---------------------------------------------------------------------------

@router.get("/parameters")
async def get_parameters(_user: User = Depends(_CAN_VIEW)):
    return {"parameters": engine.MRP_PARAMETERS, "overridable": list(engine.RUN_OVERRIDABLE), "exception_labels": MRP_EXCEPTION_LABELS}


@router.post("/run", response_model=ProductionMrpRunDetail)
async def run_mrp(payload: ProductionMrpRunCreate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "mrp_run", "edit"))):
    _validate_branch(db, payload.branch_id)
    include_unassigned = payload.include_unassigned
    if include_unassigned is None:
        include_unassigned = db.query(Branch).filter(Branch.status == "active").count() <= 1
    try:
        run = engine.run_mrp(db, branch_id=payload.branch_id, include_unassigned=include_unassigned, user_id=user.id,
                             overrides={"planning_horizon_days": payload.planning_horizon_days,
                                        "include_draft_work_orders": payload.include_draft_work_orders})
        db.commit()
    except engine.MrpError as exc:
        db.rollback()
        _raise(exc)
    db.refresh(run)
    return _run_response(db, run, detail=True)


@router.get("/runs", response_model=list[ProductionMrpRunResponse])
async def list_runs(branch_id: int | None = None, limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db),
                    _user: User = Depends(_CAN_VIEW)):
    q = db.query(ProductionMrpRun)
    if branch_id:
        q = q.filter(ProductionMrpRun.branch_id == branch_id)
    return [_run_response(db, r) for r in q.order_by(ProductionMrpRun.id.desc()).limit(limit).all()]


@router.get("/runs/{run_id}", response_model=ProductionMrpRunDetail)
async def get_run(run_id: int, db: Session = Depends(get_db), _user: User = Depends(_CAN_VIEW)):
    run = db.get(ProductionMrpRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"MRP run #{run_id} not found.")
    return _run_response(db, run, detail=True)


@router.get("/exceptions", response_model=list[ProductionMrpExceptionResponse])
async def list_exceptions(
    run_id: int | None = None, code: str | None = None, item_id: int | None = None, branch_id: int | None = None,
    db: Session = Depends(get_db), _user: User = Depends(_CAN_VIEW),
):
    """MD06. Without run_id: the latest completed run (of the plant, when given)."""
    if code and code not in MRP_EXCEPTION_LABELS:
        raise HTTPException(status_code=400, detail=f"Unknown exception code '{code}'. Use one of: {', '.join(MRP_EXCEPTION_LABELS)}.")
    if run_id is None:
        q = db.query(ProductionMrpRun).filter(ProductionMrpRun.status == "completed")
        if branch_id:
            q = q.filter(ProductionMrpRun.branch_id == branch_id)
        last = q.order_by(ProductionMrpRun.id.desc()).first()
        if not last:
            return []
        run_id = last.id
    q = db.query(ProductionMrpException).filter(ProductionMrpException.run_id == run_id)
    if code:
        q = q.filter(ProductionMrpException.code == code)
    if item_id:
        q = q.filter(ProductionMrpException.item_id == item_id)
    rows = q.order_by(ProductionMrpException.id).all()
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.item_id for r in rows if r.item_id} or {-1})).all()}
    run_no = db.query(ProductionMrpRun.run_number).filter(ProductionMrpRun.id == run_id).scalar()
    out = []
    for r in rows:
        resp = ProductionMrpExceptionResponse.model_validate(r)
        resp.label = MRP_EXCEPTION_LABELS.get(r.code, r.code)
        item = items.get(r.item_id)
        resp.item_code, resp.item_name = (item.item_code, item.item_name) if item else (None, None)
        resp.run_number = run_no
        out.append(resp)
    return out


# ---------------------------------------------------------------------------
# MD04
# ---------------------------------------------------------------------------

@router.get("/stock-requirements/{item_id}")
async def stock_requirements(item_id: int, branch_id: int | None = None, include_unassigned: bool = True,
                             db: Session = Depends(get_db), _user: User = Depends(_CAN_VIEW)):
    item = db.get(StoreItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{item_id} not found in the Item Master.")
    _validate_branch(db, branch_id)
    return engine.stock_requirements(db, item, engine.Scope(branch_id, include_unassigned))


# ---------------------------------------------------------------------------
# Planned orders (MD11-MD13)
# ---------------------------------------------------------------------------

@router.get("/planned-orders", response_model=list[ProductionPlannedOrderResponse])
async def list_planned_orders(
    status: str | None = Query("open"), procurement: str | None = None, branch_id: int | None = None,
    item_id: int | None = None, run_id: int | None = None, firmed: bool | None = None, search: str | None = None,
    db: Session = Depends(get_db), _user: User = Depends(_CAN_VIEW),
):
    q = db.query(ProductionPlannedOrder)
    if status and status != "all":
        q = q.filter(ProductionPlannedOrder.status == status)
    elif status == "all":
        q = q.filter(ProductionPlannedOrder.status != "deleted")
    if procurement:
        if procurement not in PLANNED_ORDER_PROCUREMENT:
            raise HTTPException(status_code=400, detail="Procurement filter must be 'make' or 'buy'.")
        q = q.filter(ProductionPlannedOrder.procurement == procurement)
    if branch_id:
        q = q.filter(ProductionPlannedOrder.branch_id == branch_id)
    if item_id:
        q = q.filter(ProductionPlannedOrder.item_id == item_id)
    if run_id:
        q = q.filter(ProductionPlannedOrder.run_id == run_id)
    if firmed is not None:
        q = q.filter(ProductionPlannedOrder.firmed == firmed)
    if search:
        like = f"%{search}%"
        q = q.join(StoreItem, StoreItem.id == ProductionPlannedOrder.item_id).filter(
            ProductionPlannedOrder.order_number.ilike(like) | StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like)
            | ProductionPlannedOrder.demand_label.ilike(like))
    return _po_responses(db, q.order_by(ProductionPlannedOrder.start_date, ProductionPlannedOrder.order_number).limit(2000).all())


@router.post("/planned-orders", response_model=ProductionPlannedOrderResponse)
async def create_planned_order(payload: ProductionPlannedOrderCreate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "planned_orders", "create"))):
    item = db.get(StoreItem, payload.item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Item #{payload.item_id} not found in the Item Master.")
    if item.status != "active":
        raise HTTPException(status_code=409, detail=f"{item.item_code} is {item.status} in the Item Master — reactivate it before planning it.")
    _validate_branch(db, payload.branch_id)
    bom = engine.active_boms(db).get(item.id)
    procurement = payload.procurement or ("make" if bom else "buy")
    if procurement not in PLANNED_ORDER_PROCUREMENT:
        raise HTTPException(status_code=400, detail="Procurement must be 'make' or 'buy'.")
    if procurement == "make" and not bom:
        raise HTTPException(status_code=409, detail=f"{item.item_code} has no active Production BOM, so it can't be planned as 'make' — activate a BOM in BOM & Routing or plan it as 'buy'.")
    start = payload.start_date or (payload.finish_date - timedelta(
        days=engine.lead_days(item, bom if procurement == "make" else None, payload.quantity, engine.MRP_PARAMETERS)))
    if start > payload.finish_date:
        raise HTTPException(status_code=400, detail=f"Start date ({start:%d-%m-%Y}) is after the finish date ({payload.finish_date:%d-%m-%Y}).")
    po = ProductionPlannedOrder(
        order_number=engine.planned_order_series(db).next(), source="manual", branch_id=payload.branch_id, item_id=item.id,
        procurement=procurement, bom_id=bom.id if procurement == "make" else None, quantity=payload.quantity,
        start_date=start, finish_date=payload.finish_date, firmed=True, status="open", demand_type="manual",
        demand_label="Manual planned order", created_by_id=user.id, remarks=payload.remarks,
    )
    db.add(po)
    db.commit()
    db.refresh(po)
    return _po_responses(db, [po])[0]


@router.patch("/planned-orders/{po_id}", response_model=ProductionPlannedOrderResponse)
async def update_planned_order(po_id: int, payload: ProductionPlannedOrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "planned_orders", "edit"))):
    po = _get_order(db, po_id, lock=True)
    _require_open(po, "changed")
    data = payload.model_dump(exclude_unset=True)
    start = data.get("start_date") or po.start_date
    finish = data.get("finish_date") or po.finish_date
    if start > finish:
        raise HTTPException(status_code=400, detail=f"Start date ({start:%d-%m-%Y}) is after the finish date ({finish:%d-%m-%Y}).")
    changed = any(k in data and data[k] is not None and data[k] != getattr(po, k) for k in ("quantity", "start_date", "finish_date"))
    for key in ("quantity", "start_date", "finish_date", "remarks"):
        if key in data and (data[key] is not None or key == "remarks"):
            setattr(po, key, data[key])
    if "firmed" in data and data["firmed"] is not None:
        po.firmed = data["firmed"]
    elif changed:
        po.firmed = True  # a planner's change is kept by the next run (SAP firming indicator)
    po.changed_by_id = user.id
    db.commit()
    db.refresh(po)
    return _po_responses(db, [po])[0]


@router.post("/planned-orders/firm", response_model=list[ProductionPlannedOrderResponse])
async def firm_planned_orders(payload: ProductionPlannedOrderBulkPayload, db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "planned_orders", "edit"))):
    orders = db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.id.in_(payload.planned_order_ids),
                                                     ProductionPlannedOrder.status == "open").all()
    for po in orders:
        po.firmed, po.changed_by_id = True, user.id
    db.commit()
    return _po_responses(db, orders)


@router.delete("/planned-orders/{po_id}")
async def delete_planned_order(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "planned_orders", "delete"))):
    po = _get_order(db, po_id, lock=True)
    _require_open(po, "deleted")
    number = po.order_number
    po.status, po.changed_by_id = "deleted", user.id
    po.remarks = ((po.remarks + " ") if po.remarks else "") + f"Deleted by {user.name or user.email}."
    db.commit()
    return {"message": f"Planned order {number} deleted."}


@router.post("/planned-orders/{po_id}/convert-to-work-order", response_model=ProductionPlannedOrderResponse)
async def convert_to_work_order(po_id: int, payload: ProductionPlannedOrderConvertWoPayload, db: Session = Depends(get_db),
                                user: User = Depends(require_feature_action("production", "planning", "convert_wo", "create"))):
    """Make planned order → draft work order through create_work_order (its
    BOM / component / RRV-link validation), carrying plant, dates, machine
    and RRV build."""
    from app.modules.production.routes.work_orders import create_work_order
    from app.modules.production.schemas.work_order import ProductionWorkOrderCreate

    ensure_tab_action(user, "production", "work_orders", "create")
    po = _get_order(db, po_id, lock=True)
    _require_open(po, "converted")
    if po.procurement != "make":
        raise HTTPException(status_code=409, detail=f"Planned order {po.order_number} is a 'buy' order — convert it to a purchase requisition instead.")
    bom = db.get(ProductionBom, po.bom_id) if po.bom_id else None
    if bom is None or bom.status != "active" or bom.is_deleted:
        bom = engine.active_boms(db).get(po.item_id)
    if bom is None:
        raise HTTPException(status_code=409, detail=f"Planned order {po.order_number}: the item no longer has an active Production BOM — activate one in BOM & Routing, then convert.")
    build_role = None
    if po.rrv_build_id:
        build_role = "main" if po.demand_type == "rrv_build" and po.parent_planned_order_id is None else "sub_assembly"
    po.status, po.converted_type = "converted", "work_order"
    po.converted_at, po.converted_by_id = datetime.now(timezone.utc), user.id
    db.flush()
    wo_payload = ProductionWorkOrderCreate(
        bom_id=bom.id, quantity_planned=po.quantity, erp_project_id=po.erp_project_id, branch_id=po.branch_id,
        priority=payload.priority, source_location_id=payload.source_location_id, target_location_id=payload.target_location_id,
        planned_start_date=po.start_date, planned_end_date=po.finish_date, supervisor_id=payload.supervisor_id,
        remarks=f"From planned order {po.order_number}" + (f" — {po.demand_label}" if po.demand_label else "") + ".",
        rrv_build_id=po.rrv_build_id, build_role=build_role,
        order_project_element_id=po.order_project_element_id if not po.rrv_build_id else None,
        # A planned order of a project without units links its work order to the project itself.
        order_project_id=_unitless_project_id(db, po),
    )
    try:
        wo = await create_work_order(payload=wo_payload, db=db, user=user, _perm=user)
    except HTTPException:
        db.rollback()
        raise
    po = _get_order(db, po_id)
    po.converted_ref_id, po.converted_number = wo.id, wo.wo_number
    db.commit()
    db.refresh(po)
    return _po_responses(db, [po])[0]


def _unitless_project_id(db: Session, po: ProductionPlannedOrder) -> int | None:
    """The project to link a converted work order to: only a planned order that is linked at project
    level (no unit, no build) to a project WITHOUT units. A build's work orders follow the build."""
    if po.rrv_build_id or po.order_project_element_id or not po.order_project_id:
        return None
    from app.modules.projects import so_projects as op_core
    return None if op_core.project_has_units(db, po.order_project_id) else po.order_project_id


def _po_element_id(db: Session, po: ProductionPlannedOrder) -> int | None:
    """The project unit of a planned order's demand: carried by MRP,
    else the vehicle / lot of its pegged (historic) Sales delivery row. None for demand
    of a project without units — see _po_project_id."""
    if po.order_project_element_id:
        return po.order_project_element_id
    if po.sales_schedule_id:
        from app.modules.store.services.project_stock import element_for_schedule_row
        el = element_for_schedule_row(db, po.sales_schedule_id)
        return el.id if el is not None else None
    return None


def _po_project_id(db: Session, po: ProductionPlannedOrder, element_id: int | None) -> int | None:
    """The PM project a planned order's demand belongs to: its unit's project, else the project the
    order (or its RRV build) is linked to. A project WITHOUT units is linked at project level — one
    project = one machine, so the PR needs no vehicle / lot."""
    if element_id:
        from app.modules.projects.models.element import PmProjectElement
        el = db.get(PmProjectElement, element_id)
        return el.project_id if el is not None else None
    if po.order_project_id:
        return po.order_project_id
    if po.rrv_build_id:
        from app.modules.production.models.rrv_build import ProductionRrvBuild
        build = db.get(ProductionRrvBuild, po.rrv_build_id)
        return build.order_project_id if build is not None else None
    return None


def _project_label(db: Session, po: ProductionPlannedOrder) -> tuple[str, bool]:
    """PR project label for a planned order's pegged demand, and whether the
    line is for a project (vs in-house stock)."""
    from app.modules.erp.models.project import Project
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.sales.models.order import SalesOrder

    if po.sales_order_id:
        so = db.get(SalesOrder, po.sales_order_id)
        if so:
            return (so.display_number + (f" — {so.customer_name}" if so.customer_name else ""))[:200], True
    if po.rrv_build_id:
        b = db.get(ProductionRrvBuild, po.rrv_build_id)
        if b:
            return f"{b.build_number} — {b.rrv_model}"[:200], True
    if po.erp_project_id:
        p = db.get(Project, po.erp_project_id)
        if p:
            return (p.serial_number + (f" — {p.model_name}" if p.model_name else ""))[:200], True
    if po.work_order_id:
        wo = db.get(ProductionWorkOrder, po.work_order_id)
        if wo:
            return f"Work order {wo.wo_number}", True
    return "Stock replenishment (MRP)", False


@router.post("/planned-orders/convert-to-requisition")
async def convert_to_requisition(payload: ProductionPlannedOrderConvertPrPayload, background_tasks: BackgroundTasks,
                                 db: Session = Depends(get_db), user: User = Depends(require_feature_action("production", "planning", "convert_pr", "create"))):
    """Buy planned orders → purchase requisitions through the P2P create
    service (create_p2p_request: Item Master lines by store_item_id, approval
    engine, auto buyer). One PR per category and pegged project; the same
    item's planned orders in a group become one line."""
    from app.core.priority import parse_priority
    from app.modules.p2p.models.p2p_request import P2P_CATEGORIES
    from app.modules.p2p.routes.p2p_requests import create_p2p_request
    from app.modules.p2p.schemas.p2p_request import P2PRequestCreate, P2PRequestItemPayload

    if "p2p" not in user.get_apps():
        raise HTTPException(status_code=403, detail="Converting to a purchase requisition raises a PR in Procurement, and you have no access to the "
                                                    "Procurement (P2P) module — ask an admin for Procurement › Purchase Requisitions › Create.")
    ensure_tab_action(user, "p2p", "purchase_requisitions", "create")
    if payload.category_code and payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Pick a valid PR category ({', '.join(P2P_CATEGORIES)}) — got '{payload.category_code}'.")
    payload.priority = parse_priority(payload.priority)
    ids = list(dict.fromkeys(payload.planned_order_ids))
    orders = db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.id.in_(ids)).all()
    orders = [o for o in orders if o.status != "deleted"]
    found = {o.id for o in orders}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Planned order(s) #{', #'.join(map(str, missing))} not found — a later MRP run may have deleted them. Reload the list.")
    for o in orders:
        _require_open(o, "converted")
        if o.procurement != "buy":
            raise HTTPException(status_code=409, detail=f"Planned order {o.order_number} is a 'make' order — convert it to a work order instead.")
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({o.item_id for o in orders})).all()}

    groups: dict[tuple, list[ProductionPlannedOrder]] = {}
    labels: dict[tuple, tuple[str, bool]] = {}
    for o in sorted(orders, key=lambda x: (x.finish_date, x.order_number)):
        cat = payload.category_code or suggest_category(items.get(o.item_id))
        label, for_project = _project_label(db, o)
        element_id = _po_element_id(db, o)
        # Project-level demand of a project without units groups by its project.
        project_id = _po_project_id(db, o, element_id)
        if element_id is None and project_id is not None:
            from app.modules.projects import so_projects as op_core
            if op_core.project_has_units(db, project_id):
                project_id = None  # a historic project's loose demand stays a plain project-less PR (as before)
        key = (cat, label, element_id, project_id if element_id is None else None)
        groups.setdefault(key, []).append(o)
        labels[key] = (label, for_project)

    created, errors = [], []
    today = date.today()
    from app.modules.projects.models.element import PmProjectElement
    for (cat, label, element_id, project_level_id), group in groups.items():
        for_project = labels[(cat, label, element_id, project_level_id)][1]
        qty_by_item: dict[int, float] = {}
        for o in group:
            qty_by_item[o.item_id] = qty_by_item.get(o.item_id, 0.0) + o.quantity
        numbers = [o.order_number for o in group]
        pr_payload = P2PRequestCreate(
            project_label=label, category_code=cat, required_date=max(min(o.finish_date for o in group), today),
            requirement_type="Material", priority=payload.priority, project_type="existing",
            remarks=(f"Raised from MRP planned order(s) {', '.join(numbers)}." + (f" {payload.remarks}" if payload.remarks else ""))[:2000],
            items=[P2PRequestItemPayload(store_item_id=item_id, quantity=round(q, 4), project_inhouse="Project" if for_project else "Inhouse",
                                         order_project_element_id=element_id)
                   for item_id, q in qty_by_item.items()],
            save_as_draft=payload.save_as_draft,
        )
        # Project-pegged demand: a project without units is charged as a whole (account assignment
        # "Project", lines tied to the project, no vehicle / lot). A historic sales-order project
        # keeps the sales-order assignment and names the unit on every line — Purchase's create
        # route validates the element against the project.
        el = db.get(PmProjectElement, element_id) if element_id else None
        if el is not None and el.project.sales_order_id:
            pr_payload.account_assignment = "sales_order"
            pr_payload.sales_order_id = el.project.sales_order_id
        elif el is not None:
            pr_payload.account_assignment = "order_project"
            pr_payload.order_project_id = el.project_id
        elif project_level_id is not None:
            pr_payload.account_assignment = "order_project"
            pr_payload.order_project_id = project_level_id
        ids_in_group = [o.id for o in group]
        now = datetime.now(timezone.utc)
        for o in group:
            o.status, o.converted_type, o.converted_at, o.converted_by_id = "converted", "purchase_requisition", now, user.id
        db.flush()
        try:
            pr = await create_p2p_request(payload=pr_payload, background_tasks=background_tasks, db=db, user=user)
        except HTTPException as exc:
            db.rollback()
            errors.append({"planned_orders": numbers, "category_code": cat, "project_label": label, "detail": exc.detail})
            continue
        for o in db.query(ProductionPlannedOrder).filter(ProductionPlannedOrder.id.in_(ids_in_group)).all():
            o.converted_ref_id, o.converted_number = pr.id, pr.p2p_number
        db.commit()
        created.append({"pr_id": pr.id, "p2p_number": pr.p2p_number, "status": pr.status, "category_code": cat,
                        "project_label": label, "planned_orders": numbers, "order_project_element_id": element_id,
                        "order_project_id": project_level_id})
    if errors and not created:
        detail = errors[0]["detail"]
        raise HTTPException(status_code=422, detail=f"No requisition was raised — {detail}" if isinstance(detail, str) else detail)
    return {"created": created, "errors": errors}
