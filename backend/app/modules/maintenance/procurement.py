"""Work order ↔ purchase requisition link (SAP IW32 external services /
non-stock components): the PRs raised from a job, their PO status and the
cost that flows back.

Cost rule (no double counting):
  * spares PR: the GRN receives the parts into Store; they reach the job's
    cost when issued on the work order (spares_cost), so the PR adds nothing.
  * external_service PR: the PO's service lines (Item Master type
    'service') never touch Store; the taxable value of the POSTED vendor
    invoice lines against them is the job's procured_cost. Until the bill is
    posted the PO value is shown as committed only."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.maintenance.models.wo_procurement import MaintenanceWorkOrderPurchaseRequest
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder


def links_for(db: Session, wo_id: int) -> list[MaintenanceWorkOrderPurchaseRequest]:
    return db.query(MaintenanceWorkOrderPurchaseRequest).filter(
        MaintenanceWorkOrderPurchaseRequest.work_order_id == wo_id).order_by(MaintenanceWorkOrderPurchaseRequest.id).all()


def _service_po_lines(db: Session, pr_ids: list[int]):
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
    if not pr_ids:
        return []
    return db.query(P2PPurchaseOrderItem, P2PPurchaseOrder).join(
        P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id,
    ).filter(
        P2PPurchaseOrder.p2p_request_id.in_(pr_ids), P2PPurchaseOrder.status != "cancelled",
        P2PPurchaseOrderItem.item_category == "service",
    ).all()


def _po_line_value(item) -> float:
    if item.line_total is not None:
        return float(item.line_total)
    return float(item.quantity or 0) * float(item.unit_price or 0)


def procured_amounts(db: Session, wo_id: int) -> tuple[float, float]:
    """(invoiced = posted vendor-invoice taxable value of the service lines,
    committed = PO value of those lines)."""
    from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine
    pr_ids = [l.p2p_request_id for l in links_for(db, wo_id) if l.purpose == "external_service"]
    rows = _service_po_lines(db, pr_ids)
    if not rows:
        return 0.0, 0.0
    committed = round(sum(_po_line_value(item) for item, _po in rows), 2)
    line_ids = [item.id for item, _po in rows]
    invoiced = 0.0
    for (amount,) in db.query(VendorInvoiceLine.taxable_amount).join(
        VendorInvoice, VendorInvoice.id == VendorInvoiceLine.vendor_invoice_id,
    ).filter(VendorInvoiceLine.po_item_id.in_(line_ids), VendorInvoice.status == "posted").all():
        invoiced += float(amount or 0)
    return round(invoiced, 2), committed


def refresh_procured_cost(db: Session, wo: MaintenanceWorkOrder) -> bool:
    """Pull the posted vendor-invoice value into wo.procured_cost (closed /
    cancelled jobs keep their frozen cost). Returns True if it changed."""
    if wo.status in ("closed", "cancelled"):
        return False
    invoiced, _committed = procured_amounts(db, wo.id)
    if abs((wo.procured_cost or 0) - invoiced) < 0.005:
        return False
    from app.modules.maintenance.service import recompute_costs
    wo.procured_cost = invoiced
    recompute_costs(wo)
    return True


def summary(db: Session, wo_id: int) -> list[dict]:
    """Each linked PR with its status, its POs (number / vendor / status /
    value) and, for service PRs, the invoiced amount."""
    from app.modules.accounts.models.vendor_invoice import VendorInvoice, VendorInvoiceLine
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    out = []
    for link in links_for(db, wo_id):
        pr = db.get(P2PRequest, link.p2p_request_id)
        if pr is None:
            continue
        pos = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.p2p_request_id == pr.id).order_by(P2PPurchaseOrder.id).all()
        po_rows = []
        for po in pos:
            invoiced = 0.0
            item_ids = [i.id for i in po.items]
            if item_ids:
                for (amount,) in db.query(VendorInvoiceLine.taxable_amount).join(
                    VendorInvoice, VendorInvoice.id == VendorInvoiceLine.vendor_invoice_id,
                ).filter(VendorInvoiceLine.po_item_id.in_(item_ids), VendorInvoice.status == "posted").all():
                    invoiced += float(amount or 0)
            po_rows.append({
                "id": po.id, "po_number": po.po_number, "vendor_name": po.vendor_name, "status": po.status,
                "total_value": float(po.total_value or 0), "invoiced_amount": round(invoiced, 2),
            })
        out.append({
            "id": link.id, "p2p_request_id": pr.id, "p2p_number": pr.p2p_number, "purpose": link.purpose,
            "status": pr.status, "required_date": pr.required_date, "priority": pr.priority,
            "lines": [{"item_name": i.item_name, "quantity": i.quantity, "unit": i.unit,
                       "fulfillment_status": i.fulfillment_status} for i in pr.items],
            "purchase_orders": po_rows, "created_at": link.created_at,
        })
    return out
