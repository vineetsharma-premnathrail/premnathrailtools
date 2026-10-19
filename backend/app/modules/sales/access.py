"""Sales data scope (core/data_scope.py) — which sales orders a user sees.

    own       orders they own (sales owner) or created
    assigned  + orders they submitted
    department / plant / multi-plant / organization  — per the role's Data access

Plus, at any scope, whatever they are (or were) an approver of — the engine
adds that through `entity_type`. An amendment approver may open the order the
amendment belongs to (they can't judge the change without it).

Child records (lines, delivery rows, billing plan, DP extensions, attachments)
are checked through their order. Pickers (lookups) and the read-only chips other
modules use (/orders/by-source for CRM, /schedule/by-build for Production) are
not scoped — they only say *that* an order exists, which those screens need."""
from __future__ import annotations

from sqlalchemy.orm import Query, Session

from app.core.data_scope import apply_scope, ensure_in_scope, in_scope, register_scoped
from app.modules.main.models.user import User
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.order import SalesOrder

register_scoped(
    SalesOrder, "sales", entity_type="sales_order",
    owner=("sales_owner_id", "created_by_id"), assigned=("submitted_by_id",), branch="branch_id",
    label="sales order",
)
register_scoped(
    SalesOrderAmendment, "sales", entity_type="sales_amendment",
    owner=("created_by_id",), assigned=("submitted_by_id",),
    label="sales order amendment",
)


def scoped_orders(query: Query, user: User | None) -> Query:
    """Every list / board / dashboard count of sales orders. `user=None` is a
    system caller (scheduler) — unrestricted."""
    return query if user is None else apply_scope(query, user, SalesOrder)


def ensure_order(db: Session, user: User, so: SalesOrder) -> None:
    """403 (with the user's scope in the message) unless the order is in the
    user's data scope, or they own / approve one of its amendments."""
    if in_scope(db, user, so):
        return
    for a in db.query(SalesOrderAmendment).filter(SalesOrderAmendment.so_id == so.id).all():
        if in_scope(db, user, a):
            return
    ensure_in_scope(db, user, so)


def ensure_amendment(db: Session, user: User, a: SalesOrderAmendment, so: SalesOrder | None = None) -> None:
    if in_scope(db, user, a):
        return
    so = so or db.get(SalesOrder, a.so_id)
    if so is not None and in_scope(db, user, so):
        return
    ensure_in_scope(db, user, a)
