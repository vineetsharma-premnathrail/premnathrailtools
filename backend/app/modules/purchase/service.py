"""Shared PR logic used by both the `purchase` module's own routes and the
`erp` service-request routes (raising a PR, marking a material received).

Kept as plain functions (no FastAPI dependencies) so both call sites can
reuse the exact same rules for status transitions and the ServiceMaterial
mirror fields, rather than duplicating them.
"""
from datetime import date
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.purchase.models.purchase_requisition import PurchaseRequisition
from app.modules.purchase.models.purchase_requisition_item import PurchaseRequisitionItem


def _current_financial_year() -> str:
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    return f"{fy_start}-{str(fy_start + 1)[-2:]}"


def generate_pr_number(db: Session) -> str:
    prefix = f"PR-{_current_financial_year()}-"
    last = db.query(func.max(PurchaseRequisition.pr_number)).filter(
        PurchaseRequisition.pr_number.like(f"{prefix}%")
    ).scalar()
    if last:
        last_num = int(last.rsplit("-", 1)[-1])
        return f"{prefix}{last_num + 1:04d}"
    return f"{prefix}0001"


def raise_requisition(
    db: Session,
    project_id: int,
    service_request_id: int,
    materials: list[ServiceMaterial],
    raised_by_id: int | None,
) -> PurchaseRequisition:
    """Create a PR snapshotting `materials` and link each one back to it.

    Caller is responsible for filtering `materials` down to the ones that
    should go into this PR (e.g. not already linked to another open PR) and
    for flushing/committing afterwards.
    """
    pr = PurchaseRequisition(
        pr_number=generate_pr_number(db),
        project_id=project_id,
        service_request_id=service_request_id,
        status="submitted",
        raised_by_id=raised_by_id,
    )
    db.add(pr)
    db.flush()

    for mat in materials:
        db.add(PurchaseRequisitionItem(
            purchase_requisition_id=pr.id,
            service_material_id=mat.id,
            material_name=mat.material_name,
            part_number=mat.part_number,
            unit=mat.unit,
            quantity_requested=mat.quantity,
            quantity_received=0,
            item_status="pending",
        ))
        mat.pr_id = pr.id
        mat.pr_number = pr.pr_number
        mat.pr_status = pr.status

    db.flush()
    return pr


def sync_material_pr_fields(db: Session, pr: PurchaseRequisition) -> None:
    """Mirror this PR's number/status onto every ServiceMaterial it covers,
    so the SR's Materials tab can show PR state without joining across modules."""
    material_ids = [item.service_material_id for item in pr.items]
    if not material_ids:
        return
    db.query(ServiceMaterial).filter(ServiceMaterial.id.in_(material_ids)).update(
        {"pr_number": pr.pr_number, "pr_status": pr.status}, synchronize_session=False
    )


def unlink_materials(db: Session, pr: PurchaseRequisition) -> None:
    """Detach this PR from its materials (on reject/cancel) so they become
    eligible to be raised again into a fresh PR."""
    material_ids = [item.service_material_id for item in pr.items]
    if not material_ids:
        return
    db.query(ServiceMaterial).filter(ServiceMaterial.id.in_(material_ids)).update(
        {"pr_id": None, "pr_number": None, "pr_status": None}, synchronize_session=False
    )


def _recompute_status_after_receipt(db: Session, pr: PurchaseRequisition) -> None:
    if pr.status in ("closed", "rejected", "cancelled"):
        return
    total_requested = sum(item.quantity_requested for item in pr.items)
    total_received = sum(item.quantity_received for item in pr.items)
    if total_received <= 0:
        pass
    elif total_received < total_requested:
        pr.status = "partially_received"
    else:
        pr.status = "received"
    sync_material_pr_fields(db, pr)


def mark_material_received(db: Session, material: ServiceMaterial, received_quantity: float) -> PurchaseRequisition | None:
    """Record a (possibly partial) physical receipt of `material` at the
    service site, syncing quantity/status onto the linked PurchaseRequisitionItem
    and recomputing the parent PR's status. Returns the PR if one is linked."""
    received_quantity = max(0.0, min(received_quantity, material.quantity))
    material.received_quantity = received_quantity
    if received_quantity <= 0:
        material.receiving_status = "pending"
    elif received_quantity < material.quantity:
        material.receiving_status = "partial"
    else:
        material.receiving_status = "received"

    if not material.pr_id:
        return None

    pr = db.query(PurchaseRequisition).filter(PurchaseRequisition.id == material.pr_id).first()
    if not pr:
        return None

    item = db.query(PurchaseRequisitionItem).filter(
        PurchaseRequisitionItem.purchase_requisition_id == pr.id,
        PurchaseRequisitionItem.service_material_id == material.id,
    ).first()
    if item:
        item.quantity_received = received_quantity
        item.item_status = material.receiving_status

    db.flush()
    _recompute_status_after_receipt(db, pr)
    return pr
