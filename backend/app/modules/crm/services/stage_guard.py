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


def record_links(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None) -> list[str]:
    """What still points at an inquiry / tender in Sales or R&D (owner, 2026-10-27:
    a linked record is never deleted). Plain words, one entry per kind."""
    from app.modules.crm.models.rnd_request import CrmRndRequest
    from app.modules.rnd.models.project import RndProject
    from app.modules.rnd.models.requirement_work import RndRequirementProjectLink, RndRequirementTask
    from app.modules.sales.models.order import SalesOrder

    source, rid = ("inquiry", inquiry_id) if inquiry_id else ("tender", tender_id)
    out: list[str] = []
    so_col = SalesOrder.source_inquiry_id if inquiry_id else SalesOrder.source_tender_id
    orders = db.query(SalesOrder).filter(so_col == rid, SalesOrder.is_deleted == False).order_by(SalesOrder.id).limit(4).all()  # noqa: E712
    if orders:
        out.append("sales order " + ", ".join(o.display_number for o in orders[:3]) + (" and more" if len(orders) > 3 else ""))
    if db.query(CrmRndRequest.id).filter(CrmRndRequest.source == source, CrmRndRequest.record_id == rid).first():
        out.append("an R&D technical offer request")
    if db.query(RndRequirementTask.id).filter(RndRequirementTask.source == source, RndRequirementTask.record_id == rid).first():
        out.append("R&D requirement tasks")
    links = (db.query(RndProject.project_number)
             .join(RndRequirementProjectLink, RndRequirementProjectLink.project_id == RndProject.id)
             .filter(RndRequirementProjectLink.source == source, RndRequirementProjectLink.record_id == rid,
                     RndProject.is_deleted == False).all())  # noqa: E712
    origin = (db.query(RndProject.project_number)
              .filter(RndProject.source_kind == source, RndProject.source_id == rid, RndProject.is_deleted == False).all())  # noqa: E712
    projects = sorted({n for (n,) in [*links, *origin]})
    if projects:
        out.append("R&D project " + ", ".join(projects[:3]) + (" and more" if len(projects) > 3 else ""))
    return out


def ensure_deletable(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str) -> None:
    """A record that Sales or R&D still refers to (a sales order raised from it, an
    R&D offer request, requirement tasks or an R&D project) can't be deleted."""
    links = record_links(db, inquiry_id=inquiry_id, tender_id=tender_id)
    if links:
        raise HTTPException(status_code=409, detail=(
            f"This {label} can't be deleted: it is linked to {'; '.join(links)}. "
            f"Only a {label} with no Sales or R&D link can be deleted."))


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
