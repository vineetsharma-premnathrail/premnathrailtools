"""eBOM -> mBOM transfer (SAP PLM BOM handover / CS20-style transfer).

Design owns the engineering BOM (what the product is made of, revision
controlled, released through four-eyes approval). Production owns the
manufacturing BOM (the same components plus scrap allowance, shop
consumables and the routing). Production never re-keys the components: it
pulls them from a *released* Design BOM revision, and the mBOM keeps the
link (design BOM + revision) so a later eBOM release shows up as "Design
changed" with the differences, and can be pulled in with one click.

Read-only on the Design side — nothing here changes Design records."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, selectinload

from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.production.models.bom import ProductionBom
from app.modules.store.models.item import StoreItem


@dataclass
class DesignComponent:
    item_id: int
    quantity: float
    make_buy: str | None
    remarks: str | None


def released_revision(bom: DesignBom) -> DesignBomRevision | None:
    return next((r for r in bom.revisions if not r.is_deleted and r.status == "released"), None)


def live_design_boms(db: Session, product_item_id: int | None = None) -> list[DesignBom]:
    query = db.query(DesignBom).options(selectinload(DesignBom.revisions).selectinload(DesignBomRevision.lines)).filter(
        DesignBom.is_deleted == False, DesignBom.status != "obsolete",  # noqa: E712
    )
    if product_item_id is not None:
        query = query.filter(DesignBom.product_item_id == product_item_id)
    return query.order_by(DesignBom.bom_number).all()


def released_design_for_product(db: Session, product_item_id: int) -> tuple[DesignBom, DesignBomRevision] | None:
    for bom in live_design_boms(db, product_item_id):
        rev = released_revision(bom)
        if rev is not None:
            return bom, rev
    return None


def design_components(rev: DesignBomRevision) -> list[DesignComponent]:
    """The revision's lines as mBOM components, one per Item Master code (the
    eBOM may list the same item at two positions — Production holds one
    line per component, so they're merged)."""
    merged: dict[int, DesignComponent] = {}
    for line in sorted(rev.lines, key=lambda l: l.position):
        if not line.store_item_id:
            continue  # can't happen on a released revision (release blocker)
        note = f"eBOM pos {line.position}" + (f", drawing rev {line.document_revision_label}" if line.document_revision_label else "")
        if line.remarks:
            note += f" — {line.remarks}"
        if line.store_item_id in merged:
            c = merged[line.store_item_id]
            c.quantity = round(c.quantity + float(line.quantity or 0), 4)
            c.remarks = f"{c.remarks}; {note}"[:1000]
        else:
            merged[line.store_item_id] = DesignComponent(line.store_item_id, round(float(line.quantity or 0), 4), line.make_buy, note)
    return list(merged.values())


def diff_rows(db: Session, mbom: ProductionBom, rev: DesignBomRevision) -> list[dict]:
    """Component-by-component comparison of the mBOM with an eBOM revision.
    The mBOM's quantities are per base_quantity, the eBOM's per 1 unit."""
    design = {c.item_id: c for c in design_components(rev)}
    per_unit = 1.0 / (mbom.base_quantity or 1.0)
    production: dict[int, float] = {}
    for i in mbom.items:
        if i.component_item_id and (i.item_category or "stock") in ("stock", "non_stock"):
            production[i.component_item_id] = round(production.get(i.component_item_id, 0.0) + i.quantity * per_unit, 4)
    ids = set(design) | set(production)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(ids)).all()} if ids else {}
    rows = []
    for item_id in ids:
        d, p = design.get(item_id), production.get(item_id)
        if d is None:
            change = "production_only"
        elif p is None:
            change = "design_only"
        elif abs(d.quantity - p) > 1e-6:
            change = "qty_changed"
        else:
            change = "same"
        item = items.get(item_id)
        rows.append({
            "item_id": item_id, "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
            "uom": item.uom if item else None, "design_qty": d.quantity if d else None, "production_qty": p,
            "design_make_buy": d.make_buy if d else None, "change": change,
        })
    order = {"design_only": 0, "qty_changed": 1, "production_only": 2, "same": 3}
    rows.sort(key=lambda r: (order[r["change"]], r["item_code"] or ""))
    return rows
