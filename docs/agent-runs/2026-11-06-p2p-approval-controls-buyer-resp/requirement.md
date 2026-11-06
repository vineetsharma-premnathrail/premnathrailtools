# Procurement approval controls + buyer responsibility (2026-11-06)

Core flow: Store/Purchase (PR -> RFQ -> PO approval) and Organization (approval workflows).

## Owner decisions (chat, 2026-11-06)
- PR self-approval stays allowed (heads raise PRs too) - no change.
- Tally PO before portal approval stays - no change.
- PR gets a value: sum(qty x Item Master price) passed to the PR approval, so PR stages can test Amount.
- PO approval conditions gain risk fields: quantity above requisition, vendor other than L1 (award check), single / limited quotation.
- Requester's department condition becomes a pick-list from Organization > Department (was free text).
- Old (pre-workflow) PR/PO approval code is removed; anything still on it moves into the workflow.
- Buyer responsibility: one buyer owns many Item Master categories (one category = one buyer); line buyer = category buyer -> item type buyer -> default buyer. Service Request / Maintenance PR lines use the same rule. Old "Buyer by category" section and hard-coded buyer emails removed. Unassigned categories listed.
