# Production + Quality — audit 2026-10-27

## High
1. **An RRV final inspection can be marked "Passed" by anyone with Final Inspection Edit.** There is no Quality-only check, failed rows can still be saved as Passed, no inspector is stamped, and no NCR is raised (quality/routes/inspections.py:150-200, production/rrv_builds.py:863-895).
2. **Finished goods can be received and a WO completed with no material issued.** Stock is overstated and the order costs ₹0 (production/routes/work_orders.py:578-592, 769-848).
3. **Production Planning keeps offering "Raise PR" for the same shortage,** because open PRs and POs are not subtracted (service.py:251-306).
4. **Draft PRs saved from MRP don't count as supply,** so the next MRP run plans them again (mrp.py:421-506, store/services/reorder.py:20).

## Medium
5. MRP → PR conversion takes no row lock, so a double-click raises two PRs (mrp.py:441-449).
6. Scrapped quantity is not taken off what can still be received (work_orders.py:789-795).
7. Several serialised units can be received under one serial (work_orders.py:784-788).
8. A vehicle reworked after its final inspection is never inspected again, because the old "passed" result is still linked (rrv_builds.py:834-873).
9. NCR severity can be lowered silently, which skips the Partner/Design stages and the CAPA rule (quality/routes/ncr.py:158-172).
10. Quality lists and records check only module access, not the tab, so complaints can be seen without that tab (verify).
11. BOM "Make obsolete" skips approval and checks nothing (boms.py:818-827).
12. Material can be over-issued to a WO without limit, and items not on the BOM can be issued with no reason (work_orders.py:664-695).

## Low
13. BOM "New version" takes no lock, so two v3 drafts can be created.
14. Many lists are sorted newest first instead of by code asc (rule 14).
15. Some screens swallow errors: complaint photo upload, masters, settings, inspection-plan new (rule 15).
16. The raw uploaded file name goes into the download header.
17. Closing a WO checks nothing beyond "completed" (verify).
18. Rejected final-inspection output still counts as received in MRP (verify).
19. NCR/CAPA closes and lot usage decisions are role checks, not central engine steps (verify rule 21).
20. 3 unused imports.

Clean: dialogs, select, portals, signed links, Back, gear, SAP words, API contract, WO/BOM/RRV permissions + scope, engine for release/activation, store_item_id on PR lines.
