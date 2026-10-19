"""Quality on the central authorization framework
(docs/02-modules/platform/authorization-architecture.md).

Data scope — the Quality record tables a user lists / opens are registered
with core.data_scope (owner = who raised / created it, assigned = the
inspector / owner / team working it). Routes call apply_scope on every list,
export and dashboard count and ensure_in_scope on every record route.

Approvals — Quality's approvable documents are transaction types of the
central approval engine (Organization › Approval Workflows). Their default
stages reproduce the routing Quality had before the engine:

  quality.ncr_disposition    NCR disposition — one stage per authority the
                             disposition needs (see NCR_ROLE_TABLE), Partner
                             for scrap above the scrap value limit.
  quality.inspection_plan    Inspection plan — Quality head (plan approvers).
  quality.vendor_block       Vendor block / unblock (AVL) — a Partner.
  quality.vendor_approval    Vendor Trial → Approved (AVL) — Quality head.
  quality.capa_closure       CAPA D8 effectiveness verdict — Quality head.
  quality.complaint_decision Customer complaint close / reject — Quality head.

The last three are "one-click" authority decisions: the authority's click
submits and, because they are the stage's approver, approves in the same
request (one_click below); an admin may add stages later, and then the click
only completes the first stage.

Lot usage decisions and FAI decisions are deliberately NOT engine workflows
(see the Quality migration notes in the module report): they are the
authority's own decision with quantities / stock postings, made many times a
day, and the engine notifies every stage approver on submit.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.data_scope import register_scoped
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.quality.models.capa import QualityCapa, QualityCapaAction, QualityCapaTeamMember
from app.modules.quality.models.customer_complaint import QualityCustomerComplaint
from app.modules.quality.models.first_article import QualityFirstArticle
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.models.inspection_call import QualityInspectionCall
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.inspection_plan import QualityInspectionPlan
from app.modules.quality.models.masters import QUALITY_DISPOSITION_TYPES, QUALITY_DISPOSITION_TYPE_LABELS
from app.modules.quality.models.ncr import QualityNcr, QualityNcrApproval, QUALITY_NCR_APPROVAL_ROLE_LABELS
from app.modules.quality.models.quality_document import QualityDocument
from app.modules.quality.models.supplier_quality import QualityApprovedVendor, QualityVendorAudit

# ── Entity types (= notification entity types, see NotificationBell ENTITY_LINK) ──
NCR_ENTITY = "quality_ncr"
PLAN_ENTITY = "quality_inspection_plan"
AVL_ENTITY = "quality_approved_vendor"
CAPA_ENTITY = "quality_capa"
COMPLAINT_ENTITY = "quality_complaint"
LOT_ENTITY = "quality_inspection_lot"
FAI_ENTITY = "quality_first_article"

NCR_KEY = "quality.ncr_disposition"
PLAN_KEY = "quality.inspection_plan"
VENDOR_BLOCK_KEY = "quality.vendor_block"
VENDOR_APPROVAL_KEY = "quality.vendor_approval"
CAPA_KEY = "quality.capa_closure"
COMPLAINT_KEY = "quality.complaint_decision"

WORKFLOW_HINT = "Organization › Approval Workflows"


def _http(fn):
    """Run a module service call; its user-facing error becomes an HTTP error
    (on_decided runs inside the central /approvals routes too)."""
    try:
        return fn()
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=getattr(e, "status", 409), detail=str(e))


# ---------------------------------------------------------------------------
# Data scope
# ---------------------------------------------------------------------------

def _capa_team(user):
    return QualityCapa.id.in_(select(QualityCapaTeamMember.capa_id).where(QualityCapaTeamMember.user_id == user.id))


def _capa_action_owner(user):
    return QualityCapa.id.in_(select(QualityCapaAction.capa_id).where(QualityCapaAction.owner_id == user.id))


def _fai_lot_inspector(user):
    return QualityFirstArticle.lot_id.in_(
        select(QualityInspectionLot.id).where(QualityInspectionLot.assigned_to_id == user.id))


# Quality records carry no plant column — plant / department scopes use the
# owner's plant / department (core.data_scope).
register_scoped(QualityNcr, "quality", entity_type=NCR_ENTITY, owner=("raised_by_id",),
                assigned=("disposition_proposed_by_id",), label="NCR")
register_scoped(QualityInspectionLot, "quality", entity_type=LOT_ENTITY, owner=("created_by_id",),
                assigned=("assigned_to_id", "results_recorded_by_id"), label="inspection lot")
register_scoped(QualityInspection, "quality", owner=("inspected_by_id",), label="inspection")
register_scoped(QualityCapa, "quality", entity_type=CAPA_ENTITY, owner=("created_by_id",),
                assigned=("responsible_user_id", _capa_team, _capa_action_owner), label="CAPA")
register_scoped(QualityCustomerComplaint, "quality", entity_type=COMPLAINT_ENTITY, owner=("received_by_id",),
                assigned=("owner_id",), label="customer complaint")
register_scoped(QualityInspectionCall, "quality", owner=("created_by_id",), assigned=("result_recorded_by_id",),
                label="inspection call")
register_scoped(QualityFirstArticle, "quality", entity_type=FAI_ENTITY, owner=("created_by_id",),
                assigned=(_fai_lot_inspector,), label="first article")
register_scoped(QualityApprovedVendor, "quality", entity_type=AVL_ENTITY, owner=("created_by_id",),
                assigned=("pending_requested_by_id", "approved_by_id"), label="approved-vendor record")
register_scoped(QualityVendorAudit, "quality", owner=("created_by_id",), assigned=("auditor_id",), label="vendor audit")
register_scoped(QualityDocument, "quality", owner=("uploaded_by_id",), label="quality document")


# ---------------------------------------------------------------------------
# Assign-to rules (core/assignee_rules.py — set per role on the feature's row
# of Role & Permissions). Keys are registered in core/features/quality.py.
# ---------------------------------------------------------------------------

LOT_INSPECTOR_RULE = "quality:inspection_lots.assign"
CAPA_OWNER_RULE = "quality:capa.owner"
CAPA_TEAM_RULE = "quality:capa.team"
CAPA_ACTION_RULE = "quality:capa.actions"
COMPLAINT_OWNER_RULE = "quality:complaints.owner"
AUDITOR_RULE = "quality:supplier_quality.audits"


def ensure_may_assign(db: Session, user: User, key: str, person_id: int | None, current_id: int | None = None) -> None:
    """403 when `user`'s role may not pick `person_id` in this field. Checked
    only when the pick changes; an unknown / inactive id is left to the
    service's own validation (it gives the real reason)."""
    from app.core import assignee_rules

    if not person_id or person_id == current_id:
        return
    person = db.get(User, person_id)
    if person is not None:
        assignee_rules.ensure_allowed(db, user, key, person)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def system_requester(name: str) -> User:
    """A transient (never saved) requester for submissions the system makes
    (e.g. the monthly vendor rating proposing a block)."""
    return User(name=name, email="quality-system@premnathrail.local", role="user", is_active=True)


def pending_request(db: Session, entity_type: str, entity_id: int):
    req = engine.latest_request(db, entity_type, entity_id)
    return req if req is not None and req.status == "pending" else None


def _can_decide(db: Session, req, user: User) -> bool:
    return bool(engine.request_out(db, req, user).get("can_decide"))


def one_click(db: Session, key: str, *, entity_id: int, actor: User, title: str, reference: str | None = None,
              proposal: dict | None = None, context: dict | None = None, amount: float | None = None,
              comment: str | None = None):
    """Submit `proposal` for approval and approve every stage the actor can
    decide right away — today's one-click authority decision, now recorded
    in the engine. Stages an admin added for others stay pending; the
    proposal is applied by the type's on_decided once the request is
    approved. A request already waiting for the actor is approved instead
    of resubmitted."""
    tt = engine.get_type(key)
    try:
        req = pending_request(db, tt.entity_type, entity_id)
        if req is not None and req.workflow_key != key:
            other = engine.transaction_types().get(req.workflow_key)
            raise HTTPException(status_code=409, detail=f"{reference or title} is waiting for '{other.label if other else req.workflow_key}' "
                                                        "approval — decide or withdraw that request first (Approval panel on this page).")
        if req is None:
            req = engine.submit(db, key, entity_id=entity_id, requester=actor, title=title, reference=reference,
                                amount=amount, context={**(context or {}), "proposal": proposal or {}})
        elif not _can_decide(db, req, actor):
            raise HTTPException(status_code=409, detail=f"{reference or title} is already waiting for approval — "
                                                        "see the Approval panel on this page.")
        return approve_as(db, req, actor, comment)
    except HTTPException:
        db.rollback()
        raise


def approve_as(db: Session, req, actor: User, comment: str | None = None):
    """Approve every consecutive stage of `req` the actor is an approver of."""
    for _ in range(20):
        if req.status != "pending" or not _can_decide(db, req, actor):
            break
        engine.decide(db, req.id, actor, "approve", comment)
    return req


def _proposal(req) -> dict:
    return dict((req.context or {}).get("proposal") or {})


def _last_comment(req) -> str | None:
    decided = [s for s in req.steps if s.decided_at and s.comment]
    return sorted(decided, key=lambda s: s.decided_at)[-1].comment if decided else None


# ---------------------------------------------------------------------------
# NCR disposition
# ---------------------------------------------------------------------------

# Which authorities each disposition needs (the pre-engine role table of
# services/ncr.py required_roles). Scrap above the scrap value limit also
# needs a Partner (separate stage, condition on scrap_value).
NCR_ROLE_TABLE = {
    "quality_engineer": ["rework", "return_to_vendor"],
    "quality_head": ["use_as_is", "repair", "scrap"],
    "design": ["use_as_is", "repair"],
    "purchase": ["return_to_vendor"],
}
NCR_STAGE_ROLE = {v: k for k, v in QUALITY_NCR_APPROVAL_ROLE_LABELS.items()}  # stage name -> role key
LEGACY_SCRAP_LIMIT = 50000.0


def stored_scrap_limit(db: Session) -> float:
    """The scrap value limit Quality → Settings held before the engine
    (seed for the Partner stage condition and the in-flight legacy path)."""
    from app.modules.quality.models.masters import QualitySetting

    row = db.query(QualitySetting).filter(QualitySetting.key == "scrap_value_limit").first()
    try:
        return float(row.value) if row is not None and row.value is not None else LEGACY_SCRAP_LIMIT
    except (TypeError, ValueError):
        return LEGACY_SCRAP_LIMIT


def ncr_default_stages(scrap_limit: float) -> list[StageDef]:
    """Sequential stages; the authorities used to sign in any order, so the
    order is just 'shop floor first, money last'. distinct_approvers keeps
    the old 'one person signs in one role only' rule."""
    t = NCR_ROLE_TABLE
    return [
        StageDef("Quality engineer", "permission",
                 {"permission": "quality:ncr:edit", "plus_permission": "quality:ncr:approve"},
                 conditions=[{"field": "disposition_type", "op": "in", "value": t["quality_engineer"]}]),
        StageDef("Quality head", "permission", {"permission": "quality:ncr:approve"},
                 conditions=[{"field": "disposition_type", "op": "in", "value": t["quality_head"]}]),
        StageDef("Design", "permission", {"permission": "design:reviews:approve"},
                 conditions=[{"field": "disposition_type", "op": "in", "value": t["design"]}]),
        StageDef("Purchase", "user_flag", {"flag": "is_purchase_head", "plus_permission": "p2p:purchase_desk:view"},
                 conditions=[{"field": "disposition_type", "op": "in", "value": t["purchase"]}]),
        StageDef("Partner", "partner",
                 conditions=[{"field": "disposition_type", "op": "eq", "value": "scrap"},
                             {"field": "scrap_value", "op": "gt", "value": scrap_limit}]),
    ]


def ensure_ncr_workflow(db: Session):
    """Create the stored NCR workflow on first use, seeding the Partner
    stage's limit from the old Quality setting."""
    from app.modules.organization.models.approval import ApprovalWorkflow

    if db.query(ApprovalWorkflow.id).filter(ApprovalWorkflow.key == NCR_KEY).first() is None:
        engine.get_type(NCR_KEY).default_stages = ncr_default_stages(stored_scrap_limit(db))
    return engine.ensure_workflow(db, NCR_KEY)


def scrap_partner_limit(db: Session) -> float | None:
    """The scrap value above which the Partner stage applies, read from the
    workflow (None when an admin removed that condition). Before the
    workflow is first stored, the old Quality setting it will be seeded from."""
    from app.modules.organization.models.approval import ApprovalWorkflow

    wf = db.query(ApprovalWorkflow).filter(ApprovalWorkflow.key == NCR_KEY).first()
    if wf is None:
        return stored_scrap_limit(db)
    for st in wf.stages:
        for c in st.conditions or []:
            if c.get("field") == "scrap_value" and c.get("op") in ("gt", "gte"):
                try:
                    return float(c.get("value"))
                except (TypeError, ValueError):
                    return None
    return None


def submit_ncr_disposition(db: Session, ncr: QualityNcr, user: User):
    ensure_ncr_workflow(db)
    live = pending_request(db, NCR_ENTITY, ncr.id)
    if live is not None:
        engine.cancel(db, live.id, user, "Re-proposed with a new disposition")
    label = QUALITY_DISPOSITION_TYPE_LABELS.get(ncr.disposition_type, ncr.disposition_type)
    return engine.submit(
        db, NCR_KEY, entity_id=ncr.id, requester=user, title=f"{ncr.ncr_number} — {label} of {ncr.item_name}",
        reference=ncr.ncr_number, amount=ncr.estimated_value,
        context={"disposition_type": ncr.disposition_type, "scrap_value": ncr.estimated_value or 0,
                 "severity": ncr.severity, "source": ncr.source},
    )


def ncr_engine_roles(req) -> tuple[list[str], list[str]]:
    """(required, pending) role keys of an engine request (stage names an
    admin added that aren't a known role are returned as-is)."""
    required, pending = [], []
    for s in sorted(req.steps, key=lambda s: s.sequence):
        if s.approver_id is None and s.status == "skipped":
            continue  # stage skipped for want of an approver
        key = NCR_STAGE_ROLE.get(s.stage_name, s.stage_name)
        if key not in required:
            required.append(key)
        if req.status == "pending" and s.status in ("pending", "waiting") and key not in pending:
            pending.append(key)
    return required, pending


def _ncr_decided(db: Session, req, outcome: str, actor: User) -> None:
    from datetime import datetime, timezone

    ncr = db.get(QualityNcr, req.entity_id)
    if ncr is None or ncr.disposition_status != "pending_approval":
        return
    if outcome != "approved":
        ncr.disposition_status = "none"
        return
    # Keep the module's sign-off rows (NCR history, deviation approval
    # document) in step with the engine.
    for s in req.steps:
        if s.status == "approved" and s.decided_by_id:
            ncr.approvals.append(QualityNcrApproval(
                role=NCR_STAGE_ROLE.get(s.stage_name, s.stage_name)[:30], decision="approved",
                disposition_type=ncr.disposition_type, approved_by_id=s.decided_by_id,
                remarks=s.comment or (f"Approved as delegate / stand-in ({s.via})" if s.via not in (None, "direct") else None)))
    ncr.disposition_status = "approved"
    ncr.disposition_decided_at = datetime.now(timezone.utc)
    ncr.status = "disposition_decided"


def _ncr_validate(db: Session, req, step, user: User, decision: str) -> None:
    """Segregation of duties on every path (ApprovalPanel / central decide too):
    whoever recorded the lot results behind a major/critical NCR can't approve
    its disposition as Quality engineer / head."""
    from app.modules.quality.services.ncr import _check_segregation

    if decision != "approve":
        return
    ncr = db.get(QualityNcr, req.entity_id)
    if ncr is not None:
        _http(lambda: _check_segregation(db, ncr, NCR_STAGE_ROLE.get(step.stage_name, step.stage_name), user))


register_transaction(TransactionType(
    key=NCR_KEY, module_key="quality", subtab_key="ncr", label="NCR disposition", entity_type=NCR_ENTITY,
    url="/dashboard/quality/ncr/{id}",
    description="Approval of the disposition proposed on a non-conformance (use as is, rework, repair, return to vendor, scrap).",
    context_fields={
        "disposition_type": {"label": "Disposition", "type": "choice", "choices": list(QUALITY_DISPOSITION_TYPES)},
        "scrap_value": {"label": "Material value (₹)", "type": "number"},
        "severity": {"label": "Severity", "type": "choice", "choices": ["minor", "major", "critical"]},
        "source": {"label": "NCR source", "type": "text"},
    },
    default_stages=ncr_default_stages(LEGACY_SCRAP_LIMIT),
    # Design / Purchase / Partner authorities don't hold a Quality approve
    # grant — the stage rules themselves are the authority, as before.
    require_permission=False,
    # The proposing engineer could sign their own rework / RTV before.
    allow_self_approval=True,
    distinct_approvers=True,
    on_decided=_ncr_decided,
    validate_decision=_ncr_validate,
))


# ---------------------------------------------------------------------------
# Inspection plan
# ---------------------------------------------------------------------------

def submit_plan(db: Session, plan: QualityInspectionPlan, user: User):
    from app.modules.quality.services.plans import validate_for_approval

    _http(lambda: validate_for_approval(db, plan))
    plan.status = "pending_approval"
    db.flush()
    return engine.submit(db, PLAN_KEY, entity_id=plan.id, requester=user,
                         title=f"Inspection plan {plan.plan_number} (rev {plan.revision}) — {plan.item_name}",
                         reference=plan.plan_number, context={"inspection_type": plan.inspection_type})


def _plan_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.quality.services.plans import approve_plan

    plan = db.get(QualityInspectionPlan, req.entity_id)
    if plan is None or plan.status != "pending_approval":
        return
    if outcome != "approved":
        plan.status = "draft"
        return
    plan.status = "draft"  # approve_plan approves drafts
    _http(lambda: approve_plan(db, plan, actor.id))


register_transaction(TransactionType(
    key=PLAN_KEY, module_key="quality", subtab_key="inspection_plans", label="Inspection plan", entity_type=PLAN_ENTITY,
    url="/dashboard/quality/inspection-plans/{id}",
    description="Approval of a draft inspection plan (revision) before lots can use it.",
    context_fields={"inspection_type": {"label": "Inspection type", "type": "text"}},
    default_stages=[StageDef("Quality head", "permission", {"permission": "quality:inspection_plans:approve"})],
    require_permission=True, allow_self_approval=True, on_decided=_plan_decided,
))


# ---------------------------------------------------------------------------
# Supplier quality — vendor block / unblock (Partner) and Trial → Approved
# ---------------------------------------------------------------------------

def submit_vendor_block(db: Session, avl: QualityApprovedVendor, *, action: str, reason: str, user: User | None,
                        item_name: str):
    requester = user or system_requester("Quality — monthly vendor rating")
    verb = "Block" if action == "block" else "Unblock"
    return engine.submit(db, VENDOR_BLOCK_KEY, entity_id=avl.id, requester=requester,
                         title=f"{verb} {avl.vendor_name} for {item_name} — {reason}"[:300],
                         reference=f"{avl.vendor_name} / {item_name}"[:100], context={"action": action})


def _vendor_block_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.quality.services.supplier_quality import apply_pending_decision

    avl = db.get(QualityApprovedVendor, req.entity_id)
    if avl is None or not avl.pending_action:
        return
    _http(lambda: apply_pending_decision(db, avl, approve=outcome == "approved",
                                         note=_last_comment(req) or (None if outcome == "approved" else f"Request {outcome}"),
                                         user=actor, notify_requester=False))


register_transaction(TransactionType(
    key=VENDOR_BLOCK_KEY, module_key="quality", subtab_key="supplier_quality", label="Vendor block / unblock",
    entity_type=AVL_ENTITY, url="/dashboard/quality/supplier-quality/{id}",
    description="Blocking a vendor for an item (or lifting a block) — requested by a Quality head or the monthly rating.",
    context_fields={"action": {"label": "Action", "type": "choice", "choices": ["block", "unblock"]}},
    default_stages=[StageDef("Partner", "partner")],
    # Partners decide as Partners (Company Info → Partners), not by a Quality grant.
    require_permission=False, allow_self_approval=True, on_decided=_vendor_block_decided,
))


def _vendor_approval_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.quality.services import supplier_quality as sq

    if outcome != "approved":
        return
    avl = db.get(QualityApprovedVendor, req.entity_id)
    if avl is not None:
        _http(lambda: sq.approve(db, avl, remarks=_proposal(req).get("remarks"), user=actor))


register_transaction(TransactionType(
    key=VENDOR_APPROVAL_KEY, module_key="quality", subtab_key="supplier_quality", label="Vendor approval (Trial → Approved)",
    entity_type=AVL_ENTITY, url="/dashboard/quality/supplier-quality/{id}",
    description="Approving a Trial vendor for an item that has no first-article control.",
    default_stages=[StageDef("Quality head", "permission", {"permission": "quality:supplier_quality:approve"})],
    require_permission=True, allow_self_approval=True, on_decided=_vendor_approval_decided,
))


# ---------------------------------------------------------------------------
# CAPA D8 effectiveness / closure and customer complaint close / reject
# ---------------------------------------------------------------------------

def _capa_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.quality.services import capa as capa_service

    if outcome != "approved":
        return
    capa = db.get(QualityCapa, req.entity_id)
    if capa is not None:
        p = _proposal(req)
        _http(lambda: capa_service.check_effectiveness(db, capa, effective=bool(p.get("effective")),
                                                       remarks=p.get("remarks"), user=actor))


register_transaction(TransactionType(
    key=CAPA_KEY, module_key="quality", subtab_key="capa", label="CAPA effectiveness (D8)", entity_type=CAPA_ENTITY,
    feature_key="effectiveness",  # inbox decides on CAPA › D8 — Effectiveness & closure › Approve
    url="/dashboard/quality/capa/{id}",
    description="The D8 verdict — effective (closes the CAPA) or not effective (reopens it).",
    context_fields={"effective": {"label": "Verdict: effective", "type": "bool"}},
    default_stages=[StageDef("Quality head", "permission", {"permission": "quality:capa:approve"})],
    require_permission=True, allow_self_approval=True, on_decided=_capa_decided,
))


def _complaint_decided(db: Session, req, outcome: str, actor: User) -> None:
    from app.modules.quality.services import complaints as complaint_service

    if outcome != "approved":
        return
    c = db.get(QualityCustomerComplaint, req.entity_id)
    if c is None:
        return
    p = _proposal(req)
    if p.get("action") == "reject":
        _http(lambda: complaint_service.reject(db, c, reason=p.get("text"), user=actor))
    else:
        _http(lambda: complaint_service.close(db, c, resolution_notes=p.get("text"), user=actor))


register_transaction(TransactionType(
    key=COMPLAINT_KEY, module_key="quality", subtab_key="complaints", label="Customer complaint close / reject",
    entity_type=COMPLAINT_ENTITY, url="/dashboard/quality/complaints/{id}",
    description="Closing a complaint (customer accepted, CAPA effective) or rejecting it as not valid.",
    context_fields={"action": {"label": "Action", "type": "choice", "choices": ["close", "reject"]}},
    default_stages=[StageDef("Quality head", "permission", {"permission": "quality:complaints:approve"})],
    require_permission=True, allow_self_approval=True, on_decided=_complaint_decided,
))


# ---------------------------------------------------------------------------
# Migration helpers (run once by the platform migration; never by Alembic here)
# ---------------------------------------------------------------------------

def migrate_quality_ncr_workflow(bind) -> None:
    """Create the stored 'quality.ncr_disposition' workflow with the Partner
    stage limit taken from Quality → Settings 'scrap_value_limit', then drop
    that setting row (the limit now lives in the workflow)."""
    db = Session(bind=bind)
    try:
        ensure_ncr_workflow(db)
        from app.modules.quality.models.masters import QualitySetting

        db.query(QualitySetting).filter(QualitySetting.key == "scrap_value_limit").delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def migrate_quality_plan_submit_grants(bind) -> None:
    """Give 'quality:inspection_plans:submit' + ':cancel' to every role / user
    that can create inspection plans (the tab gained Submit / Cancel)."""
    from app.core.permission_registry import expand_grants
    from app.modules.main.models.role import Role

    db = Session(bind=bind)
    try:
        create, extra = "quality:inspection_plans:create", ["quality:inspection_plans:submit", "quality:inspection_plans:cancel"]
        for role in db.query(Role).all():
            if create in expand_grants(role.permissions or []):
                role.permissions = list(role.permissions or []) + [g for g in extra if g not in (role.permissions or [])]
        for u in db.query(User).all():
            grants = list(u.granular_permissions or [])
            if create in grants:
                u.granular_permissions = grants + [g for g in extra if g not in grants]
        db.commit()
    finally:
        db.close()
