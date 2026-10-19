"""Supplier quality: approved vendor list (item × vendor), ISO 2859-1
sampling switching + skip-lot per item × vendor, monthly automatic vendor
rating, escalation (On watch → tightened sampling + vendor CAPA → Blocked
with a Partner's approval) and vendor audits.

Vendors are free text across the app (see models/supplier_quality.py), so a
vendor is identified by vendor_key = lower-cased trimmed name.

Hooks (flush, never commit):
  lot_sampling(db, item, vendor_name, user_id) -> (severity, skip_lot)   — lots.create_lot
  on_lot_decided(db, lot)                                                 — lots.decide
  blocked_problem(db, item_id, vendor_name) -> str | None                 — lots.decide (acceptance)
  ensure_po_allowed(db, vendor_name, item_ids)   raises SupplierError    — P2P PO raise / PO draft
  on_fai_approved(db, fai, user)                                          — first_article.approve
  compute_monthly_ratings(db, period, user_id)                            — monthly job / Quality head
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.models.supplier_quality import (
    QualityApprovedVendor, QualitySupplierScorecard, QualityVendorStatusEvent, QualityVendorAudit,
    QUALITY_AVL_STATUS_LABELS, QUALITY_VENDOR_AUDIT_RESULTS,
)
from app.modules.quality.services import access
from app.modules.quality.services.settings import get_setting
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user

logger = logging.getLogger(__name__)

# Lot types that rate a vendor (material supplied / processed by it).
VENDOR_LOT_TYPES = ("incoming", "job_work", "first_article")
# NCR score: 100 minus these points per NCR of the month (floored at 0).
NCR_POINTS = {"minor": 5, "major": 15, "critical": 40}


class SupplierError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def vendor_key(name: str | None) -> str | None:
    v = " ".join((name or "").split())
    return v.lower() if v else None


def _event(db: Session, avl: QualityApprovedVendor, event: str, *, to: str | None = None, reason: str | None = None,
           user_id: int | None = None) -> None:
    db.add(QualityVendorStatusEvent(avl_id=avl.id, event=event, from_status=avl.status, to_status=to or avl.status,
                                    reason=reason, user_id=user_id))


def _set_status(db: Session, avl: QualityApprovedVendor, status: str, reason: str, user_id: int | None, event: str = "status") -> None:
    if avl.status == status:
        return
    _event(db, avl, event, to=status, reason=reason, user_id=user_id)
    avl.status = status
    avl.status_reason = reason
    avl.status_changed_at = _now()
    if status in ("on_watch", "blocked"):
        avl.sampling_state = "tightened"
        avl.skip_lot_active = False
        avl.lots_since_inspected = 0
    elif status == "approved" and avl.sampling_state == "tightened":
        avl.sampling_state = "normal"


# ---------------------------------------------------------------------------
# Approved vendor list
# ---------------------------------------------------------------------------

def get_avl(db: Session, item_id: int, vendor_name: str | None) -> QualityApprovedVendor | None:
    k = vendor_key(vendor_name)
    if not k:
        return None
    return db.query(QualityApprovedVendor).filter(QualityApprovedVendor.item_id == item_id,
                                                  QualityApprovedVendor.vendor_key == k).first()


def _has_accepted_history(db: Session, item_id: int, k: str) -> bool:
    return db.query(QualityInspectionLot.id).filter(
        QualityInspectionLot.item_id == item_id, func.lower(QualityInspectionLot.vendor_name) == k,
        QualityInspectionLot.inspection_type.in_(VENDOR_LOT_TYPES),
        QualityInspectionLot.decision.in_(("accept", "accept_with_deviation", "partial")),
    ).first() is not None


def ensure_avl(db: Session, item: StoreItem, vendor_name: str | None, user_id: int | None,
               vendor_id: int | None = None) -> QualityApprovedVendor | None:
    """The AVL row for item × vendor, created on first supply: Trial for a new
    vendor; Approved (grandfathered) when the vendor already supplied this item
    and it was accepted before the list existed."""
    k = vendor_key(vendor_name)
    if not k:
        return None
    avl = get_avl(db, item.id, vendor_name)
    if avl:
        return avl
    grandfathered = _has_accepted_history(db, item.id, k)
    avl = QualityApprovedVendor(
        item_id=item.id, vendor_name=" ".join(vendor_name.split()), vendor_key=k, vendor_id=vendor_id,
        status="approved" if grandfathered else "trial", created_by_id=user_id,
        valid_until=_valid_until(db) if grandfathered else None,
        approved_at=_now() if grandfathered else None,
        status_reason="Supplied and accepted before the approved vendor list" if grandfathered else "New vendor for this item",
        status_changed_at=_now(), recent_lots=[],
    )
    db.add(avl)
    db.flush()
    _event(db, avl, "added", reason=avl.status_reason, user_id=user_id)
    return avl


def _valid_until(db: Session) -> date:
    months = int(get_setting(db, "avl_validity_months"))
    return date.today() + timedelta(days=round(months * 30.44))


def create_manual(db: Session, *, item_id: int, vendor_name: str, vendor_id: int | None, remarks: str | None, user: User) -> QualityApprovedVendor:
    if not access.can_approve_vendor(user) and not access.is_quality_engineer(user):
        raise SupplierError("Only a Quality engineer or head can add a vendor to the approved vendor list.", 403)
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise SupplierError(f"Item #{item_id} isn't in the Item Master.", 404)
    if not vendor_key(vendor_name):
        raise SupplierError("Enter the vendor name exactly as it appears on the purchase orders.", 422)
    if get_avl(db, item.id, vendor_name):
        raise SupplierError(f"{vendor_name} is already on the list for {item.item_name}.")
    avl = ensure_avl(db, item, vendor_name, user.id, vendor_id)
    avl.remarks = (remarks or "").strip() or None
    return avl


def approve(db: Session, avl: QualityApprovedVendor, *, remarks: str | None, user: User) -> QualityApprovedVendor:
    """Trial → Approved by a Quality head — only for items without first-article
    control (inspection-controlled items are approved by their FAI)."""
    if not access.can_approve_vendor(user):
        raise SupplierError("Only a Quality head can approve a vendor.", 403)
    if avl.status != "trial":
        raise SupplierError(f"{avl.vendor_name} is '{QUALITY_AVL_STATUS_LABELS[avl.status]}' for this item — only a Trial "
                            "vendor is approved this way (On watch returns to Approved through its monthly rating; Blocked needs a Partner).")
    item = db.query(StoreItem).filter(StoreItem.id == avl.item_id).first()
    from app.modules.quality.services import first_article
    if item and first_article.applies(db, item, "incoming"):
        req = first_article.requirement(db, item, avl.vendor_name, "incoming")
        if req:
            open_ = req.get("open")
            raise SupplierError(
                f"{item.item_name} is inspection-controlled, so {avl.vendor_name} is approved by its first article (rule 9)"
                + (f" — approve {open_.fai_number} in Quality → First Article." if open_ else
                   " — the vendor's first receipt opens one automatically (or raise it in Quality → First Article)."))
    if not (remarks or "").strip():
        raise SupplierError("Record the basis of approval (sample report, audit, trial order result …).", 422)
    _set_status(db, avl, "approved", remarks.strip(), user.id)
    avl.approved_by_id = user.id
    avl.approved_at = _now()
    avl.valid_until = _valid_until(db)
    db.flush()
    return avl


def on_fai_approved(db: Session, fai, user: User) -> None:
    """Rule 9 ↔ AVL: an approved first article from a vendor approves that
    vendor for the item (Trial → Approved)."""
    if not fai.vendor_name:
        return
    item = db.query(StoreItem).filter(StoreItem.id == fai.item_id).first()
    if not item:
        return
    avl = ensure_avl(db, item, fai.vendor_name, user.id)
    avl.fai_id = fai.id
    if avl.status == "trial":
        _set_status(db, avl, "approved", f"First article {fai.fai_number} approved", user.id)
        avl.approved_by_id = user.id
        avl.approved_at = _now()
        avl.valid_until = _valid_until(db)
    elif avl.status == "approved":
        avl.valid_until = _valid_until(db)
    db.flush()


def put_on_watch(db: Session, avl: QualityApprovedVendor, *, reason: str | None, user: User) -> QualityApprovedVendor:
    if not access.can_approve_vendor(user):
        raise SupplierError("Only a Quality head can put a vendor on watch.", 403)
    if avl.status not in ("trial", "approved"):
        raise SupplierError(f"{avl.vendor_name} is already '{QUALITY_AVL_STATUS_LABELS[avl.status]}'.")
    if not (reason or "").strip():
        raise SupplierError("Give the reason for putting the vendor on watch.", 422)
    _set_status(db, avl, "on_watch", reason.strip(), user.id)
    from app.modules.quality.services.capa import raise_for_vendor
    raise_for_vendor(db, vendor_name=avl.vendor_name, reason=reason.strip(), user_id=user.id, item_id=avl.item_id)
    db.flush()
    return avl


def release_watch(db: Session, avl: QualityApprovedVendor, *, reason: str | None, user: User) -> QualityApprovedVendor:
    if not access.can_approve_vendor(user):
        raise SupplierError("Only a Quality head can take a vendor off watch.", 403)
    if avl.status != "on_watch":
        raise SupplierError("Only an On-watch vendor can be taken off watch.")
    capa = _open_vendor_capa(db, avl.vendor_name)
    if capa:
        raise SupplierError(f"Vendor CAPA {capa.capa_number} is still open — close it (effective) before taking "
                            f"{avl.vendor_name} off watch.")
    if not (reason or "").strip():
        raise SupplierError("Give the reason (e.g. CAPA effective, ratings back above the limit).", 422)
    _set_status(db, avl, "approved", reason.strip(), user.id)
    db.flush()
    return avl


def _open_vendor_capa(db: Session, vendor_name: str):
    from app.modules.quality.models.capa import QualityCapa, QUALITY_CAPA_OPEN_STATUSES
    return db.query(QualityCapa).filter(
        QualityCapa.is_deleted == False, QualityCapa.trigger == "vendor_trend",  # noqa: E712
        func.lower(QualityCapa.vendor_name) == vendor_key(vendor_name), QualityCapa.status.in_(QUALITY_CAPA_OPEN_STATUSES),
    ).first()


def request_block(db: Session, avl: QualityApprovedVendor, *, reason: str | None, user: User | None,
                  action: str = "block") -> QualityApprovedVendor:
    """Block (or unblock) needs a Partner — this records the request and asks them."""
    uid = user.id if user else None
    if user is not None and not access.can_approve_vendor(user):
        raise SupplierError(f"Only a Quality head can request a vendor {action}.", 403)
    if action == "block" and avl.status == "blocked":
        raise SupplierError(f"{avl.vendor_name} is already blocked for this item.")
    if action == "unblock" and avl.status != "blocked":
        raise SupplierError("Only a blocked vendor can be unblocked.")
    if avl.pending_action:
        raise SupplierError(f"A {avl.pending_action} request is already waiting for a Partner.")
    if not (reason or "").strip():
        raise SupplierError(f"Give the reason for the {action}.", 422)
    avl.pending_action = action
    avl.pending_reason = reason.strip()
    avl.pending_requested_by_id = uid
    avl.pending_requested_at = _now()
    _event(db, avl, f"{action}_requested", reason=reason.strip(), user_id=uid)
    item_name = db.query(StoreItem.item_name).filter(StoreItem.id == avl.item_id).scalar() or "item"
    db.flush()
    # Organization › Approval Workflows › Vendor block / unblock (default: a
    # Partner) — the engine notifies the approvers and calls
    # apply_pending_decision when the request finishes.
    from fastapi import HTTPException
    from app.modules.quality.services.authz import submit_vendor_block
    try:
        submit_vendor_block(db, avl, action=action, reason=reason.strip(), user=user, item_name=item_name)
    except HTTPException as e:
        if user is not None:
            raise
        # The monthly rating must not fail when nobody can approve (e.g. no
        # Partner set yet): the request stays pending on the vendor and a
        # Partner decides it from Supplier Quality (legacy decision path).
        logger.warning("Vendor block request for %s not routed to the approval engine: %s", avl.vendor_name, e.detail)
    return avl


def decide_pending(db: Session, avl: QualityApprovedVendor, *, approve: bool, remarks: str | None, user: User) -> QualityApprovedVendor:
    """Old 'Partner decision' endpoint: decides the engine request when there
    is one; requests raised before the engine finish on the legacy rule."""
    if not avl.pending_action:
        raise SupplierError("Nothing is waiting for a Partner's decision on this vendor.")
    from app.modules.organization.services import approval_engine as engine
    from app.modules.quality.services.authz import AVL_ENTITY, pending_request
    req = pending_request(db, AVL_ENTITY, avl.id)
    if req is not None:
        engine.decide(db, req.id, user, "approve" if approve else "reject", remarks)
        return avl
    if not access.is_partner(user):
        raise SupplierError("Blocking / unblocking a vendor is a Partner's decision (Company Info → Partners).", 403)
    note = (remarks or "").strip() or None
    if not approve and not note:
        raise SupplierError("Give the reason for rejecting the request.", 422)
    return apply_pending_decision(db, avl, approve=approve, note=note, user=user)


def apply_pending_decision(db: Session, avl: QualityApprovedVendor, *, approve: bool, note: str | None, user: User,
                           notify_requester: bool = True) -> QualityApprovedVendor:
    """Carry out a decided block / unblock request."""
    action = avl.pending_action
    if approve:
        _set_status(db, avl, "blocked" if action == "block" else "on_watch",
                    f"{'Blocked' if action == 'block' else 'Unblocked (On watch)'} by {user.name or user.email}: "
                    f"{avl.pending_reason}" + (f" — {note}" if note else ""), user.id, event=f"{action}_approved")
    else:
        _event(db, avl, f"{action}_rejected", reason=note, user_id=user.id)
    requester = avl.pending_requested_by_id
    avl.pending_action = avl.pending_reason = None
    avl.pending_requested_by_id = None
    avl.pending_requested_at = None
    item_name = db.query(StoreItem.item_name).filter(StoreItem.id == avl.item_id).scalar() or "item"
    for u in {u.id for u in access.quality_heads(db) + access.purchase_contacts(db)} | ({requester} if requester and notify_requester else set()):
        if u != user.id:
            notify_user(db, user_id=u, title=f"Vendor {action.title()} {'Approved' if approve else 'Rejected'}",
                        message=f"{avl.vendor_name} for {item_name}: {user.name or user.email} "
                                f"{'approved' if approve else 'rejected'} the {action}" + (f" — {note}" if note else "") + ".",
                        notification_type="quality_vendor_status", entity_type="quality_approved_vendor", entity_id=avl.id)
    db.flush()
    return avl


# ---------------------------------------------------------------------------
# Hooks: sampling at lot creation, switching at lot decision, block checks
# ---------------------------------------------------------------------------

def lot_sampling(db: Session, item: StoreItem, vendor_name: str | None, user_id: int | None,
                 inspection_type: str) -> tuple[str | None, bool]:
    """Sampling state + skip-lot for a new vendor lot. Returns (None, False)
    when the lot isn't a vendor lot (the settings default applies)."""
    if inspection_type not in VENDOR_LOT_TYPES or not vendor_key(vendor_name):
        return None, False
    avl = ensure_avl(db, item, vendor_name, user_id)  # first supply adds the vendor (Trial)
    if inspection_type == "first_article":
        return None, False  # the first article has its own fixed full-drawing sample
    if avl.status in ("on_watch", "blocked"):
        return "tightened", False
    skip = False
    if avl.skip_lot_active and avl.status == "approved":
        freq = int(get_setting(db, "skip_lot_frequency"))
        if avl.lots_since_inspected + 1 >= freq:
            avl.lots_since_inspected = 0   # this one is fully inspected
        else:
            avl.lots_since_inspected += 1
            skip = True
    return avl.sampling_state, skip


def on_lot_decided(db: Session, lot: QualityInspectionLot) -> None:
    """ISO 2859-1 switching per item × vendor (simplified): normal → tightened
    when 2 of the last 5 lots are rejected; tightened → normal after N
    accepted in a row (not while On watch / Blocked); normal → reduced after
    N accepted in a row (Approved vendors); any rejection on reduced → normal
    and ends skip-lot; skip-lot starts after N accepted in a row on reduced
    with a monthly score at / above the minimum."""
    if lot.inspection_type not in VENDOR_LOT_TYPES or lot.source_type == "ncr" or not vendor_key(lot.vendor_name):
        return
    item = db.query(StoreItem).filter(StoreItem.id == lot.item_id).first()
    if not item:
        return
    avl = ensure_avl(db, item, lot.vendor_name, lot.decided_by_id)
    ok = lot.decision == "accept"
    recent = list(avl.recent_lots or [])[-9:] + [ok]
    avl.recent_lots = recent
    uid = lot.decided_by_id
    if ok:
        avl.consecutive_accepted += 1
        n = avl.consecutive_accepted
        if avl.sampling_state == "tightened" and avl.status not in ("on_watch", "blocked") \
                and n >= int(get_setting(db, "tightened_to_normal_lots")):
            _event(db, avl, "sampling", reason=f"{n} lots accepted in a row — tightened → normal", user_id=uid)
            avl.sampling_state = "normal"
        elif avl.sampling_state == "normal" and avl.status == "approved" and n >= int(get_setting(db, "reduced_after_lots")):
            _event(db, avl, "sampling", reason=f"{n} lots accepted in a row — normal → reduced", user_id=uid)
            avl.sampling_state = "reduced"
        elif avl.sampling_state == "reduced" and avl.status == "approved" and not avl.skip_lot_active \
                and n >= int(get_setting(db, "skip_lot_after_lots")) \
                and (avl.last_score or 0) >= float(get_setting(db, "skip_lot_min_score")):
            _event(db, avl, "sampling", reason=f"{n} lots accepted in a row, score {avl.last_score:g} — skip-lot starts", user_id=uid)
            avl.skip_lot_active = True
            avl.lots_since_inspected = 0
    else:
        avl.consecutive_accepted = 0
        if avl.skip_lot_active:
            _event(db, avl, "sampling", reason=f"Lot {lot.lot_number} not accepted — skip-lot ends", user_id=uid)
        avl.skip_lot_active = False
        avl.lots_since_inspected = 0
        if avl.sampling_state == "reduced":
            _event(db, avl, "sampling", reason=f"Lot {lot.lot_number} not accepted — reduced → normal", user_id=uid)
            avl.sampling_state = "normal"
        elif avl.sampling_state == "normal" and sum(1 for x in recent[-5:] if not x) >= 2:
            _event(db, avl, "sampling", reason="2 of the last 5 lots not accepted — normal → tightened", user_id=uid)
            avl.sampling_state = "tightened"
    db.flush()


def blocked_problem(db: Session, item_id: int, vendor_name: str | None) -> str | None:
    avl = get_avl(db, item_id, vendor_name)
    if not avl or avl.status != "blocked":
        return None
    item_name = db.query(StoreItem.item_name).filter(StoreItem.id == item_id).scalar() or "this item"
    return (f"{avl.vendor_name} is BLOCKED for {item_name} (approved vendor list: {avl.status_reason or 'quality rating'}). "
            "Material from a blocked vendor can't be accepted — reject the lot (return to vendor), or a Partner must first "
            "unblock the vendor in Quality → Supplier Quality.")


def ensure_po_allowed(db: Session, vendor_name: str | None, item_ids: list[int | None]) -> None:
    """P2P hook: a Blocked vendor gets no new PO lines for the blocked items.
    PO lines carry their Item Master id (store_item_id); an older line with
    no id has nothing to check against and is skipped."""
    k = vendor_key(vendor_name)
    ids = {i for i in item_ids if i}
    if not k or not ids:
        return
    rows = db.query(QualityApprovedVendor, StoreItem.item_name).join(StoreItem, StoreItem.id == QualityApprovedVendor.item_id).filter(
        QualityApprovedVendor.vendor_key == k, QualityApprovedVendor.status == "blocked",
        QualityApprovedVendor.item_id.in_(ids),
    ).all()
    if rows:
        raise SupplierError(
            f"{rows[0][0].vendor_name} is BLOCKED by Quality for: {', '.join(sorted(n for _, n in rows))}. A purchase order "
            "for these items can't go to this vendor — choose another (approved) vendor, or ask Quality to get the vendor "
            "unblocked by a Partner (Quality → Supplier Quality).")


# ---------------------------------------------------------------------------
# Monthly rating + escalation
# ---------------------------------------------------------------------------

def _period_bounds(period: str) -> tuple[date, date]:
    try:
        y, m = (int(x) for x in period.split("-"))
        start = date(y, m, 1)
    except (ValueError, TypeError):
        raise SupplierError("Period must be a month like 2026-09.", 422)
    end = date(y + (m == 12), m % 12 + 1, 1)
    return start, end


def previous_period(today: date | None = None) -> str:
    d = (today or date.today()).replace(day=1) - timedelta(days=1)
    return f"{d.year}-{d.month:02d}"


def _band(db: Session, score: float | None) -> str | None:
    if score is None:
        return None
    if score < float(get_setting(db, "vendor_block_below")):
        return "blocked"
    if score < float(get_setting(db, "vendor_watch_below")):
        return "on_watch"
    return "approved"


def compute_monthly_ratings(db: Session, period: str, user_id: int | None = None, escalate: bool = True) -> list[QualitySupplierScorecard]:
    start, end = _period_bounds(period)
    if start > date.today():
        raise SupplierError(f"{period} hasn't started yet — rate a finished (or the current) month.", 422)
    start_dt = datetime(start.year, start.month, 1, tzinfo=timezone.utc)
    end_dt = datetime(end.year, end.month, 1, tzinfo=timezone.utc)
    data: dict[str, dict] = {}

    def row(name: str) -> dict:
        k = vendor_key(name)
        return data.setdefault(k, {"name": " ".join(name.split()), "lots": 0, "recv": 0.0, "acc": 0.0, "rej_lots": 0,
                                   "minor": 0, "major": 0, "critical": 0, "deliv": 0, "ontime": 0})

    lots = db.query(QualityInspectionLot).filter(
        QualityInspectionLot.inspection_type.in_(VENDOR_LOT_TYPES), QualityInspectionLot.source_type != "ncr",
        QualityInspectionLot.vendor_name.isnot(None), QualityInspectionLot.decision.isnot(None),
        QualityInspectionLot.decided_at >= start_dt, QualityInspectionLot.decided_at < end_dt,
    ).all()
    for l in lots:
        if not vendor_key(l.vendor_name):
            continue
        r = row(l.vendor_name)
        r["lots"] += 1
        r["recv"] += l.quantity or 0
        r["acc"] += l.accepted_qty or 0
        r["rej_lots"] += 1 if (l.rejected_qty or 0) > 0 else 0
    ncrs = db.query(QualityNcr).filter(
        QualityNcr.is_deleted == False, QualityNcr.status != "cancelled", QualityNcr.vendor_name.isnot(None),  # noqa: E712
        QualityNcr.ncr_date >= start, QualityNcr.ncr_date < end,
    ).all()
    for n in ncrs:
        if vendor_key(n.vendor_name):
            row(n.vendor_name)[n.severity if n.severity in NCR_POINTS else "minor"] += 1
    try:
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
        from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
        grns = db.query(P2PGoodsReceipt.received_date, P2PPurchaseOrder.expected_delivery, P2PPurchaseOrder.vendor_name).join(
            P2PPurchaseOrder, P2PPurchaseOrder.id == P2PGoodsReceipt.purchase_order_id).filter(
            P2PGoodsReceipt.received_date >= start, P2PGoodsReceipt.received_date < end,
            P2PPurchaseOrder.expected_delivery.isnot(None), P2PPurchaseOrder.vendor_name.isnot(None),
        ).all()
    except ImportError:  # pragma: no cover
        grns = []
    for received, expected, vname in grns:
        if vendor_key(vname):
            r = row(vname)
            r["deliv"] += 1
            r["ontime"] += 1 if received <= expected else 0

    w = {"quality": float(get_setting(db, "vendor_weight_quality")), "delivery": float(get_setting(db, "vendor_weight_delivery")),
         "ncr": float(get_setting(db, "vendor_weight_ncr"))}
    out = []
    for k, r in data.items():
        q = round(r["acc"] * 100 / r["recv"], 2) if r["recv"] else None
        n_points = r["minor"] * NCR_POINTS["minor"] + r["major"] * NCR_POINTS["major"] + r["critical"] * NCR_POINTS["critical"]
        ncr_score = max(0.0, 100.0 - n_points) if (r["lots"] or r["minor"] + r["major"] + r["critical"]) else None
        d = round(r["ontime"] * 100 / r["deliv"], 2) if r["deliv"] else None
        parts = [(q, w["quality"]), (d, w["delivery"]), (ncr_score, w["ncr"])]
        used = [(s, wt) for s, wt in parts if s is not None and wt > 0]
        overall = round(sum(s * wt for s, wt in used) / sum(wt for _, wt in used), 2) if used else None
        card = db.query(QualitySupplierScorecard).filter(QualitySupplierScorecard.vendor_key == k,
                                                        QualitySupplierScorecard.period == period,
                                                        QualitySupplierScorecard.is_deleted == False).first()  # noqa: E712
        if not card:
            card = QualitySupplierScorecard(vendor_key=k, vendor_name=r["name"], period=period, created_by_id=user_id)
            db.add(card)
        card.period_start = start
        card.lots_count, card.received_qty, card.accepted_qty, card.rejected_lots = r["lots"], r["recv"], r["acc"], r["rej_lots"]
        card.quality_score, card.ncr_score, card.on_time_delivery_score, card.overall_score = q, ncr_score, d, overall
        card.ncr_minor, card.ncr_major, card.ncr_critical = r["minor"], r["major"], r["critical"]
        card.ncr_count = r["minor"] + r["major"] + r["critical"]
        card.rejection_count = r["rej_lots"]
        card.deliveries, card.on_time_deliveries = r["deliv"], r["ontime"]
        card.weights = w
        card.rating_band = _band(db, overall)
        card.status = "final"
        card.computed_at = _now()
        out.append(card)
    db.flush()
    if escalate:
        for card in out:
            _escalate(db, card, user_id)
    return out


def _escalate(db: Session, card: QualitySupplierScorecard, user_id: int | None) -> None:
    rows = db.query(QualityApprovedVendor).filter(QualityApprovedVendor.vendor_key == card.vendor_key).all()
    for avl in rows:
        avl.last_score = card.overall_score
        avl.last_rated_period = card.period
    if card.overall_score is None or not rows:
        return
    band = card.rating_band
    reason = (f"{card.period} rating {card.overall_score:g} (quality {card.quality_score if card.quality_score is not None else '—'}, "
              f"delivery {card.on_time_delivery_score if card.on_time_delivery_score is not None else '—'}, "
              f"NCR {card.ncr_score if card.ncr_score is not None else '—'})")
    if band in ("on_watch", "blocked"):
        changed = [a for a in rows if a.status in ("trial", "approved")]
        for a in changed:
            _set_status(db, a, "on_watch", f"{reason} below the On-watch limit {get_setting(db, 'vendor_watch_below')}", user_id)
        from app.modules.quality.services.capa import raise_for_vendor
        capa = raise_for_vendor(db, vendor_name=card.vendor_name, user_id=user_id,
                                reason=f"{reason} fell below the On-watch limit. Tightened sampling applies to its lots; "
                                       "the vendor must submit a corrective action (8D).")
        if band == "blocked":
            for a in rows:
                if a.status != "blocked" and not a.pending_action:
                    request_block(db, a, reason=f"{reason} below the Blocked limit {get_setting(db, 'vendor_block_below')}",
                                  user=None, action="block")
        title = "Vendor Rating Below Limit"
        msg = (f"{card.vendor_name}: {reason} — "
               + ("below the Blocked limit; a Partner must approve the block." if band == "blocked" else "now On watch.")
               + f" Tightened sampling on its lots; vendor CAPA {capa.capa_number}.")
        for uid in {u.id for u in access.quality_heads(db) + access.purchase_contacts(db)}:
            if uid != user_id:
                notify_user(db, user_id=uid, title=title, message=msg, notification_type="quality_vendor_rating_low",
                            entity_type="quality_supplier_scorecard", entity_id=card.id)
    elif band == "approved":
        if not _open_vendor_capa(db, card.vendor_name):
            for a in rows:
                if a.status == "on_watch":
                    _set_status(db, a, "approved", f"{reason} back above the On-watch limit and vendor CAPA closed", user_id)
    db.flush()


def ensure_period_rated(db: Session, period: str) -> int:
    """Monthly job: rate the period once (re-runs only by a Quality head)."""
    if db.query(QualitySupplierScorecard.id).filter(QualitySupplierScorecard.period == period).first():
        return 0
    return len(compute_monthly_ratings(db, period))


# ---------------------------------------------------------------------------
# Vendor audits
# ---------------------------------------------------------------------------

def schedule_audit(db: Session, *, vendor_name: str, planned_date: date, scope: str | None, auditor_id: int | None,
                   user: User) -> QualityVendorAudit:
    from app.modules.quality.service import generate_vendor_audit_number
    if not (access.can_approve_vendor(user) or access.is_quality_engineer(user)):
        raise SupplierError("Only a Quality engineer or head can schedule a vendor audit.", 403)
    k = vendor_key(vendor_name)
    if not k:
        raise SupplierError("Enter the vendor to audit.", 422)
    audit = QualityVendorAudit(audit_number=generate_vendor_audit_number(db), vendor_name=" ".join(vendor_name.split()),
                               vendor_key=k, planned_date=planned_date, scope=(scope or "").strip() or None,
                               auditor_id=auditor_id, status="planned", created_by_id=user.id)
    db.add(audit)
    db.flush()
    if auditor_id and auditor_id != user.id:
        notify_user(db, user_id=auditor_id, title="Vendor Audit Assigned",
                    message=f"{audit.audit_number}: audit of {audit.vendor_name} planned for {planned_date:%d-%m-%Y}.",
                    notification_type="quality_vendor_audit_assigned", entity_type="quality_vendor_audit", entity_id=audit.id)
    return audit


def complete_audit(db: Session, audit: QualityVendorAudit, *, audit_date: date, score: float | None, result: str,
                   findings: list[dict], remarks: str | None, user: User) -> QualityVendorAudit:
    if audit.status != "planned":
        raise SupplierError(f"{audit.audit_number} is {audit.status} — a completed audit isn't changed.")
    if not (access.can_approve_vendor(user) or access.is_quality_engineer(user)):
        raise SupplierError("Only a Quality engineer or head can record a vendor audit.", 403)
    if result not in QUALITY_VENDOR_AUDIT_RESULTS:
        raise SupplierError("Result must be satisfactory, conditional or unsatisfactory.", 422)
    if score is not None and not (0 <= score <= 100):
        raise SupplierError("Audit score must be between 0 and 100.", 422)
    clean = []
    for f in findings or []:
        t, d = f.get("type"), (f.get("description") or "").strip()
        if t not in ("major", "minor", "observation") or not d:
            raise SupplierError("Each finding needs a type (major / minor / observation) and a description.", 422)
        clean.append({"type": t, "description": d})
    audit.status = "completed"
    audit.audit_date = audit_date
    audit.score = score
    audit.result = result
    audit.findings = clean
    audit.remarks = (remarks or "").strip() or None
    audit.completed_by_id = user.id
    db.flush()
    serious = [f for f in clean if f["type"] in ("major", "minor")]
    if serious:
        from app.modules.quality.services.capa import raise_for_audit_finding
        capa = raise_for_audit_finding(
            db, audit_reference=audit.audit_number, vendor_name=audit.vendor_name, user_id=user.id,
            severity="major" if any(f["type"] == "major" for f in serious) else "minor",
            finding=f"Vendor audit of {audit.vendor_name}: " + "; ".join(f"[{f['type']}] {f['description']}" for f in serious))
        audit.capa_id = capa.id
    db.flush()
    return audit
