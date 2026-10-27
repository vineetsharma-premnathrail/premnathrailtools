"""Store ↔ project Units wiring (imported at startup from
store/routes/stock_reservations.py, which main.py always imports).

  * stock-ledger hooks: GRN material of a project PO line is held for its
    element when it reaches Free stock; a GRN reversal releases those holds
    (services/project_stock.py);
  * department provider "store" for the project Units 360 table: per element,
    what is held vs issued, warning when the build's outstanding material is
    not covered by holds."""
from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.projects.so_projects import register_department_provider
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.stock_reservation import StoreStockReservation
from app.modules.store.services import project_stock
from app.modules.store.services.stock_ledger import register_posting_hook, register_pre_posting_hook

logger = logging.getLogger("store")
EPS = 1e-6


def _build_shortfall(db: Session, elements) -> dict[int, tuple[int, list[str]]]:
    """element id -> (items short, sample codes): outstanding material of the
    vehicle's Production work orders (required − issued) not covered by what
    is held for it (the element's holds + the work orders' own holds).
    Empty when Production has nothing planned for the element."""
    out: dict[int, tuple[int, list[str]]] = {}
    try:
        from app.modules.production.models.rrv_build import ProductionRrvBuild
        from app.modules.production.models.work_order import ProductionWorkOrder
    except Exception:  # noqa: BLE001
        return out
    from app.modules.store.models.item import StoreItem
    for el in elements:
        if el.status == "cancelled":
            continue
        builds = []
        if el.sales_schedule_id:
            builds = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.sales_schedule_id == el.sales_schedule_id,
                                                         ProductionRrvBuild.is_deleted == False).all()  # noqa: E712
        if hasattr(ProductionRrvBuild, "order_project_element_id"):
            builds += [b for b in db.query(ProductionRrvBuild).filter(
                ProductionRrvBuild.order_project_element_id == el.id, ProductionRrvBuild.is_deleted == False).all()  # noqa: E712
                if b not in builds]
        wo_q = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.is_deleted == False,  # noqa: E712
                                                    ProductionWorkOrder.status.notin_(("cancelled", "closed", "completed")))
        conds = []
        if builds:
            conds.append(ProductionWorkOrder.rrv_build_id.in_([b.id for b in builds]))
        if hasattr(ProductionWorkOrder, "order_project_element_id"):
            conds.append(ProductionWorkOrder.order_project_element_id == el.id)
        if not conds:
            continue
        from sqlalchemy import or_
        wos = wo_q.filter(or_(*conds)).all()
        if not wos:
            continue
        need: dict[int, float] = {}
        wo_held: dict[int, float] = {}
        res_ids = []
        for wo in wos:
            for m in wo.materials:
                if (getattr(m, "item_category", None) or "stock") != "stock":
                    continue
                outstanding = float(m.required_qty or 0) - float(m.issued_qty or 0) + float(getattr(m, "returned_qty", 0) or 0)
                if outstanding > EPS:
                    need[m.item_id] = need.get(m.item_id, 0.0) + outstanding
                if getattr(m, "reservation_id", None):
                    res_ids.append(m.reservation_id)
        if res_ids:
            for r in db.query(StoreStockReservation).filter(StoreStockReservation.id.in_(res_ids),
                                                            StoreStockReservation.status == "active").all():
                wo_held[r.item_id] = wo_held.get(r.item_id, 0.0) + float(r.quantity or 0)
        el_held = dict(db.query(StoreStockReservation.item_id, func.sum(StoreStockReservation.quantity)).filter(
            StoreStockReservation.order_project_element_id == el.id, StoreStockReservation.status == "active",
            StoreStockReservation.id.notin_(res_ids or [-1])).group_by(StoreStockReservation.item_id).all())
        short = [iid for iid, q in need.items() if q - wo_held.get(iid, 0.0) - float(el_held.get(iid) or 0) > EPS]
        if short:
            codes = [c for (c,) in db.query(StoreItem.item_code).filter(StoreItem.id.in_(short[:3])).all()]
            out[el.id] = (len(short), codes)
    return out


def store_department_cells(db: Session, project, elements) -> dict[int, dict | None]:
    ids = [el.id for el in elements]
    if not ids:
        return {}
    held = {eid: (n, q) for eid, n, q in db.query(
        StoreStockReservation.order_project_element_id, func.count(func.distinct(StoreStockReservation.item_id)),
        func.sum(StoreStockReservation.quantity)).filter(
        StoreStockReservation.order_project_element_id.in_(ids), StoreStockReservation.status == "active",
    ).group_by(StoreStockReservation.order_project_element_id).all()}
    issued_rows = db.query(StoreMaterialIssueItem.order_project_element_id, func.count(func.distinct(StoreMaterialIssueItem.item_id)),
                           func.max(StoreMaterialIssue.issue_date)).join(
        StoreMaterialIssue, StoreMaterialIssue.id == StoreMaterialIssueItem.issue_id).filter(
        StoreMaterialIssueItem.order_project_element_id.in_(ids)).group_by(StoreMaterialIssueItem.order_project_element_id).all()
    issued = {eid: (n, d) for eid, n, d in issued_rows}
    short = _build_shortfall(db, elements)
    cells: dict[int, dict | None] = {}
    for el in elements:
        if el.status == "cancelled":
            cells[el.id] = None
            continue
        h_items, h_qty = held.get(el.id, (0, 0.0))
        i_items, i_date = issued.get(el.id, (0, None))
        s = short.get(el.id)
        if not h_items and not i_items and not s:
            cells[el.id] = None
            continue
        detail = f"{h_items} item(s) held ({float(h_qty or 0):g} units) · {i_items} item(s) issued"
        date_txt = i_date.isoformat() if i_date else None
        if s:
            n, codes = s
            cells[el.id] = {"status": "short", "label": f"Short: {n} item(s)", "tone": "warning",
                            "detail": f"{detail} · not held for the build: {', '.join(codes)}{'…' if n > len(codes) else ''}",
                            "date": date_txt}
        elif h_items:
            cells[el.id] = {"status": "held", "label": f"{h_items} item(s) held", "tone": "info", "detail": detail, "date": date_txt}
        else:
            cells[el.id] = {"status": "issued", "label": f"{i_items} item(s) issued", "tone": "success", "detail": detail,
                            "date": date_txt}
    return cells


register_department_provider("store", store_department_cells)
register_posting_hook(project_stock.on_free_stock_in)
register_pre_posting_hook(project_stock.before_outbound)
