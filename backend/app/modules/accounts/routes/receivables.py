"""Receivables management (FSCM): credit management (/accounts/credit),
collections & dunning (/accounts/collections) and disputes (/accounts/disputes).

Permission tabs (Finance & Accounting › Outstanding group):
    credit_management  view = credit overview / releases; approve = release
                       a credit block (central approval engine)
    collections        view = worklist / letters; create = log a contact,
                       run dunning; edit = cancel a promise / letter, Word
    disputes           view; create = raise; edit = update / resolve
A credit position and a release request are also open to the people the
block stops — Sales › Sales Orders and Store › Issues viewers."""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab, is_admin_user
from app.core.permissions import ensure_tab_action, require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.accounts import receivables_access as racc
from app.modules.accounts import role_events_b
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.collections import (
    AccountsCollectionNote, AccountsCreditRelease, AccountsDispute, AccountsDunningLetter,
    COLLECTION_NOTE_TYPES, CREDIT_CHECKPOINTS, DISPUTE_REASONS, DISPUTE_STATUSES,
)
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.routes._common import service_errors, user_names, who, write_audit
from app.modules.accounts.schemas.receivables import (
    AccountsCollectionNoteCreate, AccountsCollectionNoteResponse, AccountsCreditReleaseCreate,
    AccountsCreditReleaseResponse, AccountsCreditReleaseWithdrawPayload, AccountsDisputeCreate,
    AccountsDisputeResolvePayload, AccountsDisputeResponse, AccountsDisputeUpdate, AccountsDunningLetterCancelPayload,
    AccountsDunningLetterResponse, AccountsDunningRunPayload,
)
from app.modules.accounts.services import collections as coll
from app.modules.accounts.services import credit as credit_svc
from app.modules.accounts.services import disputes as disp

router = APIRouter(prefix="/accounts", tags=["Accounts"])

_CREDIT_VIEWERS = (("accounts", "credit_management"), ("store", "issues"))


def _credit_viewer(user: User = Depends(get_current_user)) -> User:
    if is_admin_user(user) or any(can_view_tab(user, m, t) for m, t in _CREDIT_VIEWERS):
        return user
    ensure_tab_action(user, "accounts", "credit_management", "view")
    return user


def _customer_names(db: Session, ids) -> dict[int, str]:
    from app.modules.crm.models.organization import Organization
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(ids)).all()}


def _not_found(e: LookupError):
    return HTTPException(status_code=404, detail=str(e))


# ── Meta ─────────────────────────────────────────────────────────────────

@router.get("/receivables/meta")
async def receivables_meta(_user: User = Depends(get_current_user)):
    return {"credit_checkpoints": CREDIT_CHECKPOINTS, "note_types": COLLECTION_NOTE_TYPES,
            "dispute_reasons": DISPUTE_REASONS, "dispute_statuses": DISPUTE_STATUSES}


# ── Credit management ────────────────────────────────────────────────────

@router.get("/credit/customers/{customer_id}")
async def credit_position(customer_id: int, checkpoint: str = Query("so_confirmation"), sales_order_id: int | None = Query(None),
                          db: Session = Depends(get_db), _user: User = Depends(_credit_viewer)):
    if checkpoint not in CREDIT_CHECKPOINTS:
        raise HTTPException(status_code=400, detail=f"checkpoint must be one of: {', '.join(CREDIT_CHECKPOINTS)}.")
    so = None
    if sales_order_id:
        from app.modules.sales.models.order import SalesOrder
        so = db.query(SalesOrder).filter(SalesOrder.id == sales_order_id, SalesOrder.customer_id == customer_id).first()
        if not so:
            raise HTTPException(status_code=404, detail=f"Sales order #{sales_order_id} of this customer not found.")
    return credit_svc.credit_check(db, customer_id, checkpoint, sales_order=so)


@router.get("/credit/overview")
async def credit_overview(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "credit_management"))):
    """Every customer with a credit limit, open invoices or open orders."""
    from app.modules.crm.models.organization import Organization
    from app.modules.sales.models.order import SalesOrder

    ids = {i for (i,) in db.query(ARTransaction.customer_id).filter(ARTransaction.status == "posted", ARTransaction.amount_due > 0.005).distinct()}
    ids |= {i for (i,) in db.query(SalesOrder.customer_id).filter(SalesOrder.is_deleted == False,  # noqa: E712
                                                                 SalesOrder.status.in_(credit_svc.UNBILLED_SO_STATUSES)).distinct()}
    ids |= {i for (i,) in db.query(Organization.id).filter(Organization.credit_limit.isnot(None), Organization.credit_limit > 0)}
    rows = []
    for cid in ids:
        p = credit_svc.credit_exposure(db, cid)
        p.pop("orders", None)
        p.pop("overdue_items", None)
        rows.append(p)
    rows.sort(key=lambda r: (not r["would_block"], -(r["exposure"] or 0)))
    return {"rows": rows, "blocked": sum(1 for r in rows if r["would_block"])}


def _release_responses(db: Session, rels: list[AccountsCreditRelease]) -> list[AccountsCreditReleaseResponse]:
    from app.modules.accounts.access import approval_states
    from app.modules.sales.models.order import SalesOrder
    names = user_names(db, {r.requested_by_id for r in rels} | {r.decided_by_id for r in rels})
    custs = _customer_names(db, {r.customer_id for r in rels})
    so_ids = {r.sales_order_id for r in rels if r.sales_order_id}
    sos = {o.id: o.so_number or f"Draft #{o.id}" for o in db.query(SalesOrder).filter(SalesOrder.id.in_(so_ids)).all()} if so_ids else {}
    states = approval_states(db, racc.ET_CREDIT_RELEASE, [r.id for r in rels])
    return [AccountsCreditReleaseResponse.model_validate(r).model_copy(update={
        "customer_name": custs.get(r.customer_id), "so_number": sos.get(r.sales_order_id),
        "requested_by_name": names.get(r.requested_by_id), "decided_by_name": names.get(r.decided_by_id),
        **states.get(r.id, {})}) for r in rels]


@router.get("/credit/releases", response_model=list[AccountsCreditReleaseResponse])
async def list_releases(status: str | None = Query(None), customer_id: int | None = Query(None), db: Session = Depends(get_db),
                        _user: User = Depends(_credit_viewer)):
    q = db.query(AccountsCreditRelease)
    if status:
        q = q.filter(AccountsCreditRelease.status == status)
    if customer_id:
        q = q.filter(AccountsCreditRelease.customer_id == customer_id)
    return _release_responses(db, q.order_by(AccountsCreditRelease.id.desc()).limit(300).all())


@router.post("/credit/releases", response_model=AccountsCreditReleaseResponse, status_code=201)
async def request_release(payload: AccountsCreditReleaseCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                          user: User = Depends(_credit_viewer)):
    from app.modules.organization.services import approval_engine as engine
    with service_errors(db):
        rel = credit_svc.request_release(db, customer_id=payload.customer_id, checkpoint=payload.checkpoint,
                                         sales_order_id=payload.sales_order_id, reason=payload.reason, user_id=user.id)
    cust = _customer_names(db, {rel.customer_id}).get(rel.customer_id, "customer")
    req = engine.submit(db, racc.KEY_CREDIT_RELEASE, entity_id=rel.id, requester=user,
                        title=f"Credit release for {cust} ({CREDIT_CHECKPOINTS[rel.checkpoint].lower()})",
                        reference=rel.release_number, amount=credit_svc.excess_amount(rel),
                        context={"checkpoint": rel.checkpoint, "excess_amount": credit_svc.excess_amount(rel),
                                 "max_days_overdue": rel.max_days_overdue})
    if getattr(req, "status", None) == "pending":
        role_events_b.fire(
            db, "credit_release_requested",
            title=f"Credit release {rel.release_number} requested — {cust}",
            message=(f"{who(user)} asks to release the credit block on {cust} at {CREDIT_CHECKPOINTS[rel.checkpoint].lower()} "
                     f"(excess {credit_svc.excess_amount(rel):,.2f}, oldest overdue {rel.max_days_overdue or 0} days): "
                     f"{rel.request_reason[:160]}. Decide it in Finance › Outstanding › Credit Management."),
            entity_type=racc.ET_CREDIT_RELEASE, entity_id=rel.id, actor=user,
            skip=role_events_b.step_approvers(req), background_tasks=background_tasks)
    write_audit(db, "credit_release", rel.id, "requested", user, f"{who(user)} asked for credit release {rel.release_number}: {rel.request_reason}")
    db.commit()
    db.refresh(rel)
    return _release_responses(db, [rel])[0]


@router.post("/credit/releases/{release_id}/withdraw", response_model=AccountsCreditReleaseResponse)
async def withdraw_release(release_id: int, payload: AccountsCreditReleaseWithdrawPayload, db: Session = Depends(get_db),
                           user: User = Depends(_credit_viewer)):
    from app.modules.organization.services import approval_engine as engine
    rel = db.get(AccountsCreditRelease, release_id)
    if not rel:
        raise HTTPException(status_code=404, detail=f"Credit release #{release_id} not found — refresh the page.")
    if rel.status != "pending_approval":
        raise HTTPException(status_code=409, detail=f"{rel.release_number} is already {rel.status} — it can't be withdrawn.")
    if rel.requested_by_id != user.id and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Only the person who asked for the release (or an admin) can withdraw it.")
    engine.cancel_for_entity(db, racc.ET_CREDIT_RELEASE, rel.id, user, payload.reason or "withdrawn by the requester")
    if rel.status == "pending_approval":
        credit_svc.decide_release(db, rel, "cancelled", user.id, payload.reason)
    db.commit()
    db.refresh(rel)
    return _release_responses(db, [rel])[0]


# ── Collections ──────────────────────────────────────────────────────────

def _note_responses(db: Session, notes: list[AccountsCollectionNote]) -> list[AccountsCollectionNoteResponse]:
    names = user_names(db, {n.created_by_id for n in notes})
    inv_ids = {n.ar_transaction_id for n in notes if n.ar_transaction_id}
    invs = {i: num for i, num in db.query(ARTransaction.id, ARTransaction.invoice_number).filter(ARTransaction.id.in_(inv_ids)).all()} if inv_ids else {}
    return [AccountsCollectionNoteResponse.model_validate(n).model_copy(update={
        "invoice_number": invs.get(n.ar_transaction_id), "created_by_name": names.get(n.created_by_id)}) for n in notes]


def _letter_responses(db: Session, letters: list[AccountsDunningLetter]) -> list[AccountsDunningLetterResponse]:
    names = user_names(db, {l.created_by_id for l in letters})
    custs = _customer_names(db, {l.customer_id for l in letters})
    return [AccountsDunningLetterResponse.model_validate(l).model_copy(update={
        "customer_name": custs.get(l.customer_id), "created_by_name": names.get(l.created_by_id)}) for l in letters]


@router.get("/collections/worklist")
async def collections_worklist(as_of: date | None = Query(None), db: Session = Depends(get_db),
                               _user: User = Depends(require_tab_access("accounts", "collections"))):
    rows = coll.worklist(db, as_of=as_of)
    db.commit()  # promise statuses refreshed
    return {"as_of": as_of or date.today(), "rows": rows,
            "totals": {"overdue_amount": round(sum(r["overdue_amount"] for r in rows), 2),
                       "disputed": round(sum(r["disputed"] for r in rows), 2), "customers": len(rows),
                       "high": sum(1 for r in rows if r["priority"] == "high")}}


@router.get("/collections/customers/{customer_id}")
async def collections_customer(customer_id: int, db: Session = Depends(get_db),
                               user: User = Depends(require_tab_access("accounts", "collections"))):
    coll.refresh_promises(db, customer_id=customer_id)
    db.commit()
    notes = db.query(AccountsCollectionNote).filter(AccountsCollectionNote.customer_id == customer_id) \
        .order_by(AccountsCollectionNote.note_date.desc(), AccountsCollectionNote.id.desc()).limit(200).all()
    # Reminder letters belong to the Dunning feature — left out for a role without it.
    letters = db.query(AccountsDunningLetter).filter(AccountsDunningLetter.customer_id == customer_id) \
        .order_by(AccountsDunningLetter.id.desc()).limit(50).all() \
        if can_feature(user, "accounts", "collections", "dunning", "view") else []
    return {"customer_id": customer_id, "customer_name": _customer_names(db, {customer_id}).get(customer_id, "—"),
            "overdue_items": coll.overdue_items(db, customer_id=customer_id),
            "notes": _note_responses(db, notes), "letters": _letter_responses(db, letters)}


@router.post("/collections/notes", response_model=AccountsCollectionNoteResponse, status_code=201)
async def add_collection_note(payload: AccountsCollectionNoteCreate, db: Session = Depends(get_db),
                              user: User = Depends(require_tab_action("accounts", "collections", "create"))):
    with service_errors(db):
        n = coll.add_note(db, created_by_id=user.id, **payload.model_dump())
    db.commit()
    db.refresh(n)
    return _note_responses(db, [n])[0]


@router.post("/collections/notes/{note_id}/cancel-promise", response_model=AccountsCollectionNoteResponse)
async def cancel_promise(note_id: int, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_action("accounts", "collections", "edit"))):
    n = db.get(AccountsCollectionNote, note_id)
    if not n:
        raise HTTPException(status_code=404, detail=f"Collection note #{note_id} not found — refresh the page.")
    with service_errors(db):
        coll.cancel_promise(db, n)
    write_audit(db, "collection_note", n.id, "promise_cancelled", user, f"{who(user)} cancelled a promise to pay.")
    db.commit()
    return _note_responses(db, [n])[0]


@router.get("/collections/dunning-proposal")
async def dunning_proposal(as_of: date | None = Query(None), db: Session = Depends(get_db),
                           _user: User = Depends(require_feature_action("accounts", "collections", "dunning", "view"))):
    return {"as_of": as_of or date.today(), "thresholds": coll.level_thresholds(db),
            "customers": coll.dunning_proposal(db, as_of=as_of)}


@router.post("/collections/dunning-run", response_model=list[AccountsDunningLetterResponse], status_code=201)
async def dunning_run(payload: AccountsDunningRunPayload, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("accounts", "collections", "dunning", "create"))):
    if payload.as_of and payload.as_of > date.today():
        raise HTTPException(status_code=400, detail="A dunning run can't be dated in the future — leave the date empty for today.")
    letters = coll.run_dunning(db, user_id=user.id, as_of=payload.as_of, customer_ids=payload.customer_ids)
    if not letters:
        raise HTTPException(status_code=409, detail="Nothing to remind: no customer has an invoice whose reminder level goes up today "
                                                    "(check the day counts and the minimum amount in Finance › Settings › Collections & dunning).")
    for l in letters:
        write_audit(db, "dunning_letter", l.id, "issued", user, f"{who(user)} issued reminder {l.letter_number} (level {l.dunning_level}).")
    db.commit()
    return _letter_responses(db, letters)


@router.get("/collections/letters", response_model=list[AccountsDunningLetterResponse])
async def list_letters(customer_id: int | None = Query(None), db: Session = Depends(get_db),
                       _user: User = Depends(require_feature_action("accounts", "collections", "dunning", "view"))):
    q = db.query(AccountsDunningLetter)
    if customer_id:
        q = q.filter(AccountsDunningLetter.customer_id == customer_id)
    return _letter_responses(db, q.order_by(AccountsDunningLetter.id.desc()).limit(300).all())


@router.get("/collections/letters/{letter_id}", response_model=AccountsDunningLetterResponse)
async def get_letter(letter_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "collections", "dunning", "view"))):
    return _letter_responses(db, [racc.letter_or_404(db, letter_id)])[0]


@router.post("/collections/letters/{letter_id}/cancel", response_model=AccountsDunningLetterResponse)
async def cancel_letter(letter_id: int, payload: AccountsDunningLetterCancelPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_feature_action("accounts", "collections", "dunning", "cancel"))):
    letter = racc.letter_or_404(db, letter_id)
    with service_errors(db):
        coll.cancel_letter(db, letter, payload.reason)
    write_audit(db, "dunning_letter", letter.id, "cancelled", user, f"{who(user)} cancelled {letter.letter_number}: {payload.reason}")
    db.commit()
    return _letter_responses(db, [letter])[0]


@router.get("/collections/letters/{letter_id}/letter.pdf")
async def letter_pdf(letter_id: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("accounts", "collections", "dunning", "print"))):
    """PDF of the Word document of record once one exists, else rendered fresh."""
    from datetime import datetime
    from app.modules.quality.reports.render import render_pdf
    letter = racc.letter_or_404(db, letter_id)
    spec = coll.letter_spec(db, letter)

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {datetime.now():%d-%m-%Y %H:%M} by {who(user)} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the reminder letter PDF: {e}")

    md = racc.managed_documents
    pdf = await md.pdf_of_record(db, racc.ET_DUNNING_LETTER, letter.id, 0, render=render) if md else render()
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="Reminder-{letter.letter_number}.pdf"'})


# ── Disputes ─────────────────────────────────────────────────────────────

def _dispute_responses(db: Session, rows: list[AccountsDispute]) -> list[AccountsDisputeResponse]:
    names = user_names(db, {d.owner_user_id for d in rows} | {d.resolved_by_id for d in rows})
    custs = _customer_names(db, {d.customer_id for d in rows})
    inv_ids = {d.ar_transaction_id for d in rows}
    invs = {i.id: i for i in db.query(ARTransaction).filter(ARTransaction.id.in_(inv_ids)).all()} if inv_ids else {}
    note_ids = {d.party_note_id for d in rows if d.party_note_id}
    notes = {n.id: n.note_number for n in db.query(PartyNote).filter(PartyNote.id.in_(note_ids)).all()} if note_ids else {}
    return [AccountsDisputeResponse.model_validate(d).model_copy(update={
        "customer_name": custs.get(d.customer_id),
        "invoice_number": invs[d.ar_transaction_id].invoice_number if d.ar_transaction_id in invs else None,
        "invoice_due": float(invs[d.ar_transaction_id].amount_due or 0) if d.ar_transaction_id in invs else None,
        "owner_name": names.get(d.owner_user_id), "resolved_by_name": names.get(d.resolved_by_id),
        "credit_note_number": notes.get(d.party_note_id)}) for d in rows]


@router.get("/disputes", response_model=list[AccountsDisputeResponse])
async def list_disputes(status: str | None = Query(None, description="a status, or 'open_all' for open + under review"),
                        customer_id: int | None = Query(None), ar_transaction_id: int | None = Query(None),
                        db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "disputes"))):
    q = db.query(AccountsDispute)
    if status == "open_all":
        q = q.filter(AccountsDispute.status.in_(("open", "under_review")))
    elif status:
        q = q.filter(AccountsDispute.status == status)
    if customer_id:
        q = q.filter(AccountsDispute.customer_id == customer_id)
    if ar_transaction_id:
        q = q.filter(AccountsDispute.ar_transaction_id == ar_transaction_id)
    return _dispute_responses(db, q.order_by(AccountsDispute.id.desc()).limit(500).all())


@router.post("/disputes", response_model=AccountsDisputeResponse, status_code=201)
async def create_dispute(payload: AccountsDisputeCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_action("accounts", "disputes", "create"))):
    with service_errors(db):
        d = disp.create_dispute(db, created_by_id=user.id, **payload.model_dump())
    write_audit(db, "dispute", d.id, "created", user, f"{who(user)} raised dispute {d.dispute_number} for {d.disputed_amount:,.2f}.")
    if d.owner_user_id and d.owner_user_id != user.id:
        from app.utils.notifications import notify_user
        notify_user(db, d.owner_user_id, f"Dispute {d.dispute_number} assigned to you",
                    f"{who(user)}: {d.description[:160]}", "accounts_dispute_assigned", "accounts_dispute", d.id)
    inv = db.get(ARTransaction, d.ar_transaction_id) if d.ar_transaction_id else None
    cust = _customer_names(db, {d.customer_id}).get(d.customer_id, "customer") if d.customer_id else "customer"
    role_events_b.fire(
        db, "dispute_raised", title=f"Dispute {d.dispute_number} raised — {cust}",
        message=(f"{who(user)} recorded a dispute of {d.disputed_amount:,.2f}"
                 f"{f' on invoice {inv.invoice_number}' if inv else ''}: {d.description[:160]}. "
                 "The amount is held out of collections until it is resolved (Finance › Outstanding › Disputes)."),
        entity_type="accounts_dispute", entity_id=d.id, actor=user, skip={d.owner_user_id}, background_tasks=background_tasks)
    db.commit()
    db.refresh(d)
    return _dispute_responses(db, [d])[0]


@router.get("/disputes/{dispute_id}", response_model=AccountsDisputeResponse)
async def get_dispute(dispute_id: int, db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "disputes"))):
    try:
        return _dispute_responses(db, [disp.get_dispute(db, dispute_id)])[0]
    except LookupError as e:
        raise _not_found(e)


@router.patch("/disputes/{dispute_id}", response_model=AccountsDisputeResponse)
async def update_dispute(dispute_id: int, payload: AccountsDisputeUpdate, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_action("accounts", "disputes", "edit"))):
    try:
        d = disp.get_dispute(db, dispute_id)
    except LookupError as e:
        raise _not_found(e)
    with service_errors(db):
        disp.update_dispute(db, d, **payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(d)
    return _dispute_responses(db, [d])[0]


@router.post("/disputes/{dispute_id}/resolve", response_model=AccountsDisputeResponse)
async def resolve_dispute(dispute_id: int, payload: AccountsDisputeResolvePayload, background_tasks: BackgroundTasks,
                          db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("accounts", "disputes", "resolution", "approve"))):
    try:
        d = disp.get_dispute(db, dispute_id)
    except LookupError as e:
        raise _not_found(e)
    with service_errors(db):
        disp.resolve_dispute(db, d, user=user, **payload.model_dump())
    write_audit(db, "dispute", d.id, d.status, user, f"{who(user)} resolved {d.dispute_number} ({DISPUTE_STATUSES[d.status]}): {d.resolution_note}")
    cust = _customer_names(db, {d.customer_id}).get(d.customer_id, "customer") if d.customer_id else "customer"
    role_events_b.fire(
        db, "dispute_resolved", title=f"Dispute {d.dispute_number} resolved — {DISPUTE_STATUSES[d.status]}",
        message=(f"{who(user)} closed the {cust} dispute of {d.disputed_amount:,.2f}: {(d.resolution_note or '')[:160]}. "
                 "Any undisputed balance is back in the collections worklist."),
        entity_type="accounts_dispute", entity_id=d.id, actor=user, background_tasks=background_tasks)
    db.commit()
    db.refresh(d)
    return _dispute_responses(db, [d])[0]
