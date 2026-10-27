# Design / Electrical / Hydraulic — audit 2026-10-27

## High
1. **Every Design user gets Design-head powers until a team is set up.** With no team, is_head is true for everyone and Settings needs no right, so anyone can record "customer approved", which makes the billing milestone due (design/access.py:52-56, routes/settings.py:63).
2. **The Electrical BOM has no release or revision lock.** After the stage completes, lines can still be added or changed, and "proposed" or unapproved lines reach the Production merge (electrical/routes/bom.py:199-251, production/discipline.py:75-106).
3. **A Hydraulic BOM can be self-released.** allow_self_approval=True lets the creator approve it in one click (hydraulic/access.py:290).
4. **Store, Purchase and Quality cannot acknowledge a released ECN** (403), so it never closes (change_notices.py:56, 699-728; scope.py:60-73).

## Medium
5. Released drawings and BOMs can be revised with no ECN (documents.py:565, boms.py:659).
6. The drawing owner can switch off "customer approval required" at any time (documents.py:458-493).
7. Creating and editing Design records ignores the role's create/edit rights.
8. Where-used shows draft BOMs and unreleased drawings to non-team users and ignores scope.
9. The ECR decision is outside the engine, a zero-member board is allowed, the head can override votes, and the raiser can approve their own ECR.
10. Electrical component selection can be self-approved, and an approved line can change item, quantity or spec without re-approval.
11. The Electrical purchase status is set by hand, and "Link PR" accepts any PR number (rule 19).
12. A Hydraulic BOM can be released with components not linked to the Item Master.
13. The multi-level BOM export can pick the wrong sub-assembly BOM, so Store and Purchase get wrong quantities.
14. "Customer approved" can be recorded with no letter attached, but it still triggers billing.
15. Hydraulic file view breaks on a Hindi or en-dash file name, and has no nosniff header.
16. Non-team viewers (Production, Store, QC) may see almost no released drawings because of the default scope (verify).

## Low
17. A released BOM header (project and drawing links) can be edited without a revision.
18. Design lookups skip scope and the team rule.
19. Lists are sorted newest first instead of by number asc.
20. The BOM list is cut at limit(2000) before filtering.
21. Hydraulic file errors show a generic message, and the blob URL is never freed.
22. A customer-approved release accepts a cancelled submission.
23. "WBS" wording still appears, and Design links into PM (verify).
24. An admin can approve their own electrical drawings and hydraulic circuits.
25. There are three separate drawing/BOM registers (Design, Electrical, Hydraulic), so one ECN or where-used can't cover all three (known follow-up).

Clean: dialogs, select, portals, SAP words, gear, signed links, download scope, upload checks, store_item_id on Design BOM, F821, API contract.
