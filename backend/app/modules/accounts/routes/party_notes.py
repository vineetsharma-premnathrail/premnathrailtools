from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_app_access, ensure_tab_action, ensure_can_delete
from app.core.permission_registry import can_view_tab
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.models.vendor_invoice import VendorInvoice
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.schemas.party_note import PartyNoteCreate, PartyNoteCancelPayload, PartyNoteResponse
from app.modules.accounts.services.notes import create_party_note, cancel_party_note
from app.modules.accounts.routes._common import write_audit, who, service_errors, user_names, tax_lines_response
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/notes", tags=["Accounts"])

# Debit notes sit under Finance › Purchase, credit notes under Finance › Sales —
# each note type is gated by its own tab.
_NOTE_TAB = {"debit_note": "debit_notes", "credit_note": "credit_notes"}


def _note_tab(note_type: str | None) -> str:
    tab = _NOTE_TAB.get(note_type or "")
    if not tab:
        raise HTTPException(status_code=400, detail="note_type must be 'debit_note' (purchase return) or 'credit_note' (sales return).")
    return tab


def _load(db: Session, note_id: int) -> PartyNote | None:
    return db.query(PartyNote).options(selectinload(PartyNote.lines)).filter(PartyNote.id == note_id).first()


def _load_in_scope(db: Session, user: User, note_id: int, action: str = "view") -> PartyNote:
    note = _load(db, note_id)
    if not note:
        raise HTTPException(status_code=404, detail=f"Debit/credit note #{note_id} doesn't exist — it may have been removed. Refresh the Notes list.")
    ensure_tab_action(user, "accounts", _note_tab(note.note_type), action)
    ensure_in_scope(db, user, note)
    return note


def _to_response(n: PartyNote, db: Session, approval: dict | None = None) -> PartyNoteResponse:
    if n.vendor_id:
        party = db.query(Vendor).filter(Vendor.id == n.vendor_id).first()
    else:
        from app.modules.crm.models.organization import Organization
        party = db.query(Organization).filter(Organization.id == n.customer_id).first()
    original = None
    if n.vendor_invoice_id:
        original = db.query(VendorInvoice).filter(VendorInvoice.id == n.vendor_invoice_id).first()
    elif n.ar_transaction_id:
        original = db.query(ARTransaction).filter(ARTransaction.id == n.ar_transaction_id).first()
    return PartyNoteResponse.model_validate(n).model_copy(update={
        "party_name": party.name if party else None,
        "original_invoice_number": original.invoice_number if original else None,
        "created_by_name": user_names(db, {n.created_by_id}).get(n.created_by_id),
        "lines": tax_lines_response(db, n.lines),
        **(approval if approval is not None else access.approval_state(db, access.ET_NOTE, n.id)),
    })


@router.get("", response_model=list[PartyNoteResponse])
async def list_notes(
    note_type: str | None = Query(None),
    status: str | None = Query(None),
    vendor_id: int | None = Query(None),
    customer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    q = apply_scope(db.query(PartyNote).options(selectinload(PartyNote.lines)), user, PartyNote)
    if note_type:
        ensure_tab_action(user, "accounts", _note_tab(note_type), "view")
        q = q.filter(PartyNote.note_type == note_type)
    else:
        visible = [t for t, tab in _NOTE_TAB.items() if can_view_tab(user, "accounts", tab)]
        if not visible:
            ensure_tab_action(user, "accounts", "debit_notes", "view")
        q = q.filter(PartyNote.note_type.in_(visible))
    if status:
        q = q.filter(PartyNote.status == status)
    if vendor_id:
        q = q.filter(PartyNote.vendor_id == vendor_id)
    if customer_id:
        q = q.filter(PartyNote.customer_id == customer_id)
    notes = q.order_by(PartyNote.note_date.desc(), PartyNote.id.desc()).limit(500).all()
    states = access.approval_states(db, access.ET_NOTE, [n.id for n in notes if n.status == "pending"])
    return [_to_response(n, db, states.get(n.id, {})) for n in notes]


@router.get("/{note_id}", response_model=PartyNoteResponse)
async def get_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("accounts"))):
    return _to_response(_load_in_scope(db, user, note_id), db)


@router.post("", response_model=PartyNoteResponse, status_code=201)
async def create_note(payload: PartyNoteCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("accounts"))):
    ensure_tab_action(user, "accounts", _note_tab(payload.note_type), "create")
    with service_errors(db):
        note = create_party_note(
            db, note_type=payload.note_type, note_date=payload.note_date, reason=payload.reason, vendor_id=payload.vendor_id,
            vendor_invoice_id=payload.vendor_invoice_id, ar_transaction_id=payload.ar_transaction_id, round_off=payload.round_off,
            narration=payload.narration, lines=[l.model_dump() for l in payload.lines], created_by_id=user.id,
        )
    write_audit(db, "party_note", note.id, "created", user, f"{who(user)} drafted a {note.note_type.replace('_', ' ')} for {note.total_amount:,.2f}.")
    db.commit()
    return _to_response(_load(db, note.id), db)


def _approval_args(n: PartyNote, db: Session) -> dict:
    party = _to_response(n, db, {}).party_name or "party"
    label = n.note_type.replace("_", " ").capitalize()
    return dict(entity_id=n.id, title=f"{label} — {party} ({n.reason or 'no reason given'})"[:300], reference=None,
                amount=n.total_amount, context={})


def _ensure_pending(n: PartyNote) -> None:
    if n.status != "pending":
        raise HTTPException(status_code=400, detail=f"Only a draft (unposted) note goes through approval (current status: '{n.status}').")


@router.post("/{note_id}/submit", response_model=PartyNoteResponse)
async def submit_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("accounts"))):
    """Send a draft debit/credit note to its approvers (Organization › Approval
    Workflows, 'Debit note' / 'Credit note'). It posts on the last approval."""
    note = _load_in_scope(db, user, note_id, "submit")
    _ensure_pending(note)
    access.submit_document(db, access.NOTE_KEYS[note.note_type], requester=user, **_approval_args(note, db))
    write_audit(db, "party_note", note.id, "submitted", user, f"{who(user)} submitted a draft {note.note_type.replace('_', ' ')} for approval.")
    db.commit()
    return _to_response(_load(db, note.id), db)


@router.post("/{note_id}/post", response_model=PartyNoteResponse)
async def post_note(note_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("accounts"))):
    """The approver's one click: approves the note's current approval stage
    (submitting it on the maker's behalf if nobody did yet). It posts once the
    workflow's last stage is approved."""
    note = _load_in_scope(db, user, note_id, "approve")
    _ensure_pending(note)
    with service_errors(db):
        access.approve_now(db, access.NOTE_KEYS[note.note_type], maker_id=note.created_by_id, actor=user,
                           **_approval_args(note, db))
    db.commit()
    return _to_response(_load(db, note.id), db)


@router.post("/{note_id}/cancel", response_model=PartyNoteResponse)
async def cancel_note(note_id: int, payload: PartyNoteCancelPayload, db: Session = Depends(get_db),
                      user: User = Depends(require_app_access("accounts"))):
    # Cancelling an unposted draft note is its delete: 'Delete' on the tab + own draft.
    draft = _load_in_scope(db, user, note_id)
    ensure_can_delete(user, draft, "accounts", _note_tab(draft.note_type), what="draft note")
    if draft.status == "pending":
        access.cancel_live(db, access.ET_NOTE, draft.id, user, payload.reason)
    with service_errors(db):
        note = cancel_party_note(db, party_note_id=note_id, reason=payload.reason)
    write_audit(db, "party_note", note.id, "cancelled", user, f"{who(user)} cancelled a draft note: {payload.reason}")
    db.commit()
    return _to_response(_load(db, note.id), db)
