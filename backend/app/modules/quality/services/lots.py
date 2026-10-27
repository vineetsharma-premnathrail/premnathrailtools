"""Inspection lot lifecycle and the hooks other modules call.

Hooks for other modules (call inside their transaction; they flush, never commit):
  needs_inspection_on_receipt(db, item, inspection_type) -> bool
  create_lot_for_grn_line(db, grn, line, item, vendor_name, user_id) -> lot
      Store/P2P GRN: posts the received qty to QUALITY stock and opens an
      incoming lot. The lot's usage decision writes the accepted/rejected
      split back onto the GRN line (p2p goods_receipts.apply_quality_decision).
  create_lot_for_production_output(db, work_order, item, quantity, location_id, batch_number, user_id) -> lot
      Production "Receive Output": FG to QUALITY stock + final lot.
  create_lot_for_job_work_receipt(db, material_return=, line=, item=, vendor_name=, issue_number=, user_id=)
      Store material return against a job-work issue (material back from
      the vendor): stock to QUALITY + job work lot (Phase 2).
  create_lot(...) — generic (manual lots, NCR re-inspection, later phases).

GRN / job work / production output first ask services.first_article whether
the lot is a first article (rule 9) — then the lot type is first_article
and an FAI record is opened. In-process gate lots live in
services/production_gates.py.
"""
import math
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.characteristic import QualityCharacteristic
from app.modules.quality.models.inspection_lot import (
    QualityInspectionLot, QualityLotResult, QUALITY_LOT_DECISIONS, QUALITY_LOT_DECISION_LABELS,
)
from app.modules.quality.models.inspection_plan import QUALITY_INSPECTION_TYPE_LABELS
from app.modules.quality.models.masters import QualityDefectCode
from app.modules.quality.services import access, role_events
from app.modules.quality.services.plans import current_plan
from app.modules.quality.services.sampling import sampling_for_line
from app.modules.quality.services.settings import get_setting
from app.modules.quality.service import generate_lot_number
from app.modules.store.models.item import StoreItem
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.utils.notifications import notify_user, broadcast_notification

LOT_REFERENCE_TYPE = "inspection_lot"
# First-article lots without their own plan borrow the regular plan of the
# inspection point they replace.
_FAI_BASE_TYPE = {"grn": "incoming", "material_return": "job_work", "work_order": "final"}
_CLASS_RANK = {"minor": 1, "major": 2, "critical": 3}


class LotError(ValueError):
    """User-facing rule violation; `status` is the HTTP status to use."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stock(db: Session, lot: QualityInspectionLot, txn_type: str, qty: float, user_id: int | None, remarks: str,
           unit_cost: float | None = None) -> None:
    # unit_cost: the receipt's price (GRN → PO rate); None = current average.
    try:
        post_stock_transaction(
            db, item_id=lot.item_id, location_id=lot.location_id, transaction_type=txn_type, quantity=qty,
            batch_number=lot.batch_number, reference_type=LOT_REFERENCE_TYPE, reference_number=lot.lot_number,
            remarks=remarks, created_by_id=user_id, unit_cost=unit_cost,
            # Production output is valued at the work order's actual cost.
            cost_source={"work_order": "production_actual", "job_work_receipt": "job_work"}.get(lot.source_type, "po_rate") if unit_cost else None,
        )
    except ValueError as e:
        raise LotError(f"Stock couldn't be moved for lot {lot.lot_number}: {e}")


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------

def needs_inspection_on_receipt(db: Session, item: StoreItem | None, inspection_type: str = "incoming") -> bool:
    """Incoming: the Item Master flag decides. Final (production output):
    the flag, or an approved final inspection plan for the product."""
    if not item:
        return False
    if item.inspection_on_receipt:
        return True
    return inspection_type == "final" and current_plan(db, item.id, "final") is not None


def attach_plan(db: Session, lot: QualityInspectionLot) -> bool:
    """Copies the item's approved current plan onto the lot as result rows,
    with the sample size worked out per characteristic. Returns False when
    no approved plan exists (rule 2 — the lot can't be inspected yet)."""
    plan = current_plan(db, lot.item_id, lot.inspection_type)
    sampling_type, fixed_n = (plan.sampling_type, plan.fixed_sample_size) if plan else (None, None)
    if not plan and lot.inspection_type == "first_article":
        # No own FAI plan: full drawing check against the item's regular plan —
        # every characteristic on the first-article sample, accept 0.
        base = _FAI_BASE_TYPE.get(lot.source_type) or ("incoming" if lot.vendor_name else "final")
        plan = current_plan(db, lot.item_id, base) or current_plan(db, lot.item_id, "final" if base != "final" else "incoming")
        sampling_type, fixed_n = "fixed", int(get_setting(db, "fai_sample_size"))
    if not plan:
        return False
    for r in list(lot.results):
        lot.results.remove(r)
    chars = {c.id: c for c in db.query(QualityCharacteristic).filter(
        QualityCharacteristic.id.in_([l.characteristic_id for l in plan.lines])).all()}
    max_n = 0
    for line in plan.lines:
        ch = chars[line.characteristic_id]
        classification = line.classification or ch.classification
        if lot.skip_lot and classification != "critical":
            continue  # skip-lot: only critical characteristics (always 100%) are checked
        aql = line.aql if line.aql is not None else plan.aql
        try:
            s = sampling_for_line(
                db, lot_size=lot.quantity, classification=classification, sampling_type=sampling_type,
                aql=aql, level=plan.inspection_level, severity=lot.sampling_severity,
                fixed_sample_size=fixed_n,
            )
        except ValueError as e:
            raise LotError(f"Plan {plan.plan_number}: {e}")
        max_n = max(max_n, s.sample_size)
        lot.results.append(QualityLotResult(
            plan_line_id=line.id, characteristic_id=ch.id, sequence=line.sequence, characteristic_name=ch.name,
            char_type=ch.char_type, classification=classification, unit=ch.unit, method=line.method or ch.method,
            nominal=line.nominal, min_value=line.min_value, max_value=line.max_value, aql=aql,
            sample_size=s.sample_size, accept_number=s.accept_number, reject_number=s.reject_number,
        ))
    lot.plan_id = plan.id
    lot.plan_revision = plan.revision
    lot.sample_size = max_n
    db.flush()
    return True


def _notify_new_lot(db: Session, lot: QualityInspectionLot, actor_id: int | None) -> None:
    title = "Inspection Lot Waiting"
    plan_note = "" if lot.plan_id else " No approved inspection plan exists yet — a Quality engineer must approve one first."
    message = (f"Lot {lot.lot_number}: {lot.quantity:g} {lot.uom or ''} of {lot.item_name} "
               f"({QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type, lot.inspection_type)}, {lot.source_reference or lot.source_type}) "
               f"is waiting for inspection.{plan_note}")
    inspectors = [] if lot.assigned_to_id else access.users_with_grant(db, "inspection_lots", "edit")
    if lot.assigned_to_id or inspectors:
        # Role-based (core/events/quality.py) — the assignee / inspectors are told directly below.
        role_events.fire(db, "lot_waiting_results", record=lot, entity_type="quality_inspection_lot",
                         skip={lot.assigned_to_id, actor_id, *(u.id for u in inspectors)},
                         title=f"Inspection lot waiting: {lot.lot_number}", message=message + " Open it from My Inspections.")
    if lot.assigned_to_id:
        notify_user(db, user_id=lot.assigned_to_id, title=title, message=message, notification_type="quality_lot_assigned",
                    entity_type="quality_inspection_lot", entity_id=lot.id)
        return
    if inspectors:
        for u in inspectors:
            if u.id != actor_id:
                notify_user(db, user_id=u.id, title=title, message=message, notification_type="quality_lot_assigned",
                            entity_type="quality_inspection_lot", entity_id=lot.id)
    else:
        broadcast_notification(db, title=title, message=message, notification_type="quality_lot_assigned",
                               entity_type="quality_inspection_lot", entity_id=lot.id, exclude_user_id=actor_id,
                               app_name="quality")
    if not lot.plan_id:
        for u in access.quality_engineers(db):
            notify_user(db, user_id=u.id, title="Inspection Plan Needed",
                        message=f"Lot {lot.lot_number} ({lot.item_name}, {QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type)}) "
                                "can't be inspected: there's no approved inspection plan for this item and inspection type. "
                                "Create and approve one in Quality → Inspection Plans.",
                        notification_type="quality_plan_needed", entity_type="quality_inspection_lot", entity_id=lot.id, teams=True)


def order_project_link_of(obj) -> dict:
    """{order_project_id, order_project_element_id} copied from a source
    record (work order…) once its module carries the project link —
    empty values until then."""
    return {"order_project_id": getattr(obj, "order_project_id", None),
            "order_project_element_id": getattr(obj, "order_project_element_id", None)}


def create_lot(
    db: Session, *, inspection_type: str, source_type: str, item: StoreItem, quantity: float,
    location_id: int | None, user_id: int | None, source_id: int | None = None, source_reference: str | None = None,
    batch_number: str | None = None, vendor_name: str | None = None, grn_item_id: int | None = None,
    ncr_id: int | None = None, receive_into_quality: bool = False, stock_already_in_quality: bool = False,
    assigned_to_id: int | None = None, remarks: str | None = None, lot_date: date | None = None,
    take_from_free: bool = False, unit_cost: float | None = None,
    order_project_id: int | None = None, order_project_element_id: int | None = None,
) -> QualityInspectionLot:
    """receive_into_quality: post a quality_in receipt now (material arriving
    from outside — GRN, production output). stock_already_in_quality: the
    caller already moved the stock into QUALITY (NCR rework → re-inspection)."""
    if quantity <= 0:
        raise LotError("Lot quantity must be greater than zero.", 422)
    # Phase 3: the approved vendor list decides the sampling state (normal /
    # tightened / reduced) and skip-lot for a vendor's incoming / job work lot.
    vendor_severity, skip_lot = (None, False)
    if source_type != "ncr":
        from app.modules.quality.services.supplier_quality import lot_sampling
        vendor_severity, skip_lot = lot_sampling(db, item, vendor_name, user_id, inspection_type)
    lot = QualityInspectionLot(
        lot_number=generate_lot_number(db), inspection_type=inspection_type, status="created",
        source_type=source_type, source_id=source_id, source_reference=source_reference, grn_item_id=grn_item_id,
        ncr_id=ncr_id, item_id=item.id, item_code=item.item_code, item_name=item.item_name, uom=item.uom,
        quantity=quantity, batch_number=batch_number, vendor_name=vendor_name, location_id=location_id,
        stock_in_quality=bool(location_id) and (receive_into_quality or stock_already_in_quality or take_from_free),
        sampling_severity=vendor_severity or get_setting(db, "default_sampling_severity"), skip_lot=skip_lot,
        test_certificate_required=bool(item.test_certificate_required) and (
            inspection_type == "incoming" or (inspection_type == "first_article" and source_type == "grn")),
        assigned_to_id=assigned_to_id, created_by_id=user_id, lot_date=lot_date or date.today(), remarks=remarks,
        order_project_id=order_project_id, order_project_element_id=order_project_element_id,
    )
    db.add(lot)
    db.flush()
    if receive_into_quality and location_id:
        _stock(db, lot, "quality_in", quantity, user_id,
               f"{QUALITY_INSPECTION_TYPE_LABELS.get(inspection_type, inspection_type)} — held in Quality stock for lot {lot.lot_number}"
               + (f" ({source_reference})" if source_reference else ""), unit_cost=unit_cost)
    elif take_from_free and location_id:
        _stock(db, lot, "quality_hold", quantity, user_id, f"Moved from Free to Quality stock for re-inspection lot {lot.lot_number}")
    attach_plan(db, lot)
    _notify_new_lot(db, lot, user_id)
    return lot


def create_lot_for_grn_line(db: Session, grn, line, item: StoreItem, vendor_name: str | None, user_id: int,
                            unit_cost: float | None = None, quantity: float | None = None, batch_number: str | None = None,
                            tc_reference: str | None = None) -> QualityInspectionLot:
    """quantity / batch_number: a batch-managed line gets one lot per heat
    (Store batches); tc_reference pre-fills the lot's certificate number."""
    if not grn.store_location_id:
        raise LotError(
            f"'{item.item_name}' needs incoming inspection, so it must be received into a store's Quality stock — "
            "pick the receiving store on the GRN.", 422)
    from app.modules.quality.services import first_article
    lot_type, fai = first_article.start_for_receipt(
        db, item=item, vendor_name=vendor_name, base_type="incoming", source_type="grn",
        source_reference=grn.grn_number, user_id=user_id)
    lot = create_lot(
        db, inspection_type=lot_type, source_type="grn", item=item, quantity=quantity if quantity is not None else line.received_quantity,
        location_id=grn.store_location_id, user_id=user_id, source_id=grn.id, source_reference=grn.grn_number, batch_number=batch_number,
        vendor_name=vendor_name, grn_item_id=line.id, receive_into_quality=True, lot_date=grn.received_date, unit_cost=unit_cost,
        remarks=f"First article {fai.fai_number} — full drawing check" if fai else None,
    )
    if tc_reference and not lot.test_certificate_reference:
        lot.test_certificate_reference = tc_reference[:150]
    first_article.link_lot(fai, lot)
    return lot


def create_lot_for_production_output(db: Session, *, work_order, item: StoreItem, quantity: float, location_id: int,
                                     batch_number: str | None, user_id: int, unit_cost: float | None = None) -> QualityInspectionLot:
    """`unit_cost`: the work order's actual cost per unit (GR at actual cost,
    production/costing.py) — the quality_in receipt is valued at it."""
    from app.modules.quality.services import first_article
    lot_type, fai = first_article.start_for_receipt(
        db, item=item, vendor_name=None, base_type="final", source_type="work_order",
        source_reference=work_order.wo_number, user_id=user_id)
    lot = create_lot(
        db, inspection_type=lot_type, source_type="work_order", item=item, quantity=quantity, location_id=location_id,
        user_id=user_id, source_id=work_order.id, source_reference=work_order.wo_number, batch_number=batch_number,
        receive_into_quality=True, remarks=f"First article {fai.fai_number} — full drawing check" if fai else None,
        unit_cost=unit_cost, **order_project_link_of(work_order),
    )
    first_article.link_lot(fai, lot)
    return lot


def needs_job_work_inspection(db: Session, item: StoreItem | None) -> bool:
    """Job work receipt: the item is inspection-controlled, or has an approved
    job work plan."""
    if not item:
        return False
    return bool(item.inspection_on_receipt) or current_plan(db, item.id, "job_work") is not None


def create_lot_for_job_work_receipt(db: Session, *, material_return, line, item: StoreItem, vendor_name: str | None,
                                    issue_number: str | None, user_id: int | None,
                                    from_vendor_stock: bool = False) -> QualityInspectionLot:
    """Store: material coming back from a job-work vendor (a material return
    against an issue made to an outside vendor). The quantity goes to QUALITY
    stock under a job work lot instead of straight back to Free.
    from_vendor_stock: the challan posted it to With-vendor stock (Store job
    work), so it moves With vendor → Quality (value-neutral) instead of being
    received afresh."""
    from app.modules.quality.services import first_article
    lot_type, fai = first_article.start_for_receipt(
        db, item=item, vendor_name=vendor_name, base_type="job_work", source_type="material_return",
        source_reference=material_return.return_number, user_id=user_id)
    lot = create_lot(
        db, inspection_type=lot_type, source_type="material_return", item=item, quantity=line.quantity,
        location_id=material_return.location_id, user_id=user_id, source_id=material_return.id,
        source_reference=material_return.return_number + (f" (job work {issue_number})" if issue_number else ""),
        batch_number=line.batch_number, vendor_name=vendor_name, receive_into_quality=not from_vendor_stock,
        stock_already_in_quality=from_vendor_stock, lot_date=material_return.return_date,
        remarks=f"First article {fai.fai_number} — full drawing check" if fai else None,
    )
    if from_vendor_stock and lot.location_id:
        _stock(db, lot, "jobwork_to_quality", line.quantity, user_id,
               f"Back from job work {issue_number or ''} — held in Quality stock for lot {lot.lot_number} ({material_return.return_number})")
    first_article.link_lot(fai, lot)
    return lot


# ---------------------------------------------------------------------------
# Workflow
# ---------------------------------------------------------------------------

def _require_status(lot: QualityInspectionLot, allowed: tuple[str, ...], action: str) -> None:
    if lot.status not in allowed:
        raise LotError(
            f"Lot {lot.lot_number} is {lot.status.replace('_', ' ')}, so you can't {action}. "
            + ("Closed and decided lots are never edited — raise an NCR or a re-inspection lot to correct it."
               if lot.status in ("decision_made", "closed") else ""))


def refresh_plan(db: Session, lot: QualityInspectionLot) -> QualityInspectionLot:
    _require_status(lot, ("created",), "re-attach its plan")
    if not attach_plan(db, lot):
        raise LotError(f"There's still no approved {QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type)} plan for "
                       f"{lot.item_code or ''} {lot.item_name}. Approve one in Quality → Inspection Plans first.")
    return lot


def set_sampling_severity(db: Session, lot: QualityInspectionLot, severity: str) -> QualityInspectionLot:
    _require_status(lot, ("created",), "change its sampling state")
    if severity not in ("normal", "tightened", "reduced"):
        raise LotError("Sampling state must be normal, tightened or reduced.", 422)
    lot.sampling_severity = severity
    if lot.plan_id:
        attach_plan(db, lot)
    return lot


def assign(db: Session, lot: QualityInspectionLot, user_id: int, actor: User) -> QualityInspectionLot:
    _require_status(lot, ("created", "in_inspection"), "reassign it")
    target = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not target or "quality" not in target.get_apps():
        raise LotError("Pick an active user who has access to the Quality module.", 422)
    lot.assigned_to_id = user_id
    if user_id != actor.id:
        notify_user(db, user_id=user_id, title="Inspection Lot Assigned",
                    message=f"{actor.name or actor.email} assigned lot {lot.lot_number} ({lot.item_name}, {lot.quantity:g} {lot.uom or ''}) to you.",
                    notification_type="quality_lot_assigned", entity_type="quality_inspection_lot", entity_id=lot.id)
    return lot


def start(db: Session, lot: QualityInspectionLot, user: User) -> QualityInspectionLot:
    _require_status(lot, ("created",), "start it")
    if not lot.plan_id and not attach_plan(db, lot):
        raise LotError(
            f"Lot {lot.lot_number} has no approved inspection plan (rule 2: every inspection uses an approved current plan). "
            f"Create and approve a {QUALITY_INSPECTION_TYPE_LABELS.get(lot.inspection_type)} plan for {lot.item_name} "
            "in Quality → Inspection Plans, then start again.")
    lot.status = "in_inspection"
    lot.started_at = _now()
    if not lot.assigned_to_id:
        lot.assigned_to_id = user.id
    return lot


def _evaluate(res: QualityLotResult) -> tuple[int, str]:
    if res.char_type == "variable":
        values = [float(v) for v in (res.measured_values or [])]
        out = sum(1 for v in values if (res.min_value is not None and v < res.min_value) or (res.max_value is not None and v > res.max_value))
        bad = out + (res.defects_found or 0)
    else:
        bad = res.defects_found or 0
    return bad, ("pass" if bad <= res.accept_number else "fail")


def record_results(db: Session, lot: QualityInspectionLot, entries: list[dict], user: User) -> QualityInspectionLot:
    if lot.status == "created":
        start(db, lot, user)
    _require_status(lot, ("in_inspection",), "record results")
    by_id = {r.id: r for r in lot.results}
    for e in entries:
        res = by_id.get(e["result_id"])
        if not res:
            raise LotError(f"Result row #{e['result_id']} doesn't belong to lot {lot.lot_number}.", 422)
        name = f"'{res.characteristic_name}'"
        values = e.get("measured_values")
        defects = e.get("defects_found")
        if res.char_type == "variable":
            if not values:
                raise LotError(f"{name} is measured — enter at least one measured value.", 422)
            if len(values) > res.sample_size:
                raise LotError(f"{name}: {len(values)} values entered but the sample is only {res.sample_size}.", 422)
            res.measured_values = [float(v) for v in values]
        elif defects is None:
            raise LotError(f"{name} is a pass/fail check — enter the number of defective units found (0 if none).", 422)
        if defects is not None:
            if defects < 0 or defects > res.sample_size:
                raise LotError(f"{name}: defective units must be between 0 and the sample size {res.sample_size}.", 422)
        res.defects_found = defects
        if e.get("gauge_id") is not None:
            # QM-IM: only an active, in-calibration instrument may be used.
            from app.modules.quality.services.gauges import GaugeError, check_usable
            try:
                gauge = check_usable(db, e["gauge_id"])
            except GaugeError as ge:
                raise LotError(f"{name}: {ge}", 422)
            res.gauge_id = gauge.id
            if not (e.get("gauge_reference") or "").strip():
                e = {**e, "gauge_reference": gauge.code}
        res.gauge_reference = (e.get("gauge_reference") or "").strip() or None
        res.remarks = (e.get("remarks") or "").strip() or None
        bad, verdict = _evaluate(res)
        res.result = verdict
        code_id = e.get("defect_code_id")
        if verdict == "fail":
            if not code_id:
                raise LotError(f"{name} failed ({bad} nonconforming, accept number {res.accept_number}) — pick the defect code.", 422)
            code = db.query(QualityDefectCode).filter(QualityDefectCode.id == code_id).first()
            if not code or not code.is_active:
                raise LotError(f"{name}: defect code #{code_id} isn't an active defect code.", 422)
        res.defect_code_id = code_id if verdict == "fail" else None
        res.recorded_by_id = user.id
        res.recorded_at = _now()
    db.flush()
    return lot


def submit_results(db: Session, lot: QualityInspectionLot, user: User) -> QualityInspectionLot:
    _require_status(lot, ("in_inspection",), "submit its results")
    missing = [r.characteristic_name for r in lot.results if not r.result]
    if missing:
        raise LotError(f"Record a result for every characteristic first — missing: {', '.join(missing)}.", 422)
    lot.status = "results_recorded"
    lot.results_recorded_by_id = user.id
    lot.results_recorded_at = _now()
    failed = sum(1 for r in lot.results if r.result == "fail")
    role_events.fire(db, "lot_waiting_decision", record=lot, entity_type="quality_inspection_lot", actor=user,
                     title=f"Usage decision needed: {lot.lot_number}",
                     message=f"{user.name or user.email} submitted the results of lot {lot.lot_number} ({lot.quantity:g} {lot.uom or ''} "
                             f"of {lot.item_name}): {failed} characteristic(s) failed. Record the usage decision on the lot.")
    return lot


def set_test_certificate(db: Session, lot: QualityInspectionLot, received: bool, reference: str | None) -> QualityInspectionLot:
    _require_status(lot, ("created", "in_inspection", "results_recorded"), "change its test certificate")
    if received and not (reference or "").strip():
        raise LotError("Enter the test certificate / MTC number (or heat number) to mark it received.", 422)
    lot.test_certificate_received = received
    lot.test_certificate_reference = (reference or "").strip() or None
    return lot


def _recorders(lot: QualityInspectionLot) -> set[int]:
    ids = {r.recorded_by_id for r in lot.results if r.recorded_by_id}
    if lot.results_recorded_by_id:
        ids.add(lot.results_recorded_by_id)
    return ids


def worst_failed_class(lot: QualityInspectionLot) -> str | None:
    failed = [r.classification for r in lot.results if r.result == "fail"]
    return max(failed, key=lambda c: _CLASS_RANK.get(c, 0)) if failed else None


def decide(db: Session, lot: QualityInspectionLot, *, decision: str, user: User, accepted_qty: float | None = None,
           rejected_qty: float | None = None, deviation_reference: str | None = None, remarks: str | None = None):
    """Usage decision. Posts stock QUALITY→FREE / QUALITY→BLOCKED, writes the
    split back to the source document, and raises the NCR (rule 5)."""
    from app.modules.quality.services import ncr as ncr_service

    _require_status(lot, ("results_recorded",), "make a usage decision")
    if decision not in QUALITY_LOT_DECISIONS:
        raise LotError(f"Decision must be one of: {', '.join(QUALITY_LOT_DECISION_LABELS.values())}.", 422)
    if not access.can_decide_lot(user):
        raise LotError("Only a Quality engineer or Quality head can make a usage decision — ask an admin to apply the role "
                       "in Quality → Settings → Quality roles.", 403)
    failed = [r for r in lot.results if r.result == "fail"]
    critical_failed = [r for r in failed if r.classification == "critical"]
    qty = lot.quantity

    if decision == "accept":
        if failed:
            raise LotError(f"{len(failed)} characteristic(s) failed ({', '.join(r.characteristic_name for r in failed)}) — "
                           "a lot with failures can't be plainly accepted. Choose Accept with deviation or Reject.")
        accepted, rejected = qty, 0.0
    elif decision == "accept_with_deviation":
        if not failed:
            raise LotError("Nothing failed, so there's nothing to deviate from — choose Accept.")
        if critical_failed:
            raise LotError(f"Critical characteristic(s) {', '.join(r.characteristic_name for r in critical_failed)} failed. "
                           "Rule 4: a lot can never be accepted with a failed critical characteristic — reject it; the NCR goes to Design / customer.")
        if not (deviation_reference or "").strip():
            raise LotError("Accept with deviation needs the Design / customer concession reference (deviation number).", 422)
        if not access.is_quality_head(user):
            raise LotError("Accept with deviation is a 'use as is' decision — only a Quality head can make it.", 403)
        if user.id in _recorders(lot):
            raise LotError("You recorded this lot's results, so you can't also approve accepting it with a deviation — "
                           "another Quality head must decide (segregation of duties).", 403)
        accepted, rejected = qty, 0.0
    elif decision == "reject":
        accepted, rejected = 0.0, qty
    else:  # partial
        if accepted_qty is None or rejected_qty is None:
            raise LotError("Partial rejection needs both the accepted and the rejected quantity.", 422)
        if accepted_qty <= 0 or rejected_qty <= 0:
            raise LotError("Partial rejection needs an accepted and a rejected quantity above zero — otherwise choose Accept or Reject.", 422)
        if abs(accepted_qty + rejected_qty - qty) > 1e-9:
            raise LotError(f"Accepted ({accepted_qty:g}) + rejected ({rejected_qty:g}) must equal the lot quantity {qty:g}.", 422)
        accepted, rejected = accepted_qty, rejected_qty

    if accepted > 0:
        from app.modules.quality.services.first_article import ensure_released, FaiError
        try:
            ensure_released(db, lot)
        except FaiError as e:
            raise LotError(str(e), e.status)

    if accepted > 0 and lot.inspection_type in ("incoming", "job_work", "first_article") and lot.source_type != "ncr":
        from app.modules.quality.services.supplier_quality import blocked_problem
        problem = blocked_problem(db, lot.item_id, lot.vendor_name)
        if problem:
            raise LotError(problem)

    if accepted > 0 and lot.test_certificate_required and not lot.test_certificate_received:
        raise LotError(f"{lot.item_name} needs a test certificate / MTC before it can be accepted. Mark the certificate "
                       "received (with its number) on this lot, or reject the lot.")

    if lot.stock_in_quality and lot.location_id:
        if accepted > 0:
            _stock(db, lot, "quality_release", accepted, user.id, f"Lot {lot.lot_number} accepted — released to Free stock")
        if rejected > 0:
            _stock(db, lot, "quality_block", rejected, user.id, f"Lot {lot.lot_number} rejected — moved to Blocked stock")

    lot.decision = decision
    lot.accepted_qty = accepted
    lot.rejected_qty = rejected
    lot.deviation_reference = (deviation_reference or "").strip() or None
    lot.decision_remarks = (remarks or "").strip() or None
    lot.decided_by_id = user.id
    lot.decided_at = _now()
    lot.status = "decision_made"
    db.flush()

    if lot.grn_item_id:
        from app.modules.p2p.routes.goods_receipts import apply_quality_decision
        apply_quality_decision(db, grn_item_id=lot.grn_item_id, accepted=accepted, rejected=rejected, user_id=user.id,
                               reason=f"Inspection lot {lot.lot_number}: {QUALITY_LOT_DECISION_LABELS[decision]}"
                                      + (f" — {lot.decision_remarks}" if lot.decision_remarks else ""))

    ncrs = []
    if rejected > 0:
        ncrs.append(ncr_service.raise_from_lot(db, lot, quantity=rejected, user=user, deviation=False))
    if decision == "accept_with_deviation":
        ncrs.append(ncr_service.raise_from_lot(db, lot, quantity=accepted, user=user, deviation=True))
    if lot.ncr_id:
        ncr_service.on_reinspection_decided(db, lot)
    from app.modules.quality.services.supplier_quality import on_lot_decided
    on_lot_decided(db, lot)
    if lot.source_type == "work_order_operation":
        from app.modules.quality.services.production_gates import on_gate_lot_decided
        on_gate_lot_decided(db, lot, ncrs, user)
    if lot.inspection_type == "first_article":
        from app.modules.quality.models.first_article import QualityFirstArticle
        fai = db.query(QualityFirstArticle).filter(QualityFirstArticle.lot_id == lot.id, QualityFirstArticle.status == "open").first()
        if fai is not None:
            role_events.fire(db, "fai_decision_waiting", record=fai, entity_type="quality_first_article", actor=user,
                             title=f"First article waiting for a decision: {fai.fai_number}",
                             message=f"Lot {lot.lot_number} of {fai.item_name}{' from ' + fai.vendor_name if fai.vendor_name else ''} "
                                     f"has its usage decision. Approve or reject {fai.fai_number} to release the item for regular supply.")
    return lot, ncrs


def close(db: Session, lot: QualityInspectionLot, user: User) -> QualityInspectionLot:
    _require_status(lot, ("decision_made",), "close it")
    lot.status = "closed"
    lot.closed_by_id = user.id
    lot.closed_at = _now()
    return lot


def cancel(db: Session, lot: QualityInspectionLot, user: User, reason: str) -> QualityInspectionLot:
    _require_status(lot, ("created", "in_inspection"), "cancel it")
    if lot.source_type != "manual" or lot.stock_in_quality:
        raise LotError("Only a manual lot with no stock behind it can be cancelled. A lot holding Quality stock must get a "
                       "usage decision (reject it if the material shouldn't be used).")
    if not (reason or "").strip():
        raise LotError("Give a reason for cancelling the lot.", 422)
    lot.status = "cancelled"
    lot.remarks = ((lot.remarks or "") + f"\nCancelled by {user.name or user.email}: {reason.strip()}").strip()
    return lot


def lot_age_days(lot: QualityInspectionLot, today: date | None = None) -> int:
    return ((today or date.today()) - lot.lot_date).days


def ceil_qty(q: float) -> int:
    return int(math.ceil(q))
