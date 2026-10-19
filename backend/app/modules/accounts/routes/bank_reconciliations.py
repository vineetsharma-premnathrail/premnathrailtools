from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.schemas.bank_reconciliation import (
    BankReconciliationCreate, BankReconciliationResponse, ReconcilePaymentsPayload, UnreconciledPaymentResponse,
)
from app.modules.accounts.service import (
    create_bank_reconciliation, mark_payments_reconciled, complete_bank_reconciliation, compute_reconciliation_summary,
    voucher_sides,
)
from app.modules.accounts import access  # noqa: F401 — registers BankReconciliation's data scope

router = APIRouter(prefix="/accounts/bank-reconciliations", tags=["Accounts"])


def _in_scope(db: Session, user: User, recon_id: int) -> BankReconciliation:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == recon_id).first()
    if not recon:
        raise HTTPException(status_code=404, detail=f"Bank reconciliation #{recon_id} doesn't exist — it may have been removed. Refresh the Reconciliation list.")
    ensure_in_scope(db, user, recon)
    return recon


def _write_audit(db: Session, entity_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="bank_reconciliation", entity_id=entity_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(recon: BankReconciliation, db: Session) -> BankReconciliationResponse:
    bank = db.query(BankAccount).filter(BankAccount.id == recon.bank_account_id).first()
    completer = db.query(User).filter(User.id == recon.completed_by_id).first() if recon.completed_by_id else None
    summary = compute_reconciliation_summary(db, recon.id)
    return BankReconciliationResponse.model_validate(recon).model_copy(update={
        "bank_account_label": (f"{bank.bank_name} — {bank.account_no}" if bank.account_no else bank.bank_name) if bank else None,
        "completed_by_name": (completer.name or completer.email) if completer else None,
        **summary,
    })


@router.get("", response_model=list[BankReconciliationResponse])
async def list_bank_reconciliations(
    bank_account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "reconciliation")),
):
    query = apply_scope(db.query(BankReconciliation), user, BankReconciliation)
    if bank_account_id is not None:
        query = query.filter(BankReconciliation.bank_account_id == bank_account_id)
    recons = query.order_by(BankReconciliation.statement_date.desc()).all()
    return [_to_response(r, db) for r in recons]


@router.get("/{bank_reconciliation_id}", response_model=BankReconciliationResponse)
async def get_bank_reconciliation(
    bank_reconciliation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "reconciliation")),
):
    recon = _in_scope(db, user, bank_reconciliation_id)
    return _to_response(recon, db)


@router.get("/{bank_reconciliation_id}/unreconciled-payments", response_model=list[UnreconciledPaymentResponse])
async def list_unreconciled_payments(
    bank_reconciliation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "reconciliation")),
):
    recon = _in_scope(db, user, bank_reconciliation_id)

    from app.modules.crm.models.organization import Organization

    sides = voucher_sides(db, recon.bank_account_id, as_of=recon.statement_date)
    payments = [s["payment"] for s in sides]
    vendor_ids = {p.vendor_id for p in payments} - {None}
    vendors = {v.id: v for v in db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all()} if vendor_ids else {}
    customer_ids = {p.customer_id for p in payments} - {None}
    customers = {o.id: o for o in db.query(Organization).filter(Organization.id.in_(customer_ids)).all()} if customer_ids else {}

    results = []
    for s in sides:
        p = s["payment"]
        resp = UnreconciledPaymentResponse.model_validate(p)
        resp.direction = s["direction"]
        if p.vendor_id and p.vendor_id in vendors:
            resp.vendor_name = vendors[p.vendor_id].name
        if p.customer_id and p.customer_id in customers:
            resp.customer_name = customers[p.customer_id].name
        resp.party_name = resp.vendor_name or resp.customer_name or p.narration
        results.append(resp)
    return results


@router.post("", response_model=BankReconciliationResponse, status_code=201)
async def create_bank_reconciliation_route(
    payload: BankReconciliationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "reconciliation", "create")),
):
    try:
        recon = create_bank_reconciliation(
            db, bank_account_id=payload.bank_account_id, statement_date=payload.statement_date,
            statement_balance=payload.statement_balance, created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, recon.id, "created", user, summary=f"{user.name or user.email} started a bank reconciliation for statement date {payload.statement_date}.")
    db.commit()
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == recon.id).first()
    return _to_response(recon, db)


@router.post("/{bank_reconciliation_id}/reconcile-payments", response_model=BankReconciliationResponse)
async def reconcile_payments_route(
    bank_reconciliation_id: int,
    payload: ReconcilePaymentsPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "reconciliation", "edit")),
):
    _in_scope(db, user, bank_reconciliation_id)
    try:
        mark_payments_reconciled(db, bank_reconciliation_id=bank_reconciliation_id, payment_transaction_ids=payload.payment_transaction_ids,
                                 cleared_date=payload.cleared_date)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, bank_reconciliation_id, "payments_matched", user, summary=f"{user.name or user.email} matched {len(payload.payment_transaction_ids)} payment(s) as reconciled.")
    db.commit()
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    return _to_response(recon, db)


@router.post("/{bank_reconciliation_id}/complete", response_model=BankReconciliationResponse)
async def complete_bank_reconciliation_route(
    bank_reconciliation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "reconciliation", "completion", "approve")),
):
    _in_scope(db, user, bank_reconciliation_id)
    try:
        complete_bank_reconciliation(db, bank_reconciliation_id=bank_reconciliation_id, completed_by_id=user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, bank_reconciliation_id, "completed", user, summary=f"{user.name or user.email} completed the bank reconciliation.")
    db.commit()
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == bank_reconciliation_id).first()
    return _to_response(recon, db)
