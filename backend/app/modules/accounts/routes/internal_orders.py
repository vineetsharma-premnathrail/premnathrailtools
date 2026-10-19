from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action, ensure_can_delete
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder, INTERNAL_ORDER_TYPES
from app.modules.accounts.schemas.internal_order import InternalOrderCreate, InternalOrderUpdate, InternalOrderResponse
from app.modules.organization.models.cost_center import CostCenter
from fastapi.responses import JSONResponse
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.accounts.schemas.internal_order import InternalOrderStatusPayload
from app.modules.accounts.services import controlling
from app.modules.accounts.services.controlling import IO_TRANSITIONS, IO_STATUS_LABELS
from app.modules.accounts.routes._common import write_audit, who
from app.modules.accounts.access import pending_response

router = APIRouter(prefix="/accounts/internal-orders", tags=["Accounts"])


def _check_dates(start, end) -> None:
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="The order's end date is before its start date — fix one of them.")


def _to_response(io: InternalOrder, db: Session) -> InternalOrderResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == io.gl_account_id).first() if io.gl_account_id else None
    cc = db.query(CostCenter).filter(CostCenter.id == io.cost_center_id).first() if io.cost_center_id else None
    return InternalOrderResponse.model_validate(io).model_copy(update={
        "gl_account_code": gl.code if gl else None,
        "cost_center_name": cc.name if cc else None,
    })


# Shared lookup: pickers on many Finance tabs read this, so any Finance user
# may list it; writes are gated per tab below.
@router.get("", response_model=list[InternalOrderResponse])
async def list_internal_orders(
    status: str | None = Query(None),
    cost_center_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    query = db.query(InternalOrder)
    if status is not None:
        query = query.filter(InternalOrder.status == status)
    if cost_center_id is not None:
        query = query.filter(InternalOrder.cost_center_id == cost_center_id)
    orders = query.order_by(InternalOrder.code.asc()).all()
    return [_to_response(o, db) for o in orders]


@router.post("", response_model=InternalOrderResponse, status_code=201)
async def create_internal_order(
    payload: InternalOrderCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("accounts", "internal_orders", "create")),
):
    if payload.order_type not in INTERNAL_ORDER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid order_type '{payload.order_type}'")
    if db.query(InternalOrder).filter(InternalOrder.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Internal order code '{payload.code}' already exists")
    if payload.status not in ("open", "in_progress"):
        raise HTTPException(status_code=400, detail="A new internal order starts as Open or In progress — it is completed and closed later with the status buttons.")
    _check_dates(payload.start_date, payload.end_date)
    internal_order = InternalOrder(**payload.model_dump())
    db.add(internal_order)
    db.commit()
    db.refresh(internal_order)
    return _to_response(internal_order, db)


@router.patch("/{internal_order_id}", response_model=InternalOrderResponse)
async def update_internal_order(
    internal_order_id: int,
    payload: InternalOrderUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("accounts", "internal_orders", "edit")),
):
    internal_order = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).first()
    if not internal_order:
        raise HTTPException(status_code=404, detail="Internal order not found")
    if payload.order_type is not None and payload.order_type not in INTERNAL_ORDER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid order_type '{payload.order_type}'")
    if payload.code and payload.code != internal_order.code:
        if db.query(InternalOrder).filter(InternalOrder.code == payload.code, InternalOrder.id != internal_order_id).first():
            raise HTTPException(status_code=409, detail=f"Internal order code '{payload.code}' already exists")
    if payload.status is not None and payload.status != internal_order.status:
        raise HTTPException(status_code=400, detail=(
            "The status isn't edited here — use the status buttons (Start / Complete / Close / Reopen) on the order, "
            "so the open → in progress → completed → closed sequence is kept."))
    _check_dates(payload.start_date if payload.start_date is not None else internal_order.start_date,
                 payload.end_date if payload.end_date is not None else internal_order.end_date)
    for field, value in payload.model_dump(exclude_unset=True, exclude={"status"}).items():
        setattr(internal_order, field, value)
    db.commit()
    db.refresh(internal_order)
    return _to_response(internal_order, db)


@router.delete("/{internal_order_id}")
async def delete_internal_order(
    internal_order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "internal_orders")),
):
    internal_order = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).first()
    if not internal_order:
        raise HTTPException(status_code=404, detail="Internal order not found")
    ensure_can_delete(user, internal_order, "accounts", "internal_orders", what="internal order")
    # ERP standard: an internal order that has been posted to is never
    # hard-deleted — it is closed, so ledger lines keep a valid reference and
    # the audit trail stays intact. Counted explicitly: the DB FK error can't
    # name the lines, and SQLite (tests) doesn't enforce FKs.
    from app.modules.accounts.models.journal_entry import JournalEntryLine

    line_count = db.query(JournalEntryLine).filter(JournalEntryLine.internal_order_id == internal_order_id).count()
    if line_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Internal order '{internal_order.code}' has {line_count} posted journal line(s) and can't be deleted "
                "— close it instead (status Closed) so no new postings are allowed."
            ),
        )
    from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
    from app.modules.accounts.models.vendor_invoice import VendorInvoiceLine
    from app.modules.accounts.models.ar_transaction import ARTransactionLine
    from app.modules.accounts.models.payment_transaction import PaymentLine

    uses = [
        (db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.internal_order_id == internal_order_id).count(), "purchase order(s)"),
        (db.query(VendorInvoiceLine).filter(VendorInvoiceLine.internal_order_id == internal_order_id).count(), "purchase invoice line(s)"),
        (db.query(ARTransactionLine).filter(ARTransactionLine.internal_order_id == internal_order_id).count(), "sales invoice line(s)"),
        (db.query(PaymentLine).filter(PaymentLine.internal_order_id == internal_order_id).count(), "payment line(s)"),
    ]
    used = [f"{n} {what}" for n, what in uses if n]
    if used:
        raise HTTPException(status_code=409, detail=(
            f"Internal order '{internal_order.code}' is used on {', '.join(used)} and can't be deleted — close it instead "
            "so no new postings are allowed."))
    db.delete(internal_order)
    db.commit()
    return {"ok": True}


# ── Status (KO02 release / TECO / close / reopen) ───────────────────────

ET_INTERNAL_ORDER = "accounts_internal_order"
KEY_IO_REOPEN = "accounts.internal_order_reopen"


def _reopen_decided(db: Session, req, outcome: str, actor: User) -> None:
    if outcome != "approved":
        return
    io = db.query(InternalOrder).filter(InternalOrder.id == req.entity_id).first()
    if io is None or io.status != "closed":
        return
    io.status = "in_progress"
    write_audit(db, "internal_order", io.id, "reopened", actor,
                f"Internal order {io.code} reopened (approved by {who(actor)}): {(req.context or {}).get('reason') or ''}".strip())


register_transaction(TransactionType(
    key=KEY_IO_REOPEN, module_key="accounts", subtab_key="internal_orders", label="Reopen closed internal order",
    entity_type=ET_INTERNAL_ORDER, url="/dashboard/finance/masters",
    description="A closed internal order takes postings again only after a Partner approves reopening it.",
    context_fields={"reason": {"label": "Reason", "type": "text"}},
    default_stages=[StageDef("Partner", "partner")],
    require_permission=False, allow_self_approval=True, distinct_approvers=False, on_decided=_reopen_decided,
))


@router.post("/{internal_order_id}/status")
async def change_internal_order_status(
    internal_order_id: int,
    payload: InternalOrderStatusPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("accounts", "internal_orders", "edit")),
):
    """open → in_progress → completed → closed; completed → in_progress
    (undo completion). closed → in_progress needs a reason and a Partner's
    approval — a Partner's own click reopens at once, anyone else's waits (202)."""
    io = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).with_for_update().first()
    if not io:
        raise HTTPException(status_code=404, detail="Internal order not found — it may have been deleted. Reload the list.")
    target = payload.status
    allowed = IO_TRANSITIONS.get(io.status, ())
    if target not in allowed:
        nice = ", ".join(IO_STATUS_LABELS[s] for s in allowed) or "nothing"
        raise HTTPException(status_code=400, detail=(
            f"Internal order '{io.code}' is {IO_STATUS_LABELS.get(io.status, io.status)} — it can move to {nice} only, "
            f"not {IO_STATUS_LABELS.get(target, target)}."))
    reason = (payload.reason or "").strip()
    if io.status == "closed":
        if not reason:
            raise HTTPException(status_code=400, detail="Give the reason for reopening a closed order — it goes to the Partner who approves it and on the audit trail.")
        req = engine.submit(db, KEY_IO_REOPEN, entity_id=io.id, requester=user, title=f"Reopen internal order {io.code}",
                            reference=io.code, amount=io.budgeted_amount, context={"reason": reason})
        if req.status == "pending" and engine.can_act_on_entity(db, user, ET_INTERNAL_ORDER, io.id):
            engine.decide(db, req.id, user, "approve", reason)
        db.commit()
        db.refresh(io)
        if req.status != "approved":
            return JSONResponse(status_code=202, content=pending_response(req, f"Reopening internal order {io.code}"))
        return _to_response(io, db)
    if target == "closed":
        open_pos = controlling.io_commitments(db, [io.id]).get(io.id, [])
        if open_pos:
            raise HTTPException(status_code=409, detail=(
                f"Internal order '{io.code}' still has open purchase orders ({', '.join(r['po_number'] for r in open_pos)}) "
                "not yet invoiced — close or invoice them, or move them to another order, before closing it."))
    old = io.status
    io.status = target
    write_audit(db, "internal_order", io.id, "status_changed", user,
                f"{who(user)} moved internal order {io.code} from {IO_STATUS_LABELS[old]} to {IO_STATUS_LABELS[target]}"
                + (f": {reason}" if reason else ""))
    db.commit()
    db.refresh(io)
    return _to_response(io, db)
