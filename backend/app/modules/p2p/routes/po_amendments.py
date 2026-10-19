"""ME22N PO amendments and version history.

    GET  /p2p/purchase-orders/{po_id}/amendment-context   lines with received / invoiced floors
    GET  /p2p/purchase-orders/{po_id}/amendments          amendment history
    POST /p2p/purchase-orders/{po_id}/amendments          raise one (goes to approval)
    POST /p2p/purchase-orders/{po_id}/amendments/{id}/withdraw
    GET  /p2p/purchase-orders/{po_id}/versions            v0 (as released) .. vN (after each approved amendment)
    GET  /p2p/purchase-orders/amendments/{id}             one amendment (the approval link opens it)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import ensure_in_scope
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access, require_tab_action
from app.modules.p2p.pricing import mask_for
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.p2p import po_amendments as svc
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.po_amendment import P2PPOAmendment
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.po_split import po_is_released
from app.modules.p2p.schemas.mm_purchasing import POAmendmentCreate, POAmendmentResponse, POAmendmentWithdrawPayload

router = APIRouter(prefix="/p2p/purchase-orders", tags=["P2P - PO amendments"])


def _po(db: Session, po_id: int, user: User) -> P2PPurchaseOrder:
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if po is None:
        raise HTTPException(status_code=404, detail="Purchase order not found — it may have been cancelled. Refresh the page.")
    ensure_in_scope(db, user, po)
    return po


def _out(db: Session, am: P2PPOAmendment, po: P2PPurchaseOrder | None = None, warnings: list[str] | None = None) -> POAmendmentResponse:
    resp = POAmendmentResponse.model_validate(am)
    po = po or db.get(P2PPurchaseOrder, am.purchase_order_id)
    resp.po_number = po.po_number if po else None
    for attr, uid in (("requested_by_name", am.requested_by_id), ("decided_by_name", am.decided_by_id)):
        if uid:
            u = db.get(User, uid)
            setattr(resp, attr, (u.name or u.email) if u else None)
    req = engine.latest_request(db, svc.AMEND_ENTITY, am.id)
    if req is not None:
        resp.approval_request_id = req.id
        if req.status == "pending":
            resp.waiting_on = [s.approver.name or s.approver.email for s in req.steps
                               if s.sequence == req.current_sequence and s.status == "pending" and s.approver is not None]
    resp.warnings = warnings or []
    return resp


@router.get("/amendments/{amendment_id}", response_model=POAmendmentResponse,
            dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
def get_amendment(amendment_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("purchase"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "view")
    am = db.get(P2PPOAmendment, amendment_id)
    if am is None:
        raise HTTPException(status_code=404, detail="PO amendment not found — refresh the page.")
    po = _po(db, am.purchase_order_id, user)
    return mask_for(user, "purchase_orders", _out(db, am, po))


@router.get("/{po_id}/amendment-context", dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
def amendment_context(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("purchase"))):
    """What the Amend PO form needs: each line with what was received /
    invoiced (the quantity floor) and whether its price is still changeable."""
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "view")
    po = _po(db, po_id, user)
    received, invoiced, ses = svc.floors(db, po)
    pending = db.query(P2PPOAmendment).filter(P2PPOAmendment.purchase_order_id == po.id,
                                              P2PPOAmendment.status == "pending_approval").first()
    released = po_is_released(db, po)
    blocked = None
    if po.status in ("draft", "cancelled"):
        blocked = f"PO {po.po_number} is {po.status} — only a released PO is amended."
    elif not released:
        blocked = f"PO {po.po_number} is still in approval — ask the approver to return it for changes instead."
    elif pending:
        blocked = f"Amendment {pending.amendment_no} is waiting for approval."
    return mask_for(user, "purchase_orders", {
        "po_id": po.id, "po_number": po.po_number, "amendment_no": po.amendment_no or 0, "released": released,
        "can_amend": blocked is None, "blocked_reason": blocked, "pending_amendment_id": pending.id if pending else None,
        "expected_delivery": po.expected_delivery, "delivery_terms": po.delivery_terms, "total_value": po.total_value,
        "p2p_request_id": po.p2p_request_id,
        "lines": [{
            **svc.line_snapshot(i), "received_qty": received.get(i.id, 0), "invoiced_qty": invoiced.get(i.id, 0),
            "min_quantity": max(received.get(i.id, 0), invoiced.get(i.id, 0)), "price_locked": invoiced.get(i.id, 0) > 0,
            "can_delete": not (received.get(i.id, 0) or invoiced.get(i.id, 0) or i.id in ses),
        } for i in sorted(po.items, key=lambda x: x.id)],
    })


@router.get("/{po_id}/amendments", response_model=list[POAmendmentResponse],
            dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
def list_amendments(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("purchase"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "view")
    po = _po(db, po_id, user)
    rows = db.query(P2PPOAmendment).filter(P2PPOAmendment.purchase_order_id == po.id).order_by(P2PPOAmendment.amendment_no.desc(),
                                                                                              P2PPOAmendment.id.desc()).all()
    return mask_for(user, "purchase_orders", [_out(db, a, po) for a in rows])


@router.post("/{po_id}/amendments", response_model=POAmendmentResponse,
             dependencies=[Depends(require_tab_action("p2p", "purchase_orders", "edit"))])
def create_amendment(po_id: int, payload: POAmendmentCreate, db: Session = Depends(get_db),
                     user: User = Depends(require_app_access("purchase"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "create")
    po = _po(db, po_id, user)
    pr = db.get(P2PRequest, po.p2p_request_id) if po.p2p_request_id else None
    am, warnings = svc.submit(db, po, pr, payload, user)
    db.commit()
    db.refresh(am)
    return _out(db, am, po, warnings)


@router.post("/{po_id}/amendments/{amendment_id}/withdraw", response_model=POAmendmentResponse,
             dependencies=[Depends(require_tab_action("p2p", "purchase_orders", "edit"))])
def withdraw_amendment(po_id: int, amendment_id: int, payload: POAmendmentWithdrawPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_app_access("purchase"))):
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "cancel")
    po = _po(db, po_id, user)
    am = db.query(P2PPOAmendment).filter(P2PPOAmendment.id == amendment_id, P2PPOAmendment.purchase_order_id == po.id).first()
    if am is None:
        raise HTTPException(status_code=404, detail="Amendment not found on this PO — refresh the page.")
    if am.status != "pending_approval":
        raise HTTPException(status_code=409, detail=f"Amendment {am.amendment_no} is already {am.status.replace('_', ' ')} — nothing to withdraw.")
    req = engine.latest_request(db, svc.AMEND_ENTITY, am.id)
    if req is not None and req.status == "pending":
        engine.cancel(db, req.id, user, (payload.reason or "").strip() or None)
    if am.status == "pending_approval":  # no engine request (or cancel didn't call back)
        am.status = "withdrawn"
    db.commit()
    db.refresh(am)
    return _out(db, am, po)


@router.get("/{po_id}/versions", dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
def po_versions(po_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("purchase"))):
    """Version history: v0 = the PO as first released, then the PO after each
    approved amendment (with what changed and who approved it)."""
    ensure_feature_action(user, "p2p", "purchase_orders", "amendments", "view")
    po = _po(db, po_id, user)
    approved = (db.query(P2PPOAmendment)
                .filter(P2PPOAmendment.purchase_order_id == po.id, P2PPOAmendment.status == "approved")
                .order_by(P2PPOAmendment.amendment_no).all())
    first = approved[0].before if approved else svc.po_snapshot(po)
    out = [{"version": 0, "label": "As released", "snapshot": first, "changes": [], "amendment_id": None}]
    for a in approved:
        who = db.get(User, a.decided_by_id) if a.decided_by_id else None
        out.append({"version": a.amendment_no, "label": f"Amendment {a.amendment_no}", "snapshot": a.after, "changes": a.changes,
                    "reason": a.reason, "amendment_id": a.id, "approved_at": a.decided_at,
                    "approved_by_name": (who.name or who.email) if who else None})
    return mask_for(user, "purchase_orders", out)
