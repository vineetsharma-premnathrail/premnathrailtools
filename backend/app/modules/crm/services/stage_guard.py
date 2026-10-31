"""Pipeline stage rules for inquiries and tenders (standard CRM opportunity flow).

* Stages may move back (owner, 2026-10-31): anyone allowed to change the stage
  may do it, with a written reason (kept on the timeline).
* Sales Orders were retired on 2026-10-30, so a historic sales order no longer
  freezes the record (owner decision). It still blocks deleting the record.
"""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User


def ensure_no_live_order(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str, what: str) -> None:
    """No-op since the Sales retirement (2026-10-30): a historic sales order no
    longer locks the stage / status / customer of its inquiry or tender.
    Signature kept so existing callers need no change."""
    return None


def ensure_not_with_sales(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None, label: str) -> None:
    """No-op since the Sales retirement (2026-10-30): the record is no longer
    read-only once a historic order was raised from it. Signature kept."""
    return None


def pm_projects_from_source(db: Session, source: str, record_id: int) -> list[str]:
    """Project numbers (PEW-82) of PM projects whose optional CRM source is this
    inquiry / tender (pm_projects.source_kind / source_id). Empty until that
    column exists on the model."""
    from app.modules.projects.models.project import PmProject

    kind_col, id_col = getattr(PmProject, "source_kind", None), getattr(PmProject, "source_id", None)
    if kind_col is None or id_col is None:
        return []
    q = db.query(PmProject.project_code).filter(kind_col == source, id_col == record_id)
    if hasattr(PmProject, "is_deleted"):
        q = q.filter(PmProject.is_deleted == False)  # noqa: E712
    return sorted({code for (code,) in q.all()})


def record_links(db: Session, *, inquiry_id: int | None = None, tender_id: int | None = None) -> list[str]:
    """What still points at an inquiry / tender in a historic sales order, a PM
    project or R&D (owner, 2026-10-27: a linked record is never deleted). Plain
    words, one entry per kind."""
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
    projects_pm = pm_projects_from_source(db, source, rid)
    if projects_pm:
        out.append("project " + ", ".join(projects_pm[:3]) + (" and more" if len(projects_pm) > 3 else ""))
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
    """A record that a project, a historic sales order or R&D still refers to (a PM
    project, a sales order raised from it, an R&D offer request, requirement
    tasks or an R&D project) can't be deleted."""
    links = record_links(db, inquiry_id=inquiry_id, tender_id=tender_id)
    if links:
        raise HTTPException(status_code=409, detail=(
            f"This {label} can't be deleted: it is linked to {'; '.join(links)}. "
            f"Remove or unlink those first; only a {label} with no project, order or R&D link can be deleted."))


def check_stage_move(
    db: Session, *, stages: list[str], old: str | None, new: str, user: User, reason: str | None,
    label: str, inquiry_id: int | None = None, tender_id: int | None = None,
) -> bool:
    """Validates a stage change. Returns True when it is a (permitted) backward move."""
    if new == old:
        return False
    if old not in stages or new not in stages:
        return False  # legacy stage value — no order to compare against
    if stages.index(new) > stages.index(old):
        return False
    if not (reason or "").strip():
        raise HTTPException(status_code=422, detail=(
            f"Moving this {label} back from '{old}' to '{new}' needs a reason — enter why the stage is being reversed."))
    return True
