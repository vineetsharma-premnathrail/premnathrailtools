from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.schemas.payment import PaymentCreate, PaymentResponse
from app.modules.accounts.service import post_payment

router = APIRouter(prefix="/accounts/payments", tags=["Accounts"])


def _write_audit(db: Session, entity_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="payment_transaction", entity_id=entity_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(p: PaymentTransaction, db: Session) -> PaymentResponse:
    bank = db.query(BankAccount).filter(BankAccount.id == p.bank_account_id).first()
    vendor = db.query(Vendor).filter(Vendor.id == p.vendor_id).first() if p.vendor_id else None
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == p.vendor_invoice_id).first() if p.vendor_invoice_id else None
    return PaymentResponse.model_validate(p).model_copy(update={
        "bank_account_label": f"{bank.bank_name} — {bank.account_no}" if bank else None,
        "vendor_name": vendor.name if vendor else None,
        "vendor_invoice_number": invoice.invoice_number if invoice else None,
    })


@router.get("", response_model=list[PaymentResponse])
async def list_payments(
    vendor_id: int | None = Query(None),
    bank_account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(PaymentTransaction)
    if vendor_id is not None:
        query = query.filter(PaymentTransaction.vendor_id == vendor_id)
    if bank_account_id is not None:
        query = query.filter(PaymentTransaction.bank_account_id == bank_account_id)
    payments = query.order_by(PaymentTransaction.created_at.desc()).all()
    return [_to_response(p, db) for p in payments]


@router.post("", response_model=PaymentResponse, status_code=201)
async def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        payment, _entry = post_payment(
            db, vendor_invoice_id=payload.vendor_invoice_id, bank_account_id=payload.bank_account_id,
            amount=payload.amount, payment_mode=payload.payment_mode, payment_date=payload.payment_date,
            cheque_number=payload.cheque_number, cheque_date=payload.cheque_date, created_by_id=user.id,
        )
    except PermissionError as e:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, payment.id, "posted", user, summary=f"{user.name or user.email} recorded payment '{payment.payment_number}' of {payload.amount}.")
    db.commit()
    payment = db.query(PaymentTransaction).filter(PaymentTransaction.id == payment.id).first()
    return _to_response(payment, db)
