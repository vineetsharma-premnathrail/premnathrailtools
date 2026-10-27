# R&D (non-calculator) + Project Management — audit 2026-10-27

## High
1. **Self-approval of R&D task requests:** rnd/services/task_approvals.py:44 `decide()` never checks that the decider is not the requester. An assignee who is also a lead or head can ask for a deviation and then approve it. Fix: return 403 when user == requested_by, and refuse the request when no other reviewer exists.
2. **R&D project delete ignores live work:** rnd/routes/projects.py:358-383 checks only experiments, prototypes and docs, not open tasks or milestones. Tasks vanish from My Tasks and pending approvals are stranded. Fix: block the delete while tasks or milestones exist.
3. **Closed or cancelled R&D projects still accept work:** project_tasks.py:61 and project_milestones.py:54 have no project-status guard. Fix: add `_require_project_open` to every task and milestone mutation.
4. **R&D status change bypasses approve and leaves work open:** projects.py:286-330 lets PATCH status=cancelled/completed go through with the Edit right only, and nothing cascades. Fix: a dedicated action that needs the Approve right and cancels tasks, milestones and approvals.
5. **PM project cancel leaves the WBS approval request live in the engine:** projects/routes/project.py:487-497. Fix: call `pm_access.cancel_live` for each cancelled WBS.

## Medium
6. R&D extend and reopen of a task skip the milestone-end and parent-task due-date checks (project_tasks.py:358, :519; requirement_work.py:825).
7. PM handover-date check uses the retired WBS table instead of the new milestones (project.py:363-368).
8. PM milestone dates are not tied to project dates, and the due date can move before its sub-tasks (project_tasks.py:666, :710, :748).
9. R&D project dates can shrink below its milestones (projects.py:315).
10. PM "On hold" does not freeze work, although the UI says it does (project_tasks.py:49 OPEN_PROJECT includes on_hold).
11. The PM "mark milestone done" right is enforced only for PM-role users, so others bypass it (project_tasks.py:881-889). Verify against intent.
12. Typed PEW numbers are not under the advisory lock. Two projects can get the same PEW, and a duplicate gives a raw 500 (core/pew_numbers.py:121, project.py:45).
13. R&D task approvals live outside the central approval engine (rule 21) — verify the owner's intent.
14. R&D project history shows every task and its remarks to anyone in scope (project_milestones.py:388).
15. The R&D Documents list and content need no Documents tab right (documents.py:83, :174).
16. Removing a team member who holds open R&D tasks orphans those tasks (projects.py:303-321).
17. A PM milestone owner can tick tasks they cannot open (project_tasks.py:271 vs :1102).

## Low
18. Lists are not sorted by code ascending: PM All Projects, Order Projects (also limit truncation), R&D Projects, Prototypes, Experiments, Documents.
19. Inconsistent status codes (400 where 409/422 is meant) in R&D.
20. The milestone 403 reveals the owner's name, and the record is serialised before the access check (project_tasks.py:838).
21. Leftover WBS routes: project `complete` still requires WBS elements, so "Mark technically complete" fails on new-style projects (project.py:450).

Frontend rules (dialogs, select, portal, signed links, Back pill, gear): clean.
