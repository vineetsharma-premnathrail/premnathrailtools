# Electrical Module

The Electrical module runs the electrical scope of every RRV (rail-road vehicle) the company builds. Each RRV gets one **RRV Electrical Job** (number format ELJ-YEAR-0001). The job carries the customer's electrical requirement and tracks 20 fixed scope stages in five phases: Design & Engineering, Procurement, Assembly & Installation, Testing & QC, and Commissioning & Handover. Under each job the team keeps the electrical BOM, panels, the cable schedule, revision-controlled drawings, factory and commissioning test records, a troubleshooting log and documents. Most stages can only be completed once the evidence for them exists; the system checks this. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance), Electrical is the "E" of Design/EHP. It receives feasibility requests from R&D (Requirements tab). It can link a job to an ERP machine. It feeds Store/Purchase by linking BOM lines to Store items and Procurement purchase requisitions (PRs). It hands its final inspection to the Quality module. It also records commissioning and handover of the RRV's electrical system.

## 1. Navigation Tabs

The module sub-nav (ElectricalNav) sits at the top of every Electrical page. A tab is hidden when the user's role has no view right on that subtab. A Guided Tour button and the Notification Bell sit at the right end of the nav.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/electrical | KPI cards, open jobs by phase, handovers due soon and recent jobs |
| Requirements | /dashboard/electrical/requirements | Customer requirements the R&D head shared with Electrical for a feasibility reply |
| RRV Jobs | /dashboard/electrical/jobs | List of RRV electrical jobs; each row opens the job page with its 10 tabs |
| Drawings | /dashboard/electrical/drawings | Drawing Register: every electrical drawing on every job |
| Purchase Req. | /dashboard/electrical/purchase | BOM lines across all jobs that still need buying |
| Testing | /dashboard/electrical/testing | Electrical Test Register: factory and commissioning tests across all jobs |
| Troubleshooting | /dashboard/electrical/troubleshooting | Fault log across all jobs |

Two more routes exist but are not in the nav:
- /dashboard/electrical/project-work is an old link. It redirects to the company-wide Ongoing Projects page (/dashboard/ongoing-projects) and keeps any ?id= parameter.
- /dashboard/electrical/approval/[entityType]/[id] is the landing page for approval links (see section 3).

## 2. Dashboard

Route: /dashboard/electrical. The data comes from one backend call (GET /electrical/dashboard). Every count covers only jobs inside the user's data scope (see section 5). The page header reads "Electrical Module / Electrical Dashboard".

**Actions (header):** the **+ New RRV Electrical Job** button opens /dashboard/electrical/jobs/new.

If the dashboard fails to load, a red error banner shows the real error message.

### KPI row 1

| Card | Value shown | How it is computed | Click action |
|---|---|---|---|
| Active Jobs | Number of jobs with status In Progress | Count of jobs by status. Sub-line: "N draft · N on hold" | Opens RRV Jobs list |
| Overdue | Number of open jobs past their target handover date | Open = Draft, In Progress or On Hold, with a target handover date before today. Shown in red when above 0 | None |
| Handed Over | Number of jobs with status Handed Over | Sub-line "Awaiting as-built / close" | None |
| Awaiting QC | Number of Quality inspections still pending or in progress | Counts the final inspections linked to open jobs whose Quality status is pending or in_progress | None |

### KPI row 2

| Card | Value shown | How it is computed | Click action |
|---|---|---|---|
| Drawings to Approve | Number of drawings that have a revision in "submitted" (Awaiting Approval) status | Distinct drawings, on open and handed-over jobs | Opens Drawing Register |
| Components to Buy | BOM lines with procurement status "To Buy" (required) | Lines on open and handed-over jobs. Sub-line "BOM lines with no PR yet" | Opens Purchase Requirements |
| Failed Tests | Failed tests that have no retest recorded against them | Open and handed-over jobs. Sub-line "Awaiting a passing retest" | Opens Test Register |
| Open Issues | Issues with status Open or Investigating | Open and handed-over jobs. Sub-line shows "N critical" when any critical issue is open, otherwise "Troubleshooting log" | Opens Troubleshooting |

### Open jobs by phase

A horizontal bar for each of the five phases (Design & Engineering, Procurement, Assembly & Installation, Testing & QC, Commissioning & Handover). It shows how many open jobs (Draft / In Progress / On Hold) are currently in that phase. A job's current phase is the phase of its first stage, in sequence order, that is not yet Completed or N/A. The bars are scaled to the largest phase count.

**Actions:** none.

### Handover due in the next 14 days

Up to 8 open jobs whose target handover date is on or before today + 14 days, soonest first. Jobs already past their date are included. Each row shows: job number, title with the current stage name, stages done / total, target handover date (in red when overdue) and a status pill. When there are none, the card reads "No handovers due in the next two weeks."

**Actions:** clicking a row opens that job's page.

### Recent jobs

The 8 most recently created jobs (any status), in the same row format. When there are no jobs, the card reads "No electrical jobs yet — create one for each RRV whose electrical system you're building."

**Actions:** clicking a row opens that job's page.

## 3. Screens

### Requirements — /dashboard/electrical/requirements

This is a shared component that Design, Electrical and Hydraulic & Pneumatic all use. It lists the customer requirements (CRM inquiries or tenders) that the R&D head shared with Electrical, asking for a feasibility reply.

#### List view

Header text: "Customer requirements the R&D head shared with Electrical for your feasibility reply." It is followed by the count awaiting reply and, in red, how many of those are overdue.

| Column | What it shows |
|---|---|
| Requirement | Offer number (or the inquiry/tender universal id when there is no offer number), with the requirement title below |
| Customer | Customer organisation name |
| R&D asks | R&D's note to Electrical (first 2 lines), with who shared it and when |
| Reply by | Due date for the reply; red when overdue |
| Status | Chip: Awaiting reply (blue), Reply overdue (red), the reply given (Feasible / Feasible with changes / Not feasible), or "Replaced by newer request" (grey) |

- **Search:** free text over offer number, universal id, title, customer name and R&D's note. It runs on the screen, in the browser.
- **Filter pills:** Awaiting reply (the default), Replied, All.
- **Row click:** opens the requirement detail page.
- Empty states: "R&D hasn't shared any requirement with Electrical yet." or "Nothing matches — clear the search or pick another filter."

### Requirement detail — /dashboard/electrical/requirements/[ref]

The page URL carries a signed reference, not a raw id. If someone edits the link, the page shows "Invalid link" with a "Back to requirements" button.

#### View page

**Header:**
- offer number, Inquiry or Tender with its universal id, and priority
- the requirement title
- the customer name and when it was shared
- a **← Back** button that returns to the Requirements list

**Status strip:**
- who shared it with Electrical and the reply-by date (or "no reply-by date")
- "you can reply" when the user is allowed to reply
- the status chip
- a **Reply →** button (shown when the user can reply) that jumps to the Reply to R&D tab

**Warning banner:** shown when CRM has edited the requirement since it was last sent to R&D. It says the Requirement tab shows the current CRM values.

The page has five tabs. A ?tab=tasks / documents / discussion / reply parameter in the URL opens that tab directly.

**Requirement tab** (read-only):
- **What R&D needs from Electrical:** R&D's note, who shared it and when, the reply-by date, and "overdue" when late.
- **Technical Offer Request to R&D:** the offer number it was sent as, when it was sent, and links to the Technical Offer Request files. A file opens in the browser.
- **Customer card:** organisation, type, city / state. A contact person block (name, designation, department, mobile, email) appears when there is a contact.
- **From CRM card:** BD Owner, CRM Status, Priority.
- **Product Requirement** (for an inquiry) or **Tender Details** (for a tender): every requirement field from CRM. Empty values show "Not provided".

**Tasks & Departments tab:** the same task list R&D works in for this requirement. What the user can do depends on their access to the requirement.

**Documents tab:** the requirement's shared documents. Each department decides who sees its own files.

**Discussion tab:** the requirement's discussion thread, posted from the Electrical side.

**Reply to R&D tab:**
- If R&D sent a newer request, a note says this one no longer needs a reply.
- If Electrical has already replied, the tab shows the reply (response, who, when, remarks, attached files).
- If the request is open and the user may reply, the reply form shows:

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Response | Button choice | Yes | Feasible / Feasible with changes / Not feasible | Must pick one before sending |
| Remarks | Long text | Yes, unless the response is Feasible | Free text | The placeholder changes with the response |
| Attach files | File (multiple) | No | Any file | A "remove" link clears the picked files |

- **Send reply to R&D** sends the reply to the R&D head. A reply cannot be edited afterwards; if something changes, R&D shares the requirement again.
- A user without the edit right sees: "Replying needs the 'edit' right on Electrical › Requirements".
- **Earlier requests on this requirement:** a history list showing each earlier request's status chip, date, sender, note and reply.

### RRV Jobs — /dashboard/electrical/jobs

Page title: "RRV Electrical Jobs".

#### List view

| Column | What it shows |
|---|---|
| Job No. | Job number, e.g. ELJ-2026-0001 |
| Title / RRV | Job title, with RRV model · vehicle/serial number below |
| Customer | Customer name |
| Lead Engineer | Lead engineer's name |
| Current Stage | The first stage not yet done, with its phase below (Design / Procurement / Assembly / Testing & QC / Handover). Shows "All stages done" in green when every stage is done |
| Progress | Green progress bar, plus stages done / total |
| Target Handover | Target handover date; red and bold when overdue |
| Priority | Pill: Low / Normal / High / Urgent |
| Status | Pill: Draft / In Progress / On Hold / Handed Over / Closed / Cancelled |
| (action) | **View** link |

**Filters** (each change reloads the list from the server):
- **Search box:** job number, title, RRV model, vehicle number or customer name.
- **Status dropdown:** "Open (draft / active / hold)" (the default), "All statuses", or one status.
- **Phase dropdown:** "Any phase" or one phase. Only open jobs whose current phase matches are shown.
- **My jobs checkbox:** only jobs where the user is the lead engineer or owns at least one stage.

**Sort:** newest created first.

**Row actions:** clicking the row, or **View**, opens the job page.

**Top button:** **+ New Job** opens the create form.

**Empty state:** "No electrical jobs match. Create one for each RRV whose electrical system you're building."

### New RRV Electrical Job — /dashboard/electrical/jobs/new

The header explains that the job is created with all 20 scope stages ready to plan. A **← Back** button returns to the jobs list.

#### Create form

The same form is used for create and edit (JobForm). It has two sections.

**Section "RRV & Job"**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Job Title | Text | Yes | Free text, e.g. "RRV-450 electrical — Northern Railway" | Up to 255 characters. Error if blank: "Enter a title for the job…" |
| Priority | Dropdown | No (default Normal) | Low, Normal, High, Urgent | Must be one of these |
| RRV / Machine (ERP) | Search box + searchable dropdown | No | ERP machines (ERP Projects). Shows the newest 200; typing searches serial number, model or customer on the server | Label is "serial — model (customer)". The machine must exist and not be deleted |
| RRV Model | Text | No | Free text | Up to 150 characters. Filled from the ERP machine on save if left blank |
| Vehicle / Serial No. | Text | No | Free text | Up to 100 characters. Filled with the machine's serial number when a machine is picked and this field is blank |
| Customer | Text | No | Free text | Up to 255 characters. Filled with the machine's customer when a machine is picked and this field is blank |
| Plant | Dropdown | No | Branches (Organization) | The plant must exist |
| Lead Engineer | Searchable dropdown | No | Active users | The user must be active |
| Planned Start | Date | No | Date picker | |
| Target Handover | Date | No | Date picker | Cannot be before Planned Start (checked on screen and on the server) |

**Section "Electrical Requirement"** (this is stage 1 of the job)

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| System Voltage | Text | No to save; needed to complete the Requirement stage | e.g. "24 V DC" | Up to 50 characters |
| Battery | Text | No | e.g. "2 × 12 V 150 Ah" | Up to 255 characters |
| Alternator / Charger | Text | No | e.g. "28 V 100 A" | Up to 255 characters |
| Applicable Standards | Text | No | e.g. "RDSO spec, IS/IEC references" | Up to 500 characters |
| Customer Spec Ref. | Text | No | Free text | Up to 255 characters |
| Requirement | Long text | No to save; needed to complete the Requirement stage | Loads and circuits the customer needs | |
| Remarks | Long text | No | Free text | |

Buttons: **Cancel** (back to the list) and **Create Job**.

When the job is saved:
- The job is created in status Draft with the next ELJ-YEAR-NNNN number. Numbers restart each year.
- All 20 stages are created as Not Started.
- The user is taken to the new job's page.
- If a lead engineer other than the creator is set, that person gets a bell notification, "Electrical Job Assigned".

If the plant, user or machine lists fail to load, a banner explains this. The job can still be saved without that field.

### RRV Electrical Job page — /dashboard/electrical/jobs/[ref]

The URL uses a signed reference. An edited or broken link shows "Invalid link" with "Back to jobs". A ?tab= parameter opens a specific tab. Switching tabs updates the URL.

#### View page

**Header:**
- the label "Electrical Module · RRV Electrical Job"
- the job number
- pills for status, priority and Overdue (when past the target handover)
- a line with the title · RRV model · vehicle number · customer
- a **← Back** button that returns to the jobs list

**Banners:**
- a purple "On hold: reason" banner when the job is on hold
- a red "Cancelled: reason" banner when the job is cancelled
- green notice banners after successful actions, and red error banners with the server's real reason

**Job action buttons:**

| Button | When it appears | What it does |
|---|---|---|
| Close Job | Status is Handed Over | Asks for confirmation. It warns that closing makes all records final. Every stage must be Completed or N/A, or the server refuses and lists the stages still open. Status becomes Closed and the closed time is recorded |
| Resume Job | Status is On Hold | Asks for confirmation. The status goes back to In Progress if the job was ever started, otherwise to Draft. The hold reason is cleared |
| Put On Hold | Status is Draft or In Progress | Asks for a reason (required). Status becomes On Hold. Stage work and child-record changes are frozen |
| Cancel Job | Status is Draft, In Progress or On Hold | Asks for a reason (required). Status becomes Cancelled. A cancelled job cannot be reopened |
| Delete Draft | Status is Draft, no stage has been completed, and the user has Delete on RRV Electrical Jobs and created the job (admins always) | Asks for confirmation, then soft-deletes the job and returns to the list. The server also refuses if any stage has moved from Not Started |

**Phase tracker:**
- "N% complete · X of 20 stages"
- "Next up: current stage" (or "Every stage is done.") and the target handover date
- a coloured progress bar for each phase, with "done / total" under it; the current phase is bold

**Tabs** (in order). Counts appear in the tab labels.

| Tab | Label shows |
|---|---|
| Stages | Stages (done/total) |
| Details & Requirement | |
| BOM | BOM (line count) |
| Panels | Panels (count) |
| Cables | Cables (count) |
| Drawings | Drawings (count) |
| Tests | Tests (factory + commissioning count) |
| Troubleshooting | Troubleshooting (N open), shown only when issues are open |
| QC & Handover | |
| Documents | Documents (count) |

**Who can change things on the tabs:**
- Records under the job can be changed only while the job is Draft, In Progress or Handed Over (the "working" statuses). On Hold, Closed and Cancelled jobs are read-only.
- The server returns a clear message when someone tries anyway, e.g. "Job ELJ-… is on hold, so you can't … Resume the job first."

#### Stages tab

Help text: "Stages can run in parallel. A stage completes once its evidence is in place — what's still missing is listed under it." A **Show completed stages** checkbox (on by default) hides or shows stages that are Completed or N/A.

Stages are grouped into five phase cards. Each card header shows the phase name and a "done / total done" pill. Each stage row shows:
- a circle with the stage sequence number, or a tick when completed
- the stage label and a status pill (Not Started / In Progress / Completed / N/A)
- "Required" for the 4 mandatory stages, and an Overdue pill when the planned end date has passed and the stage is not done
- Owner, Plan (planned start → planned end), and "Completed / Waived date by name"
- the stage remarks
- a yellow blocker box listing everything still missing (the gate problems), with a **Go to [tab] →** shortcut to the tab where the evidence is entered

The 20 stages, with what each needs before **Complete** is allowed:

| # | Stage | Phase | Gate (must be true before completing) | Shortcut tab |
|---|---|---|---|---|
| 1 | Electrical Requirement (mandatory) | Design & Engineering | System voltage filled in and requirement text written | Details & Requirement |
| 2 | Electrical System Design | Design & Engineering | No gate (engineer's word) | — |
| 3 | Electrical Schematics | Design & Engineering | A drawing of type Electrical Schematic or Single Line Diagram has an approved revision | Drawings |
| 4 | Component Selection | Design & Engineering | BOM has lines, and every line is at least Selected with make and part number | BOM |
| 5 | Electrical BOM (mandatory) | Design & Engineering | At least one BOM line | BOM |
| 6 | Cable / Wiring Design | Design & Engineering | At least one cable in the schedule | Cables |
| 7 | Panel Design | Design & Engineering | At least one panel (or mark N/A if the vehicle has no panel) | Panels |
| 8 | Component Specification | Design & Engineering | BOM has lines, and every line has a rating or specification | BOM |
| 9 | Electrical Drawing / Revision | Design & Engineering | At least one drawing; every drawing has an approved revision; no drawing has an open (draft or submitted) revision | Drawings |
| 10 | Purchase Requirement | Procurement | BOM has lines, and no line is still To Buy | BOM |
| 11 | Electrical Assembly | Assembly & Installation | No gate | — |
| 12 | Wiring / Harness Installation | Assembly & Installation | Cables exist, and every cable is Installed, Terminated or Tested | Cables |
| 13 | Panel Assembly | Assembly & Installation | Panels exist, and every panel is Assembled, Tested or Installed (or mark N/A) | Panels |
| 14 | Electrical Testing (mandatory) | Testing & QC | At least one factory test, and every failed factory test has a passing retest | Tests |
| 15 | Inspection & QC | Testing & QC | A Quality inspection was requested and Quality has Passed or Conditionally Passed it | QC & Handover |
| 16 | Troubleshooting | Testing & QC | No issue is Open or Investigating | Troubleshooting |
| 17 | Commissioning | Commissioning & Handover | Commissioning date entered, at least one commissioning test, and every failed commissioning test has a passing retest | QC & Handover |
| 18 | Final Electrical Documentation | Commissioning & Handover | At least one document of category Test Report, Commissioning Report or O&M Manual, and no drawing has an open revision | Documents |
| 19 | RRV Electrical Handover (mandatory) | Commissioning & Handover | Every other stage (except As-Built Records) is Completed or N/A, and "Handed over to" and "Handover date" are filled in | QC & Handover |
| 20 | As-Built Electrical Records | Commissioning & Handover | At least one drawing marked As-built has an approved revision | Drawings |

Stage buttons. They are shown only while the job is in a working status (Draft, In Progress or Handed Over), except Plan:

| Button | When it appears | What it does |
|---|---|---|
| Start | Stage is Not Started | Stage becomes In Progress and its start time is recorded. A Draft job becomes In Progress |
| Complete | Stage is not done | Disabled, with the tooltip "Clear the items listed under this stage first", while blockers exist. Opens a dialog with an optional completion note. The server checks the gate again. The stage becomes Completed with the time and user recorded. Completing "RRV Electrical Handover" moves the job to Handed Over, records the handed-over time and notifies the lead engineer ("RRV Electrical Handed Over") |
| N/A | Stage is not done and not mandatory | Asks for a reason (required). The stage becomes N/A (counts as done) and its remarks become "Not applicable: reason". Mandatory stages (Requirement, Electrical BOM, Electrical Testing, Handover) are refused |
| Reopen | Stage is Completed or N/A | Asks for confirmation. The stage goes back to In Progress (or Not Started if it was never started) and the completion data is cleared. Reopening a Handover stage on a Handed Over job sends the job back to In Progress |
| Plan | Job is not Closed or Cancelled | Opens the Plan dialog |

Plan dialog fields:

| Field | Type | Required | Source | Rules |
|---|---|---|---|---|
| Owner | Searchable dropdown | No | Active users | The new owner gets a bell notification, "Electrical Stage Assigned" (not when assigning yourself) |
| Planned Start | Date | No | | |
| Planned End | Date | No | | Cannot be before Planned Start |
| Remarks | Long text | No | | |

#### Details & Requirement tab

Read-only view in two cards.

| Field | Meaning |
|---|---|
| RRV / Machine (ERP) | Linked ERP machine, shown as "serial — model (customer)" |
| RRV Model | RRV model |
| Vehicle / Serial No. | Vehicle or serial number |
| Customer | Customer name |
| Plant | Plant (branch) |
| Lead Engineer | Lead engineer |
| Planned Start | Planned start date |
| Target Handover | Target handover date |
| Started | When the first stage was started (or a QC inspection requested) |
| Created by | Creator name and creation time |
| System Voltage, Battery, Alternator / Charger, Applicable Standards, Customer Spec Ref. | Electrical requirement values |
| Requirement | Requirement text ("Not written down yet." when empty) |
| Remarks | Shown only when filled |

The **Edit Details & Requirement** button appears unless the job is Closed or Cancelled.

#### Edit (job details)

- Edit opens the same JobForm as create, with all fields editable, and **Save Changes** / **Cancel** buttons.
- Allowed in every status except Closed and Cancelled; On Hold is allowed.
- The same validation as create applies. Target handover is checked against the stored planned start.
- Changing the lead engineer to someone else sends that person an "Electrical Job Assigned" notification.
- On save, the notice "Job details saved." is shown.

#### BOM tab

Purpose: one list that covers four stages: Electrical BOM, Component Selection (make and part number), Component Specification (rating and spec) and Purchase Requirement (procurement status and the linked PR).

**Header:**
- "Electrical BOM"
- a summary: N lines · N to buy (red when above 0) · Est. cost in ₹ (sum of quantity × estimated unit cost)
- a help line about Raise PR / Link PR and about marking Selected only after entering make and part number

**List:**

| Column | What it shows |
|---|---|
| # | Line number (assigned automatically, 1, 2, 3 … per job) |
| Category | Component category |
| Description | Description, with the Store item code and rating below |
| Make / Part No. | Make, with the part number below (or "No part number") |
| Qty | Quantity and unit of measure |
| Panel | Tag of the panel the component is mounted in |
| Selection | Pill: Proposed / Selected / Approved. Shows an "Awaiting approval · Review" link when an approval request is pending |
| Procurement | Pill: To Buy / In Stock / PR Raised / Ordered / Received / Issued, with the PR number and PR status below |
| (actions) | Shown only while the job is in a working status |

**Row actions:**

| Action | When it appears | What it does |
|---|---|---|
| Edit | Always (working job) | Opens the BOM line form |
| Submit for approval | Line is Selected, no pending request, and the user has Submit on RRV Electrical Jobs | Sends the line's make and part number to the central approval engine (see Statuses) |
| Link PR | Line has no PR | Opens the Link PR dialog |
| Unlink PR | Line has a PR | Asks for confirmation. Removes the link (the PR itself stays in Procurement). A line at PR Raised or Ordered goes back to To Buy |
| Raise PR | Line is To Buy and the user has the Procurement (P2P) app | Opens a new purchase requisition (/dashboard/p2p/new) pre-filled with the Store item, make, quantity (rounded up) and the remark "Electrical BOM line N for job (title)". If the line has no Store item, an error explains that the Item Master item must be linked first |
| Delete | Always (working job) | Asks for confirmation, then soft-deletes the line. Refused when the line is already Ordered, Received or Issued. Any pending approval request is withdrawn |
| Review (link) | A pending approval exists | Opens the approval panel for the line |

**Top button:** **+ Add Component** (working job only).

**Create / edit form** ("Add Component" / "Edit BOM Line N"):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Category | Dropdown | Yes (default Other) | Battery, Alternator / Charger, MCB / Fuse / Protection, Relay / Contactor, Switch / Push Button, Lamp / Lighting, Meter / Instrument, Sensor, Controller / PLC, Cable / Wire, Connector / Terminal, Enclosure / Box, Accessory / Hardware, Other | Must be one of these |
| Store Item (optional) | Search box + searchable dropdown | No | Active Store items (Item Master). The first 500 are listed; typing searches code, name or part number | Picking one fills Description (if blank) and UOM (if blank or NOS) from the item |
| Description | Text | Yes | Free text, e.g. "MCB 2-pole 16A, Type C" | Up to 255 characters |
| Make | Text | Needed for Selected / Approved | e.g. "Schneider" | Up to 150 characters |
| Part Number | Text | Needed for Selected / Approved | Free text | Up to 150 characters |
| Rating | Text | No (rating or specification needed for the Component Specification stage) | e.g. "24V DC, 16A" | Up to 150 characters |
| Specification | Long text | No | Standards, IP rating, mounting… | |
| Quantity | Number | Yes (default 1) | | Must be greater than 0 |
| UOM | Text | Yes (default NOS) | | Up to 20 characters |
| Est. Unit Cost (₹) | Number | No | | 0 or more |
| Panel | Dropdown | No | This job's panels, shown as "tag — name". "— Not panel-mounted —" | The panel must belong to this job |
| Selection | Dropdown | Yes (default Proposed) | Proposed, Selected, and Approved (Approved is listed only for users with Approve on RRV Electrical Jobs) | Selected / Approved need both make and part number |
| Procurement | Dropdown | Yes (default To Buy) | Without a linked PR: To Buy, In Stock, Received, Issued. With a linked PR: PR Raised, Ordered, Received, Issued. The line's current value is always kept in the list | PR Raised and Ordered are refused unless a PR is linked |
| Remarks | Text | No | | |

Notes on the form:
- When no panels exist, a hint says to add them on the Panels tab first.
- While a line's selection is awaiting approval, its make, part number and selection status cannot be changed.
- A user with approve rights who sets Selection to Approved (or changes the make or part number of an approved line) does a one-step "submit and approve" through the approval engine.

**Link PR dialog:**
- A search box (PR number or project) and a dropdown of live requisitions, meaning not draft, rejected or cancelled. The newest 100 are listed, with Electrical-category PRs first.
- The PR must exist and must not be rejected or cancelled.
- Linking moves a To Buy or In Stock line to PR Raised.
- Allowed for users with Edit on RRV Electrical Jobs or Edit on Purchase Requirements.

#### Panels tab

Purpose: covers the Panel Design and Panel Assembly stages. Header: "Panels" with "N panels · N assembled".

| Column | What it shows |
|---|---|
| Tag | Panel tag (stored upper-case) |
| Name | Name, with dimensions below |
| Type | Panel type |
| Location | Location on the vehicle |
| Enclosure / IP | Enclosure material · IP rating |
| Components | Number of BOM lines mounted in this panel |
| Status | Pill. On a working job there is also an inline status dropdown that saves straight away |
| Assembled | Who assembled it and the date |
| (actions) | **Edit**, **Delete** (working job only) |

**Top button:** **+ Add Panel**.

**Form** ("Add Panel" / "Edit Panel TAG"):

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Panel Tag | Text | Yes | e.g. MCP-01 | Up to 50 characters. Converted to upper case. Must be unique on the job |
| Name | Text | Yes | e.g. Main Control Panel | Up to 150 characters |
| Panel Type | Dropdown | Yes (default Control Panel) | Main Distribution Panel, Control Panel, Driver Console / Desk, Junction Box, Battery Box, Lighting Panel, Other | |
| Location on Vehicle | Text | No | e.g. Driver cabin, LHS | Up to 150 characters |
| Enclosure Material | Text | No | e.g. CRCA, SS304 | Up to 100 characters |
| IP Rating | Text | No | e.g. IP65 | Up to 20 characters |
| Dimensions | Text | No | W × H × D mm | Up to 100 characters |
| Status | Dropdown | Yes (default Designed) | Designed, In Assembly, Assembled, Tested, Installed | |
| Remarks | Long text | No | | |

- Moving a panel to Assembled, Tested or Installed records the current user as assembler, with the time, if not already recorded. Moving it back below Assembled clears that record.
- **Delete** asks for confirmation. It is refused while BOM lines are mounted in the panel.

#### Cables tab

Purpose: the cable schedule, covering the Cable / Wiring Design and Wiring / Harness Installation stages. Header: "Cable Schedule" with "N of M installed" (Installed, Terminated or Tested count as installed).

**Filters** (applied on screen):
- Search over tag, circuit, from, to and harness
- Status dropdown
- Harness dropdown: all harnesses, "— No harness —", or each harness reference used on the job
- a **Clear** button when any filter is set
- a totals line: "N of M cables · Total length X m" (for the visible rows)

| Column | What it shows |
|---|---|
| (checkbox) | Bulk selection (working job only); the header box selects all visible rows |
| Tag | Cable tag |
| Circuit | Circuit name |
| From → To | Start and end points |
| Cable | "cores × size mm²", with cable type · voltage rating below |
| Length m | Length in metres |
| Harness | Harness reference |
| Colour | Colour code |
| Status | Pill: Designed / Cut / Harnessed / Installed / Terminated / Tested |
| (actions) | **Edit**, **Delete** (working job only) |

**Bulk bar:** appears when rows are selected. It shows "N selected", a "Set status to…" dropdown, **Apply to N cables** and **Clear selection**. It moves all selected cables to one status at once, which is how a whole harness is recorded as going in.

**Top button:** **+ Add Cable**.

**Form** ("Add Cable" / "Edit Cable TAG"):

| Field | Type | Required | Rules |
|---|---|---|---|
| Cable Tag | Text | Yes | e.g. W-101. Up to 50 characters, upper-cased, unique on the job |
| Circuit | Text | No | Up to 150 characters |
| Harness Ref | Text | No | e.g. H-01. Up to 50 characters |
| From | Text | Yes | Up to 150 characters |
| To | Text | Yes | Up to 150 characters |
| Cable Type | Text | No | e.g. FRLS PVC. Up to 100 characters |
| Cores | Number | No | Whole number from 1 to 200 |
| Size mm² | Number | No | Greater than 0 |
| Length m | Number | No | Greater than 0 |
| Voltage Rating | Text | No | e.g. 1.1 kV. Up to 50 characters |
| Colour Code | Text | No | Up to 50 characters |
| Status | Dropdown | Yes (default Designed) | Designed, Cut, Harnessed, Installed, Terminated, Tested |
| Remarks | Text | No | |

**Delete** asks for confirmation, then soft-deletes the cable.

#### Drawings tab

Purpose: the revision-controlled drawing register behind the Electrical Schematics, Electrical Drawing / Revision and As-Built Electrical Records stages.

**Header:**
- summary: N drawings · N awaiting approval · N as-built approved
- help text: the Schematics stage needs an approved schematic or single line diagram; the As-Built stage needs approved drawings marked as-built

Each drawing is a row that expands when clicked. The row shows:
- drawing number, title and an As-built pill
- type · number of revisions · "Approved: Rx" (or "No approved revision" in red)
- the latest revision label and a status pill

**Drawing actions** (working job only):

| Action | When it appears | What it does |
|---|---|---|
| New Revision | No revision is Draft or Submitted | Opens the New Revision dialog |
| Edit | Always | Opens the Edit dialog |
| Mark as-built / Unmark as-built | Always | Toggles the as-built flag |
| Delete | User has Delete on Drawings and created the drawing (admins always) | Asks for confirmation. Refused if any revision is Approved or Superseded. Deletes the drawing and all its revisions, and withdraws any pending approval |

When a drawing is expanded, its description and a revisions table (newest first) appear:

| Column | What it shows |
|---|---|
| Rev | R0, R1, R2 … |
| Status | Draft / Awaiting Approval / Approved / Rejected / Superseded |
| Change summary | What changed |
| File | File name and size (opens in a new browser tab), or "No file yet" |
| Prepared by | Revision author |
| Submitted | Submission time |
| Decision | Who decided, when, and the comment |
| (actions) | See below |

**Revision actions:**

| Action | When it appears | What it does |
|---|---|---|
| Upload file / Replace file | Revision is Draft; the user is the preparer, an admin, or the revision has no preparer | Picks a file (.pdf, .dwg, .dxf, .png, .jpg, .jpeg). It is stored in SharePoint under Electrical-media/job number/drawing number; a replaced file is removed |
| Submit for approval | Revision is Draft, same users as above. Disabled until a file is attached | Status becomes Awaiting Approval and the approval engine request starts |
| Approve / Reject | Revision is Submitted, it has no approval-engine request (a revision submitted before the engine, or when no approver exists), and the user is not the preparer (admins always) | Approve asks for an optional comment. Reject needs a reason |
| Discard | Revision is Draft or Submitted, the user may prepare it, and the drawing has more than one revision | Asks for confirmation, then removes the revision and withdraws any pending approval. The only revision of a drawing cannot be discarded; delete the drawing instead |

Under the table, an **Approval panel** shows the central approval request of the latest revision. Approvers can decide there (approve, reject or return).

**Top button:** **+ Add Drawing**.

**Add Drawing form:**

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Title | Text | Yes | e.g. Main 24V DC distribution schematic | |
| Drawing type | Dropdown | Yes (default Electrical Schematic) | Electrical Schematic, Single Line Diagram, Wiring Diagram, Harness Drawing, Panel GA, Panel Wiring, Cable Schedule, Equipment Layout, Other | |
| Drawing number | Text | No | Blank = auto-numbered "JOB-NUMBER-E01", E02 … | Upper-cased, up to 80 characters, unique on the job |
| As-built drawing | Checkbox | No | | |
| Description | Long text | No | | |
| R0 change summary | Text | No (default "First issue") | | |
| File (optional) | File | No | .pdf, .dwg, .dxf, .png, .jpg, .jpeg | |

The drawing is created with revision R0 in Draft. It can be submitted only after a file is attached.

**Edit Drawing form:** Drawing number (required, unique on the job), Drawing type, Title (required), As-built checkbox, Description.

**New Revision form:** Change summary (required) and an optional file. The new revision is Draft. The next index is used (R1, R2 …). Only one open revision is allowed per drawing.

#### Tests tab

Purpose: factory tests (the Electrical Testing stage) and commissioning tests (the Commissioning stage).

**Header:**
- "Tests", with phase toggle pills **Factory (N)** and **Commissioning (N)**
- a summary for the selected phase: N tests · N passed · N open failures
- a help line explaining the stage rule for that phase

| Column | What it shows |
|---|---|
| Test No. | T-001, T-002 … (per job, never reused), with "Retest of T-00x" below |
| Type | Test type |
| Circuit / Panel / Cable | Circuit, with panel and cable tags below |
| Instrument | Instrument used |
| Expected | Expected value |
| Measured | Measured value and unit |
| Result | Pass / Fail pill, plus a "Needs retest" pill for a failure with no retest yet |
| Date | Test date |
| Tested by | Tester |
| (actions) | Working job only |

**Row actions:**
- **Record Retest:** shown when the test needs a retest.
- **Edit.**
- **Delete:** needs Delete on Testing. It is refused when a retest or an issue points at the test.

**Top button:** **+ Record Test**.

**Form** ("Record Test", "Record Retest — Retest of T-00x", or "Edit Test T-00x"):

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Phase | Dropdown | Yes | Factory, Commissioning | Can be changed only on a new test. A retest always takes the original test's phase |
| Test Type | Dropdown | Yes | Continuity, Insulation Resistance (IR), Polarity, Earth Continuity, Voltage Drop, Battery & Charging, Lighting, Functional, Load Test, High Voltage (Hi-pot), Other | Locked when editing |
| Test Date | Date | Yes (default today) | | |
| Circuit | Text | No | | Up to 150 characters |
| Panel | Dropdown | No | This job's panels | Must belong to the job |
| Cable | Searchable dropdown | No | This job's cables, shown as "tag · from → to" | Must belong to the job |
| Instrument | Text | No | e.g. Megger MIT420 | Up to 150 characters |
| Expected Value | Text | No | | Up to 100 characters |
| Measured Value | Text | No | | Up to 100 characters |
| Unit | Text | No | e.g. MΩ | Up to 20 characters |
| Result | Pass / Fail buttons | Yes | Pass, Fail | Cannot be changed when editing; record a retest instead |
| Tested By | Searchable dropdown | No | Active users | Blank = the current user |
| Remarks | Long text | No | | |

Retest rules:
- A retest copies the type, circuit, panel, cable, instrument, expected value and unit from the failed test.
- Only a failed test can be retested, and only once.
- A failed retest needs its own retest. A failure clears only when the last link in the chain passes.

#### Troubleshooting tab

Purpose: the job's fault log, used for the Troubleshooting stage.

**Header:**
- "Troubleshooting Log", with filter pills **Open (N)** (Open and Investigating) and **All (N)**
- help text: the Troubleshooting stage completes once no issue is open or investigating

Each issue appears as a card with a left border coloured by severity. The card shows:
- the issue number (ISS-001 …, per job)
- the title, a severity pill (Minor / Major / Critical) and a status pill (Open / Investigating / Resolved / Closed)
- Linked test, panel and cable
- Assigned to, "Reported by name on date", and "Resolved by name · time"
- Symptom, Root Cause and Corrective Action blocks, when filled

**Issue actions** (working job only):

| Action | When it appears | What it does |
|---|---|---|
| Start investigating | Status Open | Status becomes Investigating |
| Resolve | Status Open or Investigating | Opens the Resolve dialog: Root Cause (required) and Corrective Action (required). Status becomes Resolved, with the resolver and time recorded. The reporter is notified ("Electrical Issue Resolved") |
| Edit | Status Open or Investigating | Opens the issue form |
| Close | Status Resolved | Status becomes Closed |
| Reopen | Status Resolved or Closed | Status becomes Open and the resolution data is cleared |
| Delete | Status Open or Investigating, the user has Delete on Troubleshooting, and the user logged the issue (admins always) | Asks for confirmation, then soft-deletes. Resolved or Closed issues stay on record |

**Top button:** **+ Log Issue**.

**Form** ("Log Issue" / "Edit Issue ISS-00x"):

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Title | Text | Yes | e.g. Tail lamp flickers under load | Up to 255 characters |
| Severity | Dropdown | Yes (default Major) | Minor, Major, Critical | |
| Symptom | Long text | No | What was observed | |
| Linked Test | Dropdown | No | This job's tests, shown as "number · type · result (needs retest)" | Must belong to the job |
| Panel | Dropdown | No | This job's panels | Must belong to the job |
| Cable | Searchable dropdown | No | This job's cables | Must belong to the job |
| Assigned To | Searchable dropdown | No | Active users | The assignee gets "Electrical Issue Assigned" (not when assigning yourself) |

#### QC & Handover tab

**Closing stages:** small cards for Inspection & QC, Commissioning, Final Electrical Documentation, RRV Electrical Handover and As-Built Electrical Records. Each card shows the stage status and its first blocker.

**Inspection & QC:**
- When an inspection exists, the card shows its number and status: Inspection pending / Inspecting / Passed / Failed / Passed (conditional).
- An **Open in Quality** button appears for users who have the Quality app. It opens the inspection in Quality › Final Inspection.
- When there is no inspection, a text explains that requesting one raises a final inspection in Quality.
- **Request QC Inspection** appears on a working job when there is no inspection yet. It reads **Request Fresh QC Inspection** after a failed one. After a confirmation it:
  - creates a Quality inspection of type Final with a FIN number, status Pending, item "RRV electrical system — model/title", item code = vehicle number, batch = job number, quantity 1, and a project label
  - links the inspection to the job
  - moves the Inspection & QC stage to In Progress
  - moves a Draft job to In Progress
  - sends a bell notification to Quality app users ("Electrical QC Inspection Requested")
- The server refuses a new request while the existing inspection is not Failed.
- The stage still has to be completed by hand on the Stages tab once Quality passes the inspection.

**Commissioning:**
- Shows how many commissioning tests are recorded.
- Fields: Commissioning Location (text, up to 255 characters) and Commissioned On (date).
- **Save Commissioning** saves them. It is available on working jobs and on On Hold jobs.

**RRV Electrical Handover:**
- Shows "Handed over date-time" once the Handover stage has been completed.
- Fields: Handed Over To (text, up to 150 characters), Organisation (text, up to 255 characters), Handover Date (date), Handover Remarks (long text).
- **Save Handover Details** saves them; it is available on working and On Hold jobs. The notice then reminds the user to complete the "RRV Electrical Handover" stage on the Stages tab.

#### Documents tab

**Upload Documents** (working job only):

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Title | Text | Yes | e.g. Factory insulation test report | |
| Category | Dropdown | Yes (default Other) | Requirement / Customer Spec, Design Calculation, Component Datasheet, Test Report, Inspection Report, Commissioning Report, O&M Manual, Handover Certificate, As-Built Record, Photo, Other | |
| Stage | Dropdown | No | The 20 stages, or "— Not tied to a stage —" | Must be a valid stage |
| Description | Text | No | | |
| Files | File (multiple) | Yes | Any file | Each file becomes its own document entry with the same title. Files are stored in SharePoint under Electrical-media/job number/documents |

The **Upload** button saves the files. A hint says Final Electrical Documentation needs a Test Report, Commissioning Report or O&M Manual.

**Documents (N) list**, with a category filter:

| Column | What it shows |
|---|---|
| Title | Title, with the description below |
| Category | Category |
| Stage | Linked stage |
| File | File name (opens in a new browser tab) and size |
| Uploaded | Uploader and date |
| (action) | **Delete**, shown on a working job to the uploader or an admin. Asks for confirmation, then removes the entry and deletes the file from SharePoint |

#### Statuses & workflow

**Job status:**

| Status | Meaning | Moves to |
|---|---|---|
| Draft | Just created | In Progress (first stage started, a stage completed, or a QC inspection requested); On Hold; Cancelled; deleted (only while no stage progress exists) |
| In Progress | Work under way | On Hold; Cancelled; Handed Over (when the RRV Electrical Handover stage is completed) |
| On Hold | Frozen, with a reason | Resume returns it to In Progress (or Draft if never started); Cancelled |
| Handed Over | Handover stage completed | Closed (when every stage is Completed or N/A); In Progress (if the Handover stage is reopened) |
| Closed | Final; nothing can be changed | Terminal |
| Cancelled | Stopped, with a reason | Terminal |

All job status actions need Edit on RRV Electrical Jobs. Delete needs Delete plus being the creator (admins always).

**Stage status:** Not Started → In Progress → Completed, or Not Applicable (counts as done; needs a reason). Reopen sends a done stage back.

**BOM selection:** Proposed → Selected (make and part number entered) → Approved.
- Approval goes through the central approval engine (Organization › Approval Workflows), transaction "Electrical component selection".
- The default approver is anyone holding Approve on RRV Electrical Jobs. Self-approval is allowed.
- On approval the line becomes Approved. On reject, return or cancel it stays Selected.
- If nobody but the submitter holds the permission, a user with approve rights approves directly.

**BOM procurement:** To Buy (required) / In Stock → PR Raised (by linking a PR) → Ordered → Received → Issued. PR Raised and Ordered need a linked PR. Unlinking sends PR Raised or Ordered back to To Buy.

**Drawing revision:** Draft → Awaiting Approval (submitted) → Approved or Rejected.
- Approval goes through the approval engine, transaction "Electrical drawing revision".
- The default approver is anyone holding Approve on Drawings. The submitter can never approve their own revision (four-eyes rule).
- Approving supersedes the drawing's previously approved revision (it becomes Superseded).
- When an approver returns the request, or it is cancelled, the revision goes back to Draft.
- A rejected revision stays rejected; the author raises a new revision.
- Approvals and rejections are refused while the job is not in a working status.

**Panel:** Designed → In Assembly → Assembled → Tested → Installed (any order can be set).

**Cable:** Designed → Cut → Harnessed → Installed → Terminated → Tested (any order can be set; bulk change is allowed).

**Test result:** Pass or Fail, fixed once recorded. A Fail needs a passing retest to clear.

**Issue:** Open → Investigating → Resolved (needs root cause and corrective action) → Closed. Reopen returns a Resolved or Closed issue to Open.

### Drawing Register — /dashboard/electrical/drawings

Every drawing on every job in the user's scope, most recently updated first. Rows cannot be edited here. Revisions are submitted and approved on the job's Drawings tab.

#### List view

| Column | What it shows |
|---|---|
| Drawing No. | Drawing number |
| Title | Drawing title |
| Job | Job number, with the job title below |
| Type | Drawing type |
| Latest Rev | Latest revision label and its status pill |
| Approved Rev | Latest approved revision label (green), or a dash |
| As-built | As-built pill, or "No" |
| (action) | **View** link |

**Filters:**
- search over drawing number, title and job number
- drawing type
- latest revision status (Draft / Awaiting Approval / Approved / Rejected / Superseded)
- As-built (All / Yes / No)

**Top button:** **Awaiting approval only** is a toggle. It sets the revision-status filter to Awaiting Approval, or clears it.

**Row click / View:** opens the job page on its Drawings tab.

### Purchase Requirements — /dashboard/electrical/purchase

BOM lines that still need buying, across every Draft, In Progress, On Hold and Handed Over job in scope. Sorted by job number, then line number.

#### List view

| Column | What it shows |
|---|---|
| Job | Job number, with the title below |
| Line # | BOM line number |
| Category | Component category |
| Description | Description, with make · part number below |
| Qty | Quantity and UOM |
| Rating | Rating |
| Procurement | Procurement status pill |
| PR | Linked PR number, with the PR status below |
| (action) | **View** link |

**Filters:**
- **Search:** description, make, part number or job number. It waits 300 ms after typing before searching.
- **Status dropdown:** "Still open (To Buy / PR Raised / Ordered)" (the default), or one status: To Buy, PR Raised, Ordered, In Stock, Received, Issued.
- **Category dropdown.**

**Summary chips:** "N lines to buy" (red when above 0) and "N shown across N jobs". A hint says: "Raise the PR in Procurement from the job's BOM tab, then link it to the line."

**Row click / View:** opens the job's BOM tab.

Empty state with no filters: "Nothing left to buy — every BOM line on open jobs is in stock, received or issued."

### Electrical Test Register — /dashboard/electrical/testing

Factory and commissioning tests across all jobs in scope. Newest test date first, up to 500 rows. Tests are recorded on the job's Tests tab.

#### List view

| Column | What it shows |
|---|---|
| Test No. | Test number, with "Retest of …" below |
| Job | Job number and title |
| Phase | Factory / Commissioning |
| Type | Test type |
| Circuit | Circuit, with panel · cable tags below |
| Measured | Measured value and unit |
| Result | Pass / Fail pill, plus a "Needs retest" pill |
| Date | Test date |
| Tested by | Tester |
| (action) | **View** link |

**Filters:** phase, result, test type, and the toggle **Needs retest only** (failed tests with no retest). A counter shows "N tests · N awaiting retest".

**Row click / View:** opens the job's Tests tab.

### Troubleshooting — /dashboard/electrical/troubleshooting

Electrical faults logged across all jobs in scope. Newest first, up to 500 rows. Issues are logged and worked on the job's Troubleshooting tab.

#### List view

| Column | What it shows |
|---|---|
| Issue No. | Issue number |
| Job | Job number and title |
| Title | Issue title |
| Severity | Minor / Major / Critical pill |
| Status | Open / Investigating / Resolved / Closed pill |
| Linked | Test, Panel and Cable links |
| Assigned to | Assignee, or "Unassigned" |
| Reported | Date logged, with the reporter below |
| (action) | **View** link |

**Filters:**
- **Status:** Open (unresolved: Open plus Investigating) is the default; also Investigating, Resolved, Closed, All statuses.
- **Severity.**
- **Assigned to me** toggle.

**Summary chips:** "N open / investigating", "N critical still open", "N shown".

**Row click / View:** opens the job's Troubleshooting tab.

### Approval link landing — /dashboard/electrical/approval/[entityType]/[ref]

Links from My Approvals and from approval notifications point here. The entity type is electrical_drawing_revision or electrical_bom_item. The page:
- shows "Opening approval…" and a **← Back** button to Organization › Approvals
- looks up the job and tab that hold the record
- redirects to the job page on the Drawings or BOM tab, with the record in focus. The drawing's revisions are expanded, or the BOM line's approval dialog is opened

If the record was deleted, an error banner explains this. An edited link shows "Invalid link" with "Back to approvals".

### Ongoing Projects (old link) — /dashboard/electrical/project-work

There is no screen. The page redirects to the company-wide Ongoing Projects page and keeps the ?id= parameter.

## 4. Settings / Masters

The Electrical module has no settings or master-data screens of its own. All of its lists are fixed in code and served to the screens through the lookups "meta" call:
- the 20 stages, their phases and which are mandatory
- component categories, panel types, drawing types, test types and document categories

The pickers use masters owned by other modules. Electrical serves these lists read-only, under its own permission:
- ERP machines (ERP Projects)
- plants (Organization branches; a branch cannot be deleted while electrical jobs use it)
- active users
- active Store items (Item Master)
- live Procurement purchase requisitions

Approval routing for drawing revisions and BOM selections is set up centrally in Organization › Approval Workflows (transactions "Electrical drawing revision" and "Electrical component selection").

## 5. Permissions

**App access:** every Electrical page and API needs the "electrical" app. Each page also hides tabs the user's role cannot view.

**Permission Matrix subtabs** (module key "electrical"):

| Subtab | Key | Actions | What they control |
|---|---|---|---|
| Dashboard | dashboard | View | Seeing the dashboard |
| Ongoing Projects | project_work | View, Edit | The old Ongoing Projects link |
| Requirements (from R&D) | requirements | View, Edit | Seeing shared requirements; Edit = sending the feasibility reply |
| RRV Electrical Jobs | jobs | View, Create, Edit, Delete, Submit, Approve, Cancel, Print | Create = new job. Edit = everything on a job: details, stages, hold / resume / cancel / close, QC request, BOM, panels, cables, drawings, documents, and also tests and issues. Delete = delete a draft job (creator only, admins always). Submit = send a BOM selection for approval. Approve = approve BOM component selections (default approval-engine approver) |
| Drawings | drawings | View, Create, Edit, Delete, Approve | View = Drawing Register. Delete = delete a drawing (creator only). Approve = approve or reject drawing revisions (default approval-engine approver; never your own revision) |
| Purchase Requirements | purchase | View, Create, Edit, Delete | View = Purchase Requirements page. Edit = link and unlink PRs on BOM lines without full job-edit rights |
| Testing | testing | View, Create, Edit, Delete, Print | View = Test Register. Create / Edit / Delete = record, correct and delete tests (Edit on Jobs also allows this) |
| Troubleshooting | troubleshooting | View, Create, Edit, Delete | View = Troubleshooting page. Create / Edit = log and work issues (Edit on Jobs also allows this). Delete = delete an open issue you logged |

**Other rules:**
- **Data scope:** jobs are the scoped record. "Own" = jobs I created. "Assigned" = jobs where I am the lead engineer or own a stage. "Plant" = the job's plant. Every child record (drawing, BOM line, cable, panel, test, issue, document) follows its job. Someone who is or was an approver of a drawing revision or BOM line on a job can open that job even outside their scope.
- **Ownership checks:**
  - Only the preparer (or an admin) can upload a file to, submit or discard a drawing revision.
  - Only the uploader (or an admin) can delete a document.
  - Only the reporter (or an admin) can delete an issue.
- **Company delete rule:** Delete on the subtab plus being the creator; admins can always delete.
- **Raise PR** (BOM tab) is shown only to users who also have the Procurement (P2P) app. **Open in Quality** is shown only to users who have the Quality app.
- Print actions exist in the matrix for Jobs and Testing, but no print screen exists in this module.

## 6. Documents, Notifications & Integrations

**Generated documents:** the module generates no Word or PDF documents. All files are uploaded by users:
- drawing revision files (.pdf, .dwg, .dxf, .png, .jpg, .jpeg)
- job documents (any file type)

They are stored in SharePoint under Electrical-media/job number/… and always opened through the portal, never through a raw SharePoint link. If SharePoint is not configured on the server, uploads and opening return a clear message asking the administrator to set it.

**Notifications.** None go to the person who did the action. All are bell notifications unless noted:

| Notification | Sent to | When |
|---|---|---|
| Electrical Job Assigned | New lead engineer | Job created with, or changed to, a lead engineer |
| Electrical Stage Assigned | New stage owner | Stage owner set on the Plan dialog |
| RRV Electrical Handed Over | Lead engineer | RRV Electrical Handover stage completed |
| Electrical QC Inspection Requested | Quality app users (broadcast) | QC inspection requested |
| Electrical Drawing Awaiting Approval | Lead engineer, unless they are already an approver (bell and Teams) | Drawing revision submitted |
| Electrical Drawing Approved / Rejected | Revision preparer | Revision decided (when someone else submitted it, or on the old route) |
| Electrical Issue Assigned | Assignee | Issue logged or reassigned |
| Electrical Issue Resolved | Reporter | Issue resolved |
| Approval-engine notifications | Approvers and submitter | Drawing revision or BOM selection submitted and decided (sent by the central approval engine) |

**Links to other modules:**
- **R&D / CRM:** the Requirements tab receives feasibility requests from R&D and sends the reply back.
- **ERP:** a job can be linked to an ERP machine. Customer, model and serial number are taken from it when left blank.
- **Organization:** plants (branches), users, and the central approval engine (My Approvals, Approval Workflows).
- **Store (Item Master):** BOM lines can link a Store item. Raise PR needs one.
- **Procurement (P2P):** Raise PR opens a pre-filled requisition. Link PR attaches a live PR number to a BOM line, and its status is shown on the BOM and Purchase Requirements pages.
- **Quality:** Request QC Inspection creates a Final inspection in Quality. Its result drives the Inspection & QC stage gate, and the Dashboard counts inspections awaiting QC.
- **Ongoing Projects:** the old Electrical project-work link forwards to the company-wide page.
