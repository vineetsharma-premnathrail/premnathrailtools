from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.main.models.audit_log import AuditLog
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderUpdate, P2PPurchaseOrderResponse

# POs are only ever created through the RFQ -> PO draft -> submit flow (or
# the legacy PR create-po route), both of which tie the PO to an approved PR
# and enter the Purchase Head -> Director -> MD chain. The old ad-hoc
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


@router.get("", response_model=list[P2PPurchaseOrderResponse])
async def list_purchase_orders(
    status: str | None = None,
    search: str | None = None,
    p2p_request_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    query = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items))
    if status:
        query = query.filter(P2PPurchaseOrder.status == status)
    if search:
        query = query.filter(P2PPurchaseOrder.po_number.ilike(f"%{search}%"))
    if p2p_request_id:
        query = query.filter(P2PPurchaseOrder.p2p_request_id == p2p_request_id)
    pos = query.order_by(P2PPurchaseOrder.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, po) for po in pos]


@router.get("/{po_id}", response_model=P2PPurchaseOrderResponse)
async def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return _to_response(db, po)


@router.patch("/{po_id}", response_model=P2PPurchaseOrderResponse)
async def update_purchase_order(
    po_id: int,
    payload: P2PPurchaseOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    # Status used to be settable here, so a purchase user could mark a PO
    # 'issued' (or an ad-hoc PO with no PR at all) and receive/invoice it
    # with no Purchase Head / Director / MD approval ever recorded.
    if payload.model_extra:
        raise HTTPException(
            status_code=400,
            detail=f"{', '.join(sorted(payload.model_extra))} can't be edited here — only expected delivery and delivery terms can. A PO's status changes only through submit, approval and goods receipt.",
        )

    updates = payload.model_dump(exclude_unset=True, exclude=set(payload.model_extra or {}))
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
