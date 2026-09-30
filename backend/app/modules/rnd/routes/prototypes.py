from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.modules.production.models.bom import ProductionBom, ProductionBomItem
from app.modules.production.service import generate_bom_number
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.experiment import RndExperiment
from app.modules.rnd.models.prototype import RndPrototype, RndPrototypeBomItem, RND_PROTOTYPE_STATUSES
from app.modules.rnd.models.document import RndDocument
from app.modules.rnd.schemas.prototype import (
    RndPrototypeBomItemPayload, RndPrototypeCreate, RndPrototypeUpdate, RndPrototypeReleasePayload, RndPrototypeResponse,
)
from app.modules.rnd.service import generate_prototype_number, prototype_bom_cost, user_names

router = APIRouter(
    prefix="/prototypes", tags=["RnD Prototypes"],
    dependencies=[Depends(require_app_access("rnd")), Depends(require_tab_access("rnd", "prototypes"))],
)


def _to_response(db: Session, proto: RndPrototype) -> RndPrototypeResponse:
    resp = RndPrototypeResponse.model_validate(proto)
    for line in resp.bom_items:
        line.line_cost = round((line.quantity or 0) * (line.unit_cost or 0), 2)
    resp.bom_cost = prototype_bom_cost(proto)
    project = db.query(RndProject).filter(RndProject.id == proto.project_id).first()
    if project:
        resp.project_number = project.project_number
        resp.project_title = project.title
    resp.experiment_count = db.query(func.count(RndExperiment.id)).filter(
        RndExperiment.prototype_id == proto.id, RndExperiment.is_deleted == False  # noqa: E712
    ).scalar() or 0
    resp.document_count = db.query(func.count(RndDocument.id)).filter(
        RndDocument.prototype_id == proto.id, RndDocument.is_deleted == False  # noqa: E712
    ).scalar() or 0
    if proto.production_bom_id:
        bom = db.query(ProductionBom).filter(ProductionBom.id == proto.production_bom_id).first()
        if bom:
            resp.production_bom_number = f"{bom.bom_number} (v{bom.version})"
            resp.production_bom_status = "deleted" if bom.is_deleted else bom.status
    if proto.released_by_id:
        resp.released_by_name = user_names(db, [proto.released_by_id]).get(proto.released_by_id)
    return resp


def _get_or_404(db: Session, prototype_id: int) -> RndPrototype:
    proto = (
        db.query(RndPrototype).options(selectinload(RndPrototype.bom_items))
        .filter(RndPrototype.is_deleted == False, RndPrototype.id == prototype_id)  # noqa: E712
        .first()
    )
    if not proto:
        raise HTTPException(status_code=404, detail=f"Prototype #{prototype_id} not found (it may have been deleted).")
    return proto


def _validate_project(db: Session, project_id: int) -> None:
    if not db.query(RndProject).filter(RndProject.id == project_id, RndProject.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"R&D project #{project_id} not found — pick the project again from the list.")


def _build_bom(db: Session, lines: list[RndPrototypeBomItemPayload]) -> list[RndPrototypeBomItem]:
    store_ids = {l.store_item_id for l in lines if l.store_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(store_ids)).all()} if store_ids else {}
    built = []
    for idx, line in enumerate(lines, start=1):
        item = items.get(line.store_item_id) if line.store_item_id else None
        if line.store_item_id and not item:
            raise HTTPException(status_code=404, detail=f"BOM line {idx}: store item #{line.store_item_id} no longer exists. Pick it again or enter the part as free text.")
        name = (line.item_name or "").strip() or (item.item_name if item else "")
        if not name:
            raise HTTPException(status_code=400, detail=f"BOM line {idx} has no item name. Fill it in or remove the line.")
        if line.quantity is None or line.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"BOM line {idx} ({name}): quantity must be greater than 0.")
        if line.unit_cost is not None and line.unit_cost < 0:
            raise HTTPException(status_code=400, detail=f"BOM line {idx} ({name}): unit cost can't be negative.")
        built.append(RndPrototypeBomItem(
            store_item_id=line.store_item_id,
            item_code=(line.item_code or (item.item_code if item else None)),
            item_name=name,
            quantity=line.quantity,
            uom=(line.uom or (item.uom if item else None)),
            unit_cost=line.unit_cost,
            remarks=line.remarks,
        ))
    return built


@router.get("", response_model=list[RndPrototypeResponse])
async def list_prototypes(
    project_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(RndPrototype).options(selectinload(RndPrototype.bom_items)).filter(RndPrototype.is_deleted == False)  # noqa: E712
    if project_id:
        query = query.filter(RndPrototype.project_id == project_id)
    if status_filter:
        query = query.filter(RndPrototype.status == status_filter)
    if search:
        like = f"%{search}%"
        query = query.filter((RndPrototype.name.ilike(like)) | (RndPrototype.prototype_number.ilike(like)))
    return [_to_response(db, p) for p in query.order_by(RndPrototype.created_at.desc()).all()]


@router.post("", response_model=RndPrototypeResponse)
async def create_prototype(
    payload: RndPrototypeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Prototype name is required.")
    if not (payload.version or "").strip():
        raise HTTPException(status_code=400, detail="Prototype version is required (e.g. v1).")
    _validate_project(db, payload.project_id)

    proto = RndPrototype(
        prototype_number=generate_prototype_number(db),
        project_id=payload.project_id,
        name=payload.name.strip(),
        version=payload.version.strip(),
        description=payload.description,
        build_date=payload.build_date,
        status="design",
        created_by_id=user.id,
    )
    proto.bom_items = _build_bom(db, payload.bom_items)
    db.add(proto)
    db.commit()
    return _to_response(db, _get_or_404(db, proto.id))


@router.get("/{prototype_id}", response_model=RndPrototypeResponse)
async def get_prototype(prototype_id: int, db: Session = Depends(get_db)):
    return _to_response(db, _get_or_404(db, prototype_id))


@router.patch("/{prototype_id}", response_model=RndPrototypeResponse)
async def update_prototype(prototype_id: int, payload: RndPrototypeUpdate, db: Session = Depends(get_db)):
    proto = _get_or_404(db, prototype_id)
    updates = payload.model_dump(exclude_unset=True)
    bom_lines = updates.pop("bom_items", None)

    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Prototype name can't be empty.")
    if "version" in updates and not (updates["version"] or "").strip():
        raise HTTPException(status_code=400, detail="Prototype version can't be empty.")
    if updates.get("status") and updates["status"] not in RND_PROTOTYPE_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{updates['status']}'. Valid statuses: {', '.join(RND_PROTOTYPE_STATUSES)}.")
    if updates.get("project_id") is not None and updates["project_id"] != proto.project_id:
        _validate_project(db, updates["project_id"])
        linked = db.query(func.count(RndExperiment.id)).filter(
            RndExperiment.prototype_id == proto.id, RndExperiment.is_deleted == False  # noqa: E712
        ).scalar() or 0
        if linked:
            raise HTTPException(
                status_code=400,
                detail=f"Can't move {proto.prototype_number} to another project: {linked} experiment(s) in its current project reference it.",
            )

    if bom_lines is not None and _is_released(db, proto):
        raise HTTPException(
            status_code=409,
            detail=(
                f"{proto.prototype_number}'s BOM was already released to Production, so it's frozen here. "
                "Create a new prototype version for design changes, or edit the draft BOM in the Production module."
            ),
        )
    if updates.get("project_id") is not None and updates["project_id"] != proto.project_id:
        # Documents attached to this prototype follow it to its new project.
        db.query(RndDocument).filter(RndDocument.prototype_id == proto.id).update(
            {RndDocument.project_id: updates["project_id"]}, synchronize_session=False,
        )
    for field, val in updates.items():
        setattr(proto, field, val)
    if bom_lines is not None:
        proto.bom_items = _build_bom(db, [RndPrototypeBomItemPayload(**l) for l in bom_lines])
    db.commit()
    db.expire_all()
    return _to_response(db, _get_or_404(db, proto.id))


def _is_released(db: Session, proto: RndPrototype) -> bool:
    """True while the Production BOM this prototype was released as still
    exists — deleting that draft in Production un-freezes the prototype."""
    if not proto.production_bom_id:
        return False
    bom = db.query(ProductionBom).filter(ProductionBom.id == proto.production_bom_id).first()
    return bool(bom and not bom.is_deleted)


@router.post("/{prototype_id}/release-to-production", response_model=RndPrototypeResponse)
async def release_to_production(
    prototype_id: int,
    payload: RndPrototypeReleasePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("rnd")),
):
    """Hand the validated prototype's BOM to Production as a *draft*
    ProductionBom for the chosen finished-product item. Production adds the
    routing and activates it — R&D never creates an active BOM directly."""
    proto = _get_or_404(db, prototype_id)
    if _is_released(db, proto):
        bom = db.query(ProductionBom).filter(ProductionBom.id == proto.production_bom_id).first()
        raise HTTPException(
            status_code=409,
            detail=f"{proto.prototype_number} was already released to Production as {bom.bom_number} (v{bom.version}). Open that BOM in the Production module.",
        )
    if proto.status != "validated":
        raise HTTPException(
            status_code=400,
            detail=f"Only a Validated prototype can be released to Production — {proto.prototype_number} is '{proto.status}'. "
                   "Record the passing validation experiments, set the status to Validated, and save first.",
        )
    if not proto.bom_items:
        raise HTTPException(status_code=400, detail=f"{proto.prototype_number} has no BOM lines to release. Add its parts first.")
    unlinked = [f"line {i} ({line.item_name})" for i, line in enumerate(proto.bom_items, start=1) if not line.store_item_id]
    if unlinked:
        raise HTTPException(
            status_code=400,
            detail=(
                "Production BOMs can only use Item Master parts, but these BOM lines are free text: "
                f"{', '.join(unlinked)}. Ask Store to create the items, then pick them on each line and save."
            ),
        )
    component_ids = {line.store_item_id for line in proto.bom_items}
    existing = {i.id for i in db.query(StoreItem.id).filter(StoreItem.id.in_(component_ids)).all()}
    gone = [f"line {i} ({line.item_name})" for i, line in enumerate(proto.bom_items, start=1) if line.store_item_id not in existing]
    if gone:
        raise HTTPException(
            status_code=400,
            detail=f"These BOM lines point to Item Master parts that no longer exist: {', '.join(gone)}. Pick the parts again and save.",
        )
    bad_qty = [f"line {i} ({line.item_name})" for i, line in enumerate(proto.bom_items, start=1) if not line.quantity or line.quantity <= 0]
    if bad_qty:
        raise HTTPException(status_code=400, detail=f"Quantity must be greater than 0 on: {', '.join(bad_qty)}.")
    if payload.base_quantity is None or payload.base_quantity <= 0:
        raise HTTPException(status_code=400, detail="Base quantity must be greater than 0 (usually 1).")
    product = db.query(StoreItem).filter(StoreItem.id == payload.product_item_id).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"Product item #{payload.product_item_id} not found in the Store item master — pick it again.")
    if any(line.store_item_id == product.id for line in proto.bom_items):
        raise HTTPException(
            status_code=400,
            detail=f"{product.item_code} is one of the BOM's own components, so it can't also be the finished product. Pick the finished-goods item.",
        )
    open_draft = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == product.id, ProductionBom.status == "draft", ProductionBom.is_deleted == False,  # noqa: E712
    ).first()
    if open_draft:
        raise HTTPException(
            status_code=409,
            detail=f"{open_draft.bom_number} (v{open_draft.version}) is already an open draft BOM for {product.item_code}. "
                   "Ask Production to activate or delete it before releasing a new version from R&D.",
        )

    # Same part on several prototype lines -> one Production line with the summed quantity.
    merged: dict[int, dict] = {}
    for line in proto.bom_items:
        entry = merged.setdefault(line.store_item_id, {"quantity": 0.0, "remarks": []})
        entry["quantity"] += line.quantity
        if line.remarks:
            entry["remarks"].append(line.remarks)

    last_version = db.query(func.max(ProductionBom.version)).filter(ProductionBom.product_item_id == product.id).scalar()
    project = db.query(RndProject).filter(RndProject.id == proto.project_id).first()
    project_ref = project.project_number if project else f"#{proto.project_id}"
    source = f"Released from R&D {proto.prototype_number} ({proto.version}), project {project_ref}"
    extra = (payload.remarks or "").strip()
    bom = ProductionBom(
        bom_number=generate_bom_number(db),
        product_item_id=product.id,
        version=(last_version or 0) + 1,
        base_quantity=payload.base_quantity,
        description=proto.description,
        remarks=f"{source}. {extra}" if extra else source,
        status="draft",
        created_by_id=user.id,
    )
    bom.items = [
        ProductionBomItem(
            component_item_id=item_id, quantity=v["quantity"], scrap_percent=0.0,
            remarks="; ".join(v["remarks"]) or None, sort_order=idx,
        )
        for idx, (item_id, v) in enumerate(merged.items())
    ]
    db.add(bom)
    db.flush()
    proto.production_bom_id = bom.id
    proto.released_at = datetime.now(timezone.utc)
    proto.released_by_id = user.id
    db.commit()
    db.expire_all()
    return _to_response(db, _get_or_404(db, proto.id))


@router.delete("/{prototype_id}")
async def delete_prototype(prototype_id: int, db: Session = Depends(get_db)):
    proto = _get_or_404(db, prototype_id)
    if _is_released(db, proto):
        raise HTTPException(
            status_code=400,
            detail=f"Can't delete {proto.prototype_number}: its BOM was released to Production and is the source of record for that BOM.",
        )
    linked = db.query(func.count(RndExperiment.id)).filter(
        RndExperiment.prototype_id == proto.id, RndExperiment.is_deleted == False  # noqa: E712
    ).scalar() or 0
    if linked:
        raise HTTPException(
            status_code=400,
            detail=f"Can't delete {proto.prototype_number}: {linked} experiment(s) were run on it. Delete or unlink those experiments first, or mark the prototype Rejected instead.",
        )
    proto.is_deleted = True
    proto.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{proto.prototype_number} deleted"}
