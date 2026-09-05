from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem, P2P_PO_STATUSES
from app.modules.p2p.schemas.purchase_order import (
    P2PPurchaseOrderCreate, P2PPurchaseOrderUpdate, P2PPurchaseOrderResponse,
)
from app.modules.p2p.service import generate_po_number, compute_line_total

router = APIRouter(prefix="/p2p/purchase-orders", tags=["P2P Purchase Orders"])


def _to_response(db: Session, po: P2PPurchaseOrder) -> P2PPurchaseOrderResponse:
    resp = P2PPurchaseOrderResponse.model_validate(po)
    if po.p2p_request_id:
        pr = db.query(P2PRequest).filter(P2PRequest.id == po.p2p_request_id).first()
        resp.p2p_request_number = pr.p2p_number if pr else None
    if po.created_by_id:
        creator = db.query(User).filter(User.id == po.created_by_id).first()
        resp.created_by_name = creator.name or creator.email if creator else None
    return resp


@router.get("", response_model=list[P2PPurchaseOrderResponse])
async def list_purchase_orders(
    status: str | None = None,
    search: str | None = None,
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
    pos = query.order_by(P2PPurchaseOrder.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, po) for po in pos]


@router.post("", response_model=P2PPurchaseOrderResponse)
async def create_purchase_order(
    payload: P2PPurchaseOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    po = P2PPurchaseOrder(
        po_number=generate_po_number(db),
        p2p_request_id=payload.p2p_request_id,
        vendor_id=payload.vendor_id,
        vendor_name=payload.vendor_name,
        status="draft",
        po_date=payload.po_date or date.today(),
        expected_delivery=payload.expected_delivery,
        delivery_terms=payload.delivery_terms,
        created_by_id=user.id,
    )
    db.add(po)
    db.flush()

    total = 0.0
    has_pricing = False
    for item in payload.items:
        line_total = compute_line_total(item.quantity, item.unit_price, item.tax_rate)
        if line_total is not None:
            has_pricing = True
            total += line_total
        db.add(P2PPurchaseOrderItem(
            purchase_order_id=po.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            unit_price=item.unit_price,
            tax_rate=item.tax_rate,
            line_total=line_total,
            item_id=item.item_id,
        ))
    po.total_value = round(total, 2) if has_pricing else None

    db.commit()
    db.refresh(po)
    return _to_response(db, po)


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
    _user: User = Depends(require_app_access("purchase")),
):
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(P2PPurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in P2P_PO_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{updates['status']}'")

    for field, val in updates.items():
        setattr(po, field, val)

    db.commit()
    db.refresh(po)
    return _to_response(db, po)
