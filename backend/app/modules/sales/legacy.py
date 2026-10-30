"""Read-only access to HISTORIC sales orders (Sales module retired 2026-10-30).

The Sales screens, routes, approvals, scheduler and settings are gone. The
sales_* tables and models stay because other modules still point at them:
Finance bills historic orders (accounts/services/billing.py,
accounts/routes/sales_billing.py), reverses their invoices, and the CRM, PM,
Production, Store and Quality code reads an order that already exists.

Nothing here creates, edits or approves an order, and there are no routes.
Creating a new order is not possible any more; projects are created in
Project Management › All Projects › + Create Project.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_view_tab, is_admin_user
from app.core.reporting.dates import today_ist  # noqa: F401  (re-exported for callers that used sales.service.today_ist)
from app.modules.main.models.user import User
from app.modules.sales.models.order import (
    SALES_ORDER_LIVE_STATUSES,
    SalesOrder,
    SalesOrderSchedule,
)

STATUS_LABEL = {
    "draft": "Draft", "pending_approval": "Pending approval", "confirmed": "Confirmed", "in_execution": "In execution",
    "partially_delivered": "Partially delivered", "delivered": "Delivered", "closed": "Closed", "on_hold": "On hold",
    "cancelled": "Cancelled", "short_closed": "Short-closed",
}


def get_order(db: Session, so_id: int) -> SalesOrder:
    """One historic order with its lines, delivery rows and billing plan loaded.
    404 when it is missing or soft-deleted."""
    so = (
        db.query(SalesOrder)
        .options(selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules), selectinload(SalesOrder.billing_lines))
        .filter(SalesOrder.id == so_id, SalesOrder.is_deleted == False)  # noqa: E712
        .first()
    )
    if not so:
        raise HTTPException(
            status_code=404,
            detail=f"Sales order #{so_id} no longer exists — refresh the page. Sales Orders were retired; "
                   f"only historic orders remain, and this one was deleted.",
        )
    return so


def rows_for_machine(db: Session, erp_project_id: int) -> list[SalesOrderSchedule]:
    """Open delivery rows of a historic order that sit on this machine (directly or through its RRV build)."""
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    build_ids = [b for (b,) in db.query(ProductionRrvBuild.id).filter(ProductionRrvBuild.erp_project_id == erp_project_id).all()]
    q = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.status != "cancelled")
    rows = q.filter(SalesOrderSchedule.erp_project_id == erp_project_id).all()
    if build_ids:
        rows += [r for r in q.filter(SalesOrderSchedule.rrv_build_id.in_(build_ids)).all() if r not in rows]
    return rows


def live_order_for_source(db: Session, inquiry_id: int | None, tender_id: int | None,
                          exclude_id: int | None = None) -> SalesOrder | None:
    """The live historic order raised from this CRM inquiry / tender, if any (information only)."""
    if not inquiry_id and not tender_id:
        return None
    q = db.query(SalesOrder).filter(SalesOrder.is_deleted == False, SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES))  # noqa: E712
    q = q.filter(SalesOrder.source_inquiry_id == inquiry_id) if inquiry_id else q.filter(SalesOrder.source_tender_id == tender_id)
    if exclude_id:
        q = q.filter(SalesOrder.id != exclude_id)
    return q.first()


def prices_hidden(user: User) -> bool:
    """True when order money must be blanked for `user`. The old Sales ›
    Prices & margins permission is gone; historic order values are shown only
    to people who may see Finance › Sales Invoices (and admins)."""
    return not (is_admin_user(user) or can_view_tab(user, "accounts", "sales_invoices"))
