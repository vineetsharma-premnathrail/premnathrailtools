# Final report - Procurement approval controls + buyer responsibility (2026-11-06)

Status: built and tested locally, NOT committed, NOT pushed. No migration.

## Done
- PR approval gets an estimated value (last released PO rate -> moving average -> standard cost) + "Some lines have no price" flag.
- PO approval conditions: quantity above requisition, vendor not L1 (award check), single / limited quotation (eligible quotes per PO line; PO without RFQ = single). Flags also in PO title and PO amendment context.
- Requester's department condition = pick-list of Organization departments (dynamic choices in the engine; old text conditions auto-converted by name).
- Old pre-workflow approval decision code removed; old-route items move into the workflow only when opened by someone who could approve, never as the clicking user, never decided by the move.
- Buyer responsibility (Procurement > Settings): one buyer owns many Item Master categories; line buyer = category -> item type -> Default buyer. SR / Maintenance PR lines use it. Hard-coded buyer emails and "Buyer by category" removed. HR exit warns when a leaver owns categories.
- Approval emails show department names.

## Checks
- 300 passed, 2 xfailed (16 affected suites); earlier broad run 541 passed, 1 unrelated flaky GRN test (passes alone; another session edits GRN files).
- tsc 0 errors; test:ui 0 errors; ruff F821 py312 clean; changed modules import under Python 3.11.
- Security + reviewer: no Critical/High; Medium/Low findings fixed (see agent reports in chat).

## Not done / open
- Not seen live in a browser (Settings card, Workflows department pick-list).
- api.ts/types still to receive the buyer-responsibility helpers (card uses a local helper).
- After deploy: set Procurement > Settings > Default buyer and assign categories, else lines with no category/type buyer get no buyer.
