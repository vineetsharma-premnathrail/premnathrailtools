from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.gl_account import GLAccount
from app.modules.accounts.models.internal_order import InternalOrder, INTERNAL_ORDER_TYPES
from app.modules.accounts.schemas.internal_order import InternalOrderCreate, InternalOrderUpdate, InternalOrderResponse
from app.modules.organization.models.cost_center import CostCenter

router = APIRouter(prefix="/accounts/internal-orders", tags=["Accounts"])


def _to_response(io: InternalOrder, db: Session) -> InternalOrderResponse:
    gl = db.query(GLAccount).filter(GLAccount.id == io.gl_account_id).first() if io.gl_account_id else None
    cc = db.query(CostCenter).filter(CostCenter.id == io.cost_center_id).first() if io.cost_center_id else None
    return InternalOrderResponse.model_validate(io).model_copy(update={
        "gl_account_code": gl.code if gl else None,
        "cost_center_name": cc.name if cc else None,
    })


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
    _user: User = Depends(require_app_access("accounts")),
):
    if payload.order_type not in INTERNAL_ORDER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid order_type '{payload.order_type}'")
    if db.query(InternalOrder).filter(InternalOrder.code == payload.code).first():
        raise HTTPException(status_code=409, detail=f"Internal order code '{payload.code}' already exists")
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
    _user: User = Depends(require_app_access("accounts")),
):
    internal_order = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).first()
    if not internal_order:
        raise HTTPException(status_code=404, detail="Internal order not found")
    if payload.order_type is not None and payload.order_type not in INTERNAL_ORDER_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid order_type '{payload.order_type}'")
    if payload.code and payload.code != internal_order.code:
        if db.query(InternalOrder).filter(InternalOrder.code == payload.code, InternalOrder.id != internal_order_id).first():
            raise HTTPException(status_code=409, detail=f"Internal order code '{payload.code}' already exists")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(internal_order, field, value)
    db.commit()
    db.refresh(internal_order)
    return _to_response(internal_order, db)


@router.delete("/{internal_order_id}")
async def delete_internal_order(
    internal_order_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    internal_order = db.query(InternalOrder).filter(InternalOrder.id == internal_order_id).first()
    if not internal_order:
        raise HTTPException(status_code=404, detail="Internal order not found")
    db.delete(internal_order)
    db.commit()
    return {"ok": True}
