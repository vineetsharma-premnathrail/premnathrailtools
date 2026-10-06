"""NCR workflow: raise (auto from a lot decision, or manual) → propose a
disposition → approvals by the required authorities → execute (stock
effect + linked document) → verify → close with cost of non-quality.

Hooks for later phases / other modules:
  raise_from_lot(db, lot, quantity, user, deviation) -> ncr
  on_return_to_vendor(db, ncr, user) — P2P has no vendor-return / debit-note
      document yet; this hook is where one gets created. Today it only
      records the RTV reference typed on the NCR.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.masters import QualityDispositionCode, QualityDefectCode, QUALITY_DISPOSITION_TYPE_LABELS
from app.modules.quality.models.ncr import (
    QualityNcr, QualityNcrApproval, QUALITY_NCR_SEVERITIES, QUALITY_NCR_APPROVAL_ROLE_LABELS,
)
from app.modules.quality.services import access
from app.modules.quality.services.settings import get_setting, active_master_values
from app.modules.quality.service import generate_ncr_number
from app.modules.store.models.item import StoreItem
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.utils.notifications import notify_user

NCR_REFERENCE_TYPE = "ncr"
_LOT_TYPE_TO_SOURCE = {
    "incoming": "incoming", "job_work": "job_work", "in_process": "in_process", "final": "final",
    "first_article": "in_process", "third_party": "customer_inspection", "sales_return": "complaint",
    "stock_reinspection": "internal",
}
_CLASS_RANK = {"minor": 1, "major": 2, "critical": 3}


class NcrError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _name(u: User) -> str:
    return u.name or u.email


def _stock(db: Session, ncr: QualityNcr, txn_type: str, user_id: int, remarks: str) -> None:
    try:
        post_stock_transaction(
            db, item_id=ncr.item_id, location_id=ncr.location_id, transaction_type=txn_type, quantity=ncr.quantity,
            batch_number=ncr.batch_number, reference_type=NCR_REFERENCE_TYPE, reference_number=ncr.ncr_number,
            remarks=remarks, created_by_id=user_id,
        )
    except ValueError as e:
        raise NcrError(f"Stock couldn't be moved for {ncr.ncr_number}: {e}")


def _estimated_value(db: Session, item_id: int | None, qty: float | None) -> float | None:
    if not item_id or not qty:
        return None
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    rate = (item.moving_average_cost or item.standard_cost) if item else None
    return round(rate * qty, 2) if rate else None


def _alert_new(db: Session, ncr: QualityNcr, actor_id: int | None) -> None:
    msg = f"{ncr.ncr_number} ({ncr.severity.title()}): {ncr.quantity or 0:g} {ncr.uom or ''} of {ncr.item_name} — {ncr.description[:120]}"
    recipients = {u.id: u for u in access.quality_engineers(db)}
    teams = False
    if ncr.severity == "critical":
        # Critical NCR → Quality head + Partners, needs their attention now.
        for u in access.quality_heads(db) + access.partners(db):
            recipients[u.id] = u
        teams = True
    for uid in recipients:
        if uid != actor_id:
            notify_user(db, user_id=uid, title="Critical NCR — Action Needed" if teams else "NCR Raised", message=msg,
                        notification_type="quality_ncr_critical" if teams else "quality_ncr_raised",
                        entity_type="quality_ncr", entity_id=ncr.id, teams=teams)


def raise_from_lot(db: Session, lot: QualityInspectionLot, *, quantity: float, user: User, deviation: bool) -> QualityNcr:
    failed = [r for r in lot.results if r.result == "fail"]
    worst = max((r.classification for r in failed), key=lambda c: _CLASS_RANK.get(c, 0), default="minor")
    lines = [f"{r.characteristic_name}: {r.defects_found or 0} defective"
             + (f", measured {', '.join(f'{v:g}' for v in (r.measured_values or []))}" if r.measured_values else "")
             + (f" (limits {r.min_value if r.min_value is not None else '–'} … {r.max_value if r.max_value is not None else '–'})"
                if r.char_type == "variable" else "")
             for r in failed]
    if deviation:
        description = f"Lot {lot.lot_number} accepted with deviation {lot.deviation_reference}. Failed: " + "; ".join(lines)
    else:
        description = f"Lot {lot.lot_number} rejected {quantity:g} of {lot.quantity:g}." + (
            " Failed: " + "; ".join(lines) if lines else "") + (f" {lot.decision_remarks}" if lot.decision_remarks else "")
    ncr = QualityNcr(
        ncr_number=generate_ncr_number(db), source=_LOT_TYPE_TO_SOURCE.get(lot.inspection_type, "internal"),
        severity=worst, status="open", auto_raised=True, lot_id=lot.id, source_reference=lot.source_reference or lot.lot_number,
        item_id=lot.item_id, item_name=lot.item_name, item_code=lot.item_code, quantity=quantity, uom=lot.uom,
        batch_number=lot.batch_number, vendor_name=lot.vendor_name, location_id=lot.location_id,
        stock_blocked=bool(lot.stock_in_quality and lot.location_id and not deviation),
        defect_code_id=next((r.defect_code_id for r in failed if r.defect_code_id), None),
        description=description, raised_by_id=user.id, ncr_date=date.today(),
        estimated_value=_estimated_value(db, lot.item_id, quantity),
    )
    db.add(ncr)
    db.flush()
    if deviation:
        # The deviation was approved at the usage decision by a Quality head
        # (not the result recorder) against the Design / customer concession:
        # record it as an approved, executed "use as is" disposition.
        code = db.query(QualityDispositionCode).filter(
            QualityDispositionCode.disposition_type == "use_as_is", QualityDispositionCode.is_active.is_(True)).first()
        ncr.disposition_code_id = code.id if code else None
        ncr.disposition_type = "use_as_is"
        ncr.disposition_status = "approved"
        ncr.disposition_remarks = f"Accepted with deviation at lot usage decision. Concession: {lot.deviation_reference}"
        ncr.customer_approval_reference = lot.deviation_reference
        ncr.disposition_proposed_by_id = user.id
        ncr.disposition_proposed_at = ncr.disposition_decided_at = _now()
        ncr.approvals.append(QualityNcrApproval(role="quality_head", decision="approved", disposition_type="use_as_is",
                                                approved_by_id=user.id, remarks=f"Deviation {lot.deviation_reference}"))
        ncr.action_reference = lot.deviation_reference
        ncr.action_done_by_id = user.id
        ncr.action_done_at = _now()
        ncr.status = "action_done"
    db.flush()
    _alert_new(db, ncr, user.id)
    return ncr


def create_manual(db: Session, data: dict, user: User) -> QualityNcr:
    sources = active_master_values(db, "ncr_sources")
    if data["source"] not in sources:
        raise NcrError(f"Source '{data['source']}' isn't an active NCR source — pick one of: {', '.join(sources)}.", 422)
    if data.get("severity", "minor") not in QUALITY_NCR_SEVERITIES:
        raise NcrError("Severity must be minor, major or critical.", 422)
    item = None
    if data.get("item_id"):
        item = db.query(StoreItem).filter(StoreItem.id == data["item_id"]).first()
        if not item:
            raise NcrError(f"Item #{data['item_id']} isn't in the Item Master.", 404)
    elif not (data.get("item_name") or "").strip():
        raise NcrError("Pick the item (or type its name for a non-stock item).", 422)
    if data.get("defect_code_id"):
        code = db.query(QualityDefectCode).filter(QualityDefectCode.id == data["defect_code_id"]).first()
        if not code or not code.is_active:
            raise NcrError("Pick an active defect code.", 422)
    qty = data.get("quantity")
    if qty is not None and qty <= 0:
        raise NcrError("Quantity must be greater than zero.", 422)
    block = bool(data.get("block_stock"))
    if block and not (item and data.get("location_id") and qty):
        raise NcrError("To block stock, pick the item, the store and the quantity.", 422)
    ncr = QualityNcr(
        ncr_number=generate_ncr_number(db), source=data["source"], severity=data.get("severity") or "minor",
        status="open", auto_raised=False, source_reference=data.get("source_reference"),
        item_id=item.id if item else None, item_name=item.item_name if item else data["item_name"].strip(),
        item_code=item.item_code if item else data.get("item_code"), quantity=qty, uom=item.uom if item else data.get("uom"),
        batch_number=data.get("batch_number"), vendor_name=data.get("vendor_name"),
        location_id=data.get("location_id") if block else None, stock_blocked=block,
        defect_code_id=data.get("defect_code_id"), description=data["description"].strip(),
        root_cause=data.get("root_cause"), raised_by_id=user.id, ncr_date=data.get("ncr_date") or date.today(),
        remarks=data.get("remarks"), estimated_value=_estimated_value(db, item.id if item else None, qty),
    )
    if not ncr.description:
        raise NcrError("Describe the non-conformance.", 422)
    db.add(ncr)
    db.flush()
    if block:
        # Material found non-conforming in FREE stock is moved to BLOCKED.
        _stock(db, ncr, "free_block", user.id, f"{ncr.ncr_number} raised — moved from Free to Blocked stock")
    _alert_new(db, ncr, user.id)
    return ncr


# ---------------------------------------------------------------------------
# Disposition + approvals
# ---------------------------------------------------------------------------

def required_roles(db: Session, ncr: QualityNcr) -> list[str]:
    t = ncr.disposition_type
    roles = {
        "use_as_is": ["quality_head", "design"],
        "rework": ["quality_engineer"],
        "repair": ["quality_head", "design"],
        "return_to_vendor": ["quality_engineer", "purchase"],
        "scrap": ["quality_head"],
    }.get(t, [])
    if t == "scrap":
        limit = float(get_setting(db, "scrap_value_limit"))
        if (ncr.estimated_value or 0) > limit:
            roles = roles + ["partner"]
    return list(roles)


def _role_holder(user: User, role: str) -> bool:
    return {
        "quality_engineer": access.is_quality_engineer,
        "quality_head": access.is_quality_head,
        "design": access.is_design_authority,
        "purchase": access.is_purchase_authority,
        "partner": access.is_partner,
    }[role](user)


def _lot_recorders(db: Session, ncr: QualityNcr) -> set[int]:
    if not ncr.lot_id:
        return set()
    lot = db.query(QualityInspectionLot).filter(QualityInspectionLot.id == ncr.lot_id).first()
    if not lot:
        return set()
    ids = {r.recorded_by_id for r in lot.results if r.recorded_by_id}
    if lot.results_recorded_by_id:
        ids.add(lot.results_recorded_by_id)
    return ids


def active_approvals(ncr: QualityNcr) -> list[QualityNcrApproval]:
    return [a for a in ncr.approvals if not a.superseded]


def pending_roles(db: Session, ncr: QualityNcr) -> list[str]:
    done = {a.role for a in active_approvals(ncr) if a.decision == "approved"}
    return [r for r in required_roles(db, ncr) if r not in done]


def _require(ncr: QualityNcr, statuses: tuple[str, ...], action: str) -> None:
    if ncr.status not in statuses:
        raise NcrError(f"{ncr.ncr_number} is {ncr.status.replace('_', ' ')}, so you can't {action}."
                       + (" Closed NCRs are never edited." if ncr.status == "closed" else ""))


def _notify_approvers(db: Session, ncr: QualityNcr, actor: User) -> None:
    from app.modules.main.models.user import User as U
    pending = pending_roles(db, ncr)
    if not pending:
        return
    label = QUALITY_DISPOSITION_TYPE_LABELS.get(ncr.disposition_type, ncr.disposition_type)
    users: dict[int, str] = {}
    for role in pending:
        if role == "quality_head":
            cands = access.quality_heads(db)
        elif role == "quality_engineer":
            cands = access.quality_engineers(db)
        elif role == "partner":
            cands = access.partners(db)
        else:
            cands = [u for u in db.query(U).filter(U.is_active.is_(True)).all() if _role_holder(u, role) and u.role != "admin"]
        for u in cands:
            users.setdefault(u.id, QUALITY_NCR_APPROVAL_ROLE_LABELS[role])
    for uid, role_label in users.items():
        if uid == actor.id:
            continue
        notify_user(db, user_id=uid, title="NCR Disposition Approval Needed",
                    message=f"{ncr.ncr_number} ({ncr.severity}): '{label}' proposed by {_name(actor)} for "
                            f"{ncr.quantity or 0:g} {ncr.uom or ''} {ncr.item_name} — your approval as {role_label} is needed.",
                    notification_type="quality_ncr_approval_needed", entity_type="quality_ncr", entity_id=ncr.id, teams=True)


def propose_disposition(db: Session, ncr: QualityNcr, *, disposition_code_id: int, remarks: str | None,
                        customer_approval_required: bool, customer_approval_reference: str | None, user: User) -> QualityNcr:
    _require(ncr, ("open",), "propose a disposition")
    if not access.is_quality_engineer(user):
        raise NcrError("Only a Quality engineer or head can propose an NCR disposition.", 403)
    code = db.query(QualityDispositionCode).filter(QualityDispositionCode.id == disposition_code_id).first()
    if not code or not code.is_active:
        raise NcrError("Pick an active disposition code (Quality → Masters → Disposition codes).", 422)
    if code.disposition_type in ("use_as_is", "repair", "return_to_vendor", "scrap", "rework") and not ncr.quantity:
        raise NcrError(f"Enter the NCR quantity before proposing '{code.name}'.", 422)
    if code.disposition_type == "return_to_vendor" and not ncr.vendor_name:
        raise NcrError("Return to vendor needs the vendor on the NCR — this NCR has no vendor.", 422)
    for a in active_approvals(ncr):
        a.superseded = True
    ncr.disposition_code_id = code.id
    ncr.disposition_type = code.disposition_type
    ncr.disposition_remarks = (remarks or "").strip() or None
    ncr.customer_approval_required = bool(customer_approval_required)
    ncr.customer_approval_reference = (customer_approval_reference or "").strip() or None
    ncr.disposition_proposed_by_id = user.id
    ncr.disposition_proposed_at = _now()
    ncr.disposition_status = "pending_approval"
    ncr.estimated_value = _estimated_value(db, ncr.item_id, ncr.quantity) or ncr.estimated_value
    db.flush()
    _notify_approvers(db, ncr, user)
    return ncr


def approve_disposition(db: Session, ncr: QualityNcr, *, role: str, approve: bool, remarks: str | None, user: User) -> QualityNcr:
    _require(ncr, ("open",), "approve its disposition")
    if ncr.disposition_status != "pending_approval":
        raise NcrError(f"{ncr.ncr_number} has no disposition waiting for approval.")
    needed = pending_roles(db, ncr)
    if role not in needed:
        raise NcrError(f"'{QUALITY_NCR_APPROVAL_ROLE_LABELS.get(role, role)}' approval isn't pending on {ncr.ncr_number} "
                       f"(pending: {', '.join(QUALITY_NCR_APPROVAL_ROLE_LABELS[r] for r in needed) or 'none'}).", 422)
    if not _role_holder(user, role):
        raise NcrError(f"You can't approve as {QUALITY_NCR_APPROVAL_ROLE_LABELS[role]} — "
                       + ("Partner approval is limited to Partners (Company Info → Partners)." if role == "partner"
                          else "ask an admin for that authority."), 403)
    if role in ("quality_engineer", "quality_head") and ncr.severity in ("major", "critical") and user.id in _lot_recorders(db, ncr):
        raise NcrError(f"You recorded the inspection results behind this {ncr.severity} NCR, so you can't approve its "
                       "disposition — another Quality engineer/head must (segregation of duties).", 403)
    if any(a.approved_by_id == user.id for a in active_approvals(ncr) if a.decision == "approved"):
        raise NcrError("You've already signed this disposition in another role — a second person must give this approval.", 403)
    if not approve and not (remarks or "").strip():
        raise NcrError("Give a reason when rejecting a disposition.", 422)
    ncr.approvals.append(QualityNcrApproval(role=role, decision="approved" if approve else "rejected",
                                            disposition_type=ncr.disposition_type, approved_by_id=user.id,
                                            remarks=(remarks or "").strip() or None))
    db.flush()
    proposer = ncr.disposition_proposed_by_id
    label = QUALITY_DISPOSITION_TYPE_LABELS.get(ncr.disposition_type)
    if not approve:
        for a in active_approvals(ncr):
            a.superseded = True
        ncr.disposition_status = "none"
        if proposer:
            notify_user(db, user_id=proposer, title="NCR Disposition Rejected",
                        message=f"{_name(user)} rejected '{label}' on {ncr.ncr_number}: {remarks}. Propose a new disposition.",
                        notification_type="quality_ncr_disposition_rejected", entity_type="quality_ncr", entity_id=ncr.id)
        return ncr
    if not pending_roles(db, ncr):
        if ncr.customer_approval_required and ncr.disposition_type in ("use_as_is", "repair") and not ncr.customer_approval_reference:
            raise NcrError("The contract needs customer approval for this disposition — record the customer's approval "
                           "reference on the NCR (re-propose with it) before the last sign-off.", 422)
        ncr.disposition_status = "approved"
        ncr.disposition_decided_at = _now()
        ncr.status = "disposition_decided"
        if proposer:
            notify_user(db, user_id=proposer, title="NCR Disposition Approved",
                        message=f"'{label}' on {ncr.ncr_number} is fully approved — carry it out and record the action.",
                        notification_type="quality_ncr_disposition_approved", entity_type="quality_ncr", entity_id=ncr.id)
    return ncr


def on_return_to_vendor(db: Session, ncr: QualityNcr, user: User) -> None:
    """Hook: create the P2P vendor return / debit note here once P2P has one.
    Today the RTV / debit note number typed on the NCR is the record."""
    return None


def execute_action(db: Session, ncr: QualityNcr, *, action_reference: str, remarks: str | None, user: User) -> QualityNcr:
    from app.modules.quality.services.lots import create_lot

    _require(ncr, ("disposition_decided",), "record the disposition action")
    if not access.is_quality_engineer(user):
        raise NcrError("Only a Quality engineer or head can record the disposition action.", 403)
    t = ncr.disposition_type
    ref = (action_reference or "").strip()
    if not ref:
        hint = {"return_to_vendor": "RTV / debit note number", "scrap": "scrap note number",
                "rework": "rework order number", "repair": "repair order / deviation number",
                "use_as_is": "concession / release note number"}.get(t, "document number")
        raise NcrError(f"Enter the {hint} for this action.", 422)
    has_stock = ncr.stock_blocked and ncr.location_id and ncr.item_id and ncr.quantity
    if t == "use_as_is" and has_stock:
        _stock(db, ncr, "blocked_release", user.id, f"{ncr.ncr_number} use as is ({ref}) — released to Free stock")
    elif t in ("rework", "repair"):
        if has_stock:
            _stock(db, ncr, "blocked_to_quality", user.id, f"{ncr.ncr_number} {t} done ({ref}) — back to Quality for re-inspection")
        item = db.query(StoreItem).filter(StoreItem.id == ncr.item_id).first() if ncr.item_id else None
        if item and ncr.quantity:
            src_lot = db.query(QualityInspectionLot).filter(QualityInspectionLot.id == ncr.lot_id).first() if ncr.lot_id else None
            lot = create_lot(
                db, inspection_type=src_lot.inspection_type if src_lot else "stock_reinspection", source_type="ncr",
                item=item, quantity=ncr.quantity, location_id=ncr.location_id if has_stock else None, user_id=user.id,
                source_id=ncr.id, source_reference=ncr.ncr_number, batch_number=ncr.batch_number,
                vendor_name=ncr.vendor_name, ncr_id=ncr.id, stock_already_in_quality=bool(has_stock),
                remarks=f"Re-inspection after {t} ({ref})",
            )
            ncr.reinspection_lot_id = lot.id
    elif t in ("return_to_vendor", "scrap") and has_stock:
        _stock(db, ncr, "quarantine_out", user.id,
               f"{ncr.ncr_number} {'returned to vendor' if t == 'return_to_vendor' else 'scrapped'} ({ref})")
    if t == "return_to_vendor":
        on_return_to_vendor(db, ncr, user)
    ncr.stock_blocked = False if has_stock else ncr.stock_blocked
    ncr.action_reference = ref
    ncr.action_remarks = (remarks or "").strip() or None
    ncr.action_done_by_id = user.id
    ncr.action_done_at = _now()
    ncr.status = "action_done"
    db.flush()
    return ncr


def on_reinspection_decided(db: Session, lot: QualityInspectionLot) -> None:
    """A re-inspection lot got its decision — nothing to post (the lot did
    the stock moves); the NCR can now be verified."""
    return None


def verify(db: Session, ncr: QualityNcr, *, remarks: str | None, user: User) -> QualityNcr:
    _require(ncr, ("action_done",), "verify it")
    if not access.is_quality_engineer(user):
        raise NcrError("Only a Quality engineer or head can verify an NCR.", 403)
    if ncr.reinspection_lot_id:
        lot = db.query(QualityInspectionLot).filter(QualityInspectionLot.id == ncr.reinspection_lot_id).first()
        if lot and lot.status not in ("decision_made", "closed"):
            raise NcrError(f"Re-inspection lot {lot.lot_number} has no usage decision yet — the {ncr.disposition_type} "
                           "can only be verified once the reworked material has been re-inspected.")
    ncr.verified_by_id = user.id
    ncr.verified_at = _now()
    ncr.verification_remarks = (remarks or "").strip() or None
    ncr.status = "verified"
    return ncr


def close(db: Session, ncr: QualityNcr, *, material_cost: float | None, rework_cost: float | None,
          other_cost: float | None, root_cause: str | None, user: User) -> QualityNcr:
    _require(ncr, ("verified",), "close it")
    if not access.is_quality_head(user):
        raise NcrError("Only a Quality head can close an NCR.", 403)
    for label, v in (("Material cost", material_cost), ("Rework cost", rework_cost), ("Other cost", other_cost)):
        if v is not None and v < 0:
            raise NcrError(f"{label} can't be negative.", 422)
    if ncr.severity in ("major", "critical"):
        capa = db.query(QualityCapa).filter(QualityCapa.ncr_id == ncr.id, QualityCapa.is_deleted == False).first()  # noqa: E712
        if not capa:
            raise NcrError(f"{ncr.ncr_number} is {ncr.severity}: rule 6 needs a CAPA raised against it before closure. "
                           "Raise one in Quality → CAPA and link this NCR.")
    if root_cause is not None and root_cause.strip():
        ncr.root_cause = root_cause.strip()
    ncr.material_cost = material_cost
    ncr.rework_cost = rework_cost
    ncr.other_cost = other_cost
    ncr.status = "closed"
    ncr.closed_by_id = user.id
    ncr.closed_at = _now()
    return ncr


def cancel(db: Session, ncr: QualityNcr, *, reason: str, user: User) -> QualityNcr:
    _require(ncr, ("open",), "cancel it")
    if not access.is_quality_head(user):
        raise NcrError("Only a Quality head can cancel an NCR.", 403)
    if ncr.stock_blocked:
        raise NcrError(f"{ncr.ncr_number} holds {ncr.quantity:g} in Blocked stock — it needs a disposition (e.g. use as is) "
                       "instead of a cancellation, so the stock is accounted for.")
    if ncr.auto_raised:
        raise NcrError("This NCR was raised by an inspection lot decision (rule 5: every rejected quantity has an NCR) — it can't be cancelled.")
    if not (reason or "").strip():
        raise NcrError("Give a reason for cancelling the NCR.", 422)
    ncr.status = "cancelled"
    ncr.remarks = ((ncr.remarks or "") + f"\nCancelled by {_name(user)}: {reason.strip()}").strip()
    return ncr


def cost_of_non_quality(ncr: QualityNcr) -> float:
    return round((ncr.material_cost or 0) + (ncr.rework_cost or 0) + (ncr.other_cost or 0), 2)
