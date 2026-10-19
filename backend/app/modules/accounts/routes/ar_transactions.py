from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.crm.models.organization import Organization
from app.modules.accounts.schemas.ar_transaction import (
    ARTransactionCreate, ARTransactionResponse, CollectionCreate, ARTransactionCancelPayload, ARTransactionEInvoicePayload,
)
from app.modules.accounts.service import (
    create_ar_transaction, post_collection, compute_days_outstanding, cancel_ar_transaction,
)
from app.modules.accounts.services.outstanding import allocation_history
from app.modules.accounts.routes._common import write_audit, who, service_errors, user_names, gl_labels, tax_lines_response
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/ar-transactions", tags=["Accounts"])


def _load(db: Session, txn_id: int) -> ARTransaction | None:
    return db.query(ARTransaction).options(selectinload(ARTransaction.lines)).filter(ARTransaction.id == txn_id).first()


def _load_in_scope(db: Session, user: User, txn_id: int) -> ARTransaction:
    transaction = _load(db, txn_id)
    if not transaction:
        raise HTTPException(status_code=404, detail=f"Sales invoice #{txn_id} doesn't exist — it may have been removed. Refresh the Sales Invoices list.")
    ensure_in_scope(db, user, transaction)
    return transaction


def _to_response(txn: ARTransaction, db: Session, approval: dict | None = None) -> ARTransactionResponse:
    customer = db.query(Organization).filter(Organization.id == txn.customer_id).first()
    gl = gl_labels(db, {txn.revenue_gl_account_id}).get(txn.revenue_gl_account_id)
    open_ = txn.status == "posted" and txn.amount_due > 0.005
    return ARTransactionResponse.model_validate(txn).model_copy(update={
        "customer_name": customer.name if customer else None,
        "revenue_gl_account_code": gl.code if gl else None,
        "days_outstanding": compute_days_outstanding(txn) if open_ else None,
        "days_overdue": max((date.today() - txn.due_date).days, 0) if open_ else None,
        # 'overdue' is derived at read time (never stored): posted, unpaid, past due.
        "collection_status": "overdue" if open_ and txn.due_date and txn.due_date < date.today() else txn.collection_status,
        "created_by_name": user_names(db, {txn.created_by_id}).get(txn.created_by_id),
        "lines": tax_lines_response(db, txn.lines),
        **(approval if approval is not None else access.approval_state(db, access.ET_SALES_INVOICE, txn.id)),
    })


@router.get("", response_model=list[ARTransactionResponse])
async def list_ar_transactions(
    status: str | None = Query(None),
    collection_status: str | None = Query(None),
    customer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "sales_invoices")),
):
    query = apply_scope(db.query(ARTransaction).options(selectinload(ARTransaction.lines)), user, ARTransaction)
    if status is not None:
        query = query.filter(ARTransaction.status == status)
    if collection_status == "overdue":
        query = query.filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0.005,
                             ARTransaction.due_date < date.today())
    elif collection_status is not None:
        query = query.filter(ARTransaction.collection_status == collection_status)
        if collection_status in ("pending", "partial"):
            # Rows shown as 'overdue' (derived in _to_response) must not appear under Pending/Partial.
            query = query.filter(or_(ARTransaction.due_date.is_(None), ARTransaction.due_date >= date.today(),
                                     ARTransaction.amount_due <= 0.005, ARTransaction.status != "posted"))
    if customer_id is not None:
        query = query.filter(ARTransaction.customer_id == customer_id)
    transactions = query.order_by(ARTransaction.invoice_date.desc(), ARTransaction.id.desc()).limit(500).all()
    states = access.approval_states(db, access.ET_SALES_INVOICE, [t.id for t in transactions if t.status == "pending"])
    return [_to_response(t, db, states.get(t.id, {})) for t in transactions]


@router.get("/{ar_transaction_id}", response_model=ARTransactionResponse)
async def get_ar_transaction(
    ar_transaction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "sales_invoices")),
):
    return _to_response(_load_in_scope(db, user, ar_transaction_id), db)


@router.get("/{ar_transaction_id}/settlements")
async def ar_transaction_settlements(ar_transaction_id: int, db: Session = Depends(get_db),
                                     user: User = Depends(require_feature_action("accounts", "sales_invoices", "settlements", "view"))):
    _load_in_scope(db, user, ar_transaction_id)
    return allocation_history(db, target_type="ar_transaction", target_id=ar_transaction_id)


@router.post("", response_model=ARTransactionResponse, status_code=201)
async def create_ar_transaction_route(
    payload: ARTransactionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "sales_invoices", "create")),
):
    with service_errors(db):
        transaction = create_ar_transaction(db, created_by_id=user.id, **payload.model_dump())
    write_audit(db, "ar_transaction", transaction.id, "created", user, f"{who(user)} drafted a sales invoice for {transaction.total_amount:,.2f}.")
    db.commit()
    return _to_response(_load(db, transaction.id), db)


def _approval_args(txn: ARTransaction, db: Session) -> dict:
    customer = db.query(Organization).filter(Organization.id == txn.customer_id).first()
    party = customer.name if customer else f"customer #{txn.customer_id}"
    return dict(entity_id=txn.id, title=f"Sales invoice to {party} dated {txn.invoice_date:%d-%b-%Y}"[:300],
                reference=None, amount=txn.total_amount, context={})


def _ensure_pending(txn: ARTransaction) -> None:
    if txn.status != "pending":
        raise HTTPException(status_code=400, detail=f"Only a draft (unissued) sales invoice goes through approval (current status: '{txn.status}').")


@router.post("/{ar_transaction_id}/submit", response_model=ARTransactionResponse)
async def submit_ar_transaction_route(
    ar_transaction_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "sales_invoices", "submit")),
):
    """Send a draft sales invoice to its approvers (Organization › Approval
    Workflows, 'Sales invoice'). It gets its SI number and posts on the last approval."""
    transaction = _load_in_scope(db, user, ar_transaction_id)
    _ensure_pending(transaction)
    access.submit_document(db, access.KEY_SALES_INVOICE, requester=user, background_tasks=background_tasks, **_approval_args(transaction, db))
    write_audit(db, "ar_transaction", transaction.id, "submitted", user, f"{who(user)} submitted a draft sales invoice of {transaction.total_amount:,.2f} for approval.")
    db.commit()
    return _to_response(_load(db, transaction.id), db)


@router.post("/{ar_transaction_id}/post", response_model=ARTransactionResponse)
async def post_ar_transaction_route(
    ar_transaction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "sales_invoices", "approve")),
):
    """The approver's one click: approves the invoice's current approval stage
    (submitting it on the maker's behalf if nobody did yet). It is numbered and
    posted once the workflow's last stage is approved."""
    transaction = _load_in_scope(db, user, ar_transaction_id)
    _ensure_pending(transaction)
    with service_errors(db):
        access.approve_now(db, access.KEY_SALES_INVOICE, maker_id=transaction.created_by_id, actor=user,
                           **_approval_args(transaction, db))
    db.commit()
    return _to_response(_load(db, transaction.id), db)


@router.post("/{ar_transaction_id}/cancel", response_model=ARTransactionResponse)
async def cancel_ar_transaction_route(
    ar_transaction_id: int,
    payload: ARTransactionCancelPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "sales_invoices")),
):
    # Cancelling an unposted draft is its delete: 'Delete' on the tab + own draft.
    draft = _load_in_scope(db, user, ar_transaction_id)
    ensure_can_delete(user, draft, "accounts", "sales_invoices", what="draft sales invoice")
    if draft.status == "pending":
        access.cancel_live(db, access.ET_SALES_INVOICE, draft.id, user, payload.reason)
    with service_errors(db):
        transaction = cancel_ar_transaction(db, ar_transaction_id=ar_transaction_id, reason=payload.reason, user_id=user.id)
    write_audit(db, "ar_transaction", transaction.id, "cancelled", user, f"{who(user)} cancelled a draft sales invoice: {payload.reason}")
    db.commit()
    return _to_response(_load(db, transaction.id), db)


@router.patch("/{ar_transaction_id}/e-invoice", response_model=ARTransactionResponse)
async def update_e_invoice_route(
    ar_transaction_id: int,
    payload: ARTransactionEInvoicePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "sales_invoices", "e_invoice", "edit")),
):
    """IRN / e-way bill details are only known after generating them on the
    government portal, so they can be added to an issued invoice — they
    don't change any amount."""
    transaction = _load_in_scope(db, user, ar_transaction_id)
    if transaction.status == "cancelled":
        raise HTTPException(status_code=400, detail="This invoice is cancelled.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("irn") and len(data["irn"].strip()) != 64:
        raise HTTPException(status_code=400, detail="An IRN is exactly 64 characters — copy it in full from the e-invoice portal.")
    if data.get("eway_bill_no") and not (data["eway_bill_no"].strip().isdigit() and len(data["eway_bill_no"].strip()) == 12):
        raise HTTPException(status_code=400, detail="An e-way bill number is 12 digits.")
    for k, v in data.items():
        setattr(transaction, k, v.strip() if isinstance(v, str) else v)
    write_audit(db, "ar_transaction", transaction.id, "e_invoice_updated", user, f"{who(user)} updated e-invoice/e-way bill details on '{transaction.invoice_number}'.")
    db.commit()
    return _to_response(_load(db, transaction.id), db)


@router.post("/{ar_transaction_id}/collect", response_model=ARTransactionResponse)
async def collect_ar_transaction_route(
    ar_transaction_id: int,
    payload: CollectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "payments", "create")),
):
    _load_in_scope(db, user, ar_transaction_id)
    with service_errors(db):
        post_collection(
            db, ar_transaction_id=ar_transaction_id, bank_account_id=payload.bank_account_id, amount=payload.amount,
            payment_mode=payload.payment_mode, payment_date=payload.payment_date, created_by_id=user.id,
        )
    transaction = _load(db, ar_transaction_id)
    write_audit(db, "ar_transaction", transaction.id, "collected", user, f"{who(user)} recorded a collection of {payload.amount:,.2f} against invoice '{transaction.invoice_number}'.")
    db.commit()
    return _to_response(_load(db, transaction.id), db)
