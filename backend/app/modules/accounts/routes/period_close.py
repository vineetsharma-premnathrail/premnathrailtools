from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.schemas.period_close import ClosePeriodPayload, ReopenPeriodPayload, PeriodCloseResponse
from app.modules.accounts.service import close_period, reopen_period

router = APIRouter(prefix="/accounts/period-close", tags=["Accounts"])


def _write_audit(db: Session, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="period_close", entity_id=None, action=action, performed_by_id=user.id, summary=summary))


def _require_finance_manager(user: User) -> None:
    if not (user.is_finance_manager or user.role == "admin"):
        raise HTTPException(status_code=403, detail="Only a Finance Manager (or admin) can close an accounting period.")


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reopen a closed accounting period.")


def _to_response(pc: PeriodClose, db: Session) -> PeriodCloseResponse:
    user_ids = {pc.closed_by_id, pc.reopened_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    resp = PeriodCloseResponse.model_validate(pc)
    if pc.closed_by_id and pc.closed_by_id in users:
        resp.closed_by_name = users[pc.closed_by_id].name or users[pc.closed_by_id].email
    if pc.reopened_by_id and pc.reopened_by_id in users:
        resp.reopened_by_name = users[pc.reopened_by_id].name or users[pc.reopened_by_id].email
    return resp


@router.get("", response_model=list[PeriodCloseResponse])
async def list_period_closes(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    rows = db.query(PeriodClose).order_by(PeriodClose.accounting_period.desc()).all()
    by_period = {r.accounting_period: r for r in rows}

    # Synthesize an implicit "open" entry for the current and previous
    # calendar month if nothing has ever touched them, so the frontend
    # always has something to show for recent periods.
    today = date.today()
    last_month = (today.replace(day=1) - timedelta(days=1))
    for period in (today.strftime("%Y-%m"), last_month.strftime("%Y-%m")):
        if period not in by_period:
            by_period[period] = PeriodClose(accounting_period=period, status="open")

    ordered = sorted(by_period.values(), key=lambda r: r.accounting_period, reverse=True)
    return [_to_response(r, db) for r in ordered]


@router.post("/{period}/close", response_model=PeriodCloseResponse)
async def close_period_route(
    period: str,
    payload: ClosePeriodPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    _require_finance_manager(user)
    try:
        pc = close_period(db, accounting_period=period, closed_by_id=user.id, notes=payload.notes)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, "closed", user, summary=f"{user.name or user.email} closed accounting period {period}." + (f" Notes: {payload.notes}" if payload.notes else ""))
    db.commit()
    return _to_response(pc, db)


@router.post("/{period}/reopen", response_model=PeriodCloseResponse)
async def reopen_period_route(
    period: str,
    payload: ReopenPeriodPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("accounts")),
):
    _require_admin(user)
    try:
        pc = reopen_period(db, accounting_period=period, reopened_by_id=user.id, reason=payload.reason)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    _write_audit(db, "reopened", user, summary=f"{user.name or user.email} reopened accounting period {period}. Reason: {payload.reason}")
    db.commit()
    return _to_response(pc, db)
