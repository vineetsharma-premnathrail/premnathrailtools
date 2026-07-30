from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.purchase.models.purchase_requisition import PurchaseRequisition
from app.modules.purchase.schemas.purchase_requisition import (
    PurchaseRequisitionResponse,
    PurchaseRequisitionUpdate,
    PurchaseRequisitionActionPayload,
)
from app.modules.purchase.service import sync_material_pr_fields, unlink_materials
from app.utils.notifications import broadcast_notification, notify_user

router = APIRouter(prefix="/purchase/requisitions", tags=["Purchase"])


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="purchase_requisition", entity_id=pr_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(db: Session, pr: PurchaseRequisition) -> PurchaseRequisitionResponse:
    project = db.query(Project).filter(Project.id == pr.project_id).first()
    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    resp = PurchaseRequisitionResponse.model_validate(pr)
    if project:
        resp.project_label = f"{project.serial_number} — {project.model_name}" if project.model_name else project.serial_number
        resp.client_company = project.client_company
        resp.site_name = project.site_name
    if sr:
        resp.sr_request_number = sr.request_number
    return resp


@router.get("", response_model=list[PurchaseRequisitionResponse])
async def list_requisitions(
    status: str | None = None,
    project_id: int | None = None,
    service_request_id: int | None = None,
    search: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    query = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items))
    if status:
        query = query.filter(PurchaseRequisition.status == status)
    if project_id:
        query = query.filter(PurchaseRequisition.project_id == project_id)
    if service_request_id:
        query = query.filter(PurchaseRequisition.service_request_id == service_request_id)
    if search:
        query = query.filter(PurchaseRequisition.pr_number.ilike(f"%{search}%"))

    prs = query.order_by(PurchaseRequisition.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, pr) for pr in prs]


@router.get("/{pr_id}", response_model=PurchaseRequisitionResponse)
async def get_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    return _to_response(db, pr)


@router.get("/{pr_id}/audit")
async def get_requisition_audit(
    pr_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "purchase_requisition", AuditLog.entity_id == pr_id
    ).order_by(AuditLog.performed_at.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


@router.patch("/{pr_id}", response_model=PurchaseRequisitionResponse)
async def update_requisition(
    pr_id: int,
    payload: PurchaseRequisitionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Update vendor/PO/delivery-date details. Does not change status."""
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status in ("closed", "rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot edit a {pr.status} purchase requisition")

    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(pr, field, val)

    if payload.po_number and pr.status == "approved":
        pr.status = "po_raised"
        sync_material_pr_fields(db, pr)

    _write_audit(db, pr.id, "updated", user, summary=f"{user.name or user.email} updated purchase requisition {pr.pr_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/approve", response_model=PurchaseRequisitionResponse)
async def approve_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Only a submitted PR can be approved (current status: {pr.status})")

    pr.status = "approved"
    pr.approved_by_id = user.id
    pr.approved_at = datetime.now(timezone.utc)
    sync_material_pr_fields(db, pr)
    _write_audit(db, pr.id, "approved", user, summary=f"{user.name or user.email} approved purchase requisition {pr.pr_number}.")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr and sr.created_by_id:
        notify_user(
            db, user_id=sr.created_by_id,
            title="Purchase Requisition Approved",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' was approved by {user.name or user.email}.",
            notification_type="pr_approved", entity_type="purchase_requisition", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/reject", response_model=PurchaseRequisitionResponse)
async def reject_requisition(
    pr_id: int,
    payload: PurchaseRequisitionActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status not in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a PR with status '{pr.status}'")

    pr.status = "rejected"
    unlink_materials(db, pr)
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "rejected", user, summary=f"{user.name or user.email} rejected purchase requisition {pr.pr_number}.{reason_note}")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr and sr.created_by_id:
        notify_user(
            db, user_id=sr.created_by_id,
            title="Purchase Requisition Rejected",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' was rejected by {user.name or user.email}.{reason_note}",
            notification_type="pr_rejected", entity_type="purchase_requisition", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/cancel", response_model=PurchaseRequisitionResponse)
async def cancel_requisition(
    pr_id: int,
    payload: PurchaseRequisitionActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status in ("closed", "rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel a PR with status '{pr.status}'")

    pr.status = "cancelled"
    unlink_materials(db, pr)
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "cancelled", user, summary=f"{user.name or user.email} cancelled purchase requisition {pr.pr_number}.{reason_note}")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/close", response_model=PurchaseRequisitionResponse)
async def close_requisition(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = db.query(PurchaseRequisition).options(selectinload(PurchaseRequisition.items)).filter(PurchaseRequisition.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase requisition not found")
    if pr.status != "received":
        raise HTTPException(status_code=409, detail="A purchase requisition can only be closed once every item has been received.")

    pr.status = "closed"
    pr.closed_by_id = user.id
    pr.closed_at = datetime.now(timezone.utc)
    sync_material_pr_fields(db, pr)
    _write_audit(db, pr.id, "closed", user, summary=f"{user.name or user.email} closed purchase requisition {pr.pr_number}.")

    sr = db.query(ServiceRequest).filter(ServiceRequest.id == pr.service_request_id).first()
    if sr:
        broadcast_notification(
            db,
            title="Purchase Requisition Closed",
            message=f"PR '{pr.pr_number}' for SR '{sr.request_number}' has been closed by {user.name or user.email}.",
            notification_type="pr_closed", entity_type="purchase_requisition", entity_id=pr.id,
            exclude_user_id=user.id, app_name="erp",
        )
        if sr.created_by_id and sr.created_by_id != user.id:
            notify_user(
                db, user_id=sr.created_by_id,
                title="Purchase Requisition Closed",
                message=f"PR '{pr.pr_number}' on your SR '{sr.request_number}' has been closed by {user.name or user.email}.",
                notification_type="pr_closed", entity_type="purchase_requisition", entity_id=pr.id,
            )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)
