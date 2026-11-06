# Findings (merged: security-agent + reviewer-agent)
| Sev | Finding | Status |
|---|---|---|
| High | Undecided BPO Quality lot settled as passed on GRN (both reviewers) | Fixed: GRN refused 409 until Quality decides; tests |
| High | Project hold lost for BPO goods (reviewer) | Fixed: settle_line holds settled qty; reversal releases; tests |
| High | Two alembic heads (reviewer) | OPEN - other session's b7d3f1a9c5e8 (staged delete) vs ours c3b9e5a1f7d4 (on f1a7c3e9b5d2). Must be one head before push |
| Medium | Race BPO cancel vs PO upload (security) | Fixed: row lock + 409 in rfq.py |
| Medium | pending-purchase-orders not store-scoped, exposes requester (security) | Fixed: store scope |
| Medium | GRN form prefilled ship-to store vs BPO store (reviewer) | Fixed: pre_po_store_location_id preferred |
| Medium | Quality lot page raw 'pre_po_receipt' label (reviewer) | Fixed |
| Medium | N+1 on pending list (reviewer) | Fixed (approval/received helpers still per PO) |
| Medium | Rate 0 form vs server mismatch | Fixed: >0 both sides |
| Low | NaN quantities, lot cost_source/date, reversal lock order, migration downgrade FK guard, TC rule | Fixed |
| Low | Revaluation uses item-wide on-hand share (same as landed cost) | Accepted (spec) |
