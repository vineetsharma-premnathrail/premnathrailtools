# Final report: PR form without a header category, buyer per line (2026-10-27)

## Built
- PR form: Purchase Requisition Category, Requirement Type, the read-only line "Category" column
  and "Supporting documents" removed. Only "Specification / reference file" is left under Attachments.
- Each line gets its buyer from the Item Master item type (Procurement > Settings > Buyer for each
  item type: material, consumable, tool / equipment, service, asset, any other). If a type has no
  buyer picked, the standard buyer for that type is used.
- New numbers are P2P-YYYY-NNNN, and category_code is stored as "ITM". Requirement type is set
  from the purpose.
- The main (header) buyer is the first line's buyer. It is never cleared, and once a requisition
  is approved it is no longer overwritten.
- PR detail page: a Buyer column per line, and "Buyers" when more than one.
- Data scope, the list and the detail page include line buyers.
- At approval, each line buyer is told which lines are theirs.
- HR leaver handover moves line buyers, and the pending-work list includes them.
- Approval conditions on Category use the purpose's usual category for "ITM" requisitions.
- "ITM" is removed from the choices in approval conditions, Purpose rules and the PR /meta
  endpoint. Maintenance work-order PRs reject "ITM".
- Migration e5b1d7c3a9f2 adds p2p_request_items.buyer_id.

## Checks
- Pytest:
  - p2p suite plus the new test_p2p_line_buyers.py (7 tests): 115 passed in the last run.
  - Earlier run of 10 p2p files: 121 passed.
- tsc: clean.
- ESLint on the PR form: 3 errors, all pre-existing (it was 6 before).
- test:ui: 2 errors, both in other sessions' files (RndProjectMembers, SlicerBar).
- ruff F821 py312: clean for this change. projects.py from another session has 17.
- alembic heads: one head (b6e2d8f4a1c7). The other session chained its migration onto ours.

## Reviews
- reviewer: 2 Critical and 2 High findings, all fixed (draft submit with ITM, two heads, buyer
  overwrite on edit, wording of the line-buyer note). The "no buyer" gap is left open; see Open.
- security: no Critical or High. The Medium on approval conditions is fixed (effective
  category). Line buyers are cleared when a requisition is renumbered to a real category.
- qa: the found bug (a line buyer outside the Purchase team could not open the requisition) is
  fixed.

## Open / not done
- RFQ and PO split per line buyer is deferred (rfq.py belongs to another session). For now the
  main buyer raises the RFQ.
- A requisition whose first-line type has no buyer (for example asset) has no main buyer until
  Purchase uses Assign Buyer.
- The Purpose rules card still shows category and requirement-type settings. These now apply
  only to Service and Maintenance requisitions.
- MIS, exports and the list filter show "By line item" as the category.
- Live Playwright check NOT run (no server started, per rule 7).
- Push risk: migration e5b1d7c3a9f2 chains onto untracked migrations from other sessions
  (a9d3f5b7c1e2, c4e8b2a6d9f1, ...). It must ship together with them.

Release status: not committed, not pushed.
