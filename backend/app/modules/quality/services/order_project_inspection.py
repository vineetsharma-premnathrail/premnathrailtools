"""Quality against PM project units (Project Management › All Projects).

The inspection requirement of a build comes from its Sales Order — the SO's
`inspection_agency` + `third_party_inspection_required` are the single source
of truth. An inspection call / lot linked to an element (vehicle or spares
lot) takes the agency from that SO; a different agency is refused.

Stable helpers other modules may call:

    so_requirement(db, element) -> dict
        {so_id, so_number, required, agency, agency_label, order_reference, customer_name}
    inspection_required_for_element(db, element) -> (required: bool, agency: str | None, cleared: bool)
        For the Store dispatch block: cleared = accepted calls with a
        certificate cover the element's quantity.
    resolve_link(db, project_id, element_id) -> (project, element) | (None, None)
    trigger_inspection_milestone(db, call) — accepted call → SO 'inspection'
        billing milestone due (Finance billing.trigger_event).
"""
from __future__ import annotations

import logging
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.quality.models.inspection_call import QualityInspectionCall
from app.modules.sales.models.order import SalesOrder
from app.modules.projects.models.element import PmProjectElement
from app.modules.projects.models.project import PmProject

logger = logging.getLogger("quality")

EPS = 1e-6
CLEARED_STATUSES = ("accepted", "partially_accepted")


class LinkError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def agency_label(db: Session, value: str | None) -> str:
    from app.modules.quality.services.dispatch import _agency_label
    return _agency_label(db, value)


def _so_for_project(db: Session, project: PmProject) -> SalesOrder | None:
    # A PM project made by hand has no sales order (then no agency rule applies).
    return db.get(SalesOrder, project.sales_order_id) if project.sales_order_id else None


def resolve_link(db: Session, project_id: int | None, element_id: int | None, *,
                 allow_cancelled: bool = False) -> tuple[PmProject | None, PmProjectElement | None]:
    """Validate a project pick from a form. Element given → it must
    belong to the project (when both are sent). Project only → allowed (the
    whole order). Raises LinkError with the reason and the fix."""
    from app.modules.projects import so_projects as op_core
    if not element_id and not project_id:
        return None, None
    try:
        if element_id:
            return op_core.resolve_element(db, element_id, project_id=project_id, allow_cancelled=allow_cancelled)
        return op_core.resolve_project(db, project_id, allow_closed=allow_cancelled), None
    except HTTPException as e:
        raise LinkError(str(e.detail), e.status_code)


def so_requirement(db: Session, element: PmProjectElement | None, project: PmProject | None = None) -> dict | None:
    project = project or (element.project if element is not None else None)
    if project is None:
        return None
    so = _so_for_project(db, project)
    if so is None:
        return None
    agency = (so.inspection_agency or "").strip() or None
    return {
        "so_id": so.id, "so_number": so.display_number, "required": bool(so.third_party_inspection_required),
        "agency": agency, "agency_label": agency_label(db, agency) if agency else None,
        "order_reference": so.customer_po_number or so.loa_number or so.display_number,
        "customer_name": so.customer_name,
    }


def apply_to_call(db: Session, data: dict, project: PmProject, element: PmProjectElement | None) -> dict:
    """The SO decides the agency: fill it in, refuse a different one, and
    default the order reference / customer from the SO. Returns the
    requirement dict."""
    req = so_requirement(db, element, project)
    if req is None:
        raise LinkError(f"The Sales Order of {project.project_code} can't be read — reload and pick the project again.", 404)
    where = f"Sales Order {req['so_number']}"
    if not req["agency"]:
        raise LinkError(f"{where} ({project.project_code}) has no inspecting agency, so no customer / third-party inspection "
                        f"is due for it. If the customer now wants one, ask Sales to amend the order's inspection agency "
                        f"first — the agency is taken from the Sales Order, not typed on the call.", 422)
    entered = (data.get("agency") or "").strip() or None
    if entered and entered != req["agency"]:
        raise LinkError(f"{where} names {req['agency_label']} as the inspecting agency, not "
                        f"{agency_label(db, entered)}. The agency comes from the Sales Order — leave it as "
                        f"{req['agency_label']}, or ask Sales to amend the order if the contract changed.", 422)
    data["agency"] = req["agency"]
    if not (data.get("order_reference") or "").strip():
        data["order_reference"] = req["order_reference"]
    if not (data.get("customer_name") or "").strip():
        data["customer_name"] = req["customer_name"]
    return req


def calls_for_element(db: Session, element_id: int) -> list[QualityInspectionCall]:
    return (db.query(QualityInspectionCall)
            .filter(QualityInspectionCall.order_project_element_id == element_id,
                    QualityInspectionCall.status != "cancelled")
            .order_by(QualityInspectionCall.id).all())


def cleared_qty(calls: list[QualityInspectionCall], item_id: int | None = None) -> float:
    return sum(c.accepted_qty or 0.0 for c in calls
               if c.status in CLEARED_STATUSES and c.certificate_number and (item_id is None or c.item_id == item_id))


def inspection_required_for_element(db: Session, element: PmProjectElement) -> tuple[bool, str | None, bool]:
    """(required, agency, cleared) from the element's Sales Order. Not
    required → cleared is True (nothing stands in the way)."""
    req = so_requirement(db, element)
    if not req or not req["required"]:
        return False, (req or {}).get("agency"), True
    calls = calls_for_element(db, element.id)
    need = float(element.quantity or 1)
    return True, req["agency"], cleared_qty(calls) >= need - EPS


def trigger_inspection_milestone(db: Session, call: QualityInspectionCall) -> None:
    """Accepted / partly accepted call: the 'inspection' billing milestone of
    the order falls due — through the element's Sales Order when linked, and
    the ERP machine's order(s) for old calls (billing.on_inspection_accepted)."""
    from app.modules.accounts.services.billing import BILLABLE_ORDER_STATUSES, on_inspection_accepted, trigger_event
    from app.modules.sales.service import today_ist
    on = call.result_date or today_ist()
    if call.order_project_id:
        project = db.get(PmProject, call.order_project_id)
        if project is not None and project.sales_order_id:
            from app.modules.sales.views import get_order
            try:
                so = get_order(db, project.sales_order_id)
            except HTTPException:
                so = None
            if so is not None and so.status in BILLABLE_ORDER_STATUSES:
                trigger_event(db, so, "inspection", on=on)
    if call.erp_project_id:
        on_inspection_accepted(db, erp_project_id=call.erp_project_id, on=on)


def element_dispatch_problems(db: Session, *, element_id: int, item_id: int, item_name: str, quantity: float,
                              dispatched_qty: float = 0.0) -> list[str]:
    """Rule 8b against the element's Sales Order (used by dispatch.check when
    a dispatch names the project unit)."""
    el = db.get(PmProjectElement, element_id)
    if el is None:
        return [f"Project unit #{element_id} doesn't exist — pick the vehicle / lot again."]
    req = so_requirement(db, el)
    if not req or not req["required"]:
        return []
    calls = [c for c in calls_for_element(db, el.id) if c.item_id == item_id]
    cleared = cleared_qty(calls)
    agency = req["agency_label"] or "customer / third-party"
    what = f"{el.element_no} ({el.label})"
    if cleared <= EPS:
        return [f"Rule 8: Sales Order {req['so_number']} needs {agency} inspection before dispatch, and {item_name} has no "
                f"accepted inspection call with a certificate number for {what}. Raise / record the call in "
                "Quality → Inspection Calls (pick the project)."]
    if dispatched_qty + quantity > cleared + 1e-9:
        return [f"Rule 8: {agency} has cleared {cleared:g} of {item_name} for {what} "
                f"({', '.join(c.certificate_number for c in calls if c.certificate_number)}) and {dispatched_qty:g} is already "
                f"dispatched — {max(cleared - dispatched_qty, 0):g} can still go, not {quantity:g}. Offer the rest for inspection first."]
    return []


def link_display(db: Session, rows: list) -> dict[int, dict]:
    """{row.id: {op_number, element_no, element_label, so_id, so_number}} for
    response DTOs (calls / lots)."""
    pids = {r.order_project_id for r in rows if getattr(r, "order_project_id", None)}
    eids = {r.order_project_element_id for r in rows if getattr(r, "order_project_element_id", None)}
    if not pids and not eids:
        return {}
    els = {e.id: e for e in db.query(PmProjectElement).filter(PmProjectElement.id.in_(eids)).all()} if eids else {}
    pids |= {e.project_id for e in els.values()}
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pids)).all()}
    sos = {s.id: s for s in db.query(SalesOrder).filter(SalesOrder.id.in_({p.sales_order_id for p in projects.values() if p.sales_order_id})).all()}
    out = {}
    for r in rows:
        el = els.get(r.order_project_element_id) if r.order_project_element_id else None
        p = projects.get(r.order_project_id or (el.project_id if el else None))
        if p is None:
            continue
        so = sos.get(p.sales_order_id)
        out[r.id] = {
            "op_number": p.project_code, "element_no": el.element_no if el else None, "element_label": el.label if el else None,
            "so_id": so.id if so else None, "so_number": so.display_number if so else None,
            "so_inspection_agency": so.inspection_agency if so else None,
            "so_third_party_inspection_required": bool(so.third_party_inspection_required) if so else False,
        }
    return out


def _fmt(d: date | None) -> str:
    return d.strftime("%d-%b-%Y") if d else ""
