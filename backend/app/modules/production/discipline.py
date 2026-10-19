"""Discipline BOMs into the manufacturing BOM (SAP CWBPP / engineering
workbench: electrical and hydraulic engineering hand their part lists to
the product structure).

Electrical (one job's BOM) and Hydraulic (a released HydBom) keep their
own engineering lists. Production merges them into a *draft* Production BOM
of the machine: one line per Item Master code, quantities summed with any
line already there, tagged with where they came from (source_tag), so the
parts are reserved, issued and planned like every other component. Merging
the same source again after it was revised takes the previous merge's
quantities back off first (ProductionBomDisciplineMerge.quantities).

Release rules (E/H release stays with the discipline's head / assignee —
nothing here releases anything):
- hydraulic: the HydBom must be `released`; every line's component must be
  linked to a Store item;
- electrical: the job's "Electrical BOM" stage must be completed; every
  live line must carry an Item Master code (store_item_id)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.production.models.bom import ProductionBom, ProductionBomDisciplineMerge, ProductionBomItem
from app.modules.store.models.item import StoreItem


class DisciplineError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


@dataclass
class DisciplineLines:
    label: str
    title: str | None
    status: str
    quantities: dict[int, float]
    notes: dict[int, str]
    unmapped: list[str]
    problem: str | None


def _hydraulic(db: Session, source_id: int) -> DisciplineLines:
    from app.modules.hydraulic.models.bom import HydBom
    from app.modules.hydraulic.models.component import HydComponent
    bom = db.query(HydBom).filter(HydBom.id == source_id, HydBom.is_deleted == False).first()  # noqa: E712
    if bom is None:
        raise DisciplineError(f"Hydraulic BOM #{source_id} not found", 404)
    comps = {c.id: c for c in db.query(HydComponent).filter(HydComponent.id.in_({i.component_id for i in bom.items})).all()} if bom.items else {}
    qty: dict[int, float] = {}
    notes: dict[int, str] = {}
    unmapped = []
    for line in bom.items:
        comp = comps.get(line.component_id)
        if comp is None or not comp.store_item_id:
            unmapped.append(f"{line.tag_number or '—'} {comp.code if comp else '#' + str(line.component_id)}")
            continue
        qty[comp.store_item_id] = round(qty.get(comp.store_item_id, 0.0) + float(line.quantity or 0), 4)
        notes[comp.store_item_id] = ", ".join(filter(None, [notes.get(comp.store_item_id), line.tag_number]))
    label = f"HYD {bom.bom_number} rev {bom.revision}"
    problem = None
    if bom.status != "released":
        problem = (f"{bom.bom_number} rev {bom.revision} is {bom.status.replace('_', ' ')} in Hydraulics. Only a released hydraulic BOM can be "
                   "merged — ask the Hydraulics head (or the BOM's assignee) to release it.")
    elif unmapped:
        problem = (f"{bom.bom_number}: component(s) {', '.join(unmapped[:8])} are not linked to an Item Master code. "
                   "Link each component to its Store item in Hydraulics › Components, then merge again.")
    elif not qty:
        problem = f"{bom.bom_number} has no lines to merge."
    return DisciplineLines(label, bom.title, bom.status, qty, notes, unmapped, problem)


def _electrical(db: Session, source_id: int) -> DisciplineLines:
    from app.modules.electrical.models.bom import ElectricalBomItem
    from app.modules.electrical.models.job import ElectricalJob, ElectricalJobStage
    job = db.query(ElectricalJob).filter(ElectricalJob.id == source_id, ElectricalJob.is_deleted == False).first()  # noqa: E712
    if job is None:
        raise DisciplineError(f"Electrical job #{source_id} not found", 404)
    lines = db.query(ElectricalBomItem).filter(ElectricalBomItem.job_id == job.id, ElectricalBomItem.is_deleted == False).order_by(ElectricalBomItem.line_no).all()  # noqa: E712
    stage = db.query(ElectricalJobStage).filter(ElectricalJobStage.job_id == job.id, ElectricalJobStage.stage_key == "electrical_bom").first()
    qty: dict[int, float] = {}
    notes: dict[int, str] = {}
    unmapped = []
    for line in lines:
        if not line.store_item_id:
            unmapped.append(f"line {line.line_no} {line.description[:40]}")
            continue
        qty[line.store_item_id] = round(qty.get(line.store_item_id, 0.0) + float(line.quantity or 0), 4)
        notes[line.store_item_id] = ", ".join(filter(None, [notes.get(line.store_item_id), f"L{line.line_no}"]))
    stage_status = stage.status if stage else "not_started"
    problem = None
    if job.status == "cancelled":
        problem = f"Electrical job {job.job_number} is cancelled, so its BOM can't be merged."
    elif stage_status != "completed":
        problem = (f"The Electrical BOM stage of {job.job_number} is {stage_status.replace('_', ' ')}. It must be completed (released by the "
                   "Electrical head or the stage assignee) before Production can merge it.")
    elif unmapped:
        problem = (f"{job.job_number}: {', '.join(unmapped[:8])} have no Item Master code. Pick the Store item on each line in "
                   "Electrical › BOM (or ask Store to create the code), then merge again.")
    elif not qty:
        problem = f"Electrical job {job.job_number} has no BOM lines to merge."
    return DisciplineLines(f"ELEC {job.job_number}", job.title, stage_status, qty, notes, unmapped, problem)


def load_source(db: Session, source_type: str, source_id: int) -> DisciplineLines:
    if source_type == "hydraulic":
        return _hydraulic(db, source_id)
    if source_type == "electrical":
        return _electrical(db, source_id)
    raise DisciplineError(f"Unknown discipline '{source_type}'. Use 'electrical' or 'hydraulic'.", 400)


def list_sources(db: Session, search: str | None = None) -> list[dict]:
    from app.modules.electrical.models.job import ElectricalJob
    from app.modules.hydraulic.models.bom import HydBom
    needle = (search or "").strip().lower()
    out = []
    for bom in db.query(HydBom).filter(HydBom.is_deleted == False, HydBom.status.in_(("released", "under_review", "draft"))).order_by(HydBom.bom_number).limit(300).all():  # noqa: E712
        if needle and needle not in f"{bom.bom_number} {bom.title}".lower():
            continue
        src = _hydraulic(db, bom.id)
        out.append({"source_type": "hydraulic", "source_id": bom.id, "label": src.label, "title": src.title, "status": src.status,
                    "line_count": len(bom.items), "unmapped_count": len(src.unmapped), "mergeable": src.problem is None, "problem": src.problem})
    for job in db.query(ElectricalJob).filter(ElectricalJob.is_deleted == False, ElectricalJob.status != "cancelled").order_by(ElectricalJob.job_number).limit(300).all():  # noqa: E712
        if needle and needle not in f"{job.job_number} {job.title}".lower():
            continue
        src = _electrical(db, job.id)
        out.append({"source_type": "electrical", "source_id": job.id, "label": src.label, "title": src.title, "status": src.status,
                    "line_count": len(src.quantities) + len(src.unmapped), "unmapped_count": len(src.unmapped),
                    "mergeable": src.problem is None, "problem": src.problem})
    out.sort(key=lambda r: (not r["mergeable"], r["label"]))
    return out


def merge_into(db: Session, bom: ProductionBom, source_type: str, source_id: int, multiplier: float, user_id: int | None) -> ProductionBomDisciplineMerge:
    """Adds the source's lines to the draft (per base_quantity of the
    product). Caller checks the BOM is an editable draft and commits."""
    src = load_source(db, source_type, source_id)
    if src.problem:
        raise DisciplineError(src.problem)
    if bom.product_item_id in src.quantities:
        raise DisciplineError(f"{src.label} lists the product itself as a component, so it can't be merged into its own BOM.", 400)
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_(src.quantities)).all()}
    inactive = [i.item_code for i in items.values() if i.status != "active"]
    if inactive:
        raise DisciplineError(f"{src.label}: item(s) {', '.join(inactive)} are inactive in Store. Replace them in the discipline BOM first.")
    base = bom.base_quantity or 1.0
    new_qty = {iid: round(q * multiplier * base, 4) for iid, q in src.quantities.items()}

    previous = db.query(ProductionBomDisciplineMerge).filter(
        ProductionBomDisciplineMerge.bom_id == bom.id, ProductionBomDisciplineMerge.source_type == source_type,
        ProductionBomDisciplineMerge.source_id == source_id,
    ).first()
    by_item = {i.component_item_id: i for i in bom.items if i.component_item_id and (i.item_category or "stock") in ("stock", "non_stock")}
    if previous is not None:
        for key, q in (previous.quantities or {}).items():
            line = by_item.get(int(key))
            if line is None:
                continue
            line.quantity = round(line.quantity - float(q), 4)
            if line.source_tag:
                tags = [t for t in line.source_tag.split("; ") if t != previous.source_label]
                line.source_tag = "; ".join(tags) or None
            if line.quantity <= 1e-9:
                bom.items.remove(line)
                by_item.pop(int(key), None)
    next_sort = max((i.sort_order for i in bom.items), default=-1) + 1
    for iid, q in new_qty.items():
        line = by_item.get(iid)
        if line is not None:
            line.quantity = round(line.quantity + q, 4)
            tags = [t for t in (line.source_tag or "").split("; ") if t]
            if src.label not in tags:
                tags.append(src.label)
            line.source_tag = "; ".join(tags)[:255]
        else:
            note = src.notes.get(iid)
            bom.items.append(ProductionBomItem(
                component_item_id=iid, quantity=q, scrap_percent=0.0, sort_order=next_sort, make_buy="buy",
                item_category="stock", source_tag=src.label,
                remarks=f"From {src.label}" + (f" ({note})" if note else ""),
            ))
            next_sort += 1
    if previous is None:
        previous = ProductionBomDisciplineMerge(bom_id=bom.id, source_type=source_type, source_id=source_id, source_label=src.label)
        db.add(previous)
    previous.source_label = src.label
    previous.quantities = {str(k): v for k, v in new_qty.items()}
    previous.merged_by_id = user_id
    previous.merged_at = datetime.now(timezone.utc)
    db.flush()
    return previous


def carry_merges(db: Session, source: ProductionBom, target: ProductionBom) -> None:
    """A new version copied from `source` keeps the record of what was merged."""
    for m in db.query(ProductionBomDisciplineMerge).filter(ProductionBomDisciplineMerge.bom_id == source.id).all():
        db.add(ProductionBomDisciplineMerge(
            bom_id=target.id, source_type=m.source_type, source_id=m.source_id, source_label=m.source_label,
            quantities=dict(m.quantities or {}), merged_by_id=m.merged_by_id, merged_at=m.merged_at,
        ))


def reapply_merges(db: Session, bom: ProductionBom) -> None:
    """After the Design components of a draft were replaced (eBOM refresh /
    ECN transfer), add the merged discipline quantities back on top, so the
    electrical / hydraulic parts aren't lost."""
    merges = db.query(ProductionBomDisciplineMerge).filter(ProductionBomDisciplineMerge.bom_id == bom.id).all()
    if not merges:
        return
    by_item = {i.component_item_id: i for i in bom.items if i.component_item_id and (i.item_category or "stock") in ("stock", "non_stock")}
    next_sort = max((i.sort_order for i in bom.items), default=-1) + 1
    for m in merges:
        for key, q in (m.quantities or {}).items():
            iid = int(key)
            line = by_item.get(iid)
            if line is not None:
                line.quantity = round(line.quantity + float(q), 4)
                tags = [t for t in (line.source_tag or "").split("; ") if t]
                if m.source_label not in tags:
                    tags.append(m.source_label)
                line.source_tag = "; ".join(tags)[:255]
            else:
                line = ProductionBomItem(component_item_id=iid, quantity=float(q), scrap_percent=0.0, sort_order=next_sort,
                                         make_buy="buy", item_category="stock", source_tag=m.source_label, remarks=f"From {m.source_label}")
                bom.items.append(line)
                by_item[iid] = line
                next_sort += 1
