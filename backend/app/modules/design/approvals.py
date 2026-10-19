"""Design approvals on the central approval engine.

Three transaction types replace Design's own signature routing:

    design.document_revision   drawing/document revision release   (entity design_document = the document)
    design.bom_revision        BOM revision release                 (entity design_bom = the BOM)
    design.change_notice       legacy ECN approval (draft → submitted → approved/rejected) (entity design_ecn)

Default stages reproduce today's behaviour: the checker and approver named
on the revision at submission (record_field on the submission context
`checker_id` / `approver_id`), four-eyes across stages (checker ≠ approver),
the submitter can't approve, and the deciders need design:<tab>:approve.

The entity is the *document* / *BOM* (only one revision of either can be
open at a time), so the approval panel, notifications and My Approvals all
open the record page. The revision being approved is pinned in the request
context (`revision_id`).

Revision status stays Design's own field:
  submit                         → in_review     (set by the route)
  first stage approved           → in_approval   (before_flush hook below — the
                                                  engine has no per-stage callback)
  last stage approved            → released, or `approved` when the customer must
                                   approve first (on_decided)
  returned / rejected            → draft, returned_count + 1 (on_decided)
  withdrawn (cancelled)          → draft (on_decided)

In-flight revisions submitted before the cut-over have no engine request;
the module routes keep finishing them on the old path (see
`pending_request`)."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.change_notice import DesignChangeNotice, DESIGN_ECN_PRIORITIES
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision, DESIGN_DISCIPLINES, DESIGN_DOCUMENT_TYPES
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine

DOC_KEY = "design.document_revision"
BOM_KEY = "design.bom_revision"
ECN_KEY = "design.change_notice"
DOC_ENTITY = "design_document"
BOM_ENTITY = "design_bom"
ECN_ENTITY = "design_ecn"

# session.info key: revision ids whose checker answered the review checklist
# in this request (set by the module's /review routes before engine.decide).
_CHECKLIST_DONE = "design_checklist_passed"


# ---------------------------------------------------------------------------
# Helpers used by the routes
# ---------------------------------------------------------------------------

def pending_request(db: Session, entity_type: str, entity_id: int) -> ApprovalRequest | None:
    """The live engine request of a record, or None — None means the open
    revision (if any) was submitted before the cut-over and finishes on the
    module's old path."""
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def can_decide(db: Session, user: User, entity_type: str, entity_id: int) -> bool:
    """The user is an approver (or delegate / escalation target) of the
    current stage, or an admin who may stand in."""
    if pending_request(db, entity_type, entity_id) is None:
        return False
    return user.role == "admin" or engine.can_act_on_entity(db, user, entity_type, entity_id)


def mark_checklist_done(db: Session, revision_id: int) -> None:
    db.info.setdefault(_CHECKLIST_DONE, set()).add(revision_id)


def stage_status(req: ApprovalRequest) -> str:
    """Design status for a pending request: the request's first stage is
    the check (in_review), any later stage is approval (in_approval)."""
    if not req.steps or req.current_sequence is None:
        return "in_review"
    return "in_review" if req.current_sequence == min(s.sequence for s in req.steps) else "in_approval"


def _decided_steps(req: ApprovalRequest, sequence: int | None = None):
    steps = [s for s in req.steps if s.decided_at is not None and (sequence is None or s.sequence == sequence)]
    from app.modules.design.service import as_aware

    # SQLite hands back naive timestamps for rows already flushed, aware for fresh ones.
    return sorted(steps, key=lambda s: (as_aware(s.decided_at), s.id or 0))


def _last_decision(req: ApprovalRequest):
    steps = _decided_steps(req)
    return steps[-1] if steps else None


def _first_stage_decision(req: ApprovalRequest):
    if not req.steps:
        return None
    first = min(s.sequence for s in req.steps)
    steps = [s for s in _decided_steps(req, first) if s.status == "approved"]
    return steps[-1] if steps else None


def _revision(db: Session, model, req: ApprovalRequest, parent_col: str):
    rid = (req.context or {}).get("revision_id")
    rev = db.get(model, rid) if rid else None
    if rev is None or getattr(rev, parent_col) != req.entity_id or rev.is_deleted:
        rev = db.query(model).filter(
            getattr(model, parent_col) == req.entity_id, model.is_deleted == False,  # noqa: E712
            model.status.in_(("in_review", "in_approval")),
        ).first()
    return rev


def _waiting_ids(req: ApprovalRequest) -> set[int]:
    """Approvers who had the request in front of them when it was withdrawn."""
    return {s.approver_id for s in req.steps if s.activated_at is not None and s.decided_at is None and s.approver_id}


# ---------------------------------------------------------------------------
# Drawings / documents
# ---------------------------------------------------------------------------

def _doc_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.design.access import head_ids
    from app.modules.design.routes.revisions import release_revision
    from app.modules.design.service import add_event, notify, ref, user_name, utcnow

    doc = db.get(DesignDocument, req.entity_id)
    rev = _revision(db, DesignDocumentRevision, req, "document_id")
    if doc is None or rev is None or rev.status not in ("in_review", "in_approval"):
        return
    last = _last_decision(req)
    comment = last.comment if last is not None else None
    entity = DOC_ENTITY
    if outcome == "approved":
        _ensure_second_signature(req, ref(doc, rev))
        _fill_review(rev, req)
        rev.approved_by_id = (last.decided_by_id if last else None) or actor.id
        rev.approved_at = utcnow()
        rev.approval_comment = comment
        if doc.customer_approval_required:
            rev.status = "approved"
            add_event(db, "approved_for_customer", actor, document_id=doc.id, revision_id=rev.id, comment=comment)
            for recipient in {rev.created_by_id, doc.owner_id, *head_ids(db)}:
                notify(
                    db, recipient, actor, f"Ready for customer approval: {ref(doc, rev)}",
                    f"{user_name(actor)} approved {ref(doc, rev)} ({doc.title}) internally. It needs the customer's approval — "
                    "add it to a customer submission in Design › Reviews & Approvals.",
                    "design_revision_approved", entity, doc.id,
                )
            from app.modules.design.events import notify_design_event
            notify_design_event(
                db, None, "customer_approval_needed", doc, entity_type=entity, actor=actor, team_only=True,
                title=f"Ready for customer approval: {ref(doc, rev)}",
                message=f"{ref(doc, rev)} ({doc.title}) is approved internally and needs the customer's approval — "
                        "add it to a customer submission in Design › Reviews & Approvals.",
                skip={rev.created_by_id, doc.owner_id, *head_ids(db)},
            )
        else:
            release_revision(db, doc, rev, actor, comment)
        return
    if outcome in ("returned", "rejected"):
        at_check = rev.status == "in_review"
        rev.status = "draft"
        rev.returned_count += 1
        if at_check:
            rev.reviewed_by_id, rev.reviewed_at, rev.review_comment = actor.id, utcnow(), comment
            add_event(db, "review_returned", actor, document_id=doc.id, revision_id=rev.id, comment=comment)
            recipients = {rev.created_by_id}
            title = f"Returned by checker: {ref(doc, rev)}"
        else:
            rev.approval_comment = comment
            add_event(db, "approval_returned", actor, document_id=doc.id, revision_id=rev.id, comment=comment)
            recipients = {rev.created_by_id, rev.reviewed_by_id}
            title = f"Returned by approver: {ref(doc, rev)}"
        for recipient in recipients - {req.requester_id}:  # the engine already tells the submitter
            notify(db, recipient, actor, title, f"{user_name(actor)} returned {ref(doc, rev)} to draft: {comment}",
                   "design_revision_returned", entity, doc.id)
        from app.modules.design.events import notify_design_event
        notify_design_event(
            db, None, "drawing_returned", doc, entity_type=entity, actor=actor, team_only=True, title=title,
            message=f"{user_name(actor)} returned {ref(doc, rev)} ({doc.title}) to draft: {comment}",
            skip=recipients | {req.requester_id},
        )
        return
    if outcome == "cancelled":
        rev.status = "draft"
        add_event(db, "recalled", actor, document_id=doc.id, revision_id=rev.id, comment=comment)
        for uid in _waiting_ids(req):
            notify(db, uid, actor, f"Recalled: {ref(doc, rev)}",
                   f"{user_name(actor)} recalled {ref(doc, rev)} to draft — no action is needed from you for now.",
                   "design_revision_recalled", entity, doc.id)


def _ensure_second_signature(req: ApprovalRequest, label: str) -> None:
    """Checker and approver are two different people — also when an admin
    stands in (the engine's distinct-approvers rule skips admin stand-ins)."""
    if len({s.sequence for s in req.steps}) < 2:
        return
    first, last = _first_stage_decision(req), _last_decision(req)
    if first is not None and last is not None and first.id != last.id and first.decided_by_id == last.decided_by_id:
        raise HTTPException(
            status_code=403,
            detail=f"You checked {label}, so the approval has to come from someone else — the second signature can't be "
                   "the checker's, even standing in as admin.",
        )


def _fill_review(rev, req: ApprovalRequest) -> None:
    """Record the check signature from the first stage when the request has
    more than one stage (with a single stage there is no separate check)."""
    from app.modules.design.service import utcnow

    if len({s.sequence for s in req.steps}) < 2 or rev.reviewed_by_id:
        return
    step = _first_stage_decision(req)
    if step is not None:
        rev.reviewed_by_id = step.decided_by_id
        rev.reviewed_at = step.decided_at or utcnow()
        rev.review_comment = step.comment


def _bom_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.design.bom_service import bom_ref
    from app.modules.design.routes.boms import release_bom_revision
    from app.modules.design.service import add_event, notify, user_name, utcnow

    bom = db.get(DesignBom, req.entity_id)
    rev = _revision(db, DesignBomRevision, req, "bom_id")
    if bom is None or rev is None or rev.status not in ("in_review", "in_approval"):
        return
    last = _last_decision(req)
    comment = last.comment if last is not None else None
    entity = BOM_ENTITY
    if outcome == "approved":
        _ensure_second_signature(req, bom_ref(bom, rev))
        _fill_review(rev, req)
        # Raises 409 with the blocking lines — the approval then doesn't happen.
        release_bom_revision(db, bom, rev, actor, comment, approved_by_id=(last.decided_by_id if last else None) or actor.id)
        return
    if outcome in ("returned", "rejected"):
        at_check = rev.status == "in_review"
        rev.status = "draft"
        rev.returned_count += 1
        if at_check:
            rev.reviewed_by_id, rev.reviewed_at, rev.review_comment = actor.id, utcnow(), comment
            add_event(db, "bom_review_returned", actor, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
            recipients = {rev.created_by_id}
            title = f"Returned by checker: {bom_ref(bom, rev)}"
        else:
            rev.approval_comment = comment
            add_event(db, "bom_approval_returned", actor, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
            recipients = {rev.created_by_id, rev.reviewed_by_id}
            title = f"Returned by approver: {bom_ref(bom, rev)}"
        for recipient in recipients - {req.requester_id}:
            notify(db, recipient, actor, title, f"{user_name(actor)} returned {bom_ref(bom, rev)} to draft: {comment}",
                   "design_revision_returned", entity, bom.id)
        from app.modules.design.events import notify_design_event
        notify_design_event(
            db, None, "bom_returned", bom, entity_type=entity, actor=actor, team_only=True, title=title,
            message=f"{user_name(actor)} returned {bom_ref(bom, rev)} ({bom.title}) to draft: {comment}",
            skip=recipients | {req.requester_id},
        )
        return
    if outcome == "cancelled":
        rev.status = "draft"
        add_event(db, "bom_recalled", actor, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
        for uid in _waiting_ids(req):
            notify(db, uid, actor, f"Recalled: {bom_ref(bom, rev)}",
                   f"{user_name(actor)} recalled {bom_ref(bom, rev)} to draft — no action is needed from you for now.",
                   "design_revision_recalled", entity, bom.id)


def _ecn_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.design.service import add_event, notify, user_name, utcnow

    ecn = db.get(DesignChangeNotice, req.entity_id)
    if ecn is None or ecn.status != "submitted":
        return
    last = _last_decision(req)
    comment = last.comment if last is not None else None
    if outcome == "approved":
        ecn.status = "approved"
        ecn.decided_by_id = (last.decided_by_id if last else None) or actor.id
        ecn.decided_at = utcnow()
        ecn.decision_comment = comment
        add_event(db, "ecn_approved", actor, ecn_id=ecn.id, comment=comment)
        owners = {
            o for (o,) in db.query(DesignDocument.owner_id).filter(
                DesignDocument.id.in_([d.document_id for d in ecn.documents] or [-1])).all()
        } - {ecn.created_by_id}
        for owner_id in owners:
            notify(
                db, owner_id, actor, f"Revision needed under {ecn.ecn_number}",
                f"{ecn.ecn_number} ({ecn.title}) was approved and affects a document you own — start its next revision under this ECN.",
                "design_ecn_approved", ECN_ENTITY, ecn.id,
            )
    elif outcome == "rejected":
        ecn.status = "rejected"
        ecn.decided_by_id, ecn.decided_at, ecn.decision_comment = actor.id, utcnow(), comment
        add_event(db, "ecn_rejected", actor, ecn_id=ecn.id, comment=comment)
    elif outcome == "returned":
        ecn.status = "draft"
        add_event(db, "ecn_returned", actor, ecn_id=ecn.id, comment=comment)
    elif outcome == "cancelled":
        ecn.status = "draft"
        add_event(db, "ecn_withdrawn", actor, ecn_id=ecn.id, comment=comment)
        for uid in _waiting_ids(req):
            notify(db, uid, actor, f"ECN withdrawn: {ecn.ecn_number}",
                   f"{user_name(actor)} withdrew {ecn.ecn_number} — no decision is needed from you.",
                   "design_ecn_cancelled", ECN_ENTITY, ecn.id)


# ---------------------------------------------------------------------------
# Intermediate status (check passed → in_approval)
# ---------------------------------------------------------------------------

def _advance(session: Session, req: ApprovalRequest) -> None:
    from app.modules.design.checklists import active_checklist
    from app.modules.design.bom_service import bom_ref
    from app.modules.design.service import add_event, ref

    if req.workflow_key == DOC_KEY:
        rev = _revision(session, DesignDocumentRevision, req, "document_id")
        parent = session.get(DesignDocument, req.entity_id)
        checklist = active_checklist(session, parent.document_type, parent.discipline) if parent else None
        label = ref(parent, rev) if parent and rev else "this revision"
    else:
        rev = _revision(session, DesignBomRevision, req, "bom_id")
        parent = session.get(DesignBom, req.entity_id)
        checklist = active_checklist(session, "bom", None)
        label = bom_ref(parent, rev) if parent and rev else "this BOM revision"
    if rev is None or parent is None or rev.status != "in_review" or stage_status(req) != "in_approval":
        return
    step = _first_stage_decision(req)
    # A skipped check stage (no checker) has nobody to answer the checklist.
    if step is not None and checklist and checklist.items and rev.id not in session.info.get(_CHECKLIST_DONE, set()):
        raise HTTPException(
            status_code=409,
            detail=f"{label} has a review checklist ('{checklist.name}'). Open it in Design and pass the check from the "
                   "Check panel with every checklist item answered — it can't be passed from the approval inbox.",
        )
    rev.status = "in_approval"
    if step is not None:
        rev.reviewed_by_id, rev.reviewed_at, rev.review_comment = step.decided_by_id, step.decided_at, step.comment
    actor = session.get(User, step.decided_by_id) if step is not None and step.decided_by_id else None
    if req.workflow_key == DOC_KEY:
        add_event(session, "review_passed", actor, document_id=parent.id, revision_id=rev.id, comment=rev.review_comment)
    else:
        add_event(session, "bom_review_passed", actor, bom_id=parent.id, bom_revision_id=rev.id, comment=rev.review_comment)


def _stage_passed(db: Session, req: ApprovalRequest, sequence: int, actor: User) -> None:
    """Engine hook: the check stage is through → revision goes in_approval."""
    if req.status == "pending" and req.current_sequence is not None:
        _advance(db, req)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

_SIGNATORIES = {
    "checker_id": {"label": "Checker (named at submission)", "type": "user"},
    "approver_id": {"label": "Approver (named at submission)", "type": "user"},
}


def _revision_stages() -> list:
    return [
        engine.StageDef("Check", "record_field", {"field": "checker_id"}),
        engine.StageDef("Approval", "record_field", {"field": "approver_id"}),
    ]


engine.register_transaction(engine.TransactionType(
    feature_key="check_release",  # Drawings/BOMs › Check & release (approve)
    key=DOC_KEY, module_key="design", subtab_key="documents", label="Drawing / document revision release",
    entity_type=DOC_ENTITY, url="/dashboard/design/documents/{id}",
    description="A drawing/document revision is checked by its named checker, then approved by its named approver "
                "and released (or held for the customer's approval when the document needs it).",
    context_fields={
        **_SIGNATORIES,
        "document_type": {"label": "Document type", "type": "choice", "choices": list(DESIGN_DOCUMENT_TYPES)},
        "discipline": {"label": "Discipline", "type": "choice", "choices": list(DESIGN_DISCIPLINES)},
        "customer_approval_required": {"label": "Customer approval required", "type": "bool"},
        "revision_index": {"label": "Revision number (0 = first issue)", "type": "number"},
    },
    default_stages=_revision_stages(),
    require_permission=True, distinct_approvers=True, allow_self_approval=False,
    on_decided=_doc_decided,
    on_stage_passed=_stage_passed,
))

engine.register_transaction(engine.TransactionType(
    feature_key="check_release",  # Drawings/BOMs › Check & release (approve)
    key=BOM_KEY, module_key="design", subtab_key="boms", label="BOM revision release",
    entity_type=BOM_ENTITY, url="/dashboard/design/boms/{id}",
    description="A BOM revision is checked by its named checker, then released by its named approver.",
    context_fields={**_SIGNATORIES, "revision_index": {"label": "Revision number (0 = first issue)", "type": "number"}},
    default_stages=_revision_stages(),
    require_permission=True, distinct_approvers=True, allow_self_approval=False,
    on_decided=_bom_decided,
    on_stage_passed=_stage_passed,
))

engine.register_transaction(engine.TransactionType(
    key=ECN_KEY, module_key="design", subtab_key="change_notices", label="Engineering change notice (without ECR)",
    entity_type=ECN_ENTITY, url="/dashboard/design/change-notices/{id}",
    description="A change notice raised without a change request is approved by the approver named on it. "
                "ECNs created from an approved ECR start approved and don't go through this.",
    context_fields={
        "approver_id": {"label": "Approver (named on the ECN)", "type": "user"},
        "priority": {"label": "Priority", "type": "choice", "choices": list(DESIGN_ECN_PRIORITIES)},
    },
    default_stages=[engine.StageDef("Approval", "record_field", {"field": "approver_id"})],
    require_permission=True, distinct_approvers=False, allow_self_approval=False,
    on_decided=_ecn_decided,
))


# ---------------------------------------------------------------------------
# Data migrations (run once by the central migration; no Alembic file here)
# ---------------------------------------------------------------------------

def migrate_design_submit_cancel_grants(bind) -> None:
    """design:{documents,boms,change_notices}:{submit,cancel} became
    enforced actions. Give them to every role / user extra grant that already
    had `create` on that tab, so nobody loses the ability to submit or
    withdraw. Idempotent."""
    import json

    tabs = ("documents", "boms", "change_notices")

    def widen(perms):
        if not isinstance(perms, list):
            return perms, False
        out = list(perms)
        for tab in tabs:
            if f"design:{tab}:create" in out or "design:*:create" in out:
                for action in ("submit", "cancel"):
                    pid = f"design:{tab}:{action}"
                    if pid not in out:
                        out.append(pid)
        return out, out != perms

    for table, col in (("roles", "permissions"), ("users", "granular_permissions")):
        rows = bind.execute(text(f"SELECT id, {col} FROM {table}")).fetchall()
        for rid, raw in rows:
            perms = json.loads(raw) if isinstance(raw, str) else raw
            new, changed = widen(perms)
            if changed:
                bind.execute(text(f"UPDATE {table} SET {col} = :v WHERE id = :id"), {"v": json.dumps(new), "id": rid})

