# Common brief for every builder (run 2026-10-30-rnd-rework-sales-removal)

Repo D:\Desktop\PremnathrailPortal-Ideal. Read in this order: requirement.md (owner decisions, all rounds),
architecture.md (v2, THE design: §1-§11), spec.md (acceptance criteria AC-n; §3A "products module" and AC-61 "Add Unit"
are SUPERSEDED by architecture v2: Products = CRM tab, no Units, project-level linking AC-61b).

Manager decisions on architecture §13: (1) drop CRM freeze by historic SO, keep delete guard; (2) R&D roles get
view-only on PM All Projects (Manager grants in migration via S1); (3) edit form keeps Finance budget link on existing
projects; (4) Products master has no owner data-scope (tab-gated); (5) optional CRM source on PM New Project = yes.
Earlier: prototypes not listed in PM All Projects; TO-/BTO- numbers auto; BD offer upload on inquiries + tenders;
Discussion removed on CRM side too; historic SOs stay billable via Finance bill-from-SO until closed — so DO NOT
delete accounts/routes/sales_billing.py bill-from-SO for historic orders; only remove "create new order" paths
(Manager overrides architecture §1.3 on this point: keep sales_billing route + Billing Due tab for historic SOs).

RULES
- Only edit files in YOUR FILES list. Read-only elsewhere. If you need a change in a file you don't own, put it in your report.
- Manager-only files (never edit; return exact snippets): backend/app/main.py, backend/alembic/env.py,
  core/permission_registry.py, core/audit_registry.py, core/jobs.py, core/sod_rules.py, modules/main/models/user.py,
  frontend/src/lib/api.ts, frontend/src/types/index.ts, frontend/src/hooks/useAuth.ts, frontend/src/components/Sidebar.tsx.
- Protected (another session's uncommitted work, never touch): backend/app/db/session.py, backend/app/middleware/error_handler.py,
  backend/app/modules/store/models/item.py, store/routes/item_import.py, store/routes/items.py, store/schemas/item.py,
  store/service.py, tests/test_store_items.py, frontend/src/app/dashboard/store/new/page.tsx. Other parallel sessions are
  ACTIVELY editing p2p and store files right now. Before editing ANY file run `git status --short -- <file>`: if it shows
  modified and you have not edited it yet in this run, it is protected — do not touch it; report the needed hunk instead.
- R&D calculator pages (rnd/{braking,qmax,tractive-effort,load-distribution,spline,vehicle-performance,hydraulic,history},
  ToolCalculatorPage, toolStyles, CalcResults) are untouchable.
- Edit with small anchored edits; re-read before editing; files have mixed CRLF/LF. No git write commands. Never start/stop
  servers. No secrets/IPs anywhere.
- Python 3.12 prod: import every annotated type; run `ruff check --select F821 --target-version py312 <your files>`.
- UI: no window.confirm/alert/prompt (ConfirmDialog/PromptDialog); popups via createPortal to body; FormSheet for create/edit;
  shared Select, never native <select>; real error messages (reason + fix); no SAP words; signed record links
  (recordPath/useRecordId); "← Back" secondaryBtnStyle pill top-right; settings = gear.
- Priority contract: backend app/core/priority.py (PRIORITIES=("standard","urgent"), parse_priority, map_legacy_priority,
  PRIORITY_RANK) and frontend src/lib/priority.ts (Priority type, PRIORITY_OPTIONS, priorityLabel, priorityTone, isUrgent)
  — S6 creates these first; other slices import them (assume these exact names).
- Tests: run targeted pytest for your area (`cd backend && python -m pytest -q -k <area>`), never the whole suite.

RETURN (final report only): 1) files changed/created/deleted (paths) 2) one line per change 3) commands + results
4) exact snippets for Manager files 5) migration revision id (S1 only) 6) findings Critical/High/Medium/Low with file:line
7) what you did NOT do / open questions.
