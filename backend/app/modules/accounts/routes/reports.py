from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.schemas.reports import (
    TrialBalanceResponse, GLLedgerResponse, AgingResponse, ProfitAndLossResponse,
    BalanceSheetResponse, VarianceAnalysisResponse, MonthlyReportPackResponse,
)
from app.modules.accounts import reports as reports_service

router = APIRouter(prefix="/accounts/reports", tags=["Accounts"])


def _current_period() -> str:
    return date.today().strftime("%Y-%m")


@router.get("/trial-balance", response_model=TrialBalanceResponse)
async def trial_balance_route(
    period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_trial_balance(db, period=period or _current_period())


@router.get("/gl-ledger", response_model=GLLedgerResponse)
async def gl_ledger_route(
    gl_account_id: int = Query(...),
    from_period: str = Query(None),
    to_period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    period = _current_period()
    try:
        return reports_service.get_gl_ledger(db, gl_account_id=gl_account_id, from_period=from_period or period, to_period=to_period or period)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/ap-aging", response_model=AgingResponse)
async def ap_aging_route(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_ap_aging(db)


@router.get("/ar-aging", response_model=AgingResponse)
async def ar_aging_route(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_ar_aging(db)


@router.get("/profit-and-loss", response_model=ProfitAndLossResponse)
async def profit_and_loss_route(
    period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_profit_and_loss(db, period=period or _current_period())


@router.get("/balance-sheet", response_model=BalanceSheetResponse)
async def balance_sheet_route(
    period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_balance_sheet(db, period=period or _current_period())


@router.get("/variance-analysis", response_model=VarianceAnalysisResponse)
async def variance_analysis_route(
    from_period: str = Query(None),
    to_period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    period = _current_period()
    return reports_service.get_variance_analysis(db, from_period=from_period or period, to_period=to_period or period)


@router.get("/monthly-pack", response_model=MonthlyReportPackResponse)
async def monthly_report_pack_route(
    period: str = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return reports_service.get_monthly_report_pack(db, period=period or _current_period())
