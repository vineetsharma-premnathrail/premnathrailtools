"""Product costing — CK11N run / CK13N display / CK24 mark & release, the
standard price history, and KKBC_ORD order plan vs actual per work order.
Logic in production/cost_estimating.py.

Permissions (Finance & Accounting › Controlling › Product Costing):
  view     list / display estimates, price history, order variance
           (Production › BOM & Routing viewers may read them too)
  create   run an estimate (saved as draft) — preview needs only view
  edit     mark / unmark
  approve  release to the standard price (CK24)
  delete   cancel a draft / marked estimate"""
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from app.core.permission_registry import can_view_tab
from app.core.permissions import ensure_feature_action, require_tab_action
from app.db.session import get_db
from app.modules.accounts.routes._common import service_errors, user_names, write_audit
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.production import cost_estimating as ce
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.cost_estimate import ProductionCostEstimate, StoreItemStandardPrice
from app.modules.production.models.work_order import ProductionWorkOrder
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.store.models.item import StoreItem

router = APIRouter(prefix="/accounts/product-costing", tags=["Accounts"])
TAB = "product_costing"


def require_costing_view(user: User = Depends(get_current_user)) -> User:
    if not (can_view_tab(user, "accounts", TAB) or can_view_tab(user, "production", "bom")):
        raise HTTPException(status_code=403, detail=(
            "You don't have 'view' permission on Finance & Accounting › Product Costing (accounts:product_costing) "
            "or Production › BOM & Routing (production:bom). Ask an admin to grant it under Organization › Role & Permissions."))
    return user


def _bom_viewer_or(user: User, feature: str) -> None:
    """Production › BOM viewers keep reading costing data; Finance users need
    the Product Costing feature (order variance / price history)."""
    if can_view_tab(user, "production", "bom"):
        return
    if feature == "order_variance":
        ensure_feature_action(user, "accounts", "product_costing", "order_variance", "view")
    else:
        ensure_feature_action(user, "accounts", "product_costing", "price_history", "view")


def require_order_variance_view(user: User = Depends(require_costing_view)) -> User:
    _bom_viewer_or(user, "order_variance")
    return user


def require_price_history_view(user: User = Depends(require_costing_view)) -> User:
    _bom_viewer_or(user, "price_history")
    return user


class CostEstimateRunPayload(BaseModel):
    item_id: int | None = None
    bom_id: int | None = None
    costing_date: date | None = None
    lot_size: float | None = Field(None, gt=0)
    branch_id: int | None = None
    material_overhead_pct: float | None = Field(None, ge=0, le=1000)
    labour_overhead_pct: float | None = Field(None, ge=0, le=1000)
    remarks: str | None = None


class CostEstimateReleasePayload(BaseModel):
    valid_from: date | None = None
    remarks: str | None = None


class CostEstimateCancelPayload(BaseModel):
    reason: str


def _get(db: Session, estimate_id: int) -> ProductionCostEstimate:
    est = db.query(ProductionCostEstimate).options(selectinload(ProductionCostEstimate.lines)).filter(
        ProductionCostEstimate.id == estimate_id).first()
    if est is None:
        raise HTTPException(status_code=404, detail="Cost estimate not found — it may have been removed; reload the list.")
    return est


def _header(est: ProductionCostEstimate, items: dict, boms: dict, names: dict) -> dict:
    item, bom = items.get(est.item_id), boms.get(est.bom_id)
    return {
        "id": est.id, "estimate_number": est.estimate_number, "item_id": est.item_id,
        "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
        "current_standard_cost": item.standard_cost if item else None,
        "bom_id": est.bom_id, "bom_number": bom.bom_number if bom else None, "bom_version": bom.version if bom else None,
        "version": est.version, "costing_date": est.costing_date, "lot_size": est.lot_size, "status": est.status,
        "material_cost": est.material_cost, "labour_cost": est.labour_cost, "overhead_cost": est.overhead_cost,
        "job_work_cost": est.job_work_cost, "total_cost": est.total_cost, "unit_cost": est.unit_cost,
        "material_overhead_pct": est.material_overhead_pct, "labour_overhead_pct": est.labour_overhead_pct,
        "warnings": est.warnings or [], "valid_from": est.valid_from, "valid_to": est.valid_to,
        "previous_standard_cost": est.previous_standard_cost, "remarks": est.remarks,
        "created_by_name": names.get(est.created_by_id), "marked_by_name": names.get(est.marked_by_id),
        "marked_at": est.marked_at, "released_by_name": names.get(est.released_by_id), "released_at": est.released_at,
        "cancelled_reason": est.cancelled_reason, "created_at": est.created_at,
    }


def _serialize(db: Session, ests: list[ProductionCostEstimate], with_lines: bool = False) -> list[dict]:
    item_ids = {e.item_id for e in ests}
    if with_lines:
        item_ids |= {l.item_id for e in ests for l in e.lines if l.item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(item_ids)).all()} if item_ids else {}
    bom_ids = {e.bom_id for e in ests}
    boms = {b.id: b for b in db.query(ProductionBom).filter(ProductionBom.id.in_(bom_ids)).all()} if bom_ids else {}
    names = user_names(db, {i for e in ests for i in (e.created_by_id, e.marked_by_id, e.released_by_id)})
    out = []
    for e in ests:
        h = _header(e, items, boms, names)
        if with_lines:
            subs = {l.sub_estimate_id for l in e.lines if l.sub_estimate_id}
            sub_no = {s.id: s.estimate_number for s in db.query(ProductionCostEstimate).filter(ProductionCostEstimate.id.in_(subs)).all()} if subs else {}
            h["lines"] = [{
                "id": l.id, "line_number": l.line_number, "level": l.level, "parent_line_id": l.parent_line_id,
                "line_type": l.line_type, "item_id": l.item_id,
                "item_code": items[l.item_id].item_code if l.item_id in items else None,
                "description": l.description, "operation_name": l.operation_name, "workstation_id": l.workstation_id,
                "quantity": l.quantity, "uom": l.uom, "unit_cost": l.unit_cost, "amount": l.amount,
                "material_amount": l.material_amount, "labour_amount": l.labour_amount,
                "overhead_amount": l.overhead_amount, "job_work_amount": l.job_work_amount,
                "cost_source": l.cost_source, "sub_estimate_id": l.sub_estimate_id,
                "sub_estimate_number": sub_no.get(l.sub_estimate_id),
            } for l in e.lines]
        out.append(h)
    return out


@router.get("/estimates")
async def list_estimates(
    item_id: int | None = Query(None), status: str | None = Query(None), search: str | None = Query(None),
    db: Session = Depends(get_db), _user: User = Depends(require_costing_view),
):
    q = db.query(ProductionCostEstimate)
    if item_id:
        q = q.filter(ProductionCostEstimate.item_id == item_id)
    if status:
        q = q.filter(ProductionCostEstimate.status == status)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.join(StoreItem, StoreItem.id == ProductionCostEstimate.item_id).filter(
            (StoreItem.item_code.ilike(like)) | (StoreItem.item_name.ilike(like)) | (ProductionCostEstimate.estimate_number.ilike(like)))
    return _serialize(db, q.order_by(ProductionCostEstimate.id.desc()).limit(500).all())


@router.get("/costable-items")
async def costable_items(db: Session = Depends(get_db), _user: User = Depends(require_costing_view)):
    """Items with a draft or active production BOM — what can be costed."""
    rows = db.query(ProductionBom, StoreItem).join(StoreItem, StoreItem.id == ProductionBom.product_item_id).filter(
        ProductionBom.is_deleted == False, ProductionBom.status.in_(("draft", "active"))).order_by(  # noqa: E712
        StoreItem.item_code.asc(), ProductionBom.version.desc()).all()
    out: dict[int, dict] = {}
    for bom, item in rows:
        r = out.setdefault(item.id, {"item_id": item.id, "item_code": item.item_code, "item_name": item.item_name,
                                     "standard_cost": item.standard_cost, "boms": []})
        r["boms"].append({"id": bom.id, "bom_number": bom.bom_number, "version": bom.version, "status": bom.status,
                          "base_quantity": bom.base_quantity})
    return list(out.values())


@router.post("/preview")
async def preview_estimate(payload: CostEstimateRunPayload, db: Session = Depends(get_db),
                           _user: User = Depends(require_costing_view)):
    with service_errors(db):
        return ce.preview(db, **payload.model_dump(exclude={"remarks"}))


@router.post("/estimates")
async def run_estimate(payload: CostEstimateRunPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_tab_action("accounts", TAB, "create"))):
    with service_errors(db):
        est = ce.run_estimate(db, user_id=user.id, **payload.model_dump())
        write_audit(db, "product_cost_estimate", est.id, "create", user,
                    f"{est.estimate_number}: ₹{est.total_cost:,.2f} for lot {est.lot_size:g} (unit ₹{est.unit_cost:,.2f})")
        db.commit()
    return _serialize(db, [_get(db, est.id)], with_lines=True)[0]


@router.get("/estimates/{estimate_id}")
async def get_estimate(estimate_id: int, db: Session = Depends(get_db), _user: User = Depends(require_costing_view)):
    return _serialize(db, [_get(db, estimate_id)], with_lines=True)[0]


@router.post("/estimates/{estimate_id}/mark")
async def mark_estimate(estimate_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                        user: User = Depends(require_tab_action("accounts", TAB, "edit"))):
    from app.modules.accounts import role_events_b
    est = _get(db, estimate_id)
    with service_errors(db):
        ce.mark(db, est, user.id)
        write_audit(db, "product_cost_estimate", est.id, "mark", user, f"{est.estimate_number} marked for release")
        role_events_b.fire(
            db, "cost_estimate_marked", title=f"Cost estimate {est.estimate_number} waiting for release",
            message=(f"{user.name or user.email} marked {est.estimate_number} (unit cost ₹{est.unit_cost:,.2f}) for release. "
                     "Release it to the standard price in Finance › Costing & Profitability › Cost Estimates."),
            entity_type="product_cost_estimate", entity_id=est.id, actor=user, background_tasks=background_tasks)
        db.commit()
    return _serialize(db, [_get(db, estimate_id)], with_lines=True)[0]


@router.post("/estimates/{estimate_id}/unmark")
async def unmark_estimate(estimate_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", TAB, "edit"))):
    est = _get(db, estimate_id)
    with service_errors(db):
        ce.unmark(db, est)
        write_audit(db, "product_cost_estimate", est.id, "unmark", user, f"{est.estimate_number} mark removed")
        db.commit()
    return _serialize(db, [_get(db, estimate_id)], with_lines=True)[0]


@router.post("/estimates/{estimate_id}/release")
async def release_estimate(estimate_id: int, payload: CostEstimateReleasePayload, background_tasks: BackgroundTasks,
                           db: Session = Depends(get_db),
                           user: User = Depends(require_tab_action("accounts", TAB, "approve"))):
    from app.modules.accounts import role_events_b
    est = _get(db, estimate_id)
    with service_errors(db):
        ce.release(db, est, user.id, valid_from=payload.valid_from, remarks=payload.remarks)
        write_audit(db, "product_cost_estimate", est.id, "release", user,
                    f"{est.estimate_number} released: standard price ₹{est.previous_standard_cost or 0:,.2f} → "
                    f"₹{est.unit_cost:,.2f} from {est.valid_from:%d-%b-%Y}")
        role_events_b.fire(
            db, "standard_price_released", title=f"Standard price changed — {est.estimate_number}",
            message=(f"{user.name or user.email} released {est.estimate_number}: standard price ₹{est.previous_standard_cost or 0:,.2f} → "
                     f"₹{est.unit_cost:,.2f} from {est.valid_from:%d-%m-%Y}. Stock valuation and planned costs use the new price from that date."),
            entity_type="product_cost_estimate", entity_id=est.id, actor=user, background_tasks=background_tasks)
        db.commit()
    return _serialize(db, [_get(db, estimate_id)], with_lines=True)[0]


@router.post("/estimates/{estimate_id}/cancel")
async def cancel_estimate(estimate_id: int, payload: CostEstimateCancelPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", TAB, "delete"))):
    est = _get(db, estimate_id)
    with service_errors(db):
        ce.cancel(db, est, payload.reason)
        write_audit(db, "product_cost_estimate", est.id, "cancel", user, f"{est.estimate_number} cancelled: {payload.reason}")
        db.commit()
    return _serialize(db, [_get(db, estimate_id)])[0]


@router.get("/price-history")
async def price_history(item_id: int = Query(...), db: Session = Depends(get_db), _user: User = Depends(require_price_history_view)):
    rows = db.query(StoreItemStandardPrice).filter(StoreItemStandardPrice.item_id == item_id).order_by(
        StoreItemStandardPrice.valid_from.desc(), StoreItemStandardPrice.id.desc()).all()
    names = user_names(db, {r.released_by_id for r in rows})
    ests = {e.id: e.estimate_number for e in db.query(ProductionCostEstimate).filter(
        ProductionCostEstimate.id.in_({r.cost_estimate_id for r in rows if r.cost_estimate_id})).all()} if rows else {}
    return [{
        "id": r.id, "standard_cost": r.standard_cost, "previous_cost": r.previous_cost, "valid_from": r.valid_from,
        "valid_to": r.valid_to, "source": r.source, "cost_estimate_id": r.cost_estimate_id,
        "estimate_number": ests.get(r.cost_estimate_id), "released_by_name": names.get(r.released_by_id),
        "remarks": r.remarks, "created_at": r.created_at,
    } for r in rows]


@router.get("/work-orders")
async def order_variance_list(status: str | None = Query(None), db: Session = Depends(get_db),
                              _user: User = Depends(require_order_variance_view)):
    with service_errors(db):
        return ce.order_variance_list(db, status=status)


@router.get("/work-orders/{work_order_id}")
async def order_variance(work_order_id: int, db: Session = Depends(get_db), _user: User = Depends(require_order_variance_view)):
    wo = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.id == work_order_id,
                                              ProductionWorkOrder.is_deleted == False).first()  # noqa: E712
    if wo is None:
        raise HTTPException(status_code=404, detail="Work order not found.")
    with service_errors(db):
        return ce.order_plan_actual(db, wo)


@router.get("/workstations")
async def workstation_lookup(db: Session = Depends(get_db), _user: User = Depends(require_costing_view)):
    return [{"id": w.id, "code": w.code, "name": w.name, "hourly_rate": w.hourly_rate}
            for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.is_deleted == False).all()]  # noqa: E712
