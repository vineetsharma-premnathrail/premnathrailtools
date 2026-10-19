"""Customer amendments to a confirmed order (plan §6.4): draft a proposal
(a copy of the amendable parts of the order), see the diff, submit for the
same value × deviation approval, and apply atomically on final approval."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.sales import service as svc
from app.modules.sales import approvals as sap
from app.modules.sales.access import ensure_amendment, ensure_order
from app.modules.sales.models.amendment import SalesOrderAmendment, SALES_AMENDMENT_OPEN_STATUSES
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.order import SalesOrder, SALES_ORDER_AMENDABLE_STATUSES
from app.modules.sales.schemas.amendment import (
    SalesOrderAmendmentCreate, SalesOrderAmendmentUpdate, SalesOrderAmendmentResponse,
)
from app.modules.sales.schemas.order import SalesOrderReasonPayload, SalesOrderApprovePayload
from app.modules.sales.views import sales_errors, get_order, require_status, amendment_response

router = APIRouter(prefix="/sales", tags=["Sales"], dependencies=[Depends(require_app_access("sales"))])

AMEND_STATUS_LABEL = {"draft": "Draft", "pending_approval": "Pending approval", "approved": "Approved",
                      "rejected": "Rejected", "cancelled": "Cancelled"}


def _get(db: Session, aid: int) -> SalesOrderAmendment:
    a = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.id == aid).first()
    if not a:
        raise HTTPException(status_code=404, detail=f"Amendment #{aid} not found.")
    return a


def _get_locked(db: Session, aid: int) -> SalesOrderAmendment:
    """Row-locks the amendment and its order (SELECT … FOR UPDATE) before loading,
    so two approvers deciding at the same moment can't both pass the same level
    or apply the amendment twice — the second waits and re-checks the status."""
    so_id = db.query(SalesOrderAmendment.so_id).filter(SalesOrderAmendment.id == aid).scalar()
    if so_id:
        # Order first, then amendment — the same order cancel / short-close take, so they can't deadlock.
        db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
        db.query(SalesOrderAmendment.id).filter(SalesOrderAmendment.id == aid).with_for_update().first()
    return _get(db, aid)


def _require(a: SalesOrderAmendment, allowed: tuple[str, ...], action: str) -> None:
    if a.status not in allowed:
        raise HTTPException(status_code=409, detail=f"Can't {action} amendment {a.amendment_no}: it's {AMEND_STATUS_LABEL[a.status]}, "
                                                    f"and this needs {' / '.join(AMEND_STATUS_LABEL[s] for s in allowed)}.")


def _recompute(db: Session, a: SalesOrderAmendment, so) -> None:
    old = svc.snapshot(so)
    a.changes = svc.amendment_diff(old, a.proposed)
    new_total = svc.totals_of(a.proposed["lines"])["grand_total"]
    a.new_grand_total = new_total
    a.value_change = round(new_total - float(so.grand_total or 0), 2)
    a.deviation_flags = svc.deviation_flags(db, a.proposed["header"], a.proposed["billing_plan"])


@router.get("/orders/{so_id}/amendments", response_model=list[SalesOrderAmendmentResponse], dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "view"))])
async def list_amendments(so_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "orders"))):
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    rows = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.so_id == so.id).order_by(SalesOrderAmendment.id.desc()).all()
    return [amendment_response(db, a, so, user=user) for a in rows]


@router.post("/orders/{so_id}/amendments", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "create"))])
async def create_amendment(so_id: int, payload: SalesOrderAmendmentCreate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("sales", "orders", "create"))):
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    require_status(so, SALES_ORDER_AMENDABLE_STATUSES, "amend")
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="Give the reason for the amendment (e.g. the customer's letter asking for a new date).")
    open_a = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.so_id == so.id,
                                                  SalesOrderAmendment.status.in_(SALES_AMENDMENT_OPEN_STATUSES)).first()
    if open_a:
        raise HTTPException(status_code=409, detail=f"Amendment {open_a.amendment_no} of {so.display_number} is still "
                                                    f"{AMEND_STATUS_LABEL[open_a.status].lower()} — finish or cancel it first.")
    a = SalesOrderAmendment(
        so_id=so.id, amendment_no=(so.amendment_no or 0) + 1, reason=payload.reason.strip(),
        customer_amendment_ref=payload.customer_amendment_ref, customer_amendment_date=payload.customer_amendment_date,
        proposed=svc.snapshot(so), changes=[], value_change=0, new_grand_total=so.grand_total, status="draft",
        created_by_id=user.id,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return amendment_response(db, a, so)


@router.get("/amendments/{aid}", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "view"))])
async def get_amendment(aid: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "orders"))):
    a = _get(db, aid)
    ensure_amendment(db, user, a)
    return amendment_response(db, a, user=user)


@router.patch("/amendments/{aid}", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "edit"))])
async def update_amendment(aid: int, payload: SalesOrderAmendmentUpdate, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    a = _get(db, aid)
    _require(a, ("draft",), "edit")
    so = get_order(db, a.so_id)
    ensure_amendment(db, user, a, so)
    data = payload.model_dump(exclude_unset=True)
    for k in ("reason", "customer_amendment_ref", "customer_amendment_date"):
        if k in data:
            setattr(a, k, data[k].strip() if isinstance(data[k], str) else data[k])
    proposed = {k: (list(v) if isinstance(v, list) else dict(v)) for k, v in a.proposed.items()}
    if data.get("header") is not None:
        unknown = [k for k in data["header"] if k not in svc.AMENDABLE_HEADER]
        if unknown:
            raise HTTPException(status_code=422, detail=f"{', '.join(unknown)} can't be changed by an amendment "
                                                        f"(customer, source and numbering are fixed once confirmed).")
        proposed["header"] = {**proposed["header"], **{k: svc._iso(v) for k, v in data["header"].items()}}
    if payload.lines is not None:
        proposed["lines"] = [{k: svc._iso(v) for k, v in ln.model_dump().items()} for ln in payload.lines]
    if payload.schedule is not None:
        proposed["schedule"] = [{k: svc._iso(v) for k, v in r.model_dump().items()} for r in payload.schedule]
    if payload.billing_plan is not None:
        proposed["billing_plan"] = [b.model_dump() for b in payload.billing_plan]
    # New lines need a number so schedule rows can point at them.
    next_no = max([0, *(int(x.get("line_number") or 0) for x in proposed["lines"])]) + 1
    for ln in proposed["lines"]:
        if not ln.get("line_number"):
            ln["line_number"] = next_no
            next_no += 1
    known_ids = {x.get("id") for x in svc.snapshot(so)["lines"]}
    for ln in proposed["lines"]:
        if ln.get("id") and ln["id"] not in known_ids:
            raise HTTPException(status_code=422, detail=f"Line #{ln['id']} isn't on {so.display_number} — reload the amendment.")
    a.proposed = proposed
    _recompute(db, a, so)
    db.commit()
    db.refresh(a)
    return amendment_response(db, a, so)


@router.post("/amendments/{aid}/submit", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "submit"))])
async def submit_amendment(aid: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(require_tab_action("sales", "orders", "submit"))):
    a = _get(db, aid)
    _require(a, ("draft",), "submit")
    so = get_order(db, a.so_id)
    ensure_amendment(db, user, a, so)
    require_status(so, SALES_ORDER_AMENDABLE_STATUSES, "amend")
    _recompute(db, a, so)
    if not a.changes:
        raise HTTPException(status_code=422, detail=f"Amendment {a.amendment_no} doesn't change anything yet — edit the dates, quantities, "
                                                    f"prices or terms the customer's letter asks for, then submit.")
    problems = svc.proposal_problems(db, a.proposed)
    if problems:
        raise HTTPException(status_code=422, detail=[f"Can't submit amendment {a.amendment_no}:"] + problems)
    with sales_errors(db):
        svc.check_removed_rows_buildable(db, so, a.proposed)
    # Routing / notifications / decisions: central approval engine ("Sales order amendment").
    try:
        req = sap.submit_amendment(db, a, so, user)
    except HTTPException:
        db.rollback()
        raise
    from app.modules.sales import events as sales_events
    sales_events.order_event(
        db, background_tasks, "amendment_submitted", so, entity_type="sales_amendment", entity_id=a.id,
        title=f"Amendment {a.amendment_no} of {so.display_number} waiting for approval",
        message=f"{user.name or user.email} submitted amendment {a.amendment_no} of {so.display_number} "
                f"({so.customer_name or 'customer'}): {a.reason}. Review it on the order's Amendments tab or in My Approvals.",
        actor=user, skip_user_ids=sales_events.pending_approver_ids(req),
    )
    db.commit()
    db.refresh(a)
    return amendment_response(db, a, so)


@router.post("/amendments/{aid}/approve", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "approve"))])
async def approve_amendment(aid: int, payload: SalesOrderApprovePayload, db: Session = Depends(get_db),
                            user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    a = _get_locked(db, aid)
    _require(a, ("pending_approval",), "approve")
    so = get_order(db, a.so_id)
    require_status(so, SALES_ORDER_AMENDABLE_STATUSES, f"apply amendment {a.amendment_no} to",
                   "Cancel this amendment — the order is no longer open.")
    if sap.decide_via_engine(db, sap.AMENDMENT_ENTITY, a.id, user, "approve", payload.comment):
        db.commit()
        db.refresh(a)
        return amendment_response(db, a, so)
    what = f"amendment {a.amendment_no} of {so.display_number}"
    level = svc.next_level(db, "sales_amendment", a.id, a.approval_round, a.required_approval_level)
    if not level:
        raise HTTPException(status_code=409, detail=f"{what} has every approval it needs already — refresh the page.")
    with sales_errors(db):
        stand_in = svc.check_approver(db, user, entity_type="sales_amendment", entity_id=a.id, rnd=a.approval_round, level=level,
                                      maker_id=a.submitted_by_id, comment=payload.comment, what=what)
    db.add(SalesApproval(entity_type="sales_amendment", entity_id=a.id, revision=a.approval_round, level=level, approver_id=user.id,
                         decision="approved", comment=(payload.comment or "").strip() or None, stand_in=stand_in, decided_at=svc.now_utc()))
    db.flush()
    nxt = svc.next_level(db, "sales_amendment", a.id, a.approval_round, a.required_approval_level)
    if nxt:
        svc.notify_level(db, nxt, a.submitted_by_id, f"Approve {what}",
                         f"{svc.LEVEL_LABEL[level]} approved. {a.reason}. Your approval as {svc.LEVEL_LABEL[nxt]} is next.",
                         "sales_amendment_approval_needed", "sales_order", so.id)
    else:
        with sales_errors(db):
            notes = svc.apply_amendment(db, so, a.proposed)
        a.status = "approved"
        a.approved_by_id, a.approved_at = user.id, svc.now_utc()
        msg = f"{a.reason}. Value change {svc.inr(a.value_change)}." + (" " + " ".join(notes) if notes else "")
        svc.notify_bell(db, [a.submitted_by_id, a.created_by_id, so.sales_owner_id], f"Amendment {a.amendment_no} of {so.so_number} approved",
                        msg, "sales_amendment_approved", "sales_order", so.id, exclude_user_id=user.id)
        if notes:
            svc.notify_bell(db, svc.production_planners(db), f"{so.so_number} amended — builds released", " ".join(notes),
                            "sales_amendment_approved", "sales_order", so.id, exclude_user_id=user.id)
    db.commit()
    db.refresh(a)
    return amendment_response(db, a, so)


@router.post("/amendments/{aid}/reject", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "approve"))])
async def reject_amendment(aid: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    a = _get_locked(db, aid)
    _require(a, ("pending_approval",), "reject")
    so = get_order(db, a.so_id)
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Give a reason for rejecting the amendment.")
    if sap.decide_via_engine(db, sap.AMENDMENT_ENTITY, a.id, user, "reject", reason):
        db.commit()
        db.refresh(a)
        return amendment_response(db, a, so)
    level = svc.next_level(db, "sales_amendment", a.id, a.approval_round, a.required_approval_level) or "sales_head"
    with sales_errors(db):
        stand_in = svc.check_approver(db, user, entity_type="sales_amendment", entity_id=a.id, rnd=a.approval_round, level=level,
                                      maker_id=a.submitted_by_id, comment=reason, what=f"amendment {a.amendment_no} of {so.display_number}")
    db.add(SalesApproval(entity_type="sales_amendment", entity_id=a.id, revision=a.approval_round, level=level, approver_id=user.id,
                         decision="rejected", comment=reason, stand_in=stand_in, decided_at=svc.now_utc()))
    a.status = "rejected"
    a.rejection_reason = reason
    svc.notify_bell(db, [a.submitted_by_id, a.created_by_id], f"Amendment {a.amendment_no} of {so.display_number} rejected", reason,
                    "sales_amendment_rejected", "sales_order", so.id, exclude_user_id=user.id)
    db.commit()
    db.refresh(a)
    return amendment_response(db, a, so)


@router.post("/amendments/{aid}/cancel", response_model=SalesOrderAmendmentResponse, dependencies=[Depends(require_feature_action("sales", "orders", "amendments", "cancel"))])
async def cancel_amendment(aid: int, db: Session = Depends(get_db), user: User = Depends(require_tab_action("sales", "orders", "cancel"))):
    a = _get_locked(db, aid)
    _require(a, SALES_AMENDMENT_OPEN_STATUSES, "cancel")
    if user.role != "admin" and user.id not in (a.created_by_id, a.submitted_by_id):
        raise HTTPException(status_code=403, detail="Only the person who raised this amendment (or an admin) can cancel it.")
    svc.withdraw_approval(db, sap.AMENDMENT_ENTITY, a.id, user, f"Amendment {a.amendment_no} cancelled")
    a.status = "cancelled"
    db.commit()
    db.refresh(a)
    return amendment_response(db, a)
