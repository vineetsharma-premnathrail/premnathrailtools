from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts import reports as reports_service
from app.modules.accounts.services import closing
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_any_accounts_tab
from app.modules.accounts import access

router = APIRouter(prefix="/accounts/reports", tags=["Accounts"])


@router.get("/trial-balance")
async def trial_balance_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None), period: str | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return reports_service.get_trial_balance(db, from_date=from_date, to_date=to_date, period=period)


@router.get("/gl-ledger")
async def gl_ledger_route(
    gl_account_id: int = Query(...), from_date: date | None = Query(None), to_date: date | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_any_accounts_tab("ledger_statement", "bank_book", "financial_reports")),
):
    try:
        return reports_service.get_gl_ledger(db, gl_account_id=gl_account_id, from_date=from_date, to_date=to_date)
    except ValueError as e:
        raise HTTPException(status_code=404 if "not found" in str(e) else 400, detail=str(e))


@router.get("/day-book")
async def day_book_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None), voucher_type: str | None = Query(None),
    db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", "day_book")),
):
    to_date = to_date or date.today()
    return reports_service.get_day_book(db, from_date=from_date or to_date, to_date=to_date, voucher_type=voucher_type, user=user)


@router.get("/profit-and-loss")
async def profit_and_loss_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None), period: str | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return reports_service.get_profit_and_loss(db, from_date=from_date, to_date=to_date, period=period)


@router.get("/balance-sheet")
async def balance_sheet_route(
    as_of: date | None = Query(None), period: str | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return reports_service.get_balance_sheet(db, as_of=as_of, period=period)


@router.get("/cash-flow")
async def cash_flow_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return reports_service.get_cash_flow(db, from_date=from_date, to_date=to_date)


@router.get("/ap-aging")
async def ap_aging_route(as_of: date | None = Query(None), db: Session = Depends(get_db),
                         _user: User = Depends(require_tab_access("accounts", "financial_reports"))):
    """as_of = key date: bills open on that date, at the amount due then."""
    return reports_service.get_ap_aging(db, as_of=as_of)


@router.get("/ar-aging")
async def ar_aging_route(as_of: date | None = Query(None), db: Session = Depends(get_db),
                         _user: User = Depends(require_tab_access("accounts", "financial_reports"))):
    """as_of = key date: bills open on that date, at the amount due then."""
    return reports_service.get_ar_aging(db, as_of=as_of)


@router.get("/variance-analysis")
async def variance_analysis_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return reports_service.get_variance_analysis(db, from_date=from_date, to_date=to_date)


@router.get("/monthly-pack")
async def monthly_report_pack_route(period: str | None = Query(None), db: Session = Depends(get_db),
                                    _user: User = Depends(require_tab_access("accounts", "financial_reports"))):
    with service_errors(db):
        return reports_service.get_monthly_report_pack(db, period=period or date.today().strftime("%Y-%m"))


# ── Year-end close ──────────────────────────────────────────────────────

@router.get("/year-end")
async def year_end_preview_route(fy_code: str = Query(...), db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "year_end_close"))):
    with service_errors(db):
        out = closing.year_end_preview(db, fy_code=fy_code)
    # The approval of this FY's close (if one was submitted) — for the Approval panel.
    out["approval_entity_id"] = access.fy_entity_id(fy_code)
    out.update(access.approval_state(db, access.ET_YEAR_END, out["approval_entity_id"]))
    return out


@router.post("/year-end/close")
async def year_end_close_route(background_tasks: BackgroundTasks, fy_code: str = Query(...), db: Session = Depends(get_db), user: User = Depends(require_tab_action("accounts", "year_end_close", "approve"))):
    """Closing a financial year goes through the approval engine ('Financial
    year close', default: a Finance Manager). A Finance Manager's click closes
    it at once, as before; anyone else's click waits for one (202)."""
    with service_errors(db):
        req = access.submit_process(db, access.KEY_YEAR_END, entity_id=access.fy_entity_id(fy_code), actor=user,
                                    title=f"Close financial year {fy_code}", reference=fy_code, context={"fy_code": fy_code})
    if req.status == "pending":
        access.role_event(db, "year_close_requested", title=f"Closing financial year {fy_code} waits for a Finance Manager",
                          message=f"{who(user)} asked to close financial year {fy_code}. A Finance Manager must approve it "
                                  f"(Approvals inbox or Finance › Reports › Year-end Close).",
                          entity_type=access.ET_YEAR_END, entity_id=req.entity_id, actor=user,
                          skip={s.approver_id for s in req.steps if s.approver_id}, background_tasks=background_tasks)
    db.commit()
    if req.status != "approved":
        return JSONResponse(status_code=202, content=access.pending_response(req, f"Closing {fy_code}"))
    entry = closing._existing_close(db, fy_code)
    return {"journal_entry_id": entry.id, "entry_number": entry.entry_number}


@router.post("/year-end/reopen")
async def year_end_reopen_route(fy_code: str = Query(...), reason: str = Query(...), db: Session = Depends(get_db),
                                user: User = Depends(require_tab_action("accounts", "year_end_close", "approve"))):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reopen a closed financial year.")
    with service_errors(db):
        entry = closing.reopen_financial_year(db, fy_code=fy_code, reason=reason, user_id=user.id)
    write_audit(db, "financial_year", None, "reopened", user, f"{who(user)} reopened financial year {fy_code}: {reason}")
    db.commit()
    return {"journal_entry_id": entry.id, "entry_number": entry.entry_number}
