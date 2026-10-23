"""Finance & Accounting on the central authorization framework
(docs/02-modules/platform/authorization-architecture.md).

Data scope
    The transactional records — journals, purchase invoices, sales invoices,
    debit/credit notes, payment vouchers and bank reconciliations — are
    registered with core.data_scope (owner = created_by). None of them carries
    a plant column, so a "plant" scope is resolved through the maker's plant.
    A role without a scope for `accounts` gets default_scope() (own +
    assigned); set "Entire organization" on the role for full Finance data.
    Masters (ledgers, vendors, internal orders, bank accounts) are not
    scoped. Aggregate reports (trial balance, P&L, balance sheet, cash flow,
    ageing, outstanding, GST returns, liquidity) are NOT scoped: a scoped
    total would silently be a wrong total — they stay gated by their tab's
    view permission instead.

Approvals — one transaction type per approvable finance document / process:

    accounts.journal_voucher   draft manual journal → posted
    accounts.purchase_invoice  pending vendor invoice → posted (+ 3-way-match
                               variance stage when the invoice has a variance)
    accounts.sales_invoice     draft sales invoice → issued / posted
    accounts.debit_note        pending debit note → posted
    accounts.credit_note       pending credit note → posted
    accounts.period_close      close an accounting month
    accounts.depreciation_run  run depreciation for a month
    accounts.year_end_close    close a financial year

Default stages reproduce what the code enforced before the engine: the tab's
approve permission (documents, any one holder; maker-checker = no self
approval, exactly like service._ensure_not_maker) and, for the period-end
processes, a Finance Manager who also holds the tab's approve permission
(the closer used to be the same person, so self approval is allowed and the
Finance Manager's click still closes at once). The GL effect (posting,
numbering, closing) happens in on_decided("approved").
"""
from __future__ import annotations

from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.core.permission_registry import is_admin_user
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalRequestStep, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.bank_reconciliation import BankReconciliation
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.models.party_note import PartyNote
from app.modules.accounts.models.payment_transaction import PaymentTransaction
from app.modules.accounts.models.vendor_invoice import VendorInvoice

MODULE = "accounts"

# Approval-engine entity types (also used by notifications → NotificationBell ENTITY_LINK).
ET_JOURNAL = "accounts_journal_entry"
ET_VENDOR_INVOICE = "accounts_vendor_invoice"
ET_SALES_INVOICE = "accounts_ar_transaction"
ET_NOTE = "accounts_party_note"
ET_PAYMENT = "accounts_payment"
ET_RECONCILIATION = "accounts_bank_reconciliation"
ET_PERIOD_CLOSE = "accounts_period_close"        # entity_id = YYYYMM of the period
ET_DEPRECIATION = "accounts_depreciation_run"    # entity_id = YYYYMM of the period
ET_YEAR_END = "accounts_year_end_close"          # entity_id = the FY's start year (2026 for 2026-27)

KEY_JOURNAL = "accounts.journal_voucher"
KEY_VENDOR_INVOICE = "accounts.purchase_invoice"
KEY_SALES_INVOICE = "accounts.sales_invoice"
KEY_DEBIT_NOTE = "accounts.debit_note"
KEY_CREDIT_NOTE = "accounts.credit_note"
KEY_PERIOD_CLOSE = "accounts.period_close"
KEY_DEPRECIATION = "accounts.depreciation_run"
KEY_YEAR_END = "accounts.year_end_close"
# Payment approval (F110 / maker-checker on outgoing money): every vendor
# payment, a customer receipt whose write-offs exceed the Finance Settings
# limit, and an expense payment above its limit are held until approved.
KEY_PAYMENT = "accounts.payment_voucher"
KEY_PAYMENT_RUN = "accounts.payment_run"
ET_PAYMENT_RUN = "accounts_payment_proposal"

NOTE_KEYS = {"debit_note": KEY_DEBIT_NOTE, "credit_note": KEY_CREDIT_NOTE}

# ── Data scope ───────────────────────────────────────────────────────────

register_scoped(JournalEntry, MODULE, entity_type=ET_JOURNAL, owner=("created_by_id",), label="journal entry")
register_scoped(VendorInvoice, MODULE, entity_type=ET_VENDOR_INVOICE, owner=("created_by_id",), label="purchase invoice")
register_scoped(ARTransaction, MODULE, entity_type=ET_SALES_INVOICE, owner=("created_by_id",), label="sales invoice")
register_scoped(PartyNote, MODULE, entity_type=ET_NOTE, owner=("created_by_id",), label="debit/credit note")
register_scoped(PaymentTransaction, MODULE, entity_type=ET_PAYMENT, owner=("created_by_id",), label="payment voucher")
register_scoped(BankReconciliation, MODULE, entity_type=ET_RECONCILIATION, owner=("created_by_id",), label="bank reconciliation")


# ── Helpers ──────────────────────────────────────────────────────────────

@contextmanager
def _as_http():
    """Service errors inside on_decided surface as real HTTP reasons even when
    the decision came through the central /approvals endpoint."""
    try:
        yield
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _audit(db: Session, entity_type: str, entity_id: int | None, action: str, actor: User, summary: str) -> None:
    db.add(AuditLog(entity_type=entity_type, entity_id=entity_id, action=action, performed_by_id=actor.id,
                    module_key=MODULE, summary=summary))


def _who(user: User) -> str:
    return user.name or user.email


# ── Role-based notifications (core/events/accounts.py) ───────────────────

_SCOPED_MODELS = {ET_JOURNAL: JournalEntry, ET_VENDOR_INVOICE: VendorInvoice, ET_SALES_INVOICE: ARTransaction,
                  ET_PAYMENT: PaymentTransaction}
_SUBMIT_EVENTS = {KEY_JOURNAL: "journal_submitted", KEY_VENDOR_INVOICE: "purchase_invoice_submitted",
                  KEY_SALES_INVOICE: "sales_invoice_submitted", KEY_PAYMENT: "payment_submitted",
                  KEY_PAYMENT_RUN: "payment_run_submitted"}


def role_event(db: Session, event: str, *, title: str, message: str, entity_type: str, entity_id: int | None,
               actor: User | None = None, skip: set[int] | None = None, background_tasks=None,
               details: list[tuple[str, str]] | None = None) -> set[int]:
    """Send a Finance role event; for data-scoped documents a member must be
    able to open that very record. Never raises."""
    from app.core.data_scope import in_scope
    from app.core.notification_events import notify_event
    try:
        model = _SCOPED_MODELS.get(entity_type)
        record = db.get(model, entity_id) if model is not None and entity_id else None
    except Exception:
        record = None
    can_open = (lambda u: in_scope(db, u, record)) if record is not None else None
    return notify_event(db, background_tasks, MODULE, event, title=title, message=message, entity_type=entity_type,
                        entity_id=entity_id, actor=actor, can_open=can_open, details=details, skip_user_ids=skip)


def _step_approvers(req: ApprovalRequest) -> set[int]:
    """Everyone the engine already told directly (stage approvers)."""
    return {s.approver_id for s in (getattr(req, "steps", None) or []) if s.approver_id}


def _submitted_event(db: Session, key: str, req: ApprovalRequest, requester: User, title: str,
                     reference: str | None, amount, context: dict, background_tasks) -> None:
    event = _SUBMIT_EVENTS.get(key)
    if event is None or req.status != "pending":
        return
    variance = key == KEY_VENDOR_INVOICE and bool(context.get("has_variance"))
    if variance:
        event = "purchase_invoice_variance"
    what = reference or title
    amt = f" for {float(amount):,.2f}" if amount else ""
    need = ("its 3-way-match variance approved (PO / GRN / invoice differ beyond tolerance)" if variance
            else "approval")
    role_event(db, event, title=f"{what} waiting for {'variance approval' if variance else 'approval'}",
               message=f"{_who(requester)} submitted {title}{amt}; it needs {need}. "
                       f"Open it in Finance and approve or reject it from the Approval panel.",
               entity_type=req.entity_type, entity_id=req.entity_id, actor=requester,
               skip=_step_approvers(req) | {requester.id}, background_tasks=background_tasks)


def _decision_comment(req: ApprovalRequest, status: str) -> str | None:
    for s in req.steps:
        if s.status == status and s.comment:
            return s.comment
    return None


def period_entity_id(period: str) -> int:
    """'2026-10' → 202610 (the period-end processes have no row of their own
    until they run, so the period itself identifies the approval)."""
    try:
        y, m = period.split("-")
        if len(y) != 4 or not (1 <= int(m) <= 12):
            raise ValueError
        return int(y) * 100 + int(m)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail=f"'{period}' isn't an accounting period — use YYYY-MM, e.g. 2026-10.")


def fy_entity_id(fy_code: str) -> int:
    try:
        return int(fy_code.split("-")[0])
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail=f"'{fy_code}' isn't a financial year code — use e.g. 2026-27.")


def approval_states(db: Session, entity_type: str, ids) -> dict[int, dict]:
    """Latest approval request per record, for list screens:
    {entity_id: {"approval_status", "approval_stage", "approval_request_id"}}."""
    ids = [i for i in set(ids) if i is not None]
    if not ids:
        return {}
    rows = (
        db.query(ApprovalRequest)
        .filter(ApprovalRequest.entity_type == entity_type, ApprovalRequest.entity_id.in_(ids))
        .order_by(ApprovalRequest.id.desc())
        .all()
    )
    latest: dict[int, ApprovalRequest] = {}
    for r in rows:
        latest.setdefault(r.entity_id, r)
    pending = [r.id for r in latest.values() if r.status == "pending"]
    stage_names: dict[int, str] = {}
    if pending:
        for s in db.query(ApprovalRequestStep).filter(ApprovalRequestStep.request_id.in_(pending)).all():
            req = next((r for r in latest.values() if r.id == s.request_id), None)
            if req is not None and s.sequence == req.current_sequence:
                stage_names[req.id] = s.stage_name
    return {
        eid: {"approval_status": r.status, "approval_stage": stage_names.get(r.id), "approval_request_id": r.id}
        for eid, r in latest.items()
    }


def approval_state(db: Session, entity_type: str, entity_id: int) -> dict:
    return approval_states(db, entity_type, [entity_id]).get(
        entity_id, {"approval_status": None, "approval_stage": None, "approval_request_id": None})


def pending_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def _admin_comment(user: User, comment: str | None) -> str | None:
    """The engine lets an admin stand in only with a reason; an admin acting
    from the Finance screen (as they always could) gets one recorded for them."""
    if comment or not is_admin_user(user):
        return comment
    return f"Approved by {_who(user)} (admin) from the Finance screen."


def submit_document(db: Session, key: str, *, entity_id: int, requester: User, title: str, reference: str | None,
                    amount: float | None, context: dict | None = None, background_tasks=None) -> ApprovalRequest:
    """Start (or restart, after a return / rejection / withdrawal) approval of a document."""
    tt = engine.get_type(key)
    live = pending_request(db, tt.entity_type, entity_id)
    if live is not None:
        raise HTTPException(status_code=409, detail=f"{reference or title} is already waiting for approval "
                                                    f"({_current_stage(live)}). Withdraw it from the Approval panel first if you need to change it.")
    req = engine.submit(db, key, entity_id=entity_id, requester=requester, title=title, reference=reference,
                        amount=amount, context=context or {})
    _submitted_event(db, key, req, requester, title, reference, amount, context or {}, background_tasks)
    return req


def approve_now(db: Session, key: str, *, entity_id: int, maker_id: int | None, actor: User, title: str,
                reference: str | None, amount: float | None, context: dict | None = None,
                comment: str | None = None) -> ApprovalRequest:
    """The approver's one click (the old Post / Approve buttons): decide the
    pending request — or, for a document nobody submitted yet (incl. drafts
    recorded before the engine), submit it on the maker's behalf and decide it
    in the same transaction. Raises the engine's 403 when `actor` isn't an
    approver of the current stage, so nothing is half-done."""
    tt = engine.get_type(key)
    if maker_id is not None and maker_id == actor.id:
        raise HTTPException(status_code=403, detail=f"You recorded this {tt.label.lower()}, so you can't approve or post it "
                                                    "yourself — another finance user must do that (maker-checker).")
    req = pending_request(db, tt.entity_type, entity_id)
    if req is None:
        requester = db.get(User, maker_id) if maker_id else None
        req = engine.submit(db, key, entity_id=entity_id, requester=requester or actor, title=title, reference=reference,
                            amount=amount, context=context or {})
    if req.status == "pending":
        engine.decide(db, req.id, actor, "approve", _admin_comment(actor, comment))
    return req


def submit_process(db: Session, key: str, *, entity_id: int, actor: User, title: str, reference: str,
                   context: dict, comment: str | None = None) -> ApprovalRequest:
    """Period-end processes (close a month, run depreciation, close a year):
    submit, and if the person who clicked is themselves an approver of the
    first stage (a Finance Manager, as before), approve at once — so their
    one click still runs it. Otherwise it waits for a Finance Manager."""
    tt = engine.get_type(key)
    req = pending_request(db, tt.entity_type, entity_id)
    if req is None:
        req = engine.submit(db, key, entity_id=entity_id, requester=actor, title=title, reference=reference,
                            amount=None, context=context)
    if req.status == "pending" and (engine.can_act_on_entity(db, actor, tt.entity_type, entity_id) or is_admin_user(actor)):
        engine.decide(db, req.id, actor, "approve", _admin_comment(actor, comment))
    return req


def cancel_live(db: Session, entity_type: str, entity_id: int, actor: User, reason: str | None) -> None:
    """The record itself was discarded / cancelled — close its live approval."""
    req = pending_request(db, entity_type, entity_id)
    if req is not None:
        # engine.cancel allows the submitter, an admin or a holder of the tab's
        # Cancel permission, and says so in its 403 otherwise.
        engine.cancel(db, req.id, actor, reason)


def _current_stage(req: ApprovalRequest) -> str:
    names = {s.stage_name for s in req.steps if s.sequence == req.current_sequence}
    return f"stage '{', '.join(sorted(names))}'" if names else "in progress"


def pending_response(req: ApprovalRequest, what: str) -> dict:
    waiting = sorted({s.approver.name for s in req.steps
                      if s.sequence == req.current_sequence and s.status == "pending" and s.approver})
    return {
        "approval_status": req.status, "approval_request_id": req.id, "approval_stage": _current_stage(req),
        "message": f"{what} was submitted for approval and waits for {', '.join(waiting) or 'the approver'} "
                   f"({_current_stage(req)}). It runs as soon as it is approved.",
    }


# ── 3-way-match variance stage ───────────────────────────────────────────

def _variance_sequences(db: Session) -> set[int]:
    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == KEY_VENDOR_INVOICE).first()
    if wf is None:
        return set()
    return {s.sequence for s in wf.stages if any((c or {}).get("field") == "has_variance" for c in (s.conditions or []))}


def sync_variance_approval(db: Session, invoice: VendorInvoice, req: ApprovalRequest | None) -> None:
    """Once the variance stage of an invoice's approval is approved, record
    the variance approval on the invoice (matching status, who, note) — the
    engine has no per-stage hook, so this runs after every module-side
    decision and again in on_decided."""
    from app.modules.accounts.service import approve_variance

    if req is None or invoice.matching_status != "variance":
        return
    seqs = _variance_sequences(db)
    steps = [s for s in req.steps if s.sequence in seqs]
    approved = [s for s in steps if s.status == "approved"]
    if not approved or any(s.status in ("waiting", "pending") for s in steps):
        return
    step = approved[0]
    with _as_http():
        approve_variance(db, vendor_invoice_id=invoice.id, approved_by_id=step.decided_by_id, note=step.comment)


# ── on_decided handlers ──────────────────────────────────────────────────

def _journal_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.service import post_draft_journal

    je = db.get(JournalEntry, req.entity_id)
    if je is None or je.status != "draft":
        return
    if outcome == "approved":
        from app.modules.accounts.services.proof import ensure_journal_proof
        ensure_journal_proof(db, je)
        with _as_http():
            post_draft_journal(db, journal_entry_id=je.id, posted_by_id=actor.id)
        _audit(db, "journal_entry", je.id, "posted", actor, f"{_who(actor)} approved and posted journal entry {je.entry_number}.")
    elif outcome == "rejected":
        je.status = "cancelled"
        _audit(db, "journal_entry", je.id, "discarded", actor,
               f"{_who(actor)} rejected the draft journal: {_decision_comment(req, 'rejected') or 'no reason given'}")


def _vendor_invoice_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.service import post_vendor_invoice

    inv = db.get(VendorInvoice, req.entity_id)
    if inv is None or inv.status != "pending":
        return
    if outcome == "approved":
        from app.modules.accounts.services.proof import ensure_vendor_invoice_proof
        ensure_vendor_invoice_proof(db, inv)
        sync_variance_approval(db, inv, req)
        with _as_http():
            post_vendor_invoice(db, vendor_invoice_id=inv.id, created_by_id=actor.id)
        _audit(db, "vendor_invoice", inv.id, "posted", actor, f"{_who(actor)} approved and posted vendor invoice '{inv.invoice_number}' to the GL.")
        from app.modules.accounts.models.vendor import Vendor
        v = db.get(Vendor, inv.vendor_id) if inv.vendor_id else None
        vendor = v.name if v is not None else "the vendor"
        due = f" It is due on {inv.due_date:%d-%m-%Y}." if inv.due_date else ""
        role_event(db, "purchase_invoice_posted", title=f"Vendor bill {inv.invoice_number} posted — due for payment",
                   message=f"{_who(actor)} approved and posted bill {inv.invoice_number} of {vendor}.{due} "
                           f"Pay it from Finance › Payments or include it in a payment run.",
                   entity_type=ET_VENDOR_INVOICE, entity_id=inv.id, actor=actor, skip={req.requester_id} - {None})
    elif outcome == "rejected":
        reason = _decision_comment(req, "rejected") or "rejected in approval"
        inv.status = "cancelled"
        inv.cancelled_reason = f"Rejected by {_who(actor)}: {reason}"
        _audit(db, "vendor_invoice", inv.id, "cancelled", actor, f"{_who(actor)} rejected vendor invoice '{inv.invoice_number}': {reason}")


def _sales_invoice_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.service import post_customer_invoice

    txn = db.get(ARTransaction, req.entity_id)
    if txn is None or txn.status != "pending":
        return
    if outcome == "approved":
        with _as_http():
            post_customer_invoice(db, ar_transaction_id=txn.id, created_by_id=actor.id)
        _audit(db, "ar_transaction", txn.id, "posted", actor, f"{_who(actor)} approved and issued sales invoice '{txn.invoice_number}'.")
        if not (txn.irn or "").strip():
            role_event(db, "sales_invoice_e_invoice_pending", title=f"Sales invoice {txn.invoice_number} issued without an IRN",
                       message=f"Sales invoice {txn.invoice_number} was issued with no e-invoice IRN recorded. If e-invoicing "
                               f"applies, generate the IRN on the IRP portal and record it (Finance › Sales › E-invoice / e-way bill).",
                       entity_type=ET_SALES_INVOICE, entity_id=txn.id, actor=actor)
    elif outcome == "rejected":
        reason = _decision_comment(req, "rejected") or "rejected in approval"
        txn.status = "cancelled"
        txn.cancelled_reason = f"Rejected by {_who(actor)}: {reason}"
        _audit(db, "ar_transaction", txn.id, "cancelled", actor, f"{_who(actor)} rejected a draft sales invoice: {reason}")


def _note_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.services.notes import post_party_note, cancel_party_note

    note = db.get(PartyNote, req.entity_id)
    if note is None or note.status != "pending":
        return
    label = note.note_type.replace("_", " ")
    if outcome == "approved":
        with _as_http():
            post_party_note(db, party_note_id=note.id, posted_by_id=actor.id)
        _audit(db, "party_note", note.id, "posted", actor, f"{_who(actor)} approved and posted {note.note_number}.")
    elif outcome == "rejected":
        reason = _decision_comment(req, "rejected") or "rejected in approval"
        with _as_http():
            cancel_party_note(db, party_note_id=note.id, reason=f"Rejected by {_who(actor)}: {reason}")
        _audit(db, "party_note", note.id, "cancelled", actor, f"{_who(actor)} rejected a draft {label}: {reason}")


def _period_close_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.service import close_period

    if outcome != "approved":
        return
    period = (req.context or {}).get("period")
    with _as_http():
        close_period(db, accounting_period=period, closed_by_id=actor.id, notes=(req.context or {}).get("notes"))
    notes = (req.context or {}).get("notes")
    _audit(db, "period_close", None, "closed", actor,
           f"{_who(actor)} closed accounting period {period}." + (f" Notes: {notes}" if notes else ""))
    role_event(db, "period_closed", title=f"Accounting period {period} closed",
               message=f"{_who(actor)} closed accounting period {period}. No voucher can be posted into it any more; "
                       f"date new entries in an open month.",
               entity_type=ET_PERIOD_CLOSE, entity_id=req.entity_id, actor=actor, skip={req.requester_id} - {None})


def _depreciation_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.services import assets

    if outcome != "approved":
        return
    period = (req.context or {}).get("period")
    with _as_http():
        run = assets.run_depreciation(db, accounting_period=period, created_by_id=actor.id)
    _audit(db, "depreciation_run", run.id, "posted", actor, f"{_who(actor)} ran depreciation for {run.accounting_period} ({run.total_amount:,.2f}).")


def _year_end_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.services import closing

    if outcome != "approved":
        return
    fy_code = (req.context or {}).get("fy_code")
    with _as_http():
        entry = closing.close_financial_year(db, fy_code=fy_code, user_id=actor.id)
    _audit(db, "financial_year", None, "closed", actor, f"{_who(actor)} closed financial year {fy_code} ({entry.entry_number}).")


# ── Transaction types ────────────────────────────────────────────────────

def _approve_holders(tab: str, label: str = "Finance approver") -> StageDef:
    return StageDef(label, "permission", {"permission": f"{MODULE}:{tab}:approve"}, approval_mode="any")


def _validate_vendor_invoice_decision(db: Session, req: ApprovalRequest, step: ApprovalRequestStep, user: User,
                                      decision: str) -> None:
    """Approving the 3-way-match variance stage — from the Finance screen or
    the central Approvals inbox — needs Purchase Invoices › Approve 3-way-match
    variance (the rest of the invoice's approval keeps the tab's approve)."""
    from app.core.permissions import ensure_feature_action
    if decision == "approve" and step.sequence in _variance_sequences(db):
        ensure_feature_action(user, MODULE, "purchase_invoices", "variance_approval", "approve")


def _finance_manager(label: str = "Finance Manager") -> StageDef:
    return StageDef(label, "user_flag", {"flag": "is_finance_manager"}, approval_mode="any")


_DOC = dict(module_key=MODULE, require_permission=True, allow_self_approval=False, distinct_approvers=False)

register_transaction(TransactionType(
    key=KEY_JOURNAL, subtab_key="journal_vouchers", label="Manual journal voucher", entity_type=ET_JOURNAL,
    url="/dashboard/finance/ledger", description="A draft manual journal is posted to the books once approved (maker-checker).",
    context_fields={"posting_type": {"label": "Journal type", "type": "choice",
                                     "choices": ["adjustment", "accrual", "correction", "depreciation"],
                                     "choice_labels": {"adjustment": "Adjustment", "accrual": "Accrual",
                                                       "correction": "Correction", "depreciation": "Depreciation"}}},
    default_stages=[_approve_holders("journal_vouchers", "Journal approver")],
    on_decided=_journal_decided, **_DOC,
))
register_transaction(TransactionType(
    key=KEY_VENDOR_INVOICE, subtab_key="purchase_invoices", label="Purchase invoice", entity_type=ET_VENDOR_INVOICE,
    url="/dashboard/finance/purchase",
    description="A recorded vendor bill is posted to the books once approved. Bills outside 3-way-match tolerance "
                "first need a Finance Manager's variance approval.",
    context_fields={"has_variance": {"label": "Outside 3-way-match tolerance", "type": "bool"},
                    "invoice_type": {"label": "Invoice type", "type": "choice", "choices": ["po", "direct", "opening"],
                                     "choice_labels": {"po": "Against a PO", "direct": "Direct (no PO)",
                                                       "opening": "Opening balance"}}},
    default_stages=[
        StageDef("3-way-match variance (Finance Manager)", "user_flag", {"flag": "is_finance_manager"},
                 conditions=[{"field": "has_variance", "op": "true"}]),
        _approve_holders("purchase_invoices", "Posting approver"),
    ],
    on_decided=_vendor_invoice_decided, validate_decision=_validate_vendor_invoice_decision, **_DOC,
))
register_transaction(TransactionType(
    key=KEY_SALES_INVOICE, subtab_key="sales_invoices", label="Sales invoice", entity_type=ET_SALES_INVOICE,
    url="/dashboard/finance/sales", description="A draft sales invoice gets its SI number and is posted once approved.",
    default_stages=[_approve_holders("sales_invoices", "Invoice approver")],
    on_decided=_sales_invoice_decided, **_DOC,
))
register_transaction(TransactionType(
    key=KEY_DEBIT_NOTE, subtab_key="debit_notes", label="Debit note", entity_type=ET_NOTE,
    url="/dashboard/finance/purchase", description="A draft debit note (purchase return / rate difference) is posted once approved.",
    default_stages=[_approve_holders("debit_notes", "Debit note approver")],
    on_decided=_note_decided, **_DOC,
))
register_transaction(TransactionType(
    key=KEY_CREDIT_NOTE, subtab_key="credit_notes", label="Credit note", entity_type=ET_NOTE,
    url="/dashboard/finance/sales", description="A draft credit note (sales return / rate difference) is posted once approved.",
    default_stages=[_approve_holders("credit_notes", "Credit note approver")],
    on_decided=_note_decided, **_DOC,
))

_PROCESS = dict(module_key=MODULE, require_permission=True, allow_self_approval=True, distinct_approvers=False)

register_transaction(TransactionType(
    key=KEY_PERIOD_CLOSE, subtab_key="period_close", label="Accounting period close", entity_type=ET_PERIOD_CLOSE,
    url="/dashboard/finance/ledger", description="Locks a month's books. Runs when a Finance Manager approves.",
    context_fields={"period": {"label": "Period (YYYY-MM)", "type": "text"}},
    default_stages=[_finance_manager()], on_decided=_period_close_decided, **_PROCESS,
))
register_transaction(TransactionType(
    key=KEY_DEPRECIATION, subtab_key="depreciation", label="Depreciation run", entity_type=ET_DEPRECIATION,
    url="/dashboard/finance/assets", description="Posts a month's depreciation. Runs when a Finance Manager approves.",
    context_fields={"period": {"label": "Period (YYYY-MM)", "type": "text"}},
    default_stages=[_finance_manager()], on_decided=_depreciation_decided, **_PROCESS,
))
register_transaction(TransactionType(
    key=KEY_YEAR_END, subtab_key="year_end_close", label="Financial year close", entity_type=ET_YEAR_END,
    url="/dashboard/finance/reports", description="Transfers the year's profit to reserves and closes the FY. Runs when a Finance Manager approves.",
    context_fields={"fy_code": {"label": "Financial year", "type": "text"}},
    default_stages=[_finance_manager()], on_decided=_year_end_decided, **_PROCESS,
))


# ── Payment approval (vouchers held before posting) and payment runs ─────

def _payment_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.services.vouchers import post_held_voucher, reject_held_voucher

    p = db.get(PaymentTransaction, req.entity_id)
    if p is None or p.status != "pending_approval":
        return
    if outcome == "approved":
        draft_ref = p.payment_number
        with _as_http():
            post_held_voucher(db, payment_id=p.id, posted_by_id=actor.id, approved_by_id=actor.id)
        _audit(db, "payment_transaction", p.id, "posted", actor,
               f"{_who(actor)} approved {req.reference or draft_ref}; posted as {p.payment_number} ({p.amount:,.2f}).")
    else:
        reason = _decision_comment(req, "rejected") or _decision_comment(req, "returned") or f"approval {outcome}"
        reject_held_voucher(db, payment_id=p.id, reason=f"{outcome.title()} by {_who(actor)}: {reason}", user_id=actor.id)
        _audit(db, "payment_transaction", p.id, "rejected", actor, f"{_who(actor)} {outcome} the payment: {reason}")


def _payment_run_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.models.payment_proposal import PaymentProposal

    pp = db.get(PaymentProposal, req.entity_id)
    if pp is None or pp.status != "submitted":
        return
    if outcome == "approved":
        pp.status = "approved"
        pp.approved_by_id = actor.id
        _audit(db, "payment_proposal", pp.id, "approved", actor,
               f"{_who(actor)} approved payment run {pp.proposal_number} ({pp.total_amount:,.2f}).")
        role_event(db, "payment_run_approved", title=f"Payment run {pp.proposal_number} approved — ready to execute",
                   message=f"{_who(actor)} gave the final approval to payment run {pp.proposal_number} ({pp.total_amount:,.2f}). "
                           f"Execute it (Pay now) in Finance › Payments › Payment runs to post the payment vouchers.",
                   entity_type=ET_PAYMENT_RUN, entity_id=pp.id, actor=actor, skip={req.requester_id} - {None})
    else:
        reason = _decision_comment(req, "rejected") or _decision_comment(req, "returned") or f"approval {outcome}"
        pp.status = "rejected" if outcome in ("rejected", "returned") else "draft"
        pp.rejection_reason = reason
        _audit(db, "payment_proposal", pp.id, outcome, actor, f"{_who(actor)} {outcome} payment run {pp.proposal_number}: {reason}")


register_transaction(TransactionType(
    key=KEY_PAYMENT, subtab_key="payments", label="Payment voucher", entity_type=ET_PAYMENT,
    url="/dashboard/finance/payments",
    description="Vendor payments (and receipts with large write-offs, and expense payments above the Finance Settings "
                "limit) are posted only after a Finance approver and then a Partner approve them. The person who "
                "recorded the payment can't approve it (maker-checker).",
    context_fields={"payment_type": {"label": "Voucher type", "type": "choice",
                                     "choices": ["vendor", "customer", "expense"],
                                     "choice_labels": {"vendor": "Vendor payment", "customer": "Customer receipt",
                                                       "expense": "Expense payment"}},
                    "writeoff_amount": {"label": "Write-offs on the receipt (₹)", "type": "number"},
                    "is_advance": {"label": "Advance (down payment)", "type": "bool"}},
    default_stages=[_approve_holders("payments", "Finance approver"),
                    StageDef("Partner (final approval)", "partner")],
    on_decided=_payment_decided, **_DOC,
))
register_transaction(TransactionType(
    key=KEY_PAYMENT_RUN, subtab_key="payment_runs", label="Payment run (proposal)", entity_type=ET_PAYMENT_RUN,
    url="/dashboard/finance/payments/runs",
    description="A payment proposal — the vendor bills picked for payment — is approved by a Finance approver and then a "
                "Partner before it can be executed into payment vouchers.",
    default_stages=[_approve_holders("payment_runs", "Finance approver"),
                    StageDef("Partner (final approval)", "partner")],
    on_decided=_payment_run_decided, **_DOC,
))
