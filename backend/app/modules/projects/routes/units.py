"""Units (vehicles / lots) of Project Management projects created from Sales Orders:
the 360 table for one project and the cross-module picker lookup.

Register this router BEFORE projects/routes/project.py so /projects/units/lookup
is not swallowed by /projects/{project_id}."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_tab_access, require_any_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.projects import so_projects as op_core
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject
from app.modules.projects.schemas.units import ProjectUnitLookupItem, ProjectUnitResponse, ProjectUnitsResponse
from app.modules.sales.models.order import SalesOrder

router = APIRouter(prefix="/projects", tags=["Project Management"])
# Departments that link their work to a project unit (pickers).
_LOOKUP_APPS = ("sales", "projects", "design", "p2p", "purchase", "store", "production", "quality")


@router.get("/units/lookup", response_model=list[ProjectUnitLookupItem])
async def lookup_units(
    q: str | None = None,
    kind: str | None = Query(None, description="vehicle / lot — only that unit kind"),
    include_projects: bool = Query(False, description="also return one row per project (no unit)"),
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access(*_LOOKUP_APPS)),
):
    """Picker rows for the departments (not data-scoped: it only says that a
    project / unit exists, which a planner linking work needs)."""
    if kind and kind not in ("vehicle", "lot"):
        raise HTTPException(status_code=422, detail=f"kind '{kind}' is unknown — use vehicle or lot.")
    base = (db.query(PmProject, SalesOrder.so_number)
            .outerjoin(SalesOrder, SalesOrder.id == PmProject.sales_order_id)
            .filter(PmProject.status.in_(op_core.PICKABLE_PROJECT_STATUSES)))
    if project_id:
        base = base.filter(PmProject.id == project_id)
    like = f"%{q.strip()}%" if q and q.strip() else None
    out: list[ProjectUnitLookupItem] = []
    if include_projects and not kind:
        pq = base
        if like:
            pq = pq.filter(or_(PmProject.project_code.ilike(like), PmProject.client_name.ilike(like),
                               PmProject.name.ilike(like), SalesOrder.so_number.ilike(like),
                               SalesOrder.customer_po_number.ilike(like)))
        for p, so_number in pq.order_by(PmProject.id.desc()).limit(30).all():
            out.append(ProjectUnitLookupItem(
                project_id=p.id, project_code=p.project_code, client_name=p.client_name, so_number=so_number,
                display=f"{p.project_code} · whole project · {p.client_name or ''}".rstrip(" ·")))
    eq = (base.add_columns(PmProjectElement)
          .join(PmProjectElement, PmProjectElement.project_id == PmProject.id)
          .filter(PmProjectElement.status != "cancelled"))
    if kind:
        eq = eq.filter(PmProjectElement.kind == kind)
    if like:
        eq = eq.filter(or_(PmProject.project_code.ilike(like), PmProject.client_name.ilike(like),
                           SalesOrder.so_number.ilike(like), SalesOrder.customer_po_number.ilike(like),
                           PmProjectElement.element_no.ilike(like), PmProjectElement.label.ilike(like)))
    rows = eq.order_by(PmProject.id.desc(), PmProjectElement.id.asc()).limit(max(0, 30 - len(out))).all()
    for p, so_number, el in rows:
        disp = op_core.element_display(p, el) + (f" · {p.client_name}" if p.client_name else "")
        out.append(ProjectUnitLookupItem(
            project_id=p.id, project_code=p.project_code, element_id=el.id, element_no=el.element_no, label=el.label,
            kind=el.kind, client_name=p.client_name, so_number=so_number, display=disp))
    return out


@router.get("/{project_id}/units", response_model=ProjectUnitsResponse)
async def project_units(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    """Vehicles / lots of one project with the 360 department cells. Same data scope
    as the project itself; a project not created from a Sales Order has no units."""
    from app.modules.sales.views import prices_hidden

    project = db.get(PmProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted. "
                                                    f"Go back to Project Management › All Projects.")
    ensure_in_scope(db, user, project)
    resp = ProjectUnitsResponse()
    so = db.get(SalesOrder, project.sales_order_id) if project.sales_order_id else None
    if so is None or so.is_deleted:
        return resp
    # Read-only: units are synced when the sales order is confirmed / amended and on delivery events.
    resp.sales_order_id, resp.so_number, resp.so_status = so.id, so.so_number, so.status
    resp.customer_po_number, resp.customer_po_date, resp.currency = so.customer_po_number, so.customer_po_date, so.currency
    resp.order_value = None if prices_hidden(user) else float(so.grand_total or 0)
    live = [el for el in project.elements if el.status != "cancelled"]
    resp.vehicles_total = sum(1 for el in live if el.kind == "vehicle")
    resp.vehicles_delivered = sum(1 for el in live if el.kind == "vehicle" and el.status == "delivered")
    resp.lots_total = sum(1 for el in live if el.kind == "lot")
    lines = {ln.id: ln for ln in so.lines}
    rows = {r.id: r for r in so.schedules}
    elements = sorted(project.elements, key=lambda el: (el.status == "cancelled", el.element_no))
    cells = op_core.department_cells(db, project, so, elements)
    for el in elements:
        e = ProjectUnitResponse.model_validate(el)
        ln = lines.get(el.sales_order_line_id)
        if ln is not None:
            e.line_number, e.line_type, e.line_description = ln.line_number, ln.line_type, ln.description
            e.rrv_model, e.uom = ln.rrv_model, ln.uom
        row = rows.get(el.sales_schedule_id) if el.sales_schedule_id else None
        e.current_delivery_date = row.current_delivery_date if row is not None else None
        e.departments = cells.get(el.id, {})
        resp.elements.append(e)
    return resp
