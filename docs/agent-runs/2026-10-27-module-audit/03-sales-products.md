# Sales + Products — audit 2026-10-27

## High
1. **Cancel, close or hold of an SO leaves its Order Project active.** The project still shows in the Purchase, Store and Production pickers (sales/routes/orders.py:670-765; refresh_order_project is not called). Fix: refresh the OP on every status change and mirror hold onto it.
2. **Order currency is only a label.** USD amounts are treated as rupees for approval limits, credit, list prices and GST (sales/models/order.py:44, approvals.py:338, pricing.py:60-67). Fix: store an exchange rate and convert to INR, or block non-INR orders.

## Medium
3. Two SOs can be created for the same inquiry, tender or customer PO (race; no unique index), giving two Order Projects.
4. An SO can be confirmed with no Product master link; the prefill copies free text (service.py:541-576, orders.py:256).
5. A product can be flipped to Development and deleted. This cascade-deletes its prices and nulls product_id on SO lines (products/routes/products.py:176-219).
6. Customer prices and floor (min) prices are readable by any CRM or Service user (price_conditions.py:26, 87-122).
7. Price-list edits have no approval, version history or audit (price_conditions.py:125-165) (verify the audit part).
8. Amendment approval routes by the size of the change, not the new order value, and runs no credit check on an increase (approvals.py:356-374).
9. Approving an amendment overwrites header fields changed after its snapshot (amendments.py:86, service.py:1162-1176).
10. Short-close does not reduce the order value or the billing milestones, so retention is still billed on the full contract (verify).
11. A price cut by amendment after invoicing leaves the order over-invoiced with no credit-note prompt (service.py:160-169).
12. CRM quotations of any customer can be listed and copied into an SO, ignoring CRM data scope (orders.py:171-211, 436-441).
13. A Delivery-only user sees all prices and LD (sales/views.py:151-155).
14. Hold and resume need only Edit and notify nobody (orders.py:670-689).

## Low
15. The SO branch_id is not validated.
16. The approver sees the raw code "price_below_list".
17. The GST rate check is anything from 0 to 28: 7% passes and 40% is blocked.
18. A deliberate ₹0 price is overwritten by the list price (pricing.py:66-67).
19. Messages still say "Sales › Order Projects"; it is now under Project Management.
20. An order acknowledgement can be issued on held, short-closed or closed orders.
21. Lists are not sorted by code asc: SOs, Products, Order Projects, Price conditions.
22. Small gaps:
    - The freight suggestion is shown without the prices right.
    - The proforma list is scoped after limit(200).
    - The pre-engine amendment chain excludes only the submitter.
    - A GET on an Order Project writes and commits.

Clean: browser dialogs, native select, portals, signed refs, gear, SAP words, central approvals, draft-only edits.
