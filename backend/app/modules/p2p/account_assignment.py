"""PR account assignment (SAP ME51N account assignment category).

What a requisition is charged to, as a real link instead of free text:
  sales_order     customer order (ETO machine)       -> sales_orders
  cost_center     department overhead / consumption   -> cost_centers
  work_order      production order                    -> production_work_orders
  internal_order  capital / maintenance job (CO)      -> internal_orders
  order_project   build-to-order project (OP-YYYY-NNN) -> sales_order_projects
  rnd_project     new development (R&D Prototype / Research) -> rnd_projects;
                  Finance's internal order for it is opened automatically and
                  also filled on the PR (internal_order_id) - see
                  rnd/internal_order_link.py
Exactly one FK matches the category (a sales order that has an Order
Project also fills order_project_id — the lines then need their vehicle /
lot, see p2p/order_project_links.py). `project_label` stays as the display
text; when it is blank it is filled from the linked record. Old free-text
labels are NOT mapped to links automatically (no reliable key to match on).
The internal order also flows onto the PO when the PO is drafted without one
(its commitment then shows in Finance › Controlling)."""
from __future__ import annotations

from sqlalchemy.orm import Session

P2P_ACCOUNT_ASSIGNMENTS = {
    "sales_order": "Sales order",
    "cost_center": "Cost centre",
    "work_order": "Production work order",
    "internal_order": "Internal order",
    "order_project": "Project",
    "rnd_project": "R&D project",
}
_FK = {"sales_order": "sales_order_id", "cost_center": "cost_center_id", "work_order": "work_order_id", "internal_order": "internal_order_id",
       "order_project": "order_project_id", "rnd_project": "rnd_project_id"}
_CLOSED = {"sales_order": ("cancelled", "closed"), "work_order": ("closed", "cancelled"), "internal_order": ("closed", "settled"),
           "cost_center": ("inactive", "closed"), "order_project": ("delivered", "closed", "cancelled"),
           "rnd_project": ("cancelled", "closed", "handover")}


def _target(db: Session, kind: str, rid: int):
    if kind == "sales_order":
        from app.modules.sales.models.order import SalesOrder
        o = db.get(SalesOrder, rid)
        return o, (f"{o.so_number or f'SO #{o.id}'}" if o else None)
    if kind == "cost_center":
        from app.modules.organization.models.cost_center import CostCenter
        o = db.get(CostCenter, rid)
        return o, (f"{o.code} — {o.name}" if o else None)
    if kind == "work_order":
        from app.modules.production.models.work_order import ProductionWorkOrder
        o = db.get(ProductionWorkOrder, rid)
        return o, (o.wo_number if o else None)
    if kind == "order_project":
        from app.modules.sales.models.order_project import OrderProject
        o = db.get(OrderProject, rid)
        return o, (f"{o.op_number} — {o.title}"[:255] if o else None)
    if kind == "rnd_project":
        from app.modules.rnd.models.project import RndProject
        o = db.get(RndProject, rid)
        if o is not None and o.is_deleted:
            o = None
        return o, (f"{o.project_number} — {o.title}"[:255] if o else None)
    from app.modules.accounts.models.internal_order import InternalOrder
    o = db.get(InternalOrder, rid)
    return o, (f"{o.code} — {o.name}" if o else None)


def resolve(db: Session, data: dict, *, required: bool = False) -> dict:
    """{account_assignment, <4 FKs>, label} from a payload dict; raises
    ValueError with what to fix."""
    kind = (data.get("account_assignment") or "").strip() or None
    out = {"account_assignment": kind, **{f: None for f in _FK.values()}, "label": None}
    if kind is None:
        stray = [f for f in _FK.values() if data.get(f)]
        if stray:
            raise ValueError("Pick the account assignment (sales order, order project, R&D project, cost centre, work order or internal order) for the record you linked.")
        if required:
            raise ValueError("Pick what this requisition is charged to — a sales order, order project, R&D project, cost centre, work order or internal order.")
        return out
    if kind not in P2P_ACCOUNT_ASSIGNMENTS:
        raise ValueError(f"Account assignment must be one of: {', '.join(P2P_ACCOUNT_ASSIGNMENTS.values())}.")
    fk = _FK[kind]
    # The order project of a sales order rides along (it is derived), so a
    # client echoing order_project_id back with a sales order is fine.
    # Derived ones ride along: a sales order's order project, an R&D project's internal order.
    others = [f for k, f in _FK.items() if k != kind and data.get(f)
              and not (kind == "sales_order" and k == "order_project") and not (kind == "rnd_project" and k == "internal_order")]
    if others:
        raise ValueError(f"A requisition charged to a {P2P_ACCOUNT_ASSIGNMENTS[kind].lower()} can't also carry "
                         f"{', '.join(o.replace('_id', '').replace('_', ' ') for o in others)} — keep one account assignment.")
    rid = data.get(fk)
    if not rid:
        raise ValueError(f"Pick the {P2P_ACCOUNT_ASSIGNMENTS[kind].lower()} this requisition is charged to.")
    obj, label = _target(db, kind, int(rid))
    if obj is None:
        raise ValueError(f"The {P2P_ACCOUNT_ASSIGNMENTS[kind].lower()} picked no longer exists — pick it again.")
    if kind == "rnd_project":
        from app.modules.rnd.internal_order_link import closed_reason
        why = closed_reason(obj)
        if why:
            raise ValueError(f"R&D project {label} is {why} — nothing more can be charged to it. Pick an open R&D project "
                             "(R&D › Prototype / Research), or ask the R&D head to open a new one.")
    status = (getattr(obj, "status", "") or "").lower()
    if status in _CLOSED[kind]:
        raise ValueError(f"{P2P_ACCOUNT_ASSIGNMENTS[kind]} {label} is {status} — nothing more can be charged to it. Pick an open one.")
    out[fk] = obj.id
    out["label"] = label
    return out


def apply(db: Session, pr, data: dict) -> None:
    """Sets the account assignment on a PR (raises ValueError)."""
    r = resolve(db, data)
    pr.account_assignment = r["account_assignment"]
    for f in _FK.values():
        setattr(pr, f, r[f])
    if r["account_assignment"] == "sales_order" and r["sales_order_id"]:
        from app.modules.sales.order_projects import project_for_order
        project = project_for_order(db, r["sales_order_id"])
        pr.order_project_id = project.id if project is not None else None
    if r["account_assignment"] == "rnd_project" and r["rnd_project_id"]:
        # Finance's cost object for the project: opened on first use, then reused.
        from app.modules.rnd.internal_order_link import ensure_internal_order_for_rnd_project
        from app.modules.rnd.models.project import RndProject
        pr.internal_order_id = ensure_internal_order_for_rnd_project(db, db.get(RndProject, r["rnd_project_id"]))
    if r["label"] and not (pr.project_label or "").strip():
        pr.project_label = r["label"]


def label_for(db: Session, pr) -> str | None:
    kind = getattr(pr, "account_assignment", None)
    if not kind or kind not in _FK:
        return None
    rid = getattr(pr, _FK[kind])
    if not rid:
        return None
    _obj, label = _target(db, kind, rid)
    return f"{P2P_ACCOUNT_ASSIGNMENTS[kind]}: {label}" if label else None


def rnd_project_label(db: Session, pr) -> str | None:
    """"<number> — <title>" of the R&D project a PR is charged to."""
    rid = getattr(pr, "rnd_project_id", None)
    return _target(db, "rnd_project", rid)[1] if rid else None


def options(db: Session, kind: str, search: str | None = None, limit: int = 50) -> list[dict]:
    """Open records a requisition can be charged to, for the PR form picker."""
    if kind not in P2P_ACCOUNT_ASSIGNMENTS:
        raise ValueError(f"Account assignment must be one of: {', '.join(P2P_ACCOUNT_ASSIGNMENTS)}.")
    like = f"%{(search or '').strip()}%"
    if kind == "sales_order":
        from app.modules.sales.models.order import SalesOrder
        q = db.query(SalesOrder).filter(SalesOrder.status.notin_(_CLOSED[kind]), SalesOrder.so_number.isnot(None))
        if hasattr(SalesOrder, "deleted_at"):
            q = q.filter(SalesOrder.deleted_at.is_(None))
        if search:
            q = q.filter(SalesOrder.so_number.ilike(like))
        return [{"id": o.id, "label": o.so_number} for o in q.order_by(SalesOrder.id.desc()).limit(limit).all()]
    if kind == "cost_center":
        from app.modules.organization.models.cost_center import CostCenter
        q = db.query(CostCenter).filter(CostCenter.status.notin_(_CLOSED[kind]))
        if search:
            q = q.filter(CostCenter.code.ilike(like) | CostCenter.name.ilike(like))
        return [{"id": o.id, "label": f"{o.code} — {o.name}"} for o in q.order_by(CostCenter.code).limit(limit).all()]
    if kind == "work_order":
        from app.modules.production.models.work_order import ProductionWorkOrder
        q = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.status.notin_(_CLOSED[kind]))
        if hasattr(ProductionWorkOrder, "deleted_at"):
            q = q.filter(ProductionWorkOrder.deleted_at.is_(None))
        if search:
            q = q.filter(ProductionWorkOrder.wo_number.ilike(like))
        return [{"id": o.id, "label": o.wo_number} for o in q.order_by(ProductionWorkOrder.id.desc()).limit(limit).all()]
    if kind == "order_project":
        from app.modules.sales.models.order_project import OrderProject
        q = db.query(OrderProject).filter(OrderProject.status.notin_(_CLOSED[kind]))
        if search:
            q = q.filter(OrderProject.op_number.ilike(like) | OrderProject.title.ilike(like) | OrderProject.customer_name.ilike(like))
        return [{"id": o.id, "label": f"{o.op_number} — {o.title}"[:255]} for o in q.order_by(OrderProject.id.desc()).limit(limit).all()]
    if kind == "rnd_project":
        from app.modules.rnd.models.project import RndProject
        q = db.query(RndProject).filter(RndProject.is_deleted == False,  # noqa: E712
                                        RndProject.status.notin_(("cancelled",)), RndProject.stage.notin_(("handover", "closed")),
                                        RndProject.handed_over_at.is_(None))
        if search:
            q = q.filter(RndProject.project_number.ilike(like) | RndProject.title.ilike(like))
        return [{"id": o.id, "label": f"{o.project_number} — {o.title}"[:255]} for o in q.order_by(RndProject.project_number).limit(limit).all()]
    from app.modules.accounts.models.internal_order import InternalOrder
    q = db.query(InternalOrder).filter(InternalOrder.status.notin_(_CLOSED[kind]))
    if search:
        q = q.filter(InternalOrder.code.ilike(like) | InternalOrder.name.ilike(like))
    return [{"id": o.id, "label": f"{o.code} — {o.name}"} for o in q.order_by(InternalOrder.code).limit(limit).all()]
