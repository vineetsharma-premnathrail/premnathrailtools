from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.production.models.bom import ProductionBom, ProductionBomItem, ProductionBomOperation
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.production.schemas.bom import (
    ProductionBomCreate, ProductionBomUpdate, ProductionBomResponse,
    ProductionBomItemPayload, ProductionBomOperationPayload,
)
from app.modules.production.service import generate_bom_number, bom_standard_cost, item_unit_cost
from app.modules.store.models.item import StoreItem

_CAN_CREATE = require_tab_action("production", "bom", "create")
_CAN_EDIT = require_tab_action("production", "bom", "edit")
_CAN_DELETE = require_tab_action("production", "bom", "delete")
_CAN_APPROVE = require_tab_action("production", "bom", "approve")

router = APIRouter(
    prefix="/production/boms", tags=["Production"],
    dependencies=[Depends(require_app_access("production"))],
)


def _to_responses(db: Session, boms: list[ProductionBom]) -> list[ProductionBomResponse]:
    """Batched: one query per related table for the whole list, not per BOM."""
    if not boms:
        return []
    item_ids = {b.product_item_id for b in boms} | {line.component_item_id for b in boms for line in b.items}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()}
    ws_ids = {op.workstation_id for b in boms for op in b.operations if op.workstation_id}
    workstations = {w.id: w for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_(ws_ids)).all()} if ws_ids else {}
    rates = {w.id: float(w.hourly_rate or 0.0) for w in workstations.values()}
    user_ids = {b.created_by_id for b in boms} | {b.activated_by_id for b in boms}
    user_ids.discard(None)
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    wo_counts = dict(db.query(ProductionWorkOrder.bom_id, func.count(ProductionWorkOrder.id)).filter(
        ProductionWorkOrder.bom_id.in_([b.id for b in boms]), ProductionWorkOrder.is_deleted == False  # noqa: E712
    ).group_by(ProductionWorkOrder.bom_id).all())

    out = []
    for bom in boms:
        resp = ProductionBomResponse.model_validate(bom)
        product = items.get(bom.product_item_id)
        if product:
            resp.product_code, resp.product_name, resp.product_uom = product.item_code, product.item_name, product.uom
        for line in resp.items:
            item = items.get(line.component_item_id)
            if item:
                line.item_code, line.item_name, line.uom = item.item_code, item.item_name, item.uom
                line.unit_cost = item_unit_cost(item)
        for op in resp.operations:
            ws = workstations.get(op.workstation_id)
            op.workstation_name = f"{ws.code} — {ws.name}" if ws else None
        resp.created_by_name = users.get(bom.created_by_id)
        resp.activated_by_name = users.get(bom.activated_by_id)
        resp.standard_material_cost, resp.standard_labour_cost = bom_standard_cost(db, bom, items=items, rates=rates)
        resp.work_order_count = wo_counts.get(bom.id, 0)
        out.append(resp)
    return out


def _to_response(db: Session, bom: ProductionBom) -> ProductionBomResponse:
    return _to_responses(db, [bom])[0]


def _get_or_404(db: Session, bom_id: int) -> ProductionBom:
    bom = db.query(ProductionBom).filter(ProductionBom.is_deleted == False, ProductionBom.id == bom_id).first()  # noqa: E712
    if not bom:
        raise HTTPException(status_code=404, detail=f"BOM #{bom_id} not found")
    return bom


def _require_draft(bom: ProductionBom, action: str) -> None:
    if bom.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"BOM {bom.bom_number} is {bom.status}, so it can't be {action}. "
                   "Use 'New Version' to create an editable draft copy instead.",
        )


def _validate_lines(
    db: Session, product_item_id: int,
    items: list[ProductionBomItemPayload], operations: list[ProductionBomOperationPayload],
) -> None:
    component_ids = [line.component_item_id for line in items]
    if product_item_id in component_ids:
        raise HTTPException(status_code=400, detail="A product can't be a component of its own BOM. Remove it from the component list.")
    if len(component_ids) != len(set(component_ids)):
        raise HTTPException(status_code=400, detail="The same component is listed more than once. Merge the duplicate lines into one quantity.")
    found = {i.id for i in db.query(StoreItem.id).filter(StoreItem.id.in_(component_ids)).all()} if component_ids else set()
    missing = [str(i) for i in component_ids if i not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Component item(s) #{', #'.join(missing)} not found in the Store item master")
    inactive = [i.item_code for i in db.query(StoreItem).filter(StoreItem.id.in_(component_ids), StoreItem.status != "active").all()] if component_ids else []
    if inactive:
        raise HTTPException(status_code=409, detail=f"Component(s) {', '.join(inactive)} are inactive or discontinued in Store. Pick an active replacement or reactivate them in Store first.")

    sequences = [op.sequence for op in operations]
    if len(sequences) != len(set(sequences)):
        raise HTTPException(status_code=400, detail="Two routing operations share the same sequence number. Give each operation a unique sequence (e.g. 10, 20, 30).")
    ws_ids = {op.workstation_id for op in operations if op.workstation_id}
    if ws_ids:
        found_ws = {w.id for w in db.query(ProductionWorkstation.id).filter(
            ProductionWorkstation.id.in_(ws_ids), ProductionWorkstation.is_deleted == False  # noqa: E712
        ).all()}
        missing_ws = [str(i) for i in ws_ids if i not in found_ws]
        if missing_ws:
            raise HTTPException(status_code=404, detail=f"Workstation(s) #{', #'.join(missing_ws)} not found")


def _replace_lines(
    bom: ProductionBom,
    items: list[ProductionBomItemPayload] | None, operations: list[ProductionBomOperationPayload] | None,
) -> None:
    if items is not None:
        bom.items = [
            ProductionBomItem(
                component_item_id=line.component_item_id, quantity=line.quantity,
                scrap_percent=line.scrap_percent, remarks=line.remarks, sort_order=idx,
            )
            for idx, line in enumerate(items)
        ]
    if operations is not None:
        bom.operations = [
            ProductionBomOperation(
                sequence=op.sequence, operation_name=op.operation_name.strip(), workstation_id=op.workstation_id,
                setup_hours=op.setup_hours, run_hours_per_unit=op.run_hours_per_unit,
                requires_inspection=op.requires_inspection, instructions=op.instructions,
            )
            for op in sorted(operations, key=lambda o: o.sequence)
        ]


def _next_version(db: Session, product_item_id: int) -> int:
    last = db.query(func.max(ProductionBom.version)).filter(ProductionBom.product_item_id == product_item_id).scalar()
    return (last or 0) + 1


@router.get("", response_model=list[ProductionBomResponse])
async def list_boms(
    status_filter: str | None = Query(None, alias="status"),
    product_item_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("production", "bom")),
):
    query = db.query(ProductionBom).filter(ProductionBom.is_deleted == False)  # noqa: E712
    if status_filter:
        query = query.filter(ProductionBom.status == status_filter)
    if product_item_id:
        query = query.filter(ProductionBom.product_item_id == product_item_id)
    if search:
        like = f"%{search}%"
        query = query.join(StoreItem, StoreItem.id == ProductionBom.product_item_id).filter(
            (ProductionBom.bom_number.ilike(like)) | (StoreItem.item_name.ilike(like)) | (StoreItem.item_code.ilike(like))
        )
    return _to_responses(db, query.order_by(ProductionBom.created_at.desc()).all())


@router.post("", response_model=ProductionBomResponse)
async def create_bom(
    payload: ProductionBomCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_CREATE),
):
    product = db.query(StoreItem).filter(StoreItem.id == payload.product_item_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product item #{payload.product_item_id} not found in the Store item master")
    if product.status != "active":
        raise HTTPException(status_code=409, detail=f"Product {product.item_code} is {product.status} in Store. Reactivate it in Store before building a BOM for it.")
    _validate_lines(db, payload.product_item_id, payload.items, payload.operations)

    bom = ProductionBom(
        bom_number=generate_bom_number(db),
        product_item_id=payload.product_item_id,
        version=_next_version(db, payload.product_item_id),
        base_quantity=payload.base_quantity,
        description=payload.description,
        remarks=payload.remarks,
        status="draft",
        created_by_id=user.id,
    )
    _replace_lines(bom, payload.items, payload.operations)
    db.add(bom)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom)


@router.get("/{bom_id}", response_model=ProductionBomResponse)
async def get_bom(bom_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, bom_id))


@router.patch("/{bom_id}", response_model=ProductionBomResponse)
async def update_bom(bom_id: int, payload: ProductionBomUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "edited")
    updates = payload.model_dump(exclude_unset=True, exclude={"items", "operations"})
    _validate_lines(
        db, bom.product_item_id,
        payload.items if payload.items is not None else [
            ProductionBomItemPayload(component_item_id=i.component_item_id, quantity=i.quantity, scrap_percent=i.scrap_percent)
            for i in bom.items
        ],
        payload.operations if payload.operations is not None else [],
    )
    for field, val in updates.items():
        setattr(bom, field, val)
    _replace_lines(bom, payload.items, payload.operations)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom)


@router.post("/{bom_id}/activate", response_model=ProductionBomResponse)
async def activate_bom(
    bom_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_APPROVE),
):
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "activated")
    if not bom.items:
        raise HTTPException(status_code=400, detail=f"BOM {bom.bom_number} has no components. Add at least one component before activating it.")
    _validate_lines(
        db, bom.product_item_id,
        [ProductionBomItemPayload(component_item_id=i.component_item_id, quantity=i.quantity, scrap_percent=i.scrap_percent) for i in bom.items],
        [ProductionBomOperationPayload(sequence=o.sequence, operation_name=o.operation_name, workstation_id=o.workstation_id) for o in bom.operations],
    )

    # One active version per product: the previous one becomes obsolete.
    # Work orders already exploded from it keep their own material lines.
    previous = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == bom.product_item_id,
        ProductionBom.status == "active",
        ProductionBom.is_deleted == False,  # noqa: E712
        ProductionBom.id != bom.id,
    ).all()
    for old in previous:
        old.status = "obsolete"

    bom.status = "active"
    bom.activated_by_id = user.id
    bom.activated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom)


@router.post("/{bom_id}/obsolete", response_model=ProductionBomResponse)
async def obsolete_bom(bom_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_APPROVE)):
    bom = _get_or_404(db, bom_id)
    if bom.status != "active":
        raise HTTPException(status_code=409, detail=f"Only an active BOM can be made obsolete — {bom.bom_number} is {bom.status}.")
    bom.status = "obsolete"
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom)


@router.post("/{bom_id}/new-version", response_model=ProductionBomResponse)
async def new_bom_version(
    bom_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("production")),
    _perm: User = Depends(_CAN_CREATE),
):
    source = _get_or_404(db, bom_id)
    existing_draft = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == source.product_item_id,
        ProductionBom.status == "draft",
        ProductionBom.is_deleted == False,  # noqa: E712
    ).first()
    if existing_draft:
        raise HTTPException(
            status_code=409,
            detail=f"{existing_draft.bom_number} (v{existing_draft.version}) is already an open draft for this product. "
                   "Edit or activate that draft instead of starting another one.",
        )
    bom = ProductionBom(
        bom_number=generate_bom_number(db),
        product_item_id=source.product_item_id,
        version=_next_version(db, source.product_item_id),
        base_quantity=source.base_quantity,
        description=source.description,
        remarks=f"Copied from {source.bom_number} v{source.version}",
        status="draft",
        created_by_id=user.id,
    )
    bom.items = [
        ProductionBomItem(component_item_id=i.component_item_id, quantity=i.quantity, scrap_percent=i.scrap_percent, remarks=i.remarks, sort_order=i.sort_order)
        for i in source.items
    ]
    bom.operations = [
        ProductionBomOperation(
            sequence=o.sequence, operation_name=o.operation_name, workstation_id=o.workstation_id, setup_hours=o.setup_hours,
            run_hours_per_unit=o.run_hours_per_unit, requires_inspection=o.requires_inspection, instructions=o.instructions,
        )
        for o in source.operations
    ]
    db.add(bom)
    db.commit()
    db.refresh(bom)
    return _to_response(db, bom)


@router.delete("/{bom_id}")
async def delete_bom(bom_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_DELETE)):
    bom = _get_or_404(db, bom_id)
    _require_draft(bom, "deleted")
    bom.is_deleted = True
    bom.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"BOM {bom.bom_number} deleted"}
