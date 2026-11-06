# Spec - Before-PO receipt posts stock

Replaces the 2026-10-27 rule "BPO does NOT post stock" (p2p/pre_po.py docstring).

## Data (done by Manager - migration c3b9e5a1f7d4)
- store_pre_po_receipts.stock_posted bool (False on old receipts -> old behaviour kept for them).
- store_pre_po_receipt_items: unit_rate float null, receipt_posting 'free'|'quality'|NULL, inspection_lot_id FK null, settled_qty float default 0.
- p2p_goods_receipt_items.pre_po_qty float default 0.
- quality lot source 'pre_po_receipt' added to QUALITY_LOT_SOURCES.

## Rules
R1 Create BPO: per line, in valuation.ledger_sort_key order, post stock into the receipt's store:
   - item NOT flagged inspection_on_receipt -> Free stock: post_stock_transaction type 'receipt', reference_type 'pre_po_receipt', reference_number BPO no., vendor_name, unit_cost=unit_rate (None if blank -> ledger prices at average/standard), cost_source 'pre_po_rate' when typed. receipt_posting='free'.
   - flagged -> quality.services.lots.create_lot(source_type='pre_po_receipt', source_id=receipt.id, source_reference=BPO no., receive_into_quality=True, inspection_type 'incoming' (use first_article.start_for_receipt like GRN), vendor_name, unit_cost, lot_date=received_date). receipt_posting='quality', inspection_lot_id set.
   - stock_posted=True. A posting error (period closed, count freeze, inactive store) refuses the whole receipt with the real reason (422).
   - store_location_id becomes mandatory for a new BPO (no store = no stock).
   - Batch / serial controlled items: if the item is batch_controlled or serial_controlled, refuse with a clear message ("record it with a GRN after the PO, or ask Store manager") - batch/serial capture is not on the BPO form (out of scope).
R2 Issue: nothing special - the stock is ordinary Free stock.
R3 GRN against a PO whose BPO has stock_posted=True: for each GRN line, qty up to the BPO's unsettled qty of the same store_item_id (in the same store; GRN store must equal BPO store, else 422 with reason) is SETTLED: no stock movement, no new inspection lot; line.pre_po_qty = settled part; BPO item settled_qty += part. Settled part counts as received AND accepted for that line (quality_status 'passed'; receipt_posting stays as per the excess part, or 'free' when all settled). Anything above the BPO qty posts normally.
   - Valuation (only when valuation_enabled): if the PO rate differs from the rate the BPO posted at, post a value-only revaluation of (PO rate - BPO rate) x settled qty, same mechanism as p2p/landed_cost.py (share already consumed is not re-valued on hand - follow landed_cost's existing behaviour).
R4 GRN reversal / cancel of such a line: the pre_po_qty part is NOT taken out of stock; BPO settled_qty is reduced back.
R5 Cancel BPO (only while pending_po, as today): reverse its stock. Free line: outbound posting of the qty (reference 'pre_po_receipt' + ' cancelled'); refuse with who/what when Free available < qty ("x already issued - return it to store first"). Quality line: refused while the lot has no usage decision ("Quality must decide lot L first"); after decision, take back accepted from Free and rejected from Blocked. Lot of a cancelled BPO with no decision is not cancellable from Quality (existing rule) - fine.
R6 PO cancelled/rejected -> receipt back to pending_po (existing) - stock stays.
R7 Closing: close_receipt_if_po_received unchanged.
R8 Notification text "Store received ... before a PO existed" add "already in stock".
R9 Old receipts (stock_posted False) keep exactly the old behaviour.

## API contract
- POST /api/v1/store/pre-po-receipts items[] += unit_rate?: number (>=0, finite). store_location_id required.
- PrePoReceiptResponse += stock_posted: bool; items[] += unit_rate, receipt_posting, inspection_lot_id, inspection_lot_number, settled_qty.
- GET /api/v1/p2p/goods-receipts/pending-purchase-orders items[] += pre_po_receipt_number: str|null, pre_po_unsettled_qty: number (0 when none).
- GRN response items += pre_po_qty.

## UI
- BPO form: optional "Rate (₹/unit)" per line; hint "Goods go into stock as soon as this is saved - Free stock, or Quality stock for items that need a quality check." Store required.
- BPO detail: badge "In stock" when stock_posted; line columns Rate, Stock ("Free" / "Quality - lot L-..."), Settled by GRN; cancel dialog says the stock will be taken back out.
- GRN form line: when pre_po_unsettled_qty > 0 show "X already in stock via BPO-... - receiving it here settles it, stock is not added again".
- Tour config storeBeforePo.ts wording updated.

## Acceptance
A1 New BPO with a non-QC item -> Free stock +qty immediately, issuable; ledger row reference BPO no.
A2 QC-flagged item -> Quality stock + lot (source pre_po_receipt); lot accept -> Free.
A3 Rate typed -> ledger unit_cost = rate (when valuation on).
A4 GRN on the PO made from that BPO for the same qty -> stock unchanged; line pre_po_qty = qty; BPO closes when PO fulfilled.
A5 GRN for more than BPO qty -> only the excess posts.
A6 Cancel BPO before PO: stock goes back; refused with reason when already issued / lot undecided.
A7 Old BPO (stock_posted False) -> GRN posts stock as before.
