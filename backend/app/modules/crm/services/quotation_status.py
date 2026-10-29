"""Quotation document status and release (SAP VA21-VA23 + release strategy).

    draft ──submit──▶ submitted ──(central approval engine)──▶ approved ──send──▶ sent
      ▲                   │ reject / return / withdraw               │
      └───────────────────┘                                          ├─ accept ─▶ accepted
                                                                     ├─ lost   ─▶ lost (reason required)
                                                                     └─ valid_until passed ─▶ expired (daily job)

* `status` is the truth; `customer_response` is kept as its display mirror
  ("Accepted" / "Rejected" / "Negotiating" / "Expired" / "— Awaiting —").
  The Sales order prefill takes the quotation whose status is `accepted` —
  never a substring of free text.
* Any content revision (prices, lines, terms, validity …) returns the
  quotation to draft: the revised offer needs approval again. A pending
  approval is withdrawn first.
* Approval: transaction type `crm.quotation` on the central engine
  (Organization › Approval Workflows). The release limits live in Sales ›
  Settings › Quotation approval (value incl. GST and header discount %); they
  decide an `approval_rank` 0-3 and each stage applies from its rank:
  Sales Head (1) → Director (2) → Partner (3, top approver). Rank 0 = no
  approval needed (approved at once). Approvers need 'approve' on CRM ›
  Inquiries & Tenders, and the creator / submitter never approves.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.notification_events import notify_event
from app.core.permission_registry import can_feature
from app.modules.crm.models.inquiry import Inquiry, Quotation
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction

QUOTATION_STATUSES = ("draft", "submitted", "approved", "sent", "accepted", "lost", "expired")
STATUS_LABEL = {"draft": "Draft", "submitted": "Awaiting approval", "approved": "Approved", "sent": "Sent to customer",
                "accepted": "Accepted", "lost": "Lost", "expired": "Expired"}
# Statuses with the customer — a revision of these is a new offer (back to draft).
OPEN_WITH_CUSTOMER = ("approved", "sent")
CLOSED = ("accepted", "lost", "expired")

APPROVAL_KEY = "crm.quotation"
APPROVAL_ENTITY = "crm_quotation"
AWAITING = "— Awaiting —"
RESPONSE_FOR = {"accepted": "Accepted", "lost": "Rejected", "expired": "Expired"}
RANK_LABEL = {0: "no approval", 1: "Sales Head", 2: "Director", 3: "Partner"}

CONTEXT_FIELDS = {
    "approval_rank": {"label": "Approval level from Sales › Settings › Quotation approval (1 Sales Head, 2 Director, 3 Partner)",
                      "type": "number"},
    "discount_percent": {"label": "Header discount (%)", "type": "number"},
    "sales_head_ids": {"label": "Sales Head (Sales › Settings, else the Sales / BD department head)", "type": "user"},
    "director_ids": {"label": "Directors with CRM quotation approval rights", "type": "user"},
    "partner_ids": {"label": "Partners with CRM quotation approval rights", "type": "user"},
}


def default_stages() -> list[StageDef]:
    return [
        StageDef("Sales Head", "record_field", {"field": "sales_head_ids"},
                 conditions=[{"field": "approval_rank", "op": "gte", "value": 1}]),
        StageDef("Director", "record_field", {"field": "director_ids"},
                 conditions=[{"field": "approval_rank", "op": "gte", "value": 2}]),
        StageDef("Partner", "record_field", {"field": "partner_ids"},
                 conditions=[{"field": "approval_rank", "op": "gte", "value": 3}]),
    ]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _name(u: User | None) -> str:
    return (u.name or u.email) if u else "system"


def _audit(db: Session, quot: Quotation, user: User | None, action: str, summary: str, old: str | None = None, new: str | None = None) -> None:
    db.add(AuditLog(entity_type="quotation", entity_id=quot.id, action=action, module_key="crm", subtab_key="inquiries_tenders",
                    field_name="status", old_value=old, new_value=new, summary=summary,
                    performed_by_id=user.id if user else None))


def _set_status(db: Session, quot: Quotation, status: str, user: User | None, summary: str, comment: str | None = None) -> None:
    old = quot.status
    quot.status = status
    if status in RESPONSE_FOR:
        quot.customer_response = RESPONSE_FOR[status]
    elif status != "sent" or quot.customer_response in RESPONSE_FOR.values():
        quot.customer_response = AWAITING
    if comment is not None:
        quot.status_comment = comment
    _audit(db, quot, user, f"status_{status}", summary, old, status)


# ---------------------------------------------------------------- amounts / rank

def quotation_amounts(quot: Quotation) -> dict:
    """gross (incl. GST, before the header discount), discount %, net value."""
    if (quot.pricing_mode or "itemwise") == "lumpsum":
        price = float(quot.price or 0)
        gst = 0 if quot.quotation_type == "Export" else float(quot.lump_sum_gst_percent or 0)
        gross = round(price * (1 + gst / 100), 2)
        return {"gross": gross, "discount_percent": 0.0, "net": gross}
    gross = round(sum(float(it.total or 0) for it in quot.items), 2)
    disc = float(quot.discount or 0)
    if disc <= 0 or gross <= 0:
        pct = 0.0
    elif (quot.discount_type or "percent") == "percent":
        pct = min(disc, 100.0)
    else:
        pct = min(disc / gross * 100, 100.0)
    net = round(gross * (1 - pct / 100), 2)
    return {"gross": gross, "discount_percent": round(pct, 3), "net": net}


SWITCHED_OFF = "approval is switched off in Organization › Approval Workflows › CRM quotation"


def approval_rank(db: Session, quot: Quotation) -> tuple[int, list[str]]:
    from app.modules.sales.settings import get_setting
    # The workflow's "Approval required" switch overrides the value / discount
    # limits: off = no approver is needed or checked for, approved on submit.
    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == APPROVAL_KEY).first()
    if wf is not None and not wf.is_active:
        return 0, [SWITCHED_OFF]
    amt = quotation_amounts(quot)
    value, pct = amt["net"], amt["discount_percent"]
    auto = float(get_setting(db, "quotation_auto_approve_value") or 0)
    d_val = float(get_setting(db, "quotation_director_value") or 0)
    p_val = float(get_setting(db, "quotation_partner_value") or 0)
    d_pct = float(get_setting(db, "quotation_director_discount_percent") or 0)
    p_pct = float(get_setting(db, "quotation_partner_discount_percent") or 0)
    why: list[str] = []
    rank = 0 if (value <= auto and auto > 0 and pct <= 0) else 1
    if p_val and value > p_val:
        rank = 3
        why.append(f"value ₹{value:,.0f} above the Partner limit ₹{p_val:,.0f}")
    elif d_val and value > d_val:
        rank = max(rank, 2)
        why.append(f"value ₹{value:,.0f} above the Director limit ₹{d_val:,.0f}")
    if pct > p_pct:
        rank = 3
        why.append(f"discount {pct:g}% above {p_pct:g}%")
    elif pct > d_pct:
        rank = max(rank, 2)
        why.append(f"discount {pct:g}% above {d_pct:g}%")
    return rank, why


def _approvers(db: Session, level: str, makers: set[int]) -> list[int]:
    from app.modules.sales import service as sales_svc
    if level == "sales_head":
        ids = sales_svc.sales_head_ids(db)
        users = db.query(User).filter(User.id.in_(ids), User.is_active == True).all() if ids else []  # noqa: E712
    else:
        flag = User.is_director if level == "director" else User.is_partner
        users = db.query(User).filter(flag == True, User.is_active == True).all()  # noqa: E712
    return [u.id for u in users if u.id not in makers and can_feature(u, "crm", "inquiries_tenders", "quotations", "approve")]


_HINT = {
    "sales_head_ids": ("No Sales Head can approve this quotation — set one in Sales › Settings › Sales Head (or mark the Sales / BD "
                       "department head), and give them 'Approve' on CRM › Inquiries & Tenders › Quotations. The creator / submitter can't approve."),
    "director_ids": ("No Director other than the creator / submitter holds 'Approve' on CRM › Inquiries & Tenders › Quotations — grant it in "
                     "Organization › Role & Permissions, or raise the Director limits in Sales › Settings › Quotation approval."),
    "partner_ids": ("No Partner other than the creator / submitter holds 'Approve' on CRM › Inquiries & Tenders › Quotations — mark the Partner in "
                    "Organization › Info › Partners and grant that permission."),
}


# ---------------------------------------------------------------- role events (core/events/crm.py)

def _event(db: Session, event: str, quot: Quotation, title: str, message: str, actor: User | None,
           skip: set[int] | None = None, background_tasks=None) -> set[int]:
    """A quotation role event; members must be able to open its inquiry (CRM data scope)."""
    from app.modules.crm.access import can_open_record
    inquiry = db.get(Inquiry, quot.inquiry_id)
    if inquiry is None:
        return set()
    org = inquiry.organization.name if inquiry.organization else "the customer"
    amt = quotation_amounts(quot)
    return notify_event(
        db, background_tasks, "crm", event, title=title, message=message,
        entity_type=APPROVAL_ENTITY, entity_id=quot.id, actor=actor, can_open=can_open_record(db, inquiry),
        details=[("Quotation", quot.quot_number or f"#{quot.id}"), ("Inquiry", inquiry.universal_id or ""),
                 ("Customer", org), ("Net value", f"₹{amt['net']:,.0f}")],
        skip_user_ids=skip,
    )


# ---------------------------------------------------------------- engine callback

def _decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    quot = db.get(Quotation, req.entity_id)
    if quot is None:
        return
    if outcome == "approved":
        if quot.status != "submitted":
            raise HTTPException(status_code=409, detail=f"Quotation {quot.quot_number} is {STATUS_LABEL.get(quot.status, quot.status)}, "
                                                        f"not awaiting approval — reload the inquiry.")
        quot.approved_at, quot.approved_by_id = now_utc(), actor.id
        _set_status(db, quot, "approved", actor, f"Quotation {quot.quot_number} approved by {_name(actor)} — ready to send.", comment=None)
        # The requester already gets the engine's own "approved" notice.
        _event(db, "quotation_approved", quot, f"Quotation {quot.quot_number} approved",
               f"{_name(actor)} approved quotation {quot.quot_number} — it can now be sent to the customer.",
               actor, skip={req.requester_id} if req.requester_id else None)
        return
    if quot.status != "submitted":
        return
    step = next((s for s in req.steps if s.status in ("rejected", "returned")), None)
    comment = (step.comment if step else None) or ("withdrawn" if outcome == "cancelled" else "no reason given")
    verb = {"rejected": "rejected", "returned": "returned for changes", "cancelled": "withdrawn"}.get(outcome, outcome)
    _set_status(db, quot, "draft", actor, f"Quotation {quot.quot_number} {verb} by {_name(actor)}: {comment}",
                comment=f"{verb.capitalize()} by {_name(actor)}: {comment}")
    event = {"rejected": "quotation_rejected", "returned": "quotation_returned"}.get(outcome)
    if event:  # a withdrawal is the submitter's own act — no role event
        _event(db, event, quot, f"Quotation {quot.quot_number} {verb}",
               f"{_name(actor)} {verb} quotation {quot.quot_number}: {comment}. Its creator revises it and submits again.",
               actor, skip={req.requester_id} if req.requester_id else None)


register_transaction(TransactionType(
    key=APPROVAL_KEY, module_key="crm", subtab_key="inquiries_tenders", feature_key="quotations", label="CRM quotation",
    entity_type=APPROVAL_ENTITY, url="/dashboard/crm/quotations/{id}",
    description="Price / discount release of a quotation before it is sent to the customer — Sales Head, then Director / "
                "Partner by value or discount (limits in Sales › Settings › Quotation approval).",
    context_fields=CONTEXT_FIELDS, default_stages=default_stages(), on_decided=_decided,
    require_permission=True, distinct_approvers=False, allow_self_approval=False,
))


# ---------------------------------------------------------------- actions

def _ensure_actor(db: Session, quot: Quotation, inquiry: Inquiry, user: User, verb: str) -> None:
    if user.role == "admin" or user.id in (quot.created_by_id, inquiry.created_by_id, inquiry.bd_owner_id):
        return
    raise HTTPException(status_code=403, detail=(
        f"Only the quotation's creator, the inquiry owner / BD owner or an admin can {verb} quotation {quot.quot_number}."))


def _need(quot: Quotation, allowed: tuple[str, ...], verb: str) -> None:
    if quot.status not in allowed:
        raise HTTPException(status_code=409, detail=(
            f"Quotation {quot.quot_number} is {STATUS_LABEL.get(quot.status, quot.status)} — it can only be {verb} when it is "
            f"{' or '.join(STATUS_LABEL[s] for s in allowed)}. Reload the inquiry."))


def submit(db: Session, quot: Quotation, inquiry: Inquiry, user: User, background_tasks=None) -> ApprovalRequest | None:
    _ensure_actor(db, quot, inquiry, user, "submit")
    _need(quot, ("draft",), "submitted for approval")
    problems = []
    if not quot.items or not any((it.description or "").strip() for it in quot.items):
        problems.append("it has no line item — add at least one item")
    amt = quotation_amounts(quot)
    if amt["net"] <= 0:
        problems.append("its value is ₹0 — enter the unit prices (or the lump-sum price)")
    if not quot.quote_date:
        problems.append("Quote Date is empty")
    if quot.valid_until and quot.valid_until < date.today():
        problems.append(f"Valid Until ({quot.valid_until.strftime('%d-%m-%Y')}) is already past — edit the quotation and set a later date")
    if problems:
        raise HTTPException(status_code=422, detail=f"Can't submit quotation {quot.quot_number}: " + "; ".join(problems) + ".")
    rank, why = approval_rank(db, quot)
    makers = {i for i in (quot.created_by_id, user.id) if i}
    ctx = {"approval_rank": rank, "discount_percent": amt["discount_percent"],
           "sales_head_ids": _approvers(db, "sales_head", makers) if rank >= 1 else [],
           "director_ids": _approvers(db, "director", makers) if rank >= 2 else [],
           "partner_ids": _approvers(db, "partner", makers) if rank >= 3 else []}
    for field, need in (("sales_head_ids", 1), ("director_ids", 2), ("partner_ids", 3)):
        if rank >= need and not ctx[field]:
            raise HTTPException(status_code=422, detail=f"Can't submit quotation {quot.quot_number} for {RANK_LABEL[rank]} approval: {_HINT[field]}")
    quot.submitted_at, quot.submitted_by_id = now_utc(), user.id
    _set_status(db, quot, "submitted", user,
                f"{_name(user)} submitted quotation {quot.quot_number} for approval ({RANK_LABEL[rank]}"
                + (f" — {'; '.join(why)}" if why else "") + ").", comment=None)
    db.flush()
    if rank == 0:
        quot.approved_at, quot.approved_by_id = now_utc(), None
        # Users see the business reason only — where approval is configured is admin knowledge.
        reason = "" if SWITCHED_OFF in why else " (value within the auto-approve limit)"
        _set_status(db, quot, "approved", user, f"Quotation {quot.quot_number} needs no approval{reason} — approved.")
        _event(db, "quotation_approved", quot, f"Quotation {quot.quot_number} approved",
               f"Quotation {quot.quot_number} needs no approval{reason} — approved; it can now be sent to the customer.",
               user, background_tasks=background_tasks)
        return None
    org_name = inquiry.organization.name if inquiry.organization else "customer"
    req = engine.submit(
        db, APPROVAL_KEY, entity_id=quot.id, requester=user, reference=quot.quot_number,
        title=f"Quotation {quot.quot_number} — {org_name}, ₹{amt['net']:,.0f}"
              + (f", discount {amt['discount_percent']:g}%" if amt["discount_percent"] else ""),
        amount=amt["net"], context=ctx, exclude_user_ids=sorted(makers),
    )
    # Role event for the approver roles; the engine already told its step approvers
    # directly, and the creator / submitter never approve — leave them out.
    approvers = {s.approver_id for s in (getattr(req, "steps", None) or []) if s.approver_id}
    _event(db, "quotation_submitted", quot, f"Quotation {quot.quot_number} waiting for approval",
           f"{_name(user)} submitted quotation {quot.quot_number} for {org_name} (₹{amt['net']:,.0f}) — {RANK_LABEL[rank]} "
           "approval needed. Open it to approve, return or reject.",
           user, skip=approvers | makers, background_tasks=background_tasks)
    return req


def withdraw(db: Session, quot: Quotation, inquiry: Inquiry, user: User) -> None:
    _ensure_actor(db, quot, inquiry, user, "withdraw")
    _need(quot, ("submitted",), "withdrawn")
    engine.cancel_for_entity(db, APPROVAL_ENTITY, quot.id, user, "withdrawn by the submitter")
    if quot.status == "submitted":  # no engine request (legacy) — on_decided didn't run
        _set_status(db, quot, "draft", user, f"{_name(user)} withdrew quotation {quot.quot_number} from approval.")


def default_valid_until(db: Session, quot: Quotation) -> date:
    from app.modules.sales.settings import get_setting
    days = int(get_setting(db, "quotation_default_validity_days") or 30)
    return (quot.quote_date or date.today()) + timedelta(days=days)


def send(db: Session, quot: Quotation, inquiry: Inquiry, user: User, sent_on: date | None = None) -> None:
    _ensure_actor(db, quot, inquiry, user, "send")
    _need(quot, ("approved",), "marked as sent")
    sent_on = sent_on or date.today()
    if not quot.valid_until:
        quot.valid_until = default_valid_until(db, quot)
    if quot.valid_until < sent_on:
        raise HTTPException(status_code=422, detail=(
            f"Quotation {quot.quot_number} is valid only until {quot.valid_until.strftime('%d-%m-%Y')}, before the send date. "
            f"This quotation is already approved, so its Valid Until can't be edited — use 'Create revision from this quotation' on the inquiry "
            f"to offer it again with a new Valid Until (the new quotation needs approval)."))
    quot.sent_at, quot.sent_by_id = now_utc(), user.id
    quot.submitted_date = quot.submitted_date or sent_on
    _set_status(db, quot, "sent", user, f"{_name(user)} sent quotation {quot.quot_number} to the customer "
                                        f"(valid until {quot.valid_until.strftime('%d-%m-%Y')}).", comment=None)


def accept(db: Session, quot: Quotation, inquiry: Inquiry, user: User, remarks: str | None = None) -> None:
    _ensure_actor(db, quot, inquiry, user, "mark as accepted")
    _need(quot, ("sent",), "marked as accepted")
    other = db.query(Quotation).filter(Quotation.inquiry_id == quot.inquiry_id, Quotation.id != quot.id,
                                       Quotation.status == "accepted").first()
    if other:
        raise HTTPException(status_code=409, detail=(
            f"Quotation {other.quot_number} of this inquiry is already accepted — one accepted offer per inquiry. "
            f"Mark {other.quot_number} as lost first if the customer took this offer instead."))
    quot.decided_at, quot.decided_by_id = now_utc(), user.id
    _set_status(db, quot, "accepted", user, f"{_name(user)} recorded quotation {quot.quot_number} as accepted by the customer"
                + (f": {remarks}" if remarks else "."), comment=remarks)


def mark_lost(db: Session, quot: Quotation, inquiry: Inquiry, user: User, reason: str | None) -> None:
    _ensure_actor(db, quot, inquiry, user, "mark as lost")
    _need(quot, ("approved", "sent"), "marked as lost")
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter why the customer didn't take this quotation (price, delivery, competitor …).")
    quot.decided_at, quot.decided_by_id = now_utc(), user.id
    _set_status(db, quot, "lost", user, f"{_name(user)} marked quotation {quot.quot_number} as lost: {reason}", comment=reason)


def reopen(db: Session, quot: Quotation, inquiry: Inquiry, user: User, reason: str | None) -> None:
    """A recorded outcome (accepted / lost) is final - no undo, admins included
    (owner, 2026-10-28). A changed offer is a new quotation (revision)."""
    raise HTTPException(status_code=422, detail=(
        f"Quotation {quot.quot_number or ''} is {quot.status} and a quotation status can't be undone. "
        "If the customer came back, create a revision from this quotation (it starts as a new draft)."))


def on_revised(db: Session, quot: Quotation, user: User) -> None:
    """A content revision is a new offer: back to draft (withdrawing a pending approval)."""
    if quot.status == "submitted":
        engine.cancel_for_entity(db, APPROVAL_ENTITY, quot.id, user, "the quotation was revised")
    if quot.status != "draft":
        quot.approved_at = quot.approved_by_id = quot.sent_at = quot.sent_by_id = None
        quot.decided_at = quot.decided_by_id = None
        _set_status(db, quot, "draft", user, f"{_name(user)} revised quotation {quot.quot_number} — back to draft; "
                                             f"it needs approval again before it is sent.", comment=None)
    elif quot.customer_response != AWAITING:
        quot.customer_response = AWAITING


def apply_customer_response(db: Session, quot: Quotation, inquiry: Inquiry, user: User, value: str) -> None:
    """The old free-text-style 'Customer response' select, mapped onto the status flow."""
    if value == (quot.customer_response or AWAITING):
        return
    if value == "Accepted":
        if quot.status == "approved":
            send(db, quot, inquiry, user)
        accept(db, quot, inquiry, user)
    elif value == "Rejected":
        mark_lost(db, quot, inquiry, user, quot.status_comment or "Rejected by the customer")
    elif value == "Negotiating":
        if quot.status == "approved":
            send(db, quot, inquiry, user)
        _need(quot, ("sent",), "marked as under negotiation")
        quot.customer_response = "Negotiating"
        _audit(db, quot, user, "negotiating", f"{_name(user)} recorded the customer is negotiating on {quot.quot_number}.")
    else:  # "— Awaiting —"
        if quot.status in ("accepted", "lost"):
            reopen(db, quot, inquiry, user, "customer response reset to awaiting")
        else:
            quot.customer_response = AWAITING


def expire_due(db: Session, today: date | None = None) -> int:
    """approved / sent quotations past their Valid Until → expired (no commit)."""
    today = today or date.today()
    rows = db.query(Quotation).filter(Quotation.status.in_(OPEN_WITH_CUSTOMER), Quotation.valid_until.isnot(None),
                                      Quotation.valid_until < today).all()
    for q in rows:
        _set_status(db, q, "expired", None, f"Quotation {q.quot_number} expired — its validity ended on "
                                            f"{q.valid_until.strftime('%d-%m-%Y')} without a customer decision.")
        _event(db, "quotation_expired", q, f"Quotation {q.quot_number} expired",
               f"Quotation {q.quot_number}'s validity ended on {q.valid_until.strftime('%d-%m-%Y')} without a customer decision. "
               "Use 'Create revision from this quotation' on the inquiry to offer it again, or record the outcome.", None)
    if rows:
        db.flush()
    return len(rows)


EXPIRING_DAYS = 3


def remind_expiring(db: Session, today: date | None = None) -> int:
    """Daily CRM job: role event for approved / sent quotations whose validity
    ends in EXPIRING_DAYS days (no commit). Runs once a day, so each quotation
    is announced once."""
    today = today or date.today()
    due = today + timedelta(days=EXPIRING_DAYS)
    rows = db.query(Quotation).filter(Quotation.status.in_(OPEN_WITH_CUSTOMER), Quotation.valid_until == due).all()
    for q in rows:
        _event(db, "quotation_expiring", q, f"Quotation {q.quot_number} valid only till {due.strftime('%d-%m-%Y')}",
               f"Quotation {q.quot_number} ({STATUS_LABEL.get(q.status, q.status)}) expires in {EXPIRING_DAYS} days — follow up "
               "with the customer for a decision, or create a revision with a later validity.", None)
    return len(rows)


def status_view(db: Session, quot: Quotation, user: User | None = None) -> dict:
    """Status block for the quotation panel: label, amounts, the approval state
    (stage / who), and which actions this user may take now."""
    amt = quotation_amounts(quot)
    rank, why = approval_rank(db, quot) if quot.status == "draft" else (None, [])
    if SWITCHED_OFF in why and not (user and user.role == "admin"):
        why = []  # the on/off switch is an admin setting — normal users just see "No approval needed"
    went, stage, who = False, None, []
    req = engine.latest_request(db, APPROVAL_ENTITY, quot.id)
    if req is not None and req.status == "pending":
        pending = [s for s in req.steps if s.sequence == req.current_sequence and s.status == "pending"]
        went, stage = True, (pending[0].stage_name if pending else None)
        who = [s.approver.name or s.approver.email for s in pending if s.approver]
    can_decide = bool(user and req is not None and req.status == "pending" and engine.can_act_on_entity(db, user, APPROVAL_ENTITY, quot.id))
    # Same rule as _ensure_actor: who may record the send / customer outcome (the route also needs the Edit permission).
    inq = db.get(Inquiry, quot.inquiry_id)
    can_work = bool(user and (user.role == "admin" or user.id in (quot.created_by_id, inq.created_by_id if inq else None,
                                                                  inq.bd_owner_id if inq else None)))
    return {"status": quot.status, "can_work": can_work, "can_reopen": False,
            "status_label": STATUS_LABEL.get(quot.status, quot.status),
            "gross_value": amt["gross"], "discount_percent": amt["discount_percent"], "net_value": amt["net"],
            "approval_rank": rank, "approval_label": RANK_LABEL.get(rank) if rank is not None else None, "approval_reasons": why,
            "approval_pending": went, "approval_stage": stage, "approval_waiting_on": who, "can_decide": can_decide,
            "approval_request_id": req.id if (req is not None and req.status == "pending") else None}
