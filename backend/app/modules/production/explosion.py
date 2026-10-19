"""Multi-level BOM explosion (SAP CS11 indented / CS12 multi-level) and
dependent work orders for sub-assemblies.

A component is a sub-assembly when it has its own Production BOM that is
valid on the date (active, or scheduled and already in force) — the same
rule the shop floor uses. The walk multiplies quantities down the tree
(including each level's scrap allowance), stops at 15 levels and marks a
cycle (A uses B uses A) instead of looping."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.modules.production.models.bom import ProductionBom
from app.modules.store.models.item import StoreItem

MAX_DEPTH = 15


def effective_bom(db: Session, item_id: int, on: date | None = None, cache: dict | None = None) -> ProductionBom | None:
    on = on or date.today()
    if cache is not None and item_id in cache:
        return cache[item_id]
    candidates = db.query(ProductionBom).filter(
        ProductionBom.product_item_id == item_id, ProductionBom.is_deleted == False,  # noqa: E712
        ProductionBom.status.in_(("active", "scheduled")),
    ).all()
    valid = [b for b in candidates if (b.valid_from is None or b.valid_from <= on) and (b.valid_to is None or b.valid_to >= on)]
    pick = max(valid, key=lambda b: b.version) if valid else next((b for b in candidates if b.status == "active"), None)
    if cache is not None:
        cache[item_id] = pick
    return pick


@dataclass
class ExplodedRow:
    level: int
    path: str
    item_id: int | None
    item_category: str
    quantity_per: float
    total_quantity: float
    make_buy: str | None
    bom: ProductionBom | None
    line_text: str | None = None
    source_tag: str | None = None
    cycle: bool = False
    children: list = field(default_factory=list)


def explode_multi_level(db: Session, bom: ProductionBom, quantity: float, max_depth: int = MAX_DEPTH,
                        on: date | None = None) -> list[ExplodedRow]:
    """Depth-first rows (parent before its children) for `quantity` units of
    the BOM's product."""
    cache: dict[int, ProductionBom | None] = {}
    rows: list[ExplodedRow] = []

    def walk(b: ProductionBom, qty: float, level: int, prefix: str, seen: frozenset) -> None:
        factor = qty / (b.base_quantity or 1.0)
        for idx, line in enumerate(sorted(b.items, key=lambda i: i.sort_order), start=1):
            category = line.item_category or "stock"
            path = f"{prefix}{idx}"
            per = round(line.quantity / (b.base_quantity or 1.0), 6)
            total = round(line.quantity * factor * (1 + (line.scrap_percent or 0) / 100), 4) if category in ("stock", "non_stock") else 0.0
            child = effective_bom(db, line.component_item_id, on, cache) if line.component_item_id and category == "stock" else None
            cycle = bool(child and child.product_item_id in seen)
            row = ExplodedRow(level, path, line.component_item_id, category, per, total,
                              line.make_buy or ("make" if child else None), child, line.line_text, line.source_tag, cycle)
            rows.append(row)
            if child and not cycle and level < max_depth and total > 0:
                walk(child, total, level + 1, f"{path}.", seen | {child.product_item_id})

    walk(bom, quantity, 1, "", frozenset({bom.product_item_id}))
    return rows


def explosion_payload(db: Session, bom: ProductionBom, quantity: float, max_depth: int = MAX_DEPTH) -> dict:
    from app.modules.production.service import item_unit_cost
    rows = explode_multi_level(db, bom, quantity, max_depth)
    ids = {r.item_id for r in rows if r.item_id} | {bom.product_item_id}
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(ids)).all()} if ids else {}
    out, total = [], 0.0
    for r in rows:
        item = items.get(r.item_id)
        unit = item_unit_cost(item)
        # Cost rolls up from purchased leaves only — a sub-assembly's value is
        # the sum of its own children, so counting it too would double it.
        leaf = not (r.bom and not r.cycle)
        ext = round(unit * r.total_quantity, 2) if leaf else 0.0
        total += ext
        out.append({
            "level": r.level, "path": r.path, "item_id": r.item_id,
            "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
            "uom": item.uom if item else None, "item_category": r.item_category,
            "quantity_per": r.quantity_per, "total_quantity": r.total_quantity, "make_buy": r.make_buy,
            "has_bom": r.bom is not None, "bom_id": r.bom.id if r.bom else None,
            "bom_number": f"{r.bom.bom_number} v{r.bom.version}" if r.bom else None,
            "unit_cost": unit, "extended_cost": ext, "line_text": r.line_text, "source_tag": r.source_tag, "cycle": r.cycle,
        })
    product = items.get(bom.product_item_id)
    return {
        "bom_id": bom.id, "bom_number": f"{bom.bom_number} v{bom.version}",
        "product_code": product.item_code if product else None, "product_name": product.item_name if product else None,
        "quantity": quantity, "max_level": max((r["level"] for r in out), default=0),
        "total_material_cost": round(total, 2), "rows": out,
    }


def create_dependent_orders(db: Session, wo, user, levels: int = MAX_DEPTH, net_free_stock: bool = False) -> list:
    """CS11 -> CO01 for each make item in the order's tree: a draft work order
    for the sub-assembly, linked to its parent order (and through it to the
    same machine, sales order line and plant). An item that already has a
    live dependent order under the same parent is skipped, so the action can
    be run again after the BOM changed."""
    from app.modules.production.models.work_order import ProductionWorkOrder
    from app.modules.production.service import available_qty, explode_bom, generate_work_order_number

    bom = db.query(ProductionBom).filter(ProductionBom.id == wo.bom_id).first()
    created: list = []
    free = {}

    def raise_for(parent, parent_bom: ProductionBom, parent_qty: float, level: int, seen: frozenset) -> None:
        if level > levels:
            return
        factor = parent_qty / (parent_bom.base_quantity or 1.0)
        existing = {c.product_item_id: c for c in db.query(ProductionWorkOrder).filter(
            ProductionWorkOrder.parent_work_order_id == parent.id, ProductionWorkOrder.is_deleted == False,  # noqa: E712
            ProductionWorkOrder.status != "cancelled",
        ).all()}
        for line in parent_bom.items:
            if not line.component_item_id or (line.item_category or "stock") != "stock" or line.make_buy == "buy":
                continue
            child_bom = effective_bom(db, line.component_item_id, parent.planned_start_date)
            if child_bom is None or child_bom.product_item_id in seen or not child_bom.items:
                continue
            need = round(line.quantity * factor * (1 + (line.scrap_percent or 0) / 100), 4)
            if net_free_stock:
                if line.component_item_id not in free:
                    free[line.component_item_id] = max(available_qty(db, [line.component_item_id]).get(line.component_item_id, 0.0), 0.0)
                take = min(free[line.component_item_id], need)
                free[line.component_item_id] -= take
                need = round(need - take, 4)
            if need <= 0:
                continue
            child = existing.get(line.component_item_id)
            if child is None:
                end = parent.planned_start_date - timedelta(days=1) if parent.planned_start_date else None
                child = ProductionWorkOrder(
                    wo_number=generate_work_order_number(db), product_item_id=child_bom.product_item_id, bom_id=child_bom.id,
                    erp_project_id=parent.erp_project_id, branch_id=parent.branch_id, quantity_planned=need,
                    priority=parent.priority, status="draft", source_location_id=parent.source_location_id,
                    target_location_id=parent.source_location_id or parent.target_location_id,
                    planned_end_date=end, supervisor_id=parent.supervisor_id, created_by_id=user.id,
                    sales_order_id=parent.sales_order_id, sales_order_line_id=parent.sales_order_line_id,
                    order_project_id=parent.order_project_id, order_project_element_id=parent.order_project_element_id,
                    parent_work_order_id=parent.id,
                    remarks=f"Dependent order for {parent.wo_number} (BOM explosion level {level})",
                )
                child.materials, child.operations = explode_bom(child_bom, need)
                db.add(child)
                db.flush()
                created.append(child)
            raise_for(child, child_bom, child.quantity_planned, level + 1, seen | {child_bom.product_item_id})

    if bom is not None:
        raise_for(wo, bom, wo.quantity_planned, 1, frozenset({bom.product_item_id}))
    return created


def dependent_tree(db: Session, wo) -> list[tuple[int, object]]:
    """(level, order) for every dependent order below `wo`, depth first."""
    from app.modules.production.models.work_order import ProductionWorkOrder
    out: list[tuple[int, object]] = []

    def walk(parent_id: int, level: int, guard: set) -> None:
        for child in db.query(ProductionWorkOrder).filter(
            ProductionWorkOrder.parent_work_order_id == parent_id, ProductionWorkOrder.is_deleted == False,  # noqa: E712
        ).order_by(ProductionWorkOrder.id).all():
            if child.id in guard:
                continue
            out.append((level, child))
            walk(child.id, level + 1, guard | {child.id})

    walk(wo.id, 1, {wo.id})
    return out
