from datetime import date, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.accounts.models.period_close import PeriodClose
from app.modules.accounts.schemas.period_close import ClosePeriodPayload, ReopenPeriodPayload, PeriodCloseResponse
from app.modules.accounts.service import reopen_period
from app.modules.accounts.routes._common import service_errors
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/period-close", tags=["Accounts"])


def _write_audit(db: Session, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="period_close", entity_id=None, action=action, performed_by_id=user.id, summary=summary))


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reopen a closed accounting period.")


def _to_response(pc: PeriodClose, db: Session, approval: dict | None = None) -> PeriodCloseResponse:
    user_ids = {pc.closed_by_id, pc.reopened_by_id} - {None}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    resp = PeriodCloseResponse.model_validate(pc)
    if pc.closed_by_id and pc.closed_by_id in users:
        resp.closed_by_name = users[pc.closed_by_id].name or users[pc.closed_by_id].email
    if pc.reopened_by_id and pc.reopened_by_id in users:
        resp.reopened_by_name = users[pc.reopened_by_id].name or users[pc.reopened_by_id].email
    for k, v in (approval or {}).items():
        setattr(resp, k, v)
    return resp


@router.get("", response_model=list[PeriodCloseResponse])
async def list_period_closes(
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("accounts", "period_close")),
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
    ids = {access.period_entity_id(r.accounting_period): r.accounting_period for r in ordered}
    states = {ids[k]: v for k, v in access.approval_states(db, access.ET_PERIOD_CLOSE, list(ids)).items()}
    return [_to_response(r, db, states.get(r.accounting_period)) for r in ordered]


@router.post("/{period}/close", response_model=PeriodCloseResponse)
async def close_period_route(
    period: str,
    payload: ClosePeriodPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "period_close", "approve")),
):
    """Closing a month goes through the approval engine ('Accounting period
    close', default: a Finance Manager). A Finance Manager's click approves it
    at once, as before; anyone else's click waits for one (202)."""
    with service_errors(db):
        req = access.submit_process(
            db, access.KEY_PERIOD_CLOSE, entity_id=access.period_entity_id(period), actor=user,
            title=f"Close accounting period {period}", reference=period, context={"period": period, "notes": payload.notes},
        )
    if req.status == "pending":
        access.role_event(db, "period_close_requested", title=f"Closing period {period} waits for a Finance Manager",
                          message=f"{user.name or user.email} asked to close accounting period {period}. A Finance Manager must "
                                  f"approve it (Approvals inbox or Finance › Journals › Period Close).",
                          entity_type=access.ET_PERIOD_CLOSE, entity_id=req.entity_id, actor=user,
                          skip={s.approver_id for s in req.steps if s.approver_id}, background_tasks=background_tasks)
    db.commit()
    if req.status != "approved":
        return JSONResponse(status_code=202, content=access.pending_response(req, f"Closing {period}"))
    pc = db.query(PeriodClose).filter(PeriodClose.accounting_period == period).first()
    return _to_response(pc, db, access.approval_state(db, access.ET_PERIOD_CLOSE, access.period_entity_id(period)))


@router.post("/{period}/reopen", response_model=PeriodCloseResponse)
async def reopen_period_route(
    period: str,
    payload: ReopenPeriodPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "period_close", "approve")),
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
