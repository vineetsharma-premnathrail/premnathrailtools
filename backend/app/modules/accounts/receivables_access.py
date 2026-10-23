"""Central-engine wiring for receivables management (credit release) and
the managed Word document for dunning letters. Imported by
routes/receivables.py, so it registers at app start-up.

    accounts.credit_release   a credit-blocked SO confirmation / dispatch is
                              released by a Finance approver (holder of
                              Finance › Credit Management › Approve, not the
                              requester), and above the Partner threshold by a
                              Partner as well. Approving needs a comment —
                              the release reason is kept for audit.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.accounts.models.collections import CREDIT_CHECKPOINTS, AccountsCreditRelease

MODULE = "accounts"
ET_CREDIT_RELEASE = "accounts_credit_release"
KEY_CREDIT_RELEASE = "accounts.credit_release"
ET_DUNNING_LETTER = "accounts_dunning_letter"
# Default Partner stage: excess over the limit (or overdue amount) above this.
PARTNER_THRESHOLD = 2_500_000


def _comment(req: ApprovalRequest) -> str | None:
    for s in sorted(req.steps, key=lambda s: s.sequence, reverse=True):
        if s.comment:
            return s.comment
    return None


def _credit_release_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.accounts.services.credit import decide_release
    from app.utils.notifications import notify_user

    rel = db.get(AccountsCreditRelease, req.entity_id)
    if rel is None or rel.status != "pending_approval":
        return
    comment = _comment(req)
    decide_release(db, rel, outcome, actor.id, comment)
    db.add(AuditLog(entity_type="credit_release", entity_id=rel.id, action=rel.status, performed_by_id=actor.id,
                    module_key=MODULE, summary=f"{actor.name or actor.email} {outcome} credit release {rel.release_number}"
                                               + (f": {comment}" if comment else "")))
    if rel.requested_by_id and rel.requested_by_id != actor.id:
        msg = (f"Released until {rel.valid_until:%d-%m-%Y} — the order / dispatch can go ahead now."
               if rel.status == "released" else f"Not released: {comment or 'no reason given'}.")
        notify_user(db, rel.requested_by_id, f"Credit release {rel.release_number} {rel.status}", msg,
                    "credit_release_decided", ET_CREDIT_RELEASE, rel.id)
    # Role event (core/events/accounts_b.py); the requester was told above.
    from app.modules.accounts import role_events_b
    role_events_b.fire(
        db, "credit_release_decided", title=f"Credit release {rel.release_number} {rel.status}",
        message=(f"{actor.name or actor.email} {outcome} the credit release {rel.release_number}"
                 + (f" (valid until {rel.valid_until:%d-%m-%Y})" if rel.status == "released" and rel.valid_until else "")
                 + (f": {comment}" if comment else "") + "."),
        entity_type=ET_CREDIT_RELEASE, entity_id=rel.id, actor=actor, skip={rel.requested_by_id})


register_transaction(TransactionType(
    key=KEY_CREDIT_RELEASE, module_key=MODULE, subtab_key="credit_management", label="Credit block release",
    entity_type=ET_CREDIT_RELEASE, url="/dashboard/finance/outstanding/credit",
    description="A sales order confirmation or a dispatch stopped by the credit check (over the credit limit, or "
                "invoices overdue beyond the customer's credit days) goes ahead only once a Finance approver releases "
                "it — and a Partner as well when the excess is large. The requester can't approve their own request.",
    context_fields={"checkpoint": {"label": "Checkpoint", "type": "choice", "choices": list(CREDIT_CHECKPOINTS),
                                   "choice_labels": dict(CREDIT_CHECKPOINTS)},
                    "excess_amount": {"label": "Excess over limit / overdue (₹)", "type": "number"},
                    "max_days_overdue": {"label": "Oldest overdue (days)", "type": "number"}},
    default_stages=[
        StageDef("Finance approver", "permission", {"permission": f"{MODULE}:credit_management:approve"}, approval_mode="any"),
        StageDef("Partner (large excess)", "partner",
                 conditions=[{"field": "excess_amount", "op": "gt", "value": PARTNER_THRESHOLD}]),
    ],
    on_decided=_credit_release_decided, require_permission=True, allow_self_approval=False, distinct_approvers=False,
    comment_required_on_approve=True,
))


# ── Dunning letter: managed Word document ────────────────────────────────

try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover
    managed_documents = None


def letter_or_404(db: Session, letter_id: int):
    from fastapi import HTTPException
    from app.modules.accounts.models.collections import AccountsDunningLetter
    letter = db.query(AccountsDunningLetter).filter(AccountsDunningLetter.id == letter_id).first()
    if not letter:
        raise HTTPException(status_code=404, detail=f"Reminder letter #{letter_id} not found — refresh the page.")
    return letter


def _letter_target(db: Session, entity_id: int, user: User, modify: bool):
    from fastapi import HTTPException
    from app.core.permissions import ensure_feature_action
    from app.modules.accounts.services.collections import letter_spec
    from app.modules.quality.reports.render import render_docx

    letter = letter_or_404(db, entity_id)
    if modify:
        ensure_feature_action(user, "accounts", "collections", "dunning", "edit")
    else:
        ensure_feature_action(user, "accounts", "collections", "dunning", "view")
    if modify and letter.status != "issued":
        raise HTTPException(status_code=409, detail=f"Letter {letter.letter_number} was cancelled — it can't be edited.")
    spec = letter_spec(db, letter)
    return managed_documents.DocumentTarget(
        entity_id=letter.id, revision=0, title=f"Reminder letter {letter.letter_number}",
        folder=managed_documents.sharepoint_folder("Finance", "Reminder-Letters", letter.letter_number),
        filename_stem=managed_documents.safe_filename(f"Reminder-{letter.letter_number}"),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(
        entity_type=ET_DUNNING_LETTER, app=MODULE, load=_letter_target,
        view_grant="accounts:collections.dunning:view", edit_grant="accounts:collections.dunning:edit"))
