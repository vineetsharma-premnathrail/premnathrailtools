from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.journal_entry import JournalEntry, JournalEntryLine
from app.modules.organization.models.cost_center import CostCenter
from app.modules.accounts.models.internal_order import InternalOrder
from app.modules.accounts.schemas.journal_entry import (
    JournalEntryCreate, JournalEntryReversePayload, JournalEntryResponse,
)
from app.modules.accounts.service import post_journal_entry, reverse_journal_entry

router = APIRouter(prefix="/accounts/journal-entries", tags=["Accounts"])


def _write_audit(db: Session, entry_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="journal_entry", entity_id=entry_id, action=action, performed_by_id=user.id, summary=summary))


def _to_response(je: JournalEntry, db: Session) -> JournalEntryResponse:
    user_ids = {je.created_by_id, je.posted_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    gl_ids = {l.gl_account_id for l in je.lines}
    gl_accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.id.in_(gl_ids)).all()} if gl_ids else {}
    cc_ids = {l.cost_center_id for l in je.lines} - {None}
    cost_centers = {c.id: c for c in db.query(CostCenter).filter(CostCenter.id.in_(cc_ids)).all()} if cc_ids else {}
    io_ids = {l.internal_order_id for l in je.lines} - {None}
    internal_orders = {o.id: o for o in db.query(InternalOrder).filter(InternalOrder.id.in_(io_ids)).all()} if io_ids else {}

    resp = JournalEntryResponse.model_validate(je)
    if je.created_by_id and je.created_by_id in users:
        resp.created_by_name = users[je.created_by_id].name or users[je.created_by_id].email
    if je.posted_by_id and je.posted_by_id in users:
        resp.posted_by_name = users[je.posted_by_id].name or users[je.posted_by_id].email
    for line, line_resp in zip(je.lines, resp.lines):
        gl = gl_accounts.get(line.gl_account_id)
        line_resp.gl_account_code = gl.code if gl else None
        line_resp.gl_account_name = gl.name if gl else None
        if line.cost_center_id and line.cost_center_id in cost_centers:
            line_resp.cost_center_name = cost_centers[line.cost_center_id].name
        if line.internal_order_id and line.internal_order_id in internal_orders:
            line_resp.internal_order_name = internal_orders[line.internal_order_id].name
    return resp


@router.get("", response_model=list[JournalEntryResponse])
async def list_journal_entries(
    accounting_period: str | None = Query(None),
    status: str | None = Query(None),
    gl_account_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(JournalEntry).options(selectinload(JournalEntry.lines))
    if accounting_period is not None:
        query = query.filter(JournalEntry.accounting_period == accounting_period)
    if status is not None:
        query = query.filter(JournalEntry.status == status)
    if gl_account_id is not None:
        query = query.join(JournalEntryLine).filter(JournalEntryLine.gl_account_id == gl_account_id)
    entries = query.order_by(JournalEntry.created_at.desc()).limit(500).all()
    return [_to_response(e, db) for e in entries]


@router.get("/{journal_entry_id}", response_model=JournalEntryResponse)
async def get_journal_entry(
    journal_entry_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    entry = db.query(JournalEntry).options(selectinload(JournalEntry.lines)).filter(JournalEntry.id == journal_entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return _to_response(entry, db)


@router.post("", response_model=JournalEntryResponse, status_code=201)
async def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        entry = post_journal_entry(
            db,
            posting_date=payload.posting_date,
            description=payload.description,
            lines=[line.model_dump() for line in payload.lines],
            created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, entry.id, "posted", user, summary=f"{user.name or user.email} posted journal entry {entry.entry_number}.")
    db.commit()
    entry = db.query(JournalEntry).options(selectinload(JournalEntry.lines)).filter(JournalEntry.id == entry.id).first()
    return _to_response(entry, db)


@router.post("/{journal_entry_id}/reverse", response_model=JournalEntryResponse)
async def reverse_journal_entry_route(
    journal_entry_id: int,
    payload: JournalEntryReversePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    try:
        reversal = reverse_journal_entry(db, journal_entry_id=journal_entry_id, reason=payload.reason, reversed_by_id=user.id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, journal_entry_id, "reversed", user, summary=f"{user.name or user.email} reversed journal entry — {payload.reason}")
    _write_audit(db, reversal.id, "posted", user, summary=f"Reversal entry {reversal.entry_number} posted by {user.name or user.email}.")
    db.commit()
    reversal = db.query(JournalEntry).options(selectinload(JournalEntry.lines)).filter(JournalEntry.id == reversal.id).first()
    return _to_response(reversal, db)
