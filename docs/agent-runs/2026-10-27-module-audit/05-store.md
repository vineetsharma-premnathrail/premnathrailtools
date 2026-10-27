# Store — audit 2026-10-27

## High
1. **A manual reservation makes the stock impossible to issue.** Only project-element holds are used up by an issue, and the "Mark fulfilled" text is false (store/services/project_stock.py:296-316, stock_reservations.py:164-180).
2. **The issue form blocks issuing project stock to its own vehicle.** It counts the element's own hold as unavailable, so the override reason field can never be used (MaterialIssueForm.tsx:192-197, 274).
3. **Quarantine "Clear" writes off, returns or releases stock with one click.** There is no approval, no RTV or debit note, and no document (routes/stock.py:271-315).
4. **A material return does not reverse the sales dispatch, service spares or project consumption it undoes** (material_returns.py:181-217).
5. **The Opening Stock Import can run again and again,** so stock doubles (stock_import.py:80-152).

## Medium
6. The physical count compares the wrong book quantity: a store-wide count uses Free stock only while a bin count uses the total, which gives false gains (physical_counts.py:474-525).
7. A blind count is not blind, because the balances API shows the book figures (stock.py:74-81).
8. The approver pickers list every user although only Store Managers are accepted.
9. The stock adjustment reason is optional.
10. Reorder ignores plant scope (reorder.py:16-23).
11. The in-transit endpoint is unscoped and shows values without the value right (in_transit.py:16).
12. A receiver with own, department or assigned scope may get a 403 when receiving a transfer (access.py:72-81) (verify).
13. There is no short or damaged receipt on transfers; the full quantity is always received.
14. Bin stock can go negative under parallel picks, because the bin check runs before the lock (bins.py:139-162) (verify).
15. Before-PO goods have an optional store and no stock record, so a count books a gain and the GRN adds them again.
16. Stock quantities are Float, not Numeric(18,4).
17. Issue lists are unpaginated and run about 10 lookups per row.

## Low
18. Lists are not sorted by number asc, and balances sort by name, not code.
19. Error messages point to "Store stock entry", which was removed.
20. The issue form swallows load errors and shows empty dropdowns.
21. The adjustment item picker is not searchable and includes inactive items.
22. Approval fails forever if Finance closed the document's period in between.
23. Adjustments on binned items record no bin, so the bin total goes negative.
24. There is no whole-number rule for NOS/PCS units.
25. The issue pick-lists (customers, SRs, projects) ignore the owning modules' scope.
26. The Opening Stock Import button is hidden from Azure admins and styled as a link.
27. Dead API methods getPlantAccess/setPlantAccess.

Clean: dialogs, select, portals, signed links, Back, gear, SAP words, no name matching, GRN locks, number-series locks, no negative stock, F821.
