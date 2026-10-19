# Project Management module: overview

Last updated: 2026-10-06

## 1. What this module is for

Project Management tracks one customer or internal job from start to finish, across all the departments that work on it.

The idea in one line:

> **Project → Milestones (one per department) → Plan (by the department head) → Tasks (for team members)**

- The **Project Manager (PM)** creates the project and decides *what* each department must deliver and *by when* (milestones).
- Each **department head** decides *how* their department will do it (plan + tasks) and *who* does each task.
- **Team members** do their tasks and report progress.
- The PM checks each milestone when it is delivered, and closes the project at the end.

Project Management is standalone for now: it is **not connected** to Procurement, Store, CRM or Service. Customer name and customer PO / sales order number are plain text fields.

---

## 2. Structure

```
Project                       (owned by the Project Manager)
 ├── Milestone A → Design dept       (owned by the Design head)
 │     └── Plan
 │           ├── Task 1 → Ravi
 │           └── Task 2 → Priya
 ├── Milestone B → Electrical dept   (owned by the Electrical head)
 │     └── Plan
 │           └── Task 1 → Amit
 └── Milestone C → Production dept  (depends on A and B)
```

| Level | Owner | What it means |
|---|---|---|
| **Project** | Project Manager | The whole job: customer, dates, overall status |
| **Milestone** | One department | A result that department must deliver by a date, e.g. "GA drawing released by 15-11-2026" |
| **Plan** | Department head | How the department will achieve the milestone: the list of tasks |
| **Task** | One team member | One piece of work with a due date |

Rules behind the structure:
- A milestone belongs to **exactly one department**. If two departments are involved, make two milestones.
- A task belongs to **exactly one person**.
- A milestone has **exactly one plan**.

---

## 3. Who does what

| Role | Who it is in the portal | Where they work |
|---|---|---|
| **Project Manager** | The "Project Manager" field on the project (admins can act as PM) | Project Management → All Projects / My Projects → project page |
| **Department head** | A head set on the department in **Organization > Departments** | **Project Work** tab inside their own module (Design, Electrical, Hydraulic, Production, Quality, Maintenance, R&D), or Project Management → **Department Work** |
| **Team member** | Anyone a task is assigned to | **Project Work** tab in their module, or Project Management → **My Tasks** |
| **Director / MD** | Users with the Director or MD flag | Nothing to do day to day. They are only alerted when a milestone is more than 7 days late |

Department heads and team members **do not need** the Project Management app. They only see their own department's milestones and their own tasks.

---

## 4. The workflow, step by step

| # | Who | What they do | Screen | Status after |
|---|---|---|---|---|
| 1 | PM | Creates the project | Project Management → New Project | Project: **Draft** |
| 2 | PM | Adds milestones: department, target date, deliverable, depends on | Project → Milestones tab → + Add Milestone | Milestone: **Assigned** |
| 3 | PM | Clicks **Start project**. Department heads are notified | Project page, top right | Project: **Active** |
| 4 | Dept head | Opens the milestone and **accepts** it, or asks for a different date | Project Work → milestone | Milestone: **Accepted** |
| 5 | Dept head | Creates the plan and adds tasks: assignee, dates, hours, order, review Yes/No | Milestone page → Create plan → + Add task | Plan: **Draft** |
| 6 | Dept head | **Submits the plan** to the PM | Milestone page → Submit plan | Plan: **Submitted** |
| 7 | PM | **Approves** the plan, or sends it back with a reason | Milestone page → Approve plan | Plan: **Approved**, Milestone: **In progress**; tasks now appear for the team |
| 8 | Team member | Starts the task, logs progress and hours, flags blockers | My Tasks → task | Task: **In progress** / **Blocked** |
| 9 | Team member | Completes the task | Task page | Task: **Submitted for review** (if review required) or **Done** |
| 10 | Dept head | Reviews: approves, or sends back with a reason | Department Work → "Waiting for your review" | Task: **Done** / **Reopened** |
| 11 | Dept head | When all tasks are done, **submits the milestone** with a handover note | Milestone page → Submit milestone | Milestone: **Submitted** |
| 12 | PM | **Verifies** the deliverable: achieved, or send back | Milestone page → Verify | Milestone: **Achieved** |
| 13 | PM | When all milestones are achieved: **Technically complete**, then **Close** | Project page, top right | Project: **Technically complete** → **Closed** |

### Why Draft exists
While the project is a Draft, only the PM sees it. The PM can add, change and delete milestones freely. Departments are not disturbed until the PM clicks **Start project**, so they only see work that is final.

### Task review is optional
Each task has a **Review required** (Yes/No) tick, set by the department head when creating the task.
- **Yes:** when the team member finishes, the task goes to the head, who approves it or sends it back.
- **No:** the team member marks it Done directly; the head only gets a notification.

Each department can set a default ("New tasks need my review by default") on the Department Work page.

---

## 5. Statuses

### Project
| Status | Meaning |
|---|---|
| Draft | Being prepared. Only the PM sees it |
| Active | Started. Departments are working |
| On hold | Paused. All work is frozen and every department sees the reason |
| Technically complete | Every milestone achieved. No more work can be recorded |
| Closed | Finished, with lessons learned recorded |
| Cancelled | Stopped, with the reason recorded. History is kept |

### Milestone
| Status | Meaning |
|---|---|
| Assigned | PM gave it to a department; waiting for the head to accept |
| Accepted | Head agreed to the date and scope; planning |
| In progress | Plan approved; the team is working |
| Submitted | Department says it's done; waiting for the PM to verify |
| Achieved | PM verified it. The actual date is recorded |

**Overdue** and **At risk** are warning flags, not statuses. The system calculates them:
- **Overdue:** the target date has passed and the milestone is not achieved.
- **At risk:** not overdue yet, but at least one task is blocked or late.

### Plan
| Status | Meaning |
|---|---|
| Draft | Head is adding and editing tasks |
| Submitted | Waiting for PM approval; locked |
| Approved | Baseline set; tasks released to the team |

**Revise plan:** the head can reopen an approved plan as a new revision (Rev 1, Rev 2, …) to change dates or scope. Tasks already given to the team keep running meanwhile. The PM approves the revision.

### Task
| Status | Meaning |
|---|---|
| Not started | Assigned, not begun |
| In progress | Being worked on |
| Blocked | Stuck. The reason is shown to the head |
| Submitted for review | Finished; waiting for the head (only when review is required) |
| Done | Complete |
| Reopened | Sent back by the head, with a reason |
| Cancelled | No longer needed. History is kept |

---

## 6. Fields

### Project
| Field | Why |
|---|---|
| Project code | Auto: PRJ-YEAR-NUMBER |
| Name, description, scope, objectives | What the job is |
| Client name, Customer PO / Sales order ref | Who it's for (plain text for now) |
| Project type, category, priority | Grouping and sorting |
| Start date, end date | Every milestone must fall inside these dates |
| Project Manager | The person who runs the project |

### Milestone
| Field | Why |
|---|---|
| Title | The **result**, e.g. "GA drawing released", not the activity |
| Department | The single owner |
| Target date | Delivery date. After the department accepts, it can only change through a date change request |
| Deliverable / acceptance criteria | What must be handed over and how the PM will judge it done |
| Depends on | Another milestone that must be achieved first |

### Task
| Field | Why |
|---|---|
| Title, description | The work |
| Assignee | The one person doing it |
| Start date, due date | Due date must be on or before the milestone date |
| Estimated hours | Effort; also weights the progress roll-up |
| Can start after | Task order: it can't start until that task is done |
| Review required | Whether the head checks it before it counts as done |
| Priority | Low / Medium / High / Critical |

### Task update (logged by the team member)
Progress %, hours spent, comment. Every status change is also logged with who and when.

---

## 7. Rules the system enforces

1. Each milestone has one department; each task has one assignee.
2. A department must have a head before it can get a milestone.
3. Departments see a project only after the PM starts it.
4. A department head sees only their own department's milestones. A team member sees only their own tasks, and only after the plan is approved.
5. Task due dates must be on or before the milestone date. A plan can't finish after the milestone date.
6. A task that depends on another can't start until that one is done.
7. A plan for a milestone that depends on another milestone can only be approved after that one is achieved, unless the PM ticks "override".
8. Once a department accepts a milestone, its date and department can't be edited. The date changes only through a **date change request**: the head asks, the PM approves or rejects.
9. A milestone can be submitted only when all its tasks are done, and only with a handover note.
10. The project can be marked technically complete only when every milestone is achieved.
11. On hold freezes everything: no one can start, update or complete tasks.
12. Only Draft projects can be deleted; after that, cancel instead, so the history is kept.
13. Every change is recorded in the history with who and when.

### Progress roll-up
- Task progress = the % the team member logs (Done = 100%).
- Milestone progress = average of its tasks, weighted by estimated hours.
- Project progress = average of its milestones.

These are calculated automatically; nobody types them in.

---

## 8. Notifications

| Situation | Who is told | Teams too? |
|---|---|---|
| Project started (and later new milestones) | Department head | No (bell only) |
| Date change requested | PM | Yes (approval) |
| Plan submitted | PM | Yes (approval) |
| Plan approved / sent back | Department head | No |
| Plan approved: new task | Team member | No |
| Task blocked | Department head | No |
| Task submitted for review | Department head | Yes (approval) |
| Task done without review | Department head | No |
| Task approved / reopened / reassigned / cancelled | Team member | No |
| Milestone submitted | PM | Yes (approval) |
| Milestone achieved / sent back | Department head | No |
| Project on hold / resumed / cancelled | Heads + assignees | No |

**Daily reminders at 9:15 AM** (Teams too), only for Active projects:
- Task due tomorrow → team member
- Task overdue → team member; from the 2nd day late, also the department head
- Milestone at risk → department head + PM (at most once a week)
- Milestone overdue → PM every day; after 7 days late, also every Director/MD

---

## 9. Screens

### Project Management menu
| Tab | Who | What |
|---|---|---|
| Dashboard | PM | Count of projects by status |
| All Projects / My Projects | PM | Project lists |
| Department Work | Dept heads | Your department's milestones across all projects, tasks waiting for your review, team's open tasks, team workload |
| My Tasks | Everyone | Your tasks: Overdue / Due today / Upcoming |
| Project Reports | PM | Breakdown by status and priority |

### Project page tabs
| Tab | What it holds |
|---|---|
| Overview | Summary |
| Details & Scope | Project fields (PM edits) |
| Planning | Phases (optional grouping of milestones) |
| Tasks | Read-only view of all tasks across departments (PM's overview) |
| **Milestones** | Milestones per department, status, plan status, progress, **"waiting on"** (who must act next) |
| Budget & Cost | Budget lines and actual cost entries |
| Resources | People allocated to the project |
| Deliverables | Formal deliverable register |
| Documents | Project files (SharePoint) |
| Issues / Risks | Issue and risk registers |
| Changes | Change requests, including milestone date changes |
| Approvals | General approval records |
| Project History | Full audit log |
| Activities, Meetings, Reports, Closure | Not built yet |

### Milestone page (shared by PM and department head)
Shows the milestone details, a **"Next step"** box with only the buttons that person can use right now, the plan with its tasks, and any date change requests.

### Task page
Task details, the action buttons (Start, Log update, I'm blocked, Complete / Approve / Send back), and the full history.

---

## 10. One-time setup

1. **Organization > Departments:** every department that will get milestones must have a head.
2. **Users & Roles:** give the Project Management app to people who will be PMs. Department heads and team members don't need it.
3. **Module lock:** Project Management is currently locked to Azure admins only (`backend/app/core/module_visibility.py`). Remove `"projects"` from that list to open it to users.

---

## 11. Known gaps / not built yet

- No file attachments on tasks yet. The milestone handover note can point to a document or drawing number.
- No links to Procurement, Store, CRM or Service, on purpose for now.
- The **Deliverables** tab (formal register) and the milestone's **Deliverable** field overlap. Decide if both are needed.
- Activities, Meetings & Communication, Reports and Closure tabs are placeholders.
- No Gantt chart / timeline view yet.
- No timesheet approval; logged hours are taken as entered.
