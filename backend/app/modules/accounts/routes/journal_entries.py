from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.organization.models.cost_center import CostCenter
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.schemas.journal_entry import (
    JournalEntryCreate, JournalEntryReversePayload, JournalEntryResponse,
    JournalEntryDetailsPayload, JournalEntryHistoryRow,
)
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.service import (
    create_draft_journal, discard_draft_journal, reverse_journal_entry,
)
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/journal-entries", tags=["Accounts"])

# Where to correct a journal that a document (or a period-end process) posted —
# reversing it from Journals would leave the document saying one thing and
# the books another.
_DOCUMENT_FIX = {
    "vendor_invoice": "raise a debit note against the vendor invoice (Finance > Notes)",
    "ar_transaction": "raise a credit note against the sales invoice (Finance > Notes)",
    "party_note": "cancel the debit/credit note itself (Finance > Notes)",
    "payment_transaction": "cancel the voucher (Finance > Payments)",
    "payment_allocation": "remove the advance adjustment from the voucher's settlements (Finance > Payments)",
    "settlement_adjustment": "cancel the write-off (Finance > Payments > Write-offs)",
    "depreciation_run": "reverse the depreciation run (Finance > Assets > Depreciation)",
    "fixed_asset": "correct the asset disposal on the asset itself (Finance > Assets)",
    "inventory_valuation": "cancel the closing-stock valuation (Finance > Inventory)",
    "inventory_valuation_cancel": "post a fresh closing-stock valuation (Finance > Inventory) — this entry cancelled the old one",
}
_PROCESS_FIX = {
    "year_end": "use Reports > Year-end > Reopen — that also reopens the financial year",
    "closing_stock": "cancel the closing-stock valuation (Finance > Inventory)",
    "asset_disposal": "correct the asset disposal on the asset itself (Finance > Assets)",
}


def _check_reversible(original: JournalEntry) -> None:
    if original.reverses_journal_entry_id:
        raise HTTPException(status_code=400, detail=(
            f"{original.entry_number} is itself a reversal — reversing it again would just re-post the original. "
            f"If the original was right after all, post a fresh journal for it instead."
        ))
    if original.reference_document_type:
        fix = _DOCUMENT_FIX.get(original.reference_document_type,
                                f"correct it through the {original.reference_document_type.replace('_', ' ')} that posted it")
        raise HTTPException(status_code=400, detail=(
            f"{original.entry_number} was posted by a {original.reference_document_type.replace('_', ' ')}, so it can't be "
            f"reversed from Journals — {fix}, so the document and the books stay in step."
        ))
    if original.posting_type in _PROCESS_FIX:
        raise HTTPException(status_code=400, detail=(
            f"{original.entry_number} is a {original.posting_type.replace('_', ' ')} entry and can't be reversed from Journals — "
            f"{_PROCESS_FIX[original.posting_type]}."
        ))


def _load(db: Session, entry_id: int) -> JournalEntry | None:
    return db.query(JournalEntry).options(selectinload(JournalEntry.lines)).filter(JournalEntry.id == entry_id).first()


def _to_response(je: JournalEntry, db: Session, approval: dict | None = None) -> JournalEntryResponse:
    user_ids = {je.created_by_id, je.posted_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    gl_ids = {l.gl_account_id for l in je.lines}
    gl_accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_ids)).all()} if gl_ids else {}
    cc_ids = {l.cost_center_id for l in je.lines} - {None}
    cost_centers = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).all()} if cc_ids else {}
    io_ids = {l.internal_order_id for l in je.lines} - {None}
    internal_orders = {o.id: o for o in db.query(InternalOrder).filter(InternalOrder.id.in_(io_ids)).all()} if io_ids else {}

    resp = JournalEntryResponse.model_validate(je)
    resp.lines = sorted(resp.lines, key=lambda l: l.line_number)
    if je.created_by_id and je.created_by_id in users:
        resp.created_by_name = users[je.created_by_id].name or users[je.created_by_id].email
    if je.posted_by_id and je.posted_by_id in users:
        resp.posted_by_name = users[je.posted_by_id].name or users[je.posted_by_id].email
    for line_resp in resp.lines:
        gl = gl_accounts.get(line_resp.gl_account_id)
        line_resp.gl_account_code = gl.code if gl else None
        line_resp.gl_account_name = gl.name if gl else None
        if line_resp.cost_center_id and line_resp.cost_center_id in cost_centers:
            line_resp.cost_center_name = cost_centers[line_resp.cost_center_id].name
        if line_resp.internal_order_id and line_resp.internal_order_id in internal_orders:
            line_resp.internal_order_name = internal_orders[line_resp.internal_order_id].name
    for k, v in (approval if approval is not None else access.approval_state(db, access.ET_JOURNAL, je.id)).items():
        setattr(resp, k, v)
    return resp


def _load_in_scope(db: Session, user: User, entry_id: int) -> JournalEntry:
    entry = _load(db, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Journal entry #{entry_id} doesn't exist — it may have been discarded. Refresh the Journal Vouchers list.")
    ensure_in_scope(db, user, entry)
    return entry


@router.get("", response_model=list[JournalEntryResponse])
async def list_journal_entries(
    accounting_period: str | None = Query(None),
    status: str | None = Query(None),
    voucher_type: str | None = Query(None),
    posting_type: str | None = Query(None),
    gl_account_id: int | None = Query(None),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    cost_center_id: int | None = Query(None),
    internal_order_id: int | None = Query(None),
    include_sub_cost_centers: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "journal_vouchers")),
):
    query = apply_scope(db.query(JournalEntry).options(selectinload(JournalEntry.lines)), user, JournalEntry)
    if accounting_period is not None:
        query = query.filter(JournalEntry.accounting_period == accounting_period)
    if status is not None:
        query = query.filter(JournalEntry.status == status)
    if voucher_type is not None:
        query = query.filter(JournalEntry.voucher_type == voucher_type)
    if posting_type is not None:
        query = query.filter(JournalEntry.posting_type == posting_type)
    if from_date is not None:
        query = query.filter(JournalEntry.posting_date >= from_date)
    if to_date is not None:
        query = query.filter(JournalEntry.posting_date <= to_date)
    if gl_account_id is not None:
        query = query.filter(JournalEntry.id.in_(db.query(JournalEntryLine.journal_entry_id).filter(JournalEntryLine.gl_account_id == gl_account_id)))
    if cost_center_id is not None or internal_order_id is not None:
        from app.modules.accounts.services.controlling import journal_line_filter
        query = journal_line_filter(db, query, cost_center_id=cost_center_id, internal_order_id=internal_order_id,
                                    include_children=include_sub_cost_centers)
    entries = query.order_by(JournalEntry.posting_date.desc(), JournalEntry.id.desc()).limit(500).all()
    states = access.approval_states(db, access.ET_JOURNAL, [e.id for e in entries if e.status == "draft"])
    return [_to_response(e, db, states.get(e.id, {})) for e in entries]


@router.get("/by-number", response_model=JournalEntryResponse)
async def get_journal_entry_by_number(
    entry_number: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "journal_vouchers")),
):
    """FB03 lookup: open a voucher by its number (e.g. JV/2026-27/0001)."""
    number = entry_number.strip().upper()
    entry = db.query(JournalEntry).filter(JournalEntry.entry_number == number).first()
    if not entry:
        raise HTTPException(status_code=404, detail=(
            f"No voucher numbered '{entry_number.strip()}'. Check the number in the Day Book — it is "
            f"<TYPE>/<FY>/<NNNN>, e.g. JV/2026-27/0001. Drafts have no voucher number until posted."
        ))
    ensure_in_scope(db, user, entry)
    return _detail_response(_load(db, entry.id), db)


def _detail_response(je: JournalEntry, db: Session) -> JournalEntryResponse:
    """Single-voucher view: the list response plus the reversal pair, so the
    voucher screen can jump between an original and its reversal."""
    resp = _to_response(je, db)
    if je.reverses_journal_entry_id:
        orig = db.query(JournalEntry.entry_number).filter(JournalEntry.id == je.reverses_journal_entry_id).first()
        resp.reverses_entry_number = orig[0] if orig else None
    rev = db.query(JournalEntry.id, JournalEntry.entry_number).filter(JournalEntry.reverses_journal_entry_id == je.id).first()
    if rev:
        resp.reversal_journal_entry_id, resp.reversal_entry_number = rev[0], rev[1]
    if je.reversed_by_id:
        u = db.query(User).filter(User.id == je.reversed_by_id).first()
        resp.reversed_by_name = (u.name or u.email) if u else None
    return resp


@router.get("/{journal_entry_id}", response_model=JournalEntryResponse)
async def get_journal_entry(
    journal_entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "journal_vouchers")),
):
    return _detail_response(_load_in_scope(db, user, journal_entry_id), db)


@router.get("/{journal_entry_id}/history", response_model=list[JournalEntryHistoryRow])
async def get_journal_entry_history(
    journal_entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "journal_vouchers", "change_history", "view")),
):
    _load_in_scope(db, user, journal_entry_id)
    rows = (db.query(AuditLog).filter(AuditLog.entity_type == "journal_entry", AuditLog.entity_id == journal_entry_id)
            .order_by(AuditLog.performed_at.desc(), AuditLog.id.desc()).all())
    user_ids = {r.performed_by_id for r in rows} - {None}
    users = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [JournalEntryHistoryRow(
        id=r.id, action=r.action, summary=r.summary, field_name=r.field_name, old_value=r.old_value,
        new_value=r.new_value, performed_by_name=users.get(r.performed_by_id), performed_at=r.performed_at,
    ) for r in rows]


@router.patch("/{journal_entry_id}/details", response_model=JournalEntryResponse)
async def change_journal_entry_details(
    journal_entry_id: int,
    payload: JournalEntryDetailsPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "journal_vouchers", "edit")),
):
    """FB02: change the permitted fields of a posted voucher — the narration
    and line remarks. Ledger, amount, party, cost centre and dates never
    change after posting (that is a reversal); every change is logged with
    its old and new value."""
    entry = _load_in_scope(db, user, journal_entry_id)
    if entry.status not in ("posted", "reversed"):
        raise HTTPException(status_code=400, detail=(
            "Only a posted voucher's text can be changed here. A draft is corrected by discarding it and drafting it again; "
            "a discarded draft never reached the books."
        ))
    data = payload.model_dump(exclude_unset=True)
    changes: list[tuple[str, str | None, str | None]] = []

    def clean(v: str | None) -> str | None:
        return (v or "").strip() or None

    if "description" in data:
        new = clean(data["description"])
        if new != entry.description:
            changes.append(("description", entry.description, new))
            entry.description = new
    lines_by_id = {l.id: l for l in entry.lines}
    for change in data.get("lines") or []:
        line = lines_by_id.get(change["line_id"])
        if not line:
            raise HTTPException(status_code=400, detail=(
                f"Line #{change['line_id']} is not on {entry.entry_number}. Reload the voucher and try again."
            ))
        new = clean(change.get("remarks"))
        if new != line.remarks:
            changes.append((f"line {line.line_number} remarks", line.remarks, new))
            line.remarks = new
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing changed — edit the narration or a line remark before saving.")
    for field, old, new in changes:
        db.add(AuditLog(entity_type="journal_entry", entity_id=entry.id, action="text_changed", performed_by_id=user.id,
                        field_name=field, old_value=old, new_value=new, module_key="accounts", subtab_key="journal_vouchers",
                        summary=f"{who(user)} changed the {field} of {entry.entry_number}."))
    db.commit()
    return _detail_response(_load(db, entry.id), db)


@router.post("", response_model=JournalEntryResponse, status_code=201)
async def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "journal_vouchers", "create")),
):
    """Records a manual journal as a draft. A different finance user posts it
    (maker-checker) — manual journals are where errors and fraud enter the
    books, so no one posts their own."""
    with service_errors(db):
        entry = create_draft_journal(
            db, posting_date=payload.posting_date, description=payload.description, posting_type=payload.posting_type,
            auto_reverse_on=payload.auto_reverse_on, lines=[line.model_dump() for line in payload.lines], created_by_id=user.id,
        )
    write_audit(db, "journal_entry", entry.id, "created", user, f"{who(user)} drafted a {payload.posting_type} journal for {entry.total_debit:,.2f}.")
    db.commit()
    return _to_response(_load(db, entry.id), db)


def _approval_args(entry: JournalEntry) -> dict:
    return dict(entity_id=entry.id, title=f"Journal ({entry.posting_type}) — {entry.description or 'manual journal'}"[:300],
                reference=f"Draft journal of {entry.posting_date:%d-%b-%Y}", amount=entry.total_debit,
                context={"posting_type": entry.posting_type})


@router.post("/{journal_entry_id}/submit", response_model=JournalEntryResponse)
async def submit_journal_entry_route(
    journal_entry_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "journal_vouchers", "submit")),
):
    """Send a draft journal to its approvers (Organization › Approval Workflows,
    'Manual journal voucher'). It posts when the last approver approves."""
    entry = _load_in_scope(db, user, journal_entry_id)
    if entry.status != "draft":
        raise HTTPException(status_code=400, detail=f"Only a draft journal can be submitted for approval (current status: '{entry.status}').")
    access.submit_document(db, access.KEY_JOURNAL, requester=user, background_tasks=background_tasks, **_approval_args(entry))
    write_audit(db, "journal_entry", entry.id, "submitted", user, f"{who(user)} submitted a draft journal of {entry.total_debit:,.2f} for approval.")
    db.commit()
    return _to_response(_load(db, entry.id), db)


@router.post("/{journal_entry_id}/post", response_model=JournalEntryResponse)
async def post_journal_entry_route(
    journal_entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "journal_vouchers", "approve")),
):
    """The approver's one click: approves the journal's pending approval (or
    submits an unsubmitted draft on the maker's behalf and approves it). It
    posts once the workflow's last stage is approved."""
    entry = _load_in_scope(db, user, journal_entry_id)
    if entry.status != "draft":
        raise HTTPException(status_code=400, detail=f"Only a draft journal can be posted (current status: '{entry.status}').")
    with service_errors(db):
        access.approve_now(db, access.KEY_JOURNAL, maker_id=entry.created_by_id, actor=user, **_approval_args(entry))
    db.commit()
    return _to_response(_load(db, entry.id), db)


@router.post("/{journal_entry_id}/discard", response_model=JournalEntryResponse)
async def discard_journal_entry_route(
    journal_entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "journal_vouchers")),
):
    # Discarding an unposted draft is its delete: 'Delete' on the tab + own draft.
    draft = _load_in_scope(db, user, journal_entry_id)
    ensure_can_delete(user, draft, "accounts", "journal_vouchers", what="draft journal")
    if draft.status == "draft":
        access.cancel_live(db, access.ET_JOURNAL, draft.id, user, "Draft journal discarded")
    with service_errors(db):
        entry = discard_draft_journal(db, journal_entry_id=journal_entry_id, user_id=user.id)
    write_audit(db, "journal_entry", entry.id, "discarded", user, f"{who(user)} discarded a draft journal.")
    db.commit()
    return _to_response(_load(db, entry.id), db)


@router.post("/{journal_entry_id}/reverse", response_model=JournalEntryResponse)
async def reverse_journal_entry_route(
    journal_entry_id: int,
    payload: JournalEntryReversePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "journal_vouchers", "reversal", "cancel")),
):
    require_finance_manager(user, "reverse a journal entry")
    original = db.query(JournalEntry).filter(JournalEntry.id == journal_entry_id).first()
    if original:
        ensure_in_scope(db, user, original)
        _check_reversible(original)
    with service_errors(db):
        if original and original.posting_type == "opening" and original.status == "posted":
            # Its opening bills are bill-wise open items — they go with it.
            from app.modules.accounts.services.opening import release_opening_documents
            release_opening_documents(db, journal_entry_id=original.id, reason=payload.reason)
        reversal = reverse_journal_entry(db, journal_entry_id=journal_entry_id, reason=payload.reason, reversed_by_id=user.id,
                                         reversal_date=payload.reversal_date)
    write_audit(db, "journal_entry", journal_entry_id, "reversed", user, f"{who(user)} reversed journal entry — {payload.reason}")
    write_audit(db, "journal_entry", reversal.id, "posted", user, f"Reversal entry {reversal.entry_number} posted by {who(user)}.")
    db.commit()
    return _to_response(_load(db, reversal.id), db)
