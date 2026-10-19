# Maintenance Module

The Maintenance module looks after the company's own plant equipment: machines, cranes, compressors, DG sets, utilities, tooling, instruments, facilities and vehicles. It does not cover customer machines (those stay in the ERP/Service side) or employee-issued assets (those stay in HR). It holds the asset register. Shop-floor staff use it to report breakdowns. Technicians use it to run work orders with checklists, spares and labour. Planners use it to verify and close jobs. It also schedules preventive maintenance (PM), watches critical spares, tracks AMC and warranty expiry, and reports downtime, MTTR, MTBF, availability, PM compliance and cost. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) it is a support module for **Production**. When an asset that is linked to a Production workstation is down, the workstation is blocked in Production. Maintenance also draws on **Store/Purchase**: spares are Store items, every issue and return goes through the Store stock ledger, and low spares can be ordered with a Purchase Request in P2P. Outside service vendors come from the shared vendor master (Accounts).

## 1. Navigation Tabs

The sub-nav sits at the top of every Maintenance page. On the right it has a guided-tour button and the notification bell. Users who do not have the Maintenance app see only the **Requests** tab. These are usually production supervisors who reach the module through the Production app. All other tabs are also hidden when the user's role does not grant "view" on that sub-tab.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/maintenance | Maintenance dashboard: live KPIs, machines down, open requests, my jobs, PM due, critical spares |
| Requests | /dashboard/maintenance/requests | List of breakdown / maintenance requests (for non-maintenance users: only their own requests) |
| Work Orders | /dashboard/maintenance/work-orders | List of maintenance work orders (MWO-) |
| Assets | /dashboard/maintenance/assets | Asset register (plant equipment) |
| PM Schedule | /dashboard/maintenance/schedule | Preventive maintenance plans and the upcoming PM calendar |
| Spares | /dashboard/maintenance/spares | Spare parts stock view, read from the Store |
| AMC & Warranty | /dashboard/maintenance/contracts | Warranty and AMC expiry tracker. It uses the "Assets" permission. |
| Reports | /dashboard/maintenance/reports | Maintenance KPIs, charts and tables, with Excel export |
| Settings | /dashboard/maintenance/settings | Maintenance settings (values only) |

Pages that are not in the nav:

- /dashboard/maintenance/requests/new: report a problem
- /dashboard/maintenance/requests/[id]: request view
- /dashboard/maintenance/work-orders/new: new work order
- /dashboard/maintenance/work-orders/[id]: work order view
- /dashboard/maintenance/assets/new: new asset
- /dashboard/maintenance/assets/[id]: asset view
- /dashboard/maintenance/assets/[id]/edit: edit asset
- /dashboard/maintenance/assets/labels: QR label sheet
- /dashboard/maintenance/scan/[code]: QR scan landing page
- /dashboard/maintenance/schedule/new: new PM plan
- /dashboard/maintenance/schedule/[id]: PM plan view
- /dashboard/maintenance/schedule/[id]/edit: edit PM plan
- /dashboard/maintenance/project-work: old link that now redirects to Ongoing Projects

Record pages always use signed record references in the URL, never raw ids. If someone edits the link by hand, the page shows "Invalid link" with a button back to the list.

In the main sidebar, the Maintenance entry appears for anyone with the Maintenance or Production app. Maintenance users land on the Dashboard. Production-only users land on Requests.

## 2. Dashboard

Route: /dashboard/maintenance. Users need the Maintenance app and the "dashboard" sub-tab view right. The page header shows "Maintenance Module / Maintenance Dashboard".

All figures are limited to the user's Maintenance data scope (see Section 5). The page re-loads itself every 60 seconds so the downtime clocks keep moving. If loading fails, a red banner shows the real error message.

**Header actions:**

- **Plant filter** (dropdown "All plants" or a plant name). It is shown only when more than one plant exists. Changing it re-loads every figure for that plant. The KPI tiles then carry the plant into the list they open.
- **+ Report Breakdown** button. Opens /dashboard/maintenance/requests/new.

### Live KPI row (4 tiles)

| Tile | Value | Sub-text | How it is computed |
|---|---|---|---|
| Machines Down | Number of assets in status Breakdown or Under Maintenance | "of N assets" (assets in scope) | Count of in-scope assets whose status is breakdown or under_maintenance. Red when above 0, green when 0. |
| Open Requests | Requests in status Open | "Awaiting acknowledgement" | Requests with status "open" only. Acknowledged requests are not counted. Amber when above 0. |
| Open Work Orders | Work orders in Draft, Assigned, In Progress or On Hold | "N assigned to me" | The "assigned to me" figure counts open jobs where the user is the assigned technician. |
| Awaiting Close | Work orders in status Completed | "Completed, not yet closed" | Blue when above 0. |

**Actions:**

- Machines Down opens Assets with ?status=down (plus the plant, if one is picked).
- Open Requests opens Requests with ?status=open. The Requests page reads only the status from the link, not the plant.
- Open Work Orders opens Work Orders. The Work Orders page does not read the plant from the link.
- Awaiting Close opens Work Orders with ?status=completed.

### Last 30 days KPI row (4 tiles, not clickable)

These use the same calculation as the Reports tab, over today plus the 29 days before it (IST dates). Only breakdown and corrective (machine-down) jobs count as failures.

| Tile | Meaning |
|---|---|
| Breakdowns (30 days) | Number of breakdown and corrective machine-down jobs |
| Downtime (30 days) | Total breakdown downtime inside the window, shown as "2h 15m" or "3d 4h". Red when above 0. |
| MTTR (30 days) | Mean time to repair: average downtime per breakdown |
| Maintenance Cost (30 days) | Spares + labour + external cost of jobs finished in the window, in rupees |

### This month KPI row (5 tiles)

| Tile | Meaning | Click |
|---|---|---|
| MTTR (this month) | Average repair time per breakdown, from the 1st of the month to today | Opens Reports |
| Availability (this month) | Share of working hours not lost to breakdowns. Green at 95% or more, amber at 85% or more, red below 85%. Shows "—" when it cannot be computed. | Opens Reports |
| PM Due This Week | Count of open PM jobs plus active plans (job not yet generated) due within the dashboard PM window. The window is set in Settings (default 7 days, today included). | Opens PM Schedule in the Upcoming view (?view=upcoming) |
| PM Overdue | Open PM work orders past their PM due date. Red when above 0. | Opens PM Schedule filtered to "Overdue" plans (?due=overdue) |
| Critical Spares Low | Spares marked critical on any asset's bill of spares whose total on-hand is below the Store minimum (or reorder level). Red when above 0. | Opens Spares |

### Machines down now

A list of every in-scope asset in status Breakdown or Under Maintenance. Each row shows:

- a criticality pill (A red, B amber, C grey)
- the asset code and name
- the open work order number, or "No work order yet"
- how long the machine has been down

"Down since" is the earliest of two things:

- the downtime start of any open machine-down work order on the asset
- the reported time of any open or acknowledged machine-down request on the asset

The list is sorted by criticality (A first), then by the longest downtime. When nothing is down it says "Every asset is running."

**Actions:** clicking a row opens the open work order if there is one, otherwise the asset.

### Open requests

Up to 10 requests in status Open, oldest first. Each row shows:

- the request number
- the asset code and problem (first 160 characters)
- a "Machine down" pill if the machine is down
- the priority pill
- the reported date and time

Empty state: "No requests waiting."

**Actions:** clicking a row opens the request.

### My work orders

Up to 10 open work orders assigned to the logged-in user, highest priority first. Each row shows:

- the WO number
- the asset code and title
- the priority pill and status pill
- the planned start date

Empty state: "Nothing assigned to you."

**Actions:** clicking a row opens the work order.

### Completed — awaiting close

Up to 10 work orders in status Completed. The pill shows one of two states:

- **Waiting for requester**: the job came from a request, the requester has not confirmed yet, and the "Requester must confirm before close" setting is on.
- **Ready to close**: anything else.

Empty state: "Nothing waiting to be closed."

**Actions:** clicking a row opens the work order.

### Preventive maintenance — overdue & due this week

Overdue PM jobs come first. Each shows the WO number, the asset and title, an "Nd overdue" red pill and the due date.

Then come items due within the dashboard PM window. These are either:

- PM work orders, shown with their status pill, or
- PM plans whose job has not been generated yet, shown with a "Job not generated yet" pill.

Empty state: "Nothing overdue and nothing due this week."

**Actions:**

- The "PM schedule →" link opens the PM Schedule.
- An overdue row or a work-order row opens that work order.
- A plan row opens the PM plan.

### Critical spares below minimum

Each row shows the item code and name, the number of assets that use it, and on-hand against minimum with the unit (red). Empty state: "All critical spares are at or above minimum stock."

**Actions:** the "Spares →" link and every row open the Spares page.

## 3. Screens

### Requests list — /dashboard/maintenance/requests

Access: users with the Maintenance app or the Production app. The title is "Maintenance Requests" for maintenance users and "My Maintenance Requests" for others. Users without the Maintenance app only ever see requests they raised themselves; the backend enforces this. Results are also limited by the user's data scope.

#### List view

| Column | What it shows |
|---|---|
| Number | Request number, MRQ-YYYY-NNNN (numbered per year) |
| Asset | Asset code (bold) and asset name |
| Type | Request type (Breakdown / Abnormality / Improvement / Safety). A red "Machine down" line appears under it when the machine was reported stopped. |
| Problem | Problem description, cut to one line (full text on hover) |
| Priority | Pill: Low (grey), Normal (blue), High (amber), Urgent (red) |
| Reported | Date and time the problem happened |
| Raised By | Name of the person who raised it |
| Status | Pill: Open, Acknowledged, Work Order Raised, Rejected, Duplicate. An amber "Confirm repair" line appears when the current user has to confirm the repair. |
| Work Order | The linked work order number and its status, or "—" |
| (last column) | "View" link |

**Filters and search:**

- **Search box.** Searches request number, problem text, asset code and asset name. It waits 250 ms after typing.
- **Status dropdown.** "All statuses" or one status. It is pre-filled from ?status= in the link.
- **"Raised by me" checkbox.** Shown only to maintenance users.

Sort: newest reported first.

**Row actions:** clicking the row or "View" opens the request.

**Top button:** **+ Report Breakdown** opens the Report a Problem form.

Empty states:

- "No requests match these filters."
- "No maintenance requests yet. Use "Report Breakdown" when a machine stops or misbehaves."

### Report a Problem (create request) — /dashboard/maintenance/requests/new

Access: Maintenance or Production app. The asset can be pre-selected by the link ?asset=signed-ref, which is used from an asset page or a QR scan. The page has a **← Back** button (to Requests). The form is laid out for phones: 16px inputs and a full-width submit button on small screens.

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Machine / Equipment | Searchable asset picker | Yes | Active assets (not decommissioned) searched by code, name or location, first 100 by code | "Pick the machine or equipment that has the problem." Decommissioned assets are refused. If the picked asset is already Breakdown or Under Maintenance, an amber hint appears: "This asset is already marked … — check its open requests before raising another one." |
| Type | Dropdown | Yes (default Breakdown) | Breakdown; Abnormality (still running); Improvement; Safety | Picking Breakdown ticks "Machine is stopped". Picking any other type unticks it. The user can change the tick afterwards. |
| When did it happen? | Date and time | No (defaults to now) | — | Cannot be in the future (checked on screen and on the server). It may be back-dated. |
| Priority | Dropdown | No | "Auto (from criticality)", Low, Normal, High, Urgent | If left on Auto, the priority comes from the Settings matrix using the asset's criticality and whether the machine is down. Defaults: A down Urgent, B down High, C down Normal, A running High, B running Normal, C running Normal. |
| Machine is stopped | Checkbox | No | — | When ticked, the downtime clock starts from the reported time. The asset becomes Breakdown and its linked Production workstation is blocked. |
| What's wrong? | Multi-line text | Yes | — | "Describe the problem — what happened, and any noise, leak, alarm or error code." Blank or space-only text is refused. |
| Photos | Image upload: "Take photo" (opens the phone camera) and "Choose photos" (many files) | No | — | Each chosen photo is listed with a "Remove" link. Photos are uploaded after the request is saved, as document type "Photo". |

**On submit ("Raise Request"):**

- The request is created with status Open and the number MRQ-YYYY-NNNN.
- The asset status is re-calculated, so a machine-down request makes the asset Breakdown.
- Every active maintenance user of the asset's plant gets a bell notification, except the person raising it. Users with no plant assignment count as covering all plants. The title is "MRQ-…: ASSETCODE — MACHINE DOWN", with "URGENT: " in front when the priority is Urgent.
- The user is then taken to the request view.
- If the photo upload fails, the request is still saved. The view page then shows an amber banner explaining why the photos did not upload and asking the user to add them again.

### Request view — /dashboard/maintenance/requests/[id]

Access: Maintenance or Production app. Non-maintenance users can open only requests they raised: "You can only view requests you raised." The request must also be inside the user's data scope.

#### View page

**Header:** the request number, a status pill and a red "Machine down" pill when the machine was reported stopped.

**Confirm box.** This shows only to the person who raised the request (or an admin), and only when the linked work order is Completed and not yet confirmed. It reads "Maintenance says this is fixed — is the machine OK?" and shows the action taken, or "MWO-… was marked completed". It has two buttons:

- **Yes, it's working.** Opens a confirm dialog: "Maintenance can then verify and close the work order."
- **No, still a problem.** Opens a prompt that needs a comment: "The work order goes back to the technician. Say what's still wrong."

**Problem section:**

| Field | Meaning |
|---|---|
| (text) | Full problem description |
| Asset | Asset code and name. Maintenance users can click it to open the asset. |
| Plant | The asset's plant |
| Type | Request type |
| Priority | Priority |
| Happened At | Reported date and time |
| Raised By | Who raised it |
| Acknowledged | Who acknowledged it and when, or "—" |
| Asset Criticality | A, B or C |
| Rejection Reason / Duplicate Of / Reason | Shown only when the request was rejected or marked duplicate |

**Work Order section** (only when a work order exists):

| Field | Meaning |
|---|---|
| (number) | The WO number (maintenance users can click it to open the work order) with its status pill |
| Technician | Assigned technician, or "Not assigned yet" |
| Downtime | Final downtime of the job |
| Confirmed By You / Requester Confirmed | When the requester confirmed the repair, or "—". The first label is used when the viewer is the requester. |
| Root Cause | Shown when filled |
| Action Taken | Shown when filled |

**Photos & Files section:** the attachments panel for the request. The default document type is Photo. See "Attachments panel" under the Assets screens.

**Action buttons.** Triage buttons show only to maintenance users and only while the request is Open or Acknowledged:

- **Create Work Order.** Opens the "Create work order" dialog (see the table below). The server needs the Work Orders "create" permission.
- **Acknowledge.** Shown only while the status is Open. Status becomes Acknowledged and the user and time are recorded. Needs Requests "edit".
- **Mark Duplicate.** A prompt asks which request already covers this, for example "Same as MRQ-2026-0012". The reason is required. Needs Requests "edit".
- **Reject.** A prompt asks for a reason (required): "The requester will see this reason." Needs Requests "edit".
- **← Back.** Always shown. Returns to Requests.

**Create work order dialog:**

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Title | Text (max 200) | Yes | Pre-filled as "Type: first 80 characters of the problem" | "Give the work order a title." |
| Type | Dropdown | Yes | Breakdown, Preventive, Corrective, Calibration, Improvement, Inspection | Pre-filled from the request type: Breakdown → Breakdown; Abnormality → Corrective; Improvement → Improvement; Safety → Corrective |
| Priority | Dropdown | Yes | Low, Normal, High, Urgent | Pre-filled with the request's priority |
| Planned Start | Date | No | — | — |
| Assign Technician | Searchable dropdown | No | "— Assign later —" plus active users who have the Maintenance app (admins excluded) | The technician must be active |
| Instructions | Multi-line text | No | Pre-filled with the problem description | — |

**On "Create Work Order":**

- A work order MWO-YYYY-NNNN is created and linked to the request.
- Its status is Assigned if a technician was picked, otherwise Draft.
- "Machine down" is copied from the request. The downtime start is set to the request's reported time, so the clock keeps running from the original report.
- The request status becomes "Work Order Raised" (converted).
- The asset status is re-calculated.
- The technician gets a bell notification "MWO-… assigned to you".
- The user is taken to the new work order.

#### Edit

A request has no edit form. After it is raised, its fields cannot be changed. Only status actions are possible.

#### Statuses & workflow

| Status | Meaning | How it is reached | Who |
|---|---|---|---|
| Open | Just raised | Create | Anyone with the Maintenance or Production app |
| Acknowledged | Maintenance has seen it | Acknowledge (from Open) | Maintenance user with Requests edit |
| Work Order Raised (converted) | A work order was created from it | Create Work Order (from Open or Acknowledged) | Maintenance user with Work Orders create |
| Rejected | Not accepted. The reason is shown to the requester. | Reject (from Open or Acknowledged) | Maintenance user with Requests edit |
| Duplicate | Already covered by another request | Mark Duplicate (from Open or Acknowledged) | Maintenance user with Requests edit |

Other rules:

- If the work order made from a request is **cancelled**, the request goes back to **Acknowledged** so it can be converted again or rejected.
- Rejecting or marking duplicate sends the raiser a bell notification with the reason, and re-calculates the asset status. A machine-down request that is closed this way releases the machine.
- **Requester confirmation** (after the work order is Completed). "Yes" records the confirmation time and notifies the WO creator and the person who acknowledged the request: "The machine is confirmed OK — the job can be verified and closed." It also submits the close-out approval.
- **"No, still a problem"** sends the work order back to In Progress. It clears the finish time and the downtime end, so the downtime clock runs again. It withdraws any pending close-out approval and notifies the technician and the WO creator: "MWO-… reopened — machine not OK".
- Only the person who raised the request (or an admin) can confirm.

### Work Orders list — /dashboard/maintenance/work-orders

Access: Maintenance app with Work Orders view. Results are limited by data scope.

#### List view

| Column | What it shows |
|---|---|
| Number | WO number, MWO-YYYY-NNNN |
| Asset | Asset code and name |
| Title | Job title (one line, full text on hover) |
| Type | Breakdown / Preventive / Corrective / Calibration / Improvement / Inspection |
| Priority | Priority pill |
| Technician | Assigned technician, or amber "Unassigned" |
| Planned | Planned start date |
| Downtime | For machine-down jobs: the final downtime, or the live running downtime (shown in red while the clock is still running). "—" for jobs where the machine is not down. |
| Cost | Total cost in rupees, or "—" |
| Status | Status pill. An amber "Awaiting requester" line appears when a completed job is waiting for the requester's confirmation. |
| (last column) | "View" link |

**Filters and search:**

- **Search box.** Searches WO number, title, asset code and asset name. It waits 250 ms after typing.
- **Type dropdown.** All types, or one type.
- **Status dropdown.** Shows "Open + completed" when "Hide closed" is on, otherwise "All statuses". It is pre-filled from ?status=.
- **"Hide closed" checkbox.** Shown only when no status is picked. It is on by default unless the link has a status. When on, the list shows Draft, Assigned, In Progress, On Hold and Completed.
- **"My jobs" checkbox.** Shows only jobs assigned to the user. It is pre-ticked by ?mine=1.

Sort: newest created first.

**Row actions:** clicking the row or "View" opens the work order.

**Top button:** **+ New Work Order**.

### New Work Order — /dashboard/maintenance/work-orders/new

Access: Maintenance app. The server needs Work Orders "create". The asset can be pre-selected with ?asset=. A hint on the page says: "For a breakdown someone reported, open their request and use "Create Work Order" instead, so the downtime and sign-off link up." The page has a **← Back** button.

#### Create form

**Job section:**

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Asset | Searchable asset picker | Yes | Active assets (decommissioned refused) | "Pick the asset this work is on." |
| Type | Dropdown | Yes (default Corrective) | Breakdown, Preventive, Corrective, Calibration, Improvement, Inspection | — |
| Priority | Dropdown | Yes (default Normal) | Low, Normal, High, Urgent | — |
| Title | Text (max 200) | Yes | — | "Give the work order a title." |
| Instructions | Multi-line text | No | — | — |
| Machine is down for this job | Checkbox | No | — | Tracks downtime and blocks the linked workstation in Production |
| Down Since | Date and time | Shown only when "machine down" is ticked (defaults to now) | — | Cannot be in the future |

**Planning section:**

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Technician | Searchable dropdown | No | "— Assign later —" plus active maintenance users (admins excluded) | Must be an active user |
| Planned Start | Date | No | — | — |
| Planned End | Date | No | — | "Planned end can't be before planned start." |
| Est. Hours | Number (step 0.5) | No | — | Must be 0 or more |

**Checklist section:**

- Optional lines, each with a description (required on the line) and an "Expected (optional)" value.
- Use **+ Add Line** and **Remove** to manage lines.
- An empty line blocks saving: "Checklist line N is empty — fill it in or remove it."
- Each line needs a result before the job can be completed.

**On "Create Work Order":**

- The status is Assigned if a technician was picked, otherwise Draft.
- Costs are calculated and the asset status is re-calculated. A machine-down job makes the asset Breakdown.
- The technician gets the bell notification "MWO-… assigned to you".
- The user is taken to the work order.

### Work Order view — /dashboard/maintenance/work-orders/[id]

Access: Maintenance app. The job must be inside the user's data scope.

#### View page

**Header:**

- the WO number, a status pill, a priority pill and the title
- for PM jobs: "From PM plan PM-NNNN · due D Mon", where the plan code is a link to the plan

**Progress stepper:** Draft → Assigned → In Progress → Completed → Closed. The "In Progress" step reads "On Hold" while the job is on hold. The stepper is hidden for cancelled jobs.

**Banners:**

- "Waiting for … to confirm the machine is working (MRQ-…)": a completed job waiting for the requester.
- **Close-out approval panel**: the central approval engine panel, shown for every status except Draft. It shows the pending close-out request, its stages and the approve / reject / return controls for approvers.
- "On hold: reason"
- "Cancelled: reason"
- "Sent back: comment": the requester's comment when they said the machine is not OK and the job is In Progress again.

**Summary section:**

| Field | Meaning |
|---|---|
| Asset | Asset code and name (click to open the asset) |
| Plant | The asset's plant |
| Type | Work order type |
| Technician | Assigned technician, or "Unassigned" |
| From Request | Request number and requester (click to open), or "—" |
| Planned | Planned start → planned end |
| Est. Hours | Estimated hours |
| Started | Actual start, set when the job is started |
| Finished | Actual end, set when the job is completed |
| Down Since | Downtime start (machine-down jobs only) |
| Downtime / Down For (live) | Final downtime minutes, or the live running figure while the clock is still open (machine-down jobs only) |
| Closed By | Verifier and time (after closing) |
| Instructions | Description / instructions. PM jobs get notes such as "Generated from PM plan PM-0001, due 01-11-2026." |
| Failure Category / Root Cause / Action Taken | Shown once any of them is filled |

**Checklist section:**

- A "N of M done" counter.
- A table with these columns: #, Check (with "Expected: …"), Result (toggle pills OK / Not OK / N/A; clicking the active pill clears it), Measured (reading), Remarks, By (who set the result), and Remove.
- Measured and Remarks save automatically when the user leaves the field.
- While the job is editable (not Closed or Cancelled), there is an "Add a check…" box with **+ Add**. Pressing Enter also adds the check.

**Spares section:**

- A table with these columns:
  - Item (code, name and remarks)
  - Store (location)
  - Planned
  - Issued
  - Returned
  - In Stock (free stock at that location, shown in red when it is less than the quantity still to issue)
  - Cost (net issued quantity × unit cost)
  - row actions
- Header buttons (job editable only):
  - **Issue from Store**: shown only when the job is Assigned, In Progress or On Hold.
  - **+ Plan Spare**.
- Row actions:
  - **Issue**: in the same three statuses.
  - **Return**: when issued minus returned is above 0.
  - **Remove**: only when nothing has been issued on that line.
- Empty-state hint: "No spares on this job. Issued spares are taken out of Store stock against MWO-…"

**Labour section:**

- A table with these columns: Technician, From, To, Hours, Rate, Cost, Remarks, and Delete (job editable only).
- The **+ Log Time** button shows when the job is Assigned, In Progress, On Hold or Completed.

**Cost section:**

| Field | Meaning |
|---|---|
| Spares | Sum of (issued − returned) × unit cost |
| Labour | Sum of hours × hourly rate |
| External | External vendor cost, plus the vendor name |
| Total | Spares + Labour + External. The system works it out every time; it is never typed by hand. |

**Service Reports & Photos:** the attachments panel for the work order. The default document type is Service Report. Uploading is allowed only while the job is not Closed or Cancelled.

**Action buttons (what appears depends on the status):**

| Button | Shows when | What it does | Server permission |
|---|---|---|---|
| Assign Technician | Draft | Dialog to pick a technician. Status becomes Assigned and the technician is notified. | Work Orders edit |
| Start Job | Assigned | Status becomes In Progress. Actual start is set (if empty). The asset becomes Under Maintenance if the machine is down. | Work Orders edit |
| Mark Completed | In Progress | Opens the completion dialog (see below) | Work Orders edit |
| Resume | On Hold | Back to In Progress | Work Orders edit |
| Verify & Close | Completed, and no close-out approval is pending | Confirm dialog: "This verifies the job and freezes its cost. The asset returns to Operational if nothing else is open on it." The button is greyed out, with a tooltip, while the job is waiting for the requester. | Work Orders approve |
| Put On Hold | In Progress | A prompt asks for a reason (required), e.g. waiting for spares, vendor or shutdown window | Work Orders edit |
| Reassign | Assigned, In Progress, On Hold | Dialog to change the technician. The new technician is notified. | Work Orders edit |
| Reopen | Completed, and no close-out approval is pending | A prompt asks for a reason (required). The job goes back to In Progress. | Work Orders approve |
| Edit Details | Any status except Closed or Cancelled | Opens the "Edit work order details" dialog | Work Orders edit |
| Cancel | Draft, Assigned, On Hold | A prompt asks for a reason (required): "Planned spares are dropped. If it came from a request, the request goes back to Acknowledged." | Work Orders approve |
| ← Back | Always | Returns to the Work Orders list | — |

The screen chooses which buttons to show by status only. The server then checks the permission and returns the real reason when the user is not allowed.

**Mark job completed dialog:**

| Field | Type | Required | Rules |
|---|---|---|---|
| Failure Category | Dropdown | Yes for Breakdown and Corrective jobs | Options: Mechanical, Electrical, Hydraulic, Pneumatic, Lubrication, Electronic / Control, Wear & Tear, Operator Error, External (power, supply…), Other |
| Root Cause | Multi-line text | Yes for Breakdown and Corrective jobs | "Why did it fail?" |
| Action Taken | Multi-line text | Yes for Breakdown and Corrective jobs | "What was done to fix it?" |
| Machine Handed Back At | Date and time (defaults to now) | Shown only for machine-down jobs | Ends the downtime clock. It cannot be in the future or before the machine went down. |

Completion is also blocked while any checklist line has no result: "N checklist line(s) have no result yet — mark each OK / Not OK / N/A first."

On completion:

1. The status becomes Completed. Actual end, the completer and the downtime end and minutes are set.
2. The requester (if the job came from a request) gets "MWO-… done — please confirm".
3. The WO creator gets "MWO-… completed".
4. The close-out approval is submitted, unless the job is waiting for the requester's confirmation. In that case it is submitted when the requester confirms.

**Edit work order details dialog:**

| Field | Type | Rules |
|---|---|---|
| Title | Text (max 200), required | "Title is required." |
| Type | Dropdown | Any of the six work order types |
| Priority | Dropdown | Low, Normal, High, Urgent |
| Est. Hours | Number | 0 or more |
| Planned Start / Planned End | Date | End cannot be before start |
| External Service Vendor | Searchable dropdown | "— None —" or a vendor from the shared vendor master |
| External Cost (₹) | Number | 0 or more. It is added into the total cost. |
| Instructions | Multi-line text | — |

**Plan a spare / Issue spare from Store dialog:**

| Field | Type | Required | Rules |
|---|---|---|---|
| Store Location | Dropdown | Yes (new lines only) | Active Store locations, with the job's plant listed first. It defaults to the first location of that plant. |
| Spare Part | Search box with a result list | Yes (new lines only) | Searches Store items by code, name or part number. Spare-part items are listed first. Free stock at the chosen location is shown (green above 0, red at 0). |
| Quantity | Number | Yes | Must be above 0. It defaults to the quantity still to issue on an existing line, or 1. |
| Remarks | Text | No | — |

How the actions behave:

- **"Add to Plan"** adds a planned line, or updates the planned quantity if the same item and location are already on the job.
- **"Issue"** posts an "issue" transaction on the Store stock ledger against the WO number. If stock is short, it is refused with the real figure, for example: "Only 2 of 5 'Bearing 6205' available at Main Store. Issue 2 now or transfer stock in first." The unit cost on the line is a weighted average of the item's standard cost (or moving average cost) at each issue.
- After an issue, if the item is marked critical on any asset and total on-hand is now below the Store minimum, planners are alerted (see Section 6).

**Return to Store dialog:**

- The quantity defaults to the full amount still out on the job.
- It cannot be more than issued minus returned.
- It posts a "return_in" transaction on the Store ledger.

**Log labour dialog:**

| Field | Type | Required | Rules |
|---|---|---|---|
| Technician | Searchable dropdown | Yes | Active maintenance users. It defaults to the assigned technician. |
| From / To | Date and time | Either both of these, or Hours | End must be after start. Neither can be in the future. |
| Or Hours | Number (step 0.25) | Either Hours, or both From and To | More than 0 and at most 24 per entry. If left blank, it is worked out from From and To. |
| Rate / hr (₹) | Number | No (default 0) | 0 or more. Payroll is in ADP, so leave it at 0 to track hours without cost. |
| Remarks | Text | No | — |

#### Edit

- **Editable while the job is open or Completed:** details (via Edit Details), checklist lines (add, set result, measured value, remarks, remove), spares (plan, return, remove lines with nothing issued), labour (delete; add while Assigned, In Progress, On Hold or Completed) and attachments.
- **Spares can be issued** only while the job is Assigned, In Progress or On Hold.
- **Closed and Cancelled jobs are locked.** Every edit is refused: "Can't … : MWO-… is Closed and locked."
- After each change, the costs are worked out again and the asset status is synced.

#### Statuses & workflow

| Status | Meaning |
|---|---|
| Draft | Created with no technician |
| Assigned | Technician assigned |
| In Progress | Work started |
| On Hold | Paused, with a reason |
| Completed | Technician finished the job; waiting for verification |
| Closed | Verified and closed. Cost is frozen. |
| Cancelled | Cancelled, with a reason |

Transitions (only through the action buttons; there is no free status edit):

- Draft → Assigned (Assign).
- Assigned → In Progress (Start). A Draft job cannot be started: "assign a technician first."
- In Progress → On Hold (Put On Hold), and On Hold → In Progress (Resume).
- In Progress → Completed (Mark Completed).
- Completed → Closed through the **close-out approval**. This is the central approval engine transaction "Maintenance work order close-out":
  - It is submitted automatically when the job is completed. If the job came from a request and requester confirmation is required, it is submitted when the requester confirms.
  - The default stage is "Work order approver": anyone holding Work Orders "approve" at the same plant.
  - Self-approval is allowed by default, because small plants have one planner. Four-eyes can be switched on in Organization › Approval Workflows.
  - Approving closes the job, records who verified it and when, freezes the cost and rolls a PM plan forward to its next due date.
  - Rejecting, returning or withdrawing it reopens the job to In Progress and notifies the technician.
  - Pressing **Verify & Close** while an approval is pending approves it. Pressing **Reopen** returns it, or withdraws it if the user is the one who submitted it.
  - Jobs completed before the approval engine existed, or where no approver could be found, use the direct Verify & Close / Reopen path.
- Close is blocked while the requester has not confirmed (when the setting is on): "Can't close MWO-… yet: waiting for … to confirm the machine is OK on request MRQ-…".
- Draft, Assigned or On Hold → Cancelled (Cancel). An in-progress job must be put On Hold first. Cancelling is refused while any spare is issued and not returned. A linked request goes back to Acknowledged.
- **Asset status sync**, after every change:
  - The asset becomes Under Maintenance if any open machine-down job on it is In Progress.
  - Otherwise it becomes Breakdown if any open machine-down job or open/acknowledged machine-down request remains.
  - Otherwise it goes back to Operational.
  - A PM job that requires shutdown only takes the machine down once it is started.
  - A linked Production workstation is set to "under maintenance" while the asset is down. It is set back to "active" afterwards, but never re-activated if someone set it inactive.

No Word or PDF document is generated for a work order.

### Asset Register (list) — /dashboard/maintenance/assets

Access: Maintenance app with Assets view. Results are limited by data scope. Deleted assets are not shown.

#### List view

| Column | What it shows |
|---|---|
| (checkbox) | Selects the asset for printing labels. The header box selects every asset on the page. |
| Code | Asset code |
| Name | Asset name, plus "· part of PARENT-CODE" for a sub-asset |
| Category | Production Machine, Material Handling, Utility, Tooling / Fixture, Instrument / Gauge, Facility, Vehicle, Other |
| Plant | Plant name |
| Location | Location in the plant |
| Crit. | Criticality pill A / B / C |
| Open WOs | Number of open work orders |
| Status | Operational (green), Breakdown (red), Under Maintenance (amber), Standby (blue), Decommissioned (grey) |
| (last column) | "View" link |

**Filters:**

- search (code, name, serial number, location)
- plant (shown when more than one plant exists)
- category
- criticality (Any, A, B, C)
- status (All; "Down (breakdown + under maintenance)"; or one status)

Status and plant are read from the link (?status=, ?branch_id=), so dashboard drill-downs land on the same records.

Sort: by asset code.

**Selection bar.** When anything is ticked, a bar shows "N selected" with these options:

- **Print labels for N selected**. If more than 200 are ticked, it says "Max 200 labels per sheet — print in batches".
- **Clear selection**.

**Top buttons:**

- **Print QR Labels** opens the label page, carrying the plant filter if one is set.
- **Import from Excel** opens the import dialog.
- **+ New Asset**.

**Import from Excel dialog:**

1. **Download template.** The workbook has the header row, an example row and an Instructions sheet listing the categories, criticality values and plant names.
2. **Choose a file.** .xlsx or .xlsm, up to 2000 rows.
3. **Validate.** This is a dry run; nothing is saved. A results table shows each row with Row, Asset code (marked "(auto)" when it will be auto-numbered), Name, and either Problems or "Plant · Category".
4. **Import N asset(s).** Enabled only when validation shows no errors. The import is all-or-nothing.

Template columns:

- asset_code (optional; blank gives EQ-NNNN; must be unique in the file and the register)
- name (required)
- category (required; code or label)
- plant (required; plant name or code)
- department
- location
- make
- model
- serial_number
- year_of_manufacture
- criticality (blank = B)
- commissioned_on (DD-MM-YYYY or an Excel date)
- workstation_code
- remarks

The server needs Assets "import".

### New Asset / Edit Asset — /dashboard/maintenance/assets/new and /dashboard/maintenance/assets/[id]/edit

Access: Maintenance app. The server needs Assets "create" (new) or Assets "edit" (edit). Both pages have a **← Back** button.

#### Create form

**Identification section:**

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Asset Code | Text (max 50, turned to upper case) | No on create | Placeholder "Auto (EQ-0001)" | Use the plant's existing machine number. If left blank, the next EQ-NNNN is used. It must be unique: "Asset code X is already used." It cannot be blanked on edit. |
| Name | Text (max 200) | Yes | — | "Asset name is required." |
| Category | Dropdown | Yes (default Production Machine) | 8 categories (see the list view) | — |
| Criticality | Dropdown | Yes (default B) | A — Line stops; B — Important; C — Low impact | Drives the default request priority and the PM job priority (A gives High) |
| Status | Dropdown (edit only) | — | Operational, Standby, Decommissioned | Read-only while the asset is Breakdown or Under Maintenance: "Status is set automatically while a breakdown or work order is open." |

**Location section:**

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Plant | Searchable dropdown | Yes | Plants (branches) | Changing it clears Department and Workstation |
| Department | Searchable dropdown | No | Departments of the chosen plant | — |
| Location in Plant | Text (max 200) | No | e.g. "Bay 3, Line 2" | — |
| Production Workstation | Searchable dropdown | No | Production workstations of the plant that are not linked to another asset | Linking blocks the workstation in Production while the asset is down. One workstation can link to only one asset. |
| Part Of (Parent Asset) | Asset picker | No | Other assets | An asset cannot be its own parent |

**Make & Purchase section:**

| Field | Type | Required | Rules |
|---|---|---|---|
| Make | Text (max 100) | No | — |
| Model | Text (max 100) | No | — |
| Serial Number | Text (max 100) | No | — |
| Year Built | Number | No | From 1900 to next year |
| Supplier | Searchable dropdown | No | Vendor master. This vendor is used as the warranty vendor. |
| Purchase Date | Date | No | — |
| Purchase Cost (₹) | Number | No | 0 or more |
| Commissioned On | Date | No | — |

**Warranty, AMC & Meter section:**

| Field | Type | Required | Rules |
|---|---|---|---|
| Warranty Expiry | Date | No | Feeds AMC & Warranty and its reminders |
| AMC Vendor | Searchable dropdown | No | Vendor master |
| AMC Expiry | Date | No | Feeds AMC & Warranty and its reminders |
| Meter Unit | Text (max 20) | No | e.g. "hours" |
| Meter Reading | Number | No | 0 or more. Changing it records the time of the meter update. |
| Decommissioned On | Date | Edit only, shown when the status is Decommissioned | If left blank when decommissioning, today is used |

**Notes section:** Description / Technical Specs (multi-line) and Remarks (multi-line).

**On save:**

- A new asset starts as **Operational** and the user goes to the asset view.
- On edit, setting the status to **Decommissioned** does two things:
  - It deactivates every PM plan on the asset.
  - It cancels its PM jobs that are Draft, Assigned or On Hold. This is refused if any of those jobs still has spares issued and not returned.
- A status change is refused while the asset is Breakdown or Under Maintenance: "close or cancel its open work orders / requests first."
- Changing the linked workstation releases the old one.

### Asset view — /dashboard/maintenance/assets/[id]

Access: Maintenance app. The asset must be inside the user's data scope.

#### View page

**Header:** the asset code and name, with a status pill.

**Banner.** Shown when the asset is Breakdown or Under Maintenance. It shows "Down since …", the number of open work orders (or "No work order raised yet") and "Workstation X is blocked in Production until this is closed".

**Action buttons:**

| Button | Shows when | Action |
|---|---|---|
| Report Breakdown | Asset not decommissioned | Opens Report a Problem with this asset pre-selected |
| New Work Order | Asset not decommissioned | Opens New Work Order with this asset pre-selected |
| QR Label | Always | Opens the label page for this one asset |
| Edit | Always | Opens Edit Asset. The server needs Assets edit. |
| Delete | The user can delete Assets for this record (permission plus ownership rule) | Confirm dialog, then soft delete |
| ← Back | Always | Back to the register |

**Delete is refused when:**

- the asset has any request or work order history ("Set its status to Decommissioned instead")
- an active PM plan is attached
- a sub-asset belongs to it

A linked workstation is released when the asset is deleted.

The view page has five tabs.

**Overview tab.** Details section:

| Field | Meaning |
|---|---|
| Category | Asset category |
| Criticality | A / B / C with its meaning |
| Plant | Plant |
| Department | Department |
| Location | Location in the plant |
| Part Of | Parent asset code |
| Workstation | Linked workstation code (with its status), or "Not linked" |
| Open Work Orders | Count |

Overview tab, Make, Purchase & Warranty section:

| Field | Meaning |
|---|---|
| Make | Manufacturer |
| Model | Model |
| Serial Number | Serial number |
| Year Built | Year of manufacture |
| Supplier | Supplier vendor |
| Purchase Date | Purchase date |
| Purchase Cost | Purchase cost |
| Commissioned On | Commissioning date |
| Warranty Expiry | Warranty expiry date |
| AMC Vendor | AMC vendor |
| AMC Expiry | AMC expiry date |
| Meter | Current reading and unit |
| Decommissioned On | Shown only when decommissioned |

Overview tab, Notes section: Description / Specs and Remarks, shown when filled.

**History tab.** Every request and work order on the asset that is inside the user's scope, newest first. Columns:

- **Date.** Reported time for requests; actual start or creation time for work orders.
- **Number.**
- **Title.** Problem text or job title.
- **Status.**
- **Downtime.**
- **Cost.**

Clicking a row opens that record.

**PM Plans tab.** The plans on this asset. Columns: Plan, Title, Every (e.g. "3 Month(s)"), Basis (Fixed calendar / From last completion), Next Due (red when overdue), Last Done, and Status (Overdue / Due soon / Scheduled / Inactive). The **+ New PM Plan** button shows when the asset is not decommissioned and opens New PM Plan with this asset pre-selected. Clicking a row opens the plan.

**Spares tab: Bill of Spares.** The Store items this asset uses.

In read mode the columns are:

| Column | What it shows |
|---|---|
| Item | Item code and name |
| Qty / Replacement | Quantity used per replacement, with the unit |
| Critical | "Critical" pill, or "—" |
| On Hand (all stores) | Total on-hand across every store |
| Min / Reorder | The Store item's minimum stock / reorder level |
| Stock | Below min (red), At reorder (amber), OK (green), or No min set (grey) |
| Remarks | Remarks |

Read-mode buttons:

- **Spares stock** opens the Spares page.
- **Edit** (or **+ Add spares** when the list is empty) is shown when the asset is not decommissioned.

In edit mode:

- Search Store items to add them. An item already on the list cannot be added twice.
- Each line has Qty / Replacement (must be above 0), a Critical checkbox, Remarks (max 255) and Remove.
- **Cancel** asks "Discard changes?" when there are unsaved edits.
- **Save** replaces the whole list. Saving an empty list clears it. The server needs Assets edit.

Marking a spare critical means planners get an alert when its Store stock drops below the minimum.

**Documents tab: Manuals, drawings & photos.** The attachments panel. The default document type is Manual.

**Attachments panel** (used on assets, requests and work orders):

- Lists files with:
  - the file name (click to open; images and PDFs open in the browser, other files download)
  - the document type
  - the size
  - who uploaded it and when
  - a **Delete** link, shown only to the uploader or an admin, with a confirm step
- Upload area:
  - a document type dropdown (Photo, Manual, Drawing, Service Report, Certificate, Other)
  - a multi-file chooser
  - an upload button
- Files are stored in SharePoint under "Maintenance-media". If SharePoint is not configured, the upload fails with the real message.
- Requesters can attach files only to requests they raised. Asset and work-order files are for the Maintenance team only.

### QR Asset Labels — /dashboard/maintenance/assets/labels

Access: Maintenance app with Assets view. It is reached with ?ids= (signed refs of the selected assets) or by picking a plant (?branch_id= also works).

**What it shows:**

- When assets were selected: "N selected assets from the Assets list" with a **Pick a plant instead** button.
- Otherwise: a **Plant** dropdown and a **Load labels** button. The hint reads "Up to 200 labels per sheet; decommissioned assets are skipped."
- After loading: "N labels · M A4 pages", a **Print labels** button, a print tip ("set scale to 100% (Actual size) and margins to None") and an on-screen preview.

**Label layout:**

- The sheet is A4 with 3 × 6 = 18 labels per page, each about 63 × 42 mm.
- Each label has a QR code, the asset code, the name, the plant and location, and "Scan to report a breakdown".
- The QR code holds the link /dashboard/maintenance/scan/ASSET-CODE.

The page has a **← Back** button (to Assets).

### Asset Tag Scan — /dashboard/maintenance/scan/[code]

Access: Maintenance or Production app. This is where a phone lands after scanning a label. The asset code lookup ignores upper and lower case, so a code typed by hand from a damaged label still works. An unknown code shows: "No asset with code 'X' — check the tag or ask Maintenance to re-print it."

**What it shows:**

- a card with the asset name, plant and location
- the status pill and criticality pill
- the counts of open requests (Open or Acknowledged) and open work orders
- a warning when the machine already has open requests: "Maintenance may already be on it. Raise a new one only if this is a different problem."

**Actions:**

- **Report Breakdown** (large button) opens Report a Problem with the asset pre-selected. A decommissioned asset shows a note instead, saying requests cannot be raised on it.
- **View Asset** is shown only to users with the Maintenance app.
- **← Back** goes to Requests.

### PM Schedule — /dashboard/maintenance/schedule

Access: Maintenance app with Schedule view. Results are limited by data scope. The subtitle reads: "Preventive plans raise their work orders automatically every morning, a few days before they fall due."

The page has a view switch, **Plans** or **Upcoming**. The link ?view=upcoming opens Upcoming directly. The **Plant** filter is shared by both views and can come from ?branch_id=.

#### List view (Plans)

| Column | What it shows |
|---|---|
| Plan | Plan code, PM-NNNN (not numbered per year) |
| Asset | Asset code and name |
| Title | Plan title |
| Type | Preventive, Calibration or Inspection |
| Frequency | For example "Monthly", "Quarterly", "Half-yearly", "Every 2 weeks" |
| Next Due | Next due date (red when overdue) |
| Last Done | Date the last PM job was completed |
| Technician | Default technician, or "Unassigned" |
| Current Job | The open work order number for the plan (link), or "—" |
| Status | Overdue (next due before today), Due soon (within the lead days), Scheduled, or Inactive |
| (last column) | "View" link |

Filters (Plans view):

- search (plan code, title, asset code, asset name)
- Active / Inactive / All plans (default Active)
- due date: Any; Overdue; Due within 7 days; Due within 30 days. ?due=overdue pre-sets this.

Sort: next due date, then plan code.

**Upcoming view:**

- A "window" dropdown: Next 4 weeks, Next 8 weeks (default), Next 3 months, Next 6 months.
- It loads from 60 days ago up to the end of the window, so overdue items are included.
- Entries are grouped: first "Overdue (N)" in red, then one group per week (Monday to Sunday), labelled "This week", "Earlier" or "Week of …".

Each entry shows:

- the date
- the asset
- the title, plan code and type
- the work order number and technician, or "Not raised yet"
- a state pill:
  - for projected dates: Overdue, "Due — job raised soon", or Upcoming
  - for generated jobs: the work order's status

Projected dates are worked out by stepping each active plan forward by its frequency from its next due date. Clicking an entry opens the work order if one exists, otherwise the plan.

**Top button:** **+ New PM Plan**.

### New PM Plan / Edit PM Plan — /dashboard/maintenance/schedule/new and /dashboard/maintenance/schedule/[id]/edit

Access: Maintenance app. The server needs Schedule "create" (new) or Schedule "edit" (edit). On New, ?asset= pre-selects the asset, and **← Back** returns to that asset or to the schedule. On Edit, if a job is already open for the plan, a blue banner says that checklist and spares changes apply from the next job onwards.

#### Create form

**What & Where section:**

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Asset | Asset picker | Yes | Assets (a decommissioned asset cannot have a plan) | "Pick the asset this plan is for." The asset cannot be changed on edit while a job from the plan is open. |
| Title | Text (max 255) | Yes | e.g. "Monthly lubrication & oil level check" | — |
| Job Type | Dropdown | Yes (default Preventive) | Preventive, Calibration, Inspection | — |
| Instructions | Multi-line text | No | Safety notes, lock-out steps, OEM manual reference | Copied into each generated job |

**Schedule section:**

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Every | Number + unit dropdown | Yes (default 1 Month) | Day(s), Week(s), Month(s), Year(s) | A whole number from 1 to 366 |
| Next Due From | Dropdown | Yes (default fixed) | "Due date (fixed calendar)"; "Last completion (floating)" | Fixed: the next due date is one interval after the previous due date, even when the job was late. Floating: it is one interval after the date the job was actually done. |
| Next Due Date | Date | Yes | — | When the first job falls due |
| Lead Days | Number | Yes | Pre-filled from Settings "Default PM lead days" (3) | From 0 to 365. The job is raised this many days before the due date. |

**Who & How Long section:**

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Default Technician | Searchable dropdown | No | "— Unassigned (planner assigns) —" plus active maintenance users | With a technician, the job is raised as Assigned and the technician is notified. Without one, it is raised as Draft. |
| Est. Hours | Number | No | — | 0 or more |
| Machine must be stopped | Checkbox | No | — | The generated job is a machine-down job. The machine and its workstation are blocked only once the technician starts it. |
| Plan is active | Checkbox | No (default on) | — | Inactive plans raise no jobs |

**Checklist section:** **+ Add Check** lines, each with a description (max 500, required if the line has any content) and an expected value (max 100). Lines can be moved up (↑) or removed (×). Each line is copied into every generated work order.

**Spares Kit section:** search Store items to add them. Each kit line has a quantity (above 0), the unit and remarks. The same item cannot be listed twice. The kit is copied onto each job as planned spares at the plant's default warehouse, or else the plant's first active store. Nothing is reserved or issued until the technician issues it.

On save, the user goes to the plan view.

### PM Plan view — /dashboard/maintenance/schedule/[id]

Access: Maintenance app with Schedule view. The plan must be in the user's data scope.

#### View page

**Header:** "PM-NNNN — Title" with a due-state pill.

**Banners:**

- "Current job: MWO-… (status). The next one is raised after it's closed." (link to the job)
- Green notices after actions.

**Plan section:**

| Field | Meaning |
|---|---|
| Asset | Asset code and name (link) |
| Plant | Asset's plant |
| Job Type | Preventive / Calibration / Inspection |
| Frequency | Frequency label |
| Next Due From | Fixed calendar / From last completion |
| Next Due | Next due date |
| Raised | "N days before due" |
| Last Done | Last completion date and the WO number, or "Never" |
| Default Technician | Default assignee, or "Unassigned" |
| Est. Hours | Estimated hours |
| Machine Stop | "Yes — blocked while the job runs" or "No" |
| Status | Active / Inactive |
| Instructions | Shown when filled |

**Checklist table:** #, Check, Expected.

**Spares Kit table:** Item, Qty, Remarks.

**Work Orders From This Plan.** The last 15 jobs. Columns:

- Number
- Due (PM due date)
- Technician
- Done (actual end)
- On Time ("Yes" when completed on or before the due date, "Late", or "—")
- Status

Clicking a row opens the job.

**Action buttons:**

| Button | Shows when | Action | Server permission |
|---|---|---|---|
| Generate Now | Plan active and no open job | Confirm dialog, then raises the job for the current next due date straight away, ignoring the lead days | Schedule create |
| Edit | Always | Opens the edit page | Schedule edit |
| Deactivate / Activate | Always | Confirm dialog, then switches is_active. Activating checks the asset is not decommissioned. | Schedule edit |
| Delete | The user can delete Schedule for this record | Confirm dialog, then soft delete. Refused while a job from the plan is open. Jobs already generated stay on record. | Schedule delete |
| ← Back | Always | Back to the schedule | — |

#### Edit

Every field of the create form is editable. The asset cannot be moved while a job from the plan is open. Saved checklist and kit changes apply to future jobs only.

#### Statuses & workflow

Plan due states:

- **Inactive**: the plan is switched off.
- **Overdue**: the next due date is before today.
- **Due soon**: the next due date minus the lead days is today or earlier.
- **Scheduled**: anything else.

**Daily scheduler (06:00 IST):**

- For each active plan with no open job whose due date minus lead days has arrived, it raises the PM work order. This is the same logic as Generate Now.
- Only one job is made per plan and due date.
- The PM job's priority is High if the asset's criticality is A, otherwise Normal. Its planned start and end are the due date.
- If the job for a due date was **cancelled**, that occurrence is skipped and the plan moves forward one interval.
- When a PM job is **closed**, the plan records the last done date and moves its next due date forward:
  - fixed: from the due date
  - floating: from the completion date
- With a fixed basis, a job closed very late skips the missed slots instead of creating a backlog, and a note is added to the job.
- Decommissioning the asset deactivates its plans.

### Spares — /dashboard/maintenance/spares

Access: Maintenance app with Spares view. This page is read-only over the Store. Maintenance holds no stock of its own. Header text: "Spare parts are Store items — stock, minimum and reorder level come from the Store. Add spares to an asset from its Spares tab."

#### List view

The list shows every Store item of type Spare Part, plus any Store item that is on an asset's bill of spares.

| Column | What it shows |
|---|---|
| (checkbox) | Selects the item for a combined PR. Shown only to users with the P2P app. The header box selects every below-minimum spare. |
| Item | Item code, a "Critical" pill if it is critical on any asset, the item name, the part number and the item type (if not Spare Part). A ▸ / ▾ arrow expands the row. |
| Used On | Number of assets with this item on their bill of spares |
| On Hand | Total free on-hand across every store, with the unit |
| Min / Reorder | The Store item's minimum stock / reorder level |
| Stock | Below min (red), At reorder (amber), OK (green), No min set (grey) |
| Used (90d) | Quantity consumed by maintenance work orders in the last 90 days (issues minus returns on the Store ledger) |
| (last column) | **Raise PR (qty)** button, shown when the item is below minimum and the user has the P2P app |

**Filters:**

- search (item code, name, part number, maker's part number)
- plant: keeps items stocked at that plant or used by its assets, and limits the location list
- "Below minimum only"
- "Critical only"

Sort: critical items below minimum first, then other items below minimum, then by name.

**Banner:** "N spares are below minimum stock, M of them critical." It then says either "Raise a PR to reorder." or "Ask someone with P2P access to raise a purchase request."

**Expanded row:**

- **Stock by location**: location name, plant, on-hand and reserved.
- **Used on**: chips for each asset (code, name, quantity per replacement, "critical"). Clicking a chip opens the asset.
- **Store reorder quantity**, when the item has one.

**Actions:**

- **Raise PR (qty)** opens the P2P new purchase request form, pre-filled with the item, its make, the suggested quantity and a remark explaining the shortfall. The suggested quantity is the Store reorder quantity, or else the shortfall up to the reorder level or minimum, rounded up and never less than 1.
- **Raise PR for selected (N)** (top right, P2P users) opens one PR with every ticked item.

The "below minimum" check uses the Store item's minimum stock. When no minimum is set, it uses the reorder level.

### AMC & Warranty — /dashboard/maintenance/contracts

Access: Maintenance app with Assets view.

The header explains the two kinds of cover:

- **Warranty** is the maker's or supplier's free-repair period.
- **AMC** is a paid annual maintenance contract.

The dates and vendors are edited on the asset. This page only reads them. Decommissioned and deleted assets are not listed.

**Status tiles (click to filter; click again to clear):**

| Tile | Meaning |
|---|---|
| Expired | The expiry date is before today: "Cover has lapsed — repairs are now chargeable." |
| Expiring ≤ N days | Expires today or within the chosen window |
| Active | Covered beyond the window |
| Not covered | No expiry date recorded on the asset |

#### List view

There is one row per asset per cover type (Warranty and AMC).

| Column | What it shows |
|---|---|
| Asset | Asset code and name |
| Plant | Plant |
| Crit. | Criticality pill |
| Cover | Warranty (blue) or AMC (purple) |
| Vendor | For Warranty, the asset's supplier. For AMC, the AMC vendor. |
| Expiry Date | DD-MM-YYYY |
| Days Left | "N days", "Today", "N days ago" or "No date" |
| Status | Expired / Expiring / Active / Not covered |
| (last column) | "View" link (opens the asset) |

**Filters:**

- search (asset code or name)
- plant
- cover: "Warranty + AMC", "Warranty only", "AMC only"
- status
- "Expiring within" 30, 60 (default), 90 or 180 days

Sort: Expired first (most recently expired first), then Expiring, Active and Not covered.

The footer reads "As of DATE · decommissioned assets are not listed · warranty vendor = the supplier the asset was bought from."

**Top button:** **Export Excel**. It downloads maintenance_amc_warranty_DATE.xlsx using the current filters. The server needs Assets "export".

The header text mentions reminders 30, 15, 7 and 1 day before expiry and the day after. That wording is fixed in the page. The real reminder days come from Settings (those are the defaults).

### Maintenance Reports — /dashboard/maintenance/reports

Access: Maintenance app with Reports view. All figures respect the user's data scope.

**Filters:**

- From and To (default: the 1st of this month to today; maximum 3 years; From cannot be after To)
- Plant (shown when there is more than one plant; changing it clears Asset)
- Category
- Asset (asset picker limited to the plant)

**Top button:** **Export Excel**. It downloads maintenance_report_FROM_to_TO.xlsx. The server needs Reports "export". The workbook has these sheets:

- Summary
- Downtime by Month
- Downtime by Asset
- PM Compliance
- Breakdown vs Planned
- Cost by Month
- Cost by Asset
- Top 10 by Breakdowns
- Top 10 by Downtime
- Backlog
- Failure Pareto

**KPI tiles.** Each tile's caption shows the definition from the server.

| KPI | Definition |
|---|---|
| Downtime | Hours machines were down on breakdown and corrective (machine-down) work orders, counted only inside the period. The caption includes the number of breakdowns. |
| MTTR | Average downtime per breakdown or corrective machine-down job (finished repairs that started in the period). Lower is better. |
| MTBF | (Available hours − breakdown downtime) ÷ number of breakdown jobs. Higher is better. |
| Availability | Share of available working hours the machines were not down on breakdown jobs. Planned PM shutdowns do not count against it. Green at 95% or more, amber at 85% or more, red below that. |
| PM Compliance | PM jobs done on or before their due date ÷ PM jobs that fell due in the period. Jobs cancelled after their due date count as skipped. Jobs not yet due, and jobs cancelled because the asset was decommissioned, are left out. Green at 90% or more, amber at 70% or more. |
| Maintenance Cost | Spares issued (net of returns, at issue cost) + labour + outside-vendor cost of jobs finished in the period |

Under the tiles, an **available-hours basis** note explains how working hours were counted. Each asset uses one of these, in order:

1. its Production workstation's capacity hours per day
2. its plant's working hours
3. the Settings default (8 hours a day)

**Sections:**

- **Breakdown downtime by month.** Bar chart, in hours.
- **Maintenance cost by month.** Stacked bars of Spares, Labour and External, for jobs finished in each month.
- **PM compliance.** Due in period, Done on time, Done late, Overdue not done, Not yet due.
- **Breakdown vs planned work.** Jobs raised in the period, shown as a red/green bar: breakdown + corrective against preventive + calibration + inspection, with the planned share in percent. Improvement jobs are counted separately and left out.
- **Top 10 — most breakdowns** and **Top 10 — most downtime.** Asset, Breakdowns, Downtime. Clicking a row opens the asset.
- **Backlog — open work orders by age.** As of today, not limited to the period. Rows are age buckets 0-2, 3-7, 8-30 and >30 days. Columns are the priorities and a total.
- **Failure Pareto.** Breakdown and corrective jobs by failure category ("Not recorded" when blank), with the job count, a share bar and the cumulative percent.
- **Cost by asset.** Asset, Jobs, Spares, Labour, External, Total, for jobs finished in the period.
- **Availability by asset.** Assets that had breakdowns: Breakdowns, Downtime, Available hours, Availability %.

### Settings — /dashboard/maintenance/settings

See Section 4.

### Ongoing Projects (old link) — /dashboard/maintenance/project-work

This is not a real screen. It redirects to the shared /dashboard/ongoing-projects page, keeping ?id= if one was given. The permission registry still has a "project_work" (Ongoing Projects) sub-tab under Maintenance, but there is no tab for it in the Maintenance sub-nav.

## 4. Settings / Masters

**Maintenance Settings** (/dashboard/maintenance/settings) uses the shared module settings page. Every setting shows:

- its help text
- a "Reset to default" link (with a confirm step; resets are recorded in the audit log)
- who changed it and when, plus the default value, when it is not at its default

There is one Save button. Users without edit rights see a read-only notice: "Only admins or users whose role grants Maintenance › Settings → Edit can change these settings…". Each default is the value the code had hard-coded before the page existed.

| Group | Setting | Type | Default | What it controls |
|---|---|---|---|---|
| Preventive maintenance | Default PM lead days | Whole number, 0–365 | 3 | Pre-filled lead days on a new PM plan. Each plan can override it. |
| Preventive maintenance | Dashboard "PM due" window (days) | Whole number, 1–90 | 7 | How far ahead (today included) the dashboard PM-due card and KPI look |
| Breakdown requests | Default priority — criticality A, machine down | Low/Normal/High/Urgent | Urgent | Priority given when the requester leaves priority on Auto |
| Breakdown requests | Default priority — criticality B, machine down | same | High | same |
| Breakdown requests | Default priority — criticality C, machine down | same | Normal | same |
| Breakdown requests | Default priority — criticality A, machine running | same | High | same |
| Breakdown requests | Default priority — criticality B, machine running | same | Normal | same |
| Breakdown requests | Default priority — criticality C, machine running | same | Normal | same |
| Breakdown requests | Requester must confirm before close | On/Off | On | On: a work order raised from a request cannot be closed until the requester confirms the machine is OK. Off: the planner can close as soon as the job is Completed. |
| AMC & warranty reminders | Remind this many days before expiry | List of whole days, each 1–365 | 30, 15, 7, 1 | The days before warranty or AMC expiry on which the daily reminder fires. An empty list means no advance reminders. |
| AMC & warranty reminders | Remind this many days after expiry | Whole number, 0–30 | 1 | One more reminder after the cover has lapsed. 0 means none. |
| Reliability KPIs (MTBF / availability) | Default available hours per day | Decimal, 0.5–24 | 8 | Used for MTBF and availability when an asset has no linked workstation capacity and its plant's working hours cannot be read |
| Spares | Alert planners when a critical spare drops below minimum | On/Off | On | On: issuing a critical spare that leaves total on-hand under the Store minimum (or reorder level) sends planners a bell and Teams reminder, once per item per day |

**Masters used by the module.** None of these are maintained inside Maintenance.

- **Plants and Departments**: Organization.
- **Production workstations**: Production.
- **Store items, locations, stock, minimum, reorder level and reorder quantity**: Store.
- **Vendors**: the shared vendor master.
- **Technicians**: active users who have the Maintenance app, excluding admins.

The fixed value lists are set in code and cannot be changed by admins:

- asset categories
- criticality
- request types
- priorities
- work order types
- failure categories
- document types
- PM frequency units and schedule basis

## 5. Permissions

**App access:**

- The Maintenance app gives the full module.
- Users with only the Production app can:
  - open the Requests list (only their own requests), Report a Problem and the request view
  - confirm or reject a repair on their own request
  - attach files to their own requests
  - open the QR scan page
  - use the asset picker
- Production-only users cannot acknowledge, reject or convert requests: "Only the Maintenance team can triage requests."

**Sub-tab permission keys** (Organization › Role & Permissions; module "maintenance"):

| Sub-tab key | Label | Actions available |
|---|---|---|
| dashboard | Dashboard | view |
| project_work | Ongoing Projects | view, edit |
| requests | Requests | view, create, edit (there is no delete) |
| work_orders | Work Orders | view, create, edit, approve, reject, export, print (there is no delete) |
| assets | Assets / AMC & Warranty | view, create, edit, delete, export, import |
| schedule | PM Schedule | view, create, edit, delete |
| spares | Spares | view, create, edit, delete, export |
| reports | Maintenance Reports | view, export, print |
| settings | Settings | view, edit |

**What each action gates (checked on the server):**

| Action | Permission |
|---|---|
| Dashboard data | maintenance:dashboard:view |
| Acknowledge / Reject / Mark Duplicate a request | maintenance:requests:edit (and the Maintenance app) |
| Create Work Order from a request; New Work Order | maintenance:work_orders:create |
| Assign, Reassign, Start, Hold, Resume, Complete, Edit Details, checklist, spares plan/issue/return/remove, labour | maintenance:work_orders:edit |
| Verify & Close, Reopen, Cancel; approve the close-out approval stage | maintenance:work_orders:approve (close-out stage: same plant) |
| Work Orders list | maintenance:work_orders:view |
| Assets list, bill of spares view, AMC & Warranty, QR label sheet, import template | maintenance:assets:view |
| Create / edit / delete asset; save bill of spares | maintenance:assets:create / edit / delete (delete also checks the ownership rule) |
| Import assets from Excel | maintenance:assets:import |
| Export AMC & Warranty | maintenance:assets:export |
| PM Schedule list, calendar, plan view | maintenance:schedule:view |
| New PM plan; Generate Now | maintenance:schedule:create |
| Edit / Activate / Deactivate PM plan | maintenance:schedule:edit |
| Delete PM plan | maintenance:schedule:delete (also checks the ownership rule) |
| Spares page | maintenance:spares:view |
| Reports | maintenance:reports:view; Export Excel needs maintenance:reports:export |
| Edit settings | maintenance:settings:edit, or admin |
| Raise PR from Spares | The P2P app (the buttons are hidden without it) |
| Delete an attachment | Uploader or admin |
| Confirm a repair | The person who raised the request, or admin |

**Data scope** (Role & Permissions › Data access). It limits which records a user lists and opens:

| Record | "Own" means | "Assigned" adds |
|---|---|---|
| Work orders | Created by the user | Assigned technician, completer, anyone who logged labour on it, the person who raised its request |
| Requests | Raised by the user | Who acknowledged it, the technician of the work order it became |
| Assets | Registered by the user | — |
| PM plans | Created by the user | Default technician |

Work orders, requests and PM plans take their plant and department from their asset, for plant and department scopes. The dashboard and reports use the same scopes.

**Planners.** For notifications and the close-out approval, "planners" are maintenance users of the plant who hold maintenance:work_orders:approve.

## 6. Documents, Notifications & Integrations

**Generated documents.** The module does not generate Word or PDF documents. It produces:

- the AMC & Warranty Excel export
- the Maintenance Reports Excel export (11 sheets)
- the Excel asset import template (with an Instructions sheet)
- printable A4 QR label sheets, printed through the browser

Files that users upload (photos, manuals, drawings, service reports, certificates) are stored in SharePoint under "Maintenance-media".

**Notifications.** Bell notifications only, unless Teams is mentioned:

| Event | Who is notified | Channel |
|---|---|---|
| Request raised | All active maintenance users of the asset's plant (except the raiser). "URGENT:" prefix when priority is Urgent; "MACHINE DOWN" when stopped. | Bell |
| Request rejected / marked duplicate | The person who raised it, with the reason | Bell |
| Work order assigned (create, convert, assign/reassign, PM generation with a default technician) | The technician | Bell |
| Work order completed | The requester ("done — please confirm") and the WO creator | Bell |
| Requester confirms the machine is OK | WO creator and the person who acknowledged the request | Bell |
| Requester says still a problem | Technician and WO creator ("reopened — machine not OK") | Bell |
| Close-out approval rejected / returned | Technician ("MWO-… reopened") | Bell |
| Close-out approval pending | Approvers, through the central approval engine | Engine's own notifications |
| Critical spare below minimum after an issue | Plant planners (work_orders:approve), once per item per day; can be switched off in Settings | Bell + Teams |
| PM job overdue (daily scheduler, 06:00 IST) | Assignee + plant planners, once per user per job per day | Bell + Teams |
| Warranty / AMC expiring or expired (daily, 06:15 IST, on the Settings days) | Plant planners (falls back to every maintenance user of the plant if no planner is set up); one message when both covers trigger the same day | Bell + Teams |

**Links to other modules:**

- **Production.** An asset can be linked to a Production workstation. While the asset is Breakdown or Under Maintenance, the workstation is set to "under maintenance". It goes back to "active" when the asset is released, but is never re-activated if someone set it inactive. Production supervisors raise and confirm breakdown requests through the Production app. Workstation capacity hours feed availability and MTBF.
- **Store.** Spares are Store items. Issue and return on a work order post "issue" and "return_in" transactions on the Store stock ledger, with reference type "maintenance_work_order" and the WO number. Stock, minimum, reorder level and reorder quantity are read live from the Store. The PM spares kit uses the plant's default warehouse, set in Company Info.
- **P2P (Purchase).** "Raise PR" on the Spares page opens a pre-filled Purchase Request.
- **Accounts / vendor master.** Supplier, AMC vendor and external service vendor are picked from the shared vendor master.
- **Organization.** Plants, departments, plant assignments of users, Role & Permissions (sub-tabs and data scope) and the central Approval Workflows engine (the "Maintenance work order close-out" transaction).
- **Ongoing Projects.** The old Maintenance "project-work" link forwards to the shared Ongoing Projects page.
