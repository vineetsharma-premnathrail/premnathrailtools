from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_access, require_tab_action
from app.modules.p2p.pricing import mask_for
import app.modules.p2p.access  # noqa: F401 — registers the Procurement data scopes
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderUpdate, P2PPurchaseOrderResponse, P2PPurchaseOrderItemLinkPayload
from app.modules.p2p.item_link import item_category_for, purchasable_item

# POs are only ever created through the RFQ -> PO draft -> submit flow (or
# the legacy PR create-po route), both of which tie the PO to an approved PR
# and send it into PO approval (p2p/approvals.py). The old ad-hoc
# `POST /p2p/purchase-orders` created a PR-less PO outside that chain and has
# been removed.
router = APIRouter(prefix="/p2p/purchase-orders", tags=["P2P Purchase Orders"])


def _to_response(db: Session, po: P2PPurchaseOrder) -> P2PPurchaseOrderResponse:
    resp = P2PPurchaseOrderResponse.model_validate(po)
    if po.p2p_request_id:
        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
        resp.p2p_request_number = pr.p2p_number if pr else None
        resp.assigned_buyer_id = pr.assigned_buyer_id if pr else None
    if po.created_by_id:
        creator = db.query(User).filter(User.id == po.created_by_id).first()
        resp.created_by_name = creator.name or creator.email if creator else None
    if resp.assigned_buyer_id:
        buyer = db.query(User).filter(User.id == resp.assigned_buyer_id).first()
        resp.assigned_buyer_name = buyer.name or buyer.email if buyer else None
    return resp


@router.get("", response_model=list[P2PPurchaseOrderResponse], dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
async def list_purchase_orders(
    status: str | None = None,
    search: str | None = None,
    p2p_request_id: int | None = None,
    order_project_id: int | None = None,
    order_project_element_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    query = apply_scope(db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)), user, P2PPurchaseOrder)
    if status:
        query = query.filter(P2PPurchaseOrder.status == status)
    if search:
        query = query.filter(P2PPurchaseOrder.po_number.ilike(f"%{search}%"))
    if p2p_request_id:
        query = query.filter(P2PPurchaseOrder.p2p_request_id == p2p_request_id)
    # Order Project filter: POs with at least one line for the project / element.
    if order_project_element_id:
        query = query.filter(P2PPurchaseOrder.items.any(P2PPurchaseOrderItem.order_project_element_id == order_project_element_id))
    elif order_project_id:
        query = query.filter(P2PPurchaseOrder.items.any(P2PPurchaseOrderItem.order_project_id == order_project_id))
    pos = query.order_by(P2PPurchaseOrder.created_at.desc()).offset(skip).limit(limit).all()
    return mask_for(user, "purchase_orders", [_to_response(db, po) for po in pos])


@router.get("/{po_id}", response_model=P2PPurchaseOrderResponse, dependencies=[Depends(require_tab_access("p2p", "purchase_orders"))])
async def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    ensure_in_scope(db, user, po)
    return mask_for(user, "purchase_orders", _to_response(db, po))


@router.patch("/{po_id}", response_model=P2PPurchaseOrderResponse, dependencies=[Depends(require_tab_action("p2p", "purchase_orders", "edit"))])
async def update_purchase_order(
    po_id: int,
    payload: P2PPurchaseOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    ensure_in_scope(db, user, po)

    # Status used to be settable here, so a purchase user could mark a PO
    # 'issued' (or an ad-hoc PO with no PR at all) and receive/invoice it
    # with no Purchase Head / Director / Partner approval ever recorded.
    if payload.model_extra:
        raise HTTPException(
            status_code=400,
            detail=f"{', '.join(sorted(payload.model_extra))} can't be edited here — only expected delivery and delivery terms can. A PO's status changes only through submit, approval and goods receipt.",
        )

    updates = payload.model_dump(exclude_unset=True, exclude=set(payload.model_extra or {}))
    if updates.get("internal_order_id") and updates["internal_order_id"] != po.internal_order_id:
        from app.modules.accounts.models.internal_order import InternalOrder
        from app.modules.accounts.services.controlling import IO_POSTABLE_STATUSES, IO_STATUS_LABELS

        io = db.query(InternalOrder).filter(InternalOrder.id == updates["internal_order_id"]).first()
        if not io:
            raise HTTPException(status_code=400, detail="That internal order doesn't exist — pick it again from the list.")
        if io.status not in IO_POSTABLE_STATUSES:
            raise HTTPException(status_code=400, detail=(
                f"Internal order '{io.code} — {io.name}' is {IO_STATUS_LABELS.get(io.status, io.status)} and can't take new "
                f"purchases — pick an Open or In-progress order, or ask Finance to reopen it."))
    for field, val in updates.items():
        setattr(po, field, val)

    if updates and po.p2p_request_id:
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=po.p2p_request_id, action="po_updated", performed_by_id=user.id,
            summary=f"{user.name or user.email} updated {', '.join(k.replace('_', ' ') for k in updates)} on PO '{po.po_number}'.",
        ))

    db.commit()
    db.refresh(po)
    return _to_response(db, po)


@router.post("/{po_id}/items/{item_id}/link-item", response_model=P2PPurchaseOrderResponse,
             dependencies=[Depends(require_tab_action("p2p", "purchase_orders", "edit"))])
async def link_po_item_to_master(
    po_id: int,
    item_id: int,
    payload: P2PPurchaseOrderItemLinkPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """One-time link of an older PO line (raised before lines carried the
    Item Master id) to its item, so goods can be received into stock. A line
    that is already linked can't be re-pointed — the link is its identity."""
    ensure_feature_action(user, "p2p", "purchase_orders", "link_item", "edit")
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    ensure_in_scope(db, user, po)
    line = next((i for i in po.items if i.id == item_id), None)
    if line is None:
        raise HTTPException(status_code=404, detail=f"Line #{item_id} is not on PO {po.po_number}.")
    if line.store_item_id:
        raise HTTPException(status_code=409, detail=f"'{line.item_name}' is already linked to {line.item_code}. A linked line can't be changed.")
    if po.status in ("fulfilled", "cancelled"):
        raise HTTPException(status_code=409, detail=f"PO {po.po_number} is {po.status}; nothing more can be received, so its lines don't need linking.")
    item = purchasable_item(db, payload.store_item_id, f"'{line.item_name}'")
    line.store_item_id = item.id
    line.item_category = item_category_for(db, item.id)
    if po.p2p_request_id:
        db.add(AuditLog(
            entity_type="p2p_request", entity_id=po.p2p_request_id, action="po_line_linked", performed_by_id=user.id,
            summary=f"{user.name or user.email} linked PO '{po.po_number}' line '{line.item_name}' to Item Master "
                    f"{item.item_code} {item.item_name}.",
        ))
    db.commit()
    db.refresh(po)
    return _to_response(db, po)
import app.modules.p2p.reports.purchase_order  # noqa: E402,F401 — registers the managed Word PO (p2p_purchase_order)
