from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.payment_transaction import PaymentTransaction, PaymentAllocation
from app.modules.accounts.models.settlement_adjustment import SettlementAdjustment, ADJUSTMENT_REASONS
from app.modules.accounts.schemas.payment import (
    PaymentCreate, PaymentResponse, VoucherCreate, AllocateCreate, VoucherCancelPayload, PaymentLineResponse, AllocationResponse,
    DeductionResponse, WriteOffCreate,
)
from app.modules.accounts.services.vouchers import (
    create_voucher, allocate, remove_allocation, cancel_voucher, allocations_for, post_held_voucher, voucher_deductions,
    deduction_total, write_off, cancel_write_off,
)
from app.modules.accounts.services.outstanding import open_documents, open_credits, open_advances
from app.modules.accounts.routes._common import write_audit, who, service_errors, user_names, gl_labels, require_any_accounts_tab
from app.modules.accounts.settings import get_setting as get_accounts_setting
from app.modules.accounts import access  # registers PaymentTransaction's data scope + payment approval

router = APIRouter(prefix="/accounts/payments", tags=["Accounts"])


def _ensure_source_in_scope(db: Session, user: User, source_type: str, source_id: int) -> None:
    """Allocations act on their source document (a payment voucher or a
    debit/credit note): the user must have that document in their data scope."""
    from app.modules.accounts.models.party_note import PartyNote

    if source_type == "journal":
        from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
        line = db.query(JournalEntryLine).filter(JournalEntryLine.id == source_id).first()
        src = db.query(JournalEntry).filter(JournalEntry.id == line.journal_entry_id).first() if line else None
        if src is not None:
            ensure_in_scope(db, user, src)
        return
    if source_type == "adjustment":
        return
    model = PaymentTransaction if source_type in ("payment", "advance") else PartyNote
    src = db.query(model).filter(model.id == source_id).first()
    if src is not None:
        ensure_in_scope(db, user, src)

_TYPE_LABEL = {"vendor": "payment", "customer": "receipt", "expense": "expense payment", "other_receipt": "receipt", "contra": "contra"}


def _bank_label(b: BankAccount | None) -> str | None:
    if not b:
        return None
    return f"{b.bank_name} — {b.account_no}" if b.account_no else b.bank_name


def _load(db: Session, pid: int) -> PaymentTransaction | None:
    return db.query(PaymentTransaction).options(selectinload(PaymentTransaction.lines)).filter(PaymentTransaction.id == pid).first()


def _target_numbers(db: Session, pairs) -> dict[tuple, str]:
    out = {}
    vi = {t for tt, t in pairs if tt == "vendor_invoice"}
    ar = {t for tt, t in pairs if tt == "ar_transaction"}
    if vi:
        out.update({("vendor_invoice", r.id): r.invoice_number for r in db.query(VendorInvoice).filter(VendorInvoice.id.in_(vi)).all()})
    if ar:
        out.update({("ar_transaction", r.id): r.invoice_number for r in db.query(ARTransaction).filter(ARTransaction.id.in_(ar)).all()})
    return out


def _deduction_responses(db: Session, deds) -> list[DeductionResponse]:
    nums = _target_numbers(db, {(d.target_type, d.target_id) for d in deds})
    gls = gl_labels(db, {d.gl_account_id for d in deds})
    return [DeductionResponse.model_validate(d).model_copy(update={
        "target_number": nums.get((d.target_type, d.target_id)), "reason_label": ADJUSTMENT_REASONS.get(d.reason, d.reason),
        "gl_account_code": gls[d.gl_account_id].code if d.gl_account_id in gls else None,
        "gl_account_name": gls[d.gl_account_id].name if d.gl_account_id in gls else None}) for d in deds]


def _to_response(p: PaymentTransaction, db: Session, approval: dict | None = None) -> PaymentResponse:
    banks = {b.id: b for b in db.query(BankAccount).filter(BankAccount.id.in_({p.bank_account_id, p.counter_bank_account_id} - {None})).all()}
    vendor = db.query(Vendor).filter(Vendor.id == p.vendor_id).first() if p.vendor_id else None
    customer = None
    if p.customer_id:
        from app.modules.crm.models.organization import Organization
        customer = db.query(Organization).filter(Organization.id == p.customer_id).first()
    invoice = db.query(VendorInvoice).filter(VendorInvoice.id == p.vendor_invoice_id).first() if p.vendor_invoice_id else None
    gls = gl_labels(db, {l.gl_account_id for l in p.lines})
    lines = [PaymentLineResponse.model_validate(l).model_copy(update={
        "gl_account_code": gls[l.gl_account_id].code if l.gl_account_id in gls else None,
        "gl_account_name": gls[l.gl_account_id].name if l.gl_account_id in gls else None}) for l in p.lines]
    allocs = []
    for a in allocations_for(db, source_type="advance" if p.is_advance else "payment", source_id=p.id):
        target = db.query(VendorInvoice if a.target_type == "vendor_invoice" else ARTransaction).filter_by(id=a.target_id).first()
        allocs.append(AllocationResponse.model_validate(a).model_copy(update={"target_number": target.invoice_number if target else None}))
    deds = voucher_deductions(db, p.id)
    so_number = po_number = None
    if p.sales_order_id:
        from app.modules.sales.models.order import SalesOrder
        so = db.get(SalesOrder, p.sales_order_id)
        so_number = (so.so_number or f"Draft #{so.id}") if so else None
    if p.purchase_order_id:
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
        po = db.get(P2PPurchaseOrder, p.purchase_order_id)
        po_number = po.po_number if po else None
    if approval is None:
        approval = access.approval_state(db, access.ET_PAYMENT, p.id)
    names = user_names(db, {p.created_by_id, p.approved_by_id})
    return PaymentResponse.model_validate(p).model_copy(update={
        "bank_account_label": _bank_label(banks.get(p.bank_account_id)),
        "counter_bank_account_label": _bank_label(banks.get(p.counter_bank_account_id)),
        "vendor_name": vendor.name if vendor else None,
        "customer_name": customer.name if customer else None,
        "vendor_invoice_number": invoice.invoice_number if invoice else None,
        "created_by_name": names.get(p.created_by_id), "approved_by_name": names.get(p.approved_by_id),
        "lines": lines, "allocations": allocs,
        "deductions": _deduction_responses(db, deds),
        "deduction_total": round(sum(d.amount for d in deds if d.status != "cancelled"), 2),
        "sales_order_number": so_number, "purchase_order_number": po_number,
        **approval,
    })


@router.get("", response_model=list[PaymentResponse])
async def list_payments(
    payment_type: str | None = Query(None),
    vendor_id: int | None = Query(None),
    customer_id: int | None = Query(None),
    bank_account_id: int | None = Query(None),
    status: str | None = Query(None),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    is_advance: bool | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "payments")),
):
    query = apply_scope(db.query(PaymentTransaction).options(selectinload(PaymentTransaction.lines)), user, PaymentTransaction)
    if payment_type is not None:
        query = query.filter(PaymentTransaction.payment_type == payment_type)
    if vendor_id is not None:
        query = query.filter(PaymentTransaction.vendor_id == vendor_id)
    if customer_id is not None:
        query = query.filter(PaymentTransaction.customer_id == customer_id)
    if bank_account_id is not None:
        query = query.filter((PaymentTransaction.bank_account_id == bank_account_id) | (PaymentTransaction.counter_bank_account_id == bank_account_id))
    if status is not None:
        query = query.filter(PaymentTransaction.status == status)
    if from_date is not None:
        query = query.filter(PaymentTransaction.payment_date >= from_date)
    if to_date is not None:
        query = query.filter(PaymentTransaction.payment_date <= to_date)
    if is_advance is not None:
        query = query.filter(PaymentTransaction.is_advance.is_(is_advance))
    payments = query.order_by(PaymentTransaction.payment_date.desc(), PaymentTransaction.id.desc()).limit(500).all()
    states = access.approval_states(db, access.ET_PAYMENT, [p.id for p in payments])
    empty = {"approval_status": None, "approval_stage": None, "approval_request_id": None}
    return [_to_response(p, db, states.get(p.id, empty)) for p in payments]


@router.get("/open-items")
async def list_open_items(
    party_type: str = Query(..., description="vendor | customer"),
    party_id: int = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("accounts", "payments")),
):
    """What can be settled for a party: open invoices, and advances / notes /
    manual JV credits that still have an amount to allocate."""
    if party_type not in ("vendor", "customer"):
        raise HTTPException(status_code=400, detail="party_type must be 'vendor' or 'customer'.")
    return {"documents": open_documents(db, party_type=party_type, party_id=party_id),
            "credits": open_credits(db, party_type=party_type, party_id=party_id)}


@router.get("/advances")
async def list_open_advances(
    party_type: str | None = Query(None, description="vendor | customer"),
    sales_order_id: int | None = Query(None),
    purchase_order_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_accounts_tab("payments", "outstanding")),
):
    """Down payments not yet adjusted against an invoice (per SO / PO)."""
    if party_type not in (None, "vendor", "customer"):
        raise HTTPException(status_code=400, detail="party_type must be 'vendor' or 'customer'.")
    return open_advances(db, party_type=party_type, sales_order_id=sales_order_id, purchase_order_id=purchase_order_id)


@router.get("/deduction-reasons")
async def deduction_reasons(_user: User = Depends(require_tab_access("accounts", "payments"))):
    return [{"value": k, "label": v} for k, v in ADJUSTMENT_REASONS.items()]


@router.get("/write-offs", response_model=list[DeductionResponse])
async def list_write_offs(
    target_type: str | None = Query(None), target_id: int | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "payments", "write_offs", "view")),
):
    q = db.query(SettlementAdjustment).filter(SettlementAdjustment.payment_transaction_id.is_(None))
    if target_type:
        q = q.filter(SettlementAdjustment.target_type == target_type)
    if target_id is not None:
        q = q.filter(SettlementAdjustment.target_id == target_id)
    return _deduction_responses(db, q.order_by(SettlementAdjustment.id.desc()).limit(500).all())


@router.post("/write-off", response_model=DeductionResponse, status_code=201)
async def write_off_route(payload: WriteOffCreate, db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("accounts", "payments", "write_offs", "create"))):
    """Clear what is left on one bill without cash (residual paise, an
    approved LD / short-payment write-off). Up to the small-difference
    tolerance any Payments editor may do it; above it, a Finance Manager."""
    tolerance = float(get_accounts_setting(db, "small_difference_tolerance") or 0)
    if payload.amount > tolerance + 1e-9 and not (user.is_finance_manager or user.role == "admin"):
        raise HTTPException(status_code=403, detail=(
            f"A write-off of {payload.amount:,.2f} is above the small-difference tolerance ({tolerance:,.2f}, Finance > Settings) — "
            f"only a Finance Manager can post it. Ask one, or record the deduction on the customer's receipt instead "
            f"(it then goes through payment approval)."))
    with service_errors(db):
        adj = write_off(db, target_type=payload.target_type, target_id=payload.target_id, amount=payload.amount,
                        reason=payload.reason, write_off_date=payload.write_off_date or date.today(), created_by_id=user.id,
                        gl_account_id=payload.gl_account_id, cost_center_id=payload.cost_center_id, remarks=payload.remarks)
    write_audit(db, payload.target_type, payload.target_id, "written_off", user,
                f"{who(user)} wrote off {adj.amount:,.2f} ({ADJUSTMENT_REASONS.get(adj.reason, adj.reason)}).")
    db.commit()
    return _deduction_responses(db, [adj])[0]


@router.post("/write-offs/{adjustment_id}/cancel", response_model=DeductionResponse)
async def cancel_write_off_route(adjustment_id: int, payload: VoucherCancelPayload, db: Session = Depends(get_db),
                                 user: User = Depends(require_feature_action("accounts", "payments", "write_offs", "cancel"))):
    with service_errors(db):
        adj = cancel_write_off(db, adjustment_id=adjustment_id, reason=payload.reason, user_id=user.id)
    write_audit(db, adj.target_type, adj.target_id, "write_off_cancelled", user, f"{who(user)} cancelled a write-off of {adj.amount:,.2f}: {payload.reason}")
    db.commit()
    return _deduction_responses(db, [adj])[0]


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(payment_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", "payments"))):
    p = _load(db, payment_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Payment voucher #{payment_id} doesn't exist — it may have been removed. Refresh the Bank & Cash list.")
    ensure_in_scope(db, user, p)
    return _to_response(p, db)


def _needs_approval(db: Session, payment: PaymentTransaction) -> str | None:
    """Why this voucher must wait for approval, or None to post at once."""
    if payment.payment_type == "vendor":
        return "every vendor payment is approved before money leaves the bank"
    if payment.payment_type == "customer":
        writeoff = deduction_total(db, payment.id, exclude_reasons=("bank_charges",))
        limit = float(get_accounts_setting(db, "receipt_writeoff_approval_limit") or 0)
        if writeoff > limit + 1e-9:
            return f"its write-offs ({writeoff:,.2f}) exceed the approval limit of {limit:,.2f} (Finance > Settings)"
    if payment.payment_type == "expense":
        limit = float(get_accounts_setting(db, "expense_payment_approval_limit") or 0)
        if limit > 0 and payment.amount > limit:
            return f"it is above the expense payment approval limit of {limit:,.2f} (Finance > Settings)"
    return None


def _submit_for_approval(db: Session, payment: PaymentTransaction, user: User) -> None:
    party = payment.vendor_id and db.get(Vendor, payment.vendor_id)
    if payment.customer_id:
        from app.modules.crm.models.organization import Organization
        party = db.get(Organization, payment.customer_id)
    kind = {"vendor": "Advance to" if payment.is_advance else "Payment to", "customer": "Receipt from", "expense": "Expense payment"}
    title = f"{kind.get(payment.payment_type, 'Voucher')} {party.name if party else ''}".strip() + f" — {payment.amount:,.2f}"
    access.submit_document(
        db, access.KEY_PAYMENT, entity_id=payment.id, requester=user, title=title, reference=title, amount=payment.amount,
        context={"payment_type": payment.payment_type, "is_advance": bool(payment.is_advance),
                 "writeoff_amount": deduction_total(db, payment.id, exclude_reasons=("bank_charges",))},
    )


def _check_not_invoice_maker(db: Session, user: User, targets) -> None:
    for ttype, tid in targets:
        if ttype != "vendor_invoice":
            continue
        inv = db.query(VendorInvoice).filter(VendorInvoice.id == tid).first()
        if inv and inv.created_by_id == user.id:
            raise HTTPException(status_code=403, detail=f"You recorded invoice '{inv.invoice_number}', so you can't pay it yourself — another finance user must do that.")


@router.post("", response_model=PaymentResponse, status_code=201)
async def create_voucher_route(payload: VoucherCreate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "payments", "create"))):
    """Vendor payments must not be made by the same person who booked the
    bills they settle (maker-checker), and wait for approval (Finance approver
    then Partner) before they post. A receipt with write-offs above the limit,
    and an expense payment above its limit, wait too."""
    if payload.payment_type == "vendor":
        _check_not_invoice_maker(db, user, [(a.target_type, a.target_id) for a in payload.allocations]
                                 + [(d.target_type or "vendor_invoice", d.target_id) for d in payload.deductions])
    with service_errors(db):
        payment = create_voucher(
            db, payment_type=payload.payment_type, bank_account_id=payload.bank_account_id, amount=payload.amount,
            payment_mode=payload.payment_mode, payment_date=payload.payment_date, vendor_id=payload.vendor_id,
            customer_id=payload.customer_id, counter_bank_account_id=payload.counter_bank_account_id,
            lines=[l.model_dump() for l in payload.lines], allocations=[a.model_dump() for a in payload.allocations],
            cheque_number=payload.cheque_number, cheque_date=payload.cheque_date, reference_no=payload.reference_no,
            narration=payload.narration, created_by_id=user.id,
            deductions=[d.model_dump() for d in payload.deductions], is_advance=payload.is_advance,
            sales_order_id=payload.sales_order_id, billing_line_id=payload.billing_line_id,
            purchase_order_id=payload.purchase_order_id, advance_reason=payload.advance_reason,
            currency=payload.currency, exchange_rate=payload.exchange_rate, amount_fc=payload.amount_fc,
            hold_for_approval=True,
        )
        why = _needs_approval(db, payment)
        if why:
            _submit_for_approval(db, payment, user)
        else:
            post_held_voucher(db, payment_id=payment.id, posted_by_id=user.id)
    if payment.status == "pending_approval":
        write_audit(db, "payment_transaction", payment.id, "submitted", user,
                    f"{who(user)} recorded a {_TYPE_LABEL.get(payment.payment_type, 'voucher')} of {payment.amount:,.2f} and sent it for approval ({why}).")
    else:
        write_audit(db, "payment_transaction", payment.id, "posted", user,
                    f"{who(user)} posted {_TYPE_LABEL.get(payment.payment_type, 'voucher')} '{payment.payment_number}' of {payment.amount:,.2f}.")
    db.commit()
    return _to_response(_load(db, payment.id), db)


@router.post("/pay-invoice", response_model=PaymentResponse, status_code=201)
async def pay_invoice_route(payload: PaymentCreate, db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "payments", "create"))):
    """Pay one vendor bill — recorded and sent for payment approval."""
    inv = db.query(VendorInvoice).filter(VendorInvoice.id == payload.vendor_invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail=f"Vendor invoice #{payload.vendor_invoice_id} doesn't exist — refresh Finance > Purchase.")
    _check_not_invoice_maker(db, user, [("vendor_invoice", inv.id)])
    if inv.status != "posted":
        raise HTTPException(status_code=400, detail=f"Only a posted invoice can be paid (invoice '{inv.invoice_number}' is {inv.status}).")
    if payload.amount > inv.amount_due + 1e-9:
        raise HTTPException(status_code=400, detail=f"Payment amount ({payload.amount:,.2f}) exceeds the amount due ({inv.amount_due:,.2f}).")
    with service_errors(db):
        payment = create_voucher(
            db, payment_type="vendor", bank_account_id=payload.bank_account_id, amount=payload.amount,
            payment_mode=payload.payment_mode, payment_date=payload.payment_date, vendor_id=inv.vendor_id,
            cheque_number=payload.cheque_number, cheque_date=payload.cheque_date, created_by_id=user.id,
            allocations=[{"target_type": "vendor_invoice", "target_id": inv.id, "amount": payload.amount}],
            hold_for_approval=True,
        )
        _submit_for_approval(db, payment, user)
    write_audit(db, "payment_transaction", payment.id, "submitted", user,
                f"{who(user)} recorded a payment of {payload.amount:,.2f} against '{inv.invoice_number}' and sent it for approval.")
    db.commit()
    return _to_response(_load(db, payment.id), db)


@router.post("/allocate")
async def allocate_route(payload: AllocateCreate, db: Session = Depends(get_db), user: User = Depends(require_feature_action("accounts", "payments", "allocation", "edit"))):
    if not payload.allocations:
        raise HTTPException(status_code=400, detail="Pick at least one invoice to settle.")
    if payload.source_type not in ("payment", "advance", "party_note", "journal"):
        raise HTTPException(status_code=400, detail=f"Can't allocate from '{payload.source_type}' — use payment, advance, party_note or journal.")
    _ensure_source_in_scope(db, user, payload.source_type, payload.source_id)
    # Maker-checker: an advance paid now and allocated later must not let the
    # person who booked the bill settle it (same rule as create_voucher_route).
    if payload.source_type in ("payment", "advance"):
        for a in payload.allocations:
            if a.target_type != "vendor_invoice":
                continue
            inv = db.query(VendorInvoice).filter(VendorInvoice.id == a.target_id).first()
            if inv and inv.created_by_id == user.id:
                raise HTTPException(status_code=403, detail=f"You recorded invoice '{inv.invoice_number}', so you can't settle it with a payment yourself — another finance user must allocate it.")
    with service_errors(db):
        for a in payload.allocations:
            allocate(db, source_type=payload.source_type, source_id=payload.source_id, target_type=a.target_type, target_id=a.target_id,
                     amount=a.amount, allocation_date=payload.allocation_date or date.today(), created_by_id=user.id)
    total = sum(a.amount for a in payload.allocations)
    write_audit(db, payload.source_type, payload.source_id, "allocated", user, f"{who(user)} allocated {total:,.2f} against {len(payload.allocations)} invoice(s).")
    db.commit()
    return {"ok": True, "allocated": round(total, 2)}


@router.delete("/allocations/{allocation_id}")
async def remove_allocation_route(allocation_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("accounts", "payments", "allocation", "edit"))):
    alloc = db.query(PaymentAllocation).filter(PaymentAllocation.id == allocation_id).first()
    if not alloc:
        raise HTTPException(status_code=404, detail=f"Allocation #{allocation_id} doesn't exist — it may already have been removed. Refresh the voucher's settlements.")
    _ensure_source_in_scope(db, user, alloc.source_type, alloc.source_id)
    source_type, source_id, amount = alloc.source_type, alloc.source_id, alloc.amount
    with service_errors(db):
        remove_allocation(db, allocation_id=allocation_id, user_id=user.id)
    write_audit(db, source_type, source_id, "unallocated", user, f"{who(user)} removed an allocation of {amount:,.2f}.")
    db.commit()
    return {"ok": True}


@router.post("/{payment_id}/cancel", response_model=PaymentResponse)
async def cancel_voucher_route(payment_id: int, payload: VoucherCancelPayload, db: Session = Depends(get_db),
                               user: User = Depends(require_feature_action("accounts", "payments", "cancellation", "cancel"))):
    existing = db.query(PaymentTransaction).filter(PaymentTransaction.id == payment_id).first()
    if existing:
        ensure_in_scope(db, user, existing)
    with service_errors(db):
        payment = cancel_voucher(db, payment_id=payment_id, reason=payload.reason, user_id=user.id)
    write_audit(db, "payment_transaction", payment.id, "cancelled", user, f"{who(user)} cancelled voucher '{payment.payment_number}': {payload.reason}")
    db.commit()
    return _to_response(_load(db, payment.id), db)
