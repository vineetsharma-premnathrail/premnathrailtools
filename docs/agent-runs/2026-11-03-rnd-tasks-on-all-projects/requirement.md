# R&D tasks on All Projects + Project Tasks overview tab

Date: 2026-11-03. Size: M. Core-flow position: R&D ↔ Project Management.

## Requirement (owner, in chat)
1. R&D › R&D Tasks › Create Task can also give a task on a project from Project Management › All Projects (PEW projects), not only on a requirement or a Prototype / Research project.
2. Project Management › project page › Tasks tab: one table with every task of the project (PM tasks inside milestones + R&D tasks on the project). A row opens a read-only view. No edit, no delete there.

## Decisions (Manager, ERP-standard)
- An R&D task on a PEW project keeps the R&D task flow (checklist, updates, approval requests, complete, reopen) — it is R&D work, tracked on the R&D board. Stored in `rnd_project_tasks` with a new nullable `pm_project_id`; `project_id` becomes nullable; CHECK exactly one parent.
- Who can give such a task: admin, R&D head, or the PEW project's management / project manager (wf.can_manage). Reviewer = creator, admin, R&D head, project manager.
- Who can be assigned: any active person with R&D access, narrowed by the role's "Assign to" rule (same as requirement tasks).
- Task files: `rnd_documents.project_id` becomes nullable, `pm_project_id` added; download allowed to the task's assignee/creator/reviewers.
- Work surface for the assignee: new R&D page `/dashboard/rnd/project-tasks/[ref]` (same TasksBoard). The R&D board opens it; the PM page never edits.
- PM Tasks tab lists real tasks: `pm_task_subtasks` (top-level) with their milestone + R&D tasks with `pm_project_id`. The earlier list showed milestones (`pm_project_tasks`) under the name "Tasks" — corrected. Read-only popup (FormSheet via portal).
- No new permission feature: PM tab keeps `projects:project_history.task_history`; R&D board keeps `rnd:tasks`.
