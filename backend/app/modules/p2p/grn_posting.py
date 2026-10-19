"""GRN stock postings (SAP MIGO 101 into Quality stock, then 321 / 350).

Every stock line of a GRN is in the stock ledger from the moment the GRN is
recorded — never only after someone inspects it:

  * Item flagged inspection-on-receipt → a Quality inspection lot takes it
    into QUALITY stock (quality/services/lots.py), receipt_posting = "lot".
  * Any other stock line → received straight into QUALITY stock here
    (receipt_posting = "quality"); the GRN inspection then releases the
    accepted quantity to FREE stock and moves the rejected quantity to
    BLOCKED stock, where it stays until it goes back to the vendor (RTV).
  * Service / asset lines (PO item category) never touch store stock
    (receipt_posting = "none"): a service is confirmed on a service entry, an
    asset is capitalised by Finance.

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
