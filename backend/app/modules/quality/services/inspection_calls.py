"""Customer / third-party inspection calls (RITES, RDSO, customer, other).

requested → scheduled → accepted | partially_accepted | rejected (+ cancelled).
A recorded result is never edited (rule 10) — a re-offer is a new call.
The quantity the agency rejected gets an NCR (rule 5, source
customer_inspection); when the offered batch is in a store's Free stock the
NCR blocks it there.

Reminder: the daily Quality job reminds quality engineers (Teams + bell)
`inspection_call_reminder_days` before a scheduled call date.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.quality.models.inspection_call import QualityInspectionCall, QUALITY_CALL_OPEN_STATUSES
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.services import access
from app.modules.quality.services.settings import active_master_values
from app.modules.store.models.item import StoreItem
from app.utils.notifications import notify_user


class CallError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_open(call: QualityInspectionCall, action: str) -> None:
    if call.status not in QUALITY_CALL_OPEN_STATUSES:
        raise CallError(f"Inspection call {call.call_number} is already {call.status.replace('_', ' ')}, so you can't {action}. "
                        "A recorded result is never changed — raise a new call to re-offer material.")


def _validate_agency(db: Session, agency: str) -> None:
    agencies = active_master_values(db, "inspection_agencies")
    if agency not in agencies:
        raise CallError(f"'{agency}' isn't an active inspection agency — pick one of: {', '.join(agencies)} "
                        "(Quality → Settings → master lists).", 422)


def create(db: Session, data: dict, user: User) -> QualityInspectionCall:
    from app.modules.quality.service import generate_call_number
    item = db.query(StoreItem).filter(StoreItem.id == data["item_id"]).first()
    if not item:
        raise CallError(f"Item #{data['item_id']} isn't in the Item Master.", 404)
    if data["quantity"] <= 0:
        raise CallError("Offered quantity must be greater than zero.", 422)
    # Order Project (the build) — its Sales Order decides the agency. A lot
    # already linked to an element carries its link onto the call.
    from app.modules.quality.services import order_project_inspection as opi
    lot_link = None
    if data.get("lot_id") and not data.get("order_project_element_id"):
        lot_link = db.query(QualityInspectionLot).filter(QualityInspectionLot.id == data["lot_id"]).first()
        if lot_link is not None and lot_link.order_project_element_id:
            data["order_project_element_id"] = lot_link.order_project_element_id
            data["order_project_id"] = data.get("order_project_id") or lot_link.order_project_id
    try:
        op_project, op_element = opi.resolve_link(db, data.get("order_project_id"), data.get("order_project_element_id"))
        if op_project is not None:
            opi.apply_to_call(db, data, op_project, op_element)
    except opi.LinkError as e:
        raise CallError(str(e), e.status)
    project = None
    if data.get("erp_project_id"):
        from app.modules.erp.models.project import Project
        project = db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first()  # noqa: E712
        if not project:
            raise CallError(f"ERP machine / order #{data['erp_project_id']} not found.", 404)
    elif not (data.get("order_reference") or "").strip():
        raise CallError("Pick the Order Project (vehicle / lot) or the ERP machine / order this inspection is for, or type the "
                        "customer order reference.", 422)
    agency = data.get("agency") or (project.inspection_agency if project else None)
    if not agency:
        raise CallError("Pick the inspecting agency (RITES / RDSO / Customer / Other).", 422)
    _validate_agency(db, agency)
    lot = None
    if data.get("lot_id"):
        lot = db.query(QualityInspectionLot).filter(QualityInspectionLot.id == data["lot_id"]).first()
        if not lot or lot.item_id != item.id:
            raise CallError("The linked final inspection lot must be a lot of the same item.", 422)
        if op_element is not None and lot.order_project_element_id and lot.order_project_element_id != op_element.id:
            raise CallError(f"Lot {lot.lot_number} was inspected for another vehicle / lot of the order project — pick the "
                            "element the lot belongs to, or a lot of this element.", 422)
        if lot.decision not in ("accept", "accept_with_deviation", "partial"):
            raise CallError(f"Lot {lot.lot_number} hasn't been accepted by our own final inspection — offer material to the "
                            "agency only after it passes internally.", 409)
        # Offer only what passed internally: the lot's accepted quantity less
        # what is already offered (open calls) or cleared on it. Material an
        # agency rejected can be re-offered after rework.
        offered = 0.0
        for c in db.query(QualityInspectionCall).filter(QualityInspectionCall.lot_id == lot.id).all():
            if c.status in QUALITY_CALL_OPEN_STATUSES or c.status == "accepted":
                offered += c.quantity or 0.0
            elif c.status == "partially_accepted":
                offered += c.accepted_qty or 0.0
        left = round((lot.accepted_qty or 0.0) - offered, 6)
        if data["quantity"] > left + 1e-9:
            raise CallError(f"Lot {lot.lot_number} passed {lot.accepted_qty or 0:g} {item.uom or ''} internally and {offered:g} of it "
                            f"is already offered or cleared on other calls — at most {max(left, 0):g} can be offered, "
                            f"not {data['quantity']:g}.", 422)
    call = QualityInspectionCall(
        call_number=generate_call_number(db), status="scheduled" if data.get("call_date") else "requested",
        erp_project_id=project.id if project else None,
        order_project_id=op_project.id if op_project else None, order_project_element_id=op_element.id if op_element else None,
        order_reference=(data.get("order_reference") or "").strip() or (project.po_number if project else None),
        customer_name=(data.get("customer_name") or "").strip() or (project.client_company if project else None),
        item_id=item.id, item_code=item.item_code, item_name=item.item_name, uom=item.uom, quantity=data["quantity"],
        batch_number=(data.get("batch_number") or "").strip() or (lot.batch_number if lot else None),
        lot_id=lot.id if lot else None, agency=agency, requested_date=data.get("requested_date") or date.today(),
        call_date=data.get("call_date"), inspector_name=(data.get("inspector_name") or "").strip() or None,
        remarks=(data.get("remarks") or "").strip() or None, created_by_id=user.id,
    )
    if call.call_date and call.call_date < call.requested_date:
        raise CallError("The call (inspection) date can't be before the date the call was raised.", 422)
    db.add(call)
    db.flush()
    return call


def schedule(db: Session, call: QualityInspectionCall, *, call_date: date, inspector_name: str | None,
             remarks: str | None) -> QualityInspectionCall:
    _require_open(call, "reschedule it")
    if call_date < call.requested_date:
        raise CallError("The inspection date can't be before the date the call was raised.", 422)
    call.call_date = call_date
    call.inspector_name = (inspector_name or "").strip() or call.inspector_name
    if remarks and remarks.strip():
        call.remarks = ((call.remarks or "") + f"\n{remarks.strip()}").strip()
    call.status = "scheduled"
    return call


def record_result(db: Session, call: QualityInspectionCall, *, result: str, accepted_qty: float | None,
                  rejected_qty: float | None, certificate_number: str | None, result_date: date | None,
                  inspector_name: str | None, remarks: str | None, location_id: int | None,
                  severity: str, user: User) -> QualityInspectionCall:
    from app.modules.quality.services import ncr as ncr_service
    _require_open(call, "record a result")
    if not access.can_record_call_result(user):
        raise CallError("Only a Quality engineer or head records a third-party inspection result (it releases dispatch) — "
                        "ask an admin to apply the role in Quality → Settings → Quality roles.", 403)
    if not call.call_date and not result_date:
        raise CallError("Enter the date the agency inspected the material.", 422)
    q = call.quantity
    if result == "accepted":
        acc, rej = q, 0.0
    elif result == "rejected":
        acc, rej = 0.0, q
    elif result == "partially_accepted":
        if accepted_qty is None or rejected_qty is None or accepted_qty <= 0 or rejected_qty <= 0:
            raise CallError("Partial acceptance needs an accepted and a rejected quantity above zero.", 422)
        if abs(accepted_qty + rejected_qty - q) > 1e-9:
            raise CallError(f"Accepted ({accepted_qty:g}) + rejected ({rejected_qty:g}) must equal the offered {q:g}.", 422)
        acc, rej = accepted_qty, rejected_qty
    else:
        raise CallError("Result must be accepted, partially accepted or rejected.", 422)
    cert = (certificate_number or "").strip() or None
    if acc > 0 and not cert:
        raise CallError("Enter the inspection certificate / release note number the agency issued — dispatch is released "
                        "against it (rule 8).", 422)
    if rej > 0 and not (remarks or "").strip():
        raise CallError("Describe why the agency rejected the material — it becomes the NCR description.", 422)
    call.status = result
    call.accepted_qty = acc
    call.rejected_qty = rej
    call.certificate_number = cert
    call.result_date = result_date or call.call_date
    call.inspector_name = (inspector_name or "").strip() or call.inspector_name
    call.result_remarks = (remarks or "").strip() or None
    call.result_recorded_by_id = user.id
    call.result_recorded_at = _now()
    db.flush()
    if acc > 0:
        # Sales billing plan: the order's 'inspection' milestone falls due (VF04) —
        # via the Order Project's Sales Order, or the ERP machine for old calls.
        from app.modules.quality.services.order_project_inspection import trigger_inspection_milestone
        trigger_inspection_milestone(db, call)
    if rej > 0:
        block = bool(location_id)
        ncr = ncr_service.create_manual(db, {
            "source": "customer_inspection", "severity": severity, "item_id": call.item_id, "quantity": rej,
            "batch_number": call.batch_number, "location_id": location_id, "block_stock": block,
            "source_reference": f"{call.call_number} ({call.agency.upper()})",
            "description": f"{call.agency.upper()} inspection call {call.call_number}"
                           + (f" for order {call.order_reference}" if call.order_reference else "")
                           + f" rejected {rej:g} of {q:g}. {call.result_remarks}",
        }, user)
        ncr.auto_raised = True
        call.ncr_id = ncr.id
    return call


def cancel(db: Session, call: QualityInspectionCall, *, reason: str, user: User) -> QualityInspectionCall:
    _require_open(call, "cancel it")
    if not (reason or "").strip():
        raise CallError("Give the reason for cancelling the inspection call.", 422)
    call.status = "cancelled"
    call.remarks = ((call.remarks or "") + f"\nCancelled by {user.name or user.email}: {reason.strip()}").strip()
    return call


def due_for_reminder(db: Session, days: int, today: date | None = None) -> list[QualityInspectionCall]:
    from datetime import timedelta
    today = today or date.today()
    return db.query(QualityInspectionCall).filter(
        QualityInspectionCall.status == "scheduled", QualityInspectionCall.call_date.isnot(None),
        QualityInspectionCall.call_date >= today, QualityInspectionCall.call_date <= today + timedelta(days=days),
    ).all()


def notify_scheduled(db: Session, call: QualityInspectionCall, actor: User) -> None:
    """Bell-only notice that a call was raised / scheduled (the Teams
    reminder comes from the daily job when the date is near)."""
    for u in access.quality_engineers(db):
        if u.id != actor.id:
            notify_user(db, user_id=u.id, title="Inspection Call Scheduled" if call.call_date else "Inspection Call Raised",
                        message=f"{call.call_number}: {call.agency.upper()} inspection of {call.quantity:g} {call.uom or ''} "
                                f"{call.item_name}" + (f" on {call.call_date:%d-%m-%Y}" if call.call_date else "")
                                + (f" for order {call.order_reference}" if call.order_reference else "") + ".",
                        notification_type="quality_inspection_call", entity_type="quality_inspection_call", entity_id=call.id)
