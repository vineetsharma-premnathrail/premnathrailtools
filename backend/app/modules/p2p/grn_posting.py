"""GRN stock postings (SAP MIGO 101 into Quality stock, then 321 / 350).

Every stock line of a GRN is in the stock ledger from the moment the GRN is
recorded — never only after someone inspects it:

  * Item flagged "Quality check on receipt" → a Quality inspection lot takes
    it into QUALITY stock (quality/services/lots.py), receipt_posting = "lot".
  * Any other stock line → received straight into FREE stock here
    (receipt_posting = "free", 2026-11-03): the line counts as accepted the
    moment the GRN is saved, no second "complete quality check" click.
  * receipt_posting = "quality" is the pre-2026-11-03 path (into QUALITY
    stock, then the GRN check releases / blocks): kept so those GRNs can
    still be completed, returned and reversed.
  * Service / asset lines (PO item category) never touch store stock
    (receipt_posting = "none"): a service is confirmed on a service entry, an
    asset is capitalised by Finance.

  * The part of a line that a Before-PO receipt already put into stock is
    settled, not posted (line.pre_po_qty, settle_line below, 2026-11-06).

All postings are at the PO line's rate and per heat for batch-managed lines."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.modules.store.services.stock_ledger import post_stock_transaction

_EPS = 1e-9


def _po_rate(line) -> float | None:
    # PO rate (excl. GST) + planned delivery costs per unit (p2p/landed_cost.py).
    from app.modules.p2p.landed_cost import landed_rate
    return landed_rate(line.po_item)


def _heats(db: Session, line):
    from app.modules.store.services.batches import line_batches
    return line_batches(db, line.id) if getattr(line, "id", None) else []


def _post(db: Session, grn, line, ttype: str, qty: float, batch_number: str | None, user_id: int, remarks: str,
          transaction_date=None, reference_type: str = "grn", reference_number: str | None = None) -> None:
    rate = _po_rate(line)
    # WM: the putaway bin. Moves inside the store (release / block) don't
    # change the bin; stock leaving the store comes out of the putaway bin
    # while it still holds it (services/bins.py).
    bin_id = getattr(line, "bin_id", None)
    if bin_id is not None and ttype in ("quarantine_out", "return_out"):
        from app.modules.store.services.bins import bin_if_covered
        bin_id = bin_if_covered(db, line.store_item_id, grn.store_location_id, bin_id, qty)
    post_stock_transaction(
        db, item_id=line.store_item_id, location_id=grn.store_location_id, transaction_type=ttype, quantity=qty, bin_id=bin_id,
        batch_number=batch_number, reference_type=reference_type, reference_number=reference_number or grn.grn_number,
        transaction_date=transaction_date or grn.received_date, remarks=remarks, created_by_id=user_id,
        vendor_name=grn.purchase_order.vendor_name if grn.purchase_order else None,
        unit_cost=rate, cost_source=(None if not rate else "landed" if line.po_item is not None and line.po_item.unit_price
                                     and rate != float(line.po_item.unit_price) else "po_rate"),
    )


def receive_into_quality(db: Session, grn, line, user_id: int) -> None:
    """101 into Quality stock: the full received quantity, per heat."""
    heats = _heats(db, line)
    splits = [(h.batch_number, h.received_qty) for h in heats] if heats else [(None, line.received_quantity)]
    for batch_no, qty in splits:
        if qty > _EPS:
            _post(db, grn, line, "quality_in", qty, batch_no, user_id,
                  f"GRN {grn.grn_number} received — in Quality stock until the GRN inspection")
    line.receipt_posting = "quality"


def receive_into_free(db: Session, grn, line, user_id: int, settled: float = 0.0) -> None:
    """Item without the Quality-check flag: the full received quantity goes
    straight into Free stock (per heat) and the line is accepted as received.
    `settled`: the part a Before-PO receipt already put into stock (settle_line) -
    only the rest is posted; with nothing left, no stock movement at all."""
    heats = _heats(db, line)
    splits = [(h.batch_number, h.received_qty) for h in heats] if heats else [(None, line.received_quantity - (settled or 0.0))]
    for batch_no, qty in splits:
        if qty > _EPS:
            _post(db, grn, line, "receipt", qty, batch_no, user_id,
                  f"GRN {grn.grn_number} received — no quality check needed for this item, straight to Free stock")
    for h in heats:
        h.accepted_qty = h.received_qty
    line.accepted_quantity = line.received_quantity
    line.rejected_quantity = 0.0
    line.quality_status = "passed"
    line.receipt_posting = "free"


def _rejected_splits(db: Session, line, rejected: float) -> list[tuple[str | None, float]]:
    heats = _heats(db, line)
    if not heats:
        return [(None, rejected)]
    if len(heats) == 1:
        return [(heats[0].batch_number, rejected)]
    out = []
    for h in heats:
        acc = h.accepted_qty if h.accepted_qty is not None else h.received_qty
        q = (h.received_qty or 0) - (acc or 0)
        if q > _EPS:
            out.append((h.batch_number, q))
    return out or [(None, rejected)]


def post_quality_inspection(db: Session, grn, line, user_id: int) -> None:
    """GRN inspection of a line received into Quality stock: accepted →
    Free (321), rejected → Blocked (350)."""
    from app.modules.store.services.batches import grn_line_splits

    accepted, rejected = line.accepted_quantity or 0, line.rejected_quantity or 0
    if accepted > _EPS:
        for batch_no, qty in grn_line_splits(db, line, accepted):
            _post(db, grn, line, "quality_release", qty, batch_no, user_id, f"GRN {grn.grn_number} inspection — accepted to Free stock",
                  transaction_date=date.today())
    if rejected > _EPS:
        for batch_no, qty in _rejected_splits(db, line, rejected):
            _post(db, grn, line, "quality_block", qty, batch_no, user_id,
                  f"GRN {grn.grn_number} inspection — rejected to Blocked stock until it goes back to the vendor",
                  transaction_date=date.today())


def return_rejected_to_vendor(db: Session, grn, line, qty: float, user_id: int, rtv_number: str, return_date, remarks: str) -> None:
    """Rejected goods of a Quality-stock line leave Blocked stock (SAP 122
    from blocked) when they go back to the vendor."""
    heats = _heats(db, line)
    batch_no = heats[0].batch_number if len(heats) == 1 else None
    _post(db, grn, line, "quarantine_out", qty, batch_no, user_id, remarks, transaction_date=return_date,
          reference_type="vendor_return", reference_number=rtv_number)


def reverse_quality_line(db: Session, grn, line, user_id: int, today, reason: str) -> None:
    """102 for a line received into Quality stock: take back out whatever of
    it is still in Quality (not yet inspected) or Blocked (rejected, not yet
    returned). The accepted part leaves Free stock in the caller."""
    remarks = f"GRN {grn.grn_number} reversed — {reason}"
    heats = _heats(db, line)
    one_batch = heats[0].batch_number if len(heats) == 1 else None
    if line.quality_status == "pending":
        splits = [(h.batch_number, h.received_qty) for h in heats] if heats else [(None, line.received_quantity)]
        for batch_no, qty in splits:
            if qty > _EPS:
                # Quality → Blocked → out: there is no direct "out of Quality" movement.
                _post(db, grn, line, "quality_block", qty, batch_no, user_id, remarks, transaction_date=today, reference_type="grn_reversal")
                _post(db, grn, line, "quarantine_out", qty, batch_no, user_id, remarks, transaction_date=today, reference_type="grn_reversal")
        return
    rejected_left = (line.rejected_quantity or 0) - (line.rejected_returned_quantity or 0)
    if rejected_left > _EPS:
        _post(db, grn, line, "quarantine_out", rejected_left, one_batch, user_id, remarks, transaction_date=today, reference_type="grn_reversal")


# ----------------------------------------------------- Before-PO settlement (2026-11-06)
#
# A Before-PO receipt (BPO) that already put goods into stock (stock_posted) is SETTLED by the GRN
# on the PO made from it: the settled part of a GRN line moves no stock and opens no inspection
# lot (line.pre_po_qty); only what is above the BPO quantity posts as usual. When the PO rate
# differs from the rate the BPO stock went in at, the stock VALUE is corrected by a value-only
# revaluation (same mechanism as p2p/landed_cost.py: units already issued keep the old value).

_SETTLE_REF = "grn_settlement"            # revaluation event: value moved on the stock on hand
_SETTLE_UNVALUED_REF = "grn_settlement_unvalued"  # BPO stock had no value at all; now valued at the PO rate
_SETTLE_UNDO_REF = "grn_settlement_reversed"


def settle_line(db: Session, grn, line, receipt, qty: float, user_id: int) -> None:
    """Marks `qty` of a GRN line as settled by the receipt's stock: line.pre_po_qty, the receipt line's
    settled_qty, and the value-only revaluation to the PO rate. Moves no stock."""
    from app.modules.p2p.pre_po import posted_unit_cost

    bpo_line = next((l for l in receipt.items if l.store_item_id == line.store_item_id), None)
    if bpo_line is None or qty <= _EPS:
        return
    line.pre_po_qty = (line.pre_po_qty or 0.0) + qty
    bpo_line.settled_qty = (bpo_line.settled_qty or 0.0) + qty
    po_rate = _po_rate(line)
    if po_rate:
        _revalue(db, grn, line, qty, po_rate, posted_unit_cost(db, receipt, bpo_line), user_id)
    # Bought for a project: the settled stock is held for it, like a plain receipt's stock (no ledger hook runs here).
    from app.modules.store.services import project_stock
    try:
        project_stock.hold_settled_for_project(db, line, qty, location_id=grn.store_location_id, user_id=user_id, grn_no=grn.grn_number)
    except ValueError as e:
        raise ValueError(f"the {qty:g} already in stock via {receipt.receipt_number} can't be held for the project this line is bought for: {e} "
                         "Part of it has probably been issued or reserved already - return it to store first, or receive a smaller quantity.") from e
    note = f"{qty:g} already in stock via {receipt.receipt_number} - settled, not added again"
    line.remarks = f"{line.remarks}; {note}" if line.remarks else note


def settle_fully_received(line) -> None:
    """Every received unit of the line was settled: it is accepted and in Free stock already."""
    line.accepted_quantity = line.received_quantity
    line.rejected_quantity = 0.0
    line.quality_status = "passed"
    line.receipt_posting = "free"


def _revalue(db: Session, grn, line, qty: float, po_rate: float, bpo_rate: float | None, user_id: int) -> None:
    from app.modules.store.models.valuation import StoreValuationEvent
    from app.modules.store.services import valuation

    if not valuation.valuation_enabled(db):
        return
    val = valuation.lock_valuation(db, line.store_item_id)
    unvalued = float(val.unvalued_qty or 0)
    on_hand_valued = max(float(val.qty or 0) - unvalued, 0.0)
    before = float(val.avg_rate) if val.avg_rate is not None else None
    if bpo_rate is None:
        # The receipt's units went in with no value: they take the PO rate now.
        moved = min(unvalued, qty)
        delta, ref_type, basis = round(moved * po_rate, 2), _SETTLE_UNVALUED_REF, moved
        val.unvalued_qty = round(unvalued - moved, 4)
        valued_after = on_hand_valued + moved
        if moved <= _EPS:
            return
    else:
        # Only the part still on hand can be re-valued - what was issued already left at the old value.
        frac = min(1.0, on_hand_valued / qty) if qty > _EPS else 0.0
        delta, ref_type, basis = round((po_rate - bpo_rate) * qty * frac, 2), _SETTLE_REF, qty * frac
        valued_after = on_hand_valued
        if abs(delta) < 0.005:
            return
    val.value = round(max(float(val.value or 0) + delta, 0.0), 2)
    after = round(val.value / valued_after, 4) if valued_after > _EPS else before
    val.avg_rate = after
    db.add(StoreValuationEvent(
        item_id=line.store_item_id, event_type="revaluation", value_delta=delta, qty_basis=basis, rate_before=before, rate_after=after,
        reference_type=ref_type, reference_number=grn.grn_number, created_by_id=user_id, event_date=date.today(),
        reason=(f"GRN {grn.grn_number} settled {qty:g} already in stock from a Before-PO receipt: valued at the PO rate "
                f"{po_rate:g} instead of "
                + (f"{bpo_rate:g}." if bpo_rate is not None else "no rate."))))
    if after is not None:
        valuation.mirror_average(db, line.store_item_id, after)


def release_settlement(db: Session, grn, receipt, lines, user_id: int) -> None:
    """GRN reversal: the settled part of each line stays in stock (it came in with the Before-PO receipt),
    the receipt's settled_qty goes back down so a later GRN can settle it, and the value-only
    revaluations this GRN made are undone."""
    from app.modules.store.models.valuation import StoreValuationEvent
    from app.modules.store.services import project_stock, valuation

    for line in lines:
        if (line.pre_po_qty or 0) <= _EPS:
            continue
        # The project hold this GRN made for the settled part (no stock goes out, so no ledger hook frees it).
        project_stock.release_line_holds(db, line.id, grn.grn_number)
        if receipt is not None:
            bpo_line = next((l for l in receipt.items if l.store_item_id == line.store_item_id), None)
            if bpo_line is not None:
                bpo_line.settled_qty = max(0.0, (bpo_line.settled_qty or 0.0) - line.pre_po_qty)
    if not valuation.valuation_enabled(db):
        return
    item_ids = sorted({l.store_item_id for l in lines if (l.pre_po_qty or 0) > _EPS and l.store_item_id})
    for item_id in item_ids:  # global lock order: by item
        events = (db.query(StoreValuationEvent)
                  .filter(StoreValuationEvent.item_id == item_id, StoreValuationEvent.reference_number == grn.grn_number,
                          StoreValuationEvent.reference_type.in_((_SETTLE_REF, _SETTLE_UNVALUED_REF))).all())
        if not events:
            continue
        val = valuation.lock_valuation(db, item_id)
        before = float(val.avg_rate) if val.avg_rate is not None else None
        for ev in events:
            if ev.reference_type == _SETTLE_UNVALUED_REF:
                val.unvalued_qty = round(float(val.unvalued_qty or 0) + float(ev.qty_basis or 0), 4)
        total = sum(float(ev.value_delta or 0) for ev in events)
        val.value = round(max(float(val.value or 0) - total, 0.0), 2)
        valued = max(float(val.qty or 0) - float(val.unvalued_qty or 0), 0.0)
        after = round(val.value / valued, 4) if valued > _EPS else before
        val.avg_rate = after
        db.add(StoreValuationEvent(
            item_id=item_id, event_type="revaluation", value_delta=-total, qty_basis=valued, rate_before=before, rate_after=after,
            reference_type=_SETTLE_UNDO_REF, reference_number=grn.grn_number, created_by_id=user_id, event_date=date.today(),
            reason=f"GRN {grn.grn_number} was reversed, so the PO-rate revaluation of the stock it settled is undone."))
        if after is not None:
            valuation.mirror_average(db, item_id, after)
