# Final report — R&D tasks on All Projects + Project Tasks overview tab (2026-11-03)

Status: built, tested, reviewed, NOT committed / NOT pushed (owner's yes needed). Local DB upgraded to `c7e3a9d1f2b4`. Not seen live (dev servers were not running).

## What changed
Backend
- `rnd/models/project_task.py`, `rnd/models/document.py`, migration `c7e3a9d1f2b4` (revises `a4e7c1b9d306`): `pm_project_id` on `rnd_project_tasks` and `rnd_documents`, `project_id` nullable, CHECK constraints.
- `rnd/routes/project_tasks.py`: `TaskParent` (R&D project or PM project), `pm_manages()`, gated `_pm_parent`, routes `GET /rnd/pm-projects/{id}/task-access`, `GET/POST /rnd/pm-projects/{id}/tasks`; task-level routes resolve the parent via `_parent_of`; closed/cancelled projects refused; notifications use entity `rnd_pm_project`.
- `rnd/routes/tasks.py`: type `project`, `GET /rnd/tasks/pm-project-options`, assignees for type=project, filter `pm_project_id`.
- `rnd/services/task_board.py`: board rows of type `project` with parent kind `pm_project`.
- `rnd/routes/documents.py`: download/delete rules for PM-task files. `rnd/schemas/document.py`: nullable project_id.
- `projects/history.py`: `task_history()` now lists real tasks (`pm_task_subtasks` top level + R&D tasks) — the earlier version listed milestones (`pm_project_tasks`) under the name "Tasks".
- `projects/routes/project.py`: delete guard counts R&D tasks (one hunk).
- Tests: `test_rnd_task_board.py` (+3 tests), `test_project_history_tabs.py` (world + task-history test).
Frontend
- `types/rndIntake.ts`, `types/index.ts`, `lib/api.ts` (rndApi.pmProjectOptions / pmProjectTaskAccess / listPmProjectTasks / createPmProjectTask).
- `components/rnd/TaskCreateSheet.tsx` (Project type), `app/dashboard/rnd/tasks/page.tsx` (All Projects filter, open), NEW `app/dashboard/rnd/project-tasks/[id]/page.tsx` (work surface, TasksBoard), `components/rnd/RndTaskAnalytics.tsx` (pill), `components/projects/ProjectHistoryTables.tsx` (Tasks table + read-only popup), `components/erp/NotificationBell.tsx` (link), `lib/tour/configs/rndTasks.ts`.

## Checks
- pytest: test_rnd_task_board 12 passed; history tabs 13 passed; wider R&D + projects lifecycle set 88 passed / 1 xfailed (pre-existing).
- `ruff --select F821 --target-version py312 app alembic`: clean. `alembic heads`: one head `c7e3a9d1f2b4`.
- `npx tsc --noEmit`: 0 errors. `npm run test:ui`: 0 errors / 0 warnings.
- Security + reviewer findings: see findings.md (all Critical/High/Medium fixed; 3 Low/Info open, pre-existing or informational).

## Not done / owner decisions
- Live browser check (Playwright) not run: servers were down. Screens to look at: Create Task → Project; R&D Tasks filter "All Projects"; `/dashboard/rnd/project-tasks/<ref>`; PM project › Tasks tab + popup (1366 and 390 px).
- The machine page (Past Projects) Tasks tab uses the same table, so it now shows tasks (not milestones) too.
- Commit note: my migration revises `a4e7c1b9d306`, which is another session's untracked file — it must be committed first/together. `api.ts`, `rndIntake.ts`, `history.py`, `test_project_history_tabs.py`, `routes/project.py` carry other sessions' hunks.
