# R&D Module

The R&D (Research & Development) module is where the R&D team receives customer requirements from the Business Development (BD) team, works on them, and sends back a formal technical answer. In the company's core business flow (Customer → BD → **R&D** → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance), R&D sits directly after BD. A requirement arrives in R&D when BD clicks "Send Technical Requirement to R&D" on a CRM Inquiry or Tender (this is called a Technical Offer Request, or TOR). R&D then answers the request, hands out tasks, shares the requirement with Design, Electrical and Hydraulic & Pneumatic for a feasibility reply, and writes a Technical Offer (a Word document on the company letterhead) that the R&D head sends back to BD so BD can quote against it. The module also holds R&D's own Prototype / Research projects (with their tasks and attachments), prototypes with a Bill of Materials that can be released to Production as a draft Production BOM, experiments and tests, a document library, and seven engineering calculators with a saved Calculation History.

## 1. Navigation Tabs

The R&D sub-nav (RndNav) sits at the top of every R&D page. A tab only shows if the user has View permission on its Permission Matrix key (shown in brackets below). The Settings tab is not shown as a text tab — it appears as a round gear icon on the right of the nav, next to the guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/rnd | R&D dashboard: requirement, ongoing project and my-task counters, recently received requirements and ongoing projects. (rnd:dashboard) |
| Requirements | /dashboard/rnd/requirements | Inbox of CRM Inquiries and Tenders sent to R&D as Technical Offer Requests. (rnd:requirements) |
| My Tasks | /dashboard/rnd/tasks | Every task assigned to the signed-in user across Ongoing Projects, Prototype / Research projects and Requirements. Shown if the user has any one of rnd:project_work, rnd:projects or rnd:requirements. |
| Prototype / Research | /dashboard/rnd/projects | List of R&D projects, with New Project. (rnd:projects) |
| Engineering Tools | /dashboard/rnd/tools | Landing page with a card for each calculator and for Calculation History. (rnd:all) |
| Settings (gear icon) | /dashboard/rnd/settings | R&D Team set-up: who is R&D Head, who is Member, who may create Technical Offers. Visible with rnd:requirements. |

When the user is inside Engineering Tools (the landing page or any calculator), a second row of pill buttons appears under the main tabs so the user can jump between calculators. Each pill only shows with View on its own key:

| Tool pill | Route | Permission key |
|---|---|---|
| Braking | /dashboard/rnd/braking | rnd:braking |
| Hydraulic | /dashboard/rnd/hydraulic | rnd:hydraulic |
| Qmax | /dashboard/rnd/qmax | rnd:qmax |
| Load | /dashboard/rnd/load-distribution | rnd:load_distribution |
| Tractive | /dashboard/rnd/tractive-effort | rnd:tractive_effort |
| Vehicle | /dashboard/rnd/vehicle-performance | rnd:vehicle_performance |
| Spline | /dashboard/rnd/spline | rnd:spline |
| History | /dashboard/rnd/history | rnd:history |

Pages that belong to R&D but are not tabs:

- Experiments & Tests (/dashboard/rnd/experiments, /new, /[id]), Prototypes (/dashboard/rnd/prototypes, /new, /[id]) and R&D Documents (/dashboard/rnd/documents) still exist and work, but no tab links to them. Experiments are reached from a prototype's page ("+ New Experiment" and the experiment list), prototypes and experiments link back to their project. These are documented at the end of Section 3.
- /dashboard/rnd/project-work is an old link. It now redirects to the company-wide Ongoing Projects page (/dashboard/ongoing-projects), keeping any ?id= that was in the link.

## 2. Dashboard

Route: /dashboard/rnd. Needs R&D app access. Heading "Research & Development" with the line "Requirements from the business team, ongoing projects and your tasks at a glance." The page loads three things separately, so a missing permission on one part only hides that part:

- The dashboard numbers from the backend endpoint /rnd/dashboard (needs rnd:dashboard view; limited to the user's R&D data scope).
- The requirement list (the same list as the Requirements tab). If the user has no access to Requirements, the Requirements tile and card are hidden.
- The user's open tasks: requirement tasks assigned to the user plus Prototype / Research project tasks assigned to the user.

If the dashboard numbers fail to load, a red box shows the real error.

### Counter tiles (top row)

| Tile | Big number | Small line under it | Click opens |
|---|---|---|---|
| Requirements | Total number of requirements the user can see in R&D › Requirements | "[n] awaiting R&D response" — requirements whose latest R&D request is still open (not yet answered) | Requirements tab |
| Ongoing Projects | Projects with status Active whose stage is not Closed (deleted projects never count) | "[n] on hold · [n] total" — projects with status On Hold, and all non-deleted projects in scope | Prototype / Research list |
| My Open Tasks | Count of open requirement tasks plus open project tasks assigned to the user | "[n] overdue" (open tasks whose due date is before today) shown in red, or "None overdue" in green | My Tasks tab |

**Actions:** click any tile to open the linked page.

### Recently Received Requirements

Shows up to 6 requirements, newest-sent first (same order as the Requirements list). Each row shows the Inquiry / Tender ID, the customer name and product joined with "·", the date it was last sent to R&D, and a status pill: Awaiting R&D (open request), Responded, or Superseded. If there are none the card says "No requirements yet — they arrive when the business team sends a Technical Offer Request."

**Actions:** "View all" opens the Requirements tab; clicking a row opens that requirement's page.

### Ongoing Projects

Shows up to 6 ongoing projects (status Active, stage not Closed), most recently updated first. Each row shows the project number, title, lead name(s) and a stage pill (Initiation, Research, Development, Feasibility, Handover, Closed). If none: "No ongoing R&D projects."

**Actions:** "View all" opens the Prototype / Research list; clicking a row opens that project.

## 3. Screens

### Requirements — /dashboard/rnd/requirements

The inbox of customer requirements that BD sent from CRM. A requirement is a CRM Inquiry or Tender that has been sent to R&D at least once. Heading "Requirements" with the line "Customer requirements sent from CRM as Technical Offer Requests." followed, when it applies, by "[n] awaiting your response ([n] overdue)" and "[n] edited in CRM since last sent."

Who sees which rows: R&D heads and admins see every requirement. Everyone else sees only the requirements a head opened to them (requirement › Access) or gave them a task on. Until the R&D team is set up in Settings, every R&D user acts as head and sees all.

#### Top area

- **+ New Technical Offer** button (top right) — only for R&D heads and for members ticked "Can create Technical Offers" in Settings. Opens the New Technical Offer dialog (see below).
- **My tasks ([n])** cards — shown when the user has open requirement tasks. Each card shows the task title, the requirement reference and title, and either "Approval request waiting for a decision", "Overdue since [date] — reason & new date required" (red border), or "Due [date]". Clicking a card opens that requirement on the Tasks & Departments tab.

#### List view

Filters (all apply automatically, search waits a quarter of a second after typing):

- Search box: "Search by TOR no., inquiry/tender ID, product or customer…" — matches the TOR number, Inquiry/Tender ID, product, product category and customer name.
- Source dropdown: Inquiries & Tenders (all), Inquiries only, Tenders only.
- Whose dropdown: Everyone's, or Awaiting my response (open requests assigned to me, or open team requests where I hold the Respond right).

Rows are sorted by the date last sent, newest first.

| Column | What it shows |
|---|---|
| TOR No. | The Technical Offer Request number from CRM. An orange "Edited" tag appears when CRM edited the requirement after it was last sent (hover text: expect a re-send). |
| Source | "Inquiry" or "Tender" and the Inquiry/Tender ID. |
| Customer | Customer organization name. |
| Product / Tender | Product (inquiry) or tender name, with the product category underneath. |
| Qty | Quantity from the inquiry. |
| Priority | CRM priority as a coloured pill (Urgent, High, Medium, Low). |
| R&D Response | Status pill of the latest R&D request: Awaiting R&D, Overdue, Responded on time, Responded late, or Superseded by re-send. Under it: who it is assigned to ("R&D team", "You" or the person's name) and "due [date]". "Not assigned" if there is no request. |
| BD Owner | BD owner of the CRM record. |
| Last Sent | Date and time it was last sent to R&D, and "by [name]". |
| Sends | How many times BD sent it (minimum 1). |
| (action) | "View" link. |

**Row actions:** click the row or "View" to open the requirement page.

#### New Technical Offer dialog

Opened from "+ New Technical Offer". It asks only one thing and then opens a Word template — the offer itself is written in Word, not in a form.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| TOR No. | Searchable dropdown | Yes | Every requirement sent to R&D, shown as "TOR no. — title — customer", plus "has TO-… (draft/released/superseded)" if it already has an offer | If the chosen TOR already has an offer, a note says so ("Open it and continue the draft" or "Open it and use Revise to make the next revision") and the button changes to "Open [offer no.]". |

**Buttons:** Cancel; **Create & Edit in Word** — creates the Technical Offer as a draft from the requirement, opens its letterhead Word template in Word Online in a new tab, and opens the requirement on the Technical Offers tab. If the offer is created but Word fails, the dialog says so with the real reason and tells the user to click "Save & Edit in Word" on the offer to retry.

#### View page — /dashboard/rnd/requirements/[inquiry or tender]/[signed id]

The link uses a signed reference; an edited or invalid link shows an "Invalid link" message with "Back to requirements". A notification link can add ?tab=discussion, tasks, departments, documents, technical-offers or access to open that tab directly.

**Header:** TOR number · "Inquiry"/"Tender" and its ID · priority; the title (product for an inquiry, tender name for a tender); "[customer] · last sent [date time]". **← Back** button top right (back to Requirements).

**Assignment strip** (when there is an R&D request): "Sent to the R&D head — you can respond" (team request), "Assigned to you", or "Assigned to [name]", then "response due [date]" and "requested by [name]", with the request status pill. If the open request is the user's and they are on another tab, a **Respond →** button jumps to the Requirement tab.

**Edited warning** (orange box): shown when CRM edited the requirement after the last send. It explains that the Requirement tab shows current CRM values, while the Technical Offer Request card shows exactly what R&D received, and asks the user to ask the BD owner to re-send.

**Tabs:** Requirement, Tasks & Departments, Technical Offers, Documents, Discussion, Access (Access only for R&D heads/admins).

##### Requirement tab

1. **Prototype / Research card** — R&D projects this requirement is being worked on in. Each linked project shows project number, title, stage, lead, "linked by [name]" and a status pill (Active, On hold, Cancelled). Clicking a project opens it. The R&D head sees **+ Link project** (pick an existing, non-cancelled project from a searchable list, then **Link**; Cancel closes the picker) and **Unlink** on each row (the project itself is not changed). Non-heads see the card only if at least one project is linked.
2. **Latest Technical Offer Request to R&D** — the newest send only, as a card:
   - Tag "Initial Request" or "Re-sent #n", "Sent to R&D as [TOR no.]", sender and date-time.
   - For a re-send: "Changed since previous send" — each changed field with the old value struck through and the new value.
   - The R&D request block: "Assigned to [person or R&D team] · due [date]", status pill, CRM remark (and who wrote it), and, once answered, the R&D response (who, when, remarks, reason for delay if late, response documents as clickable chips).
   - **Response form** (only while the request is open and the user may answer it: the assigned person, or anyone with the Respond right for a team request, or an admin): "Your response" text, "Reason for delay *" (only shown when today is past the due date — then required), "Response documents" (multiple files), and **Submit Response to CRM**. At least remarks or one file is required. Files are stored in SharePoint with the CRM record and both sides can open them. The CRM person who sent the request gets a bell notification "R&D responded to [TOR no.]" (on time or late).
   - "Documents sent": the TOR document and any reference files BD sent, as clickable chips.
   - "View requirement as sent" expands the exact field values R&D received at that send.
3. **Customer** — Organization, Type, City / State; and **Contact Person** (Name, Designation, Department, Mobile, Email) if the record has a contact.
4. **From CRM** — BD Owner, CRM Status, Priority.
5. **Product Requirement** (inquiry) or **Tender Details** (tender):

| Field (inquiry) | Meaning |
|---|---|
| Product | Product the customer wants |
| Category | Product category |
| Quantity | Quantity required |
| Required Delivery | Required delivery date |
| Delivery Location | Where it must be delivered |
| Inspection Req. | Inspection requirement |
| Warranty Req. | Warranty requirement |
| Specification | Product specification (full width, keeps line breaks) |
| Requirement Summary | Requirement description (full width) |
| Project Details | Project details (full width) |

| Field (tender) | Meaning |
|---|---|
| Tender Name | Name of the tender |
| Tender No. | Tender number |
| Category | Tender category |
| Authority | Tendering authority |
| Tender Value | Currency and value |
| Submission Date | Bid submission date |
| Pre-bid Meeting | Pre-bid meeting date |

Empty values show "Not provided".

##### Tasks & Departments tab

Top part — **Share with departments** (R&D head only):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Departments | Multi-select chips | Yes | Design, Electrical, Hydraulic & Pneumatic | A department that has not replied yet shows "· awaiting reply"; sharing it again replaces that request (new note and date). |
| What R&D needs from them | Long text | Yes | Free text | Cannot be blank. |
| Reply by | Date | No | Date picker | Cannot be in the past ("This date is in the past — pick today or later."). |

**Button:** "Share with department" / "Share with [n] departments". Each department's people are notified in the bell ("R&D requirement [ref] for [department]"). A shared department works on the requirement with R&D: it sees every department's tasks, can give tasks, uploads documents, joins the discussion and replies with its feasibility from its own Requirements page.

**Department replies** — one row per share: department name, status chip (Awaiting reply, Reply overdue, Replaced by newer request, or the reply: Feasible / Feasible with changes / Not feasible), "shared by [name], [date time] · reply by [date]", "Asked: [note]". A replied row shows the verdict, who replied and when, remarks and the reply files (clickable). A replaced row says "Replaced by a newer request on [date] — no reply needed on this one." When a department replies, the R&D side is notified ("[Department] replied on [ref]: [verdict]").

Bottom part — **Tasks — all departments** (the shared task board, described under "Task board" below), with these labels: due date is called "Response Due Date", assignee list is "Select person (R&D or a shared department)…". Department chips above the list: All, My department (if the user belongs to one), R&D, and one per shared department, each with a count. Anyone who can open the requirement can create tasks; the R&D head reviews every task. Giving someone a task automatically gives them View + Download on the requirement, notifies the assignee ("New task on requirement [ref]") and notifies the assignee's department head(s) (or the R&D heads if their department has no head).

##### Task board (used on requirements and on projects)

**+ New task** opens the task form:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Task | Text (max 200) | Yes | Free text | "Give the task a title — what should be done." |
| Assign to | Searchable dropdown | Yes | Requirement: people in R&D and in every shared department (shown as "Department · Name — Designation"). Project: the project's Team Members only. | Must be picked. |
| Priority | Dropdown | Yes | Low, Medium (default), High, Urgent | — |
| Status | Dropdown | Yes | Not started (default), In progress, On hold | This is the work status; the workflow status is separate. |
| Start Date | Date | No | Date picker | Must be on or before the due date. |
| Response Due Date (requirement) / Due Date (project) | Date | Yes | Date picker | Cannot be in the past. A sub-task cannot be due after its main task. |
| Task Details | Long text | No | Free text | What is needed back, references, constraints. |
| Checklist | List of steps (max 300 characters each) | No | Type a step and press Enter or "+ Add"; × removes | All steps must be ticked before the task can be completed. |
| Attach documents | Files (any type, up to 10) | No | File picker | Not shown when editing. |

**Buttons:** Cancel, **Assign task**.

Above the list: a search box ("Search task, person, priority, status or date (e.g. 16/10/2026)") that matches title, details, checklist, assignee, status, priority and dates, with "[n] of [n] tasks match". Open tasks are listed first (overdue first, then soonest due); completed and cancelled tasks sink to the bottom. Sub-tasks show indented under their main task.

**Each task card shows:** "Task" or "Sub-task", title, assignee chip ("(you)" if it is the user), due chip ("Due [date]" or red "Overdue · [date]", plus "re-dated n×" if the date was moved; hover shows the original due date), priority pill, start date, department pill (requirement tasks), "given by [name]", a work-status selector (Not started / In progress / On hold — editable by the assignee or reviewer while open) and the status pill (Open, Completed, Cancelled). Below: Task details, Checklist with ticks and a progress bar ("done/total"; each tick records who ticked it and when), "Documents attached to the task", "Work & updates from the assignee", Approval requests, the Activity timeline (latest entry shown, "Show all (n)" for the full history) and the sub-tasks.

**Actions and when they appear:**

| Button | Who sees it | When | What it does |
|---|---|---|---|
| Complete task | Assignee | Task open | Needs "What you did *", "Reason for the delay *" if overdue, optional files. Blocked if sub-tasks are still open, an approval request is pending, or checklist steps are not ticked. Closes the task; the giver (and on projects the leads) is notified. |
| Add update | Assignee | Task open | "Update / remarks *" and optional files. Task stays open; the giver is notified. |
| Ask for approval | Assignee | Task open and no pending request (otherwise shows "Approval pending", disabled) | "What do you need approved? *" and optional files. Goes to the person who gave the task (and the head/lead). Sent as a bell and Microsoft Teams notification. Task stays open. |
| Need more time / Reason & new date | Assignee | Task open ("Reason & new date" in red when overdue; the form opens by itself on an overdue task) | "Reason it isn't complete *" and "New completion date *" (must be after the current due date). The new date becomes the due date; the original stays on record; the giver/head is notified. |
| Sub-task | Assignee of a top-level open task | Task open | Same task form; assignee list is the requirement's people (requirement) or the project team incl. leads (project). The sub-task's creator reviews it. |
| Edit | Task creator, R&D head (requirement) or project lead/admin (project) | Task open | Same form without files. Changes are recorded in Activity and the assignee is notified. |
| Reopen | Creator / head / lead | Task completed | "What still needs to be done *"; "New due date" required if the due date has passed. Assignee is notified. |
| Cancel task | Creator / head / lead | Task open | "Why is it cancelled? *". Its open sub-tasks are cancelled too. Assignee is notified. |
| Approve / Reject | Creator / head / lead (not the assignee) | Approval pending | Remarks are optional to approve and required to reject. The requester is notified. Task stays open. |
| Withdraw request | The person who asked | Approval pending | Withdraws the request. |

Task statuses: Open → Completed (by the assignee) → can be Reopened (back to Open); Open → Cancelled. Work status (Not started / In progress / On hold) only applies while open. Approval request statuses: Waiting for decision (pending), Approved, Rejected, Withdrawn.

##### Technical Offers tab

R&D's formal technical answer to the TOR. Explanatory text: it opens as a Word template, is written in Word, and the R&D head sends it to the BD team; an offer sent to BD cannot be edited — it must be revised.

- **+ New Technical Offer** (heads and allowed members, only when the requirement has no offer yet) — creates a draft and opens its Word template in Word Online. One offer series per requirement: the number is "TO-" plus the Inquiry/Tender ID (for example TO-INQ-2026-0042); revisions add -R1, -R2.
- Each offer row: offer number, status pill (Draft, Sent to BD, Superseded), subject/title, "Dated [date]" and either "released by [name] on [date time]" or "by [creator]". Click to expand.
- Expanded: "Revision reason" (for revisions), "Quoted in: [quotation numbers]" (CRM quotations that picked this offer), action buttons and the Word document panel.

| Button | Who | When | What it does |
|---|---|---|---|
| Save & Edit in Word | Heads and members allowed to create offers | Draft | Opens the Word document in Word Online. |
| Send to BD Team | R&D head | Draft | Confirm dialog. The Word document must exist first. The offer becomes "Sent to BD" (released), its document is frozen, any earlier released offer becomes Superseded, and the CRM record's creator is notified "Technical Offer [no.] received from R&D" so BD can pick it in the quotation's Technical Offer field. |
| Delete draft | Preparers | Draft | Confirm dialog; removes the draft permanently. |
| Revise | Preparers | Latest offer and status Sent to BD | Asks "Why is it being revised?" (required). Creates the next revision as a draft, copying the released Word document (renumbered). It replaces the earlier one once the head sends it. |

Non-heads on a draft see "When the Word document is final, ask the R&D head to send it to the BD team." The Word template is on the letterhead with "TECHNICAL OFFER", customer, Offer #, Offer date, Revision, the customer's enquiry reference, Subject, and four sections: 1. Scope of Supply, 2. Technical Specification, 3. Deviations from Customer Specification, 4. Exclusions (prefilled from the requirement where possible).

Statuses: Draft → Sent to BD (released, by R&D head) → Superseded (when a later revision is released). Only one draft or open series at a time: a requirement that already has an offer must finish/delete the draft or use Revise.

##### Documents tab

Every file on the requirement that the user may see, in one searchable list. Nothing here shows in CRM.

- Search: "Search file name, uploaded by, task…".
- Group chips with counts: All, Business team (CRM) (the TOR and client files), Tasks (task brief and work files), Discussion (attachments), R&D (R&D's own documents and response files), Departments (files from Design / Electrical / Hydraulic & Pneumatic).
- Each row: group pill, file name (clickable only with the Download right; otherwise a note says to ask the R&D head), where it came from and size, uploader and date-time. Files a department uploaded show a toggle "Keep to [department] only" / "Show to all departments" for whoever may change it.
- **Upload documents** (needs the Upload right): "Upload for [department]" when the user belongs to more than one department, a choice "All departments see it" or "Only [my department]", and a multi-file picker (uploads immediately on selection).

##### Discussion tab

A chat thread shared with the BD team and the shared departments (the same thread appears on the CRM Inquiry/Tender page). Two views: Messages (n) and Files (n). Each message shows the author, a side tag (BD, R&D, Design, Electrical, Hydraulic & Pneumatic), date-time, text with tagged names highlighted and attachments. Composer: message box ("type @ to tag someone"), **@ Tag people**, **📎 Attach files**, **Send**. Tagged people get a bell notification. The author can **Delete** their message (confirm dialog; the message and its files are removed for everyone).

##### Access tab (R&D head / admin only)

"Who can work on this requirement". A table of people with four tick boxes:

| Right | Meaning |
|---|---|
| View | Open the requirement and its discussion |
| Download | Open/download the TOR and documents |
| Upload | Add R&D documents |
| Respond | Send the R&D response to CRM |

Ticking any right also ticks View; unticking View clears the others. **Remove** takes a person off the list. "Give someone access" adds an R&D person (heads are not listed — they always have every right) with View + Download ticked by default. **Save access** saves the whole list; people who gain access are notified. Giving someone a task adds View + Download automatically.

### My Tasks — /dashboard/rnd/tasks

Heading "My Tasks" with "Everything assigned to you — ongoing projects, prototypes / research and requirements." and, if any, "[n] overdue — open them to give a reason and a new date." Three sources are loaded separately; if one fails or is not permitted, a line says "Not shown: [source] — you don't have access to that part of R&D, or it couldn't be loaded."

#### List view

Filters: category pills with counts of open tasks — All, Ongoing Projects (Project Management milestone tasks), Prototype / Research (R&D project tasks), Requirements (requirement tasks); **Show completed** tick box (reloads including finished tasks); search box "Search task, project / requirement, person or date" (matches title, reference, giver, status, category, "overdue" and dates in several formats).

Sorting: open first, overdue first, then by due date (no date last). Completed rows are faded.

| Column | What it shows |
|---|---|
| Category | Ongoing Project, Prototype / Research or Requirement pill |
| Task | Task title |
| Project / Requirement | Project code/number or requirement reference, with the project name / milestone or requirement title underneath |
| Assigned | When it became the user's (last reassignment, else creation) and "by [name]" |
| Due | Due date, red with "· overdue" when late |
| Status | Ongoing projects: To do, In progress, Blocked, Done, Cancelled. R&D tasks: Open, Completed, Cancelled, or "Approval pending" |
| (action) | "Open" |

**Row actions:** click opens the task in place — Ongoing Project tasks open in the Projects module task page; Prototype / Research tasks open the project at its Tasks section; Requirement tasks open the requirement on the Tasks & Departments tab.

### Prototype / Research — /dashboard/rnd/projects

R&D's own projects (internal research, a new prototype, or work linked to customer requirements).

#### List view

Top button: **+ New Project**. Filters: search "Search by project number, title, or objective…", All stages (Initiation, Research, Development, Feasibility, Handover, Closed), All statuses (Active, On Hold, Cancelled), All priorities (Low, Medium, High, Critical). The list shows only projects in the user's R&D data scope (by default, projects the user created, leads or is a team member of).

| Column | What it shows |
|---|---|
| Project No. | Auto number RND-[year]-[0001] |
| Title | Project title |
| Priority | Priority pill |
| Status | Active, On Hold or Cancelled |
| Lead | Lead name(s) |
| Target End | Target end date, or "Not decided" |
| (action) | "View" |

**Row actions:** click the row or "View" to open the project.

#### Create form — /dashboard/rnd/projects/new

Heading "New R&D Project", **← Back** top right. Needs rnd:projects create.

Section "Project Initiation":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project Title | Text | Yes | Free text | "Project title is required." |
| Priority | Dropdown | No (default Medium) | High — Important requirement; Medium — Normal requirement; Low — Can be handled later | — |
| Start Date | Date | No | Defaults to today | — |
| Target End Date | Date | No | Blank = "Not decided" | Cannot be before the start date. |
| Objective | Long text | Yes | What the project should achieve and why | "Objective is required…" |
| Scope | Long text | No | In / out of scope, key deliverables | — |

Section "Project Members":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project Leads | Multi-select chip picker (search name or email) | No | User directory; defaults to the creator; "+ Add me" shortcut | A person cannot be both lead and team member. |
| Team Members | Multi-select chip picker | No | User directory | Only Team Members can be given top-level tasks. |
| Remarks | Long text | No | Free text | — |

Section "Attachments": **+ Add files** (any file type, several at once, duplicates ignored, each removable with ×). Files are uploaded to the project's documents after the project is saved (type "Other").

**Buttons:** Cancel, **Create Project**. On success the project opens. New projects start at stage Initiation, status Active. If the project saves but a file fails, a red box lists each failed file with its reason and an "Open project" link (Create is then disabled to avoid duplicates).

#### View page — /dashboard/rnd/projects/[signed id]

**Header:** project number and priority pill. If the project is linked to customer requirements, "For requirement:" chips (reference · title) open those requirements. Buttons: **Edit** (rnd:projects edit), **Delete** (rnd:projects delete, within data scope), **← Back**.

Section "Project Initiation":

| Field | Meaning |
|---|---|
| Project Title | Title |
| Start Date | Start date |
| Target End Date | Target end date or "Not decided" |
| Created | Creation date |
| Objective | Objective |
| Scope | Scope |

Section "Project Members": Project Leads, Team Members, Remarks.

Section "Tasks": the Task board (see Requirements › Task board) with project labels: due date "Due Date", assignee placeholder "Select team member…". Only project leads and admins create top-level tasks and review every task; tasks can only go to Team Members. The assignee can split a task into sub-tasks for anyone on the team (members and leads). Notifications: new task / sub-task to the assignee; re-date, completion and updates to the task creator and (for top-level tasks) the leads; approval requests as bell + Teams.

Section "Attachments (n)": the R&D documents panel for this project — **+ Upload Document** with Title *, Type (Specification, Drawing, Test Report, Research Note, Process Document, Other), Version, Files * (images, PDF, Word, Excel, DWG, DXF, STEP, ZIP), Description, then **Upload**. Each row shows type pill, title and "Rev [version]", file name, size, uploader and date, **View** (opens the file) and **Delete** (only project leads/admins with rnd:documents delete; confirm dialog; also deletes the file from SharePoint). Uploading needs rnd:documents create or rnd:projects edit.

Stage, status, budget, feasibility study and handover checklist exist in the database but are not shown or editable on this page.

#### Edit

Clicking **Edit** switches the two detail sections into the same form as Create (Title, Priority, Start Date, Target End Date, Objective, Scope, Project Leads, Team Members, Remarks). An old "Critical (old value)" priority stays selectable on projects that have it. Same validation as Create. **Discard** reverts; **Save changes** saves, reloads, and shows "Changes saved." Changing leads updates who can manage tasks and files.

#### Delete

Confirm dialog "Delete this project?". The backend refuses if the project still has experiments, prototypes or attachments ("Delete those first"). Deletion is a soft delete kept for audit.

#### Statuses & workflow

- Status: Active, On Hold, Cancelled (Cancelled projects cannot be linked to requirements).
- Stage: Initiation → Research → Development → Feasibility → Handover → Closed (set to Initiation on creation; not changeable from the current screens).

### Engineering Tools — /dashboard/rnd/tools

Heading "R&D Engineering Tools" — "Calculation tools for braking, hydraulics, load capacity, and traction analysis." One card per tool the user may open (Braking Calculator, Hydraulic Calculator, Qmax Calculator, Load Distribution, Tractive Effort, Vehicle Performance, Spline Calculator, Calculation History), each with a one-line description. Clicking a card opens it. With no calculator permission: "You have no calculator access yet. Ask an administrator to grant the calculator tabs you need under R&D in the Permission Matrix."

Common behaviour of every calculator:

- Every successful **Calculate** is saved automatically to Calculation History with a default name (for example "Braking — 11280kg @ 50km/h").
- Opening a saved calculation from History (link with ?load=) fills every field with the saved inputs and recalculates (without saving again).
- "Import CSV" buttons read a simple two-column CSV (key,value) and fill matching fields.
- Errors show in red with the real reason from the server.

### Braking Calculator — /dashboard/rnd/braking

Title "Braking Performance Calculator", tag "DIN EN 15746-2", "Rail & Road Braking Performance Analysis". After a calculation, four stat cards: GBR (%), Max Braking Force (kN), Vehicle Mass (kg), Reaction Time (s).

| Card / Field | Type | Required | Default / options | Rules |
|---|---|---|---|---|
| Document Details: Doc No., Made By, Checked By, Approved By | Text | No | BRK-001, blank | Printed on the reports. |
| Vehicle Data: GVW (kg) | Number | Yes | 11280 | Must be above 0. |
| Max Speed km/h (comma separated) | Text | Yes | 50 | At least one valid speed. |
| Driving Wheels | Number | Yes | 4 | At least 1. Braked Wheels shows the same value (read-only). |
| Reaction Time (s) | Number | Yes | 1 | — |
| Wheel Dia (mm) | Number | No | 730 | — |
| Track Data: Track Standard | Radio | — | CUSTOM, IR, HSR | IR/HSR fill curve, super-elevation, cant and gauge presets. |
| Max Gradient (comma separated) | Text + unit radio | Yes | 33, unit 1 in G (also Degree, %) | At least one value ≥ 0. |
| Max Curve (m), Super-elevation (mm), Max Cant (mm), Gauge (mm) | Number (read-only) | — | From the preset | — |
| Road Parameters (only with Road Mode): Road Speed km/h, Road Gradient (% or °), Friction Coefficient (μ) | Text / number | No | 30; 5 %; 0.7 | — |
| Brake Configuration: Brake Type | Radio | — | Disc Brake, Tread Brake | — |
| Calculate | Radio | — | Force, Distance, Detail | Force: "Total Stop Distance (m)" with Standard = Custom or EN Standard (auto). Distance: "Target Stopping Distance (m)" (default 50) — solves the required deceleration and force. Detail: click any result row to see the step-by-step calculation. |
| Control & Actions: Mode | Tick box | — | Road Mode | Adds road scenarios. |
| Scenarios | Tick boxes | — | Straight, Moving Up, Moving Down | Filters the result rows shown. |
| Options | Tick box | — | Show GBR % | Adds a GBR column. |

**Buttons:** Calculate; Inputs (CSV of inputs); Outputs (CSV of results); Word Report (.docx); PDF; History (opens Calculation History). "Import CSV" on Vehicle Data and Track Data.

**Results table** ("Calculation Results", row count): Mode, Gradient, Scenario, Speed km/h, v m/s, App. Force kN, Grav. Force kN, Net Force kN, Decel m/s², Brake Dist m, Total Dist m, Std Dist m, (Distance mode: Req. Decel m/s², Req. Force kN), Compliance (✓ PASS / ✗ FAIL against the EN standard distance; N/A for road rows), GBR %. Side table "EN Std. Distances" lists the maximum stopping distance per speed.

### Hydraulic Calculator — /dashboard/rnd/hydraulic

Title "Hydraulic Motor Calculator". Buttons top right: Export Report (.docx), Download PDF.

Calculation Mode (radio): Pump & Motor (cc), Speed (km/h), Motor Pressure, Gear Ratio. Only the fields used by the chosen mode are shown, grouped in cards Vehicle Data (with Import CSV), Hydraulic Motor, Track Parameters (with Import CSV) and Pump.

| Field | Default |
|---|---|
| Weight (t) | 18.500 |
| Total Axles | 2 |
| Wheel Dia (mm) | 560 |
| Target Speed (km/h) | 35 |
| Max Vehicle RPM | 2700 |
| Split Shaft PTO Ratio | 1 |
| Eng. Gear Box Ratio | 3.5 |
| Axle Gear Box Ratio | 5.1 |
| Total Motors / Motor/Axle / Total Drive Axles | 2 / 1 / 2 |
| Pressure (bar) | 150 |
| Motor Mech Eff (%) / Motor Vol Eff (%) | 95 / 95 |
| Motor Displacement (cc) | 28 |
| Max Motor RPM | 500 |
| Slope (%) / Curve (degree) | 0.0 / 0.0 |
| Pump Vol Eff (%) / Pump Mech Eff (%) | 95 / 95 |
| Total Pumps / Pump Displacement (cc) | 1 / 65 |

After a calculation, Motor Displacement and Pump Displacement show "Suggested: [x] cc" with a **Use** button that copies the suggestion into the field. **Execute Calculation** runs it; the result report shows in a terminal-style panel "hydraulic_output.log".

### Qmax Calculator — /dashboard/rnd/qmax

Maximum permissible wheel load on a rail. Cards:

| Field | Type | Default | Rules |
|---|---|---|---|
| Material Selection (σB) | Tiles | 880 (Grade 880), 680 (Grade 680), Custom | Custom shows "Custom σB (N/mm²)" — must be above 0. |
| Worn Rail Head Diameter — d (mm) | Number | 134.5 | Must be above 0. |
| Additional Parameter — e (mm) | Number, optional | 0 | Adjusts the effective diameter. |
| Safety Factor — v_head | Number | 1.1 | Must be above 0. |
| Applied Wheel Load — Q_applied (kN) | Number, optional | 0 | When given, a ✓ PASS / ✗ FAIL compliance and margin are shown. |

Results: Qmax result card with σB Material, Allowable σ, Safety Factor, Diameter d, and compliance; Formula Reference card (Qmax = C × (d/2) × (σB / v_head)², EN 13674 / UIC 861-3); terminal panel "qmax_output.log". **Buttons:** Calculate, Export CSV, Export Report (.docx), History (opens Calculation History); Import CSV on Rail Parameters.

### Load Distribution — /dashboard/rnd/load-distribution

Wheel loads Q1–Q4 and the ΔQ/Q check. Buttons top right: Export CSV, Export Report (.docx).

| Field | Type | Default | Rules |
|---|---|---|---|
| Configuration Mode | Tiles | BOGIE (2 bogies × 2 axles = Q1–Q4) or AXLE (single axle, 2 wheel loads) | Switching sets Total Load to 28.0 (Bogie) or 19.0 (Axle). |
| Total Load (Ton) | Number | 28.0 | All fields required. |
| Front Load (%) | Number | 50.0 | 0–100. |
| Q1 (% of Front Load) | Number | 50.0 | 0–100. |
| Q3 (% of Rear Load) | Number | 50.0 | 0–100. |

Results: Front Bogie (Q1 Left, Q2 Right, sum) and Rear Bogie (Q3, Q4, sum) boxes; QL (Min), Q (Heavier Avg), ΔQ = Q − QL; ΔQ/Q ratio % against the limit and a PENDING / ✓ PASS / ✗ FAIL badge; Formula Reference (UIC 518 / EN 14363); Q Values Summary; log panel. Import CSV on Vehicle & Load Data.

### Tractive Effort — /dashboard/rnd/tractive-effort

Buttons: Export CSV, Export Report (.docx).

| Field | Type | Default / options |
|---|---|---|
| Calculation Mode | Tiles | RUNNING (speed-dependent rolling resistance, Davis formula) or START (static starting resistance; speed only used for HP/OHE) |
| Shunting / Train Load (tons) | Number | 2400 |
| GVW of Locomotive (tons) | Number | 110 |
| Speed (km/h) | Number (0 or more) | 30 — set 0 for pure starting TE |
| Gradient + Unit | Number + dropdown | 80, unit 1 in G or Degree |
| Curvature + Unit | Number + dropdown | 10, unit Degree or Radius(m) |

All fields are required. **» Calculate TE** shows: Tractive Effort (kg), Rail Horsepower (HP), OHE Current (25kV, Amps), the resistance breakdown T1 Wagon, T2 Loco, T3 Gradient, T4 Curve, Formula Reference, Specific Values (TE / total weight, T1 per ton, T3 per ton, dominant component) and a log panel.

### Vehicle Performance — /dashboard/rnd/vehicle-performance

Buttons: Export CSV, Save Doc (downloads the Word report .docx). After calculation: Max Traction (N), Traction (No Slip) (N), and a Status tile (red when the wheels would slip).

| Card | Fields (defaults) |
|---|---|
| Document Details | Doc No. (PEW-VP-001), Date (today), Made By, Checked By (Jasbir Singh), Approved By (Madhav Arora) |
| Vehicle Data | GVW (kg) 28000, Max Speed (km/h) 50, No. of Axles 2, Rear Axle Ratio 5.29, Gear Ratios (comma) 8.81,6.55,4.77,3.55,2.48,1.85,1.34,1, Shunting Load (t) 500 |
| Track Parameters | Max Curve 5 with Curve Unit degree / m (radius); Max Slope 3.5 with Slope Unit % / degree |
| RRV Data | Peak Power (kW) 223.7, Friction Coeff. (μ) 0.55, Wheel Dia (m) 0.56, Min RPM 100, Max RPM 2200 |
| Torque Curve | Editable table of RPM and Torque (N·m) rows (× removes; "+ Add Row"), Import CSV and Export CSV of the curve. Only rows with RPM above 0 are used. |

**› Calculate Performance** shows a Speed vs Slope table (slope % and max speed), charts "Tractive Effort vs Speed" and "Shunting Capability vs Speed", and a log panel "vehicle_perf.log".

### Spline Calculator — /dashboard/rnd/spline

Title "Spline Design Calculator". Buttons: Export CSV, Export DOCX, Download PDF.

| Card | Fields (defaults) |
|---|---|
| Document Details | Doc No. (PEW57-003-00), Made By, Checked By, Approved By |
| Geometry (Import CSV) | No. of Teeth 8, Diametral Pitch 0.19, Pressure Angle (°) 0, Outer Diameter (mm) 44.8, Inner Diameter (mm) 39, Length of Engagement (mm) 57 |
| Material | Yield Strength (MPa) 310, Material Type EN-9 (text) |
| Operating Conditions | Loco Weight (t) 11, No. of Axles 2, Wheels per Axle 2, Speed (km/h) 60, Wheel Diameter (m) 0.73, Friction Coeff. (μ) 0.3 |

Every numeric field except Pressure Angle and Speed must be above 0 ("Invalid value for [field]"). **Execute Calculation** shows Torque Capacity (N·m), Working Torque (N·m), Factor of Safety, a verdict bar with the reason, Geometry Details (Pitch Diameter, Base Diameter, Tooth Thickness, Tooth Height, Shear Stress, Allowable Shear) and a log panel "spline_calc.log".

### Calculation History — /dashboard/rnd/history

Heading "Calculation History" — "My saved R&D calculations · View · Rename · Delete". Admins see a **View All Users** button that switches to "Admin view — all users' calculations" with an All Users / single user dropdown (and back with **My History**).

Stat cards: Total Records, Tools Used, Latest (date of the newest record). Filter pills: All, Braking, Hydraulic, Qmax, Load Distribution, Tractive Effort, Vehicle Performance, Spline. Search "Search by name…".

| Column | What it shows |
|---|---|
| # | Row number |
| Calculation Name | Saved name (editable inline when renaming) |
| User | Only in admin view |
| Tool | Tool pill |
| Saved On | Date and time saved |
| Actions | Open (eye), Rename (pencil), Delete (bin) |

**Actions:** Open — opens the tool with the saved inputs and recalculates. Rename — inline box, Enter or ✓ saves (name required, up to 255 characters), × cancels. Delete — only with rnd:history delete; confirm dialog "Delete this saved calculation? This cannot be undone."

### Settings — /dashboard/rnd/settings

The R&D Team screen. See Section 4.

### Experiments & Tests — /dashboard/rnd/experiments (not in the sub-nav)

#### List view

Top button **+ New Experiment** (keeps the selected project filter). Filters: search by experiment number or title, project (searchable, All projects), type (Research, Lab Test, Field Trial, Simulation, Validation), status (Planned, In Progress, Completed, Cancelled), result (Pass, Fail, Inconclusive). A ?project_id= link pre-selects the project.

| Column | What it shows |
|---|---|
| Experiment No. | Auto number EXP-[year]-[0001] |
| Title | Title |
| Project | Project number (hover shows title) |
| Type | Experiment type |
| Status | Status pill |
| Result | Result pill or — |
| Date | Experiment date |
| (action) | View |

#### Create form — /dashboard/rnd/experiments/new

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project | Searchable dropdown | Yes | R&D projects in scope | — |
| Prototype | Searchable dropdown | No | Prototypes of the chosen project, or — None — | Disabled until a project is picked; must belong to that project. |
| Title | Text | Yes | — | — |
| Type | Dropdown | No | Research, Lab Test (default), Field Trial, Simulation, Validation | — |
| Experiment Date | Date | No | Today | — |
| Conducted By | Searchable dropdown | No | User directory | Defaults to the creator. |
| Objective / Hypothesis | Long text | No | — | — |
| Method / Procedure | Long text | No | — | — |
| Test Parameters | Table rows: Parameter *, Specification, Measured, Unit, Result (—, Pass, Fail); "+ Add parameter", × removes | No | — | A row with any value needs a Parameter name. Empty rows are ignored. |

**Buttons:** ← Back, Cancel, **Save Experiment** (opens the new experiment). Needs rnd:experiments create.

#### View page and Edit — /dashboard/rnd/experiments/[signed id]

Header: experiment number, status pill, result pill, "Project: [number — title]" link, ← Back. The whole page is an editable form (needs rnd:experiments edit to save): all Create fields plus **Status** (Planned, In Progress, Completed, Cancelled) and **Result** (—, Pass, Fail, Inconclusive — required when Status is Completed). "Conducted by [name] · created [date]". Test Parameters shows "[n] parameters · [n] pass · [n] fail". Section "Results & Conclusion": Observations, Conclusion. Section "Test Reports & Documents": documents panel scoped to this experiment. Buttons: **Delete Experiment** (rnd:experiments delete; confirm), **Save Changes**.

Statuses: Planned → In Progress → Completed (needs a Result) or Cancelled — set freely from the Status dropdown.

### Prototypes — /dashboard/rnd/prototypes (not in the sub-nav)

#### List view

Top button **+ New Prototype**. Filters: search by prototype number, name or version; project; status (Design, Building, Testing, Validated, Rejected).

| Column | What it shows |
|---|---|
| Prototype No. | Auto number PRT-[year]-[0001] |
| Name | Prototype name |
| Version | Version (e.g. v1) |
| Project | Project number |
| Status | Status pill |
| BOM Cost | Sum of quantity × unit cost (₹) |
| Experiments | Number of experiments run on it |
| (action) | View |

#### Create form — /dashboard/rnd/prototypes/new

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project | Searchable dropdown | Yes | R&D projects | — |
| Name | Text | Yes | — | — |
| Version | Text | Yes | Default "v1" | — |
| Build Date | Date | No | — | — |
| Description | Long text | No | — | — |
| Prototype BOM lines | Item (search the Item Master or type a free-text part), Code, Qty, UoM, Unit Cost, Line cost (calculated), Remarks; "+ Add line", × removes | No | Item Master lookup (code, name, UoM) | Each used line needs an item name; quantity above 0; unit cost 0 or more or blank. Empty lines are ignored. Shows "BOM Total". |

**Buttons:** ← Back, Cancel, **Save Prototype**. Needs rnd:prototypes create.

#### View page and Edit — /dashboard/rnd/prototypes/[signed id]

Header: prototype number, version, status pill, "Project: [number — title]" link, ← Back.

- **Prototype Details** (editable): Project, Name, Version, Status (Design, Building, Testing, Validated, Rejected), Build Date, Description, Findings. A prototype cannot move to another project while experiments in its current project reference it.
- **Prototype BOM**: the BOM editor; once released to Production it becomes read-only ("Frozen — released to Production as [BOM no.]") showing code, name, qty, UoM, line cost and total.
- **Release to Production** panel: explains the current state — not Validated yet; free-text lines that Store must create in the Item Master first; no BOM lines; or, when ready, a form: Finished Product (Item Master) * (search; cannot be one of its own components), Base Qty (default 1, above 0), Note for Production, then **Release BOM to Production** (confirm). Needs rnd:prototypes approve. It creates a draft Production BOM (repeated parts merged), freezes the prototype's BOM and shows "Released as [BOM no.] ([status]) on [date] by [name]" with a link to the Production BOM and the next step (add routing and activate in Production).
- **Experiments run on this prototype**: list with result or status pill, **+ New Experiment** link.
- **Prototype Documents**: documents panel scoped to this prototype.
- Buttons: **Delete** (rnd:prototypes delete; refused if released to Production or experiments were run on it), **Save Changes** (rnd:prototypes edit).

Statuses: Design → Building → Testing → Validated or Rejected (chosen from the dropdown). Only Validated prototypes can be released.

### R&D Documents — /dashboard/rnd/documents (not in the sub-nav)

Heading "R&D Documents" — specifications, drawings, test reports and process documents across every R&D project. Filters: search by title or file name, project (All projects), type (Specification, Drawing, Test Report, Research Note, Process Document, Other). Below, the documents panel for all projects: **+ Upload Document** asks Project * as well as the fields listed under the project page; rows show project · experiment · prototype numbers; View; Delete for users with rnd:documents delete (data scope applies).

## 4. Settings / Masters

### R&D Settings — R&D Team (/dashboard/rnd/settings)

Heading "R&D Settings" — "Who leads R&D and who works in it." Opened from the gear icon; visible with rnd:requirements view; only an R&D head or an admin can change it (others see it read-only with "Only an R&D head or an admin can change the team.").

What it controls:

- **R&D Heads** receive every Technical Offer Request from CRM, can respond, set per-requirement Access, hand out and review tasks, link projects, share requirements with departments, and send Technical Offers to the BD team.
- **Members** see only the requirements a head opened to them or gave them a task on.
- **Can create Technical Offers** — ticked members may create and edit Technical Offer drafts on any TOR (heads always can).
- Until a team is saved, every R&D user acts as head.

| Field | Type | Rules |
|---|---|---|
| Person (row) | Name; warning if deactivated or no longer has R&D access | Must be active and have R&D app access, listed once. |
| Can create Technical Offers | Tick box | Always ticked and locked for heads. |
| Role | Dropdown | R&D Head or Member. |
| Remove | Button | Removes the row. |
| Add person (R&D access only) | Searchable dropdown | Only active users with R&D access. The first person added becomes Head. |

**Save team** saves the whole list ("Saved."). Rules: at least one head; a non-admin head cannot remove themselves as head. The change is recorded in the audit log.

There are no other masters in R&D. Calculator defaults are fixed in the code.

## 5. Permissions

App access "rnd" is required for every R&D page and endpoint. Tab and action keys (Permission Matrix, module R&D):

| Key | Actions | What it gates |
|---|---|---|
| rnd:dashboard | view | Dashboard tab and its numbers |
| rnd:project_work | view, edit | Ongoing Projects category in My Tasks (the old Ongoing Projects page now redirects to the company-wide page) |
| rnd:requirements | view, create, edit | Requirements tab, requirement endpoints, Settings tab visibility |
| rnd:projects | view, create, edit, delete, approve | Prototype / Research list, New Project, Edit, Delete, project tasks |
| rnd:experiments | view, create, edit, delete | Experiments pages |
| rnd:prototypes | view, create, edit, delete, approve | Prototypes pages; approve = Release BOM to Production |
| rnd:documents | view, create, edit, delete | Document upload (create, or rnd:projects edit) and delete |
| rnd:all | view | Engineering Tools tab (landing) |
| rnd:braking, rnd:hydraulic, rnd:qmax, rnd:load_distribution, rnd:tractive_effort, rnd:vehicle_performance, rnd:spline | view, create, print | Each calculator page and its calculation/report endpoints |
| rnd:history | view, delete, export | Calculation History; delete button |

Role rules inside the module:

- **Requirements:** R&D heads (from Settings) and admins have every right on every requirement. Others need a per-requirement Access row: View, Download, Upload, Respond. A task assignment grants View + Download automatically. People in Design, Electrical and Hydraulic & Pneumatic (with their department's requirements permission) work on requirements shared with their department.
- **Responding to CRM:** the person the request is assigned to; for a team request, anyone with Respond (heads always); admins.
- **Technical Offers:** create/edit/delete draft/revise — heads and members ticked "Can create Technical Offers"; Send to BD Team — R&D head only.
- **Requirement tasks:** anyone who can open the requirement creates tasks; the task creator and the R&D head review, edit, reopen, cancel and decide approvals; only the assignee completes, updates, re-dates, asks for approval or creates sub-tasks.
- **Project tasks and files:** project leads and admins create top-level tasks, review every task and delete project files; tasks go to Team Members only.
- **Data scope:** projects, experiments, prototypes, documents and saved calculations follow the central R&D data scope (owner = creator/uploader; assigned = project lead and team members; experiments, prototypes and documents inherit their project's team). Calculation History shows the user's own calculations; admins can view all users.
- **Settings:** only R&D heads and admins can change the team.

## 6. Documents, Notifications & Integrations

### Generated documents

- **Technical Offer** (Word, letterhead, managed document stored in SharePoint folder RnD-TechnicalOffers): created from the requirement, edited in Word Online, frozen once sent to BD, copied and renumbered on revision. The Word panel offers Create Word, Edit in Word, Upload revised .docx and Download .docx, and summarises edits made in Word.
- **Calculator reports:** Braking (Word .docx and PDF), Hydraulic (Word .docx and PDF), Qmax (Word), Load Distribution (Word), Tractive Effort (Word), Vehicle Performance (Word), Spline (Word and PDF). Most tools also export inputs/results as CSV.
- **R&D response documents** to CRM are stored in SharePoint with the CRM record (folder crm/[source]/[id]/rnd-response) and are visible on both sides.
- Project, experiment and prototype documents are stored in SharePoint; deleting one deletes the file.

### Notifications (bell; Teams only where noted)

| Event | Who is notified |
|---|---|
| R&D responds to a Technical Offer Request | The CRM user who sent the request |
| Technical Offer sent to BD | The CRM record's creator ("Technical Offer [no.] received from R&D") |
| Access granted on a requirement | The person given access |
| Requirement shared with a department | That department's people (replaces an unanswered earlier request) |
| Department replies with feasibility | R&D side of the requirement |
| New task / sub-task on a requirement | The assignee, and the assignee's department head(s) (or the R&D heads) |
| New task / sub-task on a project | The assignee |
| Task re-dated, completed, updated (requirement or project) | The task creator, and for project top-level tasks the project leads |
| Task edited, reopened or cancelled | The assignee |
| Approval requested on a task | The task creator / head / lead — **bell and Microsoft Teams** |
| Approval approved or rejected | The person who asked |
| Tagged in the requirement discussion | The tagged person |

### Links to other modules

- **CRM:** requirements come from CRM Inquiries/Tenders ("Send Technical Requirement to R&D"); the R&D response and the released Technical Offer go back to CRM, where BD picks the offer in the quotation's Technical Offer field; the Discussion thread is shared with CRM.
- **Design, Electrical, Hydraulic & Pneumatic:** requirements are shared with these departments for a feasibility reply; they see the requirement, tasks, documents and discussion from their own Requirements pages.
- **Projects (Project Management):** My Tasks includes Ongoing Project milestone tasks; the old R&D Ongoing Projects link redirects to /dashboard/ongoing-projects.
- **Store (Item Master):** prototype BOM lines and the release product are picked from the Item Master (read-only lookup available to R&D users).
- **Production:** "Release BOM to Production" creates a draft Production BOM from a Validated prototype; Production adds routing and activates it.
