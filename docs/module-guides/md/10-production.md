# Production Module

The Production module is where the factory turns an approved design into a finished product. It holds the engineering masters for manufacturing (Bills of Materials with their routing, and Workstations), raises Work Orders that draw components from Store and post finished goods back into Store, runs the Shop Floor (operation start/complete, time booking, in-process quality gates), plans material and capacity, and reports output, scrap, cost and utilization. On top of that sits the RRV Build record: one record per Rail-cum-Road Vehicle that ties together its work orders, a fixed 12-stage checklist with automatic gates, vehicle tests, rework orders and the customer handover that registers the vehicle in the ERP machine registry. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) Production sits after BOM and Store/Purchase: it consumes Store stock, raises Purchase Requests for shortages, hands parts and vehicles to Quality for inspection, and at RRV handover creates or activates the Machine record that Service works from.

## 1. Navigation Tabs

The sub-nav sits above every Production page header. Each tab is shown only if the user has access to that tab in the permission matrix. A Guided Tour button and the notification bell sit at the right end of the nav.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/production | KPI cards, work orders due in the next 7 days and recent work orders |
| RRV Builds | /dashboard/production/rrv-builds | List of Rail-cum-Road Vehicle builds (and the Rework Orders list from a button) |
| Work Orders | /dashboard/production/work-orders | List of all work orders with status tabs and filters |
| Shop Floor | /dashboard/production/shop-floor | Board of open operations grouped by workstation |
| Planning | /dashboard/production/planning | Material requirements vs stock, workstation load, schedule timeline |
| BOM & Routing | /dashboard/production/bom | List of Bills of Materials (components + routing operations) |
| Workstations | /dashboard/production/workstations | Master list of machines / work centers |
| Reports | /dashboard/production/reports | Output, cost variance and workstation utilization for a date range |

Note: the old route /dashboard/production/project-work is not in the nav. It only redirects to the shared /dashboard/ongoing-projects page (keeping an opened project via ?id=).

## 2. Dashboard

Route: /dashboard/production. Title "Production Dashboard". All numbers come from one call to the backend dashboard endpoint. Work-order counts and lists follow the user's Production data scope; time-log totals follow the time-log data scope.

### Header

- Shows "Production Module" and the title "Production Dashboard".
- **Actions:** "+ New Work Order" button opens /dashboard/production/work-orders/new.

### KPI row 1

| Card | What it shows | How it is computed | Click |
|---|---|---|---|
| In Progress | Number of work orders in status In Progress; sub-line "X released · Y draft" | Count of non-deleted, in-scope work orders by status | Opens Work Orders list |
| Overdue | Work orders past planned end date (red when above zero); sub-line "Past planned end date" | Open work orders (draft, released, in progress) whose planned end date is before today | No action |
| Material Shortages | Number of items short (red when above zero); sub-line "Items short for released orders" | Count of items where outstanding demand of released / in-progress work orders is more than what they already hold reserved plus free Store stock (all locations) | Opens Planning |
| Awaiting Inspection | Quality gates pending (blue when above zero) | Operations on released / in-progress work orders whose quality inspection is pending / in progress, plus operations whose in-process inspection lot is still open (no usage decision) | Opens Shop Floor |

### KPI row 2

| Card | What it shows | How it is computed | Click |
|---|---|---|---|
| Output (30 days) | Units received into Store; green | Sum of Store "receipt" transactions referencing a work order in the last 30 days, plus quantity of non-cancelled final-inspection lots created from work orders in the last 30 days | No action |
| Scrap (30 days) | Scrap quantity booked; sub-line "% of output" = scrap ÷ (output + scrap) | Sum of scrap quantity in time logs dated in the last 30 days | No action |
| Hours Booked (30 days) | Total hours | Sum of hours in time logs dated in the last 30 days | No action |
| Masters | "Active BOMs / active workstations" | Count of BOMs with status Active and workstations with status Active | Opens BOM & Routing |

### Due in the next 7 days

- Up to 8 open work orders (draft, released, in progress) whose planned end date is on or before today + 7 days (this includes ones already overdue), sorted by planned end date.
- Each row: WO number, product name, completed / planned quantity, planned end date (red if overdue), status pill (Draft, Released, In Progress, Completed, Closed, Cancelled).
- Empty text: "Nothing due this week."
- **Actions:** clicking a row opens that work order.

### Recent work orders

- The 8 most recently created work orders, same row layout as above.
- Empty text: "No work orders yet — create a BOM, activate it, then raise a work order."
- **Actions:** clicking a row opens that work order.

If loading fails, a red error banner shows the real reason from the server.

## 3. Screens

### RRV Builds list — /dashboard/production/rrv-builds

Header: "RRV Builds" with the line "One record per Rail-cum-Road Vehicle — from planning through assembly, testing and rework to customer handover."

#### List view

Top buttons:
- **Rework Orders** (secondary) opens /dashboard/production/rrv-builds/rework.
- **+ New RRV Build** opens /dashboard/production/rrv-builds/new.

Status tabs (pills): Open (planned, in progress, on hold, completed), In Progress, On Hold, Ready for Handover (completed), Handed Over, Cancelled, All. Default is Open.

Filters:
- Search box "Search build no., model, customer, serial, chassis or PO…" (searches build number, RRV model, customer name, vehicle serial, chassis number, customer PO number; waits 250 ms after typing).
- Checkbox "Past target handover only" shows only overdue builds.

Sort: newest created first (maximum 1000 rows). The list follows the user's data scope (owner = creator, assigned = build manager or any stage assignee, plant = build plant).

| Column | What it shows |
|---|---|
| Build | Build number (RRV-YEAR-NNNN); a coloured priority word under it when priority is not Normal (LOW, HIGH, URGENT) |
| Model / Customer | RRV model; below it customer name and "PO <number>" if set |
| Serial · Chassis | Vehicle serial number (or linked machine label); below it chassis number or "no chassis no. yet" |
| Progress | Green bar and "done / total stages" (a stage counts as done when Completed or N/A) |
| Current Stage | Label of the first stage not yet done; "—" once handed over |
| Rework | "N open" in red when open rework orders exist (open, in progress, awaiting verification), else "—" |
| Target Handover | Target handover date; red with "· overdue" when the date has passed and the build is planned, in progress, on hold or completed |
| Status | Pill: Planned, In Progress, On Hold, Completed, Handed Over, Cancelled |
| (action) | "View" link |

Row actions: clicking the row or "View" opens the build page.
Empty text: "No RRV builds here. Start one with “+ New RRV Build”."

### New RRV Build — /dashboard/production/rrv-builds/new

Header "New RRV Build" with the hint "Creates the build with its 12-stage checklist. Work orders, tests and handover are added from the build page." Top-right "← Back" returns to the list.

#### Create form

Section "Vehicle & order":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| RRV model | text | Yes | Free text, e.g. "PR-RRV 4x4 Tower Wagon" | At least 2 characters |
| Customer | text | No | Free text, e.g. "Northern Railway" | — |
| Customer PO no. | text | No | Free text | — |
| PO date | date | No | Date picker | — |
| Order / tender ref. | text | No | LOI / tender / inquiry number | — |

Section "Vehicle identity":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Existing machine in ERP (optional) | searchable dropdown | No | ERP machines (serial, model, client); first option "None — register at completion" | Machine must exist; one machine can only be on one non-cancelled build |
| Vehicle serial no. | text | No | e.g. "PR-RRV-2026-014" | Disabled (shows "from machine") when a machine is picked. If typed without a machine, it must not already exist in the machine registry (otherwise "link that machine instead") |
| Chassis no. | text | No | Free text | Needed before RRV Completion |
| Engine no. | text | No | Free text | — |
| Year | text | No | Placeholder = current year | Max 10 characters |

Hint under the section: if no machine is picked, the vehicle is registered in the ERP machine registry automatically at RRV Completion using the serial and chassis numbers, so Service can raise warranty tickets after handover.

Section "Plan":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Build manager | searchable dropdown | No (defaults to current user) | Active users | Must be an active user who has the Production app |
| Plant | searchable dropdown | No | Branches (plants); "None" | Plant must exist |
| Priority | dropdown | No (default Normal) | Low, Normal, High, Urgent | — |
| Planned start | date | No | — | — |
| Target completion | date | No | — | Cannot be before planned start |
| Target handover | date | No | — | Cannot be before planned start or target completion |
| Warranty (months) | number (digits only) | No (default 12) | — | Whole number 0–120 |
| Remarks | multi-line text | No | "Special customer requirements, variant, deviations…" | — |

Section "Vehicle tests required before handover": a checkbox list of all 13 test types. Pre-ticked defaults: Static inspection (dimensions & weight), Rail guide-wheel deployment / retraction, Brake test — road mode, Brake test — rail mode, Road trial, Rail trial, Emergency stop & interlocks. Other options: Rail gauge & wheel profile check, Load / towing test, Lighting, horn & signalling, Hydraulic functions, Electrical functions, Other. At least one test must be ticked. Hint: the Vehicle Testing stage can only be completed once the latest record of each ticked test is a pass; this can be changed later on the build.

Buttons: **Cancel** (back to list) and **Create RRV Build**. On save the build gets number RRV-YEAR-NNNN, status Planned, all 12 stages seeded as Not Started, a "created" timeline event, and the page opens the new build. Requires RRV Builds › Create permission.

### RRV Build view — /dashboard/production/rrv-builds/[id]

The URL uses a signed record reference; an edited link shows "Invalid link" with a "Back to RRV builds" link.

#### View page

Header: "RRV Build" label, build number, "— RRV model", status pill, a progress bar with "done/total stages · now: <current stage>" (current stage hidden once handed over). Top-right "← Back".

Banners: green success message after an action; red error banner with the server's reason; amber "On hold: <reason>" when on hold; red "Cancelled: <reason>" when cancelled.

Action buttons (shown only when the server's allowed-actions list contains the action):

| Button | When it appears | What it does |
|---|---|---|
| Edit Details | User has RRV Builds › Edit, build is planned / in progress / on hold (not completed, handed over or cancelled) | Opens the edit panel |
| Put on Hold | Edit permission and build is Planned or In Progress | Asks for a reason (min 3 characters); status becomes On Hold |
| Resume | Edit permission and build is On Hold | Goes back to In Progress (if it had started) or Planned |
| Handover Certificate (PDF) | Build is Handed Over | Opens the handover certificate PDF (requires RRV Builds › Print) |
| Cancel Build | User has RRV Builds › Approve AND is the build manager, a production manager or an admin; build is planned / in progress / on hold | Asks for a reason. Blocked while linked work orders are released / in progress, while draft work orders are still linked, or while rework orders are open |
| Delete | User has RRV Builds › Delete, build is Planned, and user is the creator or an admin | Confirm dialog; only allowed if no work orders, tests or rework orders are linked (soft delete) |

Info panel (when not editing):

| Field | Meaning |
|---|---|
| Customer | Customer name |
| Customer PO | PO number and PO date |
| Machine / serial | Linked machine label, or typed serial, or "Registered at completion" |
| Chassis · engine | Chassis and engine numbers |
| Build manager | Build manager name |
| Priority | Low / Normal / High / Urgent |
| Target completion | Date |
| Target handover | Date, with "(overdue)" when past |

The page then has six tabs: Stages, Work Orders & Material (count), Tests (count), Rework (N open), Handover, Timeline.

#### Stages tab

At the top is the shared **Sign-off approval** panel (central approval engine, workflow "RRV sign-off"), where pending sign-off requests can be approved, rejected or withdrawn.

Below, "Build stages" lists the 12 stages in order. Each row shows: sequence number (or a tick when done), stage label, status pill (Not Started, In Progress, Completed, N/A), phase (Plan, Build, Verify, Close), "manager sign-off" tag for RRV Completion and Production Handover, "overdue" when the stage planned end has passed, assignee ("Assigned to X" or "Unassigned"), due date, who completed or marked N/A and when, stage remarks, and either a bulleted list of gate problems (what still blocks completion) or "Ready to complete."

| # | Stage | Phase | N/A allowed | Gate (must be true to complete) |
|---|---|---|---|---|
| 1 | Production Planning | Plan | No | Target completion date set; target handover date set; a main work order linked |
| 2 | Material Kitting & Issue | Plan | No | At least one work order linked; no linked work order still draft; every linked work order that is not completed/closed has all material lines fully issued |
| 3 | Sub-Assemblies | Build | Yes | At least one sub-assembly work order linked; all of them completed or closed |
| 4 | Chassis & Main Assembly | Build | No | Main work order linked and in progress, completed or closed; Sub-Assemblies stage done (or N/A) |
| 5 | Electrical Integration | Build | Yes | Machine linked to the build; at least one Electrical job exists for the machine; every non-cancelled Electrical job is handed over or closed |
| 6 | Hydraulic & Pneumatic Integration | Build | Yes | Machine linked; at least one Hydraulic system registered for the machine; each system's latest completed test result is pass or conditional |
| 7 | Final Assembly | Build | No | Main work order completed or closed; stages 4, 5 and 6 done (or N/A) |
| 8 | Final Quality Inspection | Verify | No | Final inspection requested from Quality and its status is passed or conditionally passed |
| 9 | Vehicle Testing | Verify | No | At least one required test; latest record of every required test is a pass |
| 10 | Rework & Punch-list Closure | Verify | No | No rework order open, in progress or awaiting verification |
| 11 | RRV Completion | Close | No | All stages 1–10 done; vehicle serial number (or linked machine) present; chassis number present |
| 12 | Production Handover | Close | No | RRV Completion done; handover date, handed-over-to name and handover location entered (Handover tab) |

Stage row actions (only when the user has the "stages" action — Edit permission and build planned / in progress, or completed):
- **Assign…** dropdown (active users with the Production app): sets the stage assignee immediately.
- **Start**: only for Not Started stages; stage becomes In Progress. The first stage started moves a Planned build to In Progress.
- **Complete** / **Request Sign-off**: disabled (greyed, tooltip lists the problems) while gate problems exist. Opens a prompt for optional remarks. For ordinary stages it completes immediately. For RRV Completion and Production Handover it goes through the approval engine: a user who can sign off (RRV Builds › Approve and is the build manager, a production manager or admin) completes it in one click; anyone else with Edit sees "Request Sign-off" and the request goes to the build manager / production managers.
- **N/A**: only on stages 3, 5, 6; asks why the stage does not apply (min 3 characters).
- **Reopen**: on done stages, only for users who can sign off, and not after handover. Asks for a reason. Not allowed if any later stage is already done (reopen latest first). Reopening RRV Completion moves the build back to In Progress.
- On the Final Quality Inspection row, a line shows "Quality: <inspection number> — <status>" or "not requested yet", and a **Request final inspection** button (or **Request re-inspection** if the last one failed). This requires Final Assembly to be done; it creates a Quality inspection of type "final" (number FIN-…) for the vehicle and notifies all Quality app users.

What completing the sign-off stages does:
- **RRV Completion**: registers the vehicle in the ERP machine registry (creates a new machine of type RRV with the serial number if none is linked — refused if the serial already exists — or fills in the linked machine's model, client, chassis, engine, year, PO number and PO date). Machine status stays "manufacturing under progress". Build status becomes Completed. Build manager and creator get a bell notification "RRV completed".
- **Production Handover**: machine status becomes Active, delivery date and handover date = handover date, commissioning date and site location filled, warranty start = handover date, warranty end = handover date + warranty months. Build status becomes Handed Over. Build manager and creator get "RRV handed over"; every ERP app user gets "New machine in service: <serial>".

#### Work Orders & Material tab

Section "Linked work orders":
- **+ Main Work Order** (only when no live main work order exists) and **+ Sub-Assembly Work Order** open the New Work Order form pre-linked to this build with that role. Both need the "link_work_order" action (Edit, build planned or in progress).
- Table columns: Work order (click opens it), Role (Main assembly / Sub-assembly), Product (code — name), Operations (done / total), Material ("N line(s) to issue" in amber, or "all issued" in green), Due (planned end), Status pill, and an **Unlink** button (not allowed once the build is completed).
- Empty text: "No work orders yet. Raise the main (final vehicle assembly) work order first, then one per sub-assembly."
- "Link an existing work order": searchable dropdown of draft / released / in progress / completed work orders not on any build and for the same machine (or no machine), an "As" dropdown (Sub-assembly, or Main assembly if no main exists), and a **Link** button. Rules: only one main work order per build; a cancelled work order cannot be linked; a work order already on another build must be unlinked there first; work order and build must be for the same machine. Linking fills the work order's machine from the build if blank.

Section "Material consumption (all linked work orders)": summary "X of Y items fully issued · consumed value ₹…", then a table:

| Column | What it shows |
|---|---|
| Item | Item code and name |
| Required | Total required across linked (non-cancelled) work orders, with UOM |
| Issued | Total issued |
| Returned | Total returned |
| Consumed | Issued minus returned |
| Still to issue | Outstanding quantity (amber if above zero) |
| Value (₹) | Consumed × item unit cost (Store standard cost, else moving-average cost) |
| Work orders | Work order numbers using the item |

Section "Electrical & hydraulic (from their modules)" (only if any exist for the linked machine): each Electrical job (number, title, status) and each Hydraulic system (number, name, status).

#### Tests tab

Section "Required tests": chips for each required test showing its latest status (tick pass in green, cross fail in red, circle pending in grey). **Change** button (Edit permission, build not completed) turns it into the checkbox list with Save / Cancel; at least one test must stay ticked.

Section "Record a test" (only with the "record_test" action):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Test | dropdown | Yes | The 13 test types | Must be a known type |
| Date | date | Yes (default today) | — | Cannot be in the future |
| Result | dropdown | Yes (default Pass) | Pass, Fail | — |
| Witnessed by | text | No | e.g. "RDSO inspector, customer rep." | — |
| Expected / acceptance | text | No | e.g. "stop within 30 m at 25 km/h" | — |
| Observed | text | Required for a Fail (unless remarks given) | e.g. "stopped in 27 m" | Server requires observed or remarks for a failed test |
| Rework assigned to | searchable dropdown | No (shown only for Fail) | Active users | Must be an active Production user |
| Remarks | text | No | — | — |

**Record Test** saves the record (tested by = current user). If the most recent earlier record of the same test type was a fail, the new record is saved as a retest of it. A Fail automatically raises a rework order "Failed test — <test>" (source "Failed vehicle test").

Section "Test history": columns Date, Test (with "retest" tag), Result pill (with the rework number raised from it), Expected, Observed (plus remarks), Tested / witnessed. A **Delete** button appears for tests with no rework raised; the server only allows the person who recorded it (or an admin), and not after the Vehicle Testing stage is completed.

#### Rework tab

"+ Raise Rework" (needs the "raise_rework" action) opens an inline form: What needs fixing (required, min 3 characters), Assign to (active users), Due (date), Defect details. **Raise** creates a rework order RW-YEAR-NNNN, source "Raised manually", and notifies the build manager, creator and assignee.

Each rework row shows: rework number, status pill (Open, In Progress, Awaiting Verification, Verified, Cancelled), title, "overdue" if past due while open, source (Failed vehicle test / Failed final inspection / Failed operation inspection / Raised manually) with inspection number and work order number, assignee, due date, defect, corrective action with who did it and hours, verification or send-back remarks, cancel reason.

Row actions (shown to users with stage or test rights):
- **Start** (Open): becomes In Progress; assignee defaults to the current user.
- **Mark Done** (Open or In Progress): inline fields Corrective action (required), Root cause, Hours; becomes Awaiting Verification and notifies build manager and creator that someone else must verify.
- **Verify** (Awaiting Verification): optional remarks. Must be someone other than the person who did the work, and the failed check must have passed again (a later passing test of the same type, or a newer passed Quality inspection / accepted in-process gate).
- **Send Back** (Awaiting Verification): reason required; goes back to In Progress and notifies the doer and assignee. Also cannot be done by the doer.
- **Cancel** (sign-off users only, Open / In Progress / Awaiting Verification): reason required; skips verification.

Rework is also raised automatically when Quality fails the build's final inspection, or fails an operation inspection on a work order linked to the build (once per inspection).

#### Handover tab

- **Edit** (Edit permission, build not handed over or cancelled) opens fields: Handover date (cannot be in the future), Commissioning date, Handed over to (name), Organisation (defaults to customer), Location, Customer acceptance ref., Warranty (months, 0–120), Remarks; Save / Cancel. When the build is Completed, only these handover fields (and remarks) can still be changed.
- Read view: Handover date, Commissioning date, Handed over to (name, organisation), Location, Customer acceptance ref., Warranty ("N months from handover"), Signed off (who and when, after handover), Remarks.
- After handover, a **Managed Word document** panel for the handover certificate is shown: the certificate can be created as a Word document to add wording, photos or notes, then edited or uploaded (needs RRV Builds › Edit); "Handover Certificate (PDF)" then prints that Word version.
- Footer text: fill these in, then complete the Production Handover stage (manager sign-off).

#### Timeline tab

Newest first: actor name (or "System"), action text (created the build, updated the build, put on hold, resumed, cancelled, started / completed / marked N/A / reopened a stage, sent for sign-off, linked / unlinked work order, requested final inspection, recorded / deleted test, raised / started / finished / verified / sent back / cancelled rework, completed the RRV, handed the RRV over), the comment, and date-time.

#### Edit

"Edit Details" panel fields: RRV model, Customer, Customer PO no., Order / tender ref., Vehicle serial no. (disabled when a machine is selected), Chassis no., Engine no., Year, PO date, Machine in ERP, Build manager, Priority, Planned start, Target completion, Target handover, Remarks. Save / Cancel. Same validation as create. RRV model, priority and warranty cannot be emptied. Locked entirely when handed over or cancelled; when completed only handover fields may change (the server says to reopen RRV Completion to correct identity). Changing the machine also fills it on linked work orders that have none. Each save adds an "updated" timeline event listing the changed fields.

#### Statuses & workflow

| Status | Meaning | How it is reached |
|---|---|---|
| Planned | Created, no stage started | On create; Resume of a build that never started |
| In Progress | Work has started | First stage started or completed; Resume; reopening RRV Completion |
| On Hold | Paused with a reason | Put on Hold (Edit) from Planned / In Progress |
| Completed | RRV Completion signed off, vehicle in machine registry | Completing stage 11 (sign-off) |
| Handed Over | Delivered to customer, machine active | Completing stage 12 (sign-off) |
| Cancelled | Kept on record with reason | Cancel Build (Approve + build manager / production manager / admin) |

Sign-off approval: workflow "production.rrv_signoff" (Organization › Approval Workflows). Default single stage: the build manager or any production manager (users flagged as production manager). The approver also needs RRV Builds › Approve; self-approval is allowed.

### Rework Orders — /dashboard/production/rrv-builds/rework

Header "Rework Orders": "Every rework across all vehicles — raised from failed tests, failed inspections, or manually." Top-right "← Back" to RRV Builds.

#### List view

Status tabs: Open (open, in progress, awaiting verification — default), Awaiting Verification, Verified, Cancelled, All. Checkbox "Assigned to me". Sorted newest first, max 1000, data-scoped (owner = creator; assigned = assignee or doer; plant = the build's plant). Requires the RRV Builds tab.

| Column | What it shows |
|---|---|
| Rework | Rework number |
| Build | Build number and RRV model |
| What needs fixing | Title |
| Source | Source label, with inspection number when from Quality |
| Assigned to | Assignee |
| Due | Due date; red "· overdue" when past due and still open |
| Status | Open, In Progress, Awaiting Verification, Verified, Cancelled |
| (action) | "Open build" link |

Clicking a row or "Open build" opens the RRV build page (rework is worked on from the build's Rework tab). Empty text: "No rework orders here."

### Work Orders list — /dashboard/production/work-orders

#### List view

Top button: **+ New Work Order**.

Status tabs: Open (draft, released, in progress — default), Draft, Released, In Progress, Completed, Closed, Cancelled, All.

Filters: search "Search by WO number or product…" (WO number, product name, product code); priority dropdown (All priorities, Low, Normal, High, Urgent); checkbox "Overdue only" (planned end before today and status draft / released / in progress). Sorted newest first. Data scope: owner = creator, assigned = supervisor, plant = WO plant.

| Column | What it shows |
|---|---|
| WO Number | WO-YEAR-NNNN |
| Product | Product code — name |
| Machine / Project | ERP machine label (serial — model (client)) or "—" |
| Qty | Completed / planned with UOM |
| Progress | Green bar and percent (completed ÷ planned, max 100) |
| Priority | Pill Low / Normal / High / Urgent |
| Planned End | Date; red "· overdue" when overdue |
| Status | Draft, Released, In Progress, Completed, Closed, Cancelled |
| (action) | "View" |

Row click or "View" opens the work order. Empty text: "No work orders found."

### New Work Order — /dashboard/production/work-orders/new

Can be opened plain, from a BOM (?bom_id= pre-selects it), from Planning "Build" (?bom_id= and ?quantity=), or from an RRV build (?rrv_build_id= and build_role=main or sub_assembly). Links use signed references; an edited link shows "Invalid link". When opened from an RRV build, a blue banner says the order will be linked to the build as its main (final vehicle assembly) or sub-assembly order and uses the build's machine, so Machine should be left blank. "← Back" returns to the build or the list.

#### Create form

Section "What to build":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Product / Active BOM | searchable dropdown | Yes | Active BOMs only (product label) | BOM must be Active; product must be active in Store; every component must be active in Store |
| Quantity | number | Yes (default 1, or from link) | — | More than zero |
| Priority | dropdown | No (default Normal) | Low, Normal, High, Urgent | — |
| For Machine / Project (ERP) | searchable dropdown | No | ERP machines; "— Stock build (no machine) —" | Machine must exist; for an RRV-linked order it must match the build's machine (blank uses the build's) |
| Plant | searchable dropdown | No | Branches | Must exist |

If there are no active BOMs, an amber note says to create and activate a BOM first.

Section "Schedule & Store":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Planned Start | date | No | — | — |
| Planned End | date | No | — | Cannot be before Planned Start |
| Supervisor | searchable dropdown | No | Active users | Must be active |
| Issue Materials From | searchable dropdown | No to save, needed to release | Active Store locations | Must exist |
| Receive Output Into | searchable dropdown | No to save, needed to release | Active Store locations | Must exist |
| Remarks | multi-line text | No | — | — |

Hint: both store locations are required before release.

Preview (when a BOM is picked): "Preview — BOM number vN × qty", a components table (Component, Required Qty = BOM qty × qty ÷ base qty × (1 + scrap %), UOM) and an operations table (Seq, Operation with "· quality gate" tag, Workstation, Planned Hours = setup + run hours per unit × qty).

Button **Create Draft Work Order**. On save: number WO-YEAR-NNNN, status Draft, the BOM's components and routing are copied (snapshot) into the order's own material and operation lines, and the page opens the new order (or returns to the RRV build). Requires Work Orders › Create.

### Work Order view — /dashboard/production/work-orders/[id]

#### View page

Header: WO number, status pill, "Overdue" pill when overdue. "← Back" to the list. Green notice / red error banners.

Action buttons:

| Button | When it appears | What it does |
|---|---|---|
| Release to Shop Floor / Submit for Release | Status Draft (label depends on whether the user has Work Orders › Approve) | Confirm dialog. Checks: both store locations set, at least one operation, linked RRV build not cancelled / handed over / deleted, and Quality's first-article release check for the product. An approver releases at once; a user with only Edit submits it to approvers (order stays a locked draft) |
| Complete Work Order | Status In Progress | Needs Work Orders › Approve; every operation completed and at least some output received. Releases leftover reservations and notifies the creator |
| Close Work Order | Status Completed | Needs Approve; locks the order and its costs; cannot be undone |
| Edit Details | Status Draft, Released or In Progress | Opens the edit panel |
| Print Job Card | Always | Opens the Job Card PDF (needs Work Orders › Print) |
| Cancel Work Order | Status Released or In Progress | Reason required (needs Approve). Blocked if material is still issued (return it first) or any output was received (complete instead). Releases reservations |
| Delete Draft | Status Draft and user may delete (Work Orders › Delete; creator rule) | Confirm; soft-deletes. Blocked while a release approval is pending |

**Release approval** panel (shared approval panel, workflow "Work order release") is shown under the buttons.

Info panel:

| Field | Meaning |
|---|---|
| Product | Product code — name |
| BOM | BOM number and version it was built from |
| Machine / Project | ERP machine or "Stock build" |
| RRV build | Build number and role (shown only when linked; click opens the build) |
| Priority | Low / Normal / High / Urgent |
| Planned | Planned start → planned end |
| Actual | Actual start → actual end date-times |
| Issue From | Source Store location or "Not set" |
| Receive Into | Target Store location or "Not set" |
| Supervisor | Supervisor name |
| Plant | Plant name |
| Created By | Creator |
| Scrapped | Total scrapped quantity (from time logs) |
| Output bar | "Output: completed of planned" and percent |
| Remarks / Cancel Reason | Shown when present |

Tabs: Materials (N short), Operations (done/total), Output & Stock, Time Logs (count), Costing.

#### Materials tab

Table "Material Requirement":

| Column | What it shows |
|---|---|
| Item | Code — name; "· extra" for lines issued but not on the BOM |
| Required | Required quantity with UOM |
| Issued | Total issued |
| Returned | Total returned |
| Outstanding | Required − (issued − returned), never below zero |
| Reserved | Quantity the order's Store reservation still holds ("—" in Draft) |
| Free at source | On hand − reserved at the issue-from location; red "· short" when outstanding is more than reserved + free |

Buttons (while Released / In Progress): **Issue from Store**, **Top Up Reservation** (only when some line is short; re-tries reserving free stock, e.g. after a GRN), **Return Unused**. When Completed, only **Return Unused**. In Draft a note says to release first.

Issue / return mode adds an "Issue Qty" or "Return Qty" column (issue is pre-filled with outstanding, capped at reserved + free), a location picker ("Default — <source location>"), Remarks, Cancel and **Post Issue** / **Post Return**. Rules: at least one quantity above zero; issuing draws down the reservation first and posts a Store "issue" transaction (if any line is short the whole issue is rejected); an item not on the BOM can be issued as an extra line; a return cannot exceed what is currently issued and posts a "return_in" transaction. The first issue moves a Released order to In Progress.

#### Operations tab

Table "Routing Operations": Seq, Operation (with work instructions), Workstation, Hours (actual / plan; amber when over), Good, Scrap (red when above zero), Quality (for gate operations: "Gate — not requested", or Inspection pending / Inspecting / Passed / Failed / Passed (conditional) with the inspection or lot number), Status (Pending, In Progress, Completed).

Row actions while the order is Released / In Progress and the operation is not completed (need Shop Floor › Edit):
- **Start** (Pending): blocked if an earlier quality gate is undecided or rejected, or the workstation is deleted, under maintenance or inactive.
- **Log Time**: opens the time-log form (below).
- **Request Inspection** / **Re-inspect** (gate operations with no inspection yet, or a failed one): creates an in-process inspection lot in Quality; the next operation is held until Quality decides.
- **Complete**: disabled until a gate operation's inspection is passed.

Log Time form: Date (not in future), Hours (required, above 0 and at most 24), Good Qty, Scrap Qty, Operator (active users, "— Me —" default), Remarks; Cancel / **Book Time**. Booking on a Pending operation starts it; good and scrap are added to the operation, scrap to the work order's scrapped total.

#### Output & Stock tab

"Receive Finished Goods into Store" (only In Progress): Quantity (required, max = planned − completed), Batch / Serial (defaults to the WO number), Remarks, button "Receive into <target location>". Rules: every quality-gate operation must be accepted by Quality first; for serial-controlled products the quantity must be whole and a single unit needs its serial number. If the product needs final inspection on receipt, the output goes to Quality stock under a final-inspection lot (released or blocked by Quality's usage decision); otherwise a Store "receipt" is posted.

"Store Ledger Movements": Date, Movement (Issued, Returned, Output received, Output received (Quality stock), Released after inspection, Rejected at inspection (Blocked), Held for re-inspection, Released from Blocked, Back to Quality for re-inspection), Item, Qty, Location, Batch, By, Remarks. Includes rows posted against the order's final-inspection lots.

#### Time Logs tab

Columns: Date, Operation, Workstation, Operator, Hours, Good, Scrap, Remarks, and **Remove** (only while the order is Released / In Progress, the operation is not completed, and the user may delete on Shop Floor). Removing subtracts its good / scrap quantities.

#### Costing tab

Four cards: Estimated Cost (material + labour), Actual Cost (material + labour), Variance (actual − estimated, red if over, with % vs estimate), Cost per Unit (actual total ÷ completed quantity, plus actual vs planned hours). Table "Material Cost by Item": Item, Unit Cost ("not set" in amber when zero), Required, Consumed, Estimated, Actual. Costs are computed live: material uses Store standard cost (else moving-average) × required (estimate) or issued − returned (actual); labour uses planned hours (estimate) or logged hours (actual) × each workstation's hourly rate.

#### Edit

Editable while Draft, Released or In Progress: Quantity (only in Draft; changing it re-explodes the BOM into new material and operation lines; locked once released), Priority, Planned Start, Planned End, Supervisor, Machine / Project, Issue Materials From, Receive Output Into, Remarks. Blocked in Draft while a release approval is pending. For an RRV-linked order the machine cannot be changed to a different machine than the build's. Changing the issue-from location on a running order moves its reservations to the new location.

#### Statuses & workflow

| Status | Meaning | Moved by |
|---|---|---|
| Draft | Editable plan | Create |
| Released | On the shop floor; material reserved; supervisor notified | Release approval (Work Orders › Approve) |
| In Progress | Work has begun | First operation start, material issue or time log |
| Completed | All operations done, output received | Complete (Approve) |
| Closed | Locked for reporting | Close (Approve) |
| Cancelled | Stopped with a reason | Cancel (Approve) from Draft / Released / In Progress |

Release approval: workflow "production.work_order_release"; default stage = holders of production:work_orders:approve; self-approval allowed. An admin with nobody else to route to releases directly.

### Shop Floor — /dashboard/production/shop-floor

Header "Shop Floor": "Open operations on released work orders — running first, then by priority and due date." Requires the Shop Floor tab; follows the work-order data scope.

#### List view

Top controls: workstation filter (All workstations or one workstation) and **Refresh**.

Operations (Pending or In Progress, on Released / In Progress work orders) are grouped by workstation ("Unassigned" when none). Each group header shows the workstation, number of operations and remaining hours (planned − actual). Sort: running first, then priority (Urgent, High, Normal, Low), planned end date, WO number, sequence.

Each card (left border coloured by priority) shows: WO number (click opens the work order), "sequence · operation name", product × planned quantity and machine label, status pill (Pending / In Progress), priority pill, work instructions, hours bar (actual / planned, red when over), Good and Scrap totals, "Due <date>" (red "overdue"), and a quality gate pill (Quality gate / Inspection pending / Inspecting / Passed / Failed — rework / Passed (conditional)).

Card actions: **Start** (Pending only), **Log Time** (opens the same time-log form at the top of the page: Date, Hours *, Good Qty, Scrap Qty, Operator, Remarks, Cancel / Book Time), **Request Inspection** / **Re-inspect** (gate operations without inspection or with a failed one), **Complete** (disabled until a gate is passed). Same rules as on the work order Operations tab; actions need Shop Floor › Edit.

Empty text: "No open operations. Release a work order to put its routing on the shop floor."

### Planning — /dashboard/production/planning

Header "Production Planning". Requires the Planning tab.

#### Material Requirements vs Stock

Outstanding component demand of open work orders against Store stock available (on hand − reserved) across all locations. Checkboxes: **Include draft orders** (default on) and **Shortages only**.

| Column | What it shows |
|---|---|
| Item | Code — name |
| Needed | Total outstanding quantity with UOM |
| Reserved | Part already held by these orders' reservations |
| Free Stock | On hand − all reservations, all locations |
| Shortage | Needed − reserved − free (red), or "Covered" (green) |
| Reorder Level | From the Store item master |
| For Work Orders | Pills "WO: qty" coloured by status; click opens the work order |
| (action) | **Build** when short and the item has its own active BOM (opens New Work Order with that BOM and the shortage quantity); **Raise PR** when short, no BOM, and the user has the P2P app (opens /dashboard/p2p/new pre-filled with item, rounded-up quantity and a remark listing the work orders) |

Sorted with the biggest shortages first. A footer note explains Raise PR / Build and "Top Up Reservation" once stock arrives.

#### Workstation Load

Per workstation: name, a bar (green up to 5 days, amber to 10, red beyond; full at 15 days), "remaining hours · open ops · days" (or "no capacity set"), and the status if not active. Remaining hours = planned − logged hours of open operations on released / in-progress orders; days = remaining ÷ capacity per day. Includes an "Unassigned" row when needed.

#### Schedule

A timeline of open work orders (draft, released, in progress) on their planned dates, sorted by planned start. Each row: WO number and product (click opens it), a bar from planned start to end filled to the progress percent (red when overdue), an orange line for today, and a status pill. Orders without dates show "No planned dates".

### BOM & Routing list — /dashboard/production/bom

#### List view

Top button **+ New BOM**. Filters: search "Search by BOM number or product…" and status (All, Draft, Active, Obsolete). Sorted newest first. BOMs are organization-wide (not data-scoped).

| Column | What it shows |
|---|---|
| BOM Number | BOM-YEAR-NNNN |
| Product | Product code — name |
| Version | vN |
| Components | Number of component lines |
| Operations | Number of routing operations |
| Std Cost / Unit | (standard material + labour cost) ÷ base quantity, in ₹ |
| Work Orders | Number of work orders raised from it |
| Status | Draft, Active, Obsolete |
| (action) | "View" |

### New BOM — /dashboard/production/bom/new

"← Back" to the list. Uses the BOM form; button **Save Draft BOM**. Requires BOM › Create.

#### Create form

Section "Product":

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Product (Store item) | searchable dropdown | Yes | Active Store items | Must be active in Store; only one open draft per product allowed |
| Base Quantity | number | Yes (default 1) | — | More than zero; component quantities are per this many units |
| Description | multi-line text | No | — | — |
| Remarks | multi-line text | No | — | — |

Section "Components" (+ Add Component, × to remove a row):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Component | searchable dropdown | Yes per row (empty rows are ignored) | Active Store items | Cannot be the product itself; no duplicate components; must be active |
| Qty (UOM) | number | Yes | — | More than zero |
| Scrap % | number | No (default 0) | — | 0 to under 100 |
| Remarks | text | No | — | — |

Section "Routing Operations" (+ Add Operation adds sequence = highest + 10; × removes):

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Seq | number | Yes | — | 1 or more; unique within the BOM |
| Operation | text | Yes | e.g. Cutting, Welding, Assembly | Max 150 characters |
| Workstation | searchable dropdown | No | Workstations; "— Unassigned —" | Must exist |
| Setup hrs | number | No | — | 0 or more |
| Run hrs/unit | number | No | — | 0 or more |
| Quality gate | checkbox | No | — | Ticked = Quality must pass an inspection before the step can be completed |
| Work instructions | text | No | Drawing ref, torque values, WPS number… | — |

On save: number BOM-YEAR-NNNN, next version number for the product, status Draft; opens the BOM page.

### BOM view — /dashboard/production/bom/[id]

#### View page

Header "BOM number · vN" and status pill; "← Back".

Action buttons:

| Button | When it appears | What it does |
|---|---|---|
| Activate BOM / Submit for Activation | Draft (label depends on BOM › Approve) | Confirm. Needs at least one component. An approver activates at once: it becomes the active version for the product, the previous active version becomes Obsolete, it locks for editing. Others submit to BOM approvers (stays a locked draft) |
| Edit | Draft | Opens the BOM form with "Save Changes" and a "Cancel Edit" button |
| Delete Draft | Draft and user may delete (BOM › Delete; creator rule) | Confirm; soft-delete; blocked while activation is pending |
| + Raise Work Order | Active | Opens New Work Order with this BOM pre-selected |
| New Version | Active | Creates a new Draft copy (next version, remark "Copied from …"); refused if a draft already exists for the product |
| Mark Obsolete | Active | Confirm; needs BOM › Approve; no new work orders can be raised from it |
| New Version from this | Obsolete | Same as New Version |

Summary section:

| Field | Meaning |
|---|---|
| Product | Product code — name |
| Base Quantity | With UOM |
| Std Material Cost | Sum of qty × (1 + scrap %) × item unit cost |
| Std Labour Cost | Sum of (setup + run hrs × base qty) × workstation hourly rate |
| Std Cost / Unit | (material + labour) ÷ base quantity |
| Work Orders | Count raised from this BOM |
| Created By | Creator |
| Activated | Date-time and who activated |
| Description / Remarks | When present |

Components table: Item, Qty, UOM, Scrap %, Unit Cost ("not set" in amber when zero), Line Cost, Remarks. Routing table: Seq, Operation, Workstation, Setup hrs, Run hrs / unit, Quality Gate ("Inspection" tag), Instructions.

**Activation approval** panel at the bottom (workflow "BOM activation").

#### Edit

Only a Draft BOM can be edited (Active or Obsolete must use New Version). The product cannot be changed. Base quantity, description, remarks, components and operations are editable; saving replaces all lines. Blocked while an activation request is pending.

#### Statuses & workflow

| Status | Meaning | Moved by |
|---|---|---|
| Draft | Editable | Create / New Version |
| Active | The one version used for new work orders | Activation approval (BOM › Approve) |
| Obsolete | No new work orders | Mark Obsolete, or automatically when another version is activated |

Approval workflow "production.bom_activation": default stage = holders of production:bom:approve; self-approval allowed. Work orders already raised keep their own snapshot of material and operations.

### Workstations list — /dashboard/production/workstations

#### List view

Top button **+ New Workstation**. Filters: search by code or name; type (All, Machine, Work Center, Assembly Bay, Test Bench, Paint Booth, Other); status (All, Active, Under Maintenance, Inactive). Sorted by code.

| Column | What it shows |
|---|---|
| Code | Workstation code |
| Name | Name |
| Type | Type label |
| Plant | Plant name |
| Capacity / day | Hours per day |
| Rate / hr | Hourly rate in ₹ |
| Open Ops | Not-completed operations on released / in-progress work orders routed here |
| Status | Active, Under Maintenance, Inactive |
| (action) | "View" |

Empty text: "No workstations yet. Add the machines and work centers your routing operations run on."

### New Workstation — /dashboard/production/workstations/new

"← Back" to the list. Button **Create Workstation**. Requires Workstations › Create.

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text (auto upper-case) | Yes | e.g. WELD-01 | Max 30; unique across all workstations including deleted ones (a deleted workstation's code stays reserved) |
| Name | text | Yes | e.g. Welding Bay 1 | Max 150 |
| Type | dropdown | No (default Machine) | Machine, Work Center, Assembly Bay, Test Bench, Paint Booth, Other | — |
| Status | dropdown | No (default Active) | Active, Under Maintenance, Inactive | — |
| Plant | searchable dropdown | No | Branches | Must exist |
| Department | searchable dropdown | No | Departments | Must exist |
| Capacity (hrs/day) | number | No (default 8) | — | 0 to 24 |
| Hourly Rate (₹) | number | No (default 0) | — | 0 or more; turns booked hours into labour/machine cost |
| Description | multi-line text | No | Make/model, capabilities, tooling | — |

### Workstation view / edit — /dashboard/production/workstations/[id]

#### View page

Header "code — name". A line states how many open operations are queued here (or none). The page shows the same form pre-filled with **Save Changes**; a green "Workstation saved." banner after saving. **Delete** button (users with Workstations › Delete) with confirm.

#### Edit

All fields editable. Code, name, type, capacity, rate and status cannot be emptied. Setting status back to Active is refused while the linked Maintenance asset is in breakdown or under maintenance (Maintenance sets it back automatically when its work order closes). Delete is refused while open operations remain on released / in-progress work orders (set it Inactive instead); delete is a soft delete so history stays.

### Production Reports — /dashboard/production/reports

Header "Production Reports" with From / To date pickers (default last 30 days). Range must be From ≤ To and at most one year. Requires the Reports tab.

KPI cards: Output (total quantity received in range), Scrap (total scrap booked, with scrap rate % = scrap ÷ (good + scrap)), Orders Finished (completed or closed in range), Cost Variance (sum of actual − estimated for finished orders).

Section "Finished Goods Output" (Export CSV): Item, UOM, Quantity Received, Work Orders (count). From Store receipts referencing work orders plus final-inspection lots from work orders.

Section "Work Order Cost — Estimated vs Actual" (Export CSV): WO Number, Product, Built / Planned, Scrap, Estimated, Actual, Variance (with %; red when over), Cost / Unit. Orders whose actual end falls in the range and are completed or closed; data-scoped. Row click opens the work order.

Section "Workstation Utilization" (Export CSV): Workstation, Hours Logged, Capacity (capacity per day × working days Monday–Saturday), Utilization % bar (red over 100%), Good, Scrap. Active workstations with no bookings still appear.

## 4. Settings / Masters

Production has no separate settings page. Its masters are:

- **BOM & Routing**: per product, components with scrap allowance and the routing (operations, workstations, setup and run hours, quality gates, work instructions). Controls what a work order reserves, issues and plans, and the standard cost.
- **Workstations**: machines and work centers with capacity and hourly rate. Controls shop-floor grouping, planning load, utilization and labour cost.
- Fixed lists coded in the system (not configurable): the 12 RRV stages and their gates, the 13 RRV test types and the 7 default required tests, priorities, statuses.
- Approval routing for BOM activation, work order release and RRV sign-off is configured in Organization › Approval Workflows.
- Production managers (who can sign off any RRV build) are users flagged as production manager in user administration.

## 5. Permissions

App access: every screen needs the Production app. Tabs are hidden in the nav and refused by the server unless the user can view that tab.

| Tab key | Label | Actions available in the permission matrix |
|---|---|---|
| dashboard | Dashboard | view |
| project_work | Ongoing Projects | view, edit (page redirects to shared Ongoing Projects) |
| rrv_builds | RRV Builds | view, create, edit, delete, approve, reject, export, print |
| work_orders | Work Orders | view, create, edit, delete, approve, reject, export, print |
| shop_floor | Shop Floor | view, create, edit, delete |
| planning | Planning | view, create, edit |
| bom | BOM & Routing | view, create, edit, delete, export, print, approve |
| workstations | Workstations | view, create, edit, delete |
| reports | Production Reports | view, export, print |

Key action gates:
- RRV Builds: Create = new build; Edit = edit, stages, link work orders, tests, rework, hold / resume, request sign-off; Approve + (build manager, production manager or admin) = sign off RRV Completion / Handover, reopen stages, cancel build, cancel rework; Delete = delete a planned build (creator or admin only); Print = handover certificate PDF; Edit on a handed-over build = create / edit the Word certificate.
- Work Orders: Create = new; Edit = edit, issue / return / reserve material, receive output, submit release; Approve = release, complete, close, cancel; Delete = delete draft (creator rule); Print = job card.
- Shop Floor: Edit = start / complete operations, request inspections, book time; Delete = remove a time log.
- BOM: Create = new BOM and new version; Edit = edit draft and submit for activation; Approve = activate and mark obsolete; Delete = delete draft.
- Workstations: Create / Edit / Delete as named.
- Reading a single BOM is allowed with either the BOM & Routing or the Work Orders tab (the New Work Order form needs it).

Data scope (module "production"): work orders (owner = creator, assigned = supervisor, plant = WO plant); RRV builds (owner = creator, assigned = build manager or stage assignee, plant = build plant); rework orders (owner = creator, assigned = assignee or doer, plant = build plant); time logs (owner = operator or booker, plant = WO plant). BOMs and workstations are organization-wide.

## 6. Documents, Notifications & Integrations

### Documents

- **Job Card (PDF)**: "Print Job Card" on a work order. A4 shop-floor traveler: header (product, quantity, BOM, status / priority, machine, planned dates, issue-from, receive-into, supervisor, printed by), pick list (#, item code, description, UOM, required, issued, "Picked By"), routing (seq, operation / instructions, workstation, plan hours, blank Start / End / Good / Scrap / Operator Sign columns), remarks and sign-off boxes (Prepared By, Production Supervisor, Quality (Final), Store (FG Received)).
- **RRV Handover Certificate**: available after handover. Managed Word document (create / edit in Word / upload on the Handover tab) titled "PRODUCTION HANDOVER CERTIFICATE" with vehicle details, customer, PO, serial, chassis, engine, year, warranty, handover and commissioning dates, location, acceptance ref., final inspection, handed over by, vehicle test results, stage sign-off table, remarks and signature blocks ("For Premnath Rail" / "Received by (customer)"). Stored in the SharePoint folder "Production-Handover/<build number>". "Handover Certificate (PDF)" prints the Word version once it exists, else a generated PDF.
- **CSV exports** on the Reports page (output, cost, utilization).

### Notifications (bell only; none are sent to Teams)

| Event | Who is notified |
|---|---|
| Work order released | Supervisor (if not the releaser) |
| Work order completed | Creator (if not the completer) |
| Quality gate passed / failed on an operation | Work order supervisor and creator |
| RRV final inspection requested | All Quality app users |
| RRV final inspection passed | Build manager and creator |
| Rework raised (manual or automatic) | Build manager, creator and rework assignee |
| Rework marked done | Build manager and creator |
| Rework sent back | Build manager, creator, doer and assignee |
| RRV completed | Build manager and creator |
| RRV handed over | Build manager and creator; plus "New machine in service" to all ERP app users |
| Approval requests (BOM activation, WO release, RRV sign-off) | Handled by the central approval engine |

### Integrations with other modules

- **Store**: products and components are Store items; release creates Store stock reservations at the issue-from location; issues, returns and finished-goods receipts post to the Store stock ledger with reference type "work_order"; costs use Store standard / moving-average cost.
- **Quality**: operation quality gates create in-process inspection lots; final-inspection-controlled products are received into Quality stock under a final-inspection lot; first-article release checks run at work order release; RRV final vehicle inspection (FIN-…) is created in Quality; failed inspections raise RRV rework; NCRs can be referenced on manual rework.
- **ERP machine registry**: work orders can be for a machine; RRV Completion creates / updates the machine; Handover activates it with delivery, handover, commissioning and warranty dates for Service. The ERP machine page can show the work orders building that machine (read-only integration endpoint).
- **Electrical and Hydraulic modules**: their jobs / systems for the build's machine gate the RRV integration stages.
- **Procurement (P2P)**: "Raise PR" on Planning opens a pre-filled purchase request.
- **Maintenance**: a workstation linked to a maintenance asset in breakdown cannot be set back to Active from Production.
- **Sales**: an RRV build can carry a Sales Order, line, schedule and customer link set by the Sales module (not shown on the Production screens).
- **Organization**: plants (branches), departments, users and the approval workflows.
