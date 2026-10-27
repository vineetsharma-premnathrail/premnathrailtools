# Findings — review wave (2026-10-27)

| # | Sev | Raised by | Finding | Status |
|---|-----|-----------|---------|--------|
| 1 | High | reviewer | Migration b8d4f2a6c1e7 dropped the index behind a unique constraint on PostgreSQL (fails the upgrade) | Fixed: skip `duplicates_constraint` indexes (upgrade + downgrade). Still NOT run on PostgreSQL. |
| 2 | High | security | Project / R&D budget card showed ledger accounts + voucher lines to any project member | Fixed: ledger detail only with Finance › Internal Orders or Financial Reports view (`project_budget.can_see_ledger`); others get totals + open POs. Amounts removed from the 409 text. |
| 3 | Medium | reviewer | "Order Project" wording in the SO-confirmed notification + P2P tours | Fixed |
| 4 | Medium | reviewer, security L1 | `GET /projects/{id}/units` wrote to the DB | Fixed: read-only |
| 5 | Medium | security M1 | Any project manager could link / switch a Finance budget | Fixed: management only (Partners, Directors, granted users) |
| 6 | Medium | security M2 | Units lookup now lists every live PM project to 8 modules | Accepted (decision): all projects live in All Projects now, so purchase / store must be able to charge any of them. Lookup is still app-gated. Owner to confirm. |
| 7 | Medium | security M3 | Past machine stage could move back with no reason by any editor | Fixed: back = admin / Partner + reason (PromptDialog in UI) |
| 8 | Medium | security M4 | PM could jump to Dispatched+ before units shipped; moves on closed/cancelled projects | Fixed: 409 on closed/cancelled; Dispatched+ with unshipped units = management only |
| 9 | Low | security L2 | Units route only app-gated | Fixed: All Projects tab view |
| 10 | Low | security L3 | "Already linked" message named another project's title | Fixed: code only |
| 11 | Low | security L4 | Race PM vs R&D linking the same budget | Open (low; DB unique only per table) |
| 12 | Low | security L5 | Auto stage move without a user leaves no audit line | Open |
| 13 | Low | reviewer | ~950 internal `order_project_*` identifiers remain | Accepted (decision D2: column / JSON names kept) |
| 14 | Process | Manager | FE-1 agent ran `git mv` / `git rm --cached` (agents must not write git) | Reported to owner; index has those staged renames/deletions |
