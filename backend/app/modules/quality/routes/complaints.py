from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.customer_complaint import (
    QualityCustomerComplaint,
    QUALITY_COMPLAINT_SEVERITIES,
    QUALITY_COMPLAINT_STATUSES,
)
from app.modules.quality.schemas.customer_complaint import (
    QualityCustomerComplaintCreate,
    QualityCustomerComplaintUpdate,
    QualityCustomerComplaintResponse,
)
from app.modules.quality.service import generate_complaint_number

router = APIRouter(
    prefix="/quality/complaints", tags=["Quality"],
    dependencies=[Depends(require_app_access("quality"))],
)


def _to_response(db: Session, complaint: QualityCustomerComplaint) -> QualityCustomerComplaintResponse:
    resp = QualityCustomerComplaintResponse.model_validate(complaint)
    if complaint.received_by_id:
        receiver = db.query(User).filter(User.id == complaint.received_by_id).first()
        if receiver:
            resp.received_by_name = receiver.name or receiver.email
    return resp


def _get_or_404(db: Session, complaint_id: int) -> QualityCustomerComplaint:
    complaint = db.query(QualityCustomerComplaint).filter(QualityCustomerComplaint.is_deleted == False, QualityCustomerComplaint.id == complaint_id).first()  # noqa: E712
    if not complaint:
        raise HTTPException(status_code=404, detail="Customer complaint not found")
    return complaint


@router.get("", response_model=list[QualityCustomerComplaintResponse])
async def list_complaints(
    status_filter: str | None = Query(None, alias="status"),
    severity: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityCustomerComplaint).filter(QualityCustomerComplaint.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(QualityCustomerComplaint.status == status_filter)
    if severity:
        query = query.filter(QualityCustomerComplaint.severity == severity)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (QualityCustomerComplaint.customer_name.ilike(like))
            | (QualityCustomerComplaint.complaint_number.ilike(like))
            | (QualityCustomerComplaint.description.ilike(like))
        )
    complaints = query.order_by(QualityCustomerComplaint.created_at.desc()).all()
    return [_to_response(db, c) for c in complaints]


@router.post("", response_model=QualityCustomerComplaintResponse)
async def create_complaint(
    payload: QualityCustomerComplaintCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    if payload.severity not in QUALITY_COMPLAINT_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{payload.severity}'")

    complaint = QualityCustomerComplaint(
        complaint_number=generate_complaint_number(db),
        customer_name=payload.customer_name,
        customer_org_id=payload.customer_org_id,
        item_name=payload.item_name,
        item_code=payload.item_code,
        description=payload.description,
        severity=payload.severity,
        complaint_date=payload.complaint_date,
        received_by_id=user.id,
        resolution_notes=payload.resolution_notes,
        remarks=payload.remarks,
        status="open",
    )
    db.add(complaint)
    db.commit()
    db.refresh(complaint)
    return _to_response(db, complaint)


@router.get("/{complaint_id}", response_model=QualityCustomerComplaintResponse)
async def get_complaint(complaint_id: int, db: Session = Depends(get_db)):
    complaint = _get_or_404(db, complaint_id)
    return _to_response(db, complaint)


@router.patch("/{complaint_id}", response_model=QualityCustomerComplaintResponse)
async def update_complaint(
    complaint_id: int,
    payload: QualityCustomerComplaintUpdate,
    db: Session = Depends(get_db),
):
    complaint = _get_or_404(db, complaint_id)
    updates = payload.model_dump(exclude_unset=True)

    new_severity = updates.get("severity")
    if new_severity and new_severity not in QUALITY_COMPLAINT_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity '{new_severity}'")
    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_COMPLAINT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")

    if new_status == "closed" and complaint.closed_at is None:
        complaint.closed_at = datetime.now(timezone.utc)

    for field, val in updates.items():
        setattr(complaint, field, val)

    db.commit()
    db.refresh(complaint)
    return _to_response(db, complaint)


@router.delete("/{complaint_id}")
async def delete_complaint(complaint_id: int, db: Session = Depends(get_db)):
    complaint = _get_or_404(db, complaint_id)
    # Soft delete — quality records are retained for audit (ISO 9001 §7.5.3),
    # and the delete itself is logged by app/core/audit.py.
    complaint.is_deleted = True
    complaint.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Customer complaint deleted"}
