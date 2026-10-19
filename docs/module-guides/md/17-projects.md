# Project Management Module

The Project Management module tracks one customer order (for example PEW-39) from the day management opens it to the day it is closed. A project has a code, a name, a client, a project manager and two dates (start and closing). The project manager gives **department tasks** to departments (Design, R&D, Purchase, Production and so on), each with a due date. The head of each department can split a task into **sub-tasks** for their own people, and everyone works the task from the **Ongoing Projects** page, which every signed-in user can open from the left sidebar. Progress is never typed in: it is worked out from the tasks and sub-tasks that are done. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) the module sits alongside the whole flow as the coordination layer for one order. It hands work to each department in turn and shows management where every order stands. It is deliberately standalone: it does not create records in other modules. Design records (BOMs, design requests, design documents, submissions, ECR/ECN) can carry a reference to a project, but that link is made from the Design side.

Note on older features: earlier versions of the module used **WBS elements** (also called milestones) that ran in a strict step order, with team chat, evidence uploads and an acceptance step. The project screen no longer shows WBS. The old WBS, task-detail, Department Board, Department Work and My Tasks pages still exist and open from direct links and old notifications, so they are documented at the end of Section 3 under "Older pages".

## 1. Navigation Tabs

The module sub-nav (ProjectsNav) appears at the top of every Project Management page. It shows only the tabs below, and only to users who have the Project Management app and View access on that tab. A guided-tour button and the notification bell sit on the right of the sub-nav.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/projects | Projects Dashboard: three counters and the list of every open project, nearest handover first |
| All Projects | /dashboard/projects/all | Full list of projects with search and status filter, plus the "+ New Project" button for management |

Separate entry in the main left sidebar (not in the sub-nav):

| Sidebar link | Route | What it opens |
|---|---|---|
| Ongoing Projects | /dashboard/ongoing-projects | Every running project and the department tasks it has. Visible to every signed-in user, with or without the Project Management app |

Older module links such as /dashboard/design/ongoing-projects, /dashboard/rnd/project-work, /dashboard/electrical/project-work, /dashboard/hydraulic/project-work, /dashboard/maintenance/project-work, /dashboard/p2p/project-work, /dashboard/production/project-work, /dashboard/quality/project-work and /dashboard/store/project-work now redirect to /dashboard/ongoing-projects. If a project reference (?id=) was in the link, it is kept.

## 2. Dashboard

Route: /dashboard/projects. The page needs the Project Management app and View on Project Management › Dashboard. Title: "Projects Dashboard", with the subtitle "Every open project, nearest handover first."

Data comes from the backend dashboard call. It returns every project in status Planning, Active, On hold or Technically complete, limited to the user's data scope. The screen sorts these by target handover (closing) date, earliest first. Projects with no date go last.

### KPI counters

Three cards across the top:

| Card | What it shows | How it is computed |
|---|---|---|
| Open projects | Number of live projects | Count of all projects returned (Planning, Active, On hold, Technically complete) |
| Handover in next 30 days (amber) | Projects due soon | Projects whose target handover date is today or within the next 30 days |
| Handover date passed (red) | Late projects | Projects whose target handover date is before today |

**Actions:** none. The cards are display only.

### Open projects

A table of every live project.

| Column | What it shows |
|---|---|
| Code | Project code (bold) |
| Project | Project name |
| Customer | Client name, or a dash |
| Status | Coloured status pill (see the status labels in Section 3) |
| Project manager | Name of the project manager |
| Target handover | Closing date. If the date has passed it is shown in red with "· passed" after it |

When there are no live projects the card says "No open projects."

**Actions:** clicking any row opens that project's workspace (/dashboard/projects/<signed reference>).

The backend also returns overdue WBS by department, WBS awaiting acceptance and blocked tasks. The current dashboard screen does not show these.

## 3. Screens

### All Projects (/dashboard/projects/all)

Needs the Project Management app and View on Project Management › All Projects. The heading reads "Project Management / All Projects".

#### List view

| Column | What it shows |
|---|---|
| Code | Project code (bold) |
| Project | Project name |
| Customer | Client name, or a dash |
| Status | Status pill: Open, Active, On hold, Technically complete, Closed or Cancelled |
| Project manager | Project manager's name, or a dash |
| Target handover | Closing date |

- **Search box** ("Search code, name or customer…"): matches part of the project code, name or client name. It is case-insensitive and runs 250 ms after you stop typing.
- **Status filter**: "All statuses", Open, Active, On hold, Technically complete, Closed, Cancelled.
- **Sort**: newest project first (by creation time).
- **Data scope**: the list only includes projects inside the user's data scope.
- **Row action**: click a row to open the project workspace.
- **Top button "+ New Project"**: shown only when the server says the user may create projects (management, see Section 5). It opens /dashboard/projects/new.
- Empty result: "No projects match."

### New Project (/dashboard/projects/new)

Needs the Project Management app. Header "New Project", with the help text "Name, client and timeline. Then open the project…". A "← Back" button at the top right returns to the previous page.

If the user is not management, the form is replaced by a warning: "Only authorised management can create projects — Partners, Directors, or users an admin grants 'Project Management › All Projects › Create' in Users › Permission Matrix."

#### Create form

The main fields come first. Code, project manager and scope sit under a "▸ More details (code, project manager, scope)" link that expands them.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project name | text | Yes | Free text, e.g. "CAM Injection Car for IRCON MAHSR-T2" | Cannot be blank ("Project name is required.") |
| Client | text | Yes | Free text, e.g. "IRCON International Limited" (not linked to the CRM customer master) | Cannot be blank ("Client is required.") |
| Start date | date | Yes | Date picker | Required |
| Closing date | date | Yes | Date picker. This is stored as the target handover date | Required. Cannot be before the start date ("Closing date is before the start date.") |
| Project code (under More details) | text, typed in capitals | No | Free text, e.g. PEW-39 | If blank, the server gives the next number in the form PRJ-<year>-NNNN (e.g. PRJ-2026-0001). Must be unique. A clash gives "Project code X is already used by '<name>'. Use a different code (e.g. XA for a second machine)." |
| Project manager (under More details) | searchable dropdown | No | Active users from the user directory, shown as "Name — Designation" | If blank, the person creating the project becomes the project manager. The chosen user must exist and be active |
| Description / scope (under More details) | multi-line text | No | Free text ("What is being delivered") | None |

Buttons: **Cancel** goes back. **Create project** checks the fields, creates the project and opens its workspace.

What happens on create:
- Status is set to Planning, which the screen shows as "Open". Priority defaults to Medium. The form does not show priority.
- A History entry "Project <code> (<name>) created by <user>." is written.
- The project manager gets a bell notification: "You are project manager".

### Project workspace (/dashboard/projects/<signed reference>)

Needs the Project Management app and View on Project Management › All Projects. The page link uses a signed reference. If the link has been edited by hand, an "Invalid link" message appears with "Back to projects".

#### View page

**Header card**

| Field | Meaning |
|---|---|
| Project code | Small caption above the name |
| Project name | Page title |
| Status pill | Shown for every status except Planning ("Open" needs no badge) |
| Header line | "<Client> · PM <project manager> · Handover <closing date>" |
| ← Back | Top right; returns to All Projects |

Header action buttons appear only for users who can manage the project (management or the project's own project manager) **and** have Edit on Project Management › Overview:

| Button | When it appears | What it does |
|---|---|---|
| Release project | Status is Planning **and** the project already has WBS elements (older projects only) | Asks for confirmation, then moves the project to Active and notifies every WBS department head and assistant |
| Resume | Status is On hold | Asks for confirmation ("Resume the project? Departments can work on their tasks again."), then moves the project to Active |
| Delete | User can manage the project, has delete rights on All Projects for this record, status is Planning, and the project has no WBS elements | Asks for confirmation ("Delete <code>? It has no WBS elements yet, so nothing else is lost.") and then deletes the project. Returns to All Projects |

Notices under the header:
- Technically complete: an information note saying every WBS is accepted and pointing to closure on the Overview tab.
- On hold: "On hold: <reason>".
- Cancelled: "Cancelled: <reason>".

**Tabs** (each shows only if the user has View on its permission key):

| Tab | Permission key used |
|---|---|
| Overview | projects › overview |
| Tasks | projects › overview (same key as Overview) |
| Documents | projects › documents |
| History | projects › project_history |

If the user can see none of the tabs, a warning says so and tells them to ask an admin for View in Organization › Role & Permissions. Older links with ?tab= set to a removed tab (WBS, Discussions, Activity Log) open Overview.

#### Overview tab

**Project details** card:

| Field | Meaning |
|---|---|
| Customer | Client name |
| Project manager | Owner of the project |
| Start date | Planned start |
| Released | Date and person who released the project to departments (older projects with WBS only) |
| Created by | Person who created the project |
| Closed | Closure date and the person who closed it (shown only once closed) |
| Description / scope | Free-text scope |

**Edit** button: shown when the user can manage the project, has Overview › Edit, the project is not Closed or Cancelled, and the card is not already in edit mode.

**Project closure** card: shown only when the project is **Closed**, as a read-only record of the closure:
- Text: "Closed <date> by <name>." It also shows "Technically complete since <date>" if that date exists.
- Closure checklist rows with a tick, a cross or "!" (advisory):
  - Every WBS accepted (only for projects that have WBS)
  - No open tasks
  - Deliverable evidence on every WBS (advisory, only for projects that have WBS)
  - Final Project Report created
  - Project documents archived, with who confirmed it and when
- **Final Project Report**: the managed Word document panel (see Section 6). On a closed project it can be downloaded and its history viewed, but not changed.
- Closure note and Lessons learned, shown as read-only text.

#### Edit (Overview › Edit)

The same project form opens with every field visible and these differences:

| Field | Editable? |
|---|---|
| Project name, Client, Start date, Closing date, Description | Yes, while the project is not Closed or Cancelled |
| Project code | Required. It can only be changed while the project is in Planning ("Open"). After that the box is greyed out with the note "Fixed once the project is released — departments know it by this code." |
| Project manager | Required ("Project manager is required — one person owns the project.") |

Server rules on save:
- Name and client cannot be emptied.
- The closing date cannot be before the start date.
- If the project has WBS elements, the closing date cannot be moved earlier than any WBS due date ("Move that WBS first, or pick a later handover date").
- On a Closed or Cancelled project, only the closure note and lessons learned can still change.
- Each changed field writes a History entry showing the old and new value.
- If the project manager changes, the new PM gets the "You are project manager" bell notification.

Buttons: **Cancel** and **Save**.

#### Tasks tab

Heading "Department tasks". When tasks exist, a summary line reads "<done> of <total> done · <open> open · click a task to see its sub-tasks", with a progress bar.

- **Project progress** is the average of each task's progress. Cancelled tasks are not counted.
- **Task progress** is 100% when the task is Done. Otherwise it is the share of its sub-tasks that are ticked, or 0% if there are no sub-tasks.

**List view (department task table, project-manager mode)**

| Column | What it shows |
|---|---|
| ▸ / ▾ | Expand or collapse the row |
| Task | Task name. Below it: "Cancelled: <reason>" or "Reopened: <reason>" when relevant, and counters such as "2 remarks · 1 file" |
| Department | The department that owes the task |
| Due | Due date (red when overdue) |
| Status | Task status pill, plus a red "Overdue" flag when the due date has passed and the task is still open |
| Progress | Progress bar and "x / y sub-tasks" or "No sub-tasks" (a dash for cancelled tasks) |
| Actions | Edit, Reopen, Cancel (see below) |

Row actions (the buttons follow what the server allows):
- **Edit**: task is open (To do, In progress or Blocked), the project is open, and the user can manage the project. Opens the Edit task popup.
- **Reopen**: task is Done. Asks for a reason ("Why is '<task>' being reopened? The department will see this."). The task goes back to In progress with the reason shown.
- **Cancel**: task is open. Asks for a reason. The task becomes Cancelled.

Expanded row:
- The task description.
- Sub-tasks, read-only in this mode. Each shows a tick or circle, the name (struck through when done), the assignee and "Due <date>". Clicking a sub-task opens its own remarks and attachments.
- A "Whole task" section with **Remarks** and **Attachments** for the task itself (see "Remarks and attachments" below).

**+ Add task** button (top right): shown when the user can manage the project and the project is not Closed or Cancelled.

#### Create form (Add task / Edit task popup)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Task | text | Yes | e.g. "GA drawing and main BOM" | Cannot be blank |
| Department | searchable dropdown | Yes | Every department, shown as "Name — head names" or "Name (no head set)" | The department must have a head, or the server refuses: "<Dept> has no department head, so nobody would receive the task. Set a head in Organization › Departments first." On edit, the task cannot move to another department once that department has added sub-tasks |
| Due date | date | Yes | Date picker | Required. It cannot be removed on edit |
| Remarks / details | multi-line text | No | "What the department must hand over…" | Stored as the task description |
| Attachments | file picker (multiple) | No | Up to 10 files, shown as removable chips | Uploaded to SharePoint after the task is saved. If the upload fails, the task stays saved and a message says to attach the files again from the task |

What happens on save:
- A new task starts in To do with priority Medium.
- A History entry is written ("Task '<title>' given to <dept>, due <date>, by <user>.").
- The department's head(s) get a bell notification: "New task for your department".
- If an edit moves the task to a different department, the new department's heads are notified.
- A Done or Cancelled task cannot be edited: "Reopen it first to change it."

#### Documents tab

A read-only list of every file attached to the project's tasks and sub-tasks. Files are uploaded on the task itself, not here.

- **Department filter** (shown when any file has a department): "All departments" or one department, with a "<n> file(s)" count.
- Files are grouped:

| Group | What it lists | Shown when |
|---|---|---|
| Task documents | Files attached to department tasks or sub-tasks. Each line reads "Department · Task title · file title" | Always. When empty: "No documents attached on tasks yet — attach files on a task or sub-task in the Tasks tab." |
| Project documents | Files uploaded directly on the project in earlier versions | Only when files exist and no department filter is chosen |
| WBS evidence | Evidence files from older WBS elements | Only when files exist |
| Sent in WBS chats | Files sent in older WBS team chats | Only when files exist |

Each file line shows:
- The file name as a link. Clicking it downloads or opens the file from SharePoint.
- The type label, when it is not "Other".
- The uploader's name and the upload date.

**Remove** button: appears only in the "Project documents" group, and only for users with delete rights on Project Management › Documents for that file. A confirmation says "The file is removed from the project and from SharePoint." The server refuses to delete:
- evidence of a WBS that is no longer open
- files of a task that is Done or Cancelled

#### History tab

The project audit trail, newest first. Each entry shows:
- the person (or "System")
- the date and time
- the summary (for example "Project PEW-39: Planning → Active by …")
- for field edits, a second line "field: old → new"

Entries are written for:
- creating, editing and deleting the project
- status changes, with their reasons
- task creation and edits
- sub-tasks added, ticked or removed
- remarks on tasks
- WBS actions on older projects

When there are no entries the tab says "No history yet."

#### Statuses & workflow (project)

| Status (code) | Label on screen | Meaning |
|---|---|---|
| planning | Open (Planning in messages) | New project. Departments can already receive tasks |
| active | Active | Released to departments (older WBS projects) or resumed |
| on_hold | On hold | Work frozen. The reason is shown to everyone |
| technically_complete | Technically complete | Every WBS accepted (set automatically on older WBS projects) |
| closed | Closed | Finished after final billing and settlement. Read-only |
| cancelled | Cancelled | Stopped. The reason is kept |

The server has one transition endpoint with these actions. The user must be management or the project's PM and must have Overview › Edit.

| Action | Allowed from | Checks | Effect and notifications |
|---|---|---|---|
| activate (Release) | Planning | At least one WBS, and every WBS has a lead | Status becomes Active and the release date and person are recorded. Department heads ("New WBS for your department") and assistants are notified |
| hold | Active | Reason required | Status becomes On hold. Heads of open WBS and assignees of open tasks are notified ("Project put on hold") |
| resume | On hold | None | Status becomes Active and the hold reason is cleared. The same people are notified |
| complete | Active | Every non-cancelled WBS achieved | Status becomes Technically complete and the date is recorded |
| close | Planning, Active or Technically complete | Closure checklist clear (no open tasks, Final Project Report created, and every WBS accepted on WBS projects), closure note required, documents-archived confirmation required | Status becomes Closed. Closure date, closer, note, lessons learned and archive confirmation are recorded |
| cancel | Planning, Active or On hold | Reason required | Status becomes Cancelled. Every open WBS and open task is cancelled with "Project cancelled: <reason>", and heads and assignees are notified |

Every transition writes a History entry ("<old> → <new> by <user>. Reason: …").

What the current screens offer:
- Only **Resume** (for On hold projects) and **Release project** (for older Planning projects with WBS) appear as header buttons.
- There is no Hold or Cancel button on the screen.
- The Close project controls (closure note, lessons learned, archive tick box, Save notes, Close project) exist in the closure panel, but the Overview tab now shows that panel only on projects that are already Closed.
- In practice, a new project created today stays "Open" on screen. Its status changes only through the endpoint or the older WBS flow.

#### Statuses & workflow (department task)

| Status | Label | How it is reached |
|---|---|---|
| todo | To do | When the PM creates the task |
| in_progress | In progress | The head or PM clicks Start; the head adds the first sub-task (auto-start, "Work split into sub-tasks"); or the PM reopens a Done task |
| blocked | Blocked | Older WBS tasks only (department tasks have no Block button) |
| done | Done | The head or PM clicks Mark done. Every sub-task must be done first ("<n> sub-task(s) are not done yet…") |
| cancelled | Cancelled | The PM cancels with a reason, or the project is cancelled |

Who can do what on a department task:
- Start and Mark done: the department head or the PM/management.
- Reopen and Cancel: the PM/management only.

Notifications:
- Done: the project owners get "Department task done".
- Reopen and Cancel: the department heads are notified.

Every change is written to the task history and the project History.

### Ongoing Projects (/dashboard/ongoing-projects)

Open to every signed-in user (no app needed). This is where department heads and their people work on project tasks. Bell notifications about department tasks, sub-tasks and remarks open this page. Header: "Ongoing Projects — Every running project and the tasks each department owes it. Department heads split a task into sub-tasks; tick off the ones given to you."

Data: every project in Planning, Active, On hold or Technically complete. These are sorted by target handover date, and each project carries its department tasks. Each task is marked "mine" when one of these is true:
- the viewer is head of the task's department
- the viewer is a member of that department
- the viewer has a sub-task on it

#### Summary counters

Shown when at least one project exists. They are computed over the projects currently listed.

| Card | What it shows |
|---|---|
| Projects | Number of projects listed |
| Tasks | Department tasks on those projects (cancelled not counted) |
| Open (blue) | Tasks To do, In progress or Blocked |
| Done (green) | Tasks Done |
| Overall progress | Average task progress across those projects |

#### List view

- **Search box** ("Search code, name or customer…"): searches the project code, name and client.
- **Tick box "Only projects with work for my department"**: ticked by default when the viewer has any "mine" task. Untick it to see every running project.

| Column | What it shows |
|---|---|
| Project | Code (small caption) and name |
| Customer | Client name |
| Project manager | PM name |
| Handover | Target handover date (red when passed) |
| Tasks | "<done> / <total> done" or "No tasks yet", plus a flag "<n> open for your department" when relevant |
| Progress | Project progress bar |

Empty messages:
- "No ongoing projects."
- "No project has work for your department right now — untick the box to see every running project."
- "No project matches."

**Row action:** click a project to open its task view (same page with ?id=<signed reference>).

#### Project task view (Ongoing Projects › one project)

Header:
- project code
- name
- "<Client> · PM <name> · Handover <date>"
- a progress bar with "<done> of <total> tasks done · <open> open"
- "← Back" to the list

If the project has since closed or been cancelled, a message says it is no longer running.

**Tasks** card:
- Tick box **"Only my department's tasks"**: ticked by default when this project has tasks for the viewer's department. When ticked, the Department column is hidden.
- The same department task table as the project Tasks tab, in department mode:

| Row action | Who sees it | What it does |
|---|---|---|
| Start | Department head or PM, task is To do | Moves the task to In progress |
| + Sub-task | Department head, task is open, project is open | Opens the Add sub-task popup |
| Mark done | Department head or PM, task is open | Marks the task Done (every sub-task must be done) |

Sub-task rows in department mode:
- **Tick box**: the person the sub-task was given to, or the department head, can tick it done or untick it while the task is open. Others see a disabled box with the hint "Only the person it was given to, or the department head, can tick this". When the assignee ticks their sub-task done, the department heads get "Sub-task done".
- **Remove**: department head only, sub-task not done. A finished sub-task is kept as a record.
- Click a sub-task to open its remarks and attachments.

**Add sub-task popup** ("Add sub-task — <task>")

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Sub-task | text | Yes | e.g. "Frame drawing" | Cannot be blank |
| Assigned to | searchable dropdown | Yes | Active people in the task's department, heads first, shown as "Name — Head" or "Name — Designation" | The person must be active and a member of the department (HR profile or Azure department set to it) |
| Due date | date | No | Date picker. The popup shows "Task due <date> — the sub-task can't be due later." | Cannot be after the task's due date |
| Remarks | multi-line text | No | Instructions for the person | Saved as the first remark on the new sub-task |
| Attachments | file picker (multiple) | No | Up to 10 files | Uploaded to the new sub-task |

On save:
- If the task was To do, it moves to In progress.
- A History entry is written.
- The assignee gets a bell notification: "New task for you".
- If the remark or files fail, the sub-task stays added and a message explains what to add again.

#### Remarks and attachments (task or sub-task)

Shown when a task row or sub-task row is expanded, both here and on the project Tasks tab.

| Part | What it shows / does |
|---|---|
| Remarks (n) | Every remark with author ("You" for your own), date and time, and the text. A text box with **Save** (Ctrl+Enter also saves) appears for people allowed to write |
| Attachments (n) | Every file with its uploader. Clicking a file opens it from SharePoint. **Attach file** uploads one or more files. **Remove** appears on files you uploaded |

Who may write:
- On a **task**: the PM or management, the department's head, the department's members, and anyone with a sub-task on it.
- On a **sub-task**: the PM or management, the department head, and the person it was given to.
- In both cases only while the project is open.

Who may remove a file: only the person who attached it, or an admin, and only while the task is open.

Notifications:
- A new remark or file on a task notifies the project owners and the department heads ("New remark on a task" / "File attached to a task").
- On a sub-task it notifies the department heads and the sub-task's assignee.

Uploads allow at most 10 files at a time.

### Older pages (WBS era, reached by direct links and notifications)

These pages are not in the sub-nav. They serve projects that still have WBS elements, and they open from old bell notifications (pm_milestone, pm_task) and links inside them.

#### Department Board (/dashboard/projects/board)

Needs the Project Management app and View on Project Management › Department Board. The page is a grid:
- one row per live project, showing the code as a link, the name and the status pill
- one column per department that has WBS elements

Each cell lists that department's WBS on the project. Each entry shows:
- the WBS status, plus the progress % when not achieved
- the title
- the due date

The cell border is red when the WBS is overdue and amber when it is at risk. Clicking a project code opens the workspace. Clicking a cell entry opens the WBS page. When there are no live projects: "No live projects."

#### Department Work (/dashboard/projects/department)

Open to any signed-in user. It shows the WBS elements given to the departments the user heads or leads.

**My projects**
- Per project: the code (a link for users with the app), the name, the status, "PM … · handover …" and the hold reason if any.
- Per WBS: "Step N" and the title, the department and role (lead or assistant), status flags (Overdue, At risk, Locked), progress, the due date, and either a **Create & assign tasks** button or a next-step hint.
- Filters: a department picker (when the user heads more than one) and a **Show finished** tick box.

**Team workload**: Person, Open, In progress, Blocked, Overdue, Est. h, Logged h.

**Open team tasks**: a task table with blocked and overdue tasks first.

A hint under the page explains that only department heads see WBS elements here.

#### My Tasks (/dashboard/projects/my-tasks)

Open to any signed-in user. It lists the WBS tasks assigned to the user, grouped in this order:
1. Overdue
2. Due today
3. Blocked
4. In progress
5. To do
6. Done / cancelled (only with the **Show finished** tick box)

Columns: Task, Project / WBS, Status, Priority, Due, Progress. Clicking a row opens the task page.

#### WBS page (/dashboard/projects/milestones/<signed reference>)

Open to any signed-in user. The backend decides access per WBS: management, the lead, department heads, assistants, and anyone tagged in its chat. The page keeps the nav of the module it was opened from, with a "Module › WBS" breadcrumb and "← Back".

Header:
- project link, "Step N" and title
- status pill and flags (Overdue, At risk, Locked)
- department, due date (and the original date if moved), achieved date
- for the lead and management: "<done>/<total> tasks done" and a progress bar
- the deliverable, the lead and the assistants
- **Edit team** (for people who can plan) opens an assistants picker

A stepper shows Plan tasks → Work → Evidence → Submit → Accepted.

Notices explain:
- locked steps
- guest (tagged) access
- a project that is not Active
- a rejection reason
- the submission note
- cancellation

Buttons:
- **Submit WBS**: lead or head, while the project is Active and the WBS is open. Needs every task Done and at least one task, and asks for a handover note. Submission goes to the central approval engine (Milestone acceptance), which notifies the acceptors.
- **Accept WBS** (with an actual-date popup) and **Reject** (with a reason): shown only for WBS submitted before the approval engine existed.

Otherwise acceptance is done in the **Acceptance** approval panel on the page. When the last WBS is accepted, the project moves to Technically complete automatically.

The page also has these sections:
- **Tasks**, with the task form:

| Field | Required | Notes |
|---|---|---|
| Task name | Yes | |
| Assigned to | Yes | WBS team first, then others in the department |
| Due date | Yes | On or before the WBS date |
| Priority | Yes | Low, Medium, High or Critical |
| Estimated hours | No | |
| Description | No | |

  Buttons: "+ Assign task" (planners) and "+ My own task" (assistants). Row actions: Edit, Reopen, Cancel, and Delete (only for an untouched To-do task).
- **Evidence**: upload with a type (Drawing, Report, Certificate, Specification, Contract, Other).
- **Team chat**: messages with @ tagging and file attach. It is read-only once the project is closed or cancelled.
- **History & report**: per-person task counts (Given by lead, Added by self, Done, Open, Overdue, Cancelled, Est. h, Logged h, Last completed) and a task tree.

#### Task page (/dashboard/projects/tasks/<signed reference>)

Open to any signed-in user. The backend checks access per task: the assignee, the department head, the PM, and people tagged in it.

Header:
- project code, department and WBS link
- title, status, priority, Overdue flag
- "assignee · due … (WBS …) · h est. · h logged"
- progress
- notices for blocked, sent back, cancelled, or a frozen project

Assignee buttons (project Active, WBS open):
- **Start task** (To do)
- **Blocked** (asks for a reason and notifies the head)
- **Mark done**: asks what was delivered. It is disabled while sub-tasks are open.
- **Unblocked — continue**

The head can also use **Mark unblocked**.

Sections:
- **Sub-tasks**: tick, add (name and optional date), delete.
- **Files & drawings**: attach, open, remove your own (admin can remove any).
- **Time spent**: log the date, hours (0.25 to 24) and a note; the person who logged an entry can remove it.
- **Comments** with @ tagging, and **Status history**.

## 4. Settings / Masters

The module has no settings screen of its own. It depends on master data kept elsewhere:

| Master | Where it is kept | What it controls here |
|---|---|---|
| Departments and department heads | Organization › Departments (head, secondary head, additional heads) | Which departments can receive a task (a department needs at least one head), who receives "New task" notifications, who can start, finish and split tasks |
| Department membership | HR employee profile or Azure department | Who appears in the "Assigned to" list for sub-tasks, and which tasks count as "mine" in Ongoing Projects |
| Users | User directory | Project manager picker |
| Partner / Director flags | Company Info › Partners and the user flags | Partners and Directors are management in this module |
| Approval workflow "Milestone acceptance" | Organization › Approval Workflows | Who accepts submitted WBS elements (older WBS projects) |
| Roles and permissions | Organization › Role & Permissions / Users › Permission Matrix | Tab visibility and actions (Section 5) |

## 5. Permissions

App access: the Project Management app ("projects"). It is needed for:
- the Dashboard, All Projects, New Project and project workspace pages
- every /projects API call

Ongoing Projects, the older Department Work, My Tasks, WBS and Task pages, and the /pm-ongoing calls need only a signed-in user. Their access is checked per record.

Permission keys (module "Project Management"):

| Key | Label | Actions | Gates |
|---|---|---|---|
| projects › dashboard | Dashboard | View | Dashboard tab and data |
| projects › all_projects | All Projects | View, Create, Edit, Delete, Export | All Projects list, opening a project, create (View plus management), delete. **Create** on this key is itself the "management" grant |
| projects › department_board | Department Board | View | Older Department Board page |
| projects › department_work | Department Work | View, Edit | Older WBS work (e.g. submitting a WBS) |
| projects › my_tasks | My Tasks | View, Edit | Older My Tasks |
| projects › overview | Overview (Project workspace) | View, Edit | Overview and Tasks tabs (View); editing details, lifecycle buttons, the Final Project Report, adding and editing department tasks (Edit) |
| projects › milestones | WBS (Project workspace) | View, Create, Edit, Delete | Older WBS functions, the project breakdown, and accepting a WBS (Edit) |
| projects › documents | Documents (Project workspace) | View, Create, Edit, Delete | Documents tab; deleting project-level files |
| projects › project_history | History (Project workspace) | View | History tab |

Roles inside the module (worked out by the server, on top of the permission keys):

| Role | Who | Can |
|---|---|---|
| Management | Portal admins, Partners, Directors, and users granted All Projects › Create | Create projects, and do everything a PM can on every project |
| Project manager | The project's own PM | Edit the project, change its status, give, edit, cancel and reopen department tasks, and prepare the Final Project Report — on that project only |
| Department head | Any head slot on the task's department (admins are treated as heads) | Start and mark done department tasks, add and remove sub-tasks, tick any sub-task |
| Department member / sub-task holder | People in the department, or given a sub-task | Add remarks and attachments; tick their own sub-task |
| Everyone else | Any signed-in user | See every running project and its tasks in Ongoing Projects, read-only |

Data scope: the All Projects list, the Dashboard, the Board and single-project reads are limited to the user's data scope.

## 6. Documents, Notifications & Integrations

### Generated document

**Final Project Report** (managed Word document, entity "pm_project_closure_report"):
- It is built on the company letterhead and stored in SharePoint under Projects/<project code>.
- Contents:
  - title "FINAL PROJECT REPORT" and the project code
  - a facts grid: Project, Customer, Project manager, Start date, Target handover, Technically complete, Schedule variance (days late or early against the target handover), Closed
  - sections: Objective and scope; Work breakdown structure outcome, Deliverables and Effort by department (only for projects with WBS); Delays and issues; Closure and settlement (the closure note); Lessons learned
- The Word panel buttons are Create Word, Edit in Word, Upload revised .docx, Regenerate, Download .docx and History. Changing the document needs Overview › Edit and project-manager rights, on a project that is not closed. Viewing needs Overview › View.
- The report can only be made for an open or closed project, not a cancelled one.

### Files

- All task, sub-task, evidence, chat and project files are stored in SharePoint. The portal keeps only the pointer.
- If SharePoint is not configured, uploads fail with a message asking IT to set SHAREPOINT_SITE_ID.
- Removing a file removes it from SharePoint too. The record is soft-deleted.

### Notifications (bell)

| Event | Who is notified | Title | Opens |
|---|---|---|---|
| Project created or PM changed | New project manager | You are project manager | Project workspace |
| Department task created or moved | Heads of the department | New task for your department | Ongoing Projects |
| Sub-task added | The sub-task's assignee | New task for you | Ongoing Projects |
| Sub-task ticked done by its assignee | Department heads | Sub-task done | Ongoing Projects |
| Department task marked done | Project owners (PM) | Department task done | Project workspace, Tasks tab |
| Department task reopened or cancelled | Department heads | Task reopened / Task cancelled | Ongoing Projects |
| Remark or file on a task | PM and department heads | New remark on a task / File attached to a task | Ongoing Projects |
| Remark or file on a sub-task | Department heads and the sub-task assignee | Same titles | Ongoing Projects |
| Project put on hold, resumed or cancelled | Heads of open WBS, assignees of open tasks | Project put on hold / resumed / cancelled | Project workspace |
| Project released (WBS projects) | WBS department heads and assistants | New WBS for your department / You are on a project WBS | WBS page |
| WBS submitted (WBS projects) | Acceptors in the Milestone acceptance approval workflow, via the central approval engine | Approval request | Approval panel / My Approvals |
| WBS accepted, next WBS unlocked, project technically complete | Department heads, next WBS teams, project owners | WBS accepted / Your WBS can start now / Project technically complete | WBS page / project |

Teams messages: department-task notifications are bell-only. Only the approval engine's WBS acceptance requests also go to Teams.

### Links to other modules

- **Ongoing Projects** is the shared place where every department (Design, R&D, Electrical, Hydraulic, Maintenance, Purchase, Production, Quality, Store) sees project work. The older per-module project tabs redirect here.
- **Design** records (BOMs, design requests, design documents, submissions, change requests and change notices) can hold a reference to a Project Management project. That link is set and shown in the Design module.
- **Organization**: departments and heads, approval workflows (Milestone acceptance) and role permissions.
- **HR**: employee profile department, used for department membership.
- The client is free text. There is no link to the CRM customer master or to Sales Orders. The model also has a free-text customer PO reference that the current screens do not show.
- This module's "projects" are not the machine registry "Projects" used by the Service module (those are a separate table).
