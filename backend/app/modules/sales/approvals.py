"""Sales approvals on the central approval engine (Organization › Approval
Workflows). docs/02-modules/platform/authorization-architecture.md §3.

Two transaction types, both on the Sales › Sales Orders tab (approve / reject):

    sales.order       entity "sales_order"      amount = order grand total
    sales.amendment   entity "sales_amendment"  amount = |value change| of the amendment

Default stages = the chain Sales used before the move (sales/service.py
required_level / levels_up_to), one person per stage (distinct approvers),
never the submitter (no self-approval), approver must hold
sales:orders:approve (require_permission):

    1 Sales Head                          always
    2 Director                            amount > ₹50 lakh
    3 Director — non-standard terms       non-standard terms AND amount ≤ ₹50 lakh
    4 Partner                             amount > ₹2 crore
    5 Partner — non-standard terms        non-standard terms AND amount ≤ ₹2 crore

"Non-standard terms" (any deviation flag: LD uncapped / cap above standard,
warranty above standard, advance below minimum) used to escalate the order to
the Partner level, which meant Sales Head → Director → Partner. Engine stage
conditions are AND-only, so the "OR deviation" half of each level is its own
stage whose amount condition is the complement — exactly one of each pair
applies. The amount limits now live ONLY in these stage conditions (they left
Sales › Settings); the standards that define a deviation stay in Sales ›
Settings because they are contract rules, not routing.

Approvers are resolved by Sales at submit into context lists (record_field
rule) so today's eligibility rules are kept exactly: the Sales Head is the
`sales_head_id` setting else the Sales / BD department head; Directors /
Partners are the flagged users who can open Sales; everyone must hold
'approve' on Sales › Orders; and the order's creator, submitter and sales owner
are excluded (four-eyes — the engine alone only excludes the submitter).

Records submitted before the move (no engine request) finish through the old
level-by-level endpoints (`engine.latest_request(...) is None`)."""
from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.sales import service as svc
from app.modules.sales.models.amendment import SalesOrderAmendment
from app.modules.sales.models.order import SalesOrder, SALES_ORDER_AMENDABLE_STATUSES

ORDER_KEY = "sales.order"
AMENDMENT_KEY = "sales.amendment"
ORDER_ENTITY = "sales_order"
AMENDMENT_ENTITY = "sales_amendment"
ENTITY_OF = {ORDER_KEY: ORDER_ENTITY, AMENDMENT_KEY: AMENDMENT_ENTITY}

# Code defaults of the old Sales settings — the default stage conditions.
DEFAULT_LIMIT_SALES_HEAD = 5000000.0
DEFAULT_LIMIT_DIRECTOR = 20000000.0
LEGACY_LIMIT_KEYS = ("approval_limit_sales_head", "approval_limit_director")

WORKFLOWS_HINT = "Organization › Approval Workflows"

CONTEXT_FIELDS = {
    "sales_head_ids": {"label": "Sales Head (Sales › Settings, else the Sales / BD department head)", "type": "user"},
    "director_ids": {"label": "Directors with Sales approval rights (not the creator / submitter / sales owner)", "type": "user"},
    "partner_ids": {"label": "Partners with Sales approval rights (not the creator / submitter / sales owner)", "type": "user"},
    "has_deviation": {"label": "Non-standard terms (LD cap / warranty / advance outside the Sales › Settings standards)",
                      "type": "bool"},
}


def default_stages(head_limit: float = DEFAULT_LIMIT_SALES_HEAD, director_limit: float = DEFAULT_LIMIT_DIRECTOR) -> list[StageDef]:
    dev = {"field": "has_deviation", "op": "true"}
    return [
        StageDef("Sales Head", "record_field", {"field": "sales_head_ids"}),
        StageDef("Director", "record_field", {"field": "director_ids"},
                 conditions=[{"field": "amount", "op": "gt", "value": head_limit}]),
        StageDef("Director — non-standard terms", "record_field", {"field": "director_ids"},
                 conditions=[dev, {"field": "amount", "op": "lte", "value": head_limit}]),
        StageDef("Partner", "record_field", {"field": "partner_ids"},
                 conditions=[{"field": "amount", "op": "gt", "value": director_limit}]),
        StageDef("Partner — non-standard terms", "record_field", {"field": "partner_ids"},
                 conditions=[dev, {"field": "amount", "op": "lte", "value": director_limit}]),
    ]


# ---------------------------------------------------------------- helpers

def _http(e: svc.SalesError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.detail)


def _decision_comment(req: ApprovalRequest) -> str:
    # A reject / return ends the request, so there is exactly one such step.
    step = next((s for s in req.steps if s.status in ("rejected", "returned")), None)
    return (step.comment if step else None) or "no reason given"


def _order(db: Session, so_id: int) -> SalesOrder:
    from app.modules.sales.views import get_order
    return get_order(db, so_id)


# ---------------------------------------------------------------- on_decided

def _order_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    so = _order(db, req.entity_id)
    if outcome == "approved":
        if so.status != "pending_approval":
            raise HTTPException(status_code=409, detail=f"{so.display_number} is {svc.STATUS_LABEL.get(so.status, so.status)}, "
                                                        f"not pending approval — reload the order.")
        credit = svc.credit_position(db, so)
        if credit and credit.get("blocked"):
            raise HTTPException(status_code=409, detail=svc.credit_block_detail(so, credit))
        try:
            svc.confirm_order(db, so, actor)
        except svc.SalesError as e:
            raise _http(e)
        return
    if outcome == "rejected":
        comment = _decision_comment(req)
        for row in so.schedules:
            row.status = "cancelled"
        so.status = "cancelled"
        so.cancel_reason = f"Rejected by {actor.name or actor.email}: {comment}" + svc.close_followups(db, so, actor, "rejected")
        svc.refresh_line_quantities(so)
        if so.created_by_id and so.created_by_id != req.requester_id:
            svc.notify_bell(db, [so.created_by_id], f"{so.display_number} rejected", f"{actor.name or actor.email}: {comment}",
                            "sales_order_rejected", ORDER_ENTITY, so.id, exclude_user_id=actor.id)
        svc.notify_order_rejected(db, so, actor, comment, returned=False, told={so.created_by_id, req.requester_id})
        return
    if outcome == "returned":
        comment = _decision_comment(req)
        so.status = "draft"
        so.return_comment = comment
        if so.created_by_id and so.created_by_id != req.requester_id:
            svc.notify_bell(db, [so.created_by_id], f"{so.display_number} returned for changes", f"{actor.name or actor.email}: {comment}",
                            "sales_order_returned", ORDER_ENTITY, so.id, exclude_user_id=actor.id)
        svc.notify_order_rejected(db, so, actor, comment, returned=True, told={so.created_by_id, req.requester_id})
        return
    # cancelled = withdrawn by the submitter (back to draft), or the order itself
    # is being cancelled — that route sets its own status afterwards.
    if so.status == "pending_approval":
        so.status = "draft"


def _amendment_decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    a = db.get(SalesOrderAmendment, req.entity_id)
    if a is None:
        raise HTTPException(status_code=404, detail=f"Amendment #{req.entity_id} no longer exists — withdraw this approval request.")
    so = _order(db, a.so_id)
    if outcome == "approved":
        if a.status != "pending_approval":
            raise HTTPException(status_code=409, detail=f"Amendment {a.amendment_no} is {a.status.replace('_', ' ')} — reload the order.")
        if so.status not in SALES_ORDER_AMENDABLE_STATUSES:
            raise HTTPException(status_code=409, detail=f"Can't apply amendment {a.amendment_no} to {so.display_number}: it's "
                                                        f"{svc.STATUS_LABEL.get(so.status, so.status)}. Withdraw this amendment — the order is no longer open.")
        try:
            notes = svc.apply_amendment(db, so, a.proposed)
        except svc.SalesError as e:
            raise _http(e)
        a.status = "approved"
        a.approved_by_id, a.approved_at = actor.id, svc.now_utc()
        msg = f"{a.reason}. Value change {svc.inr(a.value_change)}." + (" " + " ".join(notes) if notes else "")
        svc.notify_bell(db, [a.created_by_id, so.sales_owner_id], f"Amendment {a.amendment_no} of {so.so_number} approved", msg,
                        "sales_amendment_approved", ORDER_ENTITY, so.id, exclude_user_id=actor.id)
        if notes:
            svc.notify_bell(db, svc.production_planners(db), f"{so.so_number} amended — builds released", " ".join(notes),
                            "sales_amendment_approved", ORDER_ENTITY, so.id, exclude_user_id=actor.id)
        _amendment_event(db, a, so, actor, "approved — applied to the order", {a.created_by_id, so.sales_owner_id, req.requester_id})
        return
    if outcome == "rejected":
        a.status = "rejected"
        a.rejection_reason = _decision_comment(req)
        _amendment_event(db, a, so, actor, f"rejected: {a.rejection_reason}", {req.requester_id})
        return
    if outcome == "returned":
        a.status = "draft"  # back to the maker to change and submit again (a new engine request)
        _amendment_event(db, a, so, actor, f"returned for changes: {_decision_comment(req)}", {req.requester_id})
        return
    if a.status == "pending_approval":
        a.status = "draft"


def _amendment_event(db: Session, a: SalesOrderAmendment, so: SalesOrder, actor: User, what: str, told) -> None:
    """Role event `sales.amendment_decided` (the requester is told by the engine)."""
    from app.modules.sales import events as sales_events
    sales_events.order_event(
        db, None, "amendment_decided", so, title=f"Amendment {a.amendment_no} of {so.display_number} {what.split(':')[0]}",
        message=f"{actor.name or actor.email}: amendment {a.amendment_no} of {so.display_number} ({so.customer_name or 'customer'}) {what}",
        actor=actor, skip_user_ids=told,
    )


_COMMON = dict(module_key="sales", subtab_key="orders", context_fields=CONTEXT_FIELDS,
               require_permission=True, distinct_approvers=True, allow_self_approval=False)

register_transaction(TransactionType(
    key=ORDER_KEY, label="Sales order", entity_type=ORDER_ENTITY, url="/dashboard/sales/orders/{id}",
    description="Customer order (PO / LOA) before confirmation — Sales Head, then Director / Partner by order value or "
                "non-standard terms. Confirmation issues the SO number.",
    default_stages=default_stages(), on_decided=_order_decided, **_COMMON,
))
register_transaction(TransactionType(
    key=AMENDMENT_KEY, label="Sales order amendment", entity_type=AMENDMENT_ENTITY,
    # Amendments are shown on their order's page; the engine only knows the amendment id.
    url="/dashboard/sales/amendments/{id}",
    description="Customer amendment of a confirmed order — same chain, by the value change (±) or non-standard terms. "
                "Approval applies the change to the order.",
    default_stages=default_stages(), on_decided=_amendment_decided, **_COMMON,
))


# ---------------------------------------------------------------- the old limit settings

def sync_legacy_limits(db: Session) -> bool:
    """Move the old Sales › Settings amount limits into the approval workflows,
    once. If an admin set custom limits before the move, the stage conditions of
    both workflows take those values (unless the admin already edited the
    workflow in Organization › Approval Workflows — then the workflow wins); the
    old setting rows are then deleted so the limits exist in one place only.
    Returns True when something moved. Flushes, doesn't commit."""
    from app.modules.main.models.module_setting import ModuleSetting
    rows = db.query(ModuleSetting).filter(ModuleSetting.module_key == "sales", ModuleSetting.key.in_(LEGACY_LIMIT_KEYS)).all()
    if not rows:
        return False
    values = {r.key: r.value for r in rows if r.branch_id is None and r.value is not None}
    head = float(values.get("approval_limit_sales_head", DEFAULT_LIMIT_SALES_HEAD))
    director = float(values.get("approval_limit_director", DEFAULT_LIMIT_DIRECTOR))
    swap = {DEFAULT_LIMIT_SALES_HEAD: head, DEFAULT_LIMIT_DIRECTOR: director}
    for key in (ORDER_KEY, AMENDMENT_KEY):
        wf = engine.ensure_workflow(db, key)
        if wf.updated_by_id is not None:
            continue  # an admin already set this workflow up — keep theirs
        changed = False
        for st in wf.stages:
            conds = []
            for c in st.conditions or []:
                c = dict(c)
                if c.get("field") == "amount" and c.get("value") is not None and float(c["value"]) in swap:
                    new = swap[float(c["value"])]
                    changed = changed or new != float(c["value"])
                    c["value"] = new
                conds.append(c)
            st.conditions = conds
            flag_modified(st, "conditions")
        if changed:
            db.add(AuditLog(
                entity_type="approval_workflow", entity_id=wf.id, action="updated", module_key="organization",
                subtab_key="workflows",
                summary=f"Sales approval limits moved from Sales › Settings into '{wf.name}' "
                        f"(Sales Head up to {svc.inr(head)}, Director up to {svc.inr(director)})",
                new_value=json.dumps({"approval_limit_sales_head": head, "approval_limit_director": director}),
            ))
    for r in rows:
        db.delete(r)
    db.flush()
    return True


def migrate_sales_approval_limits(bind) -> None:
    """For an Alembic data migration: op.get_bind() → move the old Sales amount
    limits into the 'sales.order' / 'sales.amendment' approval workflows."""
    from sqlalchemy.orm import Session as _Session
    with _Session(bind=bind) as db:
        if sync_legacy_limits(db):
            db.commit()


# ---------------------------------------------------------------- submit

LEVEL_FIELD = {"sales_head_ids": "sales_head", "director_ids": "director", "partner_ids": "partner"}


def approval_context(db: Session, makers: set[int], flags: list[str]) -> dict:
    cache: dict = {}
    ctx = {field: [u.id for u in svc.eligible_approvers(db, level, makers, cache)] for field, level in LEVEL_FIELD.items()}
    ctx["has_deviation"] = bool(flags)
    ctx["deviations"] = [svc.DEVIATION_LABEL.get(f, f) for f in flags]
    return ctx


def _no_approver_hint(field: str | None) -> str | None:
    if field == "sales_head_ids":
        return ("No Sales Head is set up other than the order's creator / submitter / sales owner (they can't approve their own "
                "order), or the Sales Head lacks 'approve' on Sales › Orders — pick one in Sales › Settings › Sales Head (or mark "
                "the Sales / BD department head) and give them that permission in Organization › Role & Permissions.")
    if field == "director_ids":
        return ("No active Director other than the order's creator / submitter / sales owner can open Sales with 'approve' on "
                "Sales › Orders — give a Director that permission in Organization › Role & Permissions.")
    if field == "partner_ids":
        return ("No active Partner other than the order's creator / submitter / sales owner can open Sales with 'approve' on "
                "Sales › Orders — mark the Partner in Organization › Info › Partners and give them that permission.")
    return None


def routing_problems(db: Session, key: str, requester: User, branch_id: int | None, amount: float, ctx: dict) -> list[str]:
    """Why the chain can't be completed, before submitting — the engine's own
    check plus Sales' precise hints and the one-person-per-stage feasibility
    (distinct approvers) the engine doesn't test up front."""
    wf = engine.ensure_workflow(db, key)
    if not wf.is_active:
        return []
    plan = engine.plan_stages(db, wf, requester=requester, branch_id=branch_id, context={**ctx, "amount": amount})
    out = []
    for p in plan:
        st = p["stage"]
        if p["approver_ids"] or st.skip_if_no_approver:
            continue
        field = (st.rule_config or {}).get("field") if st.approver_rule == "record_field" else None
        out.append(f"Stage '{st.name}': {_no_approver_hint(field) or p['problem']}")
    live = [p for p in plan if p["approver_ids"]]
    if out or not wf.distinct_approvers or len(live) < 2:
        return out
    candidates = {f"{i}": p["approver_ids"] for i, p in enumerate(live)}
    if svc.distinct_assignment(candidates) is None:
        everyone = sorted({uid for p in live for uid in p["approver_ids"]})
        names = svc.user_names(db, everyone)
        who = "; ".join(f"{p['stage'].name}: {', '.join(names.get(i, f'user #{i}') for i in p['approver_ids'])}" for p in live)
        out.append(f"The approval chain {' → '.join(p['stage'].name for p in live)} needs {len(live)} different people "
                   f"(one person approves only one stage), but only {len(everyone)} eligible approver(s) exist ({who}). "
                   f"Give another Director / Partner the Sales module and 'approve' on Sales › Orders, set a different Sales Head "
                   f"in Sales › Settings, or change the stages in {WORKFLOWS_HINT}.")
    return out


def submit_order(db: Session, so: SalesOrder, user: User, flags: list[str]) -> ApprovalRequest:
    """draft → pending_approval through the engine. Raises 422 with the reasons
    when the chain can't be staffed. Caller commits."""
    sync_legacy_limits(db)
    makers = svc._id_set([so.created_by_id, so.sales_owner_id, user.id])
    ctx = approval_context(db, makers, flags)
    amount = float(so.grand_total or 0)
    gaps = routing_problems(db, ORDER_KEY, user, so.branch_id, amount, ctx)
    if gaps:
        raise HTTPException(status_code=422, detail=[f"Can't submit {so.display_number}:"] + gaps)
    so.deviation_flags, so.required_approval_level = flags, None
    so.status = "pending_approval"
    so.submitted_at, so.submitted_by_id = svc.now_utc(), user.id
    so.approval_round = (so.approval_round or 0) + 1
    so.return_comment = None
    db.flush()
    why = f" Non-standard terms: {', '.join(ctx['deviations'])}." if flags else ""
    return engine.submit(
        db, ORDER_KEY, entity_id=so.id, requester=user, reference=so.display_number,
        title=f"Sales order {so.display_number} — {so.customer_name or 'customer'} (PO {so.customer_po_number}){why}",
        amount=amount, branch_id=so.branch_id, context=ctx,
    )


def submit_amendment(db: Session, a: SalesOrderAmendment, so: SalesOrder, user: User) -> ApprovalRequest:
    sync_legacy_limits(db)
    makers = svc._id_set([a.created_by_id, so.sales_owner_id, user.id])
    flags = list(a.deviation_flags or [])
    ctx = approval_context(db, makers, flags)
    amount = abs(float(a.value_change or 0))
    gaps = routing_problems(db, AMENDMENT_KEY, user, so.branch_id, amount, ctx)
    if gaps:
        raise HTTPException(status_code=422, detail=[f"Can't submit amendment {a.amendment_no}:"] + gaps)
    a.required_approval_level = None
    a.status = "pending_approval"
    a.submitted_at, a.submitted_by_id = svc.now_utc(), user.id
    a.approval_round = (a.approval_round or 0) + 1
    db.flush()
    return engine.submit(
        db, AMENDMENT_KEY, entity_id=a.id, requester=user, reference=f"{so.display_number} A{a.amendment_no}",
        title=f"Amendment {a.amendment_no} of {so.display_number} — {so.customer_name or 'customer'}: {a.reason}"[:300],
        amount=amount, branch_id=so.branch_id, context=ctx,
    )


# ---------------------------------------------------------------- old endpoints / read side

def decide_via_engine(db: Session, entity_type: str, entity_id: int, user: User, decision: str, comment: str | None) -> bool:
    """The module's own approve / return / reject endpoints: route to the engine
    when the record was submitted through it (False = legacy chain, caller
    handles it)."""
    req = engine.latest_request(db, entity_type, entity_id)
    if req is None:
        return False
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"The approval of this record is already {req.status} — reload the page.")
    engine.decide(db, req.id, user, decision, comment)
    return True


def engine_state(db: Session, entity_type: str, entity_id: int) -> tuple[bool, str | None, list[str]]:
    """(went through the engine?, current stage name, names of who can approve it now)."""
    req = engine.latest_request(db, entity_type, entity_id)
    if req is None:
        return False, None, []
    if req.status != "pending":
        return True, None, []
    pending = [s for s in req.steps if s.sequence == req.current_sequence and s.status == "pending"]
    stage = pending[0].stage_name if pending else None
    return True, stage, [s.approver.name or s.approver.email for s in pending if s.approver]


def can_decide(db: Session, user: User, entity_type: str, entity_id: int) -> bool:
    return engine.can_act_on_entity(db, user, entity_type, entity_id)
