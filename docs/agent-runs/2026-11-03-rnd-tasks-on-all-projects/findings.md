# Findings (review wave 2026-11-03)

Agents: security-agent, reviewer-agent (static; servers not running, no live check). Frontend built by frontend-agent.

| # | Severity | Finding | Status |
|---|---|---|---|
| S-M1 / R-3 | Medium | Any R&D user could read PM project code/name/client + R&D people via `/rnd/pm-projects/{id}/task-access` (no gate in `_pm_parent`). | Fixed: `_pm_parent` opens only for admins, R&D department heads (no "everyone" fallback), the project manager, management in scope, or someone holding/giving a task on it; otherwise 404. Test added. |
| S-M2 | Medium | Management users bypassed the PM data scope the picker applied. | Fixed: shared `pm_manages()` used by picker and parent (management needs the project in scope). |
| S-M3 / R-5 | Medium | Assignee/creator could delete PM-task files (lead check skipped when project_id NULL). | Fixed in `documents.delete_document`: managers only. |
| R-1 | High | Picker filtered in Python after `limit(300)`/`[:100]`; projects beyond the cap unreachable. | Fixed: manager filter in SQL, cap 2000, no 100 cut. |
| R-2 / S-L5 | Medium | A person without the R&D › Prototype / Research tab could be assigned and then could not work the task. | Fixed: `_rnd_people_ids` requires the tab; `_check_assignee` explains the fix; page hint corrected. |
| R-4 | Medium | `_pm_parent` loaded every user on every task action. | Fixed: `member_ids` is lazy (computed only for create/edit/access). |
| R-6 | Medium-Low | Bell linked PM-task notifications to the PM project page. | Fixed: entity_type `rnd_pm_project` → `/dashboard/rnd/project-tasks/<ref>` in NotificationBell. |
| R-7 | Low-Medium | Tasks could be created on closed/cancelled projects via the API. | Fixed: 422 with reason. Test added. |
| R-8 | Low-Medium | Deleting a Planning PM project with R&D tasks hit the FK. | Fixed: delete guard counts R&D tasks (small hunk in `projects/routes/project.py`, another session's staged file). |
| R-9 / S-L3 | Low | Downgrade left approval rows; rnd_documents had no parent CHECK; dead `_project()`. | Fixed all three. |
| R-10 | Low | `RndTask.source` union, `RndDocumentResponse.project_id` nullable. | Fixed. |
| S-L1 | Low | `ra.head_ids` falls back to every R&D user when no department head is set. | Fixed for PM parents: `org_head_ids` only (admins + project manager otherwise). |
| S-L2 | Low | Self-approval possible on task approval requests (pre-existing, all task kinds). | Open — not in scope; worth a separate small change. |
| S-L4 | Low | Blob URL opened for any file type (pattern copied from the R&D project page). | Open — pre-existing pattern. |
| R-11 | Info | A user with "All R&D tasks & analytics" sees PM-project rows on the board but the project page lists only their own tasks unless they manage it. | Open — same as before for non-team users; mention to owner. |
| R-12 | Info | Staging by path would include other sessions' hunks in `api.ts`, `rndIntake.ts`, `history.py`, `test_project_history_tabs.py`; my migration chains on the untracked `a4e7c1b9d306` from another session. | Release note: commit together or `git add -p`. |
