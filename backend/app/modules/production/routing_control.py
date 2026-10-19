"""Routing control keys (SAP CA01 control key: internal / external
processing, confirmation required / optional / none, print on the job
card), CO11N yield continuity, and CO01 sales-order assignment on work
orders. Plain functions; routes turn RoutingError into the HTTP error."""
from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.production.models.work_order import ProductionWorkOrder, ProductionWorkOrderOperation

_EPS = 1e-9


class RoutingError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _op(op) -> str:
    return f"Operation {op.sequence} {op.operation_name}"


# ---------------------------------------------------------------------------
# CO01 sales-order assignment
# ---------------------------------------------------------------------------

def validate_sales_assignment(db: Session, data: dict, product_item_id: int) -> None:
    """The line must belong to the order and the order must be open. A line
    alone fills in its order. Mutates `data`."""
    from app.modules.sales.models.order import SALES_ORDER_OPEN_STATUSES, SalesOrder, SalesOrderLine
    so_id, line_id = data.get("sales_order_id"), data.get("sales_order_line_id")
    if not so_id and not line_id:
        return
    line = None
    if line_id:
        line = db.query(SalesOrderLine).filter(SalesOrderLine.id == line_id).first()
        if line is None:
            raise RoutingError(f"Sales order line #{line_id} not found", 404)
        if so_id and line.so_id != so_id:
            raise RoutingError(f"Sales order line #{line_id} belongs to a different sales order. Pick a line of the chosen order.", 400)
        so_id = line.so_id
    so = db.query(SalesOrder).filter(SalesOrder.id == so_id, SalesOrder.is_deleted == False).first()  # noqa: E712
    if so is None:
        raise RoutingError(f"Sales order #{so_id} not found", 404)
    if so.status not in SALES_ORDER_OPEN_STATUSES or so.status == "on_hold":
        raise RoutingError(f"Sales order {so.display_number} is {so.status.replace('_', ' ')}. Work orders can only be assigned to a "
                           "confirmed sales order that is in execution (not on hold).")
    data["sales_order_id"], data["sales_order_line_id"] = so.id, line.id if line else None


def sales_order_labels(db: Session, orders: list) -> dict[int, str]:
    from app.modules.sales.models.order import SalesOrder, SalesOrderLine
    so_ids = {o.sales_order_id for o in orders if o.sales_order_id}
    if not so_ids:
        return {}
    sos = {s.id: s for s in db.query(SalesOrder).filter(SalesOrder.id.in_(so_ids)).all()}
    line_ids = {o.sales_order_line_id for o in orders if o.sales_order_line_id}
    lines = {ln.id: ln for ln in db.query(SalesOrderLine).filter(SalesOrderLine.id.in_(line_ids)).all()} if line_ids else {}
    out = {}
    for o in orders:
        so = sos.get(o.sales_order_id)
        if so is None:
            continue
        label = so.display_number + (f" ({so.customer_name})" if so.customer_name else "")
        ln = lines.get(o.sales_order_line_id)
        if ln is not None:
            label += f" · line {ln.line_number}"
        out[o.id] = label
    return out


def child_counts(db: Session, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    return dict(db.query(ProductionWorkOrder.parent_work_order_id, func.count(ProductionWorkOrder.id)).filter(
        ProductionWorkOrder.parent_work_order_id.in_(ids), ProductionWorkOrder.is_deleted == False,  # noqa: E712
    ).group_by(ProductionWorkOrder.parent_work_order_id).all())


# ---------------------------------------------------------------------------
# External operations (job work)
# ---------------------------------------------------------------------------

def job_work_returned(db: Session, issue_id: int | None) -> bool:
    """Has anything come back against the challan — the same item (Material
    Return against it) or the processed item (Job Work Receipt)?"""
    if not issue_id:
        return False
    from app.modules.store.models.job_work import StoreJobWorkReceipt
    from app.modules.store.models.material_return import StoreMaterialReturn
    if db.query(StoreJobWorkReceipt.id).filter(StoreJobWorkReceipt.issue_id == issue_id).first():
        return True
    return db.query(StoreMaterialReturn.id).filter(
        StoreMaterialReturn.source_issue_id == issue_id, StoreMaterialReturn.status == "approved",
    ).first() is not None


def link_job_work(db: Session, wo, op, issue_id: int) -> None:
    from app.modules.store.models.material_issue import StoreMaterialIssue
    if (op.control_key or "internal") != "external":
        raise RoutingError(f"{_op(op)} is an internal step — only an external (subcontracted) step is linked to a job-work challan.", 400)
    if op.status == "completed":
        raise RoutingError(f"{_op(op)} is already completed.")
    issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == issue_id).first()
    if issue is None:
        raise RoutingError(f"Store material issue #{issue_id} not found", 404)
    if issue.issue_type != "job_work":
        raise RoutingError(f"{issue.issue_number} is a '{(issue.issue_type or 'general').replace('_', ' ')}' issue, not a job-work challan. "
                           "Issue the material to the vendor in Store › Issues with type Job Work, then link that challan.", 400)
    if op.vendor_id and issue.vendor_id and issue.vendor_id != op.vendor_id:
        raise RoutingError(f"{issue.issue_number} was sent to {issue.vendor_name or 'another vendor'}, but {_op(op)} is routed to a different "
                           "job-work vendor. Link the challan made out to the routing's vendor, or change the vendor on the BOM.", 400)
    taken = db.query(ProductionWorkOrderOperation).filter(
        ProductionWorkOrderOperation.job_work_issue_id == issue.id, ProductionWorkOrderOperation.id != op.id,
    ).first()
    if taken is not None:
        other = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == taken.work_order_id).first()
        raise RoutingError(f"{issue.issue_number} is already linked to {other.wo_number if other else 'another order'} operation {taken.sequence}.")
    op.job_work_issue_id = issue.id
    if not op.vendor_id and issue.vendor_id:
        op.vendor_id = issue.vendor_id


def decorate_operations(db: Session, op_responses: list) -> None:
    from app.modules.accounts.models.vendor import Vendor
    from app.modules.store.models.material_issue import StoreMaterialIssue
    vendor_ids = {o.vendor_id for o in op_responses if o.vendor_id}
    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    issue_ids = {o.job_work_issue_id for o in op_responses if o.job_work_issue_id}
    issues = {i.id: i.issue_number for i in db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id.in_(issue_ids)).all()} if issue_ids else {}
    for o in op_responses:
        o.vendor_name = vendors.get(o.vendor_id)
        o.job_work_issue_number = issues.get(o.job_work_issue_id)
        o.job_work_returned = job_work_returned(db, o.job_work_issue_id) if o.job_work_issue_id else False


def start_problem(db: Session, wo, op) -> str | None:
    if (op.control_key or "internal") == "external" and not op.job_work_issue_id:
        return (f"{_op(op)} is done by a job-work vendor. Send the material out on a Job Work challan (Store › Issues, type Job Work) "
                "and link it to this step before starting it.")
    return None


# ---------------------------------------------------------------------------
# Confirmation + CO11N yield continuity
# ---------------------------------------------------------------------------

def _previous_yield_op(wo, op):
    """Nearest earlier step whose good quantity limits this one. A 'no
    confirmation' step only counts once it is completed (its yield is set
    then); until then the check looks further back."""
    for prev in sorted((o for o in wo.operations if o.sequence < op.sequence), key=lambda o: o.sequence, reverse=True):
        if (prev.confirmation or "optional") == "none" and prev.status != "completed":
            continue
        return prev
    return None


def yield_problem(wo, op, qty_good: float) -> str | None:
    """A step can't confirm more good units than the step before it
    produced (SAP CO11N with yield continuity) — they can't exist yet."""
    if (op.confirmation or "optional") == "none":
        return (f"{_op(op)} is a milestone step (control key: no confirmation), so no time or quantity is booked on it. "
                "Complete it from the work order instead.")
    if not qty_good:
        return None
    prev = _previous_yield_op(wo, op)
    if prev is None:
        return None
    if op.qty_good + qty_good > prev.qty_good + _EPS:
        left = max(round(prev.qty_good - op.qty_good, 4), 0.0)
        return (f"{_op(op)} can't have more good units than the step before it: operation {prev.sequence} {prev.operation_name} has "
                f"confirmed {prev.qty_good:g} good and this step already has {op.qty_good:g}, so at most {left:g} more can be booked, not "
                f"{qty_good:g}. Confirm the earlier step's output first.")
    return None


def completion_problem(db: Session, wo, op, no_yield_reason: str | None) -> str | None:
    if (op.control_key or "internal") == "external":
        if not op.job_work_issue_id:
            return (f"{_op(op)} is external — link the job-work challan the material went out on before completing it.")
        if not job_work_returned(db, op.job_work_issue_id):
            return (f"{_op(op)} is still at the job-work vendor: nothing has come back against its challan yet. Post the Material Return "
                    "or Job Work Receipt in Store first, then complete the step.")
    if (op.confirmation or "optional") == "required" and op.qty_good <= _EPS and (wo.quantity_planned or 0) > 0 \
            and not (no_yield_reason or "").strip():
        return (f"{_op(op)} needs a yield confirmation: no good quantity has been booked on it. Book the time and good quantity "
                "(Shop Floor › Log time), or give the reason it produced nothing (e.g. all units scrapped).")
    return None


def on_complete(wo, op, no_yield_reason: str | None) -> None:
    if (op.confirmation or "optional") == "none" and op.qty_good <= _EPS:
        prev = _previous_yield_op(wo, op)
        op.qty_good = prev.qty_good if prev is not None else wo.quantity_planned
    if (no_yield_reason or "").strip():
        note = f"Completed without yield: {no_yield_reason.strip()}"
        op.remarks = f"{op.remarks}\n{note}" if op.remarks else note
