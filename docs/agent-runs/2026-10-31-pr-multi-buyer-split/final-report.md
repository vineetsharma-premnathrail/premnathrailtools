# Final report — PR multi-buyer split (2026-10-31)

Status: PUSHED to main as fdd9901a on the owner's explicit instruction ("push all change", "Sab kuch", "Abhi turant").
Live browser check: NOT done. Backend regression pack was still running at push time.

## Built
- One RFQ per PR + buyer with its own lines; quotes only on those lines; awards with quantity (split across vendors).
- Upload PO per vendor from that vendor's awarded lines/qty → several POs per PR, each with its own approval; PO rejection cancels only that PO; discard draft PO.
- PR status after approval = roll-up of lines/POs; GRN, Finance 3-way match, reorder, MIS, reminders work per PO / RFQ buyer.
- Requester tracker on the PR (PR approvers, per line buyer / RFQ / PO / PO approval who-when / GRNs / ordered-received-pending; no prices).
- My Lines worklist (urgent/overdue server filters), reassign line (Purchase head only), short-close line, HR leaver handover moves RFQs.
- Migration e7a1c3d5b9f2 with backfill (ran on local DB: 5 RFQs, 3 awards, 5 POs linked).

## Checks before push
- ruff F821 py312: clean. alembic heads: one (e7a1c3d5b9f2). tsc: clean. test:ui: 1186 files, 0 errors.
- First broad pack (before review fixes): 779 passed, 1 failed (pre-existing, fails on HEAD too).
- Targeted suites after fixes: fix-1 88 passed, fix-2 236 passed (1 xfailed), e2e/core/approvals 67 passed.
- Security / code review / QA: all Critical/High fixed; accepted Lows listed in findings.md.

## Also in the commit (owner chose "everything")
Other sessions' uncommitted work: R&D rework, Projects form, CRM tours, email, mobile/ Flutter scaffold, infra/backup scripts. Not reviewed by this run.
Excluded: .idea/, .playwright-mcp/, docs/videos/*.mp4, demo_*.xlsx, t4.txt.

## Owner actions
- Role editor: tick "My Lines tab" on buyer roles, "All buyers' lines (purchase head)" on the Purchase Head role.
- Run the UAT script (uat.md) on production.

## Follow-ups
Cancel of a released PO with approval; idle-line reminders; multi-PR RFQ (phase 2); MIS PO KPIs count POs; dept PR cost-centre check at upload.
