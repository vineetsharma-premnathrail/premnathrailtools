# Spec — GRN posting by Quality-check flag

## Scope
- Backend: `p2p/grn_posting.py` (new `receive_into_free`), `p2p/routes/goods_receipts.py` (create: direct posting + auto-complete; stock sync skips "free" lines), `p2p/models/goods_receipt.py` (comment), `store/routes/items.py` (message), `core/features/store.py`, `core/events/store.py`, `core/permission_registry.py` (tab label), tests.
- Frontend: Item Master quality section + detail row, GRN list / new / detail wording, StoreNav label, Store tour configs, Quality › My inspections note.

## Out of scope
- Quality module document names (Inspection Plan / Lot / Final inspection).
- Vendor-wise skip of quality check. Asset lines (still accepted/rejected on the GRN, capitalised by Finance).

## Flow
GRN recorded →
- asset line: receipt_posting "none", stays pending → accept/reject on GRN (unchanged).
- item flagged Quality check: lot, Quality stock, `in_quality` (unchanged).
- other stock line: `receipt` into Free stock per heat at PO/landed rate; accepted = received, rejected = 0, quality_status `passed`, receipt_posting `free`; serial units → in_stock; batch heats accepted = received.
→ if no line is `pending` / `in_quality`: GRN `completed`, inspected_by = receiver, PO/PR rollup, requester notified. Otherwise draft; completes later as today.

## Acceptance criteria
1. Given an item without the flag, when a GRN is recorded, then the item's Free stock rises by the received qty at once and the GRN status is Completed; no "Complete quality check" button is shown.
2. Given an item with the flag, when a GRN is recorded, then an incoming lot exists, stock is in Quality, and the GRN stays Pending quality check until the lot decision.
3. Given a GRN with both kinds, stock of the unflagged line is Free immediately; the GRN completes when the lot is decided.
4. Reversing a completed direct-posted GRN takes the quantity back out of Free stock.
5. Return to Vendor on a direct-posted line works as for any accepted line.
6. No user-visible "Inspection" wording remains on Store screens / Item Master; Quality module names untouched.
7. ruff F821 py312 clean; targeted pytest green; tsc 0 errors; test:ui 0 errors.
