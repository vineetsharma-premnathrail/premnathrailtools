"""MSME supplier dues: 45-day payment-limit alerts on open bills and the
sec. 43B(h) year-end statement (accounts/services/msme.py)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.services import msme

router = APIRouter(prefix="/accounts/msme", tags=["Accounts"])


@router.get("/alerts")
async def msme_alerts(as_of: date | None = Query(None), warn_days: int = Query(7, ge=0, le=45), db: Session = Depends(get_db),
                      _user: User = Depends(require_feature_action("accounts", "outstanding", "msme_dues", "view"))):
    return msme.open_bill_alerts(db, as_of=as_of, warn_days=warn_days)


@router.get("/43bh")
async def msme_43bh(fy_start_year: int | None = Query(None, description="e.g. 2025 for FY 2025-26"), db: Session = Depends(get_db),
                    _user: User = Depends(require_feature_action("accounts", "outstanding", "msme_dues", "view"))):
    today = date.today()
    fy = fy_start_year if fy_start_year is not None else (today.year if today.month >= 4 else today.year - 1) - 1
    if fy < 2023:
        raise HTTPException(status_code=422, detail="Sec. 43B(h) applies from FY 2023-24 (AY 2024-25) — pick 2023 or later.")
    if msme.fy_end_for(fy) > today and fy != (today.year if today.month >= 4 else today.year - 1):
        raise HTTPException(status_code=422, detail=f"FY {fy}-{(fy + 1) % 100:02d} hasn't started yet — pick the current or a past year.")
    return msme.report_43bh(db, fy_start_year=fy)
