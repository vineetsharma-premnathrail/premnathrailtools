"""Pipeline stage rules for inquiries and tenders (standard CRM opportunity flow).

* Stages only move forward. Going back is a correction, not a normal step:
  only an admin may do it, and only with a written reason (kept on the timeline).
* Once a live sales order exists for the record, its stage and status are frozen
  for everyone — moving the record back would re-open "Create Sales Order" and
  let a second order be raised. Cancel the order in Sales first.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User


def ensure_no_live_order(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str, what: str) -> None:
    from app.modules.sales import service as sales_svc
    order = sales_svc.live_order_for_source(db, inquiry_id, tender_id)
    if order:
        raise HTTPException(status_code=409, detail=(
            f"The {what} of this {label} is locked: sales order {order.display_number} "
            f"({sales_svc.STATUS_LABEL.get(order.status, order.status)}) was raised from it. "
            f"To change it, cancel {order.display_number} in Sales first."))


def ensure_not_with_sales(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str) -> None:
    """Once a live sales order is raised from a record it has been handed to
    Sales: the order is now the reference document, so the record is read-only
    for everyone (admins too). Changing it means cancelling the order first."""
    from app.modules.sales import service as sales_svc
    order = sales_svc.live_order_for_source(db, inquiry_id, tender_id)
    if order:
        raise HTTPException(status_code=409, detail=(
            f"This {label} is locked: it was sent to Sales as sales order {order.display_number} "
            f"({sales_svc.STATUS_LABEL.get(order.status, order.status)}), so nobody can edit it any more. "
            f"If it really has to change, cancel {order.display_number} in Sales first."))


def ensure_deletable(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str) -> None:
    """A record that a live sales order was raised from is that order's reference
    document — deleting it would orphan the order's source. Cancel the order first."""
    from app.modules.sales import service as sales_svc
    order = sales_svc.live_order_for_source(db, inquiry_id, tender_id)
    if order:
        raise HTTPException(status_code=409, detail=(
            f"This {label} can't be deleted: sales order {order.display_number} "
            f"({sales_svc.STATUS_LABEL.get(order.status, order.status)}) was raised from it and refers to it. "
            f"Cancel {order.display_number} in Sales first if the {label} really has to go."))


def check_stage_move(
    db: Session, *, stages: list[str], old: str | None, new: str, user: User, reason: str | None,
    label: str, inquiry_id: int | None = None, tender_id: int | None = None,
) -> bool:
    """Validates a stage change. Returns True when it is a (permitted) backward move."""
    if new == old:
        return False
    ensure_no_live_order(db, inquiry_id=inquiry_id, tender_id=tender_id, label=label, what="stage")
    if old not in stages or new not in stages:
        return False  # legacy stage value — no order to compare against
    if stages.index(new) > stages.index(old):
        return False
    if user.role != "admin":
        raise HTTPException(status_code=403, detail=(
            f"Stages only move forward — this {label} is already at '{old}', so it cannot go back to '{new}'. "
            f"If the stage was set by mistake, ask an admin to move it back (they must give a reason)."))
    if not (reason or "").strip():
        raise HTTPException(status_code=422, detail=(
            f"Moving this {label} back from '{old}' to '{new}' needs a reason — enter why the stage is being reversed."))
    return True
