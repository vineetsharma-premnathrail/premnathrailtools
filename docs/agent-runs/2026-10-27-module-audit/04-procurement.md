# Procurement (P2P) — audit 2026-10-27
(The 4 items already known from the PR line-buyer work are not repeated here.)

## High
1. **The Open Items report, its Excel export and PO History ignore data scope.** Any PO-tab viewer sees every PO line in the company, and any PO's history can be read by changing the id (p2p/routes/po_reports.py:124, 251-334).
2. **Duplicate POs for the same PR lines.** A double-click or two buyers at once can create two POs, because the PR row is not locked and submit does not re-check the quantity fit (rfq.py:724, 1027; mm_quotations.py:300).

## Medium
3. On a split PR, Finance cannot book the invoice for an approved PO while a sibling PO is still in approval (accounts/service.py:494, 533).
4. The old create-po and select-vendor endpoints are still live. They take a free-text vendor and a typed PO number, and skip the RFQ and vendor checks (p2p_requests.py:2102-2255).
5. A PO draft can go to a typed vendor name with no vendor master id, which bypasses the blocked-vendor check; a typed po_number overrides the series (rfq.py:739-753).
6. Delivery costs (landed charges) can be added after PO approval with no re-approval (landed_cost.py:138-147).
7. The internal order of a PO can be changed at any stage, even after invoicing (purchase_orders.py:79-122).
8. The same person can record and accept a service entry, which is a segregation-of-duties gap (service_entries.py:154-169).
9. Vendor master: unblocking a vendor or changing its GSTIN or PAN needs no second approval (vendors.py:374-397).
10. Rejecting a single PO kills the whole PR, while rejecting one PO of a split PR cancels only that PO (approvals.py:228-272).
11. There is no per-PO cancel or short-close on a split PR (p2p_requests.py:1565, 2263).
12. The Word PO prints as final while it is in approval, and on a split PR it can name a sibling PO's approver (reports/purchase_order.py:151, 161).
13. Goods received before a PO create a PR that skips PR approval (pre_po_receipts.py:96-101) (verify intent).

## Low-Medium
14. Supporting documents can be uploaded or deleted while the PR is in approval.
15. The Purchase quick-edit (PATCH) can change priority, requirement type and required date (approval-routing fields) after submit or approval.

## Low
16. Saving a PO draft clears GST when tax_rate is omitted (latent; rfq.py:916).
17. The RFQ and PO lists are not sorted by number asc.
18. Remind, Resend and Add-vendor still email vendors after the PR is cancelled or rejected.
19. The GRN pending-PO picker has no scope or plant filter.
20. A raw vendor id is in the RFQ page URL (rule 18).
21. Line buyers cannot open the RFQ or PO of their own lines (scope).
22. Download file names are not escaped in Content-Disposition.
23. The RFQ list "Closed" counter actually counts sent RFQs.
24. A PO amendment can add an item that is on no PR.

Clean: dialogs, select, portal, Back, gear, SAP words, RFQ email escaping, GRN over-receipt lock, F821.
