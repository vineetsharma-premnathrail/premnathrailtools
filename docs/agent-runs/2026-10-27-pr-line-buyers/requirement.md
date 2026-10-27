# PR form: no header category, buyer per line (2026-10-27)

## Requirement (owner, in chat)
On the Purchase Requisition form, "Purchase Requisition Category" and "Requirement Type" say the
same thing as the Item Type + Category each line already picks. Remove them from the header.
The line's item type should decide the purchaser (buyer). Remove the read-only "Category"
column before "Ship To" in the line table (shown twice). Attachments: keep only
"Specification / reference file"; remove "Supporting documents".

Core flow: Store/Purchase (requisition -> buyer -> RFQ -> PO).

## Decisions (owner, 2026-10-27)
- Buyer: **per line**, from the line's Item Master item type (Procurement > Settings > Buyer for
  each item type). One requisition can carry lines for different buyers.
- Number: **P2P-YYYY-NNNN** (one series per year). Older numbers (P2P-RAW-2026-0001) stay.

## Decisions taken by the Manager
- New requisitions store category_code = "ITM" ("By line item"); the column stays NOT NULL.
- Requirement type is no longer asked; the server stores the purpose's usual one.
- The header assigned buyer = buyer of the first line that has one, so lists, data scope,
  RFQ and PO tracking keep working unchanged. Every line buyer sees the PR (data scope
  "assigned") and is notified at approval which lines are theirs.
- Requisitions raised from Service Requests and Maintenance still send a category and keep the
  category buyer (settings group renamed to say so).
- Item type alone cannot tell Electrical from Raw material (both "material"); the owner was told.

## Deferred
- RFQ / PO split per line buyer: routes/rfq.py is being changed by another session; the main
  buyer runs the RFQ for the whole requisition until then.
