"""Bank guarantee / LC / EMD / security deposit register (Finance > Bank &
Cash > Guarantees). Business rules live in services/guarantees.py."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.access import approval_states
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.bank_guarantee import (
    BG_FORMS, BG_INSTRUMENT_TYPES, BG_OPEN_STATUSES, BG_STATUSES, BankGuarantee,
)
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.routes._common import service_errors, user_names, who, write_audit
from app.modules.accounts.schemas.bank_guarantee import (
    BankGuaranteeCancelPayload, BankGuaranteeCreate, BankGuaranteeEventResponse, BankGuaranteeExtendPayload,
    BankGuaranteeInvokePayload, BankGuaranteeIssuePayload, BankGuaranteeMoneyPayload, BankGuaranteeReleasePayload,
    BankGuaranteeResponse, BankGuaranteeUpdate,
)
from app.modules.accounts.services import guarantees as svc
from app.modules.accounts import role_events_b

router = APIRouter(prefix="/accounts/bank-guarantees", tags=["Accounts"])
TAB = "guarantees"


def _get(db: Session, user: User, bg_id: int) -> BankGuarantee:
    bg = db.query(BankGuarantee).filter(BankGuarantee.id == bg_id).first()
    if not bg:
        raise HTTPException(status_code=404, detail=f"Bank guarantee #{bg_id} doesn't exist — it may have been removed. Refresh the register.")
    ensure_in_scope(db, user, bg)
    return bg


def _out(db: Session, rows: list[BankGuarantee], *, detail: bool = False) -> list[BankGuaranteeResponse]:
    from app.modules.crm.models.organization import Organization
    from app.modules.crm.models.tender import Tender
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.sales.models.order import SalesOrder

    def ids(attr):
        return {getattr(r, attr) for r in rows} - {None}

    banks = {b.id: b for b in db.query(BankAccount).filter(BankAccount.id.in_(ids("bank_account_id"))).all()}
    custs = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(ids("customer_id"))).all()}
    vends = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(ids("vendor_id"))).all()}
    sos = {s.id: s.so_number or f"Draft #{s.id}" for s in db.query(SalesOrder).filter(SalesOrder.id.in_(ids("sales_order_id"))).all()}
    tenders = {t.id: " — ".join(x for x in (t.tender_number, t.tender_name) if x) or t.universal_id
               for t in db.query(Tender).filter(Tender.id.in_(ids("tender_id"))).all()}
    pos = {p.id: p.po_number for p in db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.id.in_(ids("purchase_order_id"))).all()}
    names = user_names(db, ids("created_by_id"))
    states = approval_states(db, svc.ET_GUARANTEE, [r.id for r in rows if r.direction == "issued"])
    today = date.today()
    out = []
    for r in rows:
        b = banks.get(r.bank_account_id)
        resp = BankGuaranteeResponse.model_validate(r).model_copy(update={
            "instrument_type_label": BG_INSTRUMENT_TYPES.get(r.instrument_type),
            "bank_account_label": (f"{b.bank_name}{f' — {b.account_no}' if b.account_no else ''}" if b else None),
            "customer_name": custs.get(r.customer_id), "vendor_name": vends.get(r.vendor_id),
            "sales_order_number": sos.get(r.sales_order_id), "tender_label": tenders.get(r.tender_id),
            "purchase_order_number": pos.get(r.purchase_order_id), "created_by_name": names.get(r.created_by_id),
            "days_to_expiry": (r.expiry_date - today).days if r.expiry_date and r.status in BG_OPEN_STATUSES else None,
            **states.get(r.id, {}),
        })
        if detail:
            pids = {e.payment_transaction_id for e in r.events} - {None}
            nums = {p.id: p.payment_number for p in db.query(PaymentTransaction).filter(PaymentTransaction.id.in_(pids)).all()} if pids else {}
            enames = user_names(db, {e.created_by_id for e in r.events})
            resp.events = [BankGuaranteeEventResponse.model_validate(e).model_copy(update={
                "created_by_name": enames.get(e.created_by_id), "voucher_number": nums.get(e.payment_transaction_id)}) for e in r.events]
        out.append(resp)
    return out


def _one(db: Session, bg: BankGuarantee) -> BankGuaranteeResponse:
    db.refresh(bg)
    return _out(db, [bg], detail=True)[0]


@router.get("/meta")
async def meta(_user: User = Depends(require_tab_access("accounts", TAB))):
    return {"instrument_types": [{"value": k, "label": v} for k, v in BG_INSTRUMENT_TYPES.items()],
            "forms": list(BG_FORMS), "statuses": list(BG_STATUSES)}


@router.get("", response_model=list[BankGuaranteeResponse])
async def list_guarantees(
    status: str | None = Query(None), direction: str | None = Query(None),
    open_only: bool = Query(False), expiring_within_days: int | None = Query(None, ge=0, le=730),
    db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", TAB)),
):
    q = apply_scope(db.query(BankGuarantee), user, BankGuarantee)
    if status:
        q = q.filter(BankGuarantee.status == status)
    if direction:
        q = q.filter(BankGuarantee.direction == direction)
    if open_only:
        q = q.filter(BankGuarantee.status.in_(BG_OPEN_STATUSES))
    rows = q.order_by(BankGuarantee.expiry_date.is_(None), BankGuarantee.expiry_date, BankGuarantee.id.desc()).limit(1000).all()
    if expiring_within_days is not None:
        today = date.today()
        rows = [r for r in rows if r.status == "active" and r.expiry_date and (r.expiry_date - today).days <= expiring_within_days]
    return _out(db, rows)


@router.get("/{bg_id}", response_model=BankGuaranteeResponse)
async def get_guarantee(bg_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", TAB))):
    return _one(db, _get(db, user, bg_id))


@router.post("", response_model=BankGuaranteeResponse, status_code=201)
async def create_guarantee(payload: BankGuaranteeCreate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("accounts", TAB, "create"))):
    with service_errors(db):
        bg = svc.create(db, payload.model_dump(), user)
    write_audit(db, "bank_guarantee", bg.id, "created", user, f"{who(user)} recorded {svc.label(bg)} for {bg.amount:,.2f}.")
    db.commit()
    return _one(db, bg)


@router.patch("/{bg_id}", response_model=BankGuaranteeResponse)
async def update_guarantee(bg_id: int, payload: BankGuaranteeUpdate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("accounts", TAB, "edit"))):
    bg = _get(db, user, bg_id)
    with service_errors(db):
        svc.update(db, bg, payload.model_dump(exclude_unset=True), user)
    db.commit()
    return _one(db, bg)


@router.post("/{bg_id}/submit", response_model=BankGuaranteeResponse)
async def submit_guarantee(bg_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("accounts", TAB, "submit"))):
    bg = _get(db, user, bg_id)
    with service_errors(db):
        req = svc.submit(db, bg, user)
    write_audit(db, "bank_guarantee", bg.id, "submitted", user, f"{who(user)} sent {bg.bg_number} for approval.")
    if getattr(req, "status", None) == "pending":
        kind = BG_INSTRUMENT_TYPES.get(bg.instrument_type, bg.instrument_type)
        role_events_b.fire(
            db, "guarantee_submitted", title=f"{kind} {bg.bg_number} waiting for approval",
            message=(f"{who(user)} applied for a {kind} of {bg.amount:,.2f}"
                     f"{f' for {bg.counterparty_name}' if getattr(bg, 'counterparty_name', None) else ''}"
                     f"{f' (margin {bg.margin_amount:,.2f})' if bg.margin_amount else ''}. "
                     "Review it in Finance › Bank & Cash › Guarantees & EMD and approve or return it."),
            entity_type=svc.ET_GUARANTEE, entity_id=bg.id, record=bg, actor=user,
            skip=role_events_b.step_approvers(req), background_tasks=background_tasks)
    db.commit()
    return _one(db, bg)


def _action(name: str, perm: str):
    """Decorator-free helper: run a service call on a guarantee with audit."""
    async def run(db: Session, user: User, bg_id: int, fn, summary):
        bg = _get(db, user, bg_id)
        with service_errors(db):
            fn(bg)
        write_audit(db, "bank_guarantee", bg.id, name, user, summary(bg))
        db.commit()
        return _one(db, bg)
    return run


@router.post("/{bg_id}/issue", response_model=BankGuaranteeResponse)
async def issue(bg_id: int, p: BankGuaranteeIssuePayload, db: Session = Depends(get_db),
                user: User = Depends(require_feature_action("accounts", "guarantees", "lifecycle", "edit"))):
    return await _action("issued", "edit")(db, user, bg_id, lambda bg: svc.mark_issued(
        db, bg, instrument_number=p.instrument_number, issue_date=p.issue_date, expiry_date=p.expiry_date,
        claim_expiry_date=p.claim_expiry_date, user=user), lambda bg: f"{who(user)} recorded {bg.bg_number} as issued ({bg.instrument_number}).")


@router.post("/{bg_id}/margin", response_model=BankGuaranteeResponse)
async def place_margin(bg_id: int, p: BankGuaranteeMoneyPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("accounts", "guarantees", "bank_postings", "create"))):
    return await _action("margin_placed", "edit")(db, user, bg_id, lambda bg: svc.place_margin(
        db, bg, posting_date=p.posting_date, payment_mode=p.payment_mode, reference_no=p.reference_no, user=user),
        lambda bg: f"{who(user)} posted margin {bg.margin_amount:,.2f} for {bg.bg_number}.")


@router.post("/{bg_id}/commission", response_model=BankGuaranteeResponse)
async def book_commission(bg_id: int, p: BankGuaranteeMoneyPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("accounts", "guarantees", "bank_postings", "create"))):
    if not p.amount:
        raise HTTPException(status_code=400, detail="Enter the commission amount the bank charged.")
    return await _action("commission", "edit")(db, user, bg_id, lambda bg: svc.book_commission(
        db, bg, amount=p.amount, posting_date=p.posting_date, payment_mode=p.payment_mode, reference_no=p.reference_no, user=user),
        lambda bg: f"{who(user)} booked commission {p.amount:,.2f} on {bg.bg_number}.")


@router.post("/{bg_id}/extend", response_model=BankGuaranteeResponse)
async def extend(bg_id: int, p: BankGuaranteeExtendPayload, db: Session = Depends(get_db),
                 user: User = Depends(require_feature_action("accounts", "guarantees", "lifecycle", "edit"))):
    return await _action("extended", "edit")(db, user, bg_id, lambda bg: svc.extend(
        db, bg, new_expiry_date=p.new_expiry_date, new_claim_expiry_date=p.new_claim_expiry_date, reason=p.reason,
        amendment_date=p.amendment_date, user=user), lambda bg: f"{who(user)} extended {bg.bg_number} to {bg.expiry_date:%d-%b-%Y}.")


@router.post("/{bg_id}/release", response_model=BankGuaranteeResponse)
async def release(bg_id: int, p: BankGuaranteeReleasePayload, db: Session = Depends(get_db),
                  user: User = Depends(require_feature_action("accounts", "guarantees", "lifecycle", "edit"))):
    return await _action("released", "edit")(db, user, bg_id, lambda bg: svc.release(
        db, bg, release_date=p.release_date, reason=p.reason, payment_mode=p.payment_mode, reference_no=p.reference_no, user=user),
        lambda bg: f"{who(user)} released {bg.bg_number}: {p.reason}")


@router.post("/{bg_id}/invoke", response_model=BankGuaranteeResponse)
async def invoke(bg_id: int, p: BankGuaranteeInvokePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                 user: User = Depends(require_feature_action("accounts", "guarantees", "invocation", "approve"))):
    out = await _action("invoked", "approve")(db, user, bg_id, lambda bg: svc.invoke(
        db, bg, invoke_date=p.invoke_date, amount=p.amount, reason=p.reason, gl_account_id=p.gl_account_id,
        payment_mode=p.payment_mode, reference_no=p.reference_no, user=user),
        lambda bg: f"{who(user)} recorded invocation of {bg.bg_number} for {p.amount:,.2f}: {p.reason}")
    bg = db.get(BankGuarantee, bg_id)
    if bg is not None:
        kind = BG_INSTRUMENT_TYPES.get(bg.instrument_type, bg.instrument_type)
        side = "invoked by the beneficiary" if bg.direction == "issued" else "invoked by us (claim received)"
        role_events_b.fire(
            db, "guarantee_invoked", title=f"{kind} {bg.bg_number} {side}",
            message=f"{p.amount:,.2f} claimed under {bg.bg_number}: {p.reason[:160]}. The entry is posted — see Finance › Bank & Cash › Guarantees & EMD.",
            entity_type=svc.ET_GUARANTEE, entity_id=bg.id, record=bg, actor=user, background_tasks=background_tasks)
        db.commit()
    return out


@router.post("/{bg_id}/cancel", response_model=BankGuaranteeResponse)
async def cancel(bg_id: int, p: BankGuaranteeCancelPayload, db: Session = Depends(get_db),
                 user: User = Depends(require_tab_action("accounts", TAB, "cancel"))):
    return await _action("cancelled", "cancel")(db, user, bg_id, lambda bg: svc.cancel(db, bg, reason=p.reason, user=user),
                                                lambda bg: f"{who(user)} cancelled {bg.bg_number}: {p.reason}")


@router.post("/{bg_id}/document", response_model=BankGuaranteeResponse)
async def upload_document(bg_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("accounts", "guarantees", "instrument_copy", "create"))):
    from app.modules.design.files import remove_file, store_file
    bg = _get(db, user, bg_id)
    stored = await store_file(f"Finance/Bank Guarantees/{bg.bg_number.replace('/', '-')}", file)
    old = bg.document_path
    bg.document_name, bg.document_path = stored["name"], stored["path"]
    svc._event(db, bg, "document", date.today(), user.id, notes=f"Instrument copy uploaded: {stored['name']}")
    write_audit(db, "bank_guarantee", bg.id, "document", user, f"{who(user)} uploaded the instrument copy of {bg.bg_number}.")
    db.commit()
    if old and old != stored["path"]:
        await remove_file(old)
    return _one(db, bg)


@router.get("/{bg_id}/document")
async def download_document(bg_id: int, download: bool = Query(False), db: Session = Depends(get_db),
                            user: User = Depends(require_feature_action("accounts", "guarantees", "instrument_copy", "view"))):
    from app.modules.design.files import stream_file
    bg = _get(db, user, bg_id)
    if not bg.document_path:
        raise HTTPException(status_code=404, detail=f"No instrument copy is attached to {bg.bg_number} yet — upload the scanned BG / LC first.")
    return await stream_file(bg.document_path, bg.document_name or "instrument", download=download)

