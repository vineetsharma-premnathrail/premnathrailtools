"""Order Projects: the execution projects created from confirmed Sales Orders
(sales/order_projects.py). List / detail (the 360 view) / edit for Sales,
the admin backfill, and the cross-module lookup the department pickers use."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import scope_filter
from app.core.permission_registry import can_perform, is_admin_user
from app.core.permissions import require_any_app_access, require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales import order_projects as ops
from app.modules.sales import service as svc
from app.modules.sales.access import ensure_order
from app.modules.sales.models.order import SalesOrder
from app.modules.sales.models.order_project import OrderProject, OrderProjectElement, ORDER_PROJECT_STATUSES
from app.modules.sales.schemas.order_project import (
    OrderProjectElementResponse, OrderProjectLookupItem, OrderProjectResponse, OrderProjectUpdate,
)
from app.modules.sales.views import get_order, prices_hidden

router = APIRouter(prefix="/sales/order-projects", tags=["Sales"])
_SALES = Depends(require_app_access("sales"))
# Departments that link their work to an order project (pickers).
_LOOKUP_APPS = ("sales", "design", "p2p", "purchase", "store", "production", "quality")


def _scoped_query(db: Session, user: User):
    """Projects of orders in the user's Sales data scope, plus the ones they manage."""
    q = db.query(OrderProject).join(SalesOrder, SalesOrder.id == OrderProject.sales_order_id).filter(
        SalesOrder.is_deleted == False)  # noqa: E712
    expr = scope_filter(db, user, SalesOrder)
    if expr is not None:
        q = q.filter(or_(expr, OrderProject.project_manager_id == user.id))
    return q


def _load(db: Session, project_id: int, user: User) -> tuple[OrderProject, SalesOrder]:
    project = db.query(OrderProject).options(selectinload(OrderProject.elements)).filter(
        OrderProject.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail=f"Order project #{project_id} not found — open it again from "
                                                    f"Sales › Order Projects.")
    so = get_order(db, project.sales_order_id)
    if project.project_manager_id != user.id:
        ensure_order(db, user, so)
    return project, so


def _response(db: Session, project: OrderProject, so: SalesOrder, user: User, *, full: bool) -> OrderProjectResponse:
    resp = OrderProjectResponse.model_validate(project)
    names = svc.user_names(db, [project.project_manager_id, project.created_by_id])
    resp.project_manager_name = names.get(project.project_manager_id)
    resp.created_by_name = names.get(project.created_by_id)
    resp.so_number, resp.so_status = so.so_number, so.status
    resp.customer_po_number, resp.customer_po_date = so.customer_po_number, so.customer_po_date
    resp.currency = so.currency
    resp.order_value = None if prices_hidden(user) else float(so.grand_total or 0)
    live = [el for el in project.elements if el.status != "cancelled"]
    resp.vehicles_total = sum(1 for el in live if el.kind == "vehicle")
    resp.vehicles_delivered = sum(1 for el in live if el.kind == "vehicle" and el.status == "delivered")
    resp.lots_total = sum(1 for el in live if el.kind == "lot")
    edit = can_perform(user, "sales", "order_projects", "edit")
    resp.can = {"edit": edit, "backfill": is_admin_user(user)}
    if not full:
        return resp
    if project.branch_id:
        from app.modules.organization.models.branch import Branch
        resp.branch_name = db.query(Branch.name).filter(Branch.id == project.branch_id).scalar()
    lines = {ln.id: ln for ln in so.lines}
    rows = {r.id: r for r in so.schedules}
    elements = sorted(project.elements, key=lambda el: (el.status == "cancelled", el.element_no))
    cells = ops.department_cells(db, project, so, elements)
    out = []
    for el in elements:
        e = OrderProjectElementResponse.model_validate(el)
        ln = lines.get(el.sales_order_line_id)
        if ln is not None:
            e.line_number, e.line_type, e.line_description = ln.line_number, ln.line_type, ln.description
            e.rrv_model, e.uom = ln.rrv_model, ln.uom
        row = rows.get(el.sales_schedule_id) if el.sales_schedule_id else None
        e.current_delivery_date = row.current_delivery_date if row is not None else None
        e.departments = cells.get(el.id, {})
        out.append(e)
    resp.elements = out
    return resp


# ---------------------------------------------------------------- reads

@router.get("", response_model=list[OrderProjectResponse])
async def list_order_projects(
    status_filter: str | None = Query(None, alias="status"),
    customer_id: int | None = None,
    q: str | None = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _app: User = _SALES,
    user: User = Depends(require_tab_access("sales", "order_projects")),
):
    query = _scoped_query(db, user).options(selectinload(OrderProject.elements))
    if status_filter:
        if status_filter not in ORDER_PROJECT_STATUSES:
            raise HTTPException(status_code=422, detail=f"'{status_filter}' is not a project status — use one of "
                                                        f"{', '.join(ORDER_PROJECT_STATUSES)}.")
        query = query.filter(OrderProject.status == status_filter)
    if customer_id:
        query = query.filter(OrderProject.customer_id == customer_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(OrderProject.op_number.ilike(like), OrderProject.customer_name.ilike(like),
                                 OrderProject.title.ilike(like), SalesOrder.so_number.ilike(like),
                                 SalesOrder.customer_po_number.ilike(like)))
    projects = query.order_by(OrderProject.created_at.desc(), OrderProject.id.desc()).limit(limit).all()
    orders = {so.id: so for so in db.query(SalesOrder).filter(
        SalesOrder.id.in_({p.sales_order_id for p in projects} or {0})).all()}
    return [_response(db, p, orders[p.sales_order_id], user, full=False) for p in projects]


@router.get("/lookup", response_model=list[OrderProjectLookupItem])
async def lookup_order_projects(
    q: str | None = None,
    kind: str | None = Query(None, description="vehicle / lot — only that element kind"),
    include_projects: bool = Query(False, description="also return one row per project (no element)"),
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access(*_LOOKUP_APPS)),
):
    """Picker rows for the departments (not data-scoped: it only says that a
    project / vehicle exists, which a planner linking work needs)."""
    if kind and kind not in ("vehicle", "lot"):
        raise HTTPException(status_code=422, detail=f"kind '{kind}' is unknown — use vehicle or lot.")
    base = db.query(OrderProject, SalesOrder.so_number).join(SalesOrder, SalesOrder.id == OrderProject.sales_order_id).filter(
        OrderProject.status.in_(ops.PICKABLE_PROJECT_STATUSES))
    if project_id:
        base = base.filter(OrderProject.id == project_id)
    like = f"%{q.strip()}%" if q and q.strip() else None
    out: list[OrderProjectLookupItem] = []
    if include_projects and not kind:
        pq = base
        if like:
            pq = pq.filter(or_(OrderProject.op_number.ilike(like), OrderProject.customer_name.ilike(like),
                               OrderProject.title.ilike(like), SalesOrder.so_number.ilike(like),
                               SalesOrder.customer_po_number.ilike(like)))
        for p, so_number in pq.order_by(OrderProject.id.desc()).limit(30).all():
            out.append(OrderProjectLookupItem(project_id=p.id, op_number=p.op_number, customer_name=p.customer_name,
                                              so_number=so_number, display=f"{p.op_number} · whole project · {p.customer_name or ''}".rstrip(" ·")))
    eq = base.add_columns(OrderProjectElement).join(
        OrderProjectElement, OrderProjectElement.order_project_id == OrderProject.id).filter(
        OrderProjectElement.status != "cancelled")
    if kind:
        eq = eq.filter(OrderProjectElement.kind == kind)
    if like:
        eq = eq.filter(or_(OrderProject.op_number.ilike(like), OrderProject.customer_name.ilike(like),
                           SalesOrder.so_number.ilike(like), SalesOrder.customer_po_number.ilike(like),
                           OrderProjectElement.element_no.ilike(like), OrderProjectElement.label.ilike(like)))
    rows = eq.order_by(OrderProject.id.desc(), OrderProjectElement.id.asc()).limit(max(0, 30 - len(out))).all()
    for p, so_number, el in rows:
        disp = ops.element_display(p, el) + (f" · {p.customer_name}" if p.customer_name else "")
        out.append(OrderProjectLookupItem(project_id=p.id, op_number=p.op_number, element_id=el.id, element_no=el.element_no,
                                          label=el.label, kind=el.kind, customer_name=p.customer_name, so_number=so_number,
                                          display=disp))
    return out


@router.post("/backfill")
async def backfill_order_projects(
    db: Session = Depends(get_db),
    _app: User = _SALES,
    user: User = Depends(require_tab_action("sales", "order_projects", "edit")),
):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Only an admin can create projects for already-confirmed orders — "
                                                    "ask your portal admin to run it from Sales › Order Projects.")
    created = ops.backfill(db, user)
    db.commit()
    return {"created": len(created), "op_numbers": [p.op_number for p in created]}


@router.get("/{project_id}", response_model=OrderProjectResponse)
async def get_order_project(
    project_id: int,
    db: Session = Depends(get_db),
    _app: User = _SALES,
    user: User = Depends(require_tab_access("sales", "order_projects")),
):
    project, so = _load(db, project_id, user)
    ops.sync_elements(db, project, so)
    ops.refresh_order_project(db, so, project=project)
    db.commit()
    return _response(db, project, so, user, full=True)


@router.patch("/{project_id}", response_model=OrderProjectResponse)
async def update_order_project(
    project_id: int,
    payload: OrderProjectUpdate,
    db: Session = Depends(get_db),
    _app: User = _SALES,
    user: User = Depends(require_tab_action("sales", "order_projects", "edit")),
):
    project, so = _load(db, project_id, user)
    data = payload.model_dump(exclude_unset=True)
    if project.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"{project.op_number} is {ops.PROJECT_STATUS_LABEL[project.status]} "
                                                    f"(its sales order {so.display_number} is {svc.STATUS_LABEL.get(so.status, so.status)}) "
                                                    f"— it can't be changed any more.")
    if "project_manager_id" in data:
        pm_id = data["project_manager_id"]
        if pm_id is not None:
            pm = db.get(User, pm_id)
            if pm is None or not pm.is_active:
                raise HTTPException(status_code=422, detail=f"User #{pm_id} isn't an active portal user — pick the "
                                                            f"project manager again from the list.")
        project.project_manager_id = pm_id
    if "status" in data and data["status"] is not None:
        new = data["status"]
        if new not in ("active", "on_hold"):
            raise HTTPException(status_code=422, detail="A project can only be put on hold or resumed here — "
                                                        "'delivered' follows the deliveries, and closed / cancelled follow the sales order.")
        if new == "on_hold" and project.status == "delivered":
            raise HTTPException(status_code=409, detail=f"{project.op_number} is already fully delivered — there is nothing to hold.")
        project.status = new
    start = data.get("planned_start", project.planned_start)
    end = data.get("planned_end", project.planned_end)
    if start and end and end < start:
        raise HTTPException(status_code=422, detail=f"Planned end {end:%d-%m-%Y} is before planned start {start:%d-%m-%Y} — "
                                                    f"fix one of the dates.")
    if "planned_start" in data:
        project.planned_start = data["planned_start"]
    if "planned_end" in data:
        project.planned_end = data["planned_end"]
    ops.refresh_order_project(db, so, project=project)
    db.commit()
    db.refresh(project)
    return _response(db, project, so, user, full=True)
