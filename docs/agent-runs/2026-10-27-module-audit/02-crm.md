# CRM — audit 2026-10-27

## High
1. **Every customer contact in the company can be read by any CRM user.** `/crm/organizations/contacts/all` and `/{org}/contacts` have no data scope (crm/routes/organizations.py:479-494).
2. **`?picker=true` bypasses the organisation scope.** It returns full details (GSTIN, PAN, credit) of every organisation with no limit, and GET `/{org_id}` is also unscoped (organizations.py:69-103, 275).
3. **Users without "Prices & margins" still see deal values.** The dashboard, win-loss and forecast APIs do not blank them (dashboard.py:43-58, opportunity.py:50-127).
4. **USD export quotations are approved against ₹ limits.** $90,000 is compared as "90,000" (quotation_status.py:102-152).
5. **The discount is applied after GST, so GST is charged on the pre-discount value.** An empty discount type is read as % in approval but as ₹ in the PDF/Word (quotation_pdf.py:494-509, quotation_docx.py:183, InquiryDetailPanel.tsx:817).
6. **A tender can still be edited after an SO exists.** ensure_not_with_sales is missing in update_tender and in tender TOR (tenders.py:228-310).
7. **"Won" can be set by hand.** Stage "Order Received" or status "Closed - Ordered" can be picked manually, which opens "Create Sales Order" with no accepted quotation (opportunity.py:43, inquiries.py:55-64).
8. **Status has no forward-only rule.** It can go from Closed back to Requirement Received with no admin or reason, which also clears closed_at, and stage and status can contradict each other (inquiries.py:301-310).
9. **CRM data scope matches free-text names.** Two users with the same name see each other's records, a rename loses access, the import assigns by name, and tenders have no bd_owner_id (access.py:57-91).

## Medium
10. Every save of a draft quotation adds a revision number, so the first offer goes out as -r6 (workflow.py:366-377).
11. Creating a quotation skips the checks that editing enforces: zero lines and a flat discount larger than the total are allowed (workflow.py:192-236).
12. When the Partner discount limit is 0 or unset, every discounted quote goes to the Partner (quotation_status.py:146-151).
13. A failed TOR email still saves the document, and every retry adds another orphan TOR file (inquiries.py:498-500).
14. Deleting a quotation is a hard delete, leaving its Word/PDF, approvals and audit pointing at nothing (workflow.py:500-519).
15. Recording the customer response on a submitted quote always fails with 409 (workflow.py:323-333).
16. Contacts can be added to any organisation, and a follow-up or MoM can carry other customers' contacts (organizations.py:497-524, activities.py:180-198, 368).
17. Bulk import overwrites inquiries that are already with Sales, with no audit, and uses its own ID format (bulk_import.py:509-520).
18. Money is stored as Float: price, total, discount, expected value (models/inquiry.py:142-194).
19. Only the creator or an admin can edit. The assigned engineer cannot, and the BD owner can never be changed if the creator leaves.
20. A tender can close as lost with no lost reason.
21. Status words use two different dash characters (– and -), which breaks matching in reports and filters.

## Low
22. Organisation and quotation lists are not sorted by code asc.
23. Some error messages are generic or show raw field names, and the Tax/VAT messages contain garbled characters ("â€”").
24. The duplicate-customer check is an exact name match only ("ABC Pvt Ltd" vs "ABC Pvt. Ltd."), with no merge.
25. The quotation form never sends product_id or a price-override reason, so the price-list check never runs.
26. GET /quotations runs the expiry for the whole company and commits.
27. Admin checks use role == "admin" instead of is_admin_user.
28. The single-step stage route writes no audit or notification.
29. Follow-up status is free text, so "open" or "Done" drops out of the counts.

Clean: dialogs, select, portals, FormSheet, gear, signed links, SAP words, tour targets.
