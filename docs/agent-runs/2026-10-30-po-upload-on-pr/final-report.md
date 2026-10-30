# Final report: Upload PO on the requisition (2026-10-30)

Status: built and reviewed, NOT committed, NOT pushed.

## Review findings and fixes
| Sev | Finding (agent) | Fix |
|---|---|---|
| Critical | upload-po read PO lines before flush (autoflush off) → every upload 422 (reviewer) | `build_po_draft` flushes before returning |
| High | PR row lock held across SharePoint await on a single event loop → server freeze (security) | PDF uploaded first; then `FOR UPDATE NOWAIT` (409), sync build/submit/commit; file deleted on failure |
| High | Before-PO requisition's RFQ hidden by `list_rfqs` → no Upload button (reviewer) | `source='before_po'` only hidden from the unfiltered list |
| Medium | Client `vendor_id` could differ from the quoted vendor (security) | 422 when the RFQ has quotes; `build_po_draft` always takes the quote's vendor id |
| Medium | Re-upload overwrote the file an older history entry opens (security) | Time-prefixed file name per upload |
| Medium | Department PR without cost centre dead-ended (reviewer) | Cost-centre field in the dialog |
| Low | History PDF readable without PO-commercials right (security) | `_can_see_po_commercials` check |

## Open (accepted as follow-up)
- Tally number uniqueness is check-then-insert (needs a partial unique index, a migration).
- SharePoint errors still show Graph's raw text (existing utils/sharepoint.py).
- One Tally PO per requisition; line awards don't carry quote ids to the PO.
- Store can cancel a Before-PO receipt that already has a requisition.
- Unused schemas `POSplitPayload`, `P2PRequestCreatePOPayload` left in place.

## Checks
- pytest: 188 passed, 2 xfailed (existing) on 14 P2P files + 70 dependents, run in a snapshot copy, because `app.main` doesn't import in the real tree (another session's Sales removal in progress).
- tsc: clean for this change. test:ui: 0 errors in this change (2 in Projects files of another session). ruff F821 py312: clean. No migration.
- Not seen live in the browser.
