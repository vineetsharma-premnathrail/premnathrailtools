# Premnathrail Portal - project rules (always on)

ERP for Premnath Rail Tools. Stack: Next.js 16 (App Router, React 19, TypeScript, inline styles) in `frontend/`; FastAPI + SQLAlchemy + Alembic in `backend/`; PostgreSQL. Modular monolith. Core flow every change must fit: Customer, BD, R&D, Design/EHP, BOM, Store/Purchase, Production, QC, Dispatch, Commissioning, Machine, Service, Finance.

## How to work
- **S (1-2 files, known targets) = do inline.** No agents, no pipeline.
- **M/L (3+ files, new table, cross-module, approvals/money/permissions) = load skill `requirement-pipeline`** first. The main session is the Manager; agents live in `.claude/agents/`.
- Before git, agents, DB, deploy or UI work load the matching skill in `.claude/skills/` (git-version-control, agent-orchestration, database-engineering, frontend-development, backend-development, premnathrail-ui-behavior, release-management, devops-cicd).
- The user is learning ERP: justify fields/workflows, challenge wrong designs. Reply in the user's language (Hindi/English mix).

## Release and git
1. **Push to main = production deploy** (Dokploy autodeploys). Push only after the user's explicit yes in chat; never commit/push on your own.
2. Commit only this session's files, staged by explicit path. Never `git add -A` or `.`. Other sessions leave uncommitted work: files already modified at session start are protected, do not revert or stage them.
3. Scan `git diff --cached` for secrets before commit. Never write passwords, DB URLs, IPs, tokens into tracked files, docs, tests or commit messages. `.claude/`, `.env*`, zips, dumps are never committed.
4. `alembic heads` must show exactly one head; one migration per change, linear chain. After deleting/renaming a model fix `alembic/env.py` and `main.py` imports.
5. Local Python is 3.14, prod is 3.12: run `ruff check --select F821 --target-version py312 app alembic` and import every annotated type.
6. If CRM UI changed, update `frontend/src/lib/tour/configs/crm*.ts` before any push.
7. Dev servers (ports 3000/8000): when the user asks, start them yourself in the background (first check the ports so no duplicate binds). Never kill or restart a server the user started from their own terminal without asking.
8. Shared registries (`main.py`, `alembic/env.py`, `permission_registry.py`, `notification_events.py`, `lib/api.ts`, `types/index.ts`, `useAuth.ts`, Sidebar) are edited by the Manager only, re-read first, small Edits.
9. R&D calculator pages and their formulas are untouchable (`frontend/src/app/dashboard/rnd/` braking, qmax, tractive-effort, load-distribution, spline, vehicle-performance, hydraulic, history).

## UI rules
10. No `window.confirm/alert/prompt`; use ConfirmDialog / PromptDialog.
11. Every popup/dialog renders through `createPortal` to `body` (glass cards clip fixed overlays).
12. Module sub-nav renders above the page header block. Every "Back" is a `secondaryBtnStyle` pill "← Back", top-right in the header row.
13. All create/edit forms use the FormSheet popup standard (PM "Create Task"). Shared Select, never native `<select>`; same-height controls; "+ Add" is an icon button inside the field row, never a link under it.
14. Settings is the gear icon next to the bell, never a tab. Tables with a code/id load sorted ascending by default (backend `order_by` + frontend).
15. Error messages are real: reason + how to fix, never generic.
16. No SAP words, transaction codes or "info record" in any user-visible text.
17. Permission modules in the Role editor match UI modules (no phantom modules).

## Data rules
18. Page URLs use signed refs (`recordPath` / `useRecordId`), never raw ids.
19. PR/PO/GRN lines carry `store_item_id`; never match items by name.
20. Generated documents are managed Word docs ("Save & Edit in Word" primary, PDF secondary).
21. Every route has permission + data-scope checks (deny by default); approvals go through the central approval engine; Partners (`is_partner`) are the top approval.

## Pointers
- Skills: `.claude/skills/` (requirement-pipeline, agent-orchestration, task-planning-delegation, multi-agent-communication-shared-memory, release-management, git-version-control, application-security, erp-code-review, ...).
- Agent team: `.claude/agents/` (ba, architecture, uiux, frontend, backend, database, aiml, integration, security, qa, reviewer, accessibility, performance, compliance, documentation, whitehat, devops, monitoring).
- Docs: `docs/README.md`; ADRs in `docs/11-decisions/`; per-requirement run records in `docs/agent-runs/`.
- Personal rules (secrets, global git hygiene) live in the user's own `~/.claude/CLAUDE.md`; not repeated here.
- UI changes get a live check in the real browser with Playwright (qa/reviewer/accessibility/uiux agents) on localhost only; the owner signs in and unlocks, never type or store passwords.
