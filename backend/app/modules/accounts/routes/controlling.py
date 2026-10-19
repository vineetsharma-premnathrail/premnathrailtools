"""Controlling reports — KSB1 cost-centre line items, cost centre x ledger
actuals, KOB1 internal-order line items with plan / actual / commitment.
Read-only; logic in services/controlling.py."""
from datetime import date
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.services import controlling
from app.modules.accounts.routes._common import service_errors, require_any_accounts_tab

router = APIRouter(prefix="/accounts/reports", tags=["Accounts"])


@router.get("/cost-center-actuals")
async def cost_center_actuals_route(
    from_date: date | None = Query(None), to_date: date | None = Query(None),
    cost_center_id: int | None = Query(None), include_children: bool = Query(True),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return controlling.cost_center_actuals(db, from_date=from_date, to_date=to_date, cost_center_id=cost_center_id,
                                               include_children=include_children)


@router.get("/cost-center-line-items")
async def cost_center_line_items_route(
    cost_center_id: int = Query(...), from_date: date | None = Query(None), to_date: date | None = Query(None),
    include_children: bool = Query(False), gl_account_id: int | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "financial_reports")),
):
    with service_errors(db):
        return controlling.cost_object_line_items(db, object_type="cost_center", object_id=cost_center_id,
                                                  include_children=include_children, from_date=from_date,
                                                  to_date=to_date, gl_account_id=gl_account_id)


@router.get("/internal-orders")
async def internal_orders_overview_route(
    to_date: date | None = Query(None), status: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_accounts_tab("financial_reports", "internal_orders")),
):
    with service_errors(db):
        return controlling.internal_orders_overview(db, to_date=to_date, status=status)


@router.get("/internal-orders/{internal_order_id}")
async def internal_order_report_route(
    internal_order_id: int, from_date: date | None = Query(None), to_date: date | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_any_accounts_tab("financial_reports", "internal_orders")),
):
    with service_errors(db):
        return controlling.internal_order_report(db, internal_order_id=internal_order_id, from_date=from_date, to_date=to_date)
