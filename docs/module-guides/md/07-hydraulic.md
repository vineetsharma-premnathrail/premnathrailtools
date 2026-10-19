# Hydraulic & Pneumatic Module

The Hydraulic & Pneumatic module (app key "hydraulic", shown as "Hydraulic & Pneumatic") is the engineering workspace for the fluid-power side of every machine. Engineers register each hydraulic or pneumatic system (a power pack, brake unit, actuation circuit, plant air network), keep a component master of pumps, valves, cylinders and fittings, draw and approve circuit diagrams under revision control, build costed bills of material, run sizing calculations, and record pressure, leak and functional tests with a formal sign-off. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) it is the "H" of the Design/EHP stage: it answers R&D feasibility requests (Requirements tab), produces the hydraulic circuit and hydraulic BOM, and its completed tests are the gate that Production checks before the "Hydraulic integration" stage of an RRV build can be closed. Plant-equipment maintenance, customer service records and spares were retired from this module (plan rule R5) and now live in the Maintenance module and Service & Commissioning.

## 1. Navigation Tabs

The sub-nav (HydraulicNav) sits at the top of every page. Each tab is shown only if the user may view that sub-tab (admins see all). On the right of the nav are the guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/hydraulic | KPI cards for systems, quality and design work, plus the recent tests list |
| Requirements | /dashboard/hydraulic/requirements | Customer requirements the R&D head shared with Hydraulic & Pneumatic for a feasibility reply |
| Systems | /dashboard/hydraulic/systems | Register of hydraulic and pneumatic systems |
| Components | /dashboard/hydraulic/components | Component Master (catalogue of fluid-power components) |
| Circuits | /dashboard/hydraulic/circuits | Circuit diagrams under revision control and review |
| BOM | /dashboard/hydraulic/bom | Hydraulic / pneumatic bills of material with cost roll-up and release approval |
| Calculations | /dashboard/hydraulic/calculations | Saved engineering calculations and the Engineering Calculator |
| Testing | /dashboard/hydraulic/testing | Testing & Inspection records with readings and result sign-off |

Routes that exist but are not in the nav:

- /dashboard/hydraulic/project-work — old "Ongoing Projects" link; it immediately redirects to the company-wide page /dashboard/ongoing-projects (keeping an opened project via ?id=).
- /dashboard/hydraulic/maintenance, /dashboard/hydraulic/service, /dashboard/hydraulic/spares — retired screens kept as read-only history (see section 3, "Retired screens").

## 2. Dashboard

Route /dashboard/hydraulic. Page title "Hydraulic & Pneumatic Dashboard". All figures come from one backend call (GET /hydraulic/dashboard) and, except the Component Master count, cover only records inside the user's data scope. If loading fails, a red banner shows the real error.

### Header buttons

**Actions:**
- **Calculator** — opens the Engineering Calculator (/dashboard/hydraulic/calculations/new).
- **+ New System** — opens the New System form (/dashboard/hydraulic/systems/new).

### First-system prompt

Shown only when the user has no hydraulic and no pneumatic systems. Text: "Add your first system — a hydraulic power pack or pneumatic unit — then attach its circuits, BOM and tests to it."

**Actions:**
- **+ Add your first system** — opens the New System form.

### Systems (KPI group)

| Card | What it shows | How computed |
|---|---|---|
| Hydraulic Systems | Number of hydraulic systems | Count of non-deleted systems with type "hydraulic" |
| Pneumatic Systems | Number of pneumatic systems | Count of non-deleted systems with type "pneumatic" |
| In Service | Systems commissioned or in service (sub-text "Commissioned or in service") | Count of systems with status "in_service" plus status "commissioned"; shown green when above zero |

**Actions:** clicking any of the three cards opens the Systems list.

### Quality & Design (KPI group)

| Card | What it shows | How computed |
|---|---|---|
| Tests (30 days) | Tests completed in the last 30 days; sub-text "N failed" or "None failed" | Count of tests with status "completed" and test date within the last 30 days; failed = those with result "fail". Card turns red when any failed |
| Circuits in Review | Circuit revisions waiting for approval | Count of circuits with status "under_review"; amber when above zero |
| Draft BOMs | BOMs not yet released | Count of BOMs with status "draft" or "under_review" (awaiting release approval) |
| Component Master | Active components (sub-text "Active components") | Count of all non-deleted components with status "active" (not scoped) |

**Actions:** Tests card opens Testing; Circuits card opens Circuits; Draft BOMs opens BOM; Component Master opens Components.

### Recent tests

Shows the 8 most recently created tests (newest first). Each row shows: test number, title, test type label and test date, and a badge. For completed tests the badge is the result (Pending, Pass, Fail, Conditional); otherwise it is the status (Planned, In Progress, Awaiting Sign-off). Empty state text: "Add your first system, then record its pressure, leak and functional tests." (no systems) or "No tests yet — plan a test from the Testing tab."

**Actions:** clicking a row opens that test's view page.

Note: the backend also calculates under-maintenance, overdue/due-soon maintenance plans, open service records, downtime, service cost and low spares figures, but these belong to the retired features and are not shown on the dashboard.

## 3. Screens

### Requirements — /dashboard/hydraulic/requirements

Shared R&D component used by Design, Electrical and Hydraulic & Pneumatic. Header "Requirements" with the line "Customer requirements the R&D head shared with Hydraulic & Pneumatic for your feasibility reply", followed by the count awaiting reply and how many are overdue.

#### List view

| Column | What it shows |
|---|---|
| Requirement | Offer number (or the inquiry/tender universal id) with the requirement title below |
| Customer | Customer organisation name |
| R&D asks | The note R&D wrote for this department (2 lines), with who shared it and when |
| Reply by | Due date for the reply; shown red when overdue |
| Status | Badge: Awaiting reply, Reply overdue, the reply given (Feasible / Feasible with changes / Not feasible), or "Replaced by newer request" |

- Search box: offer number, universal id, title, customer or note.
- Filter buttons: Awaiting reply (default), Replied, All.
- Clicking a row opens the requirement detail page (signed link).

#### View page — /dashboard/hydraulic/requirements/[id]

Header: offer number, Inquiry/Tender and its id, priority, requirement title, customer and when it was shared; "← Back" returns to the list. A status strip shows who shared it, the reply-by date, and the status badge; if the user may reply, a "Reply →" button jumps to the reply tab. If CRM edited the requirement after it was sent to R&D, an orange warning says the tab shows current CRM values. Tabs (can be opened directly with ?tab=tasks, documents, discussion or reply):

| Tab | Contents |
|---|---|
| Requirement | "What R&D needs from Hydraulic & Pneumatic" (R&D's note, who, when, reply-by, overdue flag); "Technical Offer Request to R&D" (offer number, sent date, the TOR documents as clickable files); Customer card (organisation, type, city/state, contact person name, designation, department, mobile, email); "From CRM" card (BD owner, CRM status, priority); Product Requirement (inquiry) or Tender Details (tender) fields from CRM |
| Tasks & Departments | The shared R&D requirement tasks tab — every department's tasks on this requirement, according to the user's access |
| Documents | The shared R&D requirement documents tab |
| Discussion | The shared requirement discussion thread, posting as the hydraulic side |
| Reply to R&D | The department's feasibility reply and earlier requests |

Reply to R&D behaviour:
- Status "replaced": message that R&D sent a newer request; no reply needed.
- Status "responded": shows the reply (label, who, when, remarks and attached files).
- Status "open": if the user lacks the "edit" right on Hydraulic & Pneumatic › Requirements, a message explains they can read but not reply. Otherwise the reply form shows:

| Field | Type | Required | Options / source | Rules |
|---|---|---|---|---|
| Response | Button choice | Yes | Feasible, Feasible with changes, Not feasible | Send is disabled until one is chosen |
| Remarks | Text area | Required unless "Feasible" | Free text | Placeholder changes by response (why not feasible / what must change) |
| Attach files | File (multiple) | No | Any file | Can be removed before sending |

**Send reply to R&D** sends the reply to the R&D head. It cannot be edited afterwards; if anything changes, R&D shares the requirement again. "Earlier requests on this requirement" lists previous shares with their notes and replies.

### Systems — /dashboard/hydraulic/systems

Page title "Systems". A system is the parent record that circuits, BOMs, tests and calculations hang off.

#### List view

| Column | What it shows |
|---|---|
| System No. | Auto number: HYS-YYYY-NNNN (hydraulic) or PNS-YYYY-NNNN (pneumatic) |
| Name | System name |
| Type | Badge: Hydraulic or Pneumatic |
| Application | Application text, or a dash |
| Project | Linked ERP project label, or a dash |
| Working Pressure | Working pressure in bar |
| Status | Status badge (Design, Under Build, Testing, Commissioned, In Service, Under Maintenance, Decommissioned) |
| (action) | "View" link |

- Type tabs: All, Hydraulic, Pneumatic.
- Status filter: All statuses plus every status except "Under Maintenance" (retired; old records still show the badge).
- Search: system number, name, application or loco / machine serial.
- Sorted newest first. Only systems in the user's data scope are listed.
- Top button: **+ New System** (label becomes "+ New Hydraulic System" / "+ New Pneumatic System" when a type tab is selected, and the form opens with that type pre-selected).
- Clicking a row or "View" opens the system.

#### Create form — /dashboard/hydraulic/systems/new

Title "New System", "← Back" returns to the list. Button **Create System**; on success opens the new system.

Section "System":

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Type | Dropdown | Yes | Hydraulic, Pneumatic (default from ?type= or Hydraulic) | Sets the number prefix; cannot be changed later |
| Name | Text | Yes | Free text, max 200 | "System name is required" |
| Application | Text | No | Free text, max 200 | |
| Status | Dropdown | No (default Design) | Design, Under Build, Testing, Commissioned, In Service, Decommissioned | Under Maintenance is hidden (retired) unless the record already has it |
| ERP Project | Searchable dropdown | No | Last 500 ERP projects (project label) | Project must exist |
| Plant | Searchable dropdown | No | Company branches | Branch must exist |
| Owner | Searchable dropdown | No | Active users | User must exist; the owner gets "assigned" data scope on the system |
| Loco / Machine Serial | Text | No | Free text, max 150 | Equipment reference |

Section "Design Parameters — Hydraulic/Pneumatic":

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Working Pressure (bar) | Number | No | | Not negative; cannot exceed Max Pressure |
| Max Pressure (bar) | Number | No | | Not negative |
| Flow Rate (L/min, or Nl/min for pneumatic) | Number | No | | Not negative |
| Reservoir Volume (L) / Air Receiver Volume (L) | Number | No | Label follows type | Not negative |
| Motor / Compressor Power (kW) | Number | No | | Not negative |
| Fluid / Medium | Text | No | e.g. ISO VG 46 mineral oil, compressed air; max 150 | |
| Filtration (micron) | Number | No | | Not negative |
| Cleanliness Target | Text | No | ISO 4406 code (hydraulic) or ISO 8573-1 class (pneumatic); max 30 | |
| Min Temp (°C) | Number | No | Negative allowed | Must not be above Max Temp |
| Max Temp (°C) | Number | No | Negative allowed | |

Section "Notes": Description (text area), Remarks (text area).

Location, Commissioned On and Running Hours are retired (rule R5); the API rejects non-empty values for them.

#### View page — /dashboard/hydraulic/systems/[id]

Header: "System No. — Name" with Type and Status badges.

- **Delete** (top right) — shown only when the user may delete this record (delete permission on Systems, respecting own-record rules). Confirm dialog explains circuits, BOMs and tests keep their link and suggests "Decommissioned" instead. Delete is refused if the system still has open legacy service records. Delete is a soft delete and also deactivates any legacy maintenance plans.
- **← Back** — returns to the list.

Sections in order:

1. Legacy service warning (only if the system has open or in-progress legacy service records): lists each record (number, problem, type, date, status) and tells the user to open and Cancel each one. Clicking a row opens the retired service record page.
2. Summary line: Project, Plant, Serial and Owner when set.
3. The system form (same fields as create) pre-filled; Type is shown read-only. **Save Changes** saves and shows "System saved."
4. Circuits card — "Circuits (N)": current (non-superseded) circuits linked to the system; each row shows circuit number and revision, title, drawing number and status badge. **+ New circuit** opens the new-circuit form with this system pre-selected. If the user cannot view Circuits, the card says "Not available — you may not have access to this tab."
5. Bills of Material card — each BOM with number and revision, title, line count, total cost (₹) and status. **+ New BOM** opens the new-BOM form for this system.
6. Tests card — each test with number, title, type, date and status or result badge. **+ New test** opens the new-test form for this system.
7. System Documents panel (see "Documents panel" below), default document type "GA Drawing".

#### Edit

All fields except Type are editable at any status. Saving requires edit permission on Systems and the record in scope. The backend re-checks working vs max pressure and min vs max temperature against the merged values.

#### Statuses & workflow

| Status | Meaning |
|---|---|
| Design | Default for a new system |
| Under Build | Being built |
| Testing | Under test |
| Commissioned | Commissioned (counted as "In Service" on the dashboard) |
| In Service | In service |
| Under Maintenance | Retired value; kept only on old records |
| Decommissioned | Out of use (recommended instead of deleting) |

Status is set by hand from the form; there are no approvals. The only automatic change is legacy: cancelling the last open breakdown, corrective or overhaul service record on a system in "Under Maintenance" puts it back to "In Service".

### Components — /dashboard/hydraulic/components

Page title "Component Master". One entry per component model (a specific pump, valve, cylinder, FRL unit...). BOM lines point here, so unit cost drives BOM cost. This is master data: it is not limited by data scope.

#### List view

| Column | What it shows |
|---|---|
| Code | Auto code: category prefix plus 4 digits, e.g. PMP-0001 (not year-based) |
| Name | Component name |
| Category | Category label |
| Medium | Badge: Hydraulic, Pneumatic or Both |
| Make / Model | Manufacturer and model number |
| Rating | One-line summary: bore/rod × stroke mm, cc/rev, L/min, bar, or port size |
| Unit Cost | ₹ unit cost |
| Used In | Number of BOMs the component appears on |
| Status | Active or Obsolete |
| (action) | "View" link |

- Search: code, name, manufacturer, model or part number.
- Filters: category (all 25 categories), medium (Hydraulic + Pneumatic / Hydraulic / Pneumatic — "Both" components appear under either), status (default Active; All statuses, Active, Obsolete).
- Sorted by code.
- Top button: **+ New Component**.

Category and code prefix list: Pump (PMP), Hydraulic Motor (MTR), Cylinder (CYL), Directional Valve (DCV), Pressure Control Valve (PCV), Flow Control Valve (FCV), Check Valve (CHV), Proportional / Servo Valve (PRV), Accumulator (ACC), Filter (FLT), Reservoir / Tank (RES), Cooler / Heat Exchanger (CLR), Hose (HOS), Fitting / Adaptor (FIT), Manifold Block (MFD), Compressor (CMP), Air Receiver (ARV), FRL Unit (FRL), Air Dryer (DRY), Pneumatic Actuator (PAC), Solenoid Valve (SOV), Sensor / Transducer (SEN), Gauge (GAU), Seal (SEL), Other (OTH).

#### Create form — /dashboard/hydraulic/components/new

Title "New Component", "← Back", button **Create Component** (opens the new component).

Section "Identity":

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Category | Dropdown | Yes | 25 categories above (default Pump) | Sets the code prefix; cannot be changed later |
| Name | Text | Yes | Max 200 | "Component name is required." |
| Medium | Dropdown | No (default Hydraulic) | Hydraulic, Pneumatic, Both | |
| Status | Dropdown | No (default Active) | Active, Obsolete | |
| Manufacturer | Text | No | Max 150 | |
| Model Number | Text | No | Max 100 | |
| Part / Order Number | Text | No | Max 100 | |
| Linked Store Item | Searchable dropdown | No | Active Store items ("— Not stocked in Store —") | Store item must exist |
| Unit Cost (₹) | Number | No (default 0) | | Zero or more; "Unit cost drives BOM cost roll-ups." |

Section "Ratings — (category)": only the rating fields the category uses are shown; hidden ones are cleared on save.

| Field | Type | Shown for | Rules |
|---|---|---|---|
| Rated Pressure (bar) | Number | Most categories | Positive; cannot exceed Max / Peak Pressure |
| Max / Peak Pressure (bar) | Number | Pump, Motor, Cylinder, Compressor, default set | Positive |
| Flow (L/min) | Number | Pump, Motor, Compressor, default set | Positive |
| Displacement (cc/rev) | Number | Pump, Motor | Positive |
| Bore (mm) | Number | Cylinder, Pneumatic Actuator, Seal | Positive |
| Rod (mm) | Number | Cylinder, Pneumatic Actuator, Seal | Must be smaller than the bore |
| Stroke (mm) | Number | Cylinder, Pneumatic Actuator | Positive |
| Port Size | Text | Most categories (not Seal) | e.g. G 1/2, SAE 16 |
| Mounting | Text | Pump, Motor, Cylinder, Pneumatic Actuator, default set | |
| Seal Material | Text | Cylinder, Pneumatic Actuator, Seal | |
| Medium / Fluid | Text | All | e.g. Mineral oil HLP 46 |
| Min Temp (°C) | Number | All | |
| Max Temp (°C) | Number | All | |
| Weight (kg) | Number | All | Not negative |

The "default set" (all categories not listed separately) is Rated Pressure, Max Pressure, Flow, Port Size, Mounting.

Section "Other Specifications": any number of label/value rows (**+ Add Spec**, "×" to remove); a row with a value must have a label. Also Datasheet Link (URL text) and Description (text area).

#### View page — /dashboard/hydraulic/components/[id]

Header "Code — Name". Buttons: **Delete** (only when the user may delete it) and **← Back**.

- Summary line: "Used on N BOM(s)." or "Not on any BOM yet.", "Stocked in Store as (item code)." when linked, and an "Open datasheet" link when a datasheet URL is set.
- The component form, pre-filled; Category is read-only. **Save Changes** shows "Component saved."
- Datasheets & Drawings documents panel (default type "Datasheet").

Delete (soft) is refused while the component is on any draft BOM — the message names those BOMs and suggests marking it Obsolete. Released BOMs, tests and spares keep their history.

#### Edit

Everything except Category (and the code) is editable at any time by users with edit permission on Components. Making a component Obsolete hides it from BOM and test pickers (existing BOM lines keep it and label it "not in current list").

### Circuits — /dashboard/hydraulic/circuits

Page title "Circuits". A circuit is a hydraulic or pneumatic circuit diagram (ISO 1219 schematic) under revision control. Every revision is its own record sharing the circuit number. The drawing files are documents attached to the revision.

#### List view

| Column | What it shows |
|---|---|
| Circuit No. | CKT-YYYY-NNNN |
| Rev | Revision letter (A, B, ... Z, AA) |
| Title | Circuit title |
| System | Linked system number and name |
| Type | Hydraulic or Pneumatic badge |
| Files | Number of attached drawing files |
| Approved | Approval date and approver name |
| Status | Draft, Under Review, Approved, Superseded |
| (action) | "View" link |

- Search: circuit number, title or drawing number.
- Filters: medium, status, and a "Show superseded" checkbox (superseded revisions are hidden by default; the checkbox is disabled while a status filter is set).
- Superseded rows are dimmed. Only circuits in the user's data scope are listed. Newest first.
- Top button: **+ New Circuit**.

#### Create form — /dashboard/hydraulic/circuits/new

Title "New Circuit" with the note "The circuit is created as Rev A (draft). Upload the schematic on the next page, then submit it for review." "← Back" goes to the system (if opened from one) or the list. Button **Create Circuit**.

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Title | Text | Yes | Max 255 | "Circuit title is required" |
| System | Searchable dropdown | No | All systems ("— Not linked to a system —"); pre-filled from ?system_id | System must exist |
| Medium | Dropdown | Yes (on create without a system) | Hydraulic, Pneumatic | When a system is chosen the medium follows the system and is read-only; cannot be changed after creation |
| Drawing Number | Text | No | Max 100 | |
| Symbol Standard | Text | No | Default "ISO 1219-1"; max 100 | |
| Description | Text area | No | | |
| Change Note | Text area | No | Placeholder "Initial issue" for Rev A | |

#### View page — /dashboard/hydraulic/circuits/[id]

Header "Circuit No. Rev X — Title" with a status badge; "← Back".

Action bar (by status):

| Button | When it appears | What it does |
|---|---|---|
| Submit for Review | Status Draft. Disabled until at least one drawing is uploaded ("Upload the circuit diagram first") | Moves to Under Review and starts the approval request |
| Delete | Status Draft and the user may delete | Deletes the draft revision and its drawings (earlier approved revisions untouched) |
| Approve | Status Under Review and the circuit has no central approval request (older submissions, or no routable approver) | Prompt with optional remarks; approves the revision |
| Return for Changes | Same as Approve | Prompt; remarks required; returns to Draft and notifies the submitter |
| Raise New Revision | Status Approved | Prompt; change note required; creates the next revision as a Draft and opens it |
| (note) | Status Superseded | "This revision has been superseded by a later approved revision" |

Other sections:
- "Returned for changes" amber box — on a draft that has review remarks.
- Review panel (central approval panel) — shows the request status, who submitted and when, the stage list, and for an approver a comment box with **Approve**, **Return for changes** and **Reject** (comment required to reject or return). The requester can **Withdraw approval request**. History can be shown.
- Audit strip: Created by (name and time), Submitted (name and time), Approved (name and time), Approval remarks (when not draft).
- Draft: the circuit form, editable, **Save Changes**. Not draft: a read-only "Circuit" card with System (and "Open system →" link), Medium, Drawing Number, Symbol Standard, Description, Change Note.
- Revision History (N): every revision of this circuit number, newest first — Rev, status badge, "Approved (date)" or "Not approved", change note; the current one is marked "Viewing"; clicking another opens it.
- Circuit Drawings documents panel (default type "Circuit Diagram"). Read-only once the revision is not a draft: "Drawings on a submitted/approved revision are controlled — raise a new revision to change them."

#### Edit

Only a Draft revision can be edited (title, system, drawing number, symbol standard, description, change note). Linking a system copies its medium. After submission the record is locked; changes need a new revision.

#### Statuses & workflow

| Status | Reached by | Next |
|---|---|---|
| Draft | Create, Raise New Revision, Return / Reject / Withdraw | Submit for Review |
| Under Review | Submit for Review (needs Circuits edit right and at least one drawing file) | Approved, or back to Draft |
| Approved | Approval | Raise New Revision; becomes Superseded when a later revision is approved |
| Superseded | A later revision of the same circuit number is approved | Final |

- Approval goes through the central approval engine, transaction "hydraulic.circuit" (Organization › Approval Workflows). Default stage "Circuit approver": holders of Hydraulic & Pneumatic › Circuits › Approve. Self-approval is not allowed (four-eyes): the submitter cannot approve their own circuit unless they are an admin.
- Approving sets the approver and time, stores the approver's comment as review remarks, and supersedes the previously approved revision.
- Return or reject puts the circuit back to Draft with the comment as review remarks; withdraw puts it back to Draft.
- Only one open (draft or under review) revision per circuit number is allowed; "Raise New Revision" is refused if one exists.
- If the engine has no approver to route to, the circuit waits for the old Approve / Return buttons; the people deliberately granted Circuits › Approve (or admins if nobody) get a bell and Teams notification "Circuit ... needs review".

### BOM — /dashboard/hydraulic/bom

Page title "Bills of Material". A BOM lists the components a system or circuit is built from; each line can carry the circuit symbol tag (P1, V3, CYL2) so it reads against the circuit diagram. Costs roll up from Component Master unit costs.

#### List view

| Column | What it shows |
|---|---|
| BOM No. | HBOM-YYYY-NNNN (hydraulic) or PBOM-YYYY-NNNN (pneumatic) |
| Rev | Revision letter |
| Title | BOM title |
| System | Linked system number and name |
| Circuit | Linked circuit number and revision |
| Lines | Number of lines |
| Total Cost | Sum of line costs (₹) |
| Status | Draft, Awaiting Release Approval, Released, Obsolete |
| (action) | "View" link |

- Search: BOM number or title. Filters: medium, status. Obsolete rows are dimmed. Data-scoped. Newest first.
- Top button: **+ New BOM**.

#### Create form — /dashboard/hydraulic/bom/new

Title "New BOM"; "← Back" returns to the system (if opened from one) or the list. Button **Create BOM**.

Section "BOM":

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Title | Text | Yes | Max 255 | "BOM title is required" |
| System | Searchable dropdown | No | All systems; pre-filled from ?system_id | Changing it clears the circuit; medium follows the system |
| Medium | Dropdown | Yes (create, no system) | Hydraulic, Pneumatic | Read-only once a system is chosen or after creation |
| Circuit | Searchable dropdown | No | Non-superseded circuits (of the chosen system if any) | Circuit must exist and belong to the same system |
| Remarks | Text area | No | | |

Section "Lines (N)" — **+ Add Line** adds a row; "×" removes it. Fully blank rows are ignored.

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Tag | Text (upper case) | No | e.g. P1 | Max 30; each tag only once per BOM |
| Component | Searchable dropdown | Yes (for a filled line) | Active components of the BOM's medium or "Both" | Component must exist |
| Qty | Number | Yes | Default 1 | More than zero |
| UOM | Text (upper case) | Yes | Default NOS | Max 20 |
| Line Cost | Read-only | — | Component unit cost × qty | Estimate only |
| Remarks | Text | No | | |

A running "Total" is shown (estimated from component master unit costs). On save the whole line list replaces the previous lines.

#### View page — /dashboard/hydraulic/bom/[id]

Header "BOM No. Rev X — Title" with status badge; "← Back".

Action bar:

| Button | When it appears | What it does |
|---|---|---|
| Submit for Release Approval | Draft and user holds BOM › Submit | Confirm, then sends for release approval (status Awaiting Release Approval). If nobody else can approve, an error tells the user to grant BOM › Approve to a reviewer |
| Release | User holds BOM › Approve, and status is Draft, or Awaiting Release Approval with no engine request | Confirm, then releases (from Draft: submits and approves in one step) |
| Raise New Revision | Released | Confirm, then copies the BOM and its lines into the next revision as a Draft and opens it |
| Export CSV | Always | Downloads "BOMNo-RevX.csv" |
| Delete | Draft and the user may delete | Deletes the draft revision |
| (note) | Obsolete | "This revision is obsolete — a later revision has been released." |

Other sections:
- Release approval panel (central approval panel, as for circuits).
- Audit strip: Created by, Released (by and time), Lines, Total cost.
- Draft: the BOM form, editable, **Save Changes** ("BOM saved.").
- Not draft: read-only "BOM" card (System with "Open system →", Circuit with "Open circuit →", Medium, Remarks) and a "Lines (N)" table: Tag, Code (click opens the component), Component (with line remarks), Category, Make / Model, Qty, UOM, Unit Cost, Line Cost, and a Total row.

CSV export columns: a heading row (BOM no. and revision, title, system number, status), then #, Tag, Code, Component, Category, Manufacturer, Model, Qty, UOM, Unit cost, Line cost, Remarks, and a Total row.

#### Edit

Only a Draft can be edited or deleted. While "Awaiting Release Approval" it is locked ("withdraw the approval request first"). Released and obsolete BOMs need a new revision. Costs always use the component's current unit cost.

#### Statuses & workflow

| Status | Reached by | Next |
|---|---|---|
| Draft | Create, Raise New Revision, return / reject / withdraw of the release request | Submit or Release |
| Awaiting Release Approval (under_review) | Submit for Release Approval | Released, or back to Draft |
| Released | Approval of the release | Raise New Revision; becomes Obsolete when a later revision is released |
| Obsolete | A later revision of the same BOM number is released | Final |

- Release rules: at least one line; if a circuit is linked, that circuit must be Approved ("get the circuit approved before releasing this BOM").
- Approval engine transaction "hydraulic.bom_release"; default stage "BOM approver" = holders of BOM › Approve; self-approval allowed. The request carries the medium, line count and total cost as amount.
- Releasing records the releaser and time and makes the previously released revision Obsolete.
- Only one open draft per BOM number.

### Calculations — /dashboard/hydraulic/calculations

Page title "Calculations". Saved engineering calculations; results are always computed on the server. Not limited by data scope.

#### List view

| Column | What it shows |
|---|---|
| Calc No. | HCALC-YYYY-NNNN |
| Title | Calculation title |
| Calculation | Calculation type name |
| Type | Hydraulic or Pneumatic badge |
| System | Linked system number |
| Key Result | First primary result, e.g. "Extend (push) force: 49.9 kN" |
| By | Who saved it |
| Date | Saved date |
| (action) | "View" link |

- Search: calc number or title. Filters: calculation type (grouped by medium) and medium (changing the medium clears a calculation-type filter that no longer fits).
- Top button: **+ New Calculation** (opens the Engineering Calculator).

#### Create form (Engineering Calculator) — /dashboard/hydraulic/calculations/new

Title "Engineering Calculator", "← Back". Left: a picker grouped Hydraulic / Pneumatic. If the user also has the R&D app, a link "Locomotive hydrostatic drive sizing → R&D tool" opens /dashboard/rnd/hydraulic. Right: the selected calculation's name, medium badge, description, its input fields, **Reset to defaults**, a live Results card, and "Save this calculation".

Results are recalculated automatically 0.4 seconds after each change. Bad inputs show "Can't calculate yet: (reason)" in the results card. Primary results show as large tiles; others in a table; warnings appear in a "Check these" box. The page can be opened with ?type=, ?inputs= (from "Re-run in calculator") and ?system_id=.

Calculations available (inputs with default values; optional ones may be blank):

| Calculation | Medium | Inputs | Main results |
|---|---|---|---|
| Hydraulic Cylinder Force | Hydraulic | Bore 63 mm, Rod 36 mm, Working pressure 160 bar, Mechanical efficiency 95 % | Extend and retract force (kN, tonne-f), piston and annulus area, area ratio |
| Hydraulic Cylinder Speed & Cycle Time | Hydraulic | Bore 63, Rod 36, Stroke 500 mm (optional), Supply flow 20 L/min | Extend / retract speed (mm/s, m/min), stroke times, return flows, swept volume; warns above about 0.3 m/s |
| Pump Delivery (Flow) | Hydraulic | Displacement 28 cc/rev, Drive speed 1450 rpm, Volumetric efficiency 95 % | Actual and theoretical flow, internal leakage |
| Pump Drive Power | Hydraulic | Flow 40 L/min, Pressure 180 bar, Overall efficiency 85 % | Input power kW and hp, next standard motor size, hydraulic power, heat loss |
| Hydraulic Motor Torque & Speed | Hydraulic | Displacement 100 cc/rev, Δp 200 bar, Supply flow 60 L/min, Volumetric 95 %, Mechanical 90 % | Output torque, speed, output and input power, theoretical torque |
| Pipe / Hose Sizing | Hydraulic | Flow 40 L/min, Line (Pressure 3–6 m/s, Return 2–4 m/s, Suction 0.6–1.2 m/s), Actual bore to check (optional) | Recommended and minimum bore, velocity band, actual velocity with warnings |
| Line Pressure Drop | Hydraulic | Flow 40 L/min, Bore 16 mm, Length 5 m, Viscosity 46 cSt, Density 870 kg/m³ | Pressure drop, velocity, Reynolds number, regime, friction factor, power loss |
| Accumulator Sizing | Hydraulic | ΔV 1.5 L, p1 120 bar, p2 200 bar, Pre-charge p0 (optional, default 90 % of p1), Process (adiabatic / isothermal) | Required gas volume, next standard size, pre-charge, exponent, usable fraction |
| Reservoir Sizing | Hydraulic | Pump flow 40 L/min, Dwell time factor 3 | Fluid volume, tank gross volume (+10 %), dwell time |
| Heat Load & Cooler Sizing | Hydraulic | Input power 15 kW, Efficiency 75 %, Tank surface area (optional), Allowed temperature rise (optional) | Heat generated, cooler capacity, tank dissipation |
| Pneumatic Cylinder Force | Pneumatic | Bore 50 mm, Rod 20 mm, Supply pressure 6 bar, Efficiency 85 %, Load to move (optional, kg) | Extend / retract force (N, kgf), load ratio with warnings |
| Air Consumption | Pneumatic | Bore 50, Rod 20, Stroke 200 mm, Cycles 10 /min, Pressure 6 bar, Cylinder (double / single acting) | Free-air consumption Nl/min and Nm³/h, per cycle, compression ratio, with 20 % allowance |
| Air Receiver Sizing | Pneumatic | Demand 1000 Nl/min, Cut-out 8 bar, Minimum 6 bar, Time 1 min | Receiver volume, next standard size, usable stored air |

"Save this calculation" fields:

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Title | Text | Yes | Defaults to the calculation name; max 255 | Required |
| System | Searchable dropdown | No | Systems of the same medium only | Backend rejects a system of the other medium |
| Remarks | Text area | No | Assumptions, load case | |

**Save Calculation** is blocked while the inputs cannot be calculated. The server re-runs the calculation on save so stored results always match the inputs; then the saved calculation opens.

#### View page — /dashboard/hydraulic/calculations/[id]

Header "Calc No. — Title". Buttons: **Re-run in calculator** (opens the calculator with the same type, inputs and system), **Delete** (when the user may delete), **← Back**.

- Meta line: calculation name, medium badge, linked system (click opens it), "Saved by (name) on (date time)", and the calculation description.
- Inputs card: each input label, value (option labels for choices, "Not given" for blank optional inputs) and unit.
- Results card: stored results and warnings.
- Details form: Title (required), System (same medium only), Remarks; **Save Changes** shows "Calculation details saved."

#### Edit

Only Title, System and Remarks can be changed. Inputs cannot be edited — re-run in the calculator and save a new calculation. There is no status or approval.

### Testing — /dashboard/hydraulic/testing

Page title "Testing & Inspection". A test or inspection on a system and/or a single component, with individual readings and a formal result sign-off.

#### List view

| Column | What it shows |
|---|---|
| Test No. | HTST-YYYY-NNNN (hydraulic) or PTST-YYYY-NNNN (pneumatic) |
| Title | Test title |
| Test Type | Test type label |
| Subject | System number and/or component code, with "(S/N serial)" if given |
| Date | Test date |
| Test Pressure | bar |
| Failed Readings | Number of readings marked Fail (red), or a dash |
| Status | Planned, In Progress, Awaiting Sign-off, Completed |
| Result | Pending, Pass, Fail, Conditional |
| (action) | "View" link |

- Search: test number, title or component serial. Filters: medium, test type, status, result. Data-scoped. Newest first.
- Top button: **+ New Test**.

Test types: Pressure Test, Proof Test, Leak Test, Flow Test, Functional Test, Performance Test, Oil Cleanliness (ISO 4406), Relief Valve Setting, Cylinder Drift, Endurance Test, Air Quality (ISO 8573), Other.

#### Create form — /dashboard/hydraulic/testing/new

Title "New Test", "← Back", button **Create Test** (opens the new test). Can be opened with ?system_id= and/or ?component_id=, which pre-select the subject and its medium.

Section "Test":

| Field | Type | Required | Options / source | Rules & validation |
|---|---|---|---|---|
| Title | Text | Yes | Max 255 | "Title is required" |
| Test Type | Dropdown | Yes | 12 test types (default Pressure Test) | |
| Medium | Dropdown | Yes on create | Hydraulic, Pneumatic | Changing it clears System and Component; read-only after creation; system (or component) medium wins on save |
| Test Date | Date | No | | Set to today automatically on Start or completion if blank |
| System | Searchable dropdown | One of System / Component | Systems of the medium | Must exist |
| Component | Searchable dropdown | One of System / Component | Active components of the medium or Both | Must exist |
| Component Serial No. | Text | No | Max 100 | |

Section "Conditions": Test Standard (text, max 150, e.g. ISO 10100 / ISO 4413 / RDSO spec), Test Pressure (bar, not negative), Hold Time (min, not negative), Test Medium (text, max 100), Ambient (°C), Fluid (°C), Tested By (active users), Witnessed By (text, max 200, e.g. RDSO / customer inspector).

Section "Readings (N)" — **+ Add Reading**, and for Proof, Pressure, Leak, Cleanliness, Relief Valve Setting and Cylinder Drift tests a **Load typical readings — (type)** button that adds standard parameters (for example "Test pressure held", "Pressure drop over hold time", "External leakage"; "Test pressure held" gets the test pressure as its minimum).

| Field | Type | Required | Rules |
|---|---|---|---|
| Parameter | Text | Yes for a filled row | Max 200 |
| Unit | Text | No | Max 30 |
| Specification | Text | No | Max 255 |
| Min | Number | No | Must not be above Max |
| Max | Number | No | |
| Measured | Number | No | |
| Measured (text) | Text | No | For visual checks or ISO codes; max 255 |
| Result | Dropdown or auto badge | — | When a min and/or max and a measured value are present, the result is judged automatically (Pass / Fail, shown "· auto"); otherwise the tester picks Pass, Fail or N/A |
| Remarks | Text | No | |

Section "Notes": Observations, Remarks.

#### View page — /dashboard/hydraulic/testing/[id]

Header "Test No. — Title", status and result badges, test type and medium.

Buttons (top right):

| Button | When it appears | What it does |
|---|---|---|
| Start Test | Status Planned (disabled while there are unsaved changes) | Status In Progress; test date = today if blank; Tested By = current user if blank |
| Complete Test | Not completed, user holds Testing › Approve; when Awaiting Sign-off only if there is no engine request | Opens the completion card |
| Submit Result for Sign-off | Not completed and not awaiting sign-off, user holds Testing › Submit but not Approve | Opens the completion card |
| Delete | Not completed and the user may delete | Deletes the test and its readings (withdraws a pending sign-off) |
| Raise Re-test | Completed | Creates a new Planned test "Re-test of (number): (title)" copying setup and reading limits, and opens it |
| ← Back | Always | Returns to the list |

Completion card ("Complete ..." or "Submit result of ..."):
- Warns if there are unsaved changes or no saved readings (the final button is disabled in both cases).
- Result buttons: Pass, Fail, Conditional. Pass is disabled when any reading failed (the failed parameters are listed); the result is pre-set to Fail in that case.
- Remarks — required for Conditional (the condition or concession and who agreed it).
- **Cancel** / **Complete Test** or **Submit Result for Sign-off**.

Other sections:
- Result sign-off panel (central approval panel).
- While Planned or In Progress: the test form, editable, **Save Changes** (message shows the new status if it changed).
- When Awaiting Sign-off or Completed: read-only "Test Record" (Subject, Component Serial No., Test Date, Test Standard, Test Pressure, Hold Time, Test Medium, Ambient / Fluid, Tested By, Witnessed By, Completed By, Completed At), "Readings" table (Parameter, Specification, Limits, Measured, Result, Remarks, with failed count) and "Notes" (Observations, Remarks).
- Test Certificates & Reports documents panel (default type "Test Certificate"); read-only once completed.

#### Edit

Editable while Planned or In Progress (all fields except Medium; System and Component cannot both be cleared). Saving readings with a measured value or text on a Planned test automatically moves it to In Progress. Locked while Awaiting Sign-off and when Completed (raise a re-test instead).

#### Statuses & workflow

| Status | Reached by | Next |
|---|---|---|
| Planned | Create, Raise Re-test | Start Test or saving measured readings → In Progress |
| In Progress | Start / measured readings; return or reject of a sign-off (result reset to Pending) | Submit or Complete |
| Awaiting Sign-off (under_review) | Submit Result for Sign-off (proposed result held on the test) | Completed, or back to In Progress |
| Completed | Sign-off approved, or an approver's one-step Complete | Final; Raise Re-test |

- Completion rules (submit and approve alike): at least one reading; every reading has a measured value or measured text; Pass not allowed when a reading failed; Conditional needs remarks.
- Approval engine transaction "hydraulic.test_result"; default stage "Test approver" = holders of Testing › Approve; self-approval allowed. The request carries the proposed result, test type, medium and remarks. An approver deciding a pending sign-off must approve the submitted result as-is (or return it).
- If no one else can sign off, Submit is refused with a message to grant Testing › Approve to a reviewer.
- On completion: completed by, completed at, result and test date are recorded.

### Documents panel (used on Systems, Components, Circuits, Tests)

Title and default type vary by page. Shows "(Title) (N)". **+ Upload** opens a form:

| Field | Type | Required | Options | Rules |
|---|---|---|---|---|
| Title | Text | Yes | | "Document title is required." |
| Type | Dropdown | No | Circuit Diagram, Schematic, GA Drawing, Datasheet, Test Certificate, Test Report, Manual, Photo, Other | |
| Files | File (multiple) | Yes | Images, PDF, Word, Excel, DWG, DXF, STEP/STP, ZIP | At least one file |
| Description | Text | No | | |

Each document row shows type badge, title, file name and size, uploader and date, with **View** (opens the file in a new tab) and **Delete** (only the uploader or an admin; confirm dialog; also deletes the file from SharePoint). Uploading or deleting needs the "edit" right on the parent's tab. Files are stored in SharePoint under the "Hydraulic-media" folder. Circuit drawings can only be added or removed on a Draft revision; test certificates cannot be added or removed once the test is completed.

### Retired screens (hidden, read-only history)

These pages are not in the nav (plan rule R5). Each shows an amber banner: "(Feature) are retired (rule R5) — read-only history. Plant equipment maintenance now lives in the Maintenance module; customer RRV service is logged in Service & Commissioning → Service Requests." All create, edit, start, complete and delete calls are refused by the API with status 410. Reading them needs view access to Systems.

| Screen | Route | What remains |
|---|---|---|
| Maintenance Plans | /dashboard/hydraulic/maintenance (+ /new, /[id]) | List: Plan No., Title, System, Type, Frequency, Last Done, Next Due, Assigned To, Due, Job; filters for medium, maintenance type, due status; plan view with "Go to Open Job" |
| Service Records | /dashboard/hydraulic/service (+ /new, /[id]) | List: Record No., Date, System, Type, Plan, Performed By / Agency, Downtime h, Total Cost, Status; view page with parts table. **Cancel Job** (reason required) remains on open / in-progress jobs so legacy jobs can be closed; needs Systems edit right |
| Spare Parts | /dashboard/hydraulic/spares (+ /new, /[id]) | List: Part Code, Name, Category, For Component, Criticality, Available / Min, Used (12 m), Lead Time, Stock; filters for category, medium, criticality, stock |

The "New" pages still render a form, but saving fails with the retired message.

## 4. Settings / Masters

The module has no settings screen of its own. Master data and controls:

- **Component Master** (Components tab) — the catalogue every BOM line and test component points to; unit cost drives BOM costing; can link to a Store item.
- **Fixed lists in code** — system types (Hydraulic, Pneumatic), component media (plus Both), system statuses, 25 component categories with code prefixes, 12 test types, document types and the 13 calculation types. They are not admin-configurable.
- **Approval Workflows** (Organization › Approval Workflows) — controls who approves the three hydraulic transactions: "Hydraulic / pneumatic circuit" (hydraulic.circuit), "Hydraulic BOM release" (hydraulic.bom_release) and "Hydraulic test result" (hydraulic.test_result). Defaults are permission-based stages as described above.
- **Lookups** used by forms come from other modules under the hydraulic permission: ERP projects (last 500), plants (branches), active users, active Store items, Store locations.

## 5. Permissions

Module app key "hydraulic" (label "Hydraulic & Pneumatic"). Every API route requires the app; each screen also needs the sub-tab permission. Sub-tabs and actions (Organization › Role & Permissions):

| Sub-tab key | Label | Actions |
|---|---|---|
| dashboard | Dashboard | view |
| project_work | Ongoing Projects | view, edit (page now redirects to the shared Ongoing Projects) |
| requirements | Requirements (from R&D) | view, edit (edit = send the feasibility reply) |
| systems | Systems | view, create, edit, delete (also governs reading retired maintenance / service / spares and cancelling legacy service jobs) |
| components | Component Master | view, create, edit, delete, export, import |
| circuits | Circuits & Diagrams | view, create, edit, delete, approve |
| bom | BOM | view, create, edit, delete, submit, approve, cancel, export |
| calculations | Calculations | view, create, edit, delete |
| testing | Testing & Inspection | view, create, edit, delete, submit, approve, cancel, print |

Key rules:
- Circuits: edit = save draft, submit for review, raise new revision; approve = Approve / Return (never one's own submission unless admin).
- BOM: edit = save draft, raise new revision; submit = Submit for Release Approval; approve = Release (one step).
- Testing: edit = save and Start; submit = Submit Result for Sign-off; approve = Complete Test (one step) and sign-off; create = new test and Raise Re-test.
- Delete buttons follow the central "can delete" rule (delete permission, respecting own-record limits) and are only offered in the allowed status (draft circuit / BOM, non-completed test).
- Documents: viewing follows the parent record; upload / delete needs edit on the parent's tab; delete only by uploader or admin.
- Data scope: Systems — own = created by me, assigned = I am the owner, plant = system's plant; Circuits — own = created or submitted by me; BOMs — own = created by me; Tests — own = created by me, assigned = I am the tester; legacy service records and plans — own = created, assigned = performed by / assigned to. Components, spares, calculations and lookups are not scoped. Dashboard figures follow the same scope.
- All create / edit / delete actions are recorded in the audit log (systems, components, circuits, BOMs and lines, calculations, tests and readings, legacy records, documents).

## 6. Documents, Notifications & Integrations

**Documents generated**
- BOM CSV export ("BOMNo-RevX.csv") from the BOM view page.
- No Word or PDF documents are generated by this module. Drawings, datasheets and test certificates are uploaded files stored in SharePoint (folder "Hydraulic-media").

**Notifications**
- Approval requests for circuits, BOM releases and test results are routed and notified by the central approval engine (approvers are told of new requests; the submitter is told of the decision). Clicking the bell notification opens the circuit, BOM or test.
- Fallback (no engine approver): circuit submitted → bell and Teams notification to users deliberately granted Circuits › Approve (or admins). Approved on the old route → bell notification to the submitter. Returned on the old route → bell notification to the submitter with the remarks.
- R&D requirement shares for Hydraulic & Pneumatic arrive as notifications that open the Requirements detail page.

**Links to other modules**
- R&D: Requirements tab receives requirements shared by the R&D head and sends the feasibility reply back; the calculator links to the R&D locomotive hydrostatic drive tool for users with the R&D app.
- ERP Projects: systems can be linked to an ERP project (machine).
- Production: the RRV build "Hydraulic integration" stage checks systems linked to the build's ERP project — there must be at least one non-decommissioned system, and each must have a latest completed test with result Pass or Conditional; the build page also lists the project's hydraulic systems.
- Store: components can be linked to a Store item; retired spare parts read Store stock balances.
- Organization: plants (branches), users, Approval Workflows, Role & Permissions.
- Ongoing Projects: the old per-module link forwards to /dashboard/ongoing-projects.
- Maintenance module and Service & Commissioning: replace the retired hydraulic maintenance plans, service records and spare parts.
