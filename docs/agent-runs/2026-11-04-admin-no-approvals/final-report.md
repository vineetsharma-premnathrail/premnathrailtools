# Final report — admin is not an approver

Pushed: commit 264c2560 to main on 2026-11-05 (owner said "sare updates ok git push karo").

## Done
- Azure Global Admin grants nothing; portal admin = role "admin" (first-install bootstrap only when no admin row exists).
- Admin never decides by being admin: engine stand-in removed, has_grant withholds approve/reject, module bypasses removed in 13 modules.
- New "Reassign approver" (admin only, audited, four-eyes / same-stage / delegation-back / exited guards).
- Also shipped: All Projects without Project manager column; Store issue pickers (project no. + name, every project status, no Project unit on Project / Site).

## Checks
- Full backend suite: 3042 passed, 2 failed → both fixed and re-run green; ruff F821 py312 clean; tsc 0 errors; no migration.
- Security + code review run; fixed: stored admin_ids stages, reassign guards, bootstrap, access-review button, stale texts.

## Risk accepted by the owner for this release
Management actions gated on "approve" now need a real role grant for admins too: Work Order complete/close, BOM obsolete, PM milestone Done, Finance period close/reopen, year-end, depreciation, payment run, GST set-off, bank reco, GRN inspection, service entry accept, maintenance triage, HR documents.

## Open owner decisions
1. Admin keeps process/posting actions (reclassify the routes above)?
2. Admin may give themselves approver roles / Partner (audited)?
3. Attendance period unlock: Partner only or admin too?
4. First-install bootstrap OK?
Also: R&D task due/overdue reminders do not exist yet (new feature on request); mobile app still treats is_azure_admin as admin (other session).
