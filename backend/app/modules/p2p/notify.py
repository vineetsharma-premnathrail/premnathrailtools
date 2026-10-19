"""Procurement role events (core/events/p2p.py) — the notify_event calls,
kept in one place so every trigger (routes, approval-engine callbacks, the
daily overdue job) words and scopes them the same way.

Direct notices stay where they are: the approval engine tells the approvers
(fixed in Procurement › Settings / Approval Workflows) and the requester, and
the routes tell the assigned buyer. Those people are passed in
skip_user_ids so nobody hears the same thing twice. Never raises."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder

PR_ENTITY = "p2p_request"
PO_ENTITY = "p2p_purchase_order"


def pr_opener(db: Session, pr: P2PRequest):
    """can_open: the user's Procurement data scope covers the requisition
    (approvers always pass — p2p/access.py)."""
    def _can(user: User) -> bool:
        from app.modules.p2p.access import ensure_pr_in_scope
        try:
            ensure_pr_in_scope(db, user, pr)
            return True
        except Exception:
            return False
    return _can


def po_opener(db: Session, po: P2PPurchaseOrder):
    def _can(user: User) -> bool:
        from app.core.data_scope import ensure_in_scope
        try:
            ensure_in_scope(db, user, po)
            return True
        except Exception:
            return False
    return _can


def _who(user: User | None) -> str:
    return (user.name or user.email) if user else "someone"


def _pending_ids(req) -> set[int]:
    """Approvers of the request's current stage — the engine notified them."""
    if req is None or getattr(req, "status", None) != "pending":
        return set()
    return {s.approver_id for s in req.steps
            if s.sequence == req.current_sequence and s.status == "pending" and s.approver_id}


def _pr_label(pr: P2PRequest) -> str:
    return pr.p2p_number + (f" ({pr.project_label})" if pr.project_label else "")


# ── Requisitions ─────────────────────────────────────────────────────────────

def pr_submitted(db: Session, background_tasks, pr: P2PRequest, actor: User, req) -> None:
    if req is None or req.status != "pending":
        return  # approved at once (no stage applied) — pr_decided covers it
    notify_event(
        db, background_tasks, "p2p", "pr_submitted",
        title=f"Purchase requisition {pr.p2p_number} waiting for approval",
        message=f"{_who(actor)} submitted purchase requisition {_pr_label(pr)} — {len(pr.items or [])} line(s), "
                f"department {pr.department or '—'}. It is with its approvers now (Procurement › Approvals).",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
        skip_user_ids=_pending_ids(req) | ({pr.requested_by_id} - {None}),
    )


def pr_decided(db: Session, background_tasks, pr: P2PRequest, actor: User, outcome: str, comment: str | None = None) -> None:
    verb = {"approved": "got its final approval", "rejected": "was rejected", "returned": "was returned for changes",
            "withdrawn": "was withdrawn from approval"}.get(outcome, outcome)
    nxt = {"approved": " Purchase now checks stock and buys what's needed.",
           "returned": " The requester can change and resubmit it."}.get(outcome, "")
    note = f" Comment: {comment}" if comment else ""
    notify_event(
        db, background_tasks, "p2p", "pr_decided",
        title=f"Purchase requisition {pr.p2p_number} {outcome}",
        message=f"Purchase requisition {_pr_label(pr)} {verb} ({_who(actor)}).{note}{nxt}",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
        skip_user_ids={pr.requested_by_id} - {None},
    )


def pr_to_procurement(db: Session, background_tasks, pr: P2PRequest, actor: User | None, lines: list) -> None:
    if not lines:
        return
    names = ", ".join(f"{i.item_name} × {i.quantity:g}" for i in lines[:5]) + (" …" if len(lines) > 5 else "")
    notify_event(
        db, background_tasks, "p2p", "pr_to_procurement",
        title=f"{pr.p2p_number}: {len(lines)} line(s) to buy",
        message=f"Purchase requisition {_pr_label(pr)} has {len(lines)} line(s) to procure: {names}. "
                f"Buyer: {_buyer_name(db, pr)}. Raise the RFQ from the requisition.",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
        skip_user_ids={pr.assigned_buyer_id} - {None},
    )


def _buyer_name(db: Session, pr: P2PRequest) -> str:
    u = db.get(User, pr.assigned_buyer_id) if pr.assigned_buyer_id else None
    return _who(u) if u else "not assigned yet"


def buyer_assigned(db: Session, background_tasks, pr: P2PRequest, actor: User) -> None:
    notify_event(
        db, background_tasks, "p2p", "buyer_assigned",
        title=f"Buyer assigned to {pr.p2p_number}",
        message=f"{_who(actor)} assigned {_buyer_name(db, pr)} as the buyer of purchase requisition {_pr_label(pr)}.",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
        skip_user_ids={pr.assigned_buyer_id} - {None},
    )


# ── RFQ ──────────────────────────────────────────────────────────────────────

def rfq_evaluation_waiting(db: Session, background_tasks, rfq, pr: P2PRequest, actor: User, stage: str) -> None:
    notify_event(
        db, background_tasks, "p2p", "rfq_evaluation_waiting",
        title=f"RFQ {rfq.rfq_number}: {stage} evaluation waiting",
        message=f"{_who(actor)} moved RFQ {rfq.rfq_number} ({_pr_label(pr)}) to {stage} evaluation — "
                f"{len(rfq.vendor_quotations or [])} vendor quotation(s) to qualify or disqualify.",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
    )


def vendor_quote_received(db: Session, background_tasks, rfq, pr: P2PRequest, actor: User, vendor_name: str) -> None:
    notify_event(
        db, background_tasks, "p2p", "vendor_quote_received",
        title=f"Quotation from {vendor_name} on {rfq.rfq_number}",
        message=f"{_who(actor)} recorded {vendor_name}'s quotation on RFQ {rfq.rfq_number} ({_pr_label(pr)}).",
        entity_type=PR_ENTITY, entity_id=pr.id, actor=actor, can_open=pr_opener(db, pr),
    )


# ── Purchase orders ──────────────────────────────────────────────────────────

def po_submitted(db: Session, background_tasks, pr: P2PRequest, po: P2PPurchaseOrder, actor: User, req) -> None:
    if req is None or req.status != "pending":
        return
    notify_event(
        db, background_tasks, "p2p", "po_submitted",
        title=f"Purchase order {po.po_number} waiting for approval",
        message=f"{_who(actor)} sent PO {po.po_number} to {po.vendor_name or 'the vendor'} ({_pr_label(pr)}) for approval. "
                "It is with its approvers now (Procurement › PO Approval).",
        entity_type=PO_ENTITY, entity_id=po.id, actor=actor, can_open=po_opener(db, po),
        skip_user_ids=_pending_ids(req),
    )


def po_decided(db: Session, background_tasks, pr: P2PRequest, po: P2PPurchaseOrder, actor: User, outcome: str,
               comment: str | None, submitter_id: int | None) -> None:
    verb = {"approved": "got its final approval — it can go to the vendor", "rejected": "was rejected",
            "returned": "was returned for changes", "withdrawn": "was withdrawn from approval"}.get(outcome, outcome)
    note = f" Comment: {comment}" if comment else ""
    notify_event(
        db, background_tasks, "p2p", "po_decided",
        title=f"Purchase order {po.po_number} {outcome}",
        message=f"PO {po.po_number} to {po.vendor_name or 'the vendor'} ({_pr_label(pr)}) {verb} ({_who(actor)}).{note}",
        entity_type=PO_ENTITY, entity_id=po.id, actor=actor, can_open=po_opener(db, po),
        skip_user_ids={submitter_id, pr.requested_by_id} - {None},
    )


def po_amendment_submitted(db: Session, background_tasks, po: P2PPurchaseOrder, am, actor: User, req) -> None:
    if req is None or req.status != "pending":
        return
    notify_event(
        db, background_tasks, "p2p", "po_amendment_submitted",
        title=f"PO {po.po_number}: amendment {am.amendment_no} waiting for approval",
        message=f"{_who(actor)} amended PO {po.po_number} ({po.vendor_name or 'vendor'}). "
                + (f"Reason: {am.reason}. " if getattr(am, "reason", None) else "") + "It is with the PO approvers now.",
        entity_type=PO_ENTITY, entity_id=po.id, actor=actor, can_open=po_opener(db, po),
        skip_user_ids=_pending_ids(req),
    )


def service_entry_waiting(db: Session, background_tasks, po: P2PPurchaseOrder, entry, actor: User) -> None:
    notify_event(
        db, background_tasks, "p2p", "service_entry_waiting",
        title=f"Service entry {entry.ses_number} waiting for acceptance",
        message=f"{_who(actor)} recorded service entry {entry.ses_number} on PO {po.po_number} ({po.vendor_name or 'vendor'}). "
                "Accept it once the service is confirmed.",
        entity_type=PO_ENTITY, entity_id=po.id, actor=actor, can_open=po_opener(db, po),
    )


def po_delivery_overdue(db: Session, po: P2PPurchaseOrder, days_overdue: int, buyer_id: int | None) -> None:
    """From the daily job (no background tasks → bell / Teams only). Sent
    once per PO — the assigned buyer keeps their own daily reminder."""
    from app.modules.main.models.notification import Notification
    if db.query(Notification.id).filter(Notification.entity_type == PO_ENTITY, Notification.entity_id == po.id,
                                        Notification.notification_type == "p2p_ev_po_delivery_overdue").first():
        return
    day_word = "day" if days_overdue == 1 else "days"
    notify_event(
        db, None, "p2p", "po_delivery_overdue",
        title=f"PO {po.po_number} delivery overdue",
        message=f"PO {po.po_number} ({po.vendor_name or 'vendor not set'}) was due {po.expected_delivery.isoformat()} — "
                f"{days_overdue} {day_word} overdue with goods still to come. Follow up with the vendor.",
        entity_type=PO_ENTITY, entity_id=po.id, can_open=po_opener(db, po),
        skip_user_ids={buyer_id} - {None},
    )
