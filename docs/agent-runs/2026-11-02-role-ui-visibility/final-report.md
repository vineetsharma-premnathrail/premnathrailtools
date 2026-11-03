# Final report: role-wise UI visibility (2026-11-02)

**Release status: NOT PUSHED, NOT COMMITTED.** Waiting for the owner's live check and explicit yes.

## What was built
Admin decides per role what a user sees in a screen: form sections (show/hide), dropdown values (allowed set, server-enforced), table columns (show/hide). Catalogue is code (`register_visibility`), roles store overrides only, default = everything visible, union across roles, admin/Partners unrestricted. First application: Procurement › Purchase Requisitions (New/Edit PR form: Purpose, Priority, Request Details, Remarks, Attachments, item-table columns; requisitions list columns).

## Files (this session only)
Backend: `app/core/visibility.py` (new), `app/core/features/p2p.py`, `app/modules/main/models/role.py`, `alembic/versions/a4e7c1b9d306_role_visibility_rules.py` (new; down_revision b8d2f6a1c3e5), `app/modules/main/routes/roles.py`, `app/modules/main/routes/auth.py`, `app/modules/main/schemas/auth.py`, `app/modules/p2p/routes/p2p_requests.py` (visibility hunks), `app/modules/p2p/routes/pr_transfer.py` (import guard), `app/tests/test_visibility_rules.py` (new, 62 tests).
Frontend: `lib/visibility.ts` (new), `components/organization/VisibilityRuleDialog.tsx` (new), `components/organization/PermissionMatrixEditor.tsx`, `app/dashboard/organization/roles/[id]/page.tsx`, `app/dashboard/p2p/new/page.tsx` (visibility hunks), `components/p2p/P2PRequestList.tsx`, `types/index.ts`, `lib/changelog.ts`.
Docs: `docs/11-decisions/0005-role-ui-visibility-rules.md` (new), `docs/module-guides/md/16-organization-admin.md`, `docs/02-modules/platform/authorization-architecture.md`, this run folder (requirement, spec, plan, findings, uat, final-report).

## Checks
- `npx tsc --noEmit` 0 errors; `npm run test:ui` 1191 files, 0 errors.
- `ruff check --select F821 --target-version py312 app alembic` clean; `alembic heads` = `a4e7c1b9d306` only.
- pytest `test_visibility_rules.py` + `test_roles_permissions.py`: 73 passed. Pre-existing failure `test_p2p_pr_purpose_item_types::…does_not_fit_the_purpose` reproduced on a clean HEAD worktree (not this change).
- Local DB upgraded to head (`alembic upgrade head`, localhost).
- Secret scan of the staged file set: nothing literal.

## Review wave
security (2 Medium, 5 Low), reviewer (2 Major, 5 Minor), qa (13 tests + uat.md), accessibility (5 Major, 7 Minor). All fixed except items listed as pre-existing/shared in findings.md (shared useFocusTrap Shift+Tab, shared Checkbox contrast, PR list rows click-only). No open Critical/High.

## Not done / needs the owner
1. **Live visual check not run** (dev servers were down): Role editor chip + dialog (1366 / 390), New PR form with sections/columns hidden, requisitions list with columns hidden, old PR edit keeping its purpose, Urgent-only role. UAT script: `uat.md`.
2. **Migration parent** `b8d2f6a1c3e5` is another session's staged, uncommitted migration. This change must be committed after (or together with) it, or production's `alembic upgrade head` fails on a missing parent.
3. **Decision to confirm**: hidden sections/columns are hidden on screen only (dropdown values are server-enforced). requirement.md said "stripped where feasible"; ADR 0005 records the UI-only choice.
4. **Behaviour change elsewhere**: MRP "convert planned orders to requisition" sends no Purpose; a Purpose-restricted user now gets "Pick a Purpose" there (the same rule that stops bypass-by-omission). Unrestricted users unaffected.
5. Priority rule applies to the PR form only (Service Request / work-order PRs keep their own priority) — stated in the Role editor hint.

---

# Round 2 (2026-11-03): whole application, screens, Preview & choose

**Release status: NOT COMMITTED, NOT PUSHED.**

## Built
- 35 catalogue entries across 15 modules (Procurement, CRM, Products, Store, Projects, Service, HR, Finance, Quality, Production, Design, Electrical, Hydraulic, Maintenance, R&D requirements/projects/tasks). R&D calculator pages untouched (diff empty).
- Screen-wise tabs in the Visibility dialog (form / record page / list per entry); "Preview & choose" mounts the real screen with sample data, eye toggles per section/column, lock pill on required sections. Preview registry per module in `frontend/src/lib/visibilityPreviews/` (Manager-owned index).
- Preview write guard at the API layer (`lib/previewWriteGuard.ts` + `lib/api.ts` interceptor): no POST/PUT/PATCH/DELETE while a preview is open.

## Review round 2
- Security: 0 Critical/High; 4 Medium (bypasses via AR collection, Store item import, HR org assignment, R&D task direct routes) + 7 Low — all fixed with tests.
- Reviewer: 1 Major caused by the Manager (CRM tab-strip component defined inside `.map()`, remounting tabs for every user) — fixed; empty right column on 10 forms, CRM quick-edit dropdowns, preview keyboard guard, PM task form wrappers, hidden-field validation on Organization form — fixed. Extra bug found and fixed: Inquiry/Tender forms read priority under the wrong dropdown key.

## Checks (final)
- tsc 0 errors; UI audit 1232 files 0 errors; ruff F821 py312 clean; alembic single head `c7e3a9d1f2b4`.
- pytest visibility (9 files) + roles + registry: 231 passed.
- `test_rnd_intake.py`: 2 failures in the working tree, 0 on clean HEAD. They assert Teams-message counts; the working tree also has another session's uncommitted changes to `core/events/rnd.py` and `core/notification_events.py` (+104 lines) and new tests in that file. Not caused by visibility code as far as can be seen without stashing — owner/other session to confirm.

## Release gate (owner)
1. Live browser check not done (no Playwright in this environment).
2. Migrations must ship together in order: `b8d2f6a1c3e5` (other session, staged) → `a4e7c1b9d306` (this run) → `c7e3a9d1f2b4` (other session, untracked).
3. Many touched files also carry other sessions' uncommitted hunks; committing only this run's work needs per-hunk staging or a joint commit agreed with those sessions.
4. Open product decisions: HR Lifecycle joining not bound by the Employees employment-type rule; vendors added from Procurement / payment runs / spares issues follow their own rules (stated in hints); `projects:overview.tasks` has no preview screen.
