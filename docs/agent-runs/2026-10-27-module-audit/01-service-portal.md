# Service portal — audit 2026-10-27

## High
1. **Spares bought on a PR from an SR are not linked to the Item Master** (no store_item_id). Store "Issue from Store" fails, and a Material Issue adds a duplicate line (erp/routes/service_requests.py:1726-1735). This breaks rule 19.
2. **Spares bought on a PR are never billed.** Their price is empty, so a chargeable job bills ₹0 for those spares (service_requests.py:166-174, billing.py:148).
3. **A PR raised from an SR skips approval.** It is created already "approved", and the raiser is stored as the approver (service_requests.py:1612-1632). The comment cites an owner decision of 2026-10-01; confirm it.
4. **A service PR has no Purpose and no charge.** It is not linked to the machine or the SR, so Finance cannot see service spares cost per machine (service_requests.py:1614-1630).
5. **Closure approval does not check Corrective Action.** An SR can close via Approvals with an empty RCA, and the customer still gets the "closed" email (service_requests.py:775, access.py:228-252).
6. **Service billing is switched off, and typing the invoice no. or payment status is refused as well.** There is no way to record invoiced or paid, and the error points to a hidden button (billing.py:35, service_requests.py:693-701).
7. **"Booked from store" on a Material Request does not reserve stock.** Two SRs can book the last unit (service_requests.py:1836-1862).

## Medium
8. An engineer can mark a material received or issued with no stock movement (service_requests.py:1887-1928; schema status free).
9. A visit can be edited after the customer has signed. "Signed" means only a typed name, and the signed report can be deleted (service_visits.py:231-255).
10. The SR-closed and PR-raised broadcasts go to users outside their data scope (other customers' SR details).
11. An SR can be raised on a machine outside the user's scope. The bulk import also ignores scope (service_requests.py:483-500, service_request_import.py:132).
12. Bulk import skips warranty, SLA, machine-approved and closure-approval rules (service_request_import.py:234-262).
13. The SR list and the New SR form fail for roles without the Machines tab, since it moved to PM on 10-26 (service-requests/page.tsx:107-116) (verify).
14. The SR list and dashboard are capped at 1000 records with no paging, so KPIs silently miss old records.
15. The contract list has limit(500) and N+1 queries (service_contracts.py:57-129).
16. AMC "visits included" counts SRs, not visits, and includes cancelled SRs (contracts.py:86-91).
17. SR dates are not checked: completion can be before attendance or in the future, and warranty start comes from it.
18. The default approvers for New machine and SR closure are Portal admins, not Partners (access.py:263-287) (rule 21).
19. Anyone with Visits › Create can log hours on an SR they are not assigned to, and those hours go into the bill.

## Low
20. The "locked SR, ask admin to unlock" feature is dead, but the text is still shown.
21. The Recycle Bin promises a 10-day auto-purge that does not exist.
22. SR numbers break after 9,999 in a year (string max).
23. Some GET requests write to the DB (invoice sync).
24. The edit form's status dropdown offers Closed and Cancelled (422/403) and is missing Assigned.
25. Lists are not sorted by code asc (SRs, contracts).
26. A free-text material line on a warranty (free) job is still billed.
27. The frontend admin check (`role === 'admin'`) is narrower than the backend's (Azure admins).

Clean: dialogs, select, portals, signed links, SAP words, Back, gear, F821, API contract, money masking.
