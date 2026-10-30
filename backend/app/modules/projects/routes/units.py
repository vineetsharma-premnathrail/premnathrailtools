"""Units (vehicles / lots) of historic Sales-Order projects, the 360 table for one project and
the cross-module picker lookup.

Since 2026-10-30 a project is one machine: projects made in Project Management have no units
and every department links to the project itself (so_projects.resolve_link). The "From Sales
Order" create path is gone with Sales Orders.

Register this router BEFORE projects/routes/project.py so /projects/units/lookup
is not swallowed by /projects/{project_id}."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, or_
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_tab_access, require_any_app_access
from app.db.session import get_db
from app.modules.erp.models.project import Project as Machine
from app.modules.main.models.user import User
from app.modules.projects import so_projects as op_core
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject
from app.modules.projects.schemas.units import (
    ProjectUnitLookupItem, ProjectUnitResponse, ProjectUnitsResponse, ProjectWholeRow,
)
from app.modules.sales.models.order import SalesOrder

router = APIRouter(prefix="/projects", tags=["Project Management"])
# Departments that link their work to a project / project unit (pickers).
_LOOKUP_APPS = ("projects", "design", "electrical", "hydraulic", "p2p", "purchase", "store", "production", "quality")


def _machines(db: Session, project_ids: list[int]) -> dict[int, tuple[int, str]]:
    """{project id: (machine id, serial)} — the lowest machine id of each project."""
    found: dict[int, tuple[int, str]] = {}
    if not project_ids:
        return found
    for mid, pid, serial in (db.query(Machine.id, Machine.pm_project_id, Machine.serial_number)
                             .filter(Machine.pm_project_id.in_(project_ids), Machine.is_deleted == False)  # noqa: E712
                             .order_by(Machine.id).all()):
        found.setdefault(pid, (mid, serial))
    return found


def _live_unit_exists():
    return exists().where(PmProjectElement.project_id == PmProject.id, PmProjectElement.status != "cancelled")


@router.get("/units/lookup", response_model=list[ProjectUnitLookupItem])
async def lookup_units(
    q: str | None = None,
    kind: str | None = Query(None, description="vehicle / lot — only that unit kind (project rows without units are still offered)"),
    include_projects: bool = Query(False, description="also return one row per project that HAS units (whole-project rows)"),
    project_id: int | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_app_access(*_LOOKUP_APPS)),
):
    """Picker rows for the departments (not data-scoped: it only says that a project / unit exists,
    which a planner linking work needs).

    A project WITHOUT live units (every project made in Project Management) always gets one row,
    element_id null and project_level true — picking it links the work to the project itself.
    A historic sales-order project gets one row per live unit (plus a whole-project row when
    include_projects is set)."""
    if kind and kind not in ("vehicle", "lot"):
        raise HTTPException(status_code=422, detail=f"kind '{kind}' is unknown — use vehicle or lot.")
    base = (db.query(PmProject, SalesOrder.so_number)
            .outerjoin(SalesOrder, SalesOrder.id == PmProject.sales_order_id)  # historic display only
            .filter(PmProject.status.in_(op_core.PICKABLE_PROJECT_STATUSES)))
    if project_id:
        base = base.filter(PmProject.id == project_id)
    like = f"%{q.strip()}%" if q and q.strip() else None
    machine_hit = (PmProject.id.in_(db.query(Machine.pm_project_id).filter(
        Machine.pm_project_id.isnot(None), Machine.serial_number.ilike(like))) if like else None)

    out: list[ProjectUnitLookupItem] = []
    pq = base if include_projects else base.filter(~_live_unit_exists())
    if like:
        pq = pq.filter(or_(PmProject.project_code.ilike(like), PmProject.client_name.ilike(like),
                           PmProject.name.ilike(like), SalesOrder.so_number.ilike(like),
                           SalesOrder.customer_po_number.ilike(like), machine_hit))
    prows = pq.order_by(PmProject.id.desc()).limit(30).all()
    machines = _machines(db, [p.id for p, _ in prows])
    unit_less = {p.id for p, _ in prows if not op_core.project_has_units(db, p.id)}
    for p, so_number in prows:
        m = machines.get(p.id)
        if p.id in unit_less:
            bits = [p.project_code, p.client_name or None, f"machine {m[1]}" if m else None]
            display, level = " · ".join(b for b in bits if b), True
        else:
            display, level = f"{p.project_code} · whole project · {p.client_name or ''}".rstrip(" ·"), False
        out.append(ProjectUnitLookupItem(
            project_id=p.id, project_code=p.project_code, client_name=p.client_name, so_number=so_number,
            project_level=level, machine_id=m[0] if m else None, machine_serial=m[1] if m else None, display=display))

    eq = (base.add_columns(PmProjectElement)
          .join(PmProjectElement, PmProjectElement.project_id == PmProject.id)
          .filter(PmProjectElement.status != "cancelled"))
    if kind:
        eq = eq.filter(PmProjectElement.kind == kind)
    if like:
        eq = eq.filter(or_(PmProject.project_code.ilike(like), PmProject.client_name.ilike(like),
                           SalesOrder.so_number.ilike(like), SalesOrder.customer_po_number.ilike(like),
                           PmProjectElement.element_no.ilike(like), PmProjectElement.label.ilike(like), machine_hit))
    rows = eq.order_by(PmProject.id.desc(), PmProjectElement.id.asc()).limit(max(0, 30 - len(out))).all()
    machines.update(_machines(db, [p.id for p, _, _ in rows if p.id not in machines]))
    for p, so_number, el in rows:
        m = machines.get(p.id)
        disp = op_core.element_display(p, el) + (f" · {p.client_name}" if p.client_name else "")
        out.append(ProjectUnitLookupItem(
            project_id=p.id, project_code=p.project_code, element_id=el.id, element_no=el.element_no, label=el.label,
            kind=el.kind, client_name=p.client_name, so_number=so_number,
            machine_id=m[0] if m else None, machine_serial=m[1] if m else None, display=disp))
    return out


@router.get("/{project_id}/units", response_model=ProjectUnitsResponse)
async def project_units(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("projects", "all_projects")),
):
    """The 360 table of one project, same data scope as the project itself.

    A project with units (historic sales order): one row per vehicle / lot with the department
    cells. A project without units (every new project, one project = one machine): has_units is
    false and whole_project carries the single "Whole project" row — what Design, Purchase, Store,
    Production, Quality and Dispatch linked to the project itself."""
    from app.modules.projects import lifecycle
    from app.modules.sales.legacy import prices_hidden

    project = db.get(PmProject, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted. "
                                                    f"Go back to Project Management › All Projects.")
    ensure_in_scope(db, user, project)
    resp = ProjectUnitsResponse()
    so = db.get(SalesOrder, project.sales_order_id) if project.sales_order_id else None
    if so is not None and so.is_deleted:
        so = None
    live = [el for el in project.elements if el.status != "cancelled"]
    resp.has_units = bool(live)
    if so is not None:
        # Read-only: units are synced from the historic sales order's delivery events.
        resp.sales_order_id, resp.so_number, resp.so_status = so.id, so.so_number, so.status
        resp.customer_po_number, resp.customer_po_date, resp.currency = so.customer_po_number, so.customer_po_date, so.currency
        resp.order_value = None if prices_hidden(user) else float(so.grand_total or 0)
    resp.vehicles_total = sum(1 for el in live if el.kind == "vehicle")
    resp.vehicles_delivered = sum(1 for el in live if el.kind == "vehicle" and el.status == "delivered")
    resp.lots_total = sum(1 for el in live if el.kind == "lot")
    lines = {ln.id: ln for ln in so.lines} if so is not None else {}
    rows = {r.id: r for r in so.schedules} if so is not None else {}
    elements = sorted(project.elements, key=lambda el: (el.status == "cancelled", el.element_no))
    cells = op_core.department_cells(db, project, so, elements)
    if not live:
        machine = op_core.project_machine(db, project)
        stage = project.lifecycle_stage or "planned"
        resp.whole_project = ProjectWholeRow(
            label="Whole project" + (f" · {machine[1]}" if machine else ""),
            machine_id=machine[0] if machine else None, machine_serial=machine[1] if machine else None,
            lifecycle_stage=stage, lifecycle_stage_label=lifecycle.stage_label(stage),
            departments=cells.get(None, {}))
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
