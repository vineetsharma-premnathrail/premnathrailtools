# Service Projects (machine register) moved from Service to Project Management - 2026-10-26

## Requirement
Owner: "please move service module project tab in project management tab". The Service "Projects" tab is the machine register (serial, model, client, site, commissioning, warranty; table `erp_projects`, core-flow step "Machine"). The owner was shown the trade-off (installed base normally sits with after-sales; Service users then need Project Management access) and chose "move to Project Management". Size L (permissions, two modules, migration). Built inline by the Manager; reviewer-agent and security-agent ran the review wave.

## Decisions
- Tab name "Service Projects" in Project Management; permission `projects:service_projects` ("Service Projects (Machines)"). API stays `/api/v1/erp/projects`; code stays in `backend/app/modules/erp`.
- Pages moved to `/dashboard/projects/service-projects/**`; the old `/dashboard/erp/projects/**` URLs redirect (old notification links, bookmarks).
- Explicit-only tab: a Project Management wildcard / preset (Full, View, Contributor) does NOT cover it - it is ticked on its own in the Role editor.
- Migration `f7c3a9e1d5b2` rewrites stored grants (roles, users' extra grants, approval stage configs), turns a Service wildcard into explicit Service Projects grants (nobody loses access), renames the notification `erp.machine_registered` -> `projects.machine_registered` in role subscriptions and user overrides, and moves the `erp.machine` approval workflow under Project Management.
- Machines follow the Project Management data scope. A role (or user override) with machine grants and no other Project Management grant gets its Service scope copied; one that already works in Project Management keeps its Project Management scope for machines.
- The machine detail page opens for Service or Project Management users (SR -> machine link); the server keeps its own SR-viewer rule.
- Approval delegations are left as they are: a Service-scoped delegation no longer covers NEW machine approvals; a Project Management one does.

## Review findings (reviewer + security)
| Finding | Severity | Status |
|---|---|---|
| Stored `erp:projects` grants invalid -> Role editor save fails; notification key orphaned | High | Fixed (migration f7c3a9e1d5b2) |
| PM wildcard / Service wildcard silently gain machine create/delete/import | High | Fixed (explicit-only tab backend + Role editor mirror; Service wildcard -> explicit grants in migration, runtime alias removed) |
| Machine data scope still read from Service | Medium | Fixed (registered under "projects" + scope copy) |
| SR-only user bounced from machine link | Medium | Fixed (detail page any of erp/projects) |
| Machine approval delegations / workflow module | Medium/Low | Workflow row fixed in migration; delegations left (decision above) |
| Letters Word-document adapter app "erp" | Low | Fixed (app "projects") |
| Test did not pin SR-only outcome | Low | Fixed (asserts 403) |
| legacy_access emitted old ids | Low | Fixed |

## Checks
- Backend: targeted suites (erp, rbac, roles/permissions, features, approvals, notifications, reporting, idor, projects, scope, documents) on the final code: 681 passed, 1 xfailed, 0 failed; ruff F821/F401 py312 clean on changed files; `alembic heads` = `f7c3a9e1d5b2` (single).
- Migration tried on a scratch SQLite DB: upgrade and downgrade both give the expected rows.
- Frontend: `npx tsc --noEmit` clean. `npm run test:ui`: 2 errors, both in files of other sessions (`components/reports/SlicerBar.tsx`, `components/rnd/RndProjectMembers.tsx`), none in this change.
- Not seen live: no Playwright / real-screen check yet (owner restarts servers). Screens to look at: Project Management nav with the new tab (1366 and 390 wide), Service Projects list/detail/new/edit, Service nav without Projects, Role editor (Service has no Machines row; Project Management shows "Service Projects (Machines)").

## Release status
Not committed, not pushed. Local DB not upgraded (needs the owner's OK; chain: `e4b8c2d6f1a3` engineer link, then `f7c3a9e1d5b2`).

## Follow-up (same day): service-only Service dashboard, past projects in All Projects, PEW series continues
Owner: Service shows only service; the machine register = our past projects, shown inside All Projects (no separate tab); new project numbers continue the old series (PEW-78 after PEW-77), a number may be typed by hand (e.g. PEW-64A), blank = automatic.
- Service Dashboard (`app/dashboard/erp/page.tsx`, tour `erpDashboard.ts`): no machine/project chips, charts or tables and no /erp/projects call; SR-only stats, "Tickets by Status", "Active Tickets Breakdown", recent tickets (SR fields only: Serial/Client/Model/Site/Warranty columns dropped because the SR record has no such fields).
- All Projects (`app/dashboard/projects/all/page.tsx`, new `components/projects/PastProjectsList.tsx`, `ProjectsNav.tsx`): "Service Projects" tab removed; All Projects shows for all_projects OR service_projects; Current | Past switch when both; past projects grouped by number (PEW-40 -> its machines); "Machine register" button opens the machine list (now titled "Machine register" with ← Back). Permission label "Past Projects (machine register)".
- Numbering (`core/pew_numbers.py`, PM routes, migration `c4e8b2a6d9f1`): next = PEW-<highest used + 1> across machine serials, PM projects and Order Projects; typed numbers refused when held by a PM project, an Order Project or a machine (equal, or prefix + "-"); interim PEW-YYYY-NNNN numbers renumbered in creation order with undo log `pew_series_log`. New tests `test_pew_number_series.py`.
- Migration chain: e4b8c2d6f1a3 -> f7c3a9e1d5b2 -> c4e8b2a6d9f1 (single head). Not run on a real DB.
