"""Electronic bank statement import & matching (FF67 / FEBAN) — rides on the
Reconciliation (BRS) tab's permissions: view to see lines, create to import,
edit to match / book, delete to remove an unused statement."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts import access  # noqa: F401 — registers BankReconciliation's data scope
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.models.bank_statement import BankStatement, BankStatementLine
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor import Vendor
from app.modules.accounts.routes._common import service_errors, user_names, who, write_audit
from app.modules.accounts.schemas.bank_statement import (
    BankStatementImportResponse, BankStatementLineBookPayload, BankStatementLineMatchPayload, BankStatementLineResponse,
    BankStatementResponse, StatementCandidateResponse,
)
from app.modules.accounts.services import bank_statements as svc
from app.modules.accounts.services.bank_statement_formats import format_options

router = APIRouter(prefix="/accounts/bank-statements", tags=["Accounts"])
MAX_BYTES = 5 * 1024 * 1024


def _recon(db: Session, user: User, recon_id: int) -> BankReconciliation:
    recon = db.query(BankReconciliation).filter(BankReconciliation.id == recon_id).first()
    if not recon:
        raise HTTPException(status_code=404, detail=f"Bank reconciliation #{recon_id} doesn't exist — refresh the Reconciliation list.")
    ensure_in_scope(db, user, recon)
    return recon


def _line(db: Session, user: User, line_id: int) -> BankStatementLine:
    line = db.query(BankStatementLine).filter(BankStatementLine.id == line_id).first()
    if not line:
        raise HTTPException(status_code=404, detail=f"Statement line #{line_id} doesn't exist — reload the reconciliation.")
    _recon(db, user, line.bank_reconciliation_id)
    return line


def _lines_out(db: Session, lines: list[BankStatementLine]) -> list[BankStatementLineResponse]:
    pids = {m.get("payment_id") for l in lines for m in (l.matched_payments or [])}
    numbers = {p.id: p.payment_number for p in db.query(PaymentTransaction).filter(PaymentTransaction.id.in_(pids)).all()} if pids else {}
    names = user_names(db, {l.matched_by_id for l in lines})
    return [BankStatementLineResponse.model_validate(l).model_copy(update={
        "direction": l.direction, "amount": l.amount,
        "matched_numbers": [numbers.get(m.get("payment_id"), f"#{m.get('payment_id')}") for m in (l.matched_payments or [])],
        "matched_by_name": names.get(l.matched_by_id)}) for l in lines]


def _stmt_out(db: Session, s: BankStatement) -> BankStatementResponse:
    return BankStatementResponse.model_validate(s).model_copy(update={"uploaded_by_name": user_names(db, {s.uploaded_by_id}).get(s.uploaded_by_id)})


@router.get("/formats")
async def list_formats(_user: User = Depends(require_tab_access("accounts", "reconciliation"))):
    return {"formats": format_options(), "book_kinds": [{"value": k, "label": v[0]} for k, v in svc.BOOK_KINDS.items()]}


@router.get("/reconciliation/{recon_id}")
async def statement_lines(recon_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("accounts", "reconciliation", "bank_statements", "view"))):
    recon = _recon(db, user, recon_id)
    stmts = db.query(BankStatement).filter(BankStatement.bank_reconciliation_id == recon.id).order_by(BankStatement.id).all()
    lines = (db.query(BankStatementLine).filter(BankStatementLine.bank_reconciliation_id == recon.id)
             .order_by(BankStatementLine.value_date, BankStatementLine.statement_id, BankStatementLine.line_number).all())
    counts = {s: sum(1 for l in lines if l.match_status == s) for s in ("unmatched", "matched", "booked")}
    return {
        "statements": [_stmt_out(db, s) for s in stmts], "lines": _lines_out(db, lines), "counts": counts,
        "last_format": svc.last_format_for(db, recon.bank_account_id),
    }


@router.post("", response_model=BankStatementImportResponse, status_code=201)
async def import_statement(
    bank_reconciliation_id: int = Form(...),
    statement_format: str = Form(...),
    auto_match: bool = Form(True),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("accounts", "reconciliation", "bank_statements", "create")),
):
    _recon(db, user, bank_reconciliation_id)
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"'{file.filename}' is {len(content) / 1048576:.1f} MB — a statement file can be at most 5 MB. "
                                                    f"Download a shorter period (one month) and upload that.")
    with service_errors(db):
        stmt, warnings = svc.import_statement(db, bank_reconciliation_id=bank_reconciliation_id, content=content,
                                              file_name=file.filename or "statement", format_key=statement_format,
                                              uploaded_by_id=user.id)
        stats = svc.auto_match(db, bank_reconciliation_id=bank_reconciliation_id, user_id=user.id) if auto_match else None
    write_audit(db, "bank_reconciliation", bank_reconciliation_id, "statement_imported", user,
                f"{who(user)} imported bank statement '{stmt.file_name}' ({stmt.line_count} lines)"
                + (f"; auto-matched {stats['utr'] + stats['cheque'] + stats['amount_date']}." if stats else "."))
    db.commit()
    db.refresh(stmt)
    return BankStatementImportResponse(statement=_stmt_out(db, stmt), warnings=warnings, auto_match=stats)


@router.post("/reconciliation/{recon_id}/auto-match")
async def run_auto_match(recon_id: int, db: Session = Depends(get_db),
                         user: User = Depends(require_tab_action("accounts", "reconciliation", "edit"))):
    _recon(db, user, recon_id)
    with service_errors(db):
        stats = svc.auto_match(db, bank_reconciliation_id=recon_id, user_id=user.id)
    matched = stats["utr"] + stats["cheque"] + stats["amount_date"]
    write_audit(db, "bank_reconciliation", recon_id, "auto_matched", user, f"{who(user)} ran auto-match: {matched} line(s) matched.")
    db.commit()
    return stats


@router.get("/lines/{line_id}/candidates", response_model=list[StatementCandidateResponse])
async def line_candidates(line_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_access("accounts", "reconciliation"))):
    line = _line(db, user, line_id)
    with service_errors(db):
        sides = svc.candidates(db, line_id=line_id)
    from app.modules.crm.models.organization import Organization
    pays = [s["payment"] for s in sides]
    vendors = {v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_({p.vendor_id for p in pays} - {None})).all()}
    custs = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_({p.customer_id for p in pays} - {None})).all()}
    return [StatementCandidateResponse(
        payment_transaction_id=p.id, payment_number=p.payment_number, payment_date=p.payment_date, payment_type=p.payment_type,
        payment_mode=p.payment_mode, amount=p.amount, direction=s["direction"], reference_no=p.reference_no,
        cheque_number=p.cheque_number, party_name=vendors.get(p.vendor_id) or custs.get(p.customer_id) or p.narration,
        exact_amount=abs(float(p.amount) - line.amount) < 0.005) for s, p in zip(sides, pays)]


@router.post("/lines/{line_id}/match", response_model=BankStatementLineResponse)
async def match_line(line_id: int, payload: BankStatementLineMatchPayload, db: Session = Depends(get_db),
                     user: User = Depends(require_tab_action("accounts", "reconciliation", "edit"))):
    line = _line(db, user, line_id)
    with service_errors(db):
        svc.match_line(db, line_id=line_id, payment_ids=payload.payment_transaction_ids, user_id=user.id)
    write_audit(db, "bank_reconciliation", line.bank_reconciliation_id, "statement_line_matched", user,
                f"{who(user)} matched statement line {line.line_number} ({line.amount:,.2f}) to {len(payload.payment_transaction_ids)} voucher(s).")
    db.commit()
    db.refresh(line)
    return _lines_out(db, [line])[0]


@router.post("/lines/{line_id}/unmatch", response_model=BankStatementLineResponse)
async def unmatch_line(line_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", "reconciliation", "edit"))):
    line = _line(db, user, line_id)
    with service_errors(db):
        svc.unmatch_line(db, line_id=line_id)
    write_audit(db, "bank_reconciliation", line.bank_reconciliation_id, "statement_line_unmatched", user,
                f"{who(user)} unmatched statement line {line.line_number} ({line.amount:,.2f}).")
    db.commit()
    db.refresh(line)
    return _lines_out(db, [line])[0]


@router.post("/lines/{line_id}/book", response_model=BankStatementLineResponse)
async def book_line(line_id: int, payload: BankStatementLineBookPayload, db: Session = Depends(get_db),
                    user: User = Depends(require_feature_action("accounts", "reconciliation", "book_statement_lines", "create"))):
    line = _line(db, user, line_id)
    with service_errors(db):
        v = svc.book_line(db, line_id=line_id, kind=payload.kind, gl_account_id=payload.gl_account_id,
                          cost_center_id=payload.cost_center_id, narration=payload.narration, user_id=user.id)
    write_audit(db, "payment_transaction", v.id, "created", user,
                f"{who(user)} booked {v.payment_number} ({v.amount:,.2f}) from bank statement line {line.line_number}.")
    db.commit()
    db.refresh(line)
    return _lines_out(db, [line])[0]


@router.delete("/{statement_id}", status_code=204)
async def delete_statement(statement_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_feature_action("accounts", "reconciliation", "bank_statements", "delete"))):
    stmt = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not stmt:
        raise HTTPException(status_code=404, detail=f"Statement #{statement_id} doesn't exist — reload the reconciliation.")
    _recon(db, user, stmt.bank_reconciliation_id)
    recon_id, name = stmt.bank_reconciliation_id, stmt.file_name
    with service_errors(db):
        svc.delete_statement(db, statement_id=statement_id)
    write_audit(db, "bank_reconciliation", recon_id, "statement_removed", user, f"{who(user)} removed bank statement '{name}'.")
    db.commit()
