# Findings

| # | Sev | Raised by | Finding | Status |
|---|---|---|---|---|
| 1 | High | reviewer | POReadyList treated any emailed RFQ as awarded, so unawarded RFQs showed a Create PO button | Fixed (Manager): ready = awarded lines OR vendor selected |
| 2 | Medium | reviewer | Client blocked Save on untouched lines under the qty floor; server only checks changed qty | Fixed (Manager) |
| 3 | Medium | reviewer + security | Receipt stuck at `po_created` after the PO is rejected/cancelled | Fixed: receipt reopens to `pending_po` (approval reject, PR cancel/reject) |
| 4 | Medium | security | create-po let any Procurement user self-assign as buyer | Fixed: assign-buyer rule enforced; buyers stay cross-plant (same as the GRN purchase-team rule) |
| 5 | Medium | security | Pending list has no plant scope | Accepted by design (buyers are cross-plant); documented in route comment |
| 6 | Medium | security | Hardcoded PR category could pick the wrong PO workflow | Fixed: line-category PR, the purpose's usual category from Settings, buyer per line item type |
| 7 | Medium | security | Qty raise not visible to the PO approver | Fixed: approval title + context flag `qty_above_requisition`; no tolerance (owner wants freedom) |
| 8 | Low | security | Receipt not audited | Fixed (Manager): registered in audit_registry |
| 9 | Low | security | Future received date, no length caps, no list limit, unlocked floor read | Fixed |
| 10 | Low | security | Store user is the requester of the auto PR | Kept, decision D6 |
| 11 | Low | security | Same person may record the receipt and create its PO | Covered by SOD-02 role review; PO approval is a separate person |
| 12 | Critical (env) | reviewer | Two alembic heads (other sessions' migrations on our revision) | Resolved by the other session; single head `b6e2d8f4a1c7` |
