"""Soft-delete cascade rules for CRM records.

Activities (follow-ups) and documents point at their parent through a bare
(related_module, related_id) pair with no foreign key, so setting is_deleted on
the parent cascades nothing — a left-behind row keeps showing up in the
follow-up list and dashboard counters, and can even resurface under whatever
inquiry/tender later lands on the same id. Every delete handler routes through
here so the rules live in one place.
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.crm.models.activity import Activity
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender


def _mark(rows, now: datetime) -> None:
    for row in rows:
        row.is_deleted = True
        row.deleted_at = now


def cascade_delete_children(db: Session, related_module: str, related_id: int, now: datetime | None = None) -> None:
    """Soft delete the follow-ups and documents logged under one inquiry/tender.

    Deleting an inquiry or tender takes its own follow-ups with it, but leaves
    the organization and its other records untouched.
    """
    now = now or datetime.now(timezone.utc)
    _mark(db.query(Activity).filter(
        Activity.related_module == related_module, Activity.related_id == related_id,
        Activity.is_deleted == False,  # noqa: E712
    ).all(), now)
    _mark(db.query(CrmDocument).filter(
        CrmDocument.related_module == related_module, CrmDocument.related_id == related_id,
        CrmDocument.is_deleted == False,  # noqa: E712
    ).all(), now)


def cascade_delete_organization(db: Session, org_id: int, now: datetime | None = None) -> None:
    """Soft delete everything hanging off an organization: its inquiries and
    tenders, the follow-ups/documents logged under each of them, and the ones
    attached straight to the organization with no inquiry/tender of their own.

    The caller still flags the organization row itself.
    """
    now = now or datetime.now(timezone.utc)

    inquiries = db.query(Inquiry).filter(Inquiry.org_id == org_id, Inquiry.is_deleted == False).all()  # noqa: E712
    tenders = db.query(Tender).filter(Tender.org_id == org_id, Tender.is_deleted == False).all()  # noqa: E712
    _mark(inquiries, now)
    _mark(tenders, now)
    for inq in inquiries:
        cascade_delete_children(db, "inquiry", inq.id, now)
    for tnd in tenders:
        cascade_delete_children(db, "tender", tnd.id, now)

    # Rows stamped with this org_id that the loops above didn't reach — either
    # they hang directly off the organization, or their parent is long gone.
    # An Activity's own org_id can be a stale snapshot if the parent
    # inquiry/tender was later moved to another org, so anything still owned by
    # a live record elsewhere is left alone.
    live_inquiry_ids = {i for (i,) in db.query(Inquiry.id).filter(Inquiry.is_deleted == False).all()}  # noqa: E712
    live_tender_ids = {t for (t,) in db.query(Tender.id).filter(Tender.is_deleted == False).all()}  # noqa: E712

    def _owned_elsewhere(row) -> bool:
        if row.related_module == "inquiry":
            return row.related_id in live_inquiry_ids
        if row.related_module == "tender":
            return row.related_id in live_tender_ids
        return False

    leftovers = db.query(Activity).filter(Activity.org_id == org_id, Activity.is_deleted == False).all()  # noqa: E712
    _mark([a for a in leftovers if not _owned_elsewhere(a)], now)
    leftover_docs = db.query(CrmDocument).filter(CrmDocument.org_id == org_id, CrmDocument.is_deleted == False).all()  # noqa: E712
    _mark([d for d in leftover_docs if not _owned_elsewhere(d)], now)
