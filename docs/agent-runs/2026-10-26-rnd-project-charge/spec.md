# New development purchases are charged to an R&D project (Prototype / Research), not a Finance internal order

Owner request (2026-10-26): "On the PR, when purpose is New development, the requester should select the R&D prototype. In R&D prototypes nobody links Finance, so how would it work?"
Owner decisions (asked in chat): (1) the requester picks an **R&D Prototype / Research project** (`rnd_projects`, the record in R&D › Prototype / Research; it already has `budget_amount`); (2) Finance still sees the cost: **the system auto-creates one Finance internal order for the R&D project** the first time something is charged to it. No manual Finance step per project, requesters never see the internal order.
Size: L, cross-module (Procurement, R&D, Finance), one migration. Core-flow position: R&D → Store/Purchase → Finance.

## Business rule
- Purpose "New development" → Charged To = **R&D project** (required). The PR carries `rnd_project_id`.
- Behind the scenes the PR is also charged to that project's internal order (`internal_order_id`), so everything downstream that already follows `pr.internal_order_id` (PO draft copy in `routes/rfq.py`, Finance Controlling budget vs actual, journal lines) keeps working with no change.
- The internal order is created lazily and idempotently: `ensure_internal_order_for_rnd_project(db, project)` returns `project.internal_order_id` if set, else creates the order and stores its id on the project. Its fields: `code` = `IO-<project_number>` (unique; reuse the numbering helper used by Finance if any), `name` = `"<project_number> — <title>"`, `order_type` = `"development"` (new value), `budgeted_amount` = project.budget_amount, `start_date`/`end_date` = project start / target end, `status` `open`. When an R&D project's budget or dates change later and it has an internal order, keep the order's budget/dates in sync.
- Admin-editable purpose rules (Procurement › Settings › Purpose rules) may still allow `internal_order` / `work_order` for development: keep them valid alternatives, but the default and the first allowed kind for development becomes `rnd_project`.
- Only R&D projects that are not closed/cancelled/handed over can be picked.

## Data (database-agent, ONE migration)
- `rnd_projects.internal_order_id` INTEGER NULL, FK `internal_orders.id`, unique.
- `p2p_requests.rnd_project_id` INTEGER NULL, FK `rnd_projects.id`, indexed.
- `down_revision` = the single head at launch (`alembic heads` shows c9e5a3b7d2f4 now; re-check, the Manager re-chains if it moved). Provide upgrade AND downgrade. Models updated: `backend/app/modules/rnd/models/project.py`, `backend/app/modules/p2p/models/p2p_request.py`. No change to `alembic/env.py` (no new model file). Do NOT run `alembic upgrade` or touch any database.
- `InternalOrder` order types: add `"development"` to `INTERNAL_ORDER_TYPES` in `backend/app/modules/accounts/models/internal_order.py` and wherever the type is validated (accounts schemas) or listed in the Finance UI dropdown (`frontend/src/app/dashboard/finance/**`: find with Grep `capital`, `maintenance`, `training`; label "Development (R&D)").

## Backend (backend-agent)
Files: `backend/app/modules/p2p/{account_assignment.py,purpose.py,order_project_links.py,routes/p2p_requests.py,schemas/p2p_request.py,routes/purpose_rules.py}`, `backend/app/modules/rnd/{service.py or the project routes/schemas}`, `backend/app/modules/accounts/schemas/internal_order.py`, a new small helper module (suggested `backend/app/modules/rnd/internal_order_link.py`), tests in `backend/app/tests/`.
- New assignment kind `rnd_project` (label "R&D project") in `account_assignment.py` (kind→FK map `rnd_project_id`, closed statuses = closed/cancelled/handed over, `/p2p/account-assignment/options?kind=rnd_project` lists open R&D projects as `{id, label: "<project_number> — <title>"}` with `search`; return only id and label; same permission as the other kinds).
- `purpose.py`: `development` allows `("rnd_project",)` first, with `internal_order` / `work_order` kept in `VALID_CHARGED_TO`; hint text (line ~327) becomes: "the R&D project this development belongs to (R&D › Prototype / Research). Finance is linked automatically." Update the validators' error messages (real reason + how to fix, no SAP words).
- On create / update / submit of a PR with kind `rnd_project`: validate the project exists and is open, set `pr.rnd_project_id`, call `ensure_internal_order_for_rnd_project`, set `pr.internal_order_id` and `pr.account_assignment = "rnd_project"`. PO drafts keep copying `pr.internal_order_id` (no change needed in `rfq.py`; verify).
- `P2PRequestResponse` gets `rnd_project_id` and `rnd_project_label` (id, `"<number> — <title>"`).
- Data scope / permissions unchanged: every route keeps its checks; the options endpoint returns no budget figures.
- Tests: kind accepted only for development; lazy creation is idempotent (two PRs → one order); PR carries both ids; PO draft inherits the internal order; closed project refused with a clear message; purposes meta lists `rnd_project` for development; budget sync. Run `python -m pytest app/tests -k "purpose or account_assignment or p2p"` and `ruff check --select F821 --target-version py312 app alembic`.

## Frontend (frontend-agent)
Files: `frontend/src/app/dashboard/p2p/new/page.tsx` (and the PR edit page if separate), `frontend/src/app/dashboard/p2p/[id]/page.tsx` (Charged To display), `frontend/src/components/p2p/PurposeRulesCard.tsx` (kind label list), `frontend/src/lib/tour/configs/` PR-form tour, Finance internal-order type dropdown (`frontend/src/app/dashboard/finance/**` where order types are listed). Do not touch `types/index.ts` or `lib/api.ts` (Manager already added `rnd_project_id` / `rnd_project_label` to `P2PRequest`).
- On the PR form, purpose "New development": Charged To shows "R&D project" (fixed, set by purpose), and the picker below is **"R&D project *"** using the existing account-assignment options call with `kind=rnd_project`; placeholder "Search an R&D project"; hint "The R&D project this development belongs to (R&D › Prototype / Research). Finance is linked automatically — nothing to ask Finance." When the list is empty show "No open R&D project — ask the R&D head to create one in R&D › Prototype / Research." (no mention of Finance internal orders for this purpose). Required-field message: "Pick the R&D project this development belongs to."
- Submit/draft payload: `account_assignment: 'rnd_project'` and the existing id field the form already uses for the picked target, matching what the backend reads for that kind (read the page's current payload code for internal orders and follow it).
- PR detail page: "Charged to" shows `R&D project: <rnd_project_label>` when `rnd_project_id` is set.
- Keep every other purpose exactly as it is (customer order, machine project, department, capital, stock keep their pickers).
- Update the PR form tour text for the purpose / charged-to steps.

## Not in scope
Showing PR/PO spend on the R&D project page (later), backfilling internal orders for old R&D projects (lazy creation covers it), changing how Finance reports.

## Untouchable / shared
R&D calculator pages; `frontend/src/lib/api.ts`, `types/index.ts`, `hooks/useAuth.ts`, Sidebar, `dashboard/page.tsx`; `backend/app/main.py`, `alembic/env.py`, `permission_registry.py`, `notification_events.py`; git; dev servers; databases (no upgrade, no restore).

## Acceptance
- A requester raising a PR with purpose New development picks an R&D project and can submit; no Finance internal order is shown or needed.
- The first PR for a project creates exactly one internal order (type development, budget from the R&D project); later PRs reuse it; the PO draft carries it.
- Other purposes behave as before; old PRs unaffected; admin purpose rules still work.
- Alembic single head, one new migration with downgrade; ruff F821 py312 clean; targeted pytest green; `npx tsc --noEmit` clean; `npm run test:ui` 0 errors.

## Report format
Files changed, what each change does, commands run + results, migration revision id, anything kept or not done, findings with severity, and the honest line about what was not seen live.
