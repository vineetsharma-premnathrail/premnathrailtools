from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.payment_term import PaymentTerm
from app.modules.crm.schemas.payment_term import PaymentTermCreate, PaymentTermUpdate, PaymentTermResponse

router = APIRouter(prefix="/crm/payment-terms", tags=["CRM - Payment Terms"])


def _can_modify(record, user: User) -> bool:
    return user.role == "admin" or record.created_by_id == user.id


@router.get("", response_model=list[PaymentTermResponse])
async def list_payment_terms(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    return db.query(PaymentTerm).filter(PaymentTerm.is_deleted == False).order_by(PaymentTerm.id.desc()).all()  # noqa: E712


@router.post("", response_model=PaymentTermResponse, status_code=201)
async def create_payment_term(
    payload: PaymentTermCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    term = PaymentTerm(**payload.model_dump(), created_by_id=user.id, created_at=datetime.now(timezone.utc))
    db.add(term)
    db.commit()
    db.refresh(term)
    return term


@router.patch("/{term_id}", response_model=PaymentTermResponse)
async def update_payment_term(
    term_id: int,
    payload: PaymentTermUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    term = db.query(PaymentTerm).filter(PaymentTerm.id == term_id, PaymentTerm.is_deleted == False).first()  # noqa: E712
    if not term:
        raise HTTPException(status_code=404, detail="Payment term not found")
    if not _can_modify(term, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this payment term.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(term, field, value)
    db.commit()
    db.refresh(term)
    return term


@router.delete("/{term_id}")
async def delete_payment_term(
    term_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    term = db.query(PaymentTerm).filter(PaymentTerm.id == term_id, PaymentTerm.is_deleted == False).first()  # noqa: E712
    if not term:
        raise HTTPException(status_code=404, detail="Payment term not found")
    if not _can_modify(term, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this payment term.")
    term.is_deleted = True
    term.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}
