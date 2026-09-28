from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from sqlalchemy import func

from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.models.material_return import (
    STORE_RETURN_CONDITIONS,
    STORE_RETURN_SOURCE_TYPES,
    StoreMaterialReturn,
    StoreMaterialReturnItem,
)
from app.modules.store.schemas.material_return import StoreMaterialReturnCreate, StoreMaterialReturnResponse
from app.modules.store.service import generate_material_return_number
from app.modules.store.services.stock_ledger import post_stock_transaction

router = APIRouter(prefix="/store/material-returns", tags=["Store"])


def _to_response(db: Session, ret: StoreMaterialReturn) -> StoreMaterialReturnResponse:
    location = db.query(StoreLocation).filter(StoreLocation.id == ret.location_id).first()
    source_issue = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == ret.source_issue_id).first() if ret.source_issue_id else None
    returner = db.query(User).filter(User.id == ret.returned_by_id).first() if ret.returned_by_id else None
    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([it.item_id for it in ret.items])).all()} if ret.items else {}

    resp = StoreMaterialReturnResponse.model_validate(ret)
    resp.location_name = location.name if location else None
    resp.source_issue_number = source_issue.issue_number if source_issue else None
    resp.returned_by_name = returner.name if returner else None
    for line, item_resp in zip(ret.items, resp.items):
        item = items_by_id.get(line.item_id)
        item_resp.item_code = item.item_code if item else None
        item_resp.item_name = item.item_name if item else None
        item_resp.uom = item.uom if item else None
    return resp


@router.get("", response_model=list[StoreMaterialReturnResponse])
async def list_material_returns(
    location_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    query = db.query(StoreMaterialReturn).options(selectinload(StoreMaterialReturn.items))
    if location_id is not None:
        query = query.filter(StoreMaterialReturn.location_id == location_id)
    returns = query.order_by(StoreMaterialReturn.created_at.desc()).all()
    return [_to_response(db, r) for r in returns]


@router.get("/{return_id}", response_model=StoreMaterialReturnResponse)
async def get_material_return(
    return_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    ret = db.query(StoreMaterialReturn).options(selectinload(StoreMaterialReturn.items)).filter(StoreMaterialReturn.id == return_id).first()
    if not ret:
        raise HTTPException(status_code=404, detail="Material return not found")
    return _to_response(db, ret)


@router.post("", response_model=StoreMaterialReturnResponse)
async def create_material_return(
    payload: StoreMaterialReturnCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("store")),
):
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")
    if payload.source_type not in STORE_RETURN_SOURCE_TYPES:
        raise HTTPException(status_code=422, detail=f"source_type must be one of {STORE_RETURN_SOURCE_TYPES}")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Warehouse not found")
    if payload.source_issue_id and not db.query(StoreMaterialIssue).filter(StoreMaterialIssue.id == payload.source_issue_id).first():
        raise HTTPException(status_code=404, detail="Source material issue not found")

    items_by_id = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_([p.item_id for p in payload.items])).all()}
    for p in payload.items:
        if p.item_id not in items_by_id:
            raise HTTPException(status_code=422, detail=f"Item {p.item_id} not found")
        if p.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"Quantity for '{items_by_id[p.item_id].item_name}' must be greater than zero")
        if p.condition not in STORE_RETURN_CONDITIONS:
            raise HTTPException(status_code=422, detail=f"condition must be one of {STORE_RETURN_CONDITIONS}")

    # A return against a specific issue can only return what that issue
    # actually issued, per item, net of whatever's already been returned
    # against it — otherwise a return could be filed for an unrelated item
    # or quantity that was never issued, or the same issue could be
    # "returned against" without limit.
    if payload.source_issue_id:
        issued_qty_by_item: dict[int, float] = {}
        for issue_item in db.query(StoreMaterialIssueItem).filter(StoreMaterialIssueItem.issue_id == payload.source_issue_id).all():
            issued_qty_by_item[issue_item.item_id] = issued_qty_by_item.get(issue_item.item_id, 0.0) + issue_item.quantity

        already_returned_by_item: dict[int, float] = dict(
            db.query(StoreMaterialReturnItem.item_id, func.sum(StoreMaterialReturnItem.quantity))
            .join(StoreMaterialReturn, StoreMaterialReturnItem.return_id == StoreMaterialReturn.id)
            .filter(StoreMaterialReturn.source_issue_id == payload.source_issue_id)
            .group_by(StoreMaterialReturnItem.item_id)
            .all()
        )

        for p in payload.items:
            issued = issued_qty_by_item.get(p.item_id, 0.0)
            if issued <= 0:
                raise HTTPException(
                    status_code=422,
                    detail=f"Item '{items_by_id[p.item_id].item_name}' was not part of issue #{payload.source_issue_id}",
                )
            already_returned = already_returned_by_item.get(p.item_id, 0.0)
            if already_returned + p.quantity - issued > 1e-9:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Cannot return {p.quantity} of '{items_by_id[p.item_id].item_name}' — only "
                        f"{issued} was issued and {already_returned} already returned against this issue "
                        f"({issued - already_returned} returnable)"
                    ),
                )

    ret = StoreMaterialReturn(
        return_number=generate_material_return_number(db),
        location_id=payload.location_id,
        source_type=payload.source_type,
        source_issue_id=payload.source_issue_id,
        source_description=payload.source_description,
        reason=payload.reason,
        return_date=payload.return_date or date.today(),
        returned_by_id=user.id,
        remarks=payload.remarks,
    )
    db.add(ret)
    db.flush()

    try:
        for p in payload.items:
            db.add(StoreMaterialReturnItem(
                return_id=ret.id, item_id=p.item_id, quantity=p.quantity, condition=p.condition,
                batch_number=p.batch_number, remarks=p.remarks,
            ))
            # Only "good" condition material rejoins usable stock — see
            # STORE_RETURN_CONDITIONS in the model for why damaged/rejected
            # lines don't post a transaction here.
            if p.condition == "good":
                post_stock_transaction(
                    db, item_id=p.item_id, location_id=payload.location_id, transaction_type="return_in",
                    quantity=p.quantity, batch_number=p.batch_number, reference_type="material_return",
                    reference_number=ret.return_number, transaction_date=ret.return_date,
                    created_by_id=user.id,
                )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    db.commit()
    db.refresh(ret)
    ret = db.query(StoreMaterialReturn).options(selectinload(StoreMaterialReturn.items)).filter(StoreMaterialReturn.id == ret.id).first()
    return _to_response(db, ret)
