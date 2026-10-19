"""Profitability (CO-PA KE30 / KE24) — contribution margin per sales order,
machine, product or customer, with quoted vs actual margin. Read-only;
logic in services/profitability.py. Gated by Finance & Accounting ›
Controlling › Profitability (view)."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_feature_action
from app.db.session import get_db
from app.modules.accounts.routes._common import service_errors
from app.modules.accounts.services import profitability
from app.modules.main.models.user import User

router = APIRouter(prefix="/accounts/reports/profitability", tags=["Accounts"])


@router.get("")
async def profitability_report(
    group_by: str = Query("sales_order"), from_date: date | None = Query(None), to_date: date | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "profitability")),
):
    with service_errors(db):
        return profitability.order_profitability(db, group_by=group_by, from_date=from_date, to_date=to_date)


@router.get("/line-items")
async def profitability_line_items(
    group_by: str = Query(...), key: str | None = Query(None), from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "profitability", "line_items", "view")),
):
    with service_errors(db):
        return profitability.profitability_line_items(db, group_by=group_by, key=key, from_date=from_date, to_date=to_date)
