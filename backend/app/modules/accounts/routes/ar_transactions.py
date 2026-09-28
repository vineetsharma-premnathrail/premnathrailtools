from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.crm.models.organization import Organization
from app.modules.accounts.schemas.ar_transaction import ARTransactionCreate, ARTransactionResponse, CollectionCreate
from app.modules.accounts.service import create_ar_transaction, post_customer_invoice, post_collection, compute_days_outstanding

router = APIRouter(prefix="/accounts/ar-transactions", tags=["Accounts"])


def _write_audit(db: Session, entity_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="ar_transaction", entity_id=entity_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(txn: ARTransaction, db: Session) -> ARTransactionResponse:
    customer = db.query(Organization).filter(Organization.id == txn.customer_id).first()
    gl_account = db.query(GLAccount).filter(GLAccount.id == txn.revenue_gl_account_id).first()
    days_outstanding = compute_days_outstanding(txn) if txn.status == "posted" and txn.collection_status != "collected" else None
    return ARTransactionResponse.model_validate(txn).model_copy(update={
        "customer_name": customer.name if customer else None,
        "revenue_gl_account_code": gl_account.code if gl_account else None,
        "days_outstanding": days_outstanding,
    })


@router.get("", response_model=list[ARTransactionResponse])
async def list_ar_transactions(
    status: str | None = Query(None),
    collection_status: str | None = Query(None),
    customer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(ARTransaction)
    if status is not None:
        query = query.filter(ARTransaction.status == status)
    if collection_status is not None:
        query = query.filter(ARTransaction.collection_status == collection_status)
    if customer_id is not None:
        query = query.filter(ARTransaction.customer_id == customer_id)
    transactions = query.order_by(ARTransaction.created_at.desc()).all()
    return [_to_response(t, db) for t in transactions]


@router.get("/{ar_transaction_id}", response_model=ARTransactionResponse)
async def get_ar_transaction(
    ar_transaction_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="AR transaction not found")
    return _to_response(transaction, db)


@router.post("", response_model=ARTransactionResponse, status_code=201)
async def create_ar_transaction_route(
    payload: ARTransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        transaction = create_ar_transaction(
            db, customer_id=payload.customer_id, invoice_date=payload.invoice_date, invoice_amount=payload.invoice_amount,
            gst_amount=payload.gst_amount, discount_amount=payload.discount_amount,
            revenue_gl_account_id=payload.revenue_gl_account_id, reference_type=payload.reference_type,
            reference_id=payload.reference_id, created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, transaction.id, "created", user, summary=f"{user.name or user.email} recorded customer invoice '{transaction.invoice_number}'.")
    db.commit()
    transaction = db.query(ARTransaction).filter(ARTransaction.id == transaction.id).first()
    return _to_response(transaction, db)


@router.post("/{ar_transaction_id}/post", response_model=ARTransactionResponse)
async def post_ar_transaction_route(
    ar_transaction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        post_customer_invoice(db, ar_transaction_id=ar_transaction_id, created_by_id=user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    _write_audit(db, transaction.id, "posted", user, summary=f"{user.name or user.email} posted customer invoice '{transaction.invoice_number}' to the GL.")
    db.commit()
    transaction = db.query(ARTransaction).filter(ARTransaction.id == transaction.id).first()
    return _to_response(transaction, db)


@router.post("/{ar_transaction_id}/collect", response_model=ARTransactionResponse)
async def collect_ar_transaction_route(
    ar_transaction_id: int,
    payload: CollectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        post_collection(
            db, ar_transaction_id=ar_transaction_id, bank_account_id=payload.bank_account_id, amount=payload.amount,
            payment_mode=payload.payment_mode, payment_date=payload.payment_date, created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    transaction = db.query(ARTransaction).filter(ARTransaction.id == ar_transaction_id).first()
    _write_audit(db, transaction.id, "collected", user, summary=f"{user.name or user.email} recorded a collection of {payload.amount} against invoice '{transaction.invoice_number}'.")
    db.commit()
    transaction = db.query(ARTransaction).filter(ARTransaction.id == transaction.id).first()
    return _to_response(transaction, db)
