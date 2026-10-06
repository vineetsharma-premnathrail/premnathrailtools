"""First Article Inspection (FAI) — rule 9: new items, new drawing
revisions and new vendors need an approved first article before regular
lots of that item / revision / source are accepted.

Scope (decided): FAI applies to *inspection-controlled* items only —
incoming / job-work items flagged inspection_on_receipt (per vendor) and
products that get a final inspection (in-house, vendor NULL). Uncontrolled
items (consumables etc.) never need one.

"Released" for an item + source (vendor or in-house) means one of:
  * an approved FAI for that source against the current released drawing
    revision(s) in the Design module;
  * no FAI history for that source yet, but lots of it were accepted before
    FAI tracking existed (grandfathered — so the go-live doesn't stop every
    running item). A later drawing revision only triggers an FAI once a
    baseline FAI exists.

Hooks (flush, never commit):
  start_for_receipt(db, item=, vendor_name=, base_type=, source_type=, source_reference=, user_id=)
      -> (lot inspection type, open FAI or None)  — GRN, job work receipt,
      production output call this before creating their lot.
  link_lot(fai, lot)
  ensure_released(db, lot)       — usage decision (accept) on a regular lot
  check_production_release(db, item, wo_number)  — Production WO release
"""
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.first_article import QualityFirstArticle, QUALITY_FAI_TRIGGER_LABELS
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.services import access
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user

# Design document types that are drawings of the item.
DRAWING_TYPES = ("ga_drawing", "part_drawing", "assembly_drawing")
# Lot types a first article can stand in for (vendor sources vs in-house).
VENDOR_TYPES = ("incoming", "job_work")
INHOUSE_TYPES = ("final",)
_ACCEPTED = ("accept", "accept_with_deviation", "partial")


class FaiError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _key(vendor: str | None) -> str | None:
    v = (vendor or "").strip()
    return v.lower() if v else None


def source_label(vendor: str | None) -> str:
    return f"vendor {vendor}" if (vendor or "").strip() else "in-house production"


def current_drawing_ref(db: Session, item_id: int) -> str | None:
    """The item's released drawing revision(s) in the Design module, e.g.
    "DWG-0012 rev B, ASM-0003 rev A"; None when it has no released drawing."""
    try:
        from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
    except ImportError:  # Design module not installed
        return None
    docs = db.query(DesignDocument).filter(
        DesignDocument.store_item_id == item_id, DesignDocument.is_deleted == False,  # noqa: E712
        DesignDocument.status == "active", DesignDocument.document_type.in_(DRAWING_TYPES),
    ).order_by(DesignDocument.doc_number).all()
    parts = []
    for d in docs:
        rev = db.query(DesignDocumentRevision).filter(
            DesignDocumentRevision.document_id == d.id, DesignDocumentRevision.status == "released",
            DesignDocumentRevision.is_deleted == False,  # noqa: E712
        ).order_by(DesignDocumentRevision.revision_index.desc()).first()
        if rev:
            parts.append(f"{d.doc_number} rev {rev.revision_label}")
    return ", ".join(parts) or None


def applies(db: Session, item: StoreItem | None, base_type: str) -> bool:
    if not item:
        return False
    if base_type in VENDOR_TYPES:
        return bool(item.inspection_on_receipt)
    if base_type in INHOUSE_TYPES:
        from app.modules.quality.services.lots import needs_inspection_on_receipt
        return needs_inspection_on_receipt(db, item, "final")
    return False


def _has_history(db: Session, item_id: int, vendor: str | None, base_types: tuple[str, ...]) -> bool:
    q = db.query(QualityInspectionLot.id).filter(
        QualityInspectionLot.item_id == item_id, QualityInspectionLot.inspection_type.in_(base_types),
        QualityInspectionLot.decision.in_(_ACCEPTED),
    )
    k = _key(vendor)
    q = q.filter(func.lower(QualityInspectionLot.vendor_name) == k) if k else q.filter(QualityInspectionLot.vendor_name.is_(None))
    return q.first() is not None


def requirement(db: Session, item: StoreItem, vendor: str | None, base_type: str) -> dict | None:
    """None when the item + current drawing + source is released for regular
    use. Otherwise {"trigger", "drawing_ref", "open": open FAI or None}."""
    ref = current_drawing_ref(db, item.id)
    k = _key(vendor)
    fais = db.query(QualityFirstArticle).filter(QualityFirstArticle.item_id == item.id).all()
    same_src = [f for f in fais if _key(f.vendor_name) == k]
    approved_same = [f for f in same_src if f.status == "approved"]
    if any((f.drawing_ref or None) == ref for f in approved_same):
        return None
    open_fai = next((f for f in same_src if f.status == "open" and (f.drawing_ref or None) == ref), None)
    base_types = VENDOR_TYPES if base_type in VENDOR_TYPES else INHOUSE_TYPES
    if approved_same:
        trigger = "new_revision"
    elif _has_history(db, item.id, vendor, base_types):
        return None  # grandfathered: supplied / made and accepted before FAI tracking
    elif any(f.status == "approved" for f in fais) or (k and _has_history_any(db, item.id, base_types)):
        trigger = "new_vendor"
    else:
        trigger = "new_item"
    return {"trigger": trigger, "drawing_ref": ref, "open": open_fai}


def _has_history_any(db: Session, item_id: int, base_types: tuple[str, ...]) -> bool:
    return db.query(QualityInspectionLot.id).filter(
        QualityInspectionLot.item_id == item_id, QualityInspectionLot.inspection_type.in_(base_types),
        QualityInspectionLot.decision.in_(_ACCEPTED),
    ).first() is not None


def _create(db: Session, *, item: StoreItem, vendor: str | None, trigger: str, drawing_ref: str | None,
            source_type: str, source_reference: str | None, user_id: int | None, remarks: str | None = None) -> QualityFirstArticle:
    from app.modules.quality.service import generate_fai_number
    fai = QualityFirstArticle(
        fai_number=generate_fai_number(db), item_id=item.id, item_code=item.item_code, item_name=item.item_name,
        vendor_name=(vendor or "").strip() or None, drawing_ref=drawing_ref, trigger=trigger, status="open",
        source_type=source_type, source_reference=source_reference, created_by_id=user_id, remarks=remarks,
    )
    db.add(fai)
    db.flush()
    return fai


def start_for_receipt(db: Session, *, item: StoreItem, vendor_name: str | None, base_type: str, source_type: str,
                      source_reference: str | None, user_id: int | None) -> tuple[str, QualityFirstArticle | None]:
    """Decides whether the lot about to be created is the first article.
    Returns the lot's inspection type and the new FAI (or None). When an FAI
    is already open for this item + source, the new lot stays a regular lot
    — its acceptance waits for the FAI (ensure_released)."""
    if not applies(db, item, base_type):
        return base_type, None
    vendor = vendor_name if base_type in VENDOR_TYPES else None
    req = requirement(db, item, vendor, base_type)
    if not req or req["open"]:
        return base_type, None
    fai = _create(db, item=item, vendor=vendor, trigger=req["trigger"], drawing_ref=req["drawing_ref"],
                  source_type=source_type, source_reference=source_reference, user_id=user_id)
    return "first_article", fai


def link_lot(fai: QualityFirstArticle | None, lot: QualityInspectionLot) -> None:
    if fai:
        fai.lot_id = lot.id


def base_type_for_lot(lot: QualityInspectionLot) -> str | None:
    if lot.inspection_type in VENDOR_TYPES + INHOUSE_TYPES:
        return lot.inspection_type
    return None


def ensure_released(db: Session, lot: QualityInspectionLot) -> None:
    """Rule 9 at the usage decision: a regular incoming / job-work / final
    lot can't be accepted while its item + drawing + source has no approved
    first article. Raises FaiError with the FAI to approve."""
    base = base_type_for_lot(lot)
    if not base or lot.source_type == "ncr":
        return
    item = db.query(StoreItem).filter(StoreItem.id == lot.item_id).first()
    if not applies(db, item, base):
        return
    vendor = lot.vendor_name if base in VENDOR_TYPES else None
    req = requirement(db, item, vendor, base)
    if not req:
        return
    what = f"{QUALITY_FAI_TRIGGER_LABELS[req['trigger']].lower()} ({item.item_code} {item.item_name}, {source_label(vendor)}" + (
        f", drawing {req['drawing_ref']})" if req["drawing_ref"] else ")")
    if req["open"]:
        f = req["open"]
        lot_no = None
        if f.lot_id:
            fl = db.query(QualityInspectionLot.lot_number).filter(QualityInspectionLot.id == f.lot_id).scalar()
            lot_no = fl
        raise FaiError(
            f"Rule 9: this is a {what} and its first article {f.fai_number}"
            + (f" (lot {lot_no})" if lot_no else "")
            + " is not approved yet. A Quality engineer must approve the FAI in Quality → First Article before regular "
              f"lots can be accepted. You can still reject lot {lot.lot_number}.")
    raise FaiError(
        f"Rule 9: this is a {what} with no first article inspection. Raise an FAI in Quality → First Article "
        f"(full drawing check) and get it approved before accepting lot {lot.lot_number}, or reject the lot.")


def check_production_release(db: Session, item: StoreItem | None, wo_number: str) -> None:
    """Rule 9 for production: while the product's in-house first article is
    open (made on another work order, not yet approved), more production
    of the product can't be released."""
    if not item or not applies(db, item, "final"):
        return
    req = requirement(db, item, None, "final")
    if req and req["open"] and req["open"].source_reference != wo_number:
        f = req["open"]
        raise FaiError(
            f"Rule 9: {item.item_code} {item.item_name} is a {QUALITY_FAI_TRIGGER_LABELS[f.trigger].lower()} and its first "
            f"article {f.fai_number} (from {f.source_reference or 'an earlier work order'}) isn't approved yet. "
            "Finish and approve the FAI in Quality → First Article before releasing more production.")


# ---------------------------------------------------------------------------
# Manual FAI + approval
# ---------------------------------------------------------------------------

def create_manual(db: Session, *, item: StoreItem, vendor_name: str | None, quantity: float, location_id: int | None,
                  take_from_free: bool, source_reference: str | None, remarks: str | None, user: User) -> QualityFirstArticle:
    """A first article that didn't come through a GRN / production output
    (e.g. a sample sent ahead of the order). Creates the FAI and its lot."""
    from app.modules.quality.services.lots import create_lot
    vendor = (vendor_name or "").strip() or None
    base = "incoming" if vendor else "final"
    existing = requirement(db, item, vendor, base)
    if existing and existing["open"]:
        raise FaiError(f"First article {existing['open'].fai_number} is already open for {item.item_name} "
                       f"({source_label(vendor)}) — finish that one.")
    trigger = existing["trigger"] if existing else "manual"
    fai = _create(db, item=item, vendor=vendor, trigger=trigger, drawing_ref=current_drawing_ref(db, item.id),
                  source_type="manual", source_reference=source_reference, user_id=user.id, remarks=remarks)
    lot = create_lot(
        db, inspection_type="first_article", source_type="manual", item=item, quantity=quantity,
        location_id=location_id if take_from_free else None, user_id=user.id, source_id=fai.id,
        source_reference=source_reference or fai.fai_number, vendor_name=vendor, take_from_free=take_from_free,
        remarks=f"First article {fai.fai_number}",
    )
    fai.lot_id = lot.id
    db.flush()
    return fai


def _lot(db: Session, fai: QualityFirstArticle) -> QualityInspectionLot | None:
    return db.query(QualityInspectionLot).filter(QualityInspectionLot.id == fai.lot_id).first() if fai.lot_id else None


def approve(db: Session, fai: QualityFirstArticle, *, remarks: str | None, user: User) -> QualityFirstArticle:
    if fai.status != "open":
        raise FaiError(f"{fai.fai_number} is already {fai.status} — a decided FAI is never changed. Raise a new one if needed.")
    if not access.can_approve_fai(user):
        raise FaiError("Only a Quality engineer (or head) can approve a first article — ask an admin to apply the role "
                       "in Quality → Settings → Quality roles.", 403)
    lot = _lot(db, fai)
    if not lot:
        raise FaiError(f"{fai.fai_number} has no first-article inspection lot, so there is nothing to approve it on.")
    if lot.status not in ("decision_made", "closed"):
        raise FaiError(f"First-article lot {lot.lot_number} has no usage decision yet — record the full drawing check "
                       "and decide the lot first.")
    if lot.decision not in ("accept", "accept_with_deviation"):
        raise FaiError(f"Lot {lot.lot_number} was rejected, so the first article can't be approved — reject the FAI; the "
                       "next receipt / production run becomes a fresh first article.")
    if lot.decision == "accept_with_deviation" and not (remarks or "").strip():
        raise FaiError("The first article was accepted with a deviation — note in the remarks why it is still approved "
                       "(e.g. drawing being revised under the concession).", 422)
    fai.status = "approved"
    fai.decided_by_id = user.id
    fai.decided_at = _now()
    fai.decision_remarks = (remarks or "").strip() or None
    _notify(db, fai, user, approved=True)
    return fai


def reject(db: Session, fai: QualityFirstArticle, *, remarks: str | None, user: User) -> QualityFirstArticle:
    if fai.status != "open":
        raise FaiError(f"{fai.fai_number} is already {fai.status} — a decided FAI is never changed.")
    if not access.can_approve_fai(user):
        raise FaiError("Only a Quality engineer (or head) can reject a first article.", 403)
    if not (remarks or "").strip():
        raise FaiError("Give the reason for rejecting the first article (what the vendor / shop must correct).", 422)
    lot = _lot(db, fai)
    if lot and lot.status in ("created", "in_inspection", "results_recorded"):
        raise FaiError(f"Decide lot {lot.lot_number} first (reject it if the first article failed) — its material is "
                       "still held in Quality stock.")
    fai.status = "rejected"
    fai.decided_by_id = user.id
    fai.decided_at = _now()
    fai.decision_remarks = remarks.strip()
    _notify(db, fai, user, approved=False)
    return fai


def _notify(db: Session, fai: QualityFirstArticle, actor: User, approved: bool) -> None:
    msg = (f"{fai.fai_number} for {fai.item_name} ({source_label(fai.vendor_name)}"
           + (f", drawing {fai.drawing_ref}" if fai.drawing_ref else "") + ") was "
           + ("approved — regular lots can now be accepted." if approved else f"rejected: {fai.decision_remarks}"))
    for u in access.quality_engineers(db):
        if u.id != actor.id:
            notify_user(db, user_id=u.id, title="First Article Approved" if approved else "First Article Rejected",
                        message=msg, notification_type="quality_fai_decided", entity_type="quality_first_article",
                        entity_id=fai.id)
