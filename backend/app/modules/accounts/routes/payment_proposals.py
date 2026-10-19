"""F110-style payment runs (Finance > Payments > Payment runs) and the
per-invoice payment block.

    GET    /accounts/payment-proposals                    list
    POST   /accounts/payment-proposals                    build a proposal from due bills
    GET    /accounts/payment-proposals/{id}               detail with lines
    PATCH  /accounts/payment-proposals/{id}/lines/{line}  exclude / trim a bill (draft)
    POST   /accounts/payment-proposals/{id}/submit        send for approval (Finance approver -> Partner)
    POST   /accounts/payment-proposals/{id}/approve       approve the current stage (not the maker)
    POST   /accounts/payment-proposals/{id}/execute       post one payment voucher per vendor
    POST   /accounts/payment-proposals/{id}/cancel        abandon a run that hasn't been executed
    GET    /accounts/payment-proposals/{id}/bank-file     bulk NEFT/RTGS upload (CSV)
    PATCH  /accounts/vendor-invoices/{id}/payment-block   block / release one bill for payment
"""
import csv
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts import access
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.payment_proposal import PaymentProposal, PROPOSAL_STATUSES
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.schemas.payment_proposal import (
    PaymentProposalCreate, PaymentProposalLineUpdatePayload, PaymentProposalExecutePayload, PaymentProposalCancelPayload,
    PaymentBlockPayload, PaymentProposalResponse, PaymentProposalLineResponse,
)
from app.modules.accounts.services import payment_runs
from app.modules.accounts.routes._common import write_audit, who, service_errors, user_names

router = APIRouter(prefix="/accounts", tags=["Accounts"])


def _get(db: Session, proposal_id: int) -> PaymentProposal:
    pp = payment_runs.load(db, proposal_id)
    if not pp:
        raise HTTPException(status_code=404, detail=f"Payment run #{proposal_id} doesn't exist — it may have been removed. Refresh the Payment runs list.")
    return pp


def _to_response(db: Session, pp: PaymentProposal, approval: dict | None = None) -> PaymentProposalResponse:
    bank = db.get(BankAccount, pp.bank_account_id)
    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_({l.vendor_id for l in pp.lines} or {0})).all()}
    invs = {i.id: i for i in db.query(VendorInvoice).filter(VendorInvoice.id.in_({l.vendor_invoice_id for l in pp.lines} or {0})).all()}
    pays = {p.id: p.payment_number for p in db.query(PaymentTransaction).filter(
        PaymentTransaction.id.in_({l.payment_transaction_id for l in pp.lines if l.payment_transaction_id} or {0})).all()}
    lines = [PaymentProposalLineResponse.model_validate(l).model_copy(update={
        "vendor_name": vendors.get(l.vendor_id),
        "invoice_number": invs[l.vendor_invoice_id].invoice_number if l.vendor_invoice_id in invs else None,
        "invoice_date": invs[l.vendor_invoice_id].invoice_date if l.vendor_invoice_id in invs else None,
        "payment_number": pays.get(l.payment_transaction_id)}) for l in pp.lines]
    names = user_names(db, {pp.created_by_id, pp.approved_by_id, pp.executed_by_id})
    if approval is None:
        approval = access.approval_state(db, access.ET_PAYMENT_RUN, pp.id)
    return PaymentProposalResponse.model_validate(pp).model_copy(update={
        "lines": lines, "bank_account_label": (f"{bank.bank_name} — {bank.account_no}" if bank and bank.account_no else bank.bank_name if bank else None),
        "created_by_name": names.get(pp.created_by_id), "approved_by_name": names.get(pp.approved_by_id),
        "executed_by_name": names.get(pp.executed_by_id),
        "vendor_count": len({l.vendor_id for l in pp.lines if not l.excluded}), **approval,
    })


@router.get("/payment-proposals", response_model=list[PaymentProposalResponse])
async def list_proposals(status: str | None = Query(None), db: Session = Depends(get_db),
                         _user: User = Depends(require_tab_access("accounts", "payment_runs"))):
    q = db.query(PaymentProposal)
    if status:
        if status not in PROPOSAL_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unknown status '{status}' — use one of: {', '.join(PROPOSAL_STATUSES)}.")
        q = q.filter(PaymentProposal.status == status)
    rows = q.order_by(PaymentProposal.id.desc()).limit(200).all()
    states = access.approval_states(db, access.ET_PAYMENT_RUN, [p.id for p in rows])
    empty = {"approval_status": None, "approval_stage": None, "approval_request_id": None}
    return [_to_response(db, p, states.get(p.id, empty)) for p in rows]


@router.post("/payment-proposals", response_model=PaymentProposalResponse, status_code=201)
async def create_proposal(payload: PaymentProposalCreate, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", "payment_runs", "create"))):
    with service_errors(db):
        pp = payment_runs.build_proposal(
            db, pay_by_date=payload.pay_by_date, bank_account_id=payload.bank_account_id, payment_mode=payload.payment_mode,
            created_by_id=user.id, vendor_ids=payload.vendor_ids or None, run_date=payload.run_date, notes=payload.notes,
            apply_credits=payload.apply_credits, take_discounts=payload.take_discounts,
        )
    if not pp.lines:
        db.rollback()
        raise HTTPException(status_code=400, detail=(
            f"No vendor bill is due by {payload.pay_by_date:%d-%b-%Y} that isn't already paid, blocked, in another payment run "
            f"or waiting in a held payment — pick a later 'pay by' date or other vendors."))
    write_audit(db, "payment_proposal", pp.id, "created", user, f"{who(user)} built payment run {pp.proposal_number} ({pp.total_amount:,.2f}).")
    db.commit()
    return _to_response(db, _get(db, pp.id))


@router.get("/payment-proposals/{proposal_id}", response_model=PaymentProposalResponse)
async def get_proposal(proposal_id: int, db: Session = Depends(get_db),
                       _user: User = Depends(require_tab_access("accounts", "payment_runs"))):
    return _to_response(db, _get(db, proposal_id))


@router.patch("/payment-proposals/{proposal_id}/lines/{line_id}", response_model=PaymentProposalResponse)
async def update_proposal_line(proposal_id: int, line_id: int, payload: PaymentProposalLineUpdatePayload,
                               db: Session = Depends(get_db),
                               user: User = Depends(require_tab_action("accounts", "payment_runs", "edit"))):
    with service_errors(db):
        pp = payment_runs.update_line(db, proposal_id=proposal_id, line_id=line_id, excluded=payload.excluded,
                                      exclusion_reason=payload.exclusion_reason, amount=payload.amount)
    write_audit(db, "payment_proposal", pp.id, "edited", user, f"{who(user)} changed a bill in payment run {pp.proposal_number}.")
    db.commit()
    return _to_response(db, _get(db, proposal_id))


@router.post("/payment-proposals/{proposal_id}/submit")
async def submit_proposal(proposal_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", "payment_runs", "submit"))):
    pp = _get(db, proposal_id)
    if pp.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail=f"Payment run {pp.proposal_number} is {pp.status} — only a draft can be sent for approval.")
    if pp.total_amount <= 0 and not any((l.credit_amount or l.discount_amount) and not l.excluded for l in pp.lines):
        raise HTTPException(status_code=400, detail="Every bill in this run is excluded or zero — include at least one bill before sending it for approval.")
    pp.status = "submitted"
    pp.rejection_reason = None
    req = access.submit_document(db, access.KEY_PAYMENT_RUN, entity_id=pp.id, requester=user,
                                 title=f"Payment run {pp.proposal_number} — {pp.total_amount:,.2f}", reference=pp.proposal_number,
                                 amount=pp.total_amount, background_tasks=background_tasks)
    write_audit(db, "payment_proposal", pp.id, "submitted", user, f"{who(user)} sent payment run {pp.proposal_number} for approval.")
    db.commit()
    db.refresh(pp)
    return {**_to_response(db, _get(db, proposal_id)).model_dump(),
            **({"message": access.pending_response(req, f"Payment run {pp.proposal_number}")["message"]} if req.status == "pending" else {})}


@router.post("/payment-proposals/{proposal_id}/approve", response_model=PaymentProposalResponse)
async def approve_proposal(proposal_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("accounts", "payment_runs", "approve"))):
    pp = _get(db, proposal_id)
    if pp.status != "submitted":
        raise HTTPException(status_code=400, detail=f"Payment run {pp.proposal_number} is {pp.status} — only a submitted run can be approved.")
    access.approve_now(db, access.KEY_PAYMENT_RUN, entity_id=pp.id, maker_id=pp.created_by_id, actor=user,
                       title=f"Payment run {pp.proposal_number}", reference=pp.proposal_number, amount=pp.total_amount)
    db.commit()
    return _to_response(db, _get(db, proposal_id))


@router.post("/payment-proposals/{proposal_id}/execute", response_model=PaymentProposalResponse)
async def execute_proposal(proposal_id: int, payload: PaymentProposalExecutePayload, background_tasks: BackgroundTasks,
                           db: Session = Depends(get_db),
                           user: User = Depends(require_feature_action("accounts", "payment_runs", "execution", "create"))):
    _get(db, proposal_id)
    with service_errors(db):
        pp = payment_runs.execute_proposal(db, proposal_id=proposal_id, user_id=user.id, payment_date=payload.payment_date)
    write_audit(db, "payment_proposal", pp.id, "executed", user, f"{who(user)} executed payment run {pp.proposal_number} ({pp.total_amount:,.2f}).")
    access.role_event(db, "payment_run_executed", title=f"Payment run {pp.proposal_number} executed — upload the bank file",
                      message=f"{who(user)} executed payment run {pp.proposal_number} ({pp.total_amount:,.2f}); its payment vouchers are posted. "
                              f"Download the bank file (Finance › Payments › Payment runs) and upload it to the bank.",
                      entity_type=access.ET_PAYMENT_RUN, entity_id=pp.id, actor=user, background_tasks=background_tasks)
    db.commit()
    return _to_response(db, _get(db, proposal_id))


@router.post("/payment-proposals/{proposal_id}/cancel", response_model=PaymentProposalResponse)
async def cancel_proposal(proposal_id: int, payload: PaymentProposalCancelPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", "payment_runs", "cancel"))):
    pp = _get(db, proposal_id)
    if pp.status in ("executed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Payment run {pp.proposal_number} is already {pp.status} — "
                                                    f"{'cancel its payment vouchers instead' if pp.status == 'executed' else 'nothing to do'}.")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Give the reason for cancelling the payment run.")
    access.cancel_live(db, access.ET_PAYMENT_RUN, pp.id, user, payload.reason)
    pp.status = "cancelled"
    pp.rejection_reason = payload.reason
    write_audit(db, "payment_proposal", pp.id, "cancelled", user, f"{who(user)} cancelled payment run {pp.proposal_number}: {payload.reason}")
    db.commit()
    return _to_response(db, _get(db, proposal_id))


@router.get("/payment-proposals/{proposal_id}/bank-file")
async def proposal_bank_file(proposal_id: int, db: Session = Depends(get_db),
                             user: User = Depends(require_feature_action("accounts", "payment_runs", "bank_file", "export"))):
    pp = _get(db, proposal_id)
    with service_errors(db):
        rows = payment_runs.bank_file_rows(db, pp)
    buf = io.StringIO()
    cols = ["payment_number", "payment_date", "mode", "debit_account", "beneficiary_name", "beneficiary_account", "ifsc",
            "beneficiary_bank", "amount", "email", "remarks", "utr"]
    w = csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)
    write_audit(db, "payment_proposal", pp.id, "exported", user, f"{who(user)} downloaded the bank file of {pp.proposal_number}.")
    db.commit()
    name = pp.proposal_number.replace("/", "-")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}-bank-upload.csv"'})


@router.patch("/vendor-invoices/{invoice_id}/payment-block")
async def set_payment_block(invoice_id: int, payload: PaymentBlockPayload, db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("accounts", "payments", "payment_block", "edit"))):
    inv = db.query(VendorInvoice).filter(VendorInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail=f"Vendor invoice #{invoice_id} doesn't exist — refresh Finance > Purchase.")
    if payload.payment_block and not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Give the reason the bill is blocked for payment (e.g. 'short supply — debit note pending').")
    inv.payment_block = payload.payment_block
    inv.payment_block_reason = ((payload.reason or "").strip() or None) if payload.payment_block else None
    write_audit(db, "vendor_invoice", inv.id, "payment_block" if payload.payment_block else "payment_release", user,
                f"{who(user)} {'blocked' if payload.payment_block else 'released'} '{inv.invoice_number}' for payment"
                + (f": {payload.reason}" if payload.reason else "."))
    db.commit()
    return {"id": inv.id, "invoice_number": inv.invoice_number, "payment_block": inv.payment_block,
            "payment_block_reason": inv.payment_block_reason}
