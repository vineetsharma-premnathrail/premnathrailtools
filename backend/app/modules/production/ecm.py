"""CC01/ECM: what an implemented ECN does to Production.

When Design marks an ECN implemented, every affected Design BOM has a
released revision under it. For each one this:
1. takes that revision into a *draft* Production BOM (the normal eBOM ->
   mBOM transfer, so Production's routing / consumables / merged E-H parts
   are kept), stamped with the ECN as change number, its effectivity
   (valid_from for a date effectivity, effective_serial for a serial one),
   and the effectivity type. Production still activates it through the
   usual approval — Design never changes the shop-floor BOM directly;
2. flags every open work order of the product (built to the old version)
   with the ECN and its WIP disposition.

Each BOM runs in a savepoint: a product Production can't build from (e.g.
inactive in Store) is reported back, never blocks the ECN."""
from __future__ import annotations

import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.production import effectivity
from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.work_order import ProductionWorkOrder

logger = logging.getLogger(__name__)


def _released_under(db: Session, ecn, design: DesignBom) -> DesignBomRevision | None:
    rev = db.query(DesignBomRevision).filter(
        DesignBomRevision.bom_id == design.id, DesignBomRevision.ecn_id == ecn.id,
        DesignBomRevision.status == "released", DesignBomRevision.is_deleted == False,  # noqa: E712
    ).first()
    if rev is None:
        rev = db.query(DesignBomRevision).filter(
            DesignBomRevision.bom_id == design.id, DesignBomRevision.status == "released",
            DesignBomRevision.is_deleted == False,  # noqa: E712
        ).first()
    return rev


def on_ecn_implemented(db: Session, ecn, user) -> list[str]:
    from app.modules.production.routes.boms import transfer_revision
    notes: list[str] = []
    wip = (ecn.wip_disposition or "not_applicable").replace("_", " ")
    stock = (ecn.stock_disposition or "not_applicable").replace("_", " ")
    for link in ecn.boms:
        design = db.query(DesignBom).filter(DesignBom.id == link.bom_id, DesignBom.is_deleted == False).first()  # noqa: E712
        if design is None:
            continue
        rev = _released_under(db, ecn, design)
        if rev is None:
            continue
        try:
            with db.begin_nested():
                mbom = transfer_revision(db, design, rev, user)
                mbom.ecn_id = ecn.id
                mbom.change_number = ecn.ecn_number
                mbom.effectivity_type = ecn.effectivity_type
                if ecn.effectivity_type == "date" and ecn.effectivity_date:
                    mbom.valid_from = ecn.effectivity_date
                if ecn.effectivity_type == "serial":
                    mbom.effective_serial = ecn.effectivity_serial
                db.flush()
                flagged = effectivity.flag_open_orders(
                    db, design.product_item_id, ecn_id=ecn.id, actor_id=user.id,
                    message=(f"{ecn.ecn_number} ({ecn.title}) changed {design.bom_number} to {rev.revision_label}; draft "
                             f"{mbom.bom_number} v{mbom.version} is waiting for activation. WIP disposition: {wip}; stock: {stock}. "
                             "Review this order's material and routing, then clear the flag with what was done."),
                )
            notes.append(f"{design.bom_number} {rev.revision_label} → draft {mbom.bom_number} v{mbom.version}"
                         + (f"; {len(flagged)} open work order(s) flagged" if flagged else ""))
        except HTTPException as e:
            notes.append(f"{design.bom_number} {rev.revision_label}: not transferred to Production — {e.detail}")
        except Exception as e:  # noqa: BLE001 — never block the ECN on the Production side
            logger.exception("ECN %s production transfer failed", ecn.ecn_number)
            notes.append(f"{design.bom_number} {rev.revision_label}: not transferred to Production — {e}")
    return notes


def affected_orders(db: Session, ecn) -> dict:
    """Open work orders of the products on the ECN, and the Production BOMs
    raised under it."""
    product_ids = {d.product_item_id for d in db.query(DesignBom).filter(DesignBom.id.in_([b.bom_id for b in ecn.boms])).all()} if ecn.boms else set()
    orders = db.query(ProductionWorkOrder).filter(
        ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.product_item_id.in_(product_ids),  # noqa: E712
        ProductionWorkOrder.status.in_(effectivity.OPEN_ORDER_STATUSES),
    ).order_by(ProductionWorkOrder.wo_number).all() if product_ids else []
    boms = db.query(ProductionBom).filter(ProductionBom.ecn_id == ecn.id, ProductionBom.is_deleted == False).all()  # noqa: E712
    bom_ids = {o.bom_id for o in orders}
    versions = {b.id: b for b in db.query(ProductionBom).filter(ProductionBom.id.in_(bom_ids)).all()} if bom_ids else {}
    return {
        "ecn_id": ecn.id, "ecn_number": ecn.ecn_number,
        "orders": [{
            "id": o.id, "wo_number": o.wo_number, "status": o.status, "quantity_planned": o.quantity_planned,
            "quantity_completed": o.quantity_completed, "bom_label": f"{versions[o.bom_id].bom_number} v{versions[o.bom_id].version}" if o.bom_id in versions else None,
            "flagged": bool(o.change_flag and o.change_flag_ecn_id == ecn.id), "flag_cleared": o.change_flag_cleared_at is not None,
            "resolution": o.change_flag_resolution,
        } for o in orders],
        "production_boms": [{"id": b.id, "bom_number": b.bom_number, "version": b.version, "status": b.status,
                             "valid_from": b.valid_from, "effective_serial": b.effective_serial} for b in boms],
    }
