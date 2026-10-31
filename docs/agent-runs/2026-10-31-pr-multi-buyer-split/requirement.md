# Procurement: one requisition → several buyers, RFQs, POs and GRNs (2026-10-31)

## Owner's words
"ek pr ke multi category hai to multi buyer ok and then multi rfq or multi quotation … ho sakta hai ki
same item ek buyer par fulfill na ho and multi po and multi grn … our organization me buyer wise kaam hota hai"
"jis person ne pr ki thi use pr par hua kaam status me pata chale … kis se approval hua pr ya nhi,
po approval hua ya nhi, grn hua ya nhi and sab"

Core-flow position: Store/Purchase (PR → RFQ → quotation → PO → GRN → Finance 3-way match).

## Today (verified in code)
- Line buyer exists (`p2p_request_items.buyer_id`, by item type).
- RFQ = one per PR (`rfqs.p2p_request_id`, one draft per PR), no buyer, no line set.
- Quotation lines per PR line with line-level `is_awarded` (no qty).
- Upload PO (`routes/rfq.py upload_po` → `build_po_draft`) puts ALL open PR lines, full qty, into one vendor's PO.
- PR header status is one pipeline (approved → vendor_quotations → vendor_selected → po_drafted → po_raised …);
  the first PO moves the whole PR, blocking other buyers.
- PO line already has `pr_item_id` (one PR line may be spread over several POs); PO has many GRNs.

## Decisions (owner, in chat)
| Question | Answer |
|---|---|
| One RFQ with lines of several PRs? | Phase 2. Phase 1: one RFQ = one PR + one buyer. |
| PO approval | Every PO goes to its own approval (unchanged). |
| Requester visibility | On the PR: who approved the PR, per line buyer / RFQ / PO / PO approval (who, when) / GRN / received vs pending. |

## Decisions by the Manager (ERP standard)
- PR line is the unit of work; buyer works a "My Lines" worklist.
- Award carries awarded qty; one line can be split across vendors; Σ awarded ≤ open qty.
- Upload PO = one vendor, only that vendor's awarded lines/qty; Σ PO qty per PR line ≤ requested − issued from stock.
- Purchase head may reassign an unordered line (remaining qty) to another buyer, with reason.
- PR status derived from lines; short-close of remaining qty with reason.
