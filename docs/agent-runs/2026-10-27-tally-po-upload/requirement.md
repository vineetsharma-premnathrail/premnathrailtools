# Tally PO upload + remove Open Items (2026-10-27)

**Asked (owner, Hindi):** "isme abhi ham Tally ke PO bhi upload kar sake, PO create me" and "remove Open Items".

**Core-flow position:** Store/Purchase — POs made in Tally during the move to the portal must still be receivable (GRN) and tracked here.

**Size:** M (1 migration, 1 new route file, 1 new dialog, small hunks in shared files). Built inline by the Manager because the touched P2P files were already being edited by another session; review wave by agents.

## Decisions (owner answers in chat)
| Question | Answer |
|---|---|
| File format | "koi bhi" → Manager chose Excel (.xlsx, CSV also accepted) with a downloadable template |
| After upload | Approved PO, GRN-ready — skips portal approval, shows in Tracking |
| Item match | By code only: Item Master `item_code` or the item's Tally/legacy code; unknown code = row error |
| PO number | New portal number (PO-YYYY-NNNN); Tally number kept as reference (`external_ref`) |

## Manager decisions
- Vendor matched by vendor-master code or GSTIN, never by name; must be Active; Quality supplier block applies.
- All-or-nothing commit; preview first; each Tally PO can be uploaded once (unique `source + external_ref`).
- Separate permission feature `p2p:purchase_orders.tally_import`, inherited from the tab's **Approve** action (the upload bypasses portal approval). Admin can grant it to buyers in the Role editor.
- No fake approval request is created: `source='tally'` counts as released in `po_split.po_is_released`, `po_tracking.load_infos` and the GRN block check. Audit log entry on every uploaded PO.
- Optional Tally PDF attach per PO after upload (once, PDF only, ≤15 MB, SharePoint).
- Open Items tab removed from the PO page (component file kept, unused).
