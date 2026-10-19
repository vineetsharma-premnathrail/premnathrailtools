"""Batch management (SAP MSC1N / MMBE batch stock / batch determination).

Batch-managed items (Item Master "Batch tracked") get one StoreBatch per heat
the vendor supplied on a GRN line; every ledger row of such an item carries
the batch's number, so stock by batch is read from the stock ledger (the
same source Quality's traceability already uses) — no second balance table
that could drift.

Hooks other modules call (they flush, never commit):
  validate_grn_line_batches(item, received_qty, batches)   GRN create — split must equal received qty
  create_grn_batches(db, grn, line, item, vendor_id, vendor_name, batches, user_id) -> [StoreBatch]
  grn_line_splits(db, line, qty)            -> [(batch_number | None, qty)]  receipt / reversal postings
  apply_line_inspection(db, line, entries)  GRN store inspection — which heats were accepted
  allocate_issue(db, item, location_id, qty, batch_number) -> [(batch_number, qty)]  issue batch pick (FIFO / FEFO)
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.store.models.batch import StoreBatch
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_transaction import STORE_STOCK_TYPE_EFFECT, StoreStockTransaction

_EPS = 1e-9
BUCKETS = ("free", "quality", "blocked", "vendor")


def is_batch_managed(item: StoreItem | None) -> bool:
    return bool(item is not None and item.batch_controlled)


def generate_batch_number(db: Session) -> str:
    """BT-[YEAR]-[NUMBER], sequence scoped per year (same locking as the other Store numbers)."""
    from app.modules.store.service import _lock_number_series
    prefix = f"BT-{date.today().year}-"
    _lock_number_series(db, prefix)
    last = db.query(func.max(StoreBatch.batch_number)).filter(StoreBatch.batch_number.like(f"{prefix}%")).scalar()
    return f"{prefix}{(int(last.rsplit('-', 1)[-1]) + 1) if last else 1:04d}"


# ---------------------------------------------------------------------------
# GRN
# ---------------------------------------------------------------------------

def validate_grn_line_batches(item: StoreItem, received_qty: float, batches: list) -> None:
    """Batch-managed item: the vendor's heats must be listed and add up to the
    received quantity. Not batch-managed: no batches allowed (they would be
    silently lost)."""
    name = item.item_name
    if not is_batch_managed(item):
        if batches:
            raise HTTPException(status_code=422, detail=f"'{name}' isn't batch-tracked in the Item Master, so it can't take batch / heat "
                                                        "numbers. Remove them, or tick 'Batch tracked' on the item first.")
        return
    if not batches:
        raise HTTPException(status_code=422, detail=f"'{name}' is batch-tracked — enter the vendor's heat / batch number(s) for the "
                                                    f"{received_qty:g} received (split it if the vendor supplied more than one heat), with the mill TC number.")
    seen: set[str] = set()
    total = 0.0
    for b in batches:
        heat = (b.heat_number or "").strip()
        if not heat:
            raise HTTPException(status_code=422, detail=f"'{name}': every batch row needs the vendor's heat / batch number (as printed on the mill TC).")
        if heat.lower() in seen:
            raise HTTPException(status_code=422, detail=f"'{name}': heat / batch '{heat}' is entered twice — put its whole quantity on one row.")
        seen.add(heat.lower())
        if b.quantity is None or b.quantity <= 0:
            raise HTTPException(status_code=422, detail=f"'{name}', heat {heat}: quantity must be greater than zero.")
        if item.expiry_controlled and not b.expiry_date and not (b.mfg_date and item.shelf_life_days):
            raise HTTPException(status_code=422, detail=f"'{name}' is expiry-controlled — enter heat {heat}'s expiry date "
                                                        "(or its manufacturing date, with a shelf life set on the item).")
        if b.mfg_date and b.mfg_date > date.today():
            raise HTTPException(status_code=422, detail=f"'{name}', heat {heat}: manufacturing date {b.mfg_date:%d-%m-%Y} is in the future.")
        total += b.quantity
    if abs(total - received_qty) > 1e-6:
        raise HTTPException(status_code=422, detail=f"'{name}': the batch quantities add up to {total:g} but {received_qty:g} was received — "
                                                    "the heats must account for exactly the received quantity.")


def create_grn_batches(db: Session, *, grn, line, item: StoreItem, vendor_id: int | None, vendor_name: str | None,
                       batches: list, user_id: int | None) -> list[StoreBatch]:
    rows = []
    for b in batches:
        expiry = b.expiry_date or (b.mfg_date + timedelta(days=item.shelf_life_days) if b.mfg_date and item.shelf_life_days else None)
        row = StoreBatch(
            item_id=item.id, batch_number=generate_batch_number(db), heat_number=b.heat_number.strip(),
            vendor_id=vendor_id, vendor_name=vendor_name, grn_id=grn.id, grn_item_id=line.id, location_id=grn.store_location_id,
            received_qty=b.quantity, received_date=grn.received_date, mfg_date=b.mfg_date, expiry_date=expiry,
            tc_number=(b.tc_number or "").strip() or None, remarks=(b.remarks or "").strip() or None,
            status="active", created_by_id=user_id,
        )
        db.add(row)
        db.flush()  # the next number sees this one
        rows.append(row)
    return rows


def line_batches(db: Session, grn_item_id: int) -> list[StoreBatch]:
    return db.query(StoreBatch).filter(StoreBatch.grn_item_id == grn_item_id).order_by(StoreBatch.id).all()


def grn_line_splits(db: Session, line, qty: float) -> list[tuple[str | None, float]]:
    """How a GRN line's accepted quantity is posted: one row per heat for a
    batch-managed line (each heat's accepted quantity), else one row."""
    rows = line_batches(db, line.id) if getattr(line, "id", None) else []
    if not rows:
        return [(None, qty)]
    if len(rows) == 1:
        return [(rows[0].batch_number, qty)]
    out = []
    for r in rows:
        q = r.accepted_qty if r.accepted_qty is not None else r.received_qty
        if q > _EPS:
            out.append((r.batch_number, q))
    posted = sum(q for _, q in out)
    if abs(posted - qty) > 1e-6:
        # Line accepted fully/partly without a per-heat split — refuse rather than guess which heat.
        raise ValueError(f"'{line.item_name}' was received in {len(rows)} heats; say how much of each heat was accepted "
                         f"({posted:g} split vs {qty:g} accepted) when inspecting the GRN.")
    return out


def apply_line_inspection(db: Session, line, entries: list | None) -> None:
    """GRN store inspection of a batch-managed line. One heat, or the whole line
    passed / failed: follows the line. Partly accepted with several heats:
    entries [{batch_id, accepted_quantity}] say which heats passed."""
    rows = line_batches(db, line.id)
    if not rows:
        if entries:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' has no batches on this GRN, so it can't take a per-batch split.")
        return
    accepted = line.accepted_quantity or 0
    if len(rows) == 1 or not entries:
        if len(rows) > 1 and accepted > _EPS and abs(accepted - line.received_quantity) > 1e-6:
            raise HTTPException(status_code=422, detail=(
                f"'{line.item_name}' came in {len(rows)} heats ({', '.join(r.heat_number or r.batch_number for r in rows)}) and is only "
                f"partly accepted — enter the accepted quantity per heat."))
        for r in rows:
            r.accepted_qty = r.received_qty if accepted > _EPS else 0.0
            if len(rows) == 1:
                r.accepted_qty = accepted
        db.flush()
        return
    by_id = {r.id: r for r in rows}
    given: dict[int, float] = {}
    for e in entries:
        r = by_id.get(e.batch_id)
        if r is None:
            raise HTTPException(status_code=422, detail=f"Batch #{e.batch_id} doesn't belong to '{line.item_name}' on this GRN — reload the page.")
        if e.accepted_quantity < 0 or e.accepted_quantity - r.received_qty > 1e-6:
            raise HTTPException(status_code=422, detail=f"Heat {r.heat_number}: accepted {e.accepted_quantity:g} must be between 0 and the {r.received_qty:g} received.")
        given[r.id] = e.accepted_quantity
    if set(given) != set(by_id):
        missing = [r.heat_number or r.batch_number for r in rows if r.id not in given]
        raise HTTPException(status_code=422, detail=f"'{line.item_name}': give the accepted quantity for every heat — missing {', '.join(missing)}.")
    if abs(sum(given.values()) - accepted) > 1e-6:
        raise HTTPException(status_code=422, detail=f"'{line.item_name}': the heats' accepted quantities add up to {sum(given.values()):g}, "
                                                    f"but the line's accepted quantity is {accepted:g}.")
    for rid, q in given.items():
        by_id[rid].accepted_qty = q
    db.flush()


def batches_for_lines(db: Session, line_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    if not line_ids:
        return out
    for b in db.query(StoreBatch).filter(StoreBatch.grn_item_id.in_(line_ids)).order_by(StoreBatch.id).all():
        out[b.grn_item_id].append({
            "id": b.id, "batch_number": b.batch_number, "heat_number": b.heat_number, "received_qty": b.received_qty,
            "accepted_qty": b.accepted_qty, "tc_number": b.tc_number, "has_tc_document": bool(b.tc_file_path),
            "mfg_date": b.mfg_date, "expiry_date": b.expiry_date,
        })
    return out


# ---------------------------------------------------------------------------
# Stock by batch (from the ledger)
# ---------------------------------------------------------------------------

def batch_stock(db: Session, *, item_id: int | None = None, location_id: int | None = None,
                batch_numbers: list[str] | None = None, location_ids: set[int] | None = None) -> dict[tuple[int, str, int], dict[str, float]]:
    """{(item_id, batch_number, location_id): {free, quality, blocked, vendor}}
    from the ledger rows that carry a batch number."""
    q = db.query(StoreStockTransaction.item_id, StoreStockTransaction.batch_number, StoreStockTransaction.location_id,
                 StoreStockTransaction.transaction_type, func.sum(StoreStockTransaction.quantity)).filter(
        StoreStockTransaction.batch_number.isnot(None))
    if item_id is not None:
        q = q.filter(StoreStockTransaction.item_id == item_id)
    if location_id is not None:
        q = q.filter(StoreStockTransaction.location_id == location_id)
    if location_ids is not None:
        q = q.filter(StoreStockTransaction.location_id.in_(list(location_ids) or [-1]))
    if batch_numbers is not None:
        q = q.filter(StoreStockTransaction.batch_number.in_(batch_numbers or ["\x00"]))
    out: dict[tuple[int, str, int], dict[str, float]] = {}
    for iid, bno, lid, ttype, qty in q.group_by(StoreStockTransaction.item_id, StoreStockTransaction.batch_number,
                                                StoreStockTransaction.location_id, StoreStockTransaction.transaction_type).all():
        frm, to = STORE_STOCK_TYPE_EFFECT.get(ttype, (None, None))
        b = out.setdefault((iid, bno, lid), {k: 0.0 for k in BUCKETS})
        if frm:
            b[frm] -= float(qty or 0)
        if to:
            b[to] += float(qty or 0)
    for b in out.values():
        for k in BUCKETS:
            b[k] = round(b[k], 4)
    return out


def _pick_order(item: StoreItem, rows: list[StoreBatch]) -> list[StoreBatch]:
    if item.expiry_controlled:  # FEFO
        return sorted(rows, key=lambda r: (r.expiry_date or date.max, r.received_date or date.max, r.id))
    return sorted(rows, key=lambda r: (r.received_date or date.max, r.id))  # FIFO


def available_batches(db: Session, item: StoreItem, location_id: int) -> list[dict]:
    """Batches of the item with Free stock at the store, in pick order
    (FEFO for expiry-controlled items, else FIFO by receipt). Blocked and
    expired batches are listed but marked not issuable."""
    stock = batch_stock(db, item_id=item.id, location_id=location_id)
    numbers = [bno for (_, bno, _), b in stock.items() if b["free"] > _EPS]
    rows = db.query(StoreBatch).filter(StoreBatch.item_id == item.id, StoreBatch.batch_number.in_(numbers or ["\x00"])).all()
    known = {r.batch_number for r in rows}
    today = date.today()
    out = []
    for r in _pick_order(item, rows):
        free = stock[(item.id, r.batch_number, location_id)]["free"]
        blocked = r.status == "blocked"
        expired = bool(r.expiry_date and r.expiry_date < today)
        out.append({"batch_id": r.id, "batch_number": r.batch_number, "heat_number": r.heat_number, "vendor_name": r.vendor_name,
                    "received_date": r.received_date, "expiry_date": r.expiry_date, "free_qty": free, "tc_number": r.tc_number,
                    "issuable": not blocked and not expired,
                    "reason": "Batch blocked" if blocked else ("Expired" if expired else None)})
    # Legacy free-text batch numbers on old ledger rows (no batch master row).
    for bno in sorted(set(numbers) - known):
        out.append({"batch_id": None, "batch_number": bno, "heat_number": None, "vendor_name": None, "received_date": None,
                    "expiry_date": None, "free_qty": stock[(item.id, bno, location_id)]["free"], "tc_number": None,
                    "issuable": True, "reason": None})
    return out


def allocate_issue(db: Session, item: StoreItem, location_id: int, qty: float, batch_number: str | None,
                   taken: dict[str, float] | None = None) -> list[tuple[str | None, float]]:
    """Batch determination for an issue line. Not batch-managed → as given.
    A batch picked → checked (exists, not blocked / expired, enough Free stock
    of that batch here). None picked → FIFO / FEFO over the issuable batches."""
    if not is_batch_managed(item):
        return [(batch_number or None, qty)]
    loc_name = db.query(StoreLocation.name).filter(StoreLocation.id == location_id).scalar() or f"store {location_id}"
    cands = available_batches(db, item, location_id)
    # Earlier lines of the same document already took some of these batches.
    taken = taken if taken is not None else {}
    for c in cands:
        c["free_qty"] = max(0.0, c["free_qty"] - taken.get(c["batch_number"], 0.0))
    if batch_number:
        c = next((c for c in cands if c["batch_number"] == batch_number), None)
        if c is None:
            raise HTTPException(status_code=409, detail=f"Batch {batch_number} of '{item.item_name}' has no Free stock in {loc_name} — "
                                                        "pick another batch (the list shows what is in stock).")
        if not c["issuable"]:
            raise HTTPException(status_code=409, detail=f"Batch {batch_number} of '{item.item_name}' can't be issued: {c['reason'].lower()}. "
                                                        "Pick another batch, or ask Quality / Store to release it.")
        if qty - c["free_qty"] > 1e-6:
            raise HTTPException(status_code=409, detail=f"Batch {batch_number} of '{item.item_name}' has only {c['free_qty']:g} Free in "
                                                        f"{loc_name}, {qty:g} requested — split the line over another batch.")
        taken[batch_number] = taken.get(batch_number, 0.0) + qty
        return [(batch_number, qty)]
    out, left = [], qty
    for c in cands:
        if left <= _EPS:
            break
        if not c["issuable"] or c["free_qty"] <= _EPS:
            continue
        take = min(left, c["free_qty"])
        out.append((c["batch_number"], take))
        taken[c["batch_number"]] = taken.get(c["batch_number"], 0.0) + take
        left -= take
    if left > 1e-6:
        have = qty - left
        raise HTTPException(status_code=409, detail=f"Not enough batch stock of '{item.item_name}' in {loc_name}: {have:g} Free in issuable "
                                                    f"batches, {qty:g} requested. Stock without a batch number can't be issued for a batch-tracked item.")
    return out


# ---------------------------------------------------------------------------
# Trace
# ---------------------------------------------------------------------------

def batch_dict(db: Session, b: StoreBatch, stock: dict | None = None) -> dict:
    item = db.get(StoreItem, b.item_id)
    if stock is None:
        stock = batch_stock(db, item_id=b.item_id, batch_numbers=[b.batch_number])
    locs = {l.id: l.name for l in db.query(StoreLocation).all()}
    per_store = [{"location_id": lid, "location_name": locs.get(lid), **v}
                 for (iid, bno, lid), v in stock.items() if iid == b.item_id and bno == b.batch_number and any(abs(x) > _EPS for x in v.values())]
    grn_number = None
    if b.grn_id:
        from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
        grn_number = db.query(P2PGoodsReceipt.grn_number).filter(P2PGoodsReceipt.id == b.grn_id).scalar()
    return {
        "id": b.id, "item_id": b.item_id, "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
        "uom": item.uom if item else None, "batch_number": b.batch_number, "heat_number": b.heat_number,
        "vendor_id": b.vendor_id, "vendor_name": b.vendor_name, "grn_id": b.grn_id, "grn_number": grn_number,
        "received_qty": b.received_qty, "accepted_qty": b.accepted_qty, "received_date": b.received_date,
        "mfg_date": b.mfg_date, "expiry_date": b.expiry_date, "tc_number": b.tc_number, "tc_file_name": b.tc_file_name,
        "has_tc_document": bool(b.tc_file_path), "status": b.status, "remarks": b.remarks,
        "stock": per_store,
        "total": {k: round(sum(s[k] for s in per_store), 4) for k in BUCKETS},
    }


def trace(db: Session, b: StoreBatch) -> dict:
    """Batch → GRN / vendor / TC → every movement → issues (work order,
    project / machine, job-work vendor) → inspection lots / NCRs."""
    from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
    from app.modules.quality.models.inspection_lot import QualityInspectionLot
    from app.modules.quality.models.ncr import QualityNcr
    out = batch_dict(db, b)
    locs = {l.id: l.name for l in db.query(StoreLocation).all()}
    txns = db.query(StoreStockTransaction).filter(StoreStockTransaction.item_id == b.item_id,
                                                  StoreStockTransaction.batch_number == b.batch_number).order_by(StoreStockTransaction.id).all()
    out["movements"] = [{"id": t.id, "date": t.transaction_date, "transaction_type": t.transaction_type, "quantity": t.quantity,
                         "location_name": locs.get(t.location_id), "reference_type": t.reference_type,
                         "reference_number": t.reference_number, "vendor_name": t.vendor_name, "remarks": t.remarks} for t in txns]
    issue_rows = db.query(StoreMaterialIssueItem, StoreMaterialIssue).join(StoreMaterialIssue, StoreMaterialIssueItem.issue_id == StoreMaterialIssue.id).filter(
        StoreMaterialIssueItem.item_id == b.item_id, StoreMaterialIssueItem.batch_number == b.batch_number).order_by(StoreMaterialIssue.id).all()
    projects = {}
    pids = {i.erp_project_id for _, i in issue_rows if i.erp_project_id}
    if pids:
        from app.modules.erp.models.project import Project
        projects = {p.id: " — ".join(x for x in (p.serial_number, p.model_name, p.client_company) if x)
                    for p in db.query(Project).filter(Project.id.in_(pids)).all()}
    out["issues"] = [{"issue_id": i.id, "issue_number": i.issue_number, "issue_date": i.issue_date, "issue_type": i.issue_type,
                      "quantity": line.quantity, "work_order": i.project_or_work_order, "project": projects.get(i.erp_project_id),
                      "vendor_name": i.vendor_name, "challan_number": i.challan_number, "location_name": locs.get(i.location_id)}
                     for line, i in issue_rows]
    lots = db.query(QualityInspectionLot).filter(QualityInspectionLot.item_id == b.item_id,
                                                 QualityInspectionLot.batch_number == b.batch_number).order_by(QualityInspectionLot.id).all()
    out["inspection_lots"] = [{"id": l.id, "lot_number": l.lot_number, "status": l.status, "decision": l.decision,
                               "quantity": l.quantity, "accepted_qty": l.accepted_qty, "rejected_qty": l.rejected_qty} for l in lots]
    ncrs = db.query(QualityNcr).filter(QualityNcr.is_deleted == False, QualityNcr.batch_number == b.batch_number).all()  # noqa: E712
    out["ncrs"] = [{"id": n.id, "ncr_number": n.ncr_number, "status": n.status} for n in ncrs]
    return out
