"""CRM side of the CRM → Sales handoff (Sales plan §6.1).

When Sales confirms a sales order raised from an inquiry or a tender, Sales
calls ``mark_won`` in the same transaction. It closes the source record as
ordered, using the status / stage values the CRM screens already offer:

* inquiry → status ``"Closed - Ordered"`` (ASCII hyphen), stage ``"Order Received"``
* tender  → status ``"Closed – Ordered"`` (en dash), stage ``"Awarded / Lost"``

and writes a timeline (CrmStageLog) and audit entry naming the SO. It never
commits — the caller owns the transaction — and never raises for a missing or
deleted source, so a CRM clean-up can't block a sales confirmation.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.tender import Tender
from app.modules.main.models.audit_log import AuditLog

# Must match INQ_STATUSES / INQ_STAGES in crm/routes/inquiries.py and
# TND_STATUSES / TND_STAGES in crm/routes/tenders.py (note the different dashes).
INQUIRY_WON_STATUS = "Closed - Ordered"
INQUIRY_WON_STAGE = "Order Received"
TENDER_WON_STATUS = "Closed – Ordered"
TENDER_WON_STAGE = "Awarded / Lost"


def mark_won(db: Session, so, actor) -> str | None:
    """Close the SO's source inquiry / tender as ordered.

    ``so`` is a SalesOrder (needs ``source_inquiry_id`` / ``source_tender_id``
    and a number); ``actor`` is the confirming User. Returns ``"inquiry"`` /
    ``"tender"`` when a record was updated, ``None`` otherwise (no source,
    source deleted, or already closed as ordered).
    """
    number = getattr(so, "so_number", None) or getattr(so, "display_number", None) or f"#{so.id}"
    actor_id = getattr(actor, "id", None)
    actor_name = (getattr(actor, "name", None) or getattr(actor, "email", None)) if actor else None
    now = datetime.now(timezone.utc)

    if so.source_inquiry_id:
        module, model, status, stage = "inquiry", Inquiry, INQUIRY_WON_STATUS, INQUIRY_WON_STAGE
        record_id = so.source_inquiry_id
    elif so.source_tender_id:
        module, model, status, stage = "tender", Tender, TENDER_WON_STATUS, TENDER_WON_STAGE
        record_id = so.source_tender_id
    else:
        return None

    record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
    if not record:
        return None
    if record.status == status and record.current_stage == stage:
        return None

    old_status, old_stage = record.status, record.current_stage
    record.status = status
    record.current_stage = stage
    if hasattr(record, "closed_at") and not record.closed_at:
        record.closed_at = now  # win / loss report (crm/routes/opportunity.py)
    note = f"Sales Order {number} confirmed — moved to {stage}, status {status}."
    db.add(CrmStageLog(
        related_module=module, related_id=record.id, universal_id=record.universal_id, stage="Sales Order confirmed",
        entered_by_id=actor_id, entered_by_name=actor_name, notes=note, created_at=now,
    ))
    db.add(AuditLog(
        entity_type=module, entity_id=record.id, action="sales_order_confirmed", performed_by_id=actor_id,
        field_name="status", old_value=old_status, new_value=status,
        summary=f"{note} (was {old_status} / {old_stage})",
    ))
    return module
