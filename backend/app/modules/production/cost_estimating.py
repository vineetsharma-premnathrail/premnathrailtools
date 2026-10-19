"""Product costing: CK11N cost estimate, CK13N itemisation, CK24 mark &
release, and KKBC_ORD order plan / target / actual with variance categories.

Read-only towards the GL (periodic inventory, Finance decision): releasing a
standard price writes StoreItem.standard_cost + its price history, never a
revaluation journal.

Unit cost of a BOM component, first that applies:
  1. it has its own active production BOM (a sub-assembly) →
       its released estimate valid on the costing date  ('sub_estimate')
       else its BOM costed right here, one level deeper    ('sub_rollup')
  2. it came back from job work → last job-work receipt up to the costing
     date: component value ÷ qty = material, job charge = job work  ('job_work')
  3. Item Master standard cost                               ('standard')
  4. Store moving-average cost                               ('moving_average')
  5. nothing → ₹0 and a warning on the estimate              ('none')
Routing activity = (setup + run hours × lot) × the work centre's CO
activity price valid on the costing date (accounts/services/co_activity.py),
else its flat hourly rate.
Overhead = costing-sheet % on own material and on own labour (sub-assembly
estimates already carry their own overhead). The % come from the payload,
else the CO costing sheet valid for the plant on the costing date
(accounts/services/co_overhead.py), else 0."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.production.models.bom import ProductionBom
from app.modules.production.models.cost_estimate import (
    ProductionCostEstimate, ProductionCostEstimateLine, StoreItemStandardPrice,
)
from app.modules.production.models.work_order import ProductionOrderCostPosting, ProductionTimeLog, ProductionWorkOrder
from app.modules.production.models.workstation import ProductionWorkstation
from app.modules.store.models.item import StoreItem

_EPS = 1e-9
MAX_LEVELS = 15


def _r(x, places: int = 2) -> float:
    return round(float(x or 0), places)


def _item_label(item: StoreItem | None) -> str:
    return f"{item.item_code} — {item.item_name}" if item else "unknown item"


# ─────────────────────────────────────────────────────────────────────────
# Rates
# ─────────────────────────────────────────────────────────────────────────

def costing_sheet(db: Session, branch_id: int | None, on: date | None = None) -> tuple[float, float]:
    """(material_overhead_pct, labour_overhead_pct) from the CO costing sheet
    (Finance › Controlling › Overhead, co_overhead.overhead_for) valid for the
    plant on the date; (0, 0) when none is maintained."""
    try:
        from app.modules.accounts.services.co_overhead import overhead_for
    except ImportError:  # pragma: no cover — overhead module absent
        return 0.0, 0.0
    oh = overhead_for(db, branch_id, on or date.today(), 0.0, 0.0)
    return float(oh["material_overhead_pct"] or 0), float(oh["labour_overhead_pct"] or 0)


class _Rates:
    """Hour rate per work centre on the costing date: the CO activity price
    (Finance › Controlling › Activity Types & Rates) where maintained, else
    the work centre's flat hourly rate."""

    def __init__(self, db: Session, on: date):
        self.db, self.on = db, on
        self._ws: dict[int, ProductionWorkstation | None] = {}

    def workstation(self, ws_id: int | None) -> ProductionWorkstation | None:
        if not ws_id:
            return None
        if ws_id not in self._ws:
            self._ws[ws_id] = self.db.get(ProductionWorkstation, ws_id)
        return self._ws[ws_id]

    def rate(self, ws_id: int | None) -> tuple[float, str]:
        ws = self.workstation(ws_id)
        if ws is None:
            return 0.0, "none"
        try:
            from app.modules.accounts.services.co_activity import workstation_hour_rate
            rate, src = workstation_hour_rate(self.db, ws, self.on)
            if src == "co_rate" and rate > 0:
                return float(rate), "activity_rate"
        except ImportError:  # pragma: no cover
            pass
        if (ws.hourly_rate or 0) > 0:
            return float(ws.hourly_rate), "workstation_rate"
        return 0.0, "none"


def active_bom(db: Session, item_id: int) -> ProductionBom | None:
    return db.query(ProductionBom).filter(
        ProductionBom.product_item_id == item_id, ProductionBom.status == "active", ProductionBom.is_deleted == False,  # noqa: E712
    ).order_by(ProductionBom.version.desc()).first()


def released_estimate(db: Session, item_id: int, on: date, bom_id: int | None = None) -> ProductionCostEstimate | None:
    """The released (or since superseded) estimate whose validity covers `on`."""
    q = db.query(ProductionCostEstimate).filter(
        ProductionCostEstimate.item_id == item_id, ProductionCostEstimate.status.in_(("released", "superseded")),
        ProductionCostEstimate.valid_from <= on,
        sa.or_(ProductionCostEstimate.valid_to.is_(None), ProductionCostEstimate.valid_to >= on),
    )
    if bom_id is not None:
        hit = q.filter(ProductionCostEstimate.bom_id == bom_id).order_by(ProductionCostEstimate.valid_from.desc()).first()
        if hit is not None:
            return hit
    return q.order_by(ProductionCostEstimate.valid_from.desc(), ProductionCostEstimate.id.desc()).first()


def _job_work_cost(db: Session, item_id: int, on: date) -> tuple[float, float] | None:
    from app.modules.store.models.job_work import StoreJobWorkReceipt
    rec = db.query(StoreJobWorkReceipt).filter(
        StoreJobWorkReceipt.output_item_id == item_id, StoreJobWorkReceipt.receipt_date <= on,
        StoreJobWorkReceipt.output_quantity > 0,
    ).order_by(StoreJobWorkReceipt.receipt_date.desc(), StoreJobWorkReceipt.id.desc()).first()
    if rec is None:
        return None
    material = float(rec.component_value or 0) / float(rec.output_quantity)
    if rec.job_charge_rate is not None:
        job = float(rec.job_charge_rate)
    else:
        job = max(float(rec.output_unit_cost or 0) - material, 0.0)
    if material + job <= _EPS:
        return None
    return material, job


# ─────────────────────────────────────────────────────────────────────────
# CK11N — run an estimate
# ─────────────────────────────────────────────────────────────────────────

class _Estimator:
    def __init__(self, db: Session, on: date, top_item_id: int):
        self.db, self.on = db, on
        self.rates = _Rates(db, on)
        self.lines: list[dict] = []
        self.warnings: list[str] = []
        self._items: dict[int, StoreItem | None] = {}
        self.top_item_id = top_item_id

    def item(self, item_id: int) -> StoreItem | None:
        if item_id not in self._items:
            self._items[item_id] = self.db.get(StoreItem, item_id)
        return self._items[item_id]

    def _warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)

    def cost_bom(self, bom: ProductionBom, lot: float, level: int, parent: int | None, path: list[int]) -> dict:
        """Adds this BOM's component + activity lines (for `lot` units) and
        returns the split {material, labour, overhead, job_work, own_material, own_labour}."""
        if level > MAX_LEVELS:
            raise ValueError(f"The BOM structure is deeper than {MAX_LEVELS} levels — check for a loop.")
        base = float(bom.base_quantity or 1) or 1.0
        tot = dict(material=0.0, labour=0.0, overhead=0.0, job_work=0.0, own_material=0.0, own_labour=0.0)
        for bl in bom.items:
            item = self.item(bl.component_item_id)
            qty = float(bl.quantity) * (1 + float(bl.scrap_percent or 0) / 100) * lot / base
            idx = len(self.lines)
            row = dict(level=level, parent=parent, line_type="material", item_id=bl.component_item_id,
                       description=_item_label(item), quantity=_r(qty, 4), uom=item.uom if item else None,
                       material_amount=0.0, labour_amount=0.0, overhead_amount=0.0, job_work_amount=0.0,
                       cost_source="none", sub_estimate_id=None)
            self.lines.append(row)
            split = self.component(bl.component_item_id, qty, level, idx, path)
            row.update({k + "_amount": _r(split[k]) for k in ("material", "labour", "overhead", "job_work")})
            row["cost_source"] = split["source"]
            row["sub_estimate_id"] = split.get("sub_estimate_id")
            for k in ("material", "labour", "overhead", "job_work"):
                tot[k] += split[k]
            tot["own_material"] += split.get("own_material", 0.0)
            tot["own_labour"] += split.get("own_labour", 0.0)
        for op in bom.operations:
            hours = float(op.setup_hours or 0) + float(op.run_hours_per_unit or 0) * lot
            rate, source = self.rates.rate(op.workstation_id)
            ws = self.rates.workstation(op.workstation_id)
            if hours > _EPS and rate <= _EPS:
                self._warn(f"Operation {op.sequence} '{op.operation_name}' ({bom.bom_number}) has no activity rate — "
                           f"{'set an hourly rate on work centre ' + ws.code if ws else 'assign a work centre with an hourly rate'} "
                           f"in Production › Workstations.")
            amount = hours * rate
            self.lines.append(dict(level=level, parent=parent, line_type="activity", item_id=None,
                                   operation_name=op.operation_name, workstation_id=op.workstation_id,
                                   description=f"{op.sequence} {op.operation_name}" + (f" @ {ws.code}" if ws else ""),
                                   quantity=_r(hours, 4), uom="H", unit_cost=_r(rate, 4),
                                   material_amount=0.0, labour_amount=_r(amount), overhead_amount=0.0, job_work_amount=0.0,
                                   cost_source=source, sub_estimate_id=None))
            tot["labour"] += amount
            tot["own_labour"] += amount
        return tot

    def component(self, item_id: int, qty: float, level: int, line_idx: int, path: list[int]) -> dict:
        item = self.item(item_id)
        zero = dict(material=0.0, labour=0.0, overhead=0.0, job_work=0.0)
        if item_id in path:
            chain = " → ".join(_item_label(self.item(i)) for i in path + [item_id])
            raise ValueError(f"BOM loop: {chain}. A product can't contain itself — fix the BOM in Production › BOM & Routing.")
        sub_bom = active_bom(self.db, item_id)
        if sub_bom is not None:
            est = released_estimate(self.db, item_id, self.on)
            if est is not None and (est.lot_size or 0) > _EPS:
                f = qty / float(est.lot_size)
                return dict(material=est.material_cost * f, labour=est.labour_cost * f, overhead=est.overhead_cost * f,
                            job_work=est.job_work_cost * f, source="sub_estimate", sub_estimate_id=est.id)
            sub = self.cost_bom(sub_bom, qty, level + 1, line_idx, path + [item_id])
            return dict(material=sub["material"], labour=sub["labour"], overhead=sub["overhead"], job_work=sub["job_work"],
                        own_material=sub["own_material"], own_labour=sub["own_labour"], source="sub_rollup")
        jw = _job_work_cost(self.db, item_id, self.on)
        if jw is not None:
            m, j = jw[0] * qty, jw[1] * qty
            return dict(zero, material=m, job_work=j, own_material=m, source="job_work")
        if item is not None and (item.standard_cost or 0) > 0:
            m = float(item.standard_cost) * qty
            return dict(zero, material=m, own_material=m, source="standard")
        if item is not None and (item.moving_average_cost or 0) > 0:
            m = float(item.moving_average_cost) * qty
            return dict(zero, material=m, own_material=m, source="moving_average")
        self._warn(f"{_item_label(item)} has no cost — set its standard cost in Store › Items (or receive it once so "
                   f"Store has a moving-average cost); it is costed at ₹0.")
        return dict(zero, source="none")


def _resolve_bom(db: Session, item_id: int | None, bom_id: int | None) -> ProductionBom:
    if bom_id:
        bom = db.get(ProductionBom, bom_id)
        if bom is None or bom.is_deleted:
            raise ValueError(f"BOM #{bom_id} doesn't exist.")
        if item_id and bom.product_item_id != item_id:
            raise ValueError(f"BOM {bom.bom_number} is not a BOM of the selected item — pick one of the item's own BOM versions.")
        if bom.status == "obsolete":
            raise ValueError(f"BOM {bom.bom_number} v{bom.version} is obsolete — cost the active version instead.")
        return bom
    if not item_id:
        raise ValueError("Pick the item (finished good or sub-assembly) to cost.")
    bom = active_bom(db, item_id)
    if bom is None:
        item = db.get(StoreItem, item_id)
        raise ValueError(f"{_item_label(item)} has no active production BOM — activate one in Production › BOM & Routing, "
                         f"or pick the draft BOM version to cost.")
    return bom


def preview(db: Session, *, item_id: int | None = None, bom_id: int | None = None, costing_date: date | None = None,
            lot_size: float | None = None, branch_id: int | None = None,
            material_overhead_pct: float | None = None, labour_overhead_pct: float | None = None) -> dict:
    """Costs the BOM without saving anything. Returns header + lines."""
    on = costing_date or date.today()
    bom = _resolve_bom(db, item_id, bom_id)
    lot = float(lot_size) if lot_size else float(bom.base_quantity or 1)
    if lot <= _EPS:
        raise ValueError("Lot size must be more than zero.")
    sheet_m, sheet_l = costing_sheet(db, branch_id, on)
    m_pct = sheet_m if material_overhead_pct is None else float(material_overhead_pct)
    l_pct = sheet_l if labour_overhead_pct is None else float(labour_overhead_pct)
    if m_pct < 0 or l_pct < 0:
        raise ValueError("Overhead % can't be negative.")
    est = _Estimator(db, on, bom.product_item_id)
    tot = est.cost_bom(bom, lot, 1, None, [bom.product_item_id])
    m_oh = tot["own_material"] * m_pct / 100
    l_oh = tot["own_labour"] * l_pct / 100
    for desc, base, pct, amt in (("Material overhead", tot["own_material"], m_pct, m_oh), ("Labour overhead", tot["own_labour"], l_pct, l_oh)):
        if amt > _EPS:
            est.lines.append(dict(level=1, parent=None, line_type="overhead", item_id=None, description=f"{desc} {pct:g}%",
                                  quantity=_r(base), uom="₹", unit_cost=pct / 100, material_amount=0.0, labour_amount=0.0,
                                  overhead_amount=_r(amt), job_work_amount=0.0, cost_source="costing_sheet", sub_estimate_id=None))
    material, labour, job = _r(tot["material"]), _r(tot["labour"]), _r(tot["job_work"])
    overhead = _r(tot["overhead"] + m_oh + l_oh)
    total = _r(material + labour + overhead + job)
    for ln in est.lines:
        ln["amount"] = _r(ln["material_amount"] + ln["labour_amount"] + ln["overhead_amount"] + ln["job_work_amount"])
        if "unit_cost" not in ln:
            ln["unit_cost"] = _r(ln["amount"] / ln["quantity"], 4) if ln["quantity"] > _EPS else 0.0
    product = db.get(StoreItem, bom.product_item_id)
    return {
        "item_id": bom.product_item_id, "item_label": _item_label(product), "bom_id": bom.id, "bom_number": bom.bom_number,
        "bom_version": bom.version, "costing_date": on, "lot_size": lot, "branch_id": branch_id,
        "material_cost": material, "labour_cost": labour, "overhead_cost": overhead, "job_work_cost": job,
        "total_cost": total, "unit_cost": _r(total / lot, 4),
        "material_overhead_pct": m_pct, "labour_overhead_pct": l_pct, "warnings": est.warnings, "lines": est.lines,
        "current_standard_cost": float(product.standard_cost) if product and product.standard_cost is not None else None,
    }


def run_estimate(db: Session, *, user_id: int | None, remarks: str | None = None, **kw) -> ProductionCostEstimate:
    data = preview(db, **kw)
    item = db.get(StoreItem, data["item_id"])
    version = (db.query(func.max(ProductionCostEstimate.version)).filter(ProductionCostEstimate.item_id == item.id).scalar() or 0) + 1
    est = ProductionCostEstimate(
        estimate_number=f"CE-{item.item_code}-{version:03d}"[:100], item_id=item.id, bom_id=data["bom_id"],
        branch_id=data["branch_id"], version=version, costing_date=data["costing_date"], lot_size=data["lot_size"],
        status="draft", material_cost=data["material_cost"], labour_cost=data["labour_cost"],
        overhead_cost=data["overhead_cost"], job_work_cost=data["job_work_cost"], total_cost=data["total_cost"],
        unit_cost=data["unit_cost"], material_overhead_pct=data["material_overhead_pct"],
        labour_overhead_pct=data["labour_overhead_pct"], warnings=data["warnings"], remarks=remarks,
        created_by_id=user_id,
    )
    db.add(est)
    db.flush()
    ids: list[int] = []
    for n, ln in enumerate(data["lines"], start=1):
        row = ProductionCostEstimateLine(
            estimate_id=est.id, line_number=n, level=ln["level"],
            parent_line_id=ids[ln["parent"]] if ln.get("parent") is not None else None,
            line_type=ln["line_type"], item_id=ln.get("item_id"), operation_name=ln.get("operation_name"),
            workstation_id=ln.get("workstation_id"), description=(ln.get("description") or "")[:300],
            quantity=ln["quantity"], uom=ln.get("uom"), unit_cost=ln["unit_cost"], amount=ln["amount"],
            material_amount=ln["material_amount"], labour_amount=ln["labour_amount"],
            overhead_amount=ln["overhead_amount"], job_work_amount=ln["job_work_amount"],
            cost_source=ln["cost_source"], sub_estimate_id=ln.get("sub_estimate_id"),
        )
        db.add(row)
        db.flush()
        ids.append(row.id)
    return est


# ─────────────────────────────────────────────────────────────────────────
# CK24 — mark & release
# ─────────────────────────────────────────────────────────────────────────

def mark(db: Session, est: ProductionCostEstimate, user_id: int | None) -> ProductionCostEstimate:
    if est.status != "draft":
        raise ValueError(f"Only a draft estimate can be marked (this one is {est.status}).")
    if (est.total_cost or 0) <= 0:
        raise ValueError("This estimate costs ₹0 — fix the missing costs listed under Warnings and run a new estimate before marking it.")
    # One marked estimate per item: an older mark goes back to draft.
    db.query(ProductionCostEstimate).filter(
        ProductionCostEstimate.item_id == est.item_id, ProductionCostEstimate.status == "marked",
        ProductionCostEstimate.id != est.id,
    ).update({ProductionCostEstimate.status: "draft", ProductionCostEstimate.marked_at: None,
              ProductionCostEstimate.marked_by_id: None}, synchronize_session=False)
    est.status, est.marked_by_id, est.marked_at = "marked", user_id, datetime.now(timezone.utc)
    db.flush()
    return est


def unmark(db: Session, est: ProductionCostEstimate) -> ProductionCostEstimate:
    if est.status != "marked":
        raise ValueError(f"Only a marked estimate can be unmarked (this one is {est.status}).")
    est.status, est.marked_by_id, est.marked_at = "draft", None, None
    db.flush()
    return est


def release(db: Session, est: ProductionCostEstimate, user_id: int | None, valid_from: date | None = None,
            remarks: str | None = None) -> ProductionCostEstimate:
    """Writes the estimate's unit cost to the item's standard price, valid
    from `valid_from` (default today). The previously released estimate and
    price-history row end the day before."""
    if est.status != "marked":
        raise ValueError(f"Only a marked estimate can be released — mark it first (this one is {est.status}).")
    start = valid_from or date.today()
    current = db.query(ProductionCostEstimate).filter(
        ProductionCostEstimate.item_id == est.item_id, ProductionCostEstimate.status == "released",
        ProductionCostEstimate.id != est.id,
    ).order_by(ProductionCostEstimate.valid_from.desc()).first()
    if current is not None and current.valid_from and start <= current.valid_from:
        raise ValueError(f"{current.estimate_number} is already released from {current.valid_from:%d-%b-%Y}. The new standard "
                         f"price must start after that date — pick a later 'valid from'.")
    item = db.get(StoreItem, est.item_id)
    if item is None:
        raise ValueError("The estimate's item no longer exists.")
    if current is not None:
        current.status, current.valid_to = "superseded", start - timedelta(days=1)
    open_hist = db.query(StoreItemStandardPrice).filter(
        StoreItemStandardPrice.item_id == item.id, StoreItemStandardPrice.valid_to.is_(None)).all()
    for h in open_hist:
        if h.valid_from >= start:
            raise ValueError(f"A standard price for {item.item_code} already starts on {h.valid_from:%d-%b-%Y}. "
                             f"Pick a 'valid from' after that date.")
        h.valid_to = start - timedelta(days=1)
    previous = float(item.standard_cost) if item.standard_cost is not None else None
    db.add(StoreItemStandardPrice(
        item_id=item.id, standard_cost=est.unit_cost, previous_cost=previous, valid_from=start, source="estimate",
        cost_estimate_id=est.id, released_by_id=user_id, remarks=remarks,
    ))
    item.standard_cost = est.unit_cost
    est.status, est.valid_from, est.valid_to = "released", start, None
    est.previous_standard_cost = previous
    est.released_by_id, est.released_at = user_id, datetime.now(timezone.utc)
    db.flush()
    return est


def cancel(db: Session, est: ProductionCostEstimate, reason: str | None) -> ProductionCostEstimate:
    if est.status not in ("draft", "marked"):
        raise ValueError(f"A {est.status} estimate can't be cancelled — it is part of the price history. Release a new one instead.")
    if not (reason or "").strip():
        raise ValueError("Give a reason for cancelling the estimate.")
    est.status, est.cancelled_reason = "cancelled", reason.strip()
    db.flush()
    return est


def standard_price_on(db: Session, item_id: int, on: date) -> float | None:
    """Standard price valid on `on` from the history, else the item's current one."""
    h = db.query(StoreItemStandardPrice).filter(
        StoreItemStandardPrice.item_id == item_id, StoreItemStandardPrice.valid_from <= on,
        sa.or_(StoreItemStandardPrice.valid_to.is_(None), StoreItemStandardPrice.valid_to >= on),
    ).order_by(StoreItemStandardPrice.valid_from.desc()).first()
    if h is not None:
        return float(h.standard_cost)
    item = db.get(StoreItem, item_id)
    return float(item.standard_cost) if item is not None and item.standard_cost is not None else None


# ─────────────────────────────────────────────────────────────────────────
# KKBC_ORD — order plan / target / actual
# ─────────────────────────────────────────────────────────────────────────

def _plan_for_order(db: Session, wo: ProductionWorkOrder) -> tuple[dict | None, str, str | None]:
    """(plan dict like preview(), source, estimate_number)."""
    on = wo.planned_start_date or (wo.created_at.date() if wo.created_at else date.today())
    est = released_estimate(db, wo.product_item_id, on, bom_id=wo.bom_id) or released_estimate(db, wo.product_item_id, date.today(), bom_id=wo.bom_id)
    if est is not None:
        lines = [{
            "level": l.level, "line_type": l.line_type, "item_id": l.item_id, "workstation_id": l.workstation_id,
            "operation_name": l.operation_name, "description": l.description, "quantity": l.quantity, "unit_cost": l.unit_cost,
            "amount": l.amount, "material_amount": l.material_amount, "labour_amount": l.labour_amount,
            "overhead_amount": l.overhead_amount, "job_work_amount": l.job_work_amount,
        } for l in est.lines]
        plan = {"lot_size": est.lot_size, "material_cost": est.material_cost, "labour_cost": est.labour_cost,
                "overhead_cost": est.overhead_cost, "job_work_cost": est.job_work_cost, "total_cost": est.total_cost,
                "material_overhead_pct": est.material_overhead_pct, "labour_overhead_pct": est.labour_overhead_pct,
                "lines": lines}
        return plan, "released_estimate", est.estimate_number
    try:
        plan = preview(db, bom_id=wo.bom_id, costing_date=on, branch_id=wo.branch_id)
    except ValueError:
        return None, "none", None
    return plan, "bom_preview", None


def order_plan_actual(db: Session, wo: ProductionWorkOrder) -> dict:
    """Plan (released estimate × planned qty), target (× completed qty) and
    actual (production/costing.py cost lines + time logs) with variances:
      input quantity = (actual qty − target qty) × plan rate
      input price    = actual value − actual qty × plan rate
      resource usage = (actual hours − target hours) × plan rate   (labour)
      rate           = actual labour − actual hours × plan rate
      scrap          = scrapped qty × plan unit cost   (shown, inside the totals)
    Target uses completed qty; while nothing is completed it uses planned
    qty so a running order still shows meaningful numbers."""
    from app.modules.production.costing import order_cost

    plan, plan_source, est_no = _plan_for_order(db, wo)
    product = db.get(StoreItem, wo.product_item_id)
    planned = float(wo.quantity_planned or 0)
    completed = float(wo.quantity_completed or 0)
    target_qty = completed if completed > _EPS else planned
    actual_tot = order_cost(db, wo)

    # Actual material by item (qty + value).
    act_items: dict[int, dict] = {}
    for item_id, ptype, qty, amount in db.query(
        ProductionOrderCostPosting.item_id, ProductionOrderCostPosting.posting_type,
        func.coalesce(func.sum(ProductionOrderCostPosting.quantity), 0.0), func.coalesce(func.sum(ProductionOrderCostPosting.amount), 0.0),
    ).filter(ProductionOrderCostPosting.work_order_id == wo.id,
             ProductionOrderCostPosting.posting_type.in_(("material_issue", "material_return"))).group_by(
        ProductionOrderCostPosting.item_id, ProductionOrderCostPosting.posting_type).all():
        sign = 1 if ptype == "material_issue" else -1
        a = act_items.setdefault(item_id, {"qty": 0.0, "amount": 0.0})
        a["qty"] += sign * float(qty or 0)
        a["amount"] += sign * float(amount or 0)

    # Actual hours / cost by work centre.
    op_ws = {op.id: op.workstation_id for op in wo.operations}
    logs = db.query(ProductionTimeLog).filter(ProductionTimeLog.work_order_id == wo.id).all()
    from app.modules.production.costing import _log_rates
    rates = _log_rates(db, logs, op_ws)
    act_ws: dict[int | None, dict] = {}
    for log in logs:
        ws = log.workstation_id or op_ws.get(log.operation_id)
        a = act_ws.setdefault(ws, {"hours": 0.0, "amount": 0.0})
        a["hours"] += float(log.hours or 0)
        a["amount"] += float(log.hours or 0) * rates[log.id]

    lot = float(plan["lot_size"]) if plan else 1.0
    f_plan, f_target = (planned / lot, target_qty / lot) if plan else (0.0, 0.0)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(set(act_items) | {
        l["item_id"] for l in (plan["lines"] if plan else []) if l.get("item_id")})).all()}
    wss = {w.id: w for w in db.query(ProductionWorkstation).filter(ProductionWorkstation.id.in_({k for k in act_ws if k} | {
        l["workstation_id"] for l in (plan["lines"] if plan else []) if l.get("workstation_id")})).all()}

    material_rows: dict[int, dict] = {}
    labour_rows: dict[int | None, dict] = {}
    plan_overhead = 0.0
    for l in (plan["lines"] if plan else []):
        if l["level"] != 1:
            continue
        if l["line_type"] == "material":
            r = material_rows.setdefault(l["item_id"], {"plan_qty": 0.0, "plan_amount": 0.0, "plan_job_work": 0.0})
            r["plan_qty"] += l["quantity"] * f_plan
            r["plan_amount"] += l["amount"] * f_plan
            r["plan_job_work"] += l["job_work_amount"] * f_plan
        elif l["line_type"] == "activity":
            r = labour_rows.setdefault(l.get("workstation_id"), {"plan_hours": 0.0, "plan_amount": 0.0})
            r["plan_hours"] += l["quantity"] * f_plan
            r["plan_amount"] += l["amount"] * f_plan
        else:
            plan_overhead += l["amount"] * f_plan

    def var_material(item_id, r):
        a = act_items.get(item_id, {"qty": 0.0, "amount": 0.0})
        tq = r["plan_qty"] * (f_target / f_plan) if f_plan > _EPS else 0.0
        ta = r["plan_amount"] * (f_target / f_plan) if f_plan > _EPS else 0.0
        rate = r["plan_amount"] / r["plan_qty"] if r["plan_qty"] > _EPS else 0.0
        if rate > _EPS:
            qv, pv = (a["qty"] - tq) * rate, a["amount"] - a["qty"] * rate
        else:
            qv, pv = a["amount"] - ta, 0.0
        it = items.get(item_id)
        jw_share = r["plan_job_work"] / r["plan_amount"] if r["plan_amount"] > _EPS else 0.0
        return {
            "item_id": item_id, "item_code": it.item_code if it else None, "item_name": it.item_name if it else None,
            "uom": it.uom if it else None, "plan_qty": _r(r["plan_qty"], 4), "plan_amount": _r(r["plan_amount"]),
            "target_qty": _r(tq, 4), "target_amount": _r(ta), "actual_qty": _r(a["qty"], 4), "actual_amount": _r(a["amount"]),
            "plan_rate": _r(rate, 4), "quantity_variance": _r(qv), "price_variance": _r(pv),
            "total_variance": _r(a["amount"] - ta), "planned": r["plan_qty"] > _EPS or r["plan_amount"] > _EPS,
            "_job_share": jw_share,
        }

    mats = [var_material(i, r) for i, r in material_rows.items()]
    for item_id in act_items:
        if item_id not in material_rows:
            mats.append(var_material(item_id, {"plan_qty": 0.0, "plan_amount": 0.0, "plan_job_work": 0.0}))
    mats.sort(key=lambda m: (not m["planned"], m["item_code"] or ""))

    labs = []
    for ws_id in set(labour_rows) | set(act_ws):
        r = labour_rows.get(ws_id, {"plan_hours": 0.0, "plan_amount": 0.0})
        a = act_ws.get(ws_id, {"hours": 0.0, "amount": 0.0})
        th = r["plan_hours"] * (f_target / f_plan) if f_plan > _EPS else 0.0
        ta = r["plan_amount"] * (f_target / f_plan) if f_plan > _EPS else 0.0
        rate = r["plan_amount"] / r["plan_hours"] if r["plan_hours"] > _EPS else 0.0
        uv, rv = ((a["hours"] - th) * rate, a["amount"] - a["hours"] * rate) if rate > _EPS else (a["amount"] - ta, 0.0)
        ws = wss.get(ws_id)
        labs.append({
            "workstation_id": ws_id, "workstation": f"{ws.code} — {ws.name}" if ws else "No work centre",
            "plan_hours": _r(r["plan_hours"], 2), "plan_amount": _r(r["plan_amount"]), "target_hours": _r(th, 2),
            "target_amount": _r(ta), "actual_hours": _r(a["hours"], 2), "actual_amount": _r(a["amount"]),
            "plan_rate": _r(rate, 2), "usage_variance": _r(uv), "rate_variance": _r(rv), "total_variance": _r(a["amount"] - ta),
        })
    labs.sort(key=lambda x: x["workstation"])

    m_pct = float(plan["material_overhead_pct"]) if plan else 0.0
    l_pct = float(plan["labour_overhead_pct"]) if plan else 0.0
    act_material = float(actual_tot["material"])
    act_labour = float(actual_tot["labour"])
    act_job = sum(m["actual_amount"] * m["_job_share"] for m in mats)
    # Overhead actually applied by the period-end overhead run; until a run
    # has charged the order, applied at the plan % on actual material/labour.
    act_overhead = float(actual_tot.get("overhead") or 0)
    overhead_basis = "overhead_run"
    if abs(act_overhead) < _EPS:
        act_overhead = act_material * m_pct / 100 + act_labour * l_pct / 100
        overhead_basis = "plan_rate"
    for m in mats:
        m.pop("_job_share", None)

    def comp(name, plan_v, actual_v):
        target_v = plan_v * (f_target / f_plan) if f_plan > _EPS else 0.0
        return {"component": name, "plan": _r(plan_v), "target": _r(target_v), "actual": _r(actual_v),
                "variance": _r(actual_v - target_v),
                "variance_pct": _r((actual_v - target_v) / target_v * 100, 1) if abs(target_v) > _EPS else None}

    plan_job = sum(r["plan_job_work"] for r in material_rows.values())
    plan_mat_total = sum(r["plan_amount"] for r in material_rows.values())
    plan_lab_total = sum(r["plan_amount"] for r in labour_rows.values())
    components = [
        comp("material", plan_mat_total - plan_job, act_material - act_job),
        comp("job_work", plan_job, act_job),
        comp("labour", plan_lab_total, act_labour),
        comp("overhead", plan_overhead, act_overhead),
    ]
    plan_total = sum(c["plan"] for c in components)
    target_total = sum(c["target"] for c in components)
    actual_total = sum(c["actual"] for c in components)
    unit_plan = (plan["total_cost"] / lot) if plan else 0.0
    return {
        "work_order_id": wo.id, "wo_number": wo.wo_number, "status": wo.status,
        "product_item_id": wo.product_item_id, "product_label": _item_label(product),
        "quantity_planned": planned, "quantity_completed": completed, "quantity_scrapped": float(wo.quantity_scrapped or 0),
        "target_basis": "completed" if completed > _EPS else "planned",
        "plan_source": plan_source, "estimate_number": est_no,
        "plan_message": None if plan else "No released cost estimate and the order's BOM couldn't be costed — run and release an estimate in Finance › Controlling › Product Costing.",
        "material_overhead_pct": m_pct, "labour_overhead_pct": l_pct, "overhead_basis": overhead_basis,
        "components": components, "materials": mats, "labour": labs,
        "plan_total": _r(plan_total), "target_total": _r(target_total), "actual_total": _r(actual_total),
        "total_variance": _r(actual_total - target_total),
        "total_variance_pct": _r((actual_total - target_total) / target_total * 100, 1) if abs(target_total) > _EPS else None,
        "scrap_variance": _r(float(wo.quantity_scrapped or 0) * unit_plan),
        "variance_split": {
            "input_quantity": _r(sum(m["quantity_variance"] for m in mats)),
            "input_price": _r(sum(m["price_variance"] for m in mats)),
            "resource_usage": _r(sum(l["usage_variance"] for l in labs)),
            "rate": _r(sum(l["rate_variance"] for l in labs)),
            "overhead": _r(components[3]["variance"]),
        },
        "relieved_to_stock": _r(actual_tot["relieved"]), "open_wip": _r(actual_tot["open"]),
    }


def order_variance_list(db: Session, *, status: str | None = None, limit: int = 200) -> list[dict]:
    q = db.query(ProductionWorkOrder).filter(ProductionWorkOrder.is_deleted == False, ProductionWorkOrder.status != "cancelled")  # noqa: E712
    if status:
        q = q.filter(ProductionWorkOrder.status == status)
    out = []
    for wo in q.order_by(ProductionWorkOrder.id.desc()).limit(limit).all():
        r = order_plan_actual(db, wo)
        out.append({k: r[k] for k in ("work_order_id", "wo_number", "status", "product_label", "quantity_planned",
                                      "quantity_completed", "plan_source", "estimate_number", "plan_total", "target_total",
                                      "actual_total", "total_variance", "total_variance_pct")})
    return out
