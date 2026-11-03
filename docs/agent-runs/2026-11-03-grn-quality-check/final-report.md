# Final report — GRN quality-check flag (2026-11-03)

## Outcome
- Item Master flag renamed to **"Quality check on receipt"**; Store screens / tab / tours say "Quality check" instead of "Inspection". Quality module document names unchanged.
- GRN of an item **without** the flag: received quantity goes straight into Free stock (stock type `receipt`, PO/landed rate), line accepted, GRN **Completed on save**, PO/PR receipt status rolls up at once. Audit row `grn_completed_on_receipt`.
- Item **with** the flag: unchanged (Quality lot, Quality stock, GRN waits for the lot decision). Asset lines unchanged (accept/reject on the GRN).
- Old GRNs recorded before this change (lines in Quality stock, `receipt_posting = quality`) still complete through the GRN check — the legacy path is kept.
- Every change of the quality flags on an item is audited.
- Bonus from the same session: Items list sorted in numeric series order (01 … 10, 11 … 100).

## Checks
- pytest: 14 GRN-related files, 191 passed, 0 failed; regression files 105 passed.
- ruff F821 py312: clean. alembic heads: one (no migration in this change). tsc: 0 errors. test:ui: 0 errors.
- Security: no Critical/High. Medium 2 partly addressed (see findings.md).
- Live screens: not seen (no Playwright here) — owner to check Store › GRN list, a GRN detail, Items list, an item's Quality section.

## Release status
Not committed, not pushed. Six files also carry other sessions' uncommitted hunks (items.py, features/store.py, permission_registry.py, grn/page.tsx, grn/new/page.tsx, ItemErpSections.tsx) — staging them commits those hunks too.
