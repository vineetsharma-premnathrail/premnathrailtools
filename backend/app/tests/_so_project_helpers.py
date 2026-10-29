"""Test helper: since 2026-10-28 a confirmed Sales Order no longer creates its PEW
project — the Project Manager does (projects/routes/units.py From Sales Order).
Tests that need the project confirm the order and then create it here, the way
the Project Manager's action does (ensure_project_for_order(create=True))."""
from app.modules.main.models.user import User
from app.modules.projects import so_projects as op_core
from app.modules.sales.models.order import SalesOrder


def create_project_for(db, so_id: int, actor: User | None = None, project_manager_id: int | None = None):
    order = db.get(SalesOrder, so_id)
    actor = actor or (db.get(User, order.confirmed_by_id) if order.confirmed_by_id else None)
    project = op_core.ensure_project_for_order(
        db, order, actor, create=True, project_manager_id=project_manager_id or order.sales_owner_id)
    db.commit()
    return project


def confirm_with_project(client, db, so, maker, head, director):
    """confirm() from test_sales, then the Project Manager creates the project."""
    from app.tests.test_sales import confirm
    out = confirm(client, db, so, maker, head, director)
    create_project_for(db, out["id"])
    return out
